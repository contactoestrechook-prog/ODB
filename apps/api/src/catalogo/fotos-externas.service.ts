import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase.provider';
import { CatalogoService } from './catalogo.service';
import { recorrerConRitmo } from './ritmo';
import { pareceElMismoProducto } from './parecido';
import { traerTodo } from '../comun/lotes';

// Fotos de producto por código de barras desde EZ Catalog (Huggian), 2026-09-09.
// Pedido de Leandro: «con los códigos de barra nos dan las fotos de los productos».
// La foto se guarda en el MISMO lugar que las subidas a mano (Storage
// productos/{sku}.jpg), así la web, la app y el panel la ven sin cambios.
// Cada consulta queda registrada en fotos_externas: nunca se vuelve a pedir
// un código que ya dio foto, y los que fallaron se reintentan a los 30 días.
const BASE = (process.env.EZ_CATALOG_URL ?? 'https://api.ez-catalog.huggian.com').replace(/\/$/, '');
const EAN_PRUEBA = '7790895000010'; // Coca-Cola 2,25 l: existe seguro en cualquier catálogo argentino
const POR_MINUTO = Math.max(10, Number(process.env.EZ_CATALOG_POR_MINUTO ?? 60)); // Basic 60/min, Pro 300/min
const PARALELO = Math.max(1, Math.min(Number(process.env.EZ_CATALOG_PARALELO ?? 6), 20)); // descargas de imagen en vuelo a la vez
// Consultas al catálogo en vuelo a la vez. Medido el 9/9 con códigos nunca
// consultados: de a una, 9 s cada una (6,7 por minuto); de a cuatro, 12-20 s
// cada una pero 13 por minuto. De a ocho rinde algo más en la prueba suelta,
// pero cada consulta se estira tanto que la tanda entera pasa el límite del
// proxy de Railway y se corta la conexión: cuatro es el punto que aguanta.
const PARALELO_CONSULTA = Math.max(1, Math.min(Number(process.env.EZ_CATALOG_PARALELO_CONSULTA ?? 4), 10));
// Fallas pasajeras (corte por tiempo, red): no se registran, para que el producto se vuelva a intentar.
const PASAJERO = /aborted|abort|timeout|ETIMEDOUT|ECONNRESET|ENOTFOUND|fetch failed|socket/i;

type Externo = { nombre: string | null; marca: string | null; imagenUrl: string | null; presentacion: string | null; verificado: boolean };
type Pendiente = { producto_id: string; sku: string; codigo: string; nombre: string };
type Resultado = { resultado: 'foto' | 'sin_producto' | 'sin_imagen' | 'dudoso' | 'error'; imagenUrl?: string; nombreExterno?: string | null; marcaExterna?: string | null; detalle?: string };

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
    const reloj = setTimeout(() => ctrl.abort(), 45_000);
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
    const pendientes = this.cola && Date.now() - this.cola.ts < 15 * 60_000 ? this.cola.lista : await this.pendientes();
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    const { count } = await this.db.from('fotos_externas').select('id', { count: 'exact', head: true }).gte('creado_en', hoy.toISOString());
    const { count: conFoto } = await this.db.from('fotos_externas').select('id', { count: 'exact', head: true }).eq('resultado', 'foto');
    return { configurada, conexion, mensaje, muestra, sinFoto: pendientes.length, consultadosHoy: count ?? 0, fotosTraidas: conFoto ?? 0, porMinuto: POR_MINUTO };
  }

  // Activos con código de barras que todavía no tienen foto en Storage.
  // El tope tiene que cubrir TODO el catálogo (7.900 activos con código): la
  // mayoría ya tiene foto y se descarta acá, así que un tope corto mostraba un
  // número de pendientes que no era el real y hacía trabajar siempre la misma punta.
  private async pendientes(): Promise<Pendiente[]> {
    const fotos = await this.catalogo.skusConFoto();
    // PostgREST devuelve como mucho 1.000 filas aunque la función pida más: sin
    // paginar, el sistema veía 1.000 candidatos y decía que faltaban 951 fotos
    // cuando en realidad faltaban casi 7.000. Ver [[odb-supabase-limites-silenciosos]].
    const todos = await traerTodo<any>((desde, hasta) =>
      this.db.rpc('fotos_externas_pendientes', { p_limite: 20000 }).range(desde, hasta));
    return todos.filter((c) => !fotos.has(`${c.sku}.jpg`));
  }

  // Armar esa lista cuesta ~45 s (ocho páginas de mil filas + el listado de
  // Storage). Como el lote se llama una vez atrás de otra hasta terminar, se
  // arma una vez y cada tanda se lleva su parte: si no, la mitad del tiempo de
  // cada tanda se iba en recalcular lo mismo.
  private cola: { lista: Pendiente[]; ts: number } | null = null;

  private async proximos(cuantos: number): Promise<{ lote: Pendiente[]; faltan: number }> {
    if (!this.cola || !this.cola.lista.length || Date.now() - this.cola.ts > 15 * 60_000) {
      this.cola = { lista: await this.pendientes(), ts: Date.now() };
    }
    const lote = this.cola.lista.splice(0, cuantos);
    return { lote, faltan: this.cola.lista.length };
  }

  // Un lote: la pantalla lo llama repetidamente hasta que no queden pendientes.
  // En dos etapas, porque las dos mitades del trabajo tienen límites distintos:
  //   1) preguntarle al catálogo, de a pocas y al ritmo del plan: un código nunca
  //      consultado tarda unos 9 s (el catálogo lo resuelve en el momento; después
  //      queda cacheado y vuelve en 0,2 s). De a ocho tardan 28 s cada una y se cortan.
  //   2) bajar la imagen y subirla a Storage, de a varias: eso va contra otros
  //      servidores, no contra la API con tope, y es la parte lenta (unos 7 s).
  async completar(limite = 30) {
    const { lote, faltan } = await this.proximos(Math.max(1, Math.min(Number(limite) || 30, 200)));
    const res = { procesados: 0, conFoto: 0, sinProducto: 0, sinImagen: 0, dudosas: 0, errores: 0, restantes: faltan, parado: null as string | null, detalle: [] as any[] };
    const frenar = (e: unknown) => /clave|401|403|límite|429|Falta/i.test(e instanceof Error ? e.message : String(e)); // sin clave o sin cupo: no tiene sentido seguir
    const anotar = (c: { sku: string; codigo: string }, r: Resultado) => {
      res.procesados++;
      if (r.resultado === 'foto') res.conFoto++; else if (r.resultado === 'sin_producto') res.sinProducto++; else if (r.resultado === 'sin_imagen') res.sinImagen++; else if (r.resultado === 'dudoso') res.dudosas++; else res.errores++;
      if (res.detalle.length < 30) res.detalle.push({ sku: c.sku, ean: c.codigo, resultado: r.resultado, nombre: r.nombreExterno ?? null });
    };

    // 1) consultas al catálogo, de a una
    const conFoto: { c: (typeof lote)[number]; p: Externo }[] = [];
    const consultas = await recorrerConRitmo(
      lote,
      { paralelo: PARALELO_CONSULTA, espaciadoMs: Math.ceil(60_000 / POR_MINUTO) },
      async (c) => {
        const q = await this.consultar(c.codigo);
        if (q.estado === 'sin_producto') { await this.registrar(c.producto_id, c.sku, c.codigo, 'sin_producto'); anotar(c, { resultado: 'sin_producto' }); return; }
        const p = q.producto!;
        if (!p.imagenUrl) { await this.registrar(c.producto_id, c.sku, c.codigo, 'sin_imagen', p); anotar(c, { resultado: 'sin_imagen', nombreExterno: p.nombre }); return; }
        conFoto.push({ c, p });
      },
      frenar,
    );
    res.parado = consultas.motivoParada;
    res.errores += consultas.errores.length;

    // 2) descarga y guardado, de a varias
    const guardadas = await recorrerConRitmo(conFoto, { paralelo: PARALELO, espaciadoMs: 0 }, async ({ c, p }) => {
      anotar(c, await this.guardarFoto(c.producto_id, c.sku, c.codigo, p, c.nombre));
    });
    res.errores += guardadas.errores.length;

    if (res.procesados) this.log.log(`EZ Catalog: ${res.conFoto} fotos de ${res.procesados} consultas (${res.restantes} pendientes)`);
    return res;
  }

  // Repasar con la regla de parecido las fotos YA guardadas (las que entraron
  // antes de que existiera el control). Las que no dan, salen de Storage y
  // quedan como dudosas para que una persona decida.
  async revisarGuardadas() {
    const { data, error } = await this.db
      .from('fotos_externas').select('id, sku, ean, nombre_externo, marca_externa, producto:productos(nombre)')
      .eq('resultado', 'foto').limit(5000);
    if (error) throw new BadRequestException(error.message);
    const sacadas: { sku: string; nuestro: string; externo: string | null; motivo: string }[] = [];
    for (const d of (data ?? []) as any[]) {
      const v = pareceElMismoProducto(d.producto?.nombre, d.nombre_externo, d.marca_externa);
      if (v.parecido) continue;
      await this.db.storage.from('productos').remove([`${d.sku}.jpg`]);
      await this.catalogo.marcarFoto(d.sku, false);
      await this.db.from('fotos_externas').update({ resultado: 'dudoso', detalle: v.motivo }).eq('id', d.id);
      sacadas.push({ sku: d.sku, nuestro: d.producto?.nombre ?? d.sku, externo: d.nombre_externo, motivo: v.motivo });
    }
    if (sacadas.length) { this.cola = null; this.catalogo.invalidarFotos(); this.log.warn(`EZ Catalog: ${sacadas.length} fotos sacadas por no coincidir con el producto`); }
    return { revisadas: (data ?? []).length, sacadas: sacadas.length, detalle: sacadas.slice(0, 50) };
  }

  sincronizarMarca() { return this.catalogo.sincronizarTieneFoto(); }

  // Las que el catálogo devolvió con otro nombre: esperan que alguien las mire.
  async dudosas() {
    const { data, error } = await this.db
      .from('fotos_externas')
      .select('id, sku, ean, nombre_externo, marca_externa, url_externa, detalle, creado_en, producto:productos(nombre)')
      .eq('resultado', 'dudoso')
      .order('creado_en', { ascending: true }) // se revisan en el orden en que aparecieron
      .limit(500);
    if (error) throw new BadRequestException(error.message);
    return (data ?? []).map((d: any) => ({
      id: d.id, sku: d.sku, ean: d.ean,
      nuestro: d.producto?.nombre ?? d.sku,
      externo: d.nombre_externo, marca: d.marca_externa, urlExterna: d.url_externa,
      motivo: d.detalle, creadoEn: d.creado_en,
    }));
  }

  // Aceptar = bajar esa foto y guardarla; descartar = dejarla anotada para no volver a pedirla.
  async resolverDudosa(id: string, aceptar: boolean) {
    const { data: d, error } = await this.db.from('fotos_externas').select('id, producto_id, sku, ean, nombre_externo, marca_externa, url_externa, resultado').eq('id', id).maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!d) throw new BadRequestException('Ese pendiente ya no existe');
    if ((d as any).resultado !== 'dudoso') throw new BadRequestException('Ese pendiente ya fue resuelto');
    if (!aceptar) {
      await this.db.from('fotos_externas').update({ resultado: 'descartada', detalle: 'no es este producto (revisado a mano)' }).eq('id', id);
      return { ok: true, resultado: 'descartada' };
    }
    const p: Externo = { nombre: (d as any).nombre_externo, marca: (d as any).marca_externa, imagenUrl: (d as any).url_externa, presentacion: null, verificado: false };
    const r = await this.guardarFotoSinControl((d as any).producto_id, (d as any).sku, (d as any).ean, p);
    if (r.resultado === 'foto') await this.db.from('fotos_externas').delete().eq('id', id); // ya quedó el registro nuevo con resultado 'foto'
    return { ok: r.resultado === 'foto', resultado: r.resultado, detalle: r.detalle ?? null, imagenUrl: r.imagenUrl ?? null };
  }

  // Para un producto puntual (desde la ficha), aunque ya se haya consultado antes.
  async paraSku(sku: string) {
    const { data: p } = await this.db.from('productos').select('id, sku, nombre, codigos:codigos_barras(codigo)').eq('sku', sku).maybeSingle();
    if (!p) throw new BadRequestException('Producto inexistente');
    const codigos = ((p as any).codigos ?? []).map((c: any) => String(c.codigo)).filter((c: string) => /^[0-9]{8,14}$/.test(c));
    if (!codigos.length) throw new BadRequestException('Este producto no tiene código de barras cargado: vinculalo primero desde la caja o la ficha');
    let ultimo: Resultado = { resultado: 'sin_producto' };
    for (const ean of codigos) {
      ultimo = await this.traerPara(p.id, p.sku, ean, (p as any).nombre ?? '');
      if (ultimo.resultado === 'foto') break;
    }
    return { sku: p.sku, nombre: (p as any).nombre, ...ultimo };
  }

  private registrar(productoId: string, sku: string, ean: string, resultado: Resultado['resultado'], p?: Externo | null, detalle?: string) {
    return this.db.from('fotos_externas').insert({ producto_id: productoId, sku, ean, resultado, nombre_externo: p?.nombre ?? null, marca_externa: p?.marca ?? null, url_externa: p?.imagenUrl ?? null, detalle: detalle ?? null }).then(() => null, () => null);
  }

  private async traerPara(productoId: string, sku: string, ean: string, nombreNuestro: string): Promise<Resultado> {
    const registrar = (resultado: Resultado['resultado'], p?: Externo | null, detalle?: string) => this.registrar(productoId, sku, ean, resultado, p, detalle);
    let consulta: { estado: 'ok' | 'sin_producto'; producto?: Externo };
    // Un corte por tiempo de espera o de red NO se registra: si quedara como
    // 'error' el producto no se volvería a consultar por 30 días por una caída
    // pasajera. Sin registro, la próxima tanda lo toma de nuevo.
    try { consulta = await this.consultar(ean); }
    catch (e) { const msg = e instanceof Error ? e.message : String(e); if (!PASAJERO.test(msg)) await registrar('error', null, msg); throw e; }
    if (consulta.estado === 'sin_producto') { await registrar('sin_producto'); return { resultado: 'sin_producto' }; }
    const p = consulta.producto!;
    if (!p.imagenUrl) { await registrar('sin_imagen', p); return { resultado: 'sin_imagen', nombreExterno: p.nombre, marcaExterna: p.marca }; }
    return this.guardarFoto(productoId, sku, ean, p, nombreNuestro);
  }

  // Bajar la imagen y guardarla en Storage. Va contra images.huggian.com y
  // Supabase (no contra la API con tope), así que esto sí se puede hacer de a varias.
  private async guardarFoto(productoId: string, sku: string, ean: string, p: Externo, nombreNuestro: string): Promise<Resultado> {
    const registrar = (resultado: Resultado['resultado'], q?: Externo | null, detalle?: string) => this.registrar(productoId, sku, ean, resultado, q, detalle);
    // El catálogo a veces devuelve la ficha de otro producto con NUESTRO código
    // (a un vino, pintura; a una sal, creatina). Si el nombre no se parece en
    // nada, la foto no se guarda sola: queda para que una persona la mire.
    const v = pareceElMismoProducto(nombreNuestro, p.nombre, p.marca);
    if (!v.parecido) {
      await registrar('dudoso', p, v.motivo);
      return { resultado: 'dudoso', nombreExterno: p.nombre, marcaExterna: p.marca, detalle: v.motivo };
    }
    return this.guardarFotoSinControl(productoId, sku, ean, p);
  }

  private async guardarFotoSinControl(productoId: string, sku: string, ean: string, p: Externo): Promise<Resultado> {
    const registrar = (resultado: Resultado['resultado'], q?: Externo | null, detalle?: string) => this.registrar(productoId, sku, ean, resultado, q, detalle);
    try {
      const ctrl = new AbortController(); const reloj = setTimeout(() => ctrl.abort(), 25_000);
      const img = await fetch(p.imagenUrl ?? '', { signal: ctrl.signal }).finally(() => clearTimeout(reloj));
      if (!img.ok) throw new Error(`la imagen respondió ${img.status}`);
      const buf = Buffer.from(await img.arrayBuffer());
      if (buf.length < 500) throw new Error('la imagen llegó vacía');
      const tipo = img.headers.get('content-type') ?? 'image/jpeg';
      const { error } = await this.db.storage.from('productos').upload(`${sku}.jpg`, buf, { contentType: tipo.startsWith('image/') ? tipo : 'image/jpeg', upsert: true });
      if (error) throw new Error(error.message);
      this.catalogo.invalidarFotos();
      await this.catalogo.marcarFoto(sku, true);
      await registrar('foto', p);
      return { resultado: 'foto', imagenUrl: this.urlImagen(sku), nombreExterno: p.nombre, marcaExterna: p.marca };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await registrar('error', p, msg);
      return { resultado: 'error', nombreExterno: p.nombre, detalle: msg };
    }
  }
}
