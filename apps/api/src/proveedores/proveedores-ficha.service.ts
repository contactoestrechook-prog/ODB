import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import sharp from 'sharp';
import { SUPABASE } from '../supabase.provider';
import { PedidosProveedorService } from '../pedidos-proveedor/pedidos-proveedor.service';
import {
  CONDICIONES_IVA, ROLES_CONTACTO, TIPOS_DOCUMENTO,
  aliasValido, cbuValido, cuitNormalizado, emailValido, faltantes, telefonoValido,
} from './ficha';

// Ficha de proveedores para administración (27/10/2026): todos los datos del
// proveedor, sus contactos y sus papeles (catálogos, listas, constancia de
// CUIT…) en un solo lugar. El WhatsApp se carga verificando que exista, con la
// misma función que usa «Por llegar»: es el número al que sale el pedido.

const COLUMNAS = 'id, razon_social, nombre_fantasia, cuit, condicion_iva, direccion, localidad, telefono, telefono_fijo, email, web, '
  + 'condicion_pago, lead_time_dias, lead_time_confirmado, descuento_efectivo, dias_pedido, dias_entrega, pedido_minimo, '
  + 'banco, cbu, alias_cbu, notas, logo_url, logo_auto, activo, actualizado_en';

const BUCKET = 'comprobantes';

type Dto = Record<string, unknown>;

/** Un texto opcional: vacío → null, y con tope de largo. */
function texto(v: unknown, max = 300): string | null {
  const s = String(v ?? '').trim();
  return s ? s.slice(0, max) : null;
}

@Injectable()
export class ProveedoresFichaService {
  constructor(
    @Inject(SUPABASE) private readonly db: SupabaseClient,
    private readonly pedidos: PedidosProveedorService,
  ) {}

  private async auditar(usuarioId: string | null | undefined, accion: string, id: string, antes: unknown, despues: unknown) {
    await this.db.from('auditoria').insert({ usuario_id: usuarioId ?? null, accion, entidad: 'proveedores', entidad_id: id,
      datos_antes: antes ?? null, datos_despues: despues ?? null }).then(() => null, () => null);
  }

  /** La lista de la pantalla: todos los proveedores con lo que les falta y su actividad. */
  async lista() {
    const [prov, res] = await Promise.all([
      this.db.from('proveedores').select(COLUMNAS).order('razon_social').range(0, 4999),
      this.db.rpc('proveedores_resumen'),
    ]);
    if (prov.error) throw new BadRequestException(prov.error.message);
    if (res.error) throw new BadRequestException(res.error.message);
    const resumen = new Map(((res.data ?? []) as any[]).map((r) => [r.proveedor_id, r]));
    return ((prov.data ?? []) as any[]).map((p) => {
      const r = resumen.get(p.id) ?? {};
      return {
        id: p.id, razonSocial: p.razon_social, nombreFantasia: p.nombre_fantasia, cuit: p.cuit, telefono: p.telefono,
        localidad: p.localidad, activo: p.activo, logo: p.logo_url ?? null, logoAuto: p.logo_auto === true,
        productos: Number(r.productos ?? 0), ultimaActividad: r.ultima_actividad ?? null, deuda: Number(r.deuda ?? 0),
        documentos: Number(r.documentos ?? 0), contactos: Number(r.contactos ?? 0),
        faltan: faltantes(p),
      };
    });
  }

  /** La ficha completa de un proveedor. */
  async ficha(id: string) {
    const { data: p, error } = await this.db.from('proveedores').select(COLUMNAS).eq('id', id).maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!p) throw new NotFoundException('No existe el proveedor');
    const [contactos, documentos, ordenes, facturas, productos, listas] = await Promise.all([
      this.db.from('proveedor_contactos').select('id, nombre, rol, telefono, email, notas, creado_en').eq('proveedor_id', id).order('creado_en'),
      this.db.from('proveedor_documentos').select('id, tipo, nombre, tipo_archivo, tamano, vigencia_hasta, creado_en, subidor:usuarios!proveedor_documentos_subido_por_fkey(nombre)')
        .eq('proveedor_id', id).is('borrado_en', null).order('creado_en', { ascending: false }),
      this.db.from('ordenes_compra').select('id, numero, estado, total, creado_en').eq('proveedor_id', id).order('creado_en', { ascending: false }).limit(5),
      this.db.from('facturas_proveedor').select('id, numero, letra, tipo, monto, monto_pagado, vencimiento, estado, creado_en')
        .eq('proveedor_id', id).neq('estado', 'pagada').order('vencimiento', { ascending: true }).limit(20),
      this.db.from('proveedor_productos').select('producto_id', { count: 'exact', head: true }).eq('proveedor_id', id),
      this.db.from('listas_proveedor').select('id, archivo, vigencia, items_total, items_match, creado_en').eq('proveedor_id', id).order('creado_en', { ascending: false }).limit(3),
    ]);
    const deuda = ((facturas.data ?? []) as any[]).reduce((s, f) => s + Number(f.monto) - Number(f.monto_pagado ?? 0), 0);
    return {
      proveedor: { ...(p as any), faltan: faltantes(p as any) },
      contactos: contactos.data ?? [],
      documentos: ((documentos.data ?? []) as any[]).map((d) => ({ ...d, subidoPor: d.subidor?.nombre ?? null, subidor: undefined })),
      ordenes: ordenes.data ?? [],
      facturasPendientes: facturas.data ?? [],
      deuda: Math.round(deuda * 100) / 100,
      productos: productos.count ?? 0,
      listas: listas.data ?? [],
    };
  }

  /** Valida y traduce lo que manda la pantalla a columnas. Solo lo que vino. */
  private columnas(dto: Dto): Record<string, unknown> {
    const c: Record<string, unknown> = {};
    const tiene = (k: string) => Object.prototype.hasOwnProperty.call(dto, k);
    if (tiene('razonSocial')) {
      const r = texto(dto.razonSocial, 160);
      if (!r) throw new BadRequestException('La razón social no puede quedar vacía');
      c.razon_social = r;
    }
    if (tiene('nombreFantasia')) c.nombre_fantasia = texto(dto.nombreFantasia, 160);
    if (tiene('cuit')) {
      if (texto(dto.cuit)) {
        const cuit = cuitNormalizado(dto.cuit);
        if (!cuit) throw new BadRequestException('El CUIT no es válido: revisá los 11 números (el último es el dígito verificador)');
        c.cuit = cuit;
      } else c.cuit = null;
    }
    if (tiene('condicionIva')) {
      const v = texto(dto.condicionIva);
      if (v && !(CONDICIONES_IVA as readonly string[]).includes(v)) throw new BadRequestException('Condición de IVA desconocida');
      c.condicion_iva = v;
    }
    if (tiene('direccion')) c.direccion = texto(dto.direccion, 200);
    if (tiene('localidad')) c.localidad = texto(dto.localidad, 100);
    if (tiene('telefonoFijo')) {
      if (texto(dto.telefonoFijo)) {
        const t = telefonoValido(dto.telefonoFijo);
        if (!t) throw new BadRequestException('El teléfono fijo necesita el código de área (por ejemplo 011 4234-5678)');
        c.telefono_fijo = t;
      } else c.telefono_fijo = null;
    }
    if (tiene('email')) {
      if (texto(dto.email)) {
        const e = emailValido(dto.email);
        if (!e) throw new BadRequestException('El mail no es válido');
        c.email = e;
      } else c.email = null;
    }
    if (tiene('web')) c.web = texto(dto.web, 200);
    if (tiene('condicionPago')) c.condicion_pago = texto(dto.condicionPago, 100);
    if (tiene('leadTimeDias')) {
      const n = Number(dto.leadTimeDias);
      if (!Number.isInteger(n) || n < 0 || n > 120) throw new BadRequestException('El plazo de entrega va en días, de 0 a 120');
      c.lead_time_dias = n;
    }
    if (tiene('leadTimeConfirmado')) c.lead_time_confirmado = dto.leadTimeConfirmado === true;
    if (tiene('descuentoEfectivo')) {
      const n = Number(dto.descuentoEfectivo || 0);
      if (!Number.isFinite(n) || n < 0 || n > 50) throw new BadRequestException('El descuento por efectivo va de 0 a 50 %');
      c.descuento_efectivo = n;
    }
    if (tiene('diasPedido')) c.dias_pedido = texto(dto.diasPedido, 100);
    if (tiene('diasEntrega')) c.dias_entrega = texto(dto.diasEntrega, 100);
    if (tiene('pedidoMinimo')) {
      if (dto.pedidoMinimo === '' || dto.pedidoMinimo == null) c.pedido_minimo = null;
      else {
        const n = Number(dto.pedidoMinimo);
        if (!Number.isFinite(n) || n < 0) throw new BadRequestException('El pedido mínimo es un monto en pesos');
        c.pedido_minimo = n;
      }
    }
    if (tiene('banco')) c.banco = texto(dto.banco, 100);
    if (tiene('cbu')) {
      if (texto(dto.cbu)) {
        const v = cbuValido(dto.cbu);
        if (!v) throw new BadRequestException('El CBU no es válido: son 22 números y los verificadores no dan');
        c.cbu = v;
      } else c.cbu = null;
    }
    if (tiene('aliasCbu')) {
      if (texto(dto.aliasCbu)) {
        const v = aliasValido(dto.aliasCbu);
        if (!v) throw new BadRequestException('El alias va de 6 a 20 caracteres: letras, números, punto o guion');
        c.alias_cbu = v;
      } else c.alias_cbu = null;
    }
    if (tiene('notas')) c.notas = texto(dto.notas, 2000);
    return c;
  }

  private async cuitRepetido(cuit: unknown, excepto?: string) {
    if (!cuit) return;
    const { data } = await this.db.from('proveedores').select('id, razon_social, cuit').not('cuit', 'is', null).range(0, 4999);
    const otro = ((data ?? []) as any[]).find((p) => p.id !== excepto && String(p.cuit).replace(/\D/g, '') === cuit);
    if (otro) throw new BadRequestException(`Ese CUIT ya es de «${otro.razon_social}». Si es el mismo proveedor, completá esa ficha.`);
  }

  /** WhatsApp: verificado contra WhatsApp (el pedido sale a ese número). Vacío lo borra. */
  private async whatsapp(id: string, telefono: unknown, usuarioId?: string | null) {
    if (!texto(telefono)) {
      await this.db.from('proveedores').update({ telefono: null }).eq('id', id);
      return;
    }
    await this.pedidos.cargarWhatsapp(id, String(telefono), usuarioId);
  }

  async crear(dto: Dto, usuarioId?: string | null) {
    const c = this.columnas({ ...dto, razonSocial: dto.razonSocial ?? '' });
    await this.cuitRepetido(c.cuit);
    const { data: mismo } = await this.db.from('proveedores').select('id, razon_social').ilike('razon_social', String(c.razon_social).replace(/[%_\\]/g, '\\$&')).limit(1);
    if ((mismo ?? []).length) throw new BadRequestException(`Ya existe «${(mismo as any[])[0].razon_social}». Buscalo en la lista y completá esa ficha.`);
    const { data, error } = await this.db.from('proveedores')
      .insert({ lead_time_dias: 7, ...c, actualizado_en: new Date().toISOString(), actualizado_por: usuarioId ?? null })
      .select('id').single();
    if (error) throw new BadRequestException(error.code === '23505' ? 'Ya existe un proveedor con ese CUIT' : error.message);
    if (texto(dto.telefono)) await this.whatsapp(data.id, dto.telefono, usuarioId);
    await this.auditar(usuarioId, 'proveedor_alta', data.id, null, c);
    return { id: data.id };
  }

  async guardar(id: string, dto: Dto, usuarioId?: string | null) {
    const { data: antes } = await this.db.from('proveedores').select(COLUMNAS).eq('id', id).maybeSingle();
    if (!antes) throw new NotFoundException('No existe el proveedor');
    const c = this.columnas(dto);
    if (c.cuit && c.cuit !== String((antes as any).cuit ?? '').replace(/\D/g, '')) await this.cuitRepetido(c.cuit, id);
    // el WhatsApp va primero: si no existe, no se guarda nada a medias
    if (Object.prototype.hasOwnProperty.call(dto, 'telefono')) {
      const nuevo = String(dto.telefono ?? '').replace(/\D/g, '');
      const viejo = String((antes as any).telefono ?? '').replace(/\D/g, '');
      if (nuevo !== viejo) await this.whatsapp(id, dto.telefono, usuarioId);
    }
    if (Object.keys(c).length) {
      const { error } = await this.db.from('proveedores')
        .update({ ...c, actualizado_en: new Date().toISOString(), actualizado_por: usuarioId ?? null }).eq('id', id);
      if (error) throw new BadRequestException(error.message);
      const previo = Object.fromEntries(Object.keys(c).map((k) => [k, (antes as any)[k] ?? null]));
      await this.auditar(usuarioId, 'proveedor_ficha', id, previo, c);
    }
    return this.ficha(id);
  }

  async activo(id: string, activo: boolean, usuarioId?: string | null) {
    const { error } = await this.db.from('proveedores').update({ activo: activo === true, actualizado_en: new Date().toISOString(), actualizado_por: usuarioId ?? null }).eq('id', id);
    if (error) throw new BadRequestException(error.message);
    await this.auditar(usuarioId, activo ? 'proveedor_reactivado' : 'proveedor_baja', id, null, { activo });
    return { ok: true };
  }

  // ---------- logo ----------

  /** Deja el logo cuadrado de 256 px (sin deformar, fondo transparente) y lo publica. */
  private async publicarLogo(proveedorId: string, imagen: Buffer, usuarioId?: string | null, origen = 'subido', auto = false) {
    let png: Buffer;
    try {
      const img = sharp(imagen, { failOn: 'none' });
      const meta = await img.metadata();
      if (!meta.width || !meta.height) throw new Error('sin medidas');
      png = await img.resize(256, 256, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
    } catch {
      throw new BadRequestException('Ese archivo no es una imagen que se pueda usar como logo');
    }
    const ruta = `proveedores/logos/${proveedorId}-${randomUUID().slice(0, 6)}.png`;
    const { error } = await this.db.storage.from('publico').upload(ruta, png, { contentType: 'image/png', upsert: true });
    if (error) throw new BadRequestException(`No pude guardar el logo: ${error.message}`);
    const url = this.db.storage.from('publico').getPublicUrl(ruta).data.publicUrl;
    const { data: antes } = await this.db.from('proveedores').select('logo_url').eq('id', proveedorId).maybeSingle();
    await this.db.from('proveedores').update({ logo_url: url, logo_auto: auto, actualizado_en: new Date().toISOString(), actualizado_por: usuarioId ?? null }).eq('id', proveedorId);
    await this.auditar(usuarioId, 'proveedor_logo', proveedorId, { logo_url: (antes as any)?.logo_url ?? null }, { logo_url: url, origen });
    return { logo: url };
  }

  async subirLogo(proveedorId: string, archivo: Express.Multer.File, usuarioId?: string | null) {
    if (!archivo) throw new BadRequestException('Elegí la imagen del logo');
    return this.publicarLogo(proveedorId, archivo.buffer, usuarioId);
  }

  /**
   * Trae el logo de la web del proveedor: primero los íconos que declara la
   * portada (del más grande al más chico), después el apple-touch-icon y por
   * último el que tiene indexado Google. Un ícono chico o
   * genérico no sirve: se rechaza.
   */
  async logoDesdeWeb(proveedorId: string, usuarioId?: string | null, auto = false) {
    const { data: p } = await this.db.from('proveedores').select('web').eq('id', proveedorId).maybeSingle();
    const dominio = dominioDe((p as any)?.web);
    if (!dominio) throw new BadRequestException('Cargá primero la web del proveedor (por ejemplo arcor.com) y guardá');
    const candidatos = [
      ...(await iconosDeLaPortada(dominio)),
      `https://${dominio}/apple-touch-icon.png`,
      `https://www.${dominio.replace(/^www\./, '')}/apple-touch-icon.png`,
      `https://www.google.com/s2/favicons?domain=${encodeURIComponent(dominio)}&sz=256`,
    ];
    for (const url of candidatos) {
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout(8000), redirect: 'follow' });
        if (!r.ok || !/^image\//.test(r.headers.get('content-type') ?? '')) continue;
        const buf = Buffer.from(await r.arrayBuffer());
        const meta = await sharp(buf, { failOn: 'none' }).metadata();
        if ((meta.width ?? 0) < 96) continue; // el globito genérico de 16 px no es un logo
        return await this.publicarLogo(proveedorId, buf, usuarioId, url, auto);
      } catch { /* probar el siguiente */ }
    }
    throw new BadRequestException(`No encontré un logo usable en ${dominio}. Bajalo de su web o de una foto y subilo a mano.`);
  }

  async sacarLogo(proveedorId: string, usuarioId?: string | null) {
    await this.db.from('proveedores').update({ logo_url: null, logo_auto: false }).eq('id', proveedorId);
    await this.auditar(usuarioId, 'proveedor_logo', proveedorId, null, { logo_url: null });
    return { ok: true };
  }

  // ---------- contactos ----------

  private contacto(dto: Dto) {
    const nombre = texto(dto.nombre, 120);
    if (!nombre) throw new BadRequestException('Poné el nombre del contacto');
    const rol = texto(dto.rol) ?? 'vendedor';
    if (!(ROLES_CONTACTO as readonly string[]).includes(rol)) throw new BadRequestException('Rol de contacto desconocido');
    const tel = texto(dto.telefono);
    if (tel && !telefonoValido(tel)) throw new BadRequestException('El teléfono necesita el código de área');
    const mail = texto(dto.email);
    if (mail && !emailValido(mail)) throw new BadRequestException('El mail no es válido');
    if (!tel && !mail) throw new BadRequestException('Poné al menos un teléfono o un mail del contacto');
    return { nombre, rol, telefono: tel, email: mail ? emailValido(mail) : null, notas: texto(dto.notas, 500) };
  }

  async agregarContacto(proveedorId: string, dto: Dto, usuarioId?: string | null) {
    const fila = this.contacto(dto);
    const { error } = await this.db.from('proveedor_contactos').insert({ proveedor_id: proveedorId, ...fila, creado_por: usuarioId ?? null });
    if (error) throw new BadRequestException(error.message);
    return { ok: true };
  }

  async editarContacto(contactoId: string, dto: Dto) {
    const { error } = await this.db.from('proveedor_contactos').update(this.contacto(dto)).eq('id', contactoId);
    if (error) throw new BadRequestException(error.message);
    return { ok: true };
  }

  async borrarContacto(contactoId: string, usuarioId?: string | null) {
    const { data } = await this.db.from('proveedor_contactos').delete().eq('id', contactoId).select('*').maybeSingle();
    if (data) await this.auditar(usuarioId, 'proveedor_contacto_borrado', (data as any).proveedor_id, data, null);
    return { ok: true };
  }

  // ---------- documentos ----------

  async subirDocumento(proveedorId: string, archivo: Express.Multer.File, dto: Dto, usuarioId?: string | null) {
    if (!archivo) throw new BadRequestException('Elegí el archivo (PDF o imagen, hasta 25 MB)');
    const tipo = texto(dto.tipo) ?? 'catalogo';
    if (!(TIPOS_DOCUMENTO as readonly string[]).includes(tipo)) throw new BadRequestException('Tipo de documento desconocido');
    const vigencia = texto(dto.vigenciaHasta);
    if (vigencia && !/^\d{4}-\d{2}-\d{2}$/.test(vigencia)) throw new BadRequestException('La vigencia es una fecha');
    const { data: p } = await this.db.from('proveedores').select('id').eq('id', proveedorId).maybeSingle();
    if (!p) throw new NotFoundException('No existe el proveedor');
    // el nombre original llega en latin1 desde multer
    const original = Buffer.from(archivo.originalname ?? 'archivo', 'latin1').toString('utf8');
    const ext = archivo.mimetype === 'application/pdf' ? 'pdf' : (original.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
    const ruta = `proveedores/${proveedorId}/${tipo}-${randomUUID().slice(0, 8)}.${ext}`;
    const { error: e1 } = await this.db.storage.from(BUCKET).upload(ruta, archivo.buffer, { contentType: archivo.mimetype, upsert: false });
    if (e1) throw new BadRequestException(`No pude guardar el archivo: ${e1.message}`);
    const nombre = texto(dto.nombre, 160) ?? original.replace(/\.[^.]+$/, '').slice(0, 160);
    const { data, error } = await this.db.from('proveedor_documentos').insert({
      proveedor_id: proveedorId, tipo, nombre, ruta, tipo_archivo: archivo.mimetype, tamano: archivo.size,
      vigencia_hasta: vigencia, subido_por: usuarioId ?? null,
    }).select('id').single();
    if (error) {
      await this.db.storage.from(BUCKET).remove([ruta]).then(() => null, () => null);
      throw new BadRequestException(error.message);
    }
    return { id: data.id };
  }

  async enlaceDocumento(documentoId: string) {
    const { data: d } = await this.db.from('proveedor_documentos').select('ruta, borrado_en').eq('id', documentoId).maybeSingle();
    if (!d || (d as any).borrado_en) throw new NotFoundException('No existe el documento');
    const { data, error } = await this.db.storage.from(BUCKET).createSignedUrl((d as any).ruta, 3600);
    if (error || !data?.signedUrl) throw new BadRequestException('No pude abrir el archivo');
    return { url: data.signedUrl };
  }

  /** Borrado lógico: el archivo queda guardado y se sabe quién lo sacó. */
  async borrarDocumento(documentoId: string, usuarioId?: string | null) {
    const { data, error } = await this.db.from('proveedor_documentos')
      .update({ borrado_en: new Date().toISOString(), borrado_por: usuarioId ?? null })
      .eq('id', documentoId).is('borrado_en', null).select('proveedor_id, nombre, tipo').maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (data) await this.auditar(usuarioId, 'proveedor_documento_borrado', (data as any).proveedor_id, data, null);
    return { ok: true };
  }
}

/** «https://www.arcor.com/ar/» → «www.arcor.com» */
export function dominioDe(web: unknown): string | null {
  const s = String(web ?? '').trim().toLowerCase();
  if (!s) return null;
  try {
    const u = new URL(/^https?:\/\//.test(s) ? s : `https://${s}`);
    return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(u.hostname) ? u.hostname : null;
  } catch { return null; }
}

/** Los íconos que declara la portada (<link rel="icon" | "apple-touch-icon">), del más grande al más chico. */
async function iconosDeLaPortada(dominio: string): Promise<string[]> {
  try {
    const r = await fetch(`https://${dominio}/`, { signal: AbortSignal.timeout(8000), redirect: 'follow' });
    if (!r.ok) return [];
    return iconosDelHtml(await r.text(), r.url || `https://${dominio}/`);
  } catch { return []; }
}

export function iconosDelHtml(html: string, base: string): string[] {
  const iconos: { url: string; tam: number }[] = [];
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = /\brel\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase() ?? '';
    if (!/\b(apple-touch-icon|icon)\b/.test(rel)) continue;
    const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    if (!href || href.startsWith('data:')) continue;
    const tam = Number(/\bsizes\s*=\s*["'](\d+)x\d+/i.exec(tag)?.[1] ?? (rel.includes('apple') ? 180 : 32));
    try { iconos.push({ url: new URL(href, base).toString(), tam }); } catch { /* href roto */ }
  }
  return iconos.sort((a, b) => b.tam - a.tam).map((i) => i.url);
}
