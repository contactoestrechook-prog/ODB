import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase.provider';
import { libroIvaCompras, libroIvaVentas } from '../facturacion/libro-iva';

// Módulo contable: junta en un solo lugar lo que el contador necesita del mes.
// - IVA VENTAS (débito): comprobantes fiscales del módulo de facturación
//   + facturas electrónicas de la caja con CAE que no tienen comprobante impreso
//   asociado (deduplicado por venta para no contar dos veces la misma operación).
// - IVA COMPRAS (crédito): facturas de proveedor, con percepciones discriminadas.
// - Percepciones IVA e IIBB (ARBA/PBA) sufridas en compras: son pagos a cuenta.
// - Posición IVA del mes y base de Ingresos Brutos.
// Retenciones bancarias/SIRCREB todavía no se capturan (se cargan cuando haya fuente).

const ALIC: Record<number, number> = { 3: 0, 9: 2.5, 8: 5, 4: 10.5, 5: 21, 6: 27 };

@Injectable()
export class ContableService {
  constructor(@Inject(SUPABASE) private readonly db: SupabaseClient) {}

  // Acepta mes ('YYYY-MM') o un rango libre desde/hasta ('YYYY-MM-DD', inclusive):
  // hoy, última semana, quincena, semestre — lo que pida el panel.
  async resumen(q: { mes?: string; desde?: string; hasta?: string } = {}) {
    const hoy = new Date().toISOString().slice(0, 10);
    let desde: string;
    let hasta: string; // exclusivo
    let periodo: string;
    if (q.desde && /^\d{4}-\d{2}-\d{2}$/.test(q.desde)) {
      desde = q.desde;
      const hastaIncl = q.hasta && /^\d{4}-\d{2}-\d{2}$/.test(q.hasta) ? q.hasta : hoy;
      hasta = new Date(new Date(`${hastaIncl}T00:00:00Z`).getTime() + 86400_000).toISOString().slice(0, 10);
      periodo = desde === hastaIncl ? desde : `${desde} a ${hastaIncl}`;
    } else {
      const base = /^\d{4}-\d{2}$/.test(q.mes ?? '') ? q.mes! : hoy.slice(0, 7);
      const [y, m] = base.split('-').map(Number);
      desde = `${base}-01`;
      hasta = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
      periodo = base;
    }
    const base = periodo;

    // ---------- VENTAS: comprobantes fiscales del módulo de facturación ----------
    const ventasRaw: any[] = [];
    for (let off = 0; ; off += 1000) {
      const { data, error } = await this.db
        .from('comprobantes')
        .select('tipo, punto_venta, numero, emitido_en, receptor, neto, iva, total, iva_detalle, estado, venta_id')
        .gte('emitido_en', `${desde}T00:00:00`)
        .lt('emitido_en', `${hasta}T00:00:00`)
        .in('tipo', ['FA', 'FB', 'FC', 'NCA', 'NCB', 'NCC', 'NDA', 'NDB', 'NDC'])
        .range(off, off + 999);
      if (error) throw new BadRequestException(error.message);
      ventasRaw.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }
    const ventas = libroIvaVentas(
      ventasRaw.map((c) => ({
        tipo: c.tipo,
        puntoVenta: c.punto_venta,
        numero: c.numero,
        fecha: String(c.emitido_en).slice(0, 10),
        receptor: c.receptor,
        neto: Number(c.neto),
        iva: Number(c.iva),
        total: Number(c.total),
        ivaDetalle: c.iva_detalle ?? [],
        estado: c.estado,
      })),
    );

    // ---------- VENTAS ELECTRÓNICAS de la caja SIN comprobante impreso ----------
    // (la misma venta puede tener factura impresa + electrónica: se cuenta UNA vez)
    const ventasConComprobante = new Set(ventasRaw.map((c) => c.venta_id).filter(Boolean));
    const { data: arcaRaw } = await this.db
      .from('comprobantes_arca')
      .select('tipo, punto_venta, numero, cae, venta:ventas!inner(id, total, vendida_en)')
      .eq('estado', 'emitido')
      .gte('venta.vendida_en', desde)
      .lt('venta.vendida_en', hasta)
      .limit(10000);
    const soloElectronicos = ((arcaRaw ?? []) as any[]).filter((c) => !ventasConComprobante.has(c.venta.id));
    let electronicos = { cantidad: 0, neto: 0, iva: 0, total: 0 };
    if (soloElectronicos.length) {
      const ids = soloElectronicos.map((c) => c.venta.id);
      const itemsPorVenta = new Map<string, any[]>();
      for (let i = 0; i < ids.length; i += 100) {
        const { data: its } = await this.db
          .from('ventas_items')
          .select('venta_id, cantidad, precio_unitario, producto:productos(alicuota_iva)')
          .in('venta_id', ids.slice(i, i + 100));
        for (const it of (its ?? []) as any[]) {
          const arr = itemsPorVenta.get(it.venta_id) ?? [];
          arr.push(it);
          itemsPorVenta.set(it.venta_id, arr);
        }
      }
      for (const c of soloElectronicos) {
        const total = Number(c.venta.total);
        const items = itemsPorVenta.get(c.venta.id) ?? [];
        const { neto, iva } = this.netoIva(items, total);
        const signo = String(c.tipo).startsWith('NC') ? -1 : 1;
        electronicos.cantidad++;
        electronicos.neto += signo * neto;
        electronicos.iva += signo * iva;
        electronicos.total += signo * total;
      }
      electronicos = {
        cantidad: electronicos.cantidad,
        neto: r2(electronicos.neto),
        iva: r2(electronicos.iva),
        total: r2(electronicos.total),
      };
    }

    // ---------- COMPRAS: facturas de proveedor con percepciones ----------
    const { data: comprasRaw, error: ec } = await this.db
      .from('facturas_proveedor')
      .select('numero, monto, neto, iva, percepcion_iva, percepcion_iibb, otros_impuestos, creado_en, proveedor:proveedores(razon_social, cuit)')
      .gte('creado_en', `${desde}T00:00:00`)
      .lt('creado_en', `${hasta}T00:00:00`)
      .order('creado_en')
      .limit(5000);
    if (ec) throw new BadRequestException(ec.message);
    const comprasLista = ((comprasRaw ?? []) as any[]).map((f) => ({
      numero: f.numero,
      fecha: String(f.creado_en).slice(0, 10),
      proveedor: f.proveedor?.razon_social ?? null,
      cuit: f.proveedor?.cuit ?? null,
      monto: Number(f.monto),
      neto: f.neto != null ? Number(f.neto) : null,
      iva: f.iva != null ? Number(f.iva) : null,
    }));
    const compras = libroIvaCompras(comprasLista);
    // percepciones discriminadas por factura (para el CSV del contador)
    const comprasFilas = compras.filas.map((fila: any, i: number) => ({
      ...fila,
      percepcionIva: r2(Number((comprasRaw as any[])[i]?.percepcion_iva ?? 0)),
      percepcionIibb: r2(Number((comprasRaw as any[])[i]?.percepcion_iibb ?? 0)),
      otrosImpuestos: r2(Number((comprasRaw as any[])[i]?.otros_impuestos ?? 0)),
    }));
    const percepciones = {
      iva: r2(comprasFilas.reduce((s: number, f: any) => s + f.percepcionIva, 0)),
      iibb: r2(comprasFilas.reduce((s: number, f: any) => s + f.percepcionIibb, 0)),
      otros: r2(comprasFilas.reduce((s: number, f: any) => s + f.otrosImpuestos, 0)),
    };

    // ---------- posición del mes ----------
    const ivaDebito = r2(ventas.totales.iva + electronicos.iva);
    const ivaCredito = r2(compras.totales.iva);
    const saldoTecnico = r2(ivaDebito - ivaCredito);
    // las percepciones de IVA sufridas se computan a cuenta del saldo
    const ivaAPagar = r2(saldoTecnico - percepciones.iva);

    // Ingresos Brutos PBA: base = ventas netas devengadas del mes; las
    // percepciones sufridas van a cuenta. La alícuota la define el contador.
    const baseIibb = r2(ventas.totales.neto + electronicos.neto);

    return {
      mes: base,
      ventas: {
        facturacion: { cantidad: ventas.cantidad, ...ventas.totales, porAlicuota: ventas.porAlicuota, filas: ventas.filas },
        electronicosCaja: electronicos,
        totales: {
          neto: r2(ventas.totales.neto + electronicos.neto),
          iva: ivaDebito,
          total: r2(ventas.totales.total + electronicos.total),
        },
      },
      compras: {
        cantidad: compras.cantidad,
        estimadas: compras.estimadas,
        ...compras.totales,
        filas: comprasFilas,
      },
      percepciones,
      posicion: {
        ivaDebito,
        ivaCredito,
        saldoTecnico,
        percepcionesIvaACuenta: percepciones.iva,
        ivaAPagar,
        baseIibb,
        percepcionesIibbACuenta: percepciones.iibb,
        retenciones: 0, // sin fuente de datos todavía (SIRCREB / retenciones bancarias)
      },
    };
  }

  // El año mes a mes: la evolución que mira el contador (y el dueño) de un vistazo.
  async anual(anio?: string) {
    const hoyYM = new Date().toISOString().slice(0, 7);
    const y = /^\d{4}$/.test(anio ?? '') ? Number(anio) : Number(hoyYM.slice(0, 4));
    const meses: any[] = [];
    for (let m = 1; m <= 12; m++) {
      const mes = `${y}-${String(m).padStart(2, '0')}`;
      if (mes > hoyYM) break;
      const r = await this.resumen({ mes });
      meses.push({
        mes,
        comprobantes: (r.ventas.facturacion.cantidad ?? 0) + (r.ventas.electronicosCaja.cantidad ?? 0),
        ventasNeto: r.ventas.totales.neto,
        ventasTotal: r.ventas.totales.total,
        ivaDebito: r.posicion.ivaDebito,
        comprasTotal: r.compras.total,
        ivaCredito: r.posicion.ivaCredito,
        saldoIva: r.posicion.saldoTecnico,
        percepIva: r.percepciones.iva,
        percepIibb: r.percepciones.iibb,
      });
    }
    const suma = (k: string) => Math.round(meses.reduce((s, x) => s + Number(x[k] ?? 0), 0) * 100) / 100;
    return {
      anio: y,
      meses,
      totales: {
        comprobantes: meses.reduce((s, x) => s + x.comprobantes, 0),
        ventasNeto: suma('ventasNeto'),
        ventasTotal: suma('ventasTotal'),
        ivaDebito: suma('ivaDebito'),
        comprasTotal: suma('comprasTotal'),
        ivaCredito: suma('ivaCredito'),
        saldoIva: suma('saldoIva'),
        percepIva: suma('percepIva'),
        percepIibb: suma('percepIibb'),
      },
    };
  }

  // neto/IVA de una venta minorista (precios con IVA incluido) por alícuota de producto
  private netoIva(items: any[], total: number) {
    const porAlic = new Map<number, number>();
    let suma = 0;
    for (const i of items) {
      const alic = Number((i.producto as any)?.alicuota_iva ?? 21);
      const imp = Number(i.cantidad) * Number(i.precio_unitario);
      porAlic.set(alic, (porAlic.get(alic) ?? 0) + imp);
      suma += imp;
    }
    const factor = suma > 0 ? total / suma : 1;
    let neto = 0;
    for (const [alic, imp] of porAlic) neto += (imp * factor) / (1 + alic / 100);
    neto = r2(neto);
    return { neto, iva: r2(total - neto) };
  }
}

const r2 = (n: number) => Math.round((n || 0) * 100) / 100;
