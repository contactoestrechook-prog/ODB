import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase.provider';
import { CatalogoService } from './catalogo.service';

// Fotos de producto por código de barras desde EZ Catalog (Huggian), 2026-09-09.
// Pedido de Leandro: «con los códigos de barra nos dan las fotos de los productos».
// La foto se guarda en el MISMO lugar que las subidas a mano (Storage
// productos/{sku}.jpg), así la web, la app y el panel la ven sin cambios.
// Cada consulta queda registrada en fotos_externas: nunca se vuelve a pedir
// un código que ya dio foto, y los que fallaron se reintentan a los 30 días.
const BASE = (process.env.EZ_CATALOG_URL ?? 'https://api.ez-catalog.huggian.com').replace(/\/$/, '');
const EAN_PRUEBA = '7790895000010'; // Coca-Cola 2,25 l: existe seguro en cualquier catálogo argentino
const POR_MINUTO = Math.max(10, Number(process.env.EZ_CATALOG_POR_MINUTO ?? 60)); // Basic 60/min, Pro 300/min

type Externo = { nombre: string | null; marca: string | null; imagenUrl: string | null; presentacion: string | null; verificado: boolean };
type Resultado = { resultado: 'foto' | 'sin_producto' | 'sin_imagen' | 'error'; imagenUrl?: string; nombreExterno?: string | null; marcaExterna?: string | null; detalle?: string };

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

@Injectable()
export class FotosExternasService {
  private readonly log = new Logger(FotosExternasService.name);
  constructor(@Inject(SUPABASE) private readonly db: SupabaseClient, private readonly catalogo: CatalogoService) {}

  private clave() { return (process.env.EZ_CATALOG_API_KEY ?? '').trim(); }
  private urlImagen(sku: string) { return `${process.env.SUPABASE_URL}/storage/v1/object/public/productos/${encodeURIComponent(sku)}.jpg`; }

  // Una consulta al catálogo externo. 404 = no está; el resto de los errores, con mensaje claro.
  async consultar(ean: string): Promise<{ estado: 'ok' | 'sin_producto'; producto?: Externo }> {
    const clave = this.clave();
    if (!clave) throw new BadRequestException('Falta la clave de EZ Catalog (variable EZ_CATALOG_API_KEY en Railway)');
    const ctrl = new AbortController();
    const reloj = setTimeout(() => ctrl.abort(), 20_000);
    try {
      const r = await fetch(`${BASE}/v1/products/barcode/${encodeURIComponent(ean)}`, { headers: { 'X-Api-Key': clave }, signal: ctrl.signal });
      if (r.status === 404) return { estado: 'sin_producto' };
      if (r.status === 401) throw new BadRequestException('EZ Catalog rechazó la clave (401): revisá EZ_CATALOG_API_KEY');
      if (r.status === 403) throw new BadRequestException('EZ Catalog: el plan contratado no permite esta consulta (403)');
      if (r.status === 429) throw new BadRequestException(`EZ Catalog: límite de consultas alcanzado, reintentar en ${r.headers.get('retry-after') ?? '60'} s`);
      if (!r.ok) throw new BadRequestException(`EZ Catalog respondió ${r.status}`);
      const d: any = await r.json();
      return {
        estado: 'ok',
        producto: { nombre: d.name ?? null, marca: d.brand ?? null, imagenUrl: d.image_url ?? null, presentacion: d.presentation ?? null, verificado: !!d.verified },
      };
    } finally { clearTimeout(reloj); }
  }

  // Estado para la pantalla: clave, conexión real, cuántos productos esperan foto.
  async estado() {
    const configurada = !!this.clave();
    let conexion: 'ok' | 'error' | 'sin_clave' = configurada ? 'ok' : 'sin_clave';
    let mensaje = configurada ? 'Conexión con EZ Catalog verificada' : 'Falta cargar la clave de EZ Catalog en Railway (EZ_CATALOG_API_KEY)';
    let muestra: any = null;
    if (configurada) {
      try {
        const r = await this.consultar(EAN_PRUEBA);
        muestra = r.producto ?? null;
        if (r.estado === 'sin_producto') mensaje = 'La clave funciona (el código de prueba no está en el catálogo)';
      } catch (e) { conexion = 'error'; mensaje = e instanceof Error ? e.message : String(e); }
    }
    const pendientes = await this.pendientes();
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    const { count } = await this.db.from('fotos_externas').select('id', { count: 'exact', head: true }).gte('creado_en', hoy.toISOString());
    const { count: conFoto } = await this.db.from('fotos_externas').select('id', { count: 'exact', head: true }).eq('resultado', 'foto');
    return { configurada, conexion, mensaje, muestra, sinFoto: pendientes.length, consultadosHoy: count ?? 0, fotosTraidas: conFoto ?? 0, porMinuto: POR_MINUTO };
  }

  // Activos con código de barras que todavía no tienen foto en Storage.
  private async pendientes(): Promise<{ producto_id: string; sku: string; codigo: string }[]> {
    const [fotos, cand] = await Promise.all([this.catalogo.skusConFoto(), this.db.rpc('fotos_externas_pendientes', { p_limite: 5000 })]);
    if (cand.error) throw new BadRequestException(cand.error.message);
    return ((cand.data ?? []) as any[]).filter((c) => !fotos.has(`${c.sku}.jpg`));
  }

  // Un lote: la pantalla lo llama repetidamente hasta que no queden pendientes.
  async completar(limite = 30) {
    const pendientes = await this.pendientes();
    const lote = pendientes.slice(0, Math.max(1, Math.min(Number(limite) || 30, 100)));
    const res = { procesados: 0, conFoto: 0, sinProducto: 0, sinImagen: 0, errores: 0, restantes: Math.max(0, pendientes.length - lote.length), parado: null as string | null, detalle: [] as any[] };
    for (const c of lote) {
      try {
        const r = await this.traerPara(c.producto_id, c.sku, c.codigo);
        res.procesados++;
        if (r.resultado === 'foto') res.conFoto++; else if (r.resultado === 'sin_producto') res.sinProducto++; else if (r.resultado === 'sin_imagen') res.sinImagen++; else res.errores++;
        if (res.detalle.length < 30) res.detalle.push({ sku: c.sku, ean: c.codigo, resultado: r.resultado, nombre: r.nombreExterno ?? null });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        res.errores++;
        if (/clave|401|403|límite|429|Falta/i.test(msg)) { res.parado = msg; break; } // sin clave o sin cupo: no tiene sentido seguir
      }
      await dormir(Math.ceil(60_000 / POR_MINUTO));
    }
    if (res.procesados) this.log.log(`EZ Catalog: ${res.conFoto} fotos de ${res.procesados} consultas (${res.restantes} pendientes)`);
    return res;
  }

  // Para un producto puntual (desde la ficha), aunque ya se haya consultado antes.
  async paraSku(sku: string) {
    const { data: p } = await this.db.from('productos').select('id, sku, nombre, codigos:codigos_barras(codigo)').eq('sku', sku).maybeSingle();
    if (!p) throw new BadRequestException('Producto inexistente');
    const codigos = ((p as any).codigos ?? []).map((c: any) => String(c.codigo)).filter((c: string) => /^[0-9]{8,14}$/.test(c));
    if (!codigos.length) throw new BadRequestException('Este producto no tiene código de barras cargado: vinculalo primero desde la caja o la ficha');
    let ultimo: Resultado = { resultado: 'sin_producto' };
    for (const ean of codigos) {
      ultimo = await this.traerPara(p.id, p.sku, ean);
      if (ultimo.resultado === 'foto') break;
    }
    return { sku: p.sku, nombre: (p as any).nombre, ...ultimo };
  }

  private async traerPara(productoId: string, sku: string, ean: string): Promise<Resultado> {
    const registrar = (resultado: Resultado['resultado'], p?: Externo | null, detalle?: string) =>
      this.db.from('fotos_externas').insert({ producto_id: productoId, sku, ean, resultado, nombre_externo: p?.nombre ?? null, marca_externa: p?.marca ?? null, url_externa: p?.imagenUrl ?? null, detalle: detalle ?? null }).then(() => null, () => null);
    let consulta: { estado: 'ok' | 'sin_producto'; producto?: Externo };
    try { consulta = await this.consultar(ean); }
    catch (e) { const msg = e instanceof Error ? e.message : String(e); await registrar('error', null, msg); throw e; }
    if (consulta.estado === 'sin_producto') { await registrar('sin_producto'); return { resultado: 'sin_producto' }; }
    const p = consulta.producto!;
    if (!p.imagenUrl) { await registrar('sin_imagen', p); return { resultado: 'sin_imagen', nombreExterno: p.nombre, marcaExterna: p.marca }; }
    try {
      const ctrl = new AbortController(); const reloj = setTimeout(() => ctrl.abort(), 25_000);
      const img = await fetch(p.imagenUrl, { signal: ctrl.signal }).finally(() => clearTimeout(reloj));
      if (!img.ok) throw new Error(`la imagen respondió ${img.status}`);
      const buf = Buffer.from(await img.arrayBuffer());
      if (buf.length < 500) throw new Error('la imagen llegó vacía');
      const tipo = img.headers.get('content-type') ?? 'image/jpeg';
      const { error } = await this.db.storage.from('productos').upload(`${sku}.jpg`, buf, { contentType: tipo.startsWith('image/') ? tipo : 'image/jpeg', upsert: true });
      if (error) throw new Error(error.message);
      this.catalogo.invalidarFotos();
      await registrar('foto', p);
      return { resultado: 'foto', imagenUrl: this.urlImagen(sku), nombreExterno: p.nombre, marcaExterna: p.marca };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await registrar('error', p, msg);
      return { resultado: 'error', nombreExterno: p.nombre, detalle: msg };
    }
  }
}
