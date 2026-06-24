import { SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

// Toolkit del Agente IA Operativo. Cada herramienta = un JSON schema (lo que ve Claude)
// + una función real contra la base. ejecutarHerramienta() corre la acción y devuelve
// el resultado; las acciones se auditan en el servicio.

const SUC_CENTRAL = '229906e6-df69-48eb-b027-2b57fefb89fe';
const LISTA_MINORISTA = 'f0f17a57-e55e-40a3-881d-41afeba7cb73';
const norm = (s: string) => (s || '').toString().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

// pura y testeable: arma el prompt para generar la foto faltante
export function promptImagen(nombre: string) {
  return `Foto de producto profesional para e-commerce premium de "${nombre}": packaging real, fondo blanco puro, luz de estudio, alta resolución, sin texto sobreimpreso.`;
}

export const HERRAMIENTAS_SCHEMAS = [
  {
    name: 'create_product',
    description: 'Crea un producto nuevo en el catálogo. Validá duplicados antes. Usalo cuando llega un producto que no existe.',
    input_schema: {
      type: 'object',
      properties: {
        nombre: { type: 'string' },
        sku: { type: 'string', description: 'opcional; si falta se genera' },
        categoria: { type: 'string', description: 'rubro/categoría' },
        costo: { type: 'number' },
        precio: { type: 'number', description: 'precio de venta final' },
      },
      required: ['nombre'],
    },
  },
  {
    name: 'update_stock',
    description: 'Ajusta el stock de un SKU (cantidad es el delta: positivo suma, negativo resta).',
    input_schema: {
      type: 'object',
      properties: { sku: { type: 'string' }, cantidad: { type: 'number' }, motivo: { type: 'string' } },
      required: ['sku', 'cantidad'],
    },
  },
  {
    name: 'enrich_metadata',
    description: 'Mejora los datos de un producto existente (descripción, categoría, si es alcohol).',
    input_schema: {
      type: 'object',
      properties: { sku: { type: 'string' }, descripcion: { type: 'string' }, categoria: { type: 'string' }, es_alcohol: { type: 'boolean' } },
      required: ['sku'],
    },
  },
  {
    name: 'generate_image_prompt',
    description: 'Genera el prompt para crear la imagen faltante de un producto.',
    input_schema: { type: 'object', properties: { sku: { type: 'string' } }, required: ['sku'] },
  },
  {
    name: 'notify_admin',
    description: 'Notifica algo al equipo/dueño (queda en la auditoría).',
    input_schema: { type: 'object', properties: { titulo: { type: 'string' }, mensaje: { type: 'string' } }, required: ['titulo'] },
  },
  {
    name: 'schedule_publication',
    description: 'Publica (activa) un producto en el sitio.',
    input_schema: { type: 'object', properties: { sku: { type: 'string' } }, required: ['sku'] },
  },
  {
    name: 'request_human_review',
    description: 'Escalá a un humano cuando haya ambigüedad, datos faltantes, alto impacto o confianza < 0.85.',
    input_schema: { type: 'object', properties: { motivo: { type: 'string' }, sku: { type: 'string' } }, required: ['motivo'] },
  },
];

async function categoriaId(db: SupabaseClient, nombre?: string): Promise<string | null> {
  if (!nombre) return null;
  const { data } = await db.from('categorias').select('id,nombre');
  const m = (data || []).find((c: any) => norm(c.nombre) === norm(nombre));
  return m?.id ?? null;
}
async function productoIdPorSku(db: SupabaseClient, sku: string): Promise<string | null> {
  const { data } = await db.from('productos').select('id,nombre').eq('sku', sku).maybeSingle();
  return data?.id ?? null;
}

// Devuelve { ok, resultado, escalar? }. No tira: los errores vuelven en resultado.error.
export async function ejecutarHerramienta(db: SupabaseClient, nombre: string, args: any): Promise<{ ok: boolean; resultado: any; escalar?: boolean }> {
  try {
    switch (nombre) {
      case 'create_product': {
        if (!args?.nombre?.trim()) return { ok: false, resultado: { error: 'falta nombre' } };
        const { data: dup } = await db.from('productos').select('id,sku').ilike('nombre', args.nombre.trim()).maybeSingle();
        if (dup) return { ok: true, resultado: { duplicado: true, producto_id: dup.id, sku: dup.sku } };
        const sku = (args.sku?.trim()) || 'AG-' + randomUUID().slice(0, 8).toUpperCase();
        const { data, error } = await db.from('productos').insert({
          sku, nombre: args.nombre.trim(), categoria_id: await categoriaId(db, args.categoria),
          costo: Number(args.costo) || 0, es_alcohol: false, unidades_pack: 1, alicuota_iva: 21, activo: true,
        }).select('id,sku').single();
        if (error) return { ok: false, resultado: { error: error.message } };
        if (Number(args.precio) > 0) await db.from('precios').insert({ producto_id: data.id, lista_id: LISTA_MINORISTA, precio: Number(args.precio) });
        return { ok: true, resultado: { creado: true, producto_id: data.id, sku: data.sku } };
      }
      case 'update_stock': {
        const id = await productoIdPorSku(db, args.sku);
        if (!id) return { ok: false, resultado: { error: `no existe el SKU ${args.sku}` } };
        const { error } = await db.rpc('registrar_movimiento', {
          p_producto_id: id, p_sucursal_id: SUC_CENTRAL, p_tipo: 'ajuste',
          p_cantidad: Number(args.cantidad), p_motivo: args.motivo || 'Ajuste del agente IA', p_referencia_tipo: 'agente', p_referencia_id: null, p_usuario_id: null,
        });
        if (error) return { ok: false, resultado: { error: error.message } };
        return { ok: true, resultado: { ok: true, sku: args.sku, delta: Number(args.cantidad) } };
      }
      case 'enrich_metadata': {
        const id = await productoIdPorSku(db, args.sku);
        if (!id) return { ok: false, resultado: { error: `no existe el SKU ${args.sku}` } };
        const cambios: any = {};
        if (args.descripcion != null) cambios.descripcion = args.descripcion;
        if (args.es_alcohol != null) cambios.es_alcohol = !!args.es_alcohol;
        if (args.categoria) cambios.categoria_id = await categoriaId(db, args.categoria);
        if (!Object.keys(cambios).length) return { ok: true, resultado: { sinCambios: true } };
        const { error } = await db.from('productos').update(cambios).eq('id', id);
        if (error) return { ok: false, resultado: { error: error.message } };
        return { ok: true, resultado: { ok: true, sku: args.sku, campos: Object.keys(cambios) } };
      }
      case 'generate_image_prompt': {
        const { data } = await db.from('productos').select('nombre').eq('sku', args.sku).maybeSingle();
        if (!data) return { ok: false, resultado: { error: `no existe el SKU ${args.sku}` } };
        return { ok: true, resultado: { prompt: promptImagen(data.nombre) } };
      }
      case 'notify_admin':
        return { ok: true, resultado: { notificado: true, titulo: args.titulo, mensaje: args.mensaje ?? null } };
      case 'schedule_publication': {
        const id = await productoIdPorSku(db, args.sku);
        if (!id) return { ok: false, resultado: { error: `no existe el SKU ${args.sku}` } };
        const { error } = await db.from('productos').update({ activo: true }).eq('id', id);
        if (error) return { ok: false, resultado: { error: error.message } };
        return { ok: true, resultado: { publicado: true, sku: args.sku } };
      }
      case 'request_human_review':
        return { ok: true, resultado: { escalado: true, motivo: args.motivo, sku: args.sku ?? null }, escalar: true };
      default:
        return { ok: false, resultado: { error: `herramienta desconocida: ${nombre}` } };
    }
  } catch (e: any) {
    return { ok: false, resultado: { error: e.message } };
  }
}
