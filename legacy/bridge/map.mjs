// Bridge legacy → Supabase · LÓGICA PURA (sin IO): mapeo de filas Access + diff por hash.
// Testeable de forma aislada (map.test.mjs). El IO (copiar .mdb, leer, upsert) vive en sync.mjs.

import { createHash } from 'node:crypto';

// --- parsers (idénticos a los scripts de migración ya probados) ---
export const num = (v) => {
  const n = Number(String(v ?? '').replace(/[^0-9.,-]/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.'));
  return isNaN(n) ? 0 : n;
};
export const clean = (v) => { const s = String(v ?? '').trim(); return s || null; };
export const norm = (s) => (s || '').toString().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

const ALC = /(vino|malbec|cabernet|syrah|merlot|bonarda|tinto|blanco|rosado|espumante|champ|whisky|whiskey|cerveza|ipa|lager|fernet|gin|ginebra|vodka|ron|tequila|licor|aperitivo|vermut|vermouth|chandon|aperol|campari|gancia|cognac|grappa|sidra|prosecco|cava)/i;

// Catálogo = unión de lprecios (precio de venta) ∪ repuestos (costo, stock, listas).
// Devuelve una fila por código con los campos relevantes para el upsert.
export function mapProductos(lprecios, repuestos) {
  const cat = new Map();
  const up = (c, b) => {
    if (!cat.has(c)) cat.set(c, b);
    else Object.assign(cat.get(c), Object.fromEntries(Object.entries(b).filter(([, v]) => v != null && v !== '')));
  };
  for (const x of lprecios) {
    const c = String(x.codigo).trim();
    if (c) up(c, { codigo: c, nombre: (x.articulo || '').trim(), rubro: (x.rubro || '').trim() || null, precio: num(x.precio) });
  }
  for (const x of repuestos) {
    const c = String(x.codigo).trim();
    if (c) up(c, { codigo: c, nombre: (x.descripcion || '').trim(), rubro: (x.rubro || '').trim() || null, costo: num(x.pcosto), stock: num(x.CANTIDAD), stockmin: num(x.stockmin), pventa: num(x.pventa), unidades_pack: num(x.caja) || null });
  }
  const prods = [...cat.values()].filter((p) => p.nombre);
  for (const p of prods) {
    p.precioFinal = p.precio > 0 ? p.precio : (p.pventa > 0 ? p.pventa : 0);
    p.es_alcohol = ALC.test(p.rubro || '') || ALC.test(p.nombre || '');
    p.costo = p.costo || 0;
    p.stock = p.stock || 0;
    p.stockmin = p.stockmin || 0;
    p.unidades_pack = p.unidades_pack || 1;
  }
  return prods;
}

// Clientes legacy → filas listas para upsert por codigo_legacy.
export function mapClientes(clienteRows) {
  const rows = [];
  for (const c of clienteRows) {
    const cod = String(c.ID ?? '').trim();
    const nombre = clean(c.NOMBRE);
    if (!cod || !nombre) continue;
    const saldo = num(c.saldo), deuda = num(c.deuda), fiado = num(c.fiado);
    const env_q = num(c.quimes1) + num(c.quilmes2), env_c = num(c.coca1) + num(c.coca2), env_b = num(c.budw1) + num(c.budw2);
    const dom = [clean(c.domicilio), clean(c.DOMICILIONUM), clean(c.LOCALIDAD), clean(c.provincia)].filter(Boolean).join(', ') || null;
    rows.push({
      codigo_legacy: cod,
      nombre,
      razon_social: clean(c.FANTASIA),
      cuit: clean(c.cuit),
      condicion_iva: (clean(c.iva) || 'CONSUMIDOR FINAL').toUpperCase(),
      telefono: clean(c.celular) || clean(c.TELEFONO) || clean(c.TELEFONO2),
      email: (c.email && String(c.email).includes('@')) ? String(c.email).trim().toLowerCase() : null,
      domicilio: dom,
      saldo_cta_cte: saldo,
      cta_cte_habilitada: (saldo !== 0 || deuda !== 0 || fiado !== 0),
      dia_reparto: clean(c.dia),
      zona_reparto: clean(c.zona),
      vendedor_reparto: clean(c.vendedor),
      barrio: clean(c.barrio),
      envases: (env_q || env_c || env_b) ? { quilmes: env_q, coca: env_c, budweiser: env_b } : null,
    });
  }
  return rows;
}

// --- diff incremental por hash (para upsert SOLO lo que cambió) ---
export function hashRow(obj, fields) {
  return createHash('sha1').update(fields.map((f) => JSON.stringify(obj[f] ?? null)).join('|')).digest('hex').slice(0, 12);
}

export const PROD_HASH_FIELDS = ['nombre', 'rubro', 'costo', 'stock', 'stockmin', 'precioFinal', 'unidades_pack', 'es_alcohol'];
export const CLI_HASH_FIELDS = ['nombre', 'razon_social', 'cuit', 'condicion_iva', 'telefono', 'email', 'domicilio', 'saldo_cta_cte', 'cta_cte_habilitada', 'dia_reparto', 'zona_reparto', 'vendedor_reparto', 'barrio', 'envases'];

// Compara contra el estado previo (mapa key→hash) y devuelve SOLO lo cambiado + el nuevo estado.
export function diff(rows, keyField, hashFields, prev = {}) {
  const next = {};
  const changed = [];
  for (const r of rows) {
    const k = String(r[keyField]);
    const h = hashRow(r, hashFields);
    next[k] = h;
    if (prev[k] !== h) changed.push(r);
  }
  return { changed, next, total: rows.length, sinCambio: rows.length - changed.length };
}
