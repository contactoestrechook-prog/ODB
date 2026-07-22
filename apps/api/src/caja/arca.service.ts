import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase.provider';
import { cuitArca, decodificarXml, entornoArca, obtenerTicket, postXmlArca } from './arca-wsaa';

// Worker de facturación electrónica: toma los comprobantes pendientes de la
// caja (cola comprobantes_arca) y les pide el CAE a ARCA vía WSFE, con el
// certificado digital del CUIT. La numeración la manda ARCA (último autorizado
// por punto de venta y tipo) así nunca nos desincronizamos.

const WSFE_URL = {
  produccion: 'https://servicios1.afip.gov.ar/wsfev1/service.asmx',
  homologacion: 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx',
};

// Código ARCA por tipo de comprobante interno
const TIPO_ARCA: Record<string, number> = { FA: 1, NCA: 3, NDA: 2, FB: 6, NCB: 8, NDB: 7 };
// Alícuota → Id de ARCA
const ALIC_ID: Record<string, number> = { '0': 3, '2.5': 9, '5': 8, '10.5': 4, '21': 5, '27': 6 };

@Injectable()
export class ArcaService {
  private readonly log = new Logger(ArcaService.name);
  constructor(@Inject(SUPABASE) private readonly db: SupabaseClient) {}

  async pendientes() {
    const { data, error } = await this.db
      .from('comprobantes_arca')
      .select('id, tipo, punto_venta, numero, estado, error_detalle, creado_en, venta:ventas(total, vendida_en, canal)')
      .in('estado', ['pendiente', 'error'])
      .order('creado_en');
    if (error) throw new BadRequestException(error.message);
    return {
      total: data?.length ?? 0,
      configurado: this.estaConfigurado(),
      comprobantes: data,
    };
  }

  // Chequeo de la conexión sin emitir nada: dummy de WSFE + último autorizado.
  async estado() {
    if (!this.estaConfigurado()) return { configurado: false };
    const dummy = await this.soap('FEDummy', '');
    const auth = await this.authXml();
    const ultimoFB = await this.ultimoAutorizado(auth, 15, TIPO_ARCA.FB).catch((e) => ({ error: String((e as Error).message ?? e) }));
    return {
      configurado: true,
      entorno: entornoArca(),
      cuit: cuitArca(),
      servidorArca: {
        app: dummy.match(/<AppServer>(.*?)<\/AppServer>/)?.[1] ?? '?',
        db: dummy.match(/<DbServer>(.*?)<\/DbServer>/)?.[1] ?? '?',
        auth: dummy.match(/<AuthServer>(.*?)<\/AuthServer>/)?.[1] ?? '?',
      },
      ultimaFacturaB: ultimoFB,
    };
  }

  async emitirPendientes() {
    if (!this.estaConfigurado()) {
      throw new BadRequestException(
        'Facturación ARCA sin configurar: faltan ARCA_CUIT y el certificado (ARCA_CERT_PEM/ARCA_KEY_PEM) en el entorno',
      );
    }
    const { data: cola, error } = await this.db
      .from('comprobantes_arca')
      .select('id, venta_id, tipo, punto_venta, estado')
      .in('estado', ['pendiente', 'error'])
      .order('creado_en')
      .limit(50);
    if (error) throw new BadRequestException(error.message);
    if (!cola?.length) return { emitidos: 0, errores: 0, detalle: [] };

    const auth = await this.authXml();
    // próximo número por (punto de venta, tipo): se pide una vez y se avanza local
    const proximo = new Map<string, number>();

    let emitidos = 0;
    let errores = 0;
    const detalle: any[] = [];
    for (const c of cola as any[]) {
      const tipoArca = TIPO_ARCA[c.tipo];
      try {
        if (!tipoArca) throw new Error(`Tipo ${c.tipo} sin código ARCA`);
        const clave = `${c.punto_venta}-${tipoArca}`;
        if (!proximo.has(clave)) {
          proximo.set(clave, (await this.ultimoAutorizado(auth, c.punto_venta, tipoArca)) + 1);
        }
        const numero = proximo.get(clave)!;
        const r = await this.emitirUno(auth, c, tipoArca, numero);
        proximo.set(clave, numero + 1);
        await this.db
          .from('comprobantes_arca')
          .update({ numero, cae: r.cae, cae_vencimiento: r.vencimiento, estado: 'emitido', error_detalle: null })
          .eq('id', c.id);
        emitidos++;
        detalle.push({ id: c.id, tipo: c.tipo, numero, cae: r.cae });
      } catch (e) {
        errores++;
        const msg = (e instanceof Error ? e.message : String(e)).slice(0, 500);
        await this.db.from('comprobantes_arca').update({ estado: 'error', error_detalle: msg }).eq('id', c.id);
        detalle.push({ id: c.id, tipo: c.tipo, error: msg });
        this.log.warn(`comprobante ${c.id} (${c.tipo}) rechazado: ${msg}`);
      }
    }
    return { emitidos, errores, detalle };
  }

  // --- armado y emisión de un comprobante ---

  private async emitirUno(auth: string, c: any, tipoArca: number, numero: number) {
    // venta + items con la alícuota de IVA de cada producto
    const { data: venta } = await this.db
      .from('ventas')
      .select('id, total, subtotal, descuento, vendida_en, cliente:clientes(dni, cuit, condicion_iva)')
      .eq('id', c.venta_id)
      .single();
    if (!venta) throw new Error('No existe la venta');
    const { data: items } = await this.db
      .from('ventas_items')
      .select('cantidad, precio_unitario, producto:productos(alicuota_iva)')
      .eq('venta_id', c.venta_id);
    if (!items?.length) throw new Error('La venta no tiene renglones');

    const total = Math.round(Number(venta.total) * 100) / 100;
    if (total <= 0) throw new Error('Total en cero: no se factura');

    // desglose por alícuota, prorrateando el descuento para que cierre contra el total
    const porAlic = new Map<string, number>();
    let suma = 0;
    for (const i of items as any[]) {
      const alic = String(Number((i.producto as any)?.alicuota_iva ?? 21));
      const imp = Number(i.cantidad) * Number(i.precio_unitario);
      porAlic.set(alic, (porAlic.get(alic) ?? 0) + imp);
      suma += imp;
    }
    const factor = suma > 0 ? total / suma : 1;
    const buckets = [...porAlic.entries()].map(([alic, imp]) => ({
      alic: Number(alic),
      id: ALIC_ID[alic] ?? 5,
      subtotal: Math.round(imp * factor * 100) / 100,
    }));
    // ajustar el redondeo en el bucket más grande para que sume exacto el total
    const drift = Math.round((total - buckets.reduce((s, b) => s + b.subtotal, 0)) * 100) / 100;
    if (drift !== 0) buckets.sort((a, b) => b.subtotal - a.subtotal)[0].subtotal += drift;

    let impNeto = 0;
    const partes: { id: number; neto: number; iva: number }[] = [];
    for (const b of buckets) {
      const neto = Math.round((b.subtotal / (1 + b.alic / 100)) * 100) / 100;
      const iva = Math.round((b.subtotal - neto) * 100) / 100;
      impNeto += neto;
      partes.push({ id: b.id, neto, iva });
    }
    impNeto = Math.round(impNeto * 100) / 100;
    const impIva = Math.round((total - impNeto) * 100) / 100;
    // el drift de centavos del IVA se absorbe en la parte más grande
    const sumaIva = Math.round(partes.reduce((s, p) => s + p.iva, 0) * 100) / 100;
    const driftIva = Math.round((impIva - sumaIva) * 100) / 100;
    if (driftIva !== 0) partes.sort((a, b) => b.iva - a.iva)[0].iva = Math.round((partes[0].iva + driftIva) * 100) / 100;
    const alicXml = partes
      .map((p) => `<ar:AlicIva><ar:Id>${p.id}</ar:Id><ar:BaseImp>${p.neto.toFixed(2)}</ar:BaseImp><ar:Importe>${p.iva.toFixed(2)}</ar:Importe></ar:AlicIva>`)
      .join('');

    // receptor: CUIT si es factura A, DNI si lo tenemos, consumidor final si no
    const cliente: any = venta.cliente ?? {};
    const esA = ['FA', 'NCA', 'NDA'].includes(c.tipo);
    let docTipo = 99;
    let docNro = '0';
    let condIvaReceptor = 5; // consumidor final
    if (esA) {
      const cuitCliente = String(cliente.cuit ?? '').replace(/\D/g, '');
      if (!cuitCliente) throw new Error('Factura A sin CUIT del receptor');
      docTipo = 80;
      docNro = cuitCliente;
      condIvaReceptor = cliente.condicion_iva === 'monotributo' ? 6 : 1;
    } else if (cliente.dni) {
      docTipo = 96;
      docNro = String(cliente.dni).replace(/\D/g, '');
    }

    // nota de crédito/débito: va asociada a la factura original de la misma venta
    let asociadosXml = '';
    if (['NCA', 'NCB', 'NDA', 'NDB'].includes(c.tipo)) {
      const facturaTipo = ['NCA', 'NDA'].includes(c.tipo) ? 'FA' : 'FB';
      const { data: original } = await this.db
        .from('comprobantes_arca')
        .select('punto_venta, numero')
        .eq('venta_id', c.venta_id)
        .eq('tipo', facturaTipo)
        .eq('estado', 'emitido')
        .maybeSingle();
      if (!original?.numero) {
        throw new Error(`La ${c.tipo} necesita la ${facturaTipo} original emitida (todavía sin CAE)`);
      }
      asociadosXml =
        `<ar:CbtesAsoc><ar:CbteAsoc><ar:Tipo>${TIPO_ARCA[facturaTipo]}</ar:Tipo>` +
        `<ar:PtoVta>${original.punto_venta}</ar:PtoVta><ar:Nro>${original.numero}</ar:Nro></ar:CbteAsoc></ar:CbtesAsoc>`;
    }

    // fecha: la de la venta si está dentro de la ventana que acepta ARCA (5 días)
    const vendida = new Date(venta.vendida_en);
    const dias = (Date.now() - vendida.getTime()) / 86400_000;
    const fecha = (dias >= 0 && dias < 5 ? vendida : new Date()).toISOString().slice(0, 10).replaceAll('-', '');

    const det =
      `<ar:FECAEDetRequest><ar:Concepto>1</ar:Concepto><ar:DocTipo>${docTipo}</ar:DocTipo><ar:DocNro>${docNro}</ar:DocNro>` +
      `<ar:CbteDesde>${numero}</ar:CbteDesde><ar:CbteHasta>${numero}</ar:CbteHasta><ar:CbteFch>${fecha}</ar:CbteFch>` +
      `<ar:ImpTotal>${total.toFixed(2)}</ar:ImpTotal><ar:ImpTotConc>0.00</ar:ImpTotConc><ar:ImpNeto>${impNeto.toFixed(2)}</ar:ImpNeto>` +
      `<ar:ImpOpEx>0.00</ar:ImpOpEx><ar:ImpTrib>0.00</ar:ImpTrib><ar:ImpIVA>${impIva.toFixed(2)}</ar:ImpIVA>` +
      `<ar:MonId>PES</ar:MonId><ar:MonCotiz>1</ar:MonCotiz><ar:CondicionIVAReceptorId>${condIvaReceptor}</ar:CondicionIVAReceptorId>` +
      asociadosXml +
      `<ar:Iva>${alicXml}</ar:Iva></ar:FECAEDetRequest>`;

    const cuerpo =
      `${auth}<ar:FeCAEReq><ar:FeCabReq><ar:CantReg>1</ar:CantReg><ar:PtoVta>${c.punto_venta}</ar:PtoVta>` +
      `<ar:CbteTipo>${tipoArca}</ar:CbteTipo></ar:FeCabReq><ar:FeDetReq>${det}</ar:FeDetReq></ar:FeCAEReq>`;

    const xml = await this.soap('FECAESolicitar', cuerpo);
    const resultado = xml.match(/<Resultado>(.*?)<\/Resultado>/)?.[1];
    const cae = xml.match(/<CAE>(\d+)<\/CAE>/)?.[1];
    if (resultado !== 'A' || !cae) {
      const motivos = [...xml.matchAll(/<Msg>([\s\S]*?)<\/Msg>/g)].map((m) => m[1]);
      throw new Error(motivos.length ? [...new Set(motivos)].join(' | ') : `ARCA respondió resultado ${resultado ?? 'desconocido'}`);
    }
    const vto = xml.match(/<CAEFchVto>(\d{8})<\/CAEFchVto>/)?.[1];
    return {
      cae,
      vencimiento: vto ? `${vto.slice(0, 4)}-${vto.slice(4, 6)}-${vto.slice(6, 8)}` : null,
    };
  }

  private async ultimoAutorizado(auth: string, ptoVta: number, tipo: number): Promise<number> {
    const xml = await this.soap(
      'FECompUltimoAutorizado',
      `${auth}<ar:PtoVta>${ptoVta}</ar:PtoVta><ar:CbteTipo>${tipo}</ar:CbteTipo>`,
    );
    const err = xml.match(/<Err>[\s\S]*?<Msg>([\s\S]*?)<\/Msg>/)?.[1];
    if (err) throw new BadRequestException(`ARCA: ${err}`);
    return Number(xml.match(/<CbteNro>(\d+)<\/CbteNro>/)?.[1] ?? 0);
  }

  private async authXml(): Promise<string> {
    const t = await obtenerTicket(this.db, 'wsfe');
    return `<ar:Auth><ar:Token>${t.token}</ar:Token><ar:Sign>${t.sign}</ar:Sign><ar:Cuit>${cuitArca()}</ar:Cuit></ar:Auth>`;
  }

  private async soap(metodo: string, cuerpo: string): Promise<string> {
    const envelope =
      `<?xml version="1.0" encoding="UTF-8"?>` +
      `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="http://ar.gov.afip.dif.FEV1/">` +
      `<soapenv:Header/><soapenv:Body><ar:${metodo}>${cuerpo}</ar:${metodo}></soapenv:Body></soapenv:Envelope>`;
    const { status, texto } = await postXmlArca(
      WSFE_URL[entornoArca()],
      { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: `http://ar.gov.afip.dif.FEV1/${metodo}` },
      envelope,
    );
    if (status >= 400) {
      const fault = texto.match(/<faultstring>([\s\S]*?)<\/faultstring>/)?.[1];
      throw new BadRequestException(`WSFE ${metodo} falló: ${fault ? decodificarXml(fault) : `HTTP ${status}`}`);
    }
    return decodificarXml(texto);
  }

  private estaConfigurado(): boolean {
    return Boolean(
      process.env.ARCA_CUIT &&
        ((process.env.ARCA_CERT_PEM && process.env.ARCA_KEY_PEM) ||
          (process.env.ARCA_CERT_PATH && process.env.ARCA_KEY_PATH)),
    );
  }
}
