// PRESUPUESTOS (25/11/2026). Leandro, por Juan Pablo: «que todos puedan hacer presupuestos…
// llama alguien y dice tengo una fiesta en casa, me gustaría poner vinos, papas fritas, etc., y
// que los chicos puedan pasarle un presupuesto a raíz de lo que pida el cliente». Decidido:
// · lo arma cualquiera del local (caja, salón, depósito, administración, dueños);
// · le llega por WhatsApp desde la línea de ODB: la tarjeta roja (la de los pedidos) y el PDF;
// · el precio vale 48 horas;
// · si acepta, «Pasar a pedido»: el mismo camino que «Pasar a pedido» de las charlas (reserva el
//   stock, suena en las cajas y queda enlazado a su WhatsApp).
// Los precios los pone el servidor (lista Minorista vigente), nunca la pantalla.

import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase.provider';
import { enviarWhatsapp } from '../comun/whatsapp';
import { cartelPedido } from '../comun/cartel-pedido';
import { HojaPlacaRoja, PILDORA, cantidad as cantidadPdf, importe } from '../comun/documentos';
import { ROJO, GRIS } from '../comun/cartel-pedido';
import { CharlaAPedidoService } from '../pedidos/charla-a-pedido.service';
import {
  estadoVisible, hastaCuando, MAX_RENGLONES, renglonesPedidos, telefonoDelCliente, textoParaElCliente, textoParaLaCharla,
  totalDe, venceEn, type EstadoVisible, type RenglonPresupuesto,
} from './presupuestos';

type Usuario = { sub?: string; nombre?: string; sucursalId?: string | null };
const CAMPOS = 'id, numero, sucursal_id, cliente_nombre, cliente_telefono, nota, items, total, estado, vence_en, creado_en, creado_por, enviado_en, envio_error, pedido_id, aceptado_en, anulado_en, sucursal:sucursales(nombre), autor:usuarios!presupuestos_creado_por_fkey(nombre), pedido:pedidos(qr_retiro, estado)';
const LINEA = 'pedidos';

@Injectable()
export class PresupuestosService {
  private readonly log = new Logger('Presupuestos');
  private listaMinorista: string | null = null;

  constructor(
    @Inject(SUPABASE) private readonly db: SupabaseClient,
    private readonly charla: CharlaAPedidoService,
  ) {}

  // ---------- precios y stock ----------
  private async lista(): Promise<string> {
    if (this.listaMinorista) return this.listaMinorista;
    const { data } = await this.db.from('listas_precios').select('id').eq('nombre', 'Minorista').maybeSingle();
    if (!data) throw new BadRequestException('No encuentro la lista de precios Minorista');
    this.listaMinorista = String((data as any).id);
    return this.listaMinorista;
  }

  /** Precio vigente (lista Minorista) y stock en la sucursal de cada producto. */
  private async preciosYStock(ids: string[], sucursalId?: string | null) {
    const precio = new Map<string, number>();
    const stock = new Map<string, number>();
    if (!ids.length) return { precio, stock };
    const lista = await this.lista();
    const { data: ps } = await this.db.from('precios').select('producto_id, precio, vigente_desde')
      .eq('lista_id', lista).in('producto_id', ids).lte('vigente_desde', new Date().toISOString())
      .order('vigente_desde', { ascending: false });
    for (const p of (ps ?? []) as any[]) if (!precio.has(p.producto_id)) precio.set(p.producto_id, Number(p.precio));
    if (sucursalId) {
      const { data: st } = await this.db.from('stock').select('producto_id, cantidad').eq('sucursal_id', sucursalId).in('producto_id', ids);
      for (const s of (st ?? []) as any[]) stock.set(s.producto_id, Number(s.cantidad ?? 0));
    }
    return { precio, stock };
  }

  /** El buscador de la pantalla: lo más parecido primero, con precio y stock en la sucursal. */
  async buscarProductos(q: string, sucursalId?: string | null) {
    const texto = String(q ?? '').trim();
    if (texto.length < 2) return [];
    const { data, error } = await this.db.rpc('buscar_productos', { p_q: texto, p_solo_activos: true });
    if (error) throw new BadRequestException(error.message);
    const ids = ((data ?? []) as any[])
      .sort((a, b) => Number(a.nivel) - Number(b.nivel) || Number(b.en_nombre) - Number(a.en_nombre) || Number(b.parecido) - Number(a.parecido))
      .slice(0, 20).map((r) => String(r.producto_id));
    if (!ids.length) return [];
    const { data: prods } = await this.db.from('productos').select('id, sku, nombre').in('id', ids);
    const { precio, stock } = await this.preciosYStock(ids, sucursalId);
    const porId = new Map(((prods ?? []) as any[]).map((p) => [String(p.id), p]));
    return ids.filter((id) => porId.has(id)).map((id) => ({
      productoId: id, sku: porId.get(id).sku ?? null, nombre: String(porId.get(id).nombre ?? ''),
      precio: precio.get(id) ?? null, stock: sucursalId ? stock.get(id) ?? 0 : null,
    }));
  }

  // ---------- leer ----------
  private paraPantalla(p: any, stock?: Map<string, number>) {
    const items = (Array.isArray(p.items) ? p.items : []) as RenglonPresupuesto[];
    return {
      id: String(p.id), numero: Number(p.numero), sucursalId: p.sucursal_id, sucursal: p.sucursal?.nombre ?? null,
      clienteNombre: p.cliente_nombre ?? null, clienteTelefono: p.cliente_telefono, nota: p.nota ?? null,
      items: items.map((r) => ({ ...r, stock: stock ? stock.get(r.productoId) ?? 0 : undefined })),
      total: Number(p.total), estado: estadoVisible(p) as EstadoVisible, venceEn: p.vence_en,
      creadoEn: p.creado_en, creadoPor: p.autor?.nombre ?? null, enviadoEn: p.enviado_en ?? null, envioError: p.envio_error ?? null,
      pedido: p.pedido_id ? { id: p.pedido_id, codigo: p.pedido?.qr_retiro ?? null, estado: p.pedido?.estado ?? null } : null,
    };
  }

  async listar(filtro = 'abiertos') {
    const { data, error } = await this.db.from('presupuestos').select(CAMPOS).order('creado_en', { ascending: false }).limit(200);
    if (error) throw new BadRequestException(error.message);
    const todos = ((data ?? []) as any[]).map((p) => this.paraPantalla(p));
    const de: Record<string, (e: EstadoVisible) => boolean> = {
      abiertos: (e) => e === 'borrador' || e === 'enviado', aceptados: (e) => e === 'aceptado', vencidos: (e) => e === 'vencido' || e === 'anulado', todos: () => true,
    };
    return todos.filter((p) => (de[filtro] ?? de.abiertos)(p.estado));
  }

  private async fila(id: string) {
    const { data, error } = await this.db.from('presupuestos').select(CAMPOS).eq('id', id).maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new BadRequestException('Ese presupuesto no existe');
    return data as any;
  }

  async uno(id: string) {
    const p = await this.fila(id);
    const { stock } = await this.preciosYStock(((p.items ?? []) as RenglonPresupuesto[]).map((r) => r.productoId), p.sucursal_id);
    return this.paraPantalla(p, stock);
  }

  // ---------- armar ----------
  /** Crea o corrige: los precios salen de la lista vigente y el plazo corre de nuevo. */
  async guardar(dto: any, usuario: Usuario, id?: string) {
    const telefono = telefonoDelCliente(dto?.clienteTelefono);
    if (!telefono) throw new BadRequestException('Poné el celular del cliente (con característica): por ahí le llega el presupuesto.');
    const pedidos = renglonesPedidos(dto?.items);
    if (typeof pedidos === 'string') throw new BadRequestException(pedidos);
    const sucursalId = String(dto?.sucursalId ?? usuario.sucursalId ?? '').trim();
    if (!/^[0-9a-f-]{36}$/i.test(sucursalId)) throw new BadRequestException('Elegí la sucursal');
    const ids = pedidos.map((r) => r.productoId);
    const { data: prods } = await this.db.from('productos').select('id, sku, nombre, activo').in('id', ids);
    const porId = new Map(((prods ?? []) as any[]).map((p) => [String(p.id), p]));
    const { precio } = await this.preciosYStock(ids, null);
    const renglones: RenglonPresupuesto[] = [];
    for (const r of pedidos) {
      const p = porId.get(r.productoId);
      if (!p || p.activo === false) throw new BadRequestException('Hay un producto que ya no está activo: sacalo del presupuesto.');
      const pr = precio.get(r.productoId);
      if (pr == null || !(pr > 0)) throw new BadRequestException(`${p.nombre} no tiene precio de lista: sacalo o pedí que le carguen el precio.`);
      renglones.push({ productoId: r.productoId, sku: p.sku ?? null, nombre: String(p.nombre), cantidad: r.cantidad, precio: pr });
    }
    const fila: Record<string, unknown> = {
      sucursal_id: sucursalId,
      cliente_nombre: String(dto?.clienteNombre ?? '').replace(/\s+/g, ' ').trim().slice(0, 120) || null,
      cliente_telefono: telefono,
      nota: String(dto?.nota ?? '').trim().slice(0, 500) || null,
      items: renglones, total: totalDe(renglones), vence_en: venceEn(),
    };
    if (id) {
      const actual = await this.fila(id);
      if (actual.estado === 'aceptado' || actual.estado === 'anulado') throw new BadRequestException(`Ese presupuesto ya está ${actual.estado}: armá uno nuevo.`);
      const { error } = await this.db.from('presupuestos').update({ ...fila, actualizado_por: usuario.sub ?? null, actualizado_en: new Date().toISOString() }).eq('id', id);
      if (error) throw new BadRequestException(error.message);
      return this.uno(id);
    }
    const { data, error } = await this.db.from('presupuestos').insert({ ...fila, creado_por: usuario.sub ?? null }).select('id').single();
    if (error) throw new BadRequestException(error.message);
    return this.uno(String((data as any).id));
  }

  // ---------- mandar ----------
  /** La charla del cliente en la línea de ODB: por su número real o por su @lid. */
  private async claveDeCharla(celular: string): Promise<string> {
    const { data } = await this.db.from('bot_contactos').select('telefono').eq('telefono_real', celular).limit(1).maybeSingle();
    return String((data as any)?.telefono ?? celular).replace(/\D/g, '') || celular;
  }

  async pdf(id: string): Promise<{ numero: number; pdf: Buffer }> {
    const p = await this.fila(id);
    const items = (p.items ?? []) as RenglonPresupuesto[];
    const fecha = new Date(p.creado_en).toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });
    const h = await HojaPlacaRoja.abrir('PRESUPUESTO', String(p.numero), `N.º ${p.numero} · ${fecha}`);
    const y0 = h.datos(
      { rotulo: 'PARA', nombre: p.cliente_nombre || 'Cliente', detalle: `WhatsApp ${String(p.cliente_telefono).replace(/^549(\d{2})(\d{4})(\d{4})$/, '$1 $2-$3')}` },
      { rotulo: 'DESDE', nombre: String(p.sucursal?.nombre ?? 'O.D.B').replace(/^Suc\s+/, ''), detalle: p.autor?.nombre ? `Lo armó ${String(p.autor.nombre).split(' ')[0]}` : null },
    );
    const leyenda = h.partir(`Precios válidos hasta ${hastaCuando(p.vence_en)}. Sujeto a stock al confirmar.${p.nota ? ` ${p.nota}` : ''}`, { letra: 'normal', tam: 9 }, h.anchoUtil - 8, 3);
    const cierre = h.renglones(items.map((r) => ({
      cantidad: Number(r.cantidad), nombre: r.nombre,
      gris: `${cantidadPdf(r.cantidad)} × ${importe(r.precio)}`, importe: importe(Number(r.cantidad) * Number(r.precio)),
    })), { desde: y0 + 12, altoCierre: 4 + PILDORA + h.altoLeyenda(leyenda) });
    const y = cierre.y + 4;
    h.pildora(y, 'TOTAL', importe(Number(p.total)));
    h.leyenda(y + PILDORA, leyenda);
    h.pie([
      { texto: 'O.D.B Premium Market', letra: 'fuerte', tam: 9, color: ROJO, espaciado: 1 },
      { texto: 'Respondé el WhatsApp y lo preparamos', letra: 'normal', tam: 8, color: GRIS },
    ], true);
    return { numero: Number(p.numero), pdf: await h.cerrar() };
  }

  /** La tarjeta roja de WhatsApp (la de los pedidos) y el PDF, por la línea de ODB. */
  async enviar(id: string, usuario: Usuario) {
    const p = await this.fila(id);
    const visible = estadoVisible(p);
    if (visible === 'aceptado' || visible === 'anulado') throw new BadRequestException(`Ese presupuesto ya está ${visible}.`);
    // vencido: se manda con los precios de hoy (guardar los recalcula y corre el plazo)
    const actual = visible === 'vencido'
      ? await this.guardar({ clienteTelefono: p.cliente_telefono, clienteNombre: p.cliente_nombre, nota: p.nota, sucursalId: p.sucursal_id, items: p.items }, usuario, id).then(() => this.fila(id))
      : p;
    const vence = venceEn();
    const items = (actual.items ?? []) as RenglonPresupuesto[];
    if (items.length > MAX_RENGLONES) throw new BadRequestException('Demasiados productos para una tarjeta');
    const datos = { numero: Number(actual.numero), cliente_nombre: actual.cliente_nombre, total: Number(actual.total), vence_en: vence, items };

    const png = await cartelPedido({
      titulo: 'PRESUPUESTO', subtitulo: `N.º ${datos.numero} · vale hasta ${hastaCuando(vence).replace(/^el /, '')}`,
      renglones: items.map((r) => ({ nombre: r.nombre, cantidad: Number(r.cantidad), unitario: Number(r.precio), subtotal: Math.round(Number(r.cantidad) * Number(r.precio) * 100) / 100 })),
      total: datos.total, entrega: null, confirmar: false, pie: '', nota: 'Respondé este WhatsApp y lo preparamos',
    });
    const mes = new Date().toISOString().slice(0, 7);
    const rutaImg = `carteles/${mes}/presupuesto-${datos.numero}-${Date.now()}.png`;
    const { error: eImg } = await this.db.storage.from('publico').upload(rutaImg, png, { contentType: 'image/png', upsert: true });
    if (eImg) throw new BadRequestException(`No pude preparar la tarjeta: ${eImg.message}`);
    const imagenUrl = this.db.storage.from('publico').getPublicUrl(rutaImg).data.publicUrl;

    // el PDF lleva el nombre y el teléfono del cliente: va al archivo privado, con un link que vence
    const { pdf } = await this.pdf(id).catch(() => ({ pdf: null as Buffer | null, numero: datos.numero }));
    let documentoUrl: string | null = null;
    if (pdf) {
      const rutaPdf = `presupuestos/${mes}/presupuesto-${datos.numero}-${Date.now()}.pdf`;
      const { error: ePdf } = await this.db.storage.from('bot-adjuntos').upload(rutaPdf, pdf, { contentType: 'application/pdf', upsert: false });
      if (!ePdf) documentoUrl = (await this.db.storage.from('bot-adjuntos').createSignedUrl(rutaPdf, 3600)).data?.signedUrl ?? null;
    }

    const texto = textoParaElCliente(datos);
    const r1 = await enviarWhatsapp(this.db, { to: actual.cliente_telefono, imagenUrl, text: texto, origen: 'presupuesto', referencia: `presupuesto/${datos.numero}` });
    if (!r1.enviado) {
      const motivo = (r1 as any).motivo ?? 'no salió';
      await this.db.from('presupuestos').update({ envio_error: String(motivo).slice(0, 300) }).eq('id', id);
      throw new BadRequestException(`El WhatsApp no salió (${motivo}). Probá de nuevo en un momento.`);
    }
    if (documentoUrl) {
      await enviarWhatsapp(this.db, { to: actual.cliente_telefono, documentoUrl, nombreArchivo: `Presupuesto ODB ${datos.numero}.pdf`, text: '', origen: 'presupuesto', referencia: `presupuesto/${datos.numero}` })
        .catch((e) => this.log.warn(`presupuesto ${datos.numero}: el PDF no salió (${e instanceof Error ? e.message : e})`));
    }

    // queda en la charla de la línea: si contesta «dale», el bot sabe de qué se habla
    const clave = await this.claveDeCharla(actual.cliente_telefono);
    const { data: conv } = await this.db.from('bot_conversaciones').select('mensajes').eq('linea', LINEA).eq('telefono', clave).maybeSingle();
    const hist = Array.isArray((conv as any)?.mensajes) ? (conv as any).mensajes : [];
    await this.db.from('bot_conversaciones').upsert({
      linea: LINEA, telefono: clave,
      mensajes: [...hist, { role: 'assistant', content: textoParaLaCharla(datos), de: 'presupuesto', en: new Date().toISOString() }].slice(-40),
      actualizado_en: new Date().toISOString(),
    }, { onConflict: 'linea,telefono' }).then(() => null, () => null);

    await this.db.from('presupuestos').update({
      estado: 'enviado', vence_en: vence, enviado_en: new Date().toISOString(), enviado_por: usuario.sub ?? null, envio_error: null,
    }).eq('id', id);
    this.log.log(`presupuesto ${datos.numero} mandado a ${actual.cliente_telefono} por ${usuario.nombre ?? 'alguien del local'}`);
    return this.uno(id);
  }

  // ---------- aceptar o anular ----------
  /** Lo acepta: entra como pedido nuevo por el camino de «Pasar a pedido» de las charlas. */
  async pasarAPedido(id: string, dto: any, usuario: Usuario) {
    const p = await this.fila(id);
    if (p.estado === 'aceptado') throw new BadRequestException(`Ya se pasó a pedido${p.pedido?.qr_retiro ? ` (${p.pedido.qr_retiro})` : ''}.`);
    if (p.estado === 'anulado') throw new BadRequestException('Ese presupuesto está anulado.');
    const items = (p.items ?? []) as RenglonPresupuesto[];
    const { precio } = await this.preciosYStock(items.map((r) => r.productoId), null);
    const tipo = dto?.tipo === 'envio' ? 'envio' : 'retiro';
    const clave = await this.claveDeCharla(p.cliente_telefono);
    const r = await this.charla.crear({
      linea: LINEA, telefono: clave, telefonoReal: p.cliente_telefono,
      // el precio de hoy, y el que se le dio: si cambió, las notas del pedido lo dicen
      items: items.map((it) => ({ producto_id: it.productoId, cantidad: Number(it.cantidad), nombre: it.nombre, precio: precio.get(it.productoId) ?? it.precio, precioDicho: it.precio })),
      nombre: p.cliente_nombre ?? null, recibe: dto?.recibe ?? null, tipo,
      direccion: tipo === 'envio' ? dto?.direccion ?? null : null,
      entregaFecha: dto?.entregaFecha ?? null, franja: dto?.franja ?? null,
      formaPago: dto?.formaPago ?? null,
      notas: [`Presupuesto N.º ${p.numero}.`, p.nota, dto?.notas].filter(Boolean).join(' '),
      sinMatch: [],
    }, { sub: usuario.sub, nombre: usuario.nombre });
    await this.db.from('pedidos').update({ origen: 'presupuesto' }).eq('id', r.pedidoId).then(() => null, () => null);
    await this.db.from('presupuestos').update({ estado: 'aceptado', pedido_id: r.pedidoId, aceptado_en: new Date().toISOString(), aceptado_por: usuario.sub ?? null }).eq('id', id);
    return { ...(await this.uno(id)), pedidoCodigo: r.codigo, sinStock: r.sinStock };
  }

  async anular(id: string, usuario: Usuario) {
    const p = await this.fila(id);
    if (p.estado === 'aceptado') throw new BadRequestException('Ya se pasó a pedido: si no va, cancelá el pedido.');
    await this.db.from('presupuestos').update({ estado: 'anulado', anulado_en: new Date().toISOString(), anulado_por: usuario.sub ?? null }).eq('id', id);
    return this.uno(id);
  }

  async sucursales() {
    const { data } = await this.db.from('sucursales').select('id, nombre').order('nombre');
    return ((data ?? []) as any[]).map((s) => ({ id: String(s.id), nombre: String(s.nombre) }));
  }
}
