import { randomUUID } from 'node:crypto';

// Base EN MEMORIA para el modo demo (SUPABASE_URL=demo). Imita la parte del
// cliente de Supabase que usa esta API: from().select().eq()… con relaciones
// anidadas ("mozo:mozos(id, nombre)"). Sirve para recorrer las pantallas con
// datos de muestra sin tener la base creada. No guarda nada: al reiniciar la
// API vuelve a los datos de la semilla. NO es para producción.

type Fila = Record<string, any>;
export type Tablas = Record<string, Fila[]>;

// [tabla hija, columna, tabla padre]
const FKS: [string, string, string][] = [
  ['mesa_ciclos', 'mesa_id', 'mesas'],
  ['mesa_ciclos', 'mozo_id', 'mozos'],
  ['mesa_ciclos', 'derivador_id', 'derivadores'],
  ['mesa_ciclos', 'reserva_id', 'reservas'],
  ['carta_items', 'categoria_id', 'carta_categorias'],
  ['carta_items', 'corte_id', 'cortes'],
  ['comanda_items', 'ciclo_id', 'mesa_ciclos'],
  ['comanda_items', 'item_id', 'carta_items'],
  ['opiniones', 'mesa_id', 'mesas'],
  ['alertas_encargado', 'mesa_id', 'mesas'],
  ['alertas_encargado', 'opinion_id', 'opiniones'],
  ['contactos', 'mesa_id', 'mesas'],
  ['contactos', 'ciclo_id', 'mesa_ciclos'],
  ['compras', 'proveedor_id', 'proveedores'],
  ['compra_items', 'compra_id', 'compras'],
  ['compra_items', 'corte_id', 'cortes'],
  ['pagos', 'ciclo_id', 'mesa_ciclos'],
  ['reservas', 'derivador_id', 'derivadores'],
  ['reservas', 'mesa_id', 'mesas'],
  ['derivador_liquidaciones', 'derivador_id', 'derivadores'],
];

const SIN_ID = new Set(['configuracion', 'analista_insights']);

const DEFECTOS: Record<string, () => Fila> = {
  mesas: () => ({ activa: true, sector: null }),
  mozos: () => ({ activo: true }),
  derivadores: () => ({ tipo: 'hotel', comision_pct: 0, activo: true, contacto: null, telefono: null, notas: null }),
  reservas: () => ({
    idioma: 'es', estado: 'pendiente', origen: 'salon', derivador_id: null, mesa_id: null,
    sena_monto: null, sena_pagada: false, notas: null, recordatorio_en: null, telefono: null,
  }),
  mesa_ciclos: () => {
    const ahora = new Date().toISOString();
    return {
      estado: 'sentada', estado_desde: ahora, sentada_en: ahora, mozo_id: null, derivador_id: null, reserva_id: null,
      cubiertos: null, monto: null, llamado_mozo_en: null, pago_preferido_metodo: null, pago_preferido_moneda: null,
      vio_carta_en: null, comanda_tomada_en: null, plato_servido_en: null, terminando_en: null,
      pidio_cuenta_en: null, pago_en: null, libre_en: null,
    };
  },
  lista_espera: () => ({ idioma: 'es', estado: 'esperando', avisado_en: null, resuelto_en: null }),
  cortes: () => ({ rinde_objetivo_pct: 80, activo: true }),
  carta_categorias: () => ({ orden: 0, nombre_pt: null, nombre_en: null }),
  carta_items: () => ({
    nombre_pt: null, nombre_en: null, descripcion: null, descripcion_pt: null, descripcion_en: null,
    costo: null, imagen_url: null, alergenos: [], etiquetas: [], activo: true, agotado: false, orden: 0,
    tiempo_coccion_min: null, corte_id: null, gramos_porcion: null,
  }),
  comanda_items: () => ({
    item_id: null, cantidad: 1, precio_unitario: 0, tiempo_coccion_min: null, estado: 'pendiente',
    enviado_en: new Date().toISOString(), en_coccion_desde: null, listo_en: null, entregado_en: null,
  }),
  pagos: () => ({ tipo_cambio: 1, estado: 'confirmado', referencia: null, cargado_por: null }),
  derivador_liquidaciones: () => ({ pagado_en: new Date().toISOString(), nota: null }),
  proveedores: () => ({ cuit: null }),
  compras: () => ({ numero_comprobante: null, subtotal: null, iva_105: null, iva_21: null }),
  compra_items: () => ({ cantidad: null, precio_unitario: null, total: null, corte_id: null, kilos: null }),
  opiniones: () => ({ comentario: null }),
  alertas_encargado: () => ({ atendida: false, opinion_id: null }),
  contactos: () => ({ nombre: null, idioma: 'es', mesa_id: null, ciclo_id: null, post_visita_enviado_en: null }),
  resenas_google: () => ({
    idioma: 'es', origen: 'google', tema: null, respuesta_ia: null, respuesta_estado: 'pendiente', publicado_en: null,
  }),
  feriados: () => ({}),
};

// Lo que en Postgres frena un índice único.
const UNICOS: Record<string, (nueva: Fila, filas: Fila[]) => boolean> = {
  contactos: (n, fs) => n.ciclo_id != null && fs.some((f) => f.ciclo_id === n.ciclo_id),
  mesa_ciclos: (n, fs) => n.estado !== 'libre' && fs.some((f) => f.mesa_id === n.mesa_id && f.estado !== 'libre'),
  derivadores: (n, fs) => fs.some((f) => f.codigo === n.codigo),
  mesas: (n, fs) => fs.some((f) => f.qr_token === n.qr_token),
  derivador_liquidaciones: (n, fs) => fs.some((f) => f.derivador_id === n.derivador_id && f.mes === n.mes),
};

type Nodo = { todo: boolean; cols: string[]; anidados: { alias: string; tabla: string; nodo: Nodo }[] };

function partir(sel: string): string[] {
  const partes: string[] = [];
  let nivel = 0;
  let actual = '';
  for (const c of sel) {
    if (c === '(') nivel++;
    if (c === ')') nivel--;
    if (c === ',' && nivel === 0) {
      partes.push(actual.trim());
      actual = '';
    } else actual += c;
  }
  if (actual.trim()) partes.push(actual.trim());
  return partes;
}

function parsear(sel: string): Nodo {
  const nodo: Nodo = { todo: false, cols: [], anidados: [] };
  for (const p of partir(sel)) {
    const m = p.match(/^(?:(\w+):)?(\w+)\s*\(([\s\S]*)\)$/);
    if (m) nodo.anidados.push({ alias: m[1] ?? m[2], tabla: m[2], nodo: parsear(m[3]) });
    else if (p === '*') nodo.todo = true;
    else nodo.cols.push(p);
  }
  return nodo;
}

class ErrorBase extends Error {
  constructor(message: string, public code?: string) {
    super(message);
  }
}

class Consulta implements PromiseLike<{ data: any; error: any; count: number | null }> {
  private filtros: ((f: Fila) => boolean)[] = [];
  private orden: { col: string; asc: boolean }[] = [];
  private tope: number | null = null;
  private modo: 'select' | 'insert' | 'update' | 'delete' = 'select';
  private sel: string | null = null;
  private unico: 'single' | 'maybe' | null = null;
  private soloCuenta = false;
  private carga: any = null;

  constructor(private readonly tablas: Tablas, private readonly tabla: string) {
    if (!tablas[tabla]) tablas[tabla] = [];
  }

  select(cols = '*', opts?: { count?: string; head?: boolean }) {
    this.sel = cols;
    if (opts?.head) this.soloCuenta = true;
    return this;
  }
  insert(filas: Fila | Fila[]) { this.modo = 'insert'; this.carga = Array.isArray(filas) ? filas : [filas]; return this; }
  update(patch: Fila) { this.modo = 'update'; this.carga = patch; return this; }
  delete() { this.modo = 'delete'; return this; }

  eq(col: string, v: any) { this.filtros.push((f) => f[col] === v); return this; }
  neq(col: string, v: any) { this.filtros.push((f) => f[col] !== v); return this; }
  in(col: string, vs: any[]) { this.filtros.push((f) => vs.includes(f[col])); return this; }
  is(col: string, v: any) { this.filtros.push((f) => (f[col] ?? null) === v); return this; }
  not(col: string, op: string, v: any) {
    if (op === 'is') this.filtros.push((f) => (f[col] ?? null) !== v);
    else if (op === 'eq') this.filtros.push((f) => f[col] !== v);
    else throw new Error(`memoria: not(${op}) no está soportado`);
    return this;
  }
  gte(col: string, v: any) { this.filtros.push((f) => f[col] != null && f[col] >= v); return this; }
  lte(col: string, v: any) { this.filtros.push((f) => f[col] != null && f[col] <= v); return this; }
  gt(col: string, v: any) { this.filtros.push((f) => f[col] != null && f[col] > v); return this; }
  lt(col: string, v: any) { this.filtros.push((f) => f[col] != null && f[col] < v); return this; }
  order(col: string, opts?: { ascending?: boolean }) { this.orden.push({ col, asc: opts?.ascending !== false }); return this; }
  limit(n: number) { this.tope = n; return this; }
  single() { this.unico = 'single'; return this; }
  maybeSingle() { this.unico = 'maybe'; return this; }

  then<A = any, B = never>(ok?: ((v: any) => A | PromiseLike<A>) | null, mal?: ((e: any) => B | PromiseLike<B>) | null) {
    return Promise.resolve(this.ejecutar()).then(ok, mal);
  }

  private proyectar(tabla: string, fila: Fila, nodo: Nodo): Fila {
    const out: Fila = {};
    if (nodo.todo) Object.assign(out, fila);
    for (const c of nodo.cols) out[c] = fila[c] ?? null;
    for (const a of nodo.anidados) {
      const aPadre = FKS.find(([hija, , padre]) => hija === tabla && padre === a.tabla);
      if (aPadre) {
        const padre = (this.tablas[a.tabla] ?? []).find((p) => p.id === fila[aPadre[1]]);
        out[a.alias] = padre ? this.proyectar(a.tabla, padre, a.nodo) : null;
        continue;
      }
      const aHijas = FKS.find(([hija, , padre]) => hija === a.tabla && padre === tabla);
      if (!aHijas) throw new ErrorBase(`memoria: no hay relación entre ${tabla} y ${a.tabla}`);
      out[a.alias] = (this.tablas[a.tabla] ?? [])
        .filter((h) => h[aHijas[1]] === fila.id)
        .map((h) => this.proyectar(a.tabla, h, a.nodo));
    }
    return out;
  }

  private ejecutar() {
    try {
      const filas = this.tablas[this.tabla];
      let afectadas: Fila[];

      if (this.modo === 'insert') {
        afectadas = (this.carga as Fila[]).map((f) => {
          const nueva: Fila = {
            ...(SIN_ID.has(this.tabla) ? {} : { id: randomUUID() }),
            creado_en: new Date().toISOString(),
            ...(DEFECTOS[this.tabla]?.() ?? {}),
            ...f,
          };
          if (UNICOS[this.tabla]?.(nueva, filas)) throw new ErrorBase('Ya existe un registro con esos datos', '23505');
          filas.push(nueva);
          return nueva;
        });
      } else {
        afectadas = filas.filter((f) => this.filtros.every((fn) => fn(f)));
        if (this.modo === 'update') afectadas.forEach((f) => Object.assign(f, this.carga));
        if (this.modo === 'delete') {
          const borrar = new Set(afectadas);
          this.tablas[this.tabla] = filas.filter((f) => !borrar.has(f));
        }
      }

      if (this.modo !== 'select' && this.sel == null) return { data: null, error: null, count: null };
      if (this.soloCuenta) return { data: null, error: null, count: afectadas.length };

      const ordenadas = [...afectadas];
      for (const o of [...this.orden].reverse()) {
        ordenadas.sort((a, b) => {
          const x = a[o.col], y = b[o.col];
          if (x == null && y == null) return 0;
          if (x == null) return 1;
          if (y == null) return -1;
          return (x < y ? -1 : x > y ? 1 : 0) * (o.asc ? 1 : -1);
        });
      }
      const recorte = this.tope != null ? ordenadas.slice(0, this.tope) : ordenadas;
      const nodo = parsear(this.sel ?? '*');
      const data = recorte.map((f) => this.proyectar(this.tabla, f, nodo));

      if (this.unico) {
        if (data.length > 1) throw new ErrorBase('La consulta devolvió más de un renglón', 'PGRST116');
        if (data.length === 0) {
          if (this.unico === 'single') throw new ErrorBase('No se encontró el renglón', 'PGRST116');
          return { data: null, error: null, count: 0 };
        }
        return { data: data[0], error: null, count: 1 };
      }
      return { data, error: null, count: afectadas.length };
    } catch (e: any) {
      return { data: null, error: { message: e.message, code: e.code ?? null }, count: null };
    }
  }
}

export class BaseEnMemoria {
  constructor(public readonly tablas: Tablas) {}
  from(tabla: string) {
    return new Consulta(this.tablas, tabla);
  }
}
