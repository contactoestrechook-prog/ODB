// NECESIDAD (Leandro, 11/11/2026): «el sistema tiraba azúcar de 50 gramos falta,
// pero no daba el contexto de que había azúcar de 100 o de que había azúcar de
// 50 gramos de otra marca. Entonces eso estaba mal».
//
// El motor avisa por PRODUCTO: sin stock, no llega, menos de 12. Quien compra
// piensa por NECESIDAD: ¿hay azúcar en el local o no? Acá no se cambia ninguna
// cuenta del motor: a cada aviso urgente se le suma lo que hay de lo mismo en
// ese local y lo que le sobra al otro.
//
//   hueco            no queda nada de lo mismo con stock en el local
//   falta_principal  quedan otros, pero este es el que más se vende de lo suyo
//   falta_opcion     lo cubre otro que sí está
//   sin_venta        sin stock y sin ventas registradas: no urge
//
// «Lo mismo» sale del nombre (compras/parecidos.ts), porque el catálogo no tiene
// marca. Cuánto se parece otro producto, de más a menos:
//   0  el mismo en otro tamaño                       «Coca Cola 1.75» ↔ «Coca Cola lata»
//   1  comparte la palabra que sigue al tipo          «Queso Danbo Sancor» ↔ «Queso Danbo Punta del Agua»
//   2  comparte otra palabra (marca o variedad)
//   3  solo el tipo                                   «Azucar Ledesma» ↔ «Azucar Chango»
// El 3 es el más flojo: con los datos del 11/11 «Red Bull» quedaba cubierto por
// «Red Point» (cigarrillos) y «Combo Picada» por «Combo Espumantes». Por eso,
// cuando el tipo es una sola palabra, el 3 vale solo dentro de la misma
// categoría. Con el tipo de varias palabras («pure de tomate») vale siempre:
// los purés viven en tres categorías distintas.
//
// El traspaso usa la misma cuenta que Stock › Traspasos (traspasos/logica.ts):
// nunca se sugiere vaciar el otro local.

import { cabezaDe, compararNombres, normalizarNombre, palabrasDelNombre, prefijoDeFamilia, restoDe, singular, type Relacion } from '../compras/parecidos';
import { sugerirTraspaso } from '../traspasos/logica';

/** Desde cuántos productos una familia es demasiado ancha para medir quién es el principal. */
export const FAMILIA_GRANDE = 25;
/** Desde qué parte de la venta de lo suyo un producto es «el principal». */
export const PESO_PRINCIPAL = 0.4;

export type Nivel = 'hueco' | 'falta_principal' | 'falta_opcion' | 'sin_venta';
export type Fuerza = 0 | 1 | 2 | 3;

export type Necesidad = {
  nivel: Nivel;
  /** el tipo de producto, como clave: «azucar», «pure de tomate» */
  grupo: string;
  /** cuánto pesa en lo que se vende de lo mismo en ese local, de 0 a 100 */
  pesoPct: number | null;
  /** cuántos otros de lo mismo tienen stock en ese local */
  conStock: number;
  /** el que mejor lo reemplaza hoy */
  cubre: { sku: string; nombre: string; stock: number; dias: number | null; relacion: Relacion; fuerza: Fuerza } | null;
  /** lo que se puede traer del otro local sin dejarlo corto */
  traspaso: { desdeId: string; desde: string; sobra: number; cantidad: number } | null;
  /** lo que deja de venderse por día, al último costo (para ordenar) */
  ventaDia: number;
};

const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const URGENTE = new Set(['sin_stock', 'no_llega']);
// palabras que no dicen qué producto es: compartirlas no lo hace parecido
// («Queso Danbo x fraccion» y «Queso Cremoso x fraccion»)
const RELLENO = new Set(['de', 'del', 'en', 'para', 'al', 'a', 'la', 'fraccion', 'peso', 'vario', 'varia', 'surtido', 'surtida', 'sabor', 'sabore', 'unidade']);

export const claveNecesidad = (productoId: unknown, sucursalId: unknown) => `${productoId}|${sucursalId}`;

const local = (s: unknown) =>
  String(s ?? '').replace(/^Suc\s+/, '').replace(/^Sant Thomas/, 'Saint Thomas').replace(/^Santa Ines$/, 'Santa Inés');

const sumar = <K>(m: Map<K, any[]>, k: K, f: any) => {
  const lista = m.get(k);
  if (lista) lista.push(f);
  else m.set(k, [f]);
};

type Parte = { f: any; prefijo: string; cabezaLarga: boolean; segunda: string; resto: string[]; categoria: string };

function parteDe(f: any): Parte {
  const palabras = palabrasDelNombre(f?.nombre ?? '');
  const cabeza = cabezaDe(palabras);
  const segunda = singular(palabras[cabeza.length] ?? '');
  return {
    f,
    prefijo: prefijoDeFamilia(f?.nombre ?? ''),
    cabezaLarga: cabeza.length >= 2,
    segunda: RELLENO.has(segunda) ? '' : segunda,
    resto: restoDe(palabras).filter((t) => !RELLENO.has(t)),
    categoria: normalizarNombre(f?.categoria ?? ''),
  };
}

/** Qué tan fuerte reemplaza `otro` a `base`; null si no son comparables. */
export function fuerzaDeReemplazo(base: Parte, otro: Parte, familiaGrande = false): { fuerza: Fuerza; relacion: Relacion } | null {
  const { relacion } = compararNombres(base.f?.nombre ?? '', otro.f?.nombre ?? '');
  if (relacion === 'otro_tamano') return { fuerza: 0, relacion };
  if (base.segunda && base.segunda === otro.segunda) return { fuerza: 1, relacion: 'parecido' };
  const comparte = base.resto.some((t) => otro.resto.includes(t));
  // en una familia ancha, compartir solo la marca no alcanza: «Queso Protein La
  // Serenisima» no se reemplaza con «Queso Rallado La Serenisima»
  if (comparte && !familiaGrande) return { fuerza: 2, relacion: 'parecido' };
  const mismaCategoria = !!base.categoria && base.categoria === otro.categoria;
  return base.cabezaLarga || mismaCategoria ? { fuerza: 3, relacion: comparte ? 'parecido' : 'familia' } : null;
}

// La lectura del motor se comparte un minuto (motor.ts): mientras sea el mismo
// arreglo, la cuenta se hace una sola vez.
const MEMO = new WeakMap<any[], Map<string, Necesidad>>();

/**
 * El contexto de cada aviso urgente (sin stock o no llega). Recibe TODOS los
 * renglones del motor, con y sin alerta: lo que cubre una falta es justamente
 * lo que no está en alerta.
 */
export function contextoDeNecesidad(filas: any[]): Map<string, Necesidad> {
  const guardado = MEMO.get(filas);
  if (guardado) return guardado;
  const salida = new Map<string, Necesidad>();
  const porLocal = new Map<string, any[]>();
  const porProducto = new Map<string, any[]>();
  for (const f of filas) {
    if (!f?.producto_id || !f?.sucursal_id) continue;
    sumar(porLocal, f.sucursal_id, f);
    sumar(porProducto, f.producto_id, f);
  }
  for (const delLocal of porLocal.values()) {
    const partes = delLocal.map(parteDe);
    const familias = new Map<string, Parte[]>();
    for (const p of partes) if (p.prefijo) sumar(familias, p.prefijo, p);

    for (const p of partes) {
      const f = p.f;
      if (!URGENTE.has(f.alerta)) continue;
      const ritmo = n(f.ritmo_dia);
      if (!(ritmo > 0)) {
        salida.set(claveNecesidad(f.producto_id, f.sucursal_id), { nivel: 'sin_venta', grupo: p.prefijo, pesoPct: null, conStock: 0, cubre: null, traspaso: null, ventaDia: 0 });
        continue;
      }
      const familia = familias.get(p.prefijo) ?? [];
      const grande = familia.length > FAMILIA_GRANDE;
      const comparables = familia
        .filter((h) => h.f.producto_id !== f.producto_id)
        .map((h) => ({ h, r: fuerzaDeReemplazo(p, h, grande) }))
        .filter((x): x is { h: Parte; r: { fuerza: Fuerza; relacion: Relacion } } => !!x.r);
      const conStock = comparables
        .filter((x) => n(x.h.f.stock) > 0)
        .sort((a, b) =>
          a.r.fuerza - b.r.fuerza
          // entre iguales, el que la gente ya compra y el que más tiene
          || n(b.h.f.ritmo_dia) - n(a.h.f.ritmo_dia)
          || n(b.h.f.stock) - n(a.h.f.stock));
      const mejor = conStock[0];

      // «El principal» se mide contra los suyos. En una familia ancha (114
      // quesos) los suyos son los que comparten la palabra que sigue al tipo
      // («queso provoleta»); si no hay ninguno, toda la familia.
      const cercanos = comparables.filter((x) => x.r.fuerza <= 1);
      const base = grande && cercanos.length ? cercanos : comparables;
      const ventaDeLosSuyos = ritmo + base.reduce((s, x) => s + Math.max(0, n(x.h.f.ritmo_dia)), 0);
      const peso = ritmo / ventaDeLosSuyos;

      let traspaso: Necesidad['traspaso'] = null;
      for (const o of porProducto.get(f.producto_id) ?? []) {
        if (o.sucursal_id === f.sucursal_id || !(n(o.stock) > 0)) continue;
        const [s] = sugerirTraspaso([{
          productoId: f.producto_id, sku: f.sku, nombre: f.nombre,
          stockOrigen: n(o.stock),
          // lo que ya viene en camino cuenta como stock del que pide
          stockDestino: n(f.stock) + Math.max(0, n(f.en_camino)),
          minimoDestino: 0, minimoOrigen: 0,
          vendidas30Destino: ritmo * 30,
          vendidas30Origen: Math.max(0, n(o.ritmo_dia)) * 30,
        }]);
        if (s && (!traspaso || s.sugerido > traspaso.cantidad)) {
          traspaso = { desdeId: o.sucursal_id, desde: local(o.sucursal), sobra: s.sobra, cantidad: s.sugerido };
        }
      }

      salida.set(claveNecesidad(f.producto_id, f.sucursal_id), {
        nivel: !mejor ? 'hueco' : peso >= PESO_PRINCIPAL ? 'falta_principal' : 'falta_opcion',
        grupo: p.prefijo,
        pesoPct: base.length ? Math.round(peso * 100) : null,
        conStock: conStock.length,
        cubre: mejor
          ? {
              sku: mejor.h.f.sku, nombre: mejor.h.f.nombre, stock: Math.round(n(mejor.h.f.stock) * 10) / 10,
              dias: n(mejor.h.f.ritmo_dia) > 0 && mejor.h.f.cobertura_dias != null ? Math.round(n(mejor.h.f.cobertura_dias)) : null,
              relacion: mejor.r.relacion, fuerza: mejor.r.fuerza,
            }
          : null,
        traspaso,
        ventaDia: ritmo * Math.max(0, n(f.ultimo_costo)),
      });
    }
  }
  MEMO.set(filas, salida);
  return salida;
}

// Cuando el stock de algún local es una foto vieja (frescura.ts) no se sabe qué
// le sobra ni qué le falta: el contexto queda igual, sin sugerir traspasos.
const SIN_TRASPASOS = new WeakMap<Map<string, Necesidad>, Map<string, Necesidad>>();

export function sinTraspasos(contexto: Map<string, Necesidad>): Map<string, Necesidad> {
  let limpio = SIN_TRASPASOS.get(contexto);
  if (!limpio) {
    limpio = new Map([...contexto].map(([k, v]): [string, Necesidad] => [k, v.traspaso ? { ...v, traspaso: null } : v]));
    SIN_TRASPASOS.set(contexto, limpio);
  }
  return limpio;
}

// ---------- cómo se dice ----------

const dec = (v: number) => v.toLocaleString('es-AR', { maximumFractionDigits: 1 });

/** La etiqueta corta: qué clase de falta es. */
export function etiquetaDeNecesidad(nc: Pick<Necesidad, 'nivel' | 'cubre'>, alerta: unknown): string {
  const todavia = alerta === 'no_llega'; // tiene stock, pero se termina antes de que llegue el pedido
  if (nc.nivel === 'hueco') return todavia ? 'Se viene un hueco' : 'Hueco';
  if (nc.nivel === 'falta_principal') return todavia ? 'El principal no llega' : 'Falta el principal';
  if (nc.nivel === 'sin_venta') return 'Sin venta registrada';
  return nc.cubre?.fuerza === 3 ? 'Hay parecidos' : 'Hay reemplazo';
}

/** La frase que da el contexto: qué queda de lo mismo en el local. */
export function explicacionDeNecesidad(nc: Necesidad): string {
  if (nc.nivel === 'sin_venta') return 'No registra ventas en el período: no urge.';
  if (!nc.cubre) return 'No queda nada de lo mismo con stock en este local.';
  const alcanza = nc.cubre.dias == null ? '' : `, alcanza ${nc.cubre.dias} día${nc.cubre.dias === 1 ? '' : 's'}`;
  const otro = `${nc.cubre.nombre} (stock ${dec(nc.cubre.stock)}${alcanza})`;
  const mas = nc.conStock > 1 ? ` y ${nc.conStock - 1} más` : '';
  if (nc.nivel === 'falta_principal') return `Es el ${nc.pesoPct ?? 100} % de lo que se vende de lo mismo acá. Queda: ${otro}${mas}.`;
  const entrada = nc.cubre.fuerza === 0 ? 'Está en otro tamaño' : nc.cubre.fuerza === 3 ? 'Quedan otros de lo mismo' : 'Lo cubre';
  return `${entrada}: ${otro}${mas}.`;
}

export const explicacionDeTraspaso = (t: NonNullable<Necesidad['traspaso']>) =>
  `En ${t.desde} sobran ${dec(t.sobra)}: se pueden traer ${dec(t.cantidad)}.`;

/** Lo que viaja a la pantalla con cada renglón. */
export type NecesidadEnPantalla = {
  nivel: Nivel;
  etiqueta: string;
  explicacion: string;
  traspaso: { desdeId: string; desde: string; sobra: number; cantidad: number } | null;
};

export function necesidadParaPantalla(nc: Necesidad | undefined, alerta: unknown): NecesidadEnPantalla | undefined {
  if (!nc) return undefined;
  return { nivel: nc.nivel, etiqueta: etiquetaDeNecesidad(nc, alerta), explicacion: explicacionDeNecesidad(nc), traspaso: nc.traspaso };
}

/** Una sola línea, para el agente: cada campo viaja en cada vuelta del modelo. */
export function necesidadEnUnaLinea(nc: Necesidad | undefined, alerta: unknown): string | undefined {
  if (!nc) return undefined;
  return [
    `${etiquetaDeNecesidad(nc, alerta)}. ${explicacionDeNecesidad(nc)}`,
    nc.traspaso ? explicacionDeTraspaso(nc.traspaso) : '',
  ].filter(Boolean).join(' ');
}

/** Primero lo que deja la góndola vacía; lo que no tiene contexto queda donde estaba. */
const ORDEN_NIVEL: Record<string, number> = { hueco: 0, falta_principal: 1, falta_opcion: 2, sin_venta: 4 };
export const ordenDeNivel = (nivel?: string | null) => (nivel ? ORDEN_NIVEL[nivel] ?? 3 : 3);

// ---------- el resumen ----------

export type ResumenNecesidad = {
  // huecosSemanales y principalesSemanales: los que se venden al menos una vez
  // por semana. El 11/11, 72 de 175 huecos eran de productos que salen menos.
  porSucursal: Record<string, { huecos: number; huecosSemanales: number; seVienen: number; principales: number; principalesSemanales: number; conReemplazo: number; sinVenta: number; traspasables: number }>;
  /** por local, lo que más venta deja afuera hoy (huecos y principales sin stock) */
  destacados: Record<string, string[]>;
  /** lo que conviene pasar de un local al otro antes de comprar */
  traspasos: { desdeId: string; desde: string; haciaId: string; hacia: string; productos: number; unidades: number; ejemplos: { producto: string; cantidad: number }[] }[];
  /** a quién pedirle primero: los proveedores con más huecos y principales en falta */
  proveedores: { proveedor: string; huecos: number; principales: number }[];
};

export function resumenDeNecesidad(filas: any[], contexto = contextoDeNecesidad(filas), nombreDeLocal: (s: unknown) => string = local): ResumenNecesidad {
  const porSucursal: ResumenNecesidad['porSucursal'] = {};
  const fuertes = new Map<string, { producto: string; ventaDia: number; ritmo: number }[]>();
  type Pase = { desdeId: string; desde: string; haciaId: string; hacia: string; items: { producto: string; cantidad: number; ventaDia: number }[] };
  const pases = new Map<string, Pase>();
  const provs = new Map<string, { proveedor: string; huecos: number; principales: number }>();
  for (const f of filas) {
    const nc = contexto.get(claveNecesidad(f?.producto_id, f?.sucursal_id));
    if (!nc) continue;
    const suc = nombreDeLocal(f.sucursal);
    const t = (porSucursal[suc] ??= { huecos: 0, huecosSemanales: 0, seVienen: 0, principales: 0, principalesSemanales: 0, conReemplazo: 0, sinVenta: 0, traspasables: 0 });
    const sinStock = f.alerta === 'sin_stock';
    const semanal = n(f.ritmo_dia) >= 1 / 7;
    if (nc.nivel === 'hueco') {
      if (sinStock) { t.huecos++; if (semanal) t.huecosSemanales++; }
      else t.seVienen++;
    } else if (nc.nivel === 'falta_principal') { t.principales++; if (semanal) t.principalesSemanales++; }
    else if (nc.nivel === 'falta_opcion') t.conReemplazo++;
    else t.sinVenta++;
    const fuerte = nc.nivel === 'hueco' || nc.nivel === 'falta_principal';
    if (fuerte && sinStock) sumar(fuertes, suc, { producto: String(f.nombre ?? f.sku), ventaDia: nc.ventaDia, ritmo: n(f.ritmo_dia) });
    if (fuerte && f.proveedor_id) {
      const p = provs.get(f.proveedor_id) ?? { proveedor: String(f.proveedor ?? '—'), huecos: 0, principales: 0 };
      if (nc.nivel === 'hueco') p.huecos++;
      else p.principales++;
      provs.set(f.proveedor_id, p);
    }
    if (nc.traspaso) {
      t.traspasables++;
      const clave = `${nc.traspaso.desdeId}>${f.sucursal_id}`;
      const g: Pase = pases.get(clave) ?? { desdeId: nc.traspaso.desdeId, desde: nc.traspaso.desde, haciaId: f.sucursal_id, hacia: local(f.sucursal), items: [] };
      g.items.push({ producto: String(f.nombre ?? f.sku), cantidad: nc.traspaso.cantidad, ventaDia: nc.ventaDia });
      pases.set(clave, g);
    }
  }
  const destacados: ResumenNecesidad['destacados'] = {};
  for (const [suc, lista] of fuertes) {
    destacados[suc] = lista.sort((a, b) => b.ventaDia - a.ventaDia || b.ritmo - a.ritmo).slice(0, 5).map((x) => x.producto.replace(/\s+/g, ' ').trim());
  }
  return {
    porSucursal,
    destacados,
    traspasos: [...pases.values()]
      .map((g) => ({
        desdeId: g.desdeId, desde: g.desde, haciaId: g.haciaId, hacia: g.hacia, productos: g.items.length,
        unidades: Math.round(g.items.reduce((s, i) => s + i.cantidad, 0) * 10) / 10,
        ejemplos: g.items.sort((a, b) => b.ventaDia - a.ventaDia || b.cantidad - a.cantidad).slice(0, 6).map(({ producto, cantidad }) => ({ producto: producto.replace(/\s+/g, ' ').trim(), cantidad })),
      }))
      .sort((a, b) => b.productos - a.productos),
    proveedores: [...provs.values()].sort((a, b) => (b.huecos + b.principales) - (a.huecos + a.principales) || b.huecos - a.huecos).slice(0, 6),
  };
}

/** El título y las líneas del parte de la mañana. Sin título si no hay nada que decir. */
export function parteDeNecesidad(
  r: ResumenNecesidad,
  // los locales cuyo stock es una foto vieja (frescura.ts): en vez de sus números, se dice de cuándo son
  viejos: { sucursal: string; motivo: string | null }[] = [],
): { titulo: string | null; lineas: string[] } {
  const motivoDe = new Map(viejos.map((v) => [v.sucursal, v.motivo ?? '']));
  const todos = Object.entries(r.porSucursal);
  if (!todos.length) return { titulo: null, lineas: [] };
  const locales = todos.filter(([clave]) => !motivoDe.has(local(clave)));
  const huecos = locales.reduce((s, [, a]) => s + a.huecos, 0);
  const principales = locales.reduce((s, [, a]) => s + a.principales, 0);
  const lineas: string[] = [];
  for (const [clave, a] of todos) {
    const suc = local(clave);
    if (motivoDe.has(suc)) {
      lineas.push(`${motivoDe.get(suc)} Sus números no entran en este parte.`);
      continue;
    }
    lineas.push(`${suc}: ${a.huecos} huecos, no queda nada de lo mismo (${a.huecosSemanales} de venta semanal); ${a.principales} principales en falta (${a.principalesSemanales} de venta semanal); ${a.seVienen} huecos que se vienen; ${a.conReemplazo} que tienen reemplazo en el local.`);
    const top = r.destacados[clave] ?? [];
    if (top.length) lineas.push(`Lo que más venta deja afuera en ${suc}: ${top.join(', ')}.`);
  }
  if (r.traspasos.length) {
    lineas.push(`Antes de comprar: ${r.traspasos.map((t) => `${t.productos} se pueden traer de ${t.desde} a ${t.hacia}`).join(' y ')}.`);
  }
  if (r.proveedores.length) {
    lineas.push(`A quién pedirle primero: ${r.proveedores.slice(0, 5).map((p) => `${p.proveedor} (${p.huecos + p.principales})`).join(', ')}.`);
  }
  return {
    titulo: `Compras: ${huecos} hueco${huecos === 1 ? '' : 's'} en góndola y ${principales} producto${principales === 1 ? '' : 's'} principal${principales === 1 ? '' : 'es'} en falta`,
    lineas,
  };
}
