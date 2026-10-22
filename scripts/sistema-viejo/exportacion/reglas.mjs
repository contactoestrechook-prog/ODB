// Reglas de la carga de la EXPORTACIÓN completa del sistema viejo, separadas de
// la lectura de archivos y de la base para poder probarlas (reglas.test.mjs).
// Son las mismas reglas del circuito de las planillas (actualizar.mjs: mismos
// umbrales, mismo cruce por código y mismo parecido de nombres; una prueba
// verifica que los números no se separen) más las de las entidades que las
// planillas no traen: costos, códigos de barras, proveedores, clientes, cuenta
// corriente e historial de ventas. Cada regla dice de dónde salió.

// ---------------------------------------------------------------- umbrales
// (iguales a actualizar.mjs: reglas.test.mjs lo controla)
export const PISO_PRECIO = 100;          // por debajo: marcador del sistema viejo (0, 0,01) o precio viejo
export const SALTO_MAX = 0.6;            // más de ±60%: se revisa antes de aplicar
export const PARECIDO_MIN = 0.34;        // nombres que no se parecen nada: código reutilizado

export const r3 = (x) => Math.round(Number(x) * 1000) / 1000;
export const r2 = (x) => Math.round(Number(x) * 100) / 100;
export const pesos = (n) => (n == null || Number.isNaN(n) ? '' : r2(n));
export const variacion = (nuevo, antes) => (antes ? `${Math.round((nuevo / antes - 1) * 1000) / 10}%` : 'sin dato');

// ---------------------------------------------------------------- nombres
// normal() y parecido() son los de actualizar.mjs (no cambiar uno sin el otro)
export const normal = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/\[fusionado en[^\]]*\]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
export function parecido(a, b) {
  const A = new Set(normal(a).split(' ').filter((w) => w.length > 2)), B = new Set(normal(b).split(' ').filter((w) => w.length > 2));
  if (!A.size || !B.size) return normal(a) === normal(b) ? 1 : 0;
  let comun = 0; for (const w of A) if (B.has(w)) comun++;
  return comun / Math.min(A.size, B.size);
}
// ¿Es el mismo artículo con otro código? El criterio de preparar.mjs para
// VINCULAR una alta con un producto de ODB sin código viejo: cuenta sobre el
// nombre más largo y no cuenta medidas ("750cc" no hace iguales a un Malbec y un whisky).
const palabrasArticulo = (s) => new Set(normal(s).split(' ').filter((w) => w.length > 2 && !/^x?\d+(gr?|g|cc|ml|un)?$/.test(w)));
export function mismoArticulo(a, b) {
  const A = palabrasArticulo(a), B = palabrasArticulo(b);
  if (!A.size || !B.size) return 0;
  let c = 0; for (const w of A) if (B.has(w)) c++;
  return c / Math.max(A.size, B.size);
}
export const VINCULAR_MIN = 0.75;

// ---------------------------------------------------------------- artículos
// Un renglón por código con su estado (ok, sin_producto, inactivo,
// nombre_distinto, repetido_ambiguo). Los códigos REPETIDOS en el sistema viejo
// se resuelven por NOMBRE contra el producto de ODB, nunca por el orden: el que
// se parece se usa y el otro va a revisión (no tiene código propio en ODB).
export function resolver(renglones, porCodigo) {
  const grupos = new Map();
  for (const r of renglones) (grupos.get(r.codigo) ?? grupos.set(r.codigo, []).get(r.codigo)).push(r);
  const out = [];
  for (const [codigo, rs] of grupos) {
    const p = porCodigo.get(codigo) ?? null;
    if (!p) { out.push({ codigo, r: rs[0], p: null, estado: rs.length > 1 ? 'repetido_ambiguo' : 'sin_producto', todos: rs, sobrantes: [] }); continue; }
    let r = rs[0], sobrantes = [];
    if (rs.length > 1) {
      const conNombre = rs.map((x) => ({ x, s: parecido(x.descripcion, p.nombre) })).sort((a, b) => b.s - a.s);
      if (!(conNombre[0].s >= 0.5 && conNombre[1].s < 0.5)) { out.push({ codigo, r: rs[0], p, estado: 'repetido_ambiguo', todos: rs, sobrantes: [] }); continue; }
      r = conNombre[0].x; sobrantes = conNombre.slice(1).map((c) => c.x);
    }
    const sim = parecido(r.descripcion, p.nombre);
    const estado = !p.activo ? 'inactivo' : sim < PARECIDO_MIN ? 'nombre_distinto' : 'ok';
    out.push({ codigo, r, p, estado, sim, todos: rs, sobrantes });
  }
  return out;
}
export const MOTIVO_ESTADO = {
  inactivo: 'producto dado de baja en ODB',
  nombre_distinto: 'el código es otro producto en ODB',
  repetido_ambiguo: 'código repetido en el sistema viejo y no se sabe cuál es',
};

// Vender por peso: el sistema viejo lo vende con decimales la mayoría de las
// veces (≥3 ventas y ≥50%), o el nombre lo dice ("x kg", "x peso", "fraccionado").
// Con pocas ventas con decimales es dudoso (etiqueta mal leída) → revisión.
export const NOMBRE_PESO = /\bx\s*(peso|fracci[oó]n|fracc\.?|kg|kilo)(?![\s.]*\d)|\bfraccionad[oa]s?\b|\bpor\s+(peso|kilo|kg)\b|\ba\s+granel\b/i;
export function reglaPeso({ nombre = '', ventas = 0, conDecimales = 0, yaPorPeso = false }) {
  if (yaPorPeso) return { estado: 'ya' };
  const parte = ventas ? conDecimales / ventas : 0;
  if (conDecimales >= 3 && parte >= 0.5) return { estado: 'marcar', motivo: `el sistema viejo lo vendió con decimales ${conDecimales} de ${ventas} veces` };
  if (NOMBRE_PESO.test(String(nombre).normalize('NFD').replace(/[̀-ͯ]/g, ''))) return { estado: 'marcar', motivo: `el nombre dice que se vende por peso${conDecimales ? ` (y se vendió con decimales ${conDecimales} veces)` : ''}` };
  if (conDecimales >= 3) return { estado: 'dudoso', motivo: `se vendió con decimales ${conDecimales} de ${ventas} veces: ¿por peso o etiquetas mal leídas?` };
  return { estado: 'no' };
}

// Alcohol por rubro (el de preparar.mjs)
export const RUBRO_ALCOHOL = /^(vinos?|espumantes?|aperitivos?|cervezas?|destilados?|whisk|licor|gin|vodka|ron|fernet|sidra|champ)/i;

// ---------------------------------------------------------------- precios
// null = se aplica; texto = motivo para revisión (igual que actualizar.mjs)
export function motivoPrecio(nuevo, actual) {
  if (!(nuevo >= PISO_PRECIO)) return !(nuevo >= 1) ? 'precio marcador del sistema viejo (0 o 0,01)' : `precio menor a $${PISO_PRECIO}`;
  if (actual && Math.abs(nuevo / actual - 1) > SALTO_MAX) return `salto de más de ±${SALTO_MAX * 100}%`;
  return null;
}
// Lista Mayorista desde la lista sin nombre del viejo (Precio 4 ≈ costo × 1,4):
// además de las reglas de precio, no puede quedar debajo del costo ni arriba del
// minorista (al cliente mayorista le saldría más caro).
export function motivoMayorista(nuevo, actual, { costo = null, minorista = null } = {}) {
  const m = motivoPrecio(nuevo, actual);
  if (m) return m;
  if (costo > 0 && nuevo < costo) return `debajo del costo ($${pesos(costo)})`;
  if (minorista > 0 && nuevo > minorista) return `arriba del minorista ($${pesos(minorista)})`;
  return null;
}

// ---------------------------------------------------------------- costos
// El "costo actual" del viejo. Va a revisión si supera el precio de venta (la
// caja pide autorización para vender debajo del costo) o si no hay precio para
// compararlo; un costo menor a $1 es un marcador (0,01) y no es dato.
export function reglaCosto({ costo, precio }) {
  if (!(costo >= 1)) return { estado: 'sin_dato' };
  if (!(precio > 0)) return { estado: 'revisar', motivo: 'no hay precio de venta para comparar el costo' };
  if (costo > precio) return { estado: 'revisar', motivo: `el costo ($${pesos(costo)}) supera el precio de venta ($${pesos(precio)})` };
  return { estado: 'aplicar', costo: r2(costo) };
}

// ---------------------------------------------------------------- stock
// Objetivo de stock: el del sistema viejo, al gramo; los negativos van a 0
// (decisión del dueño del 1/10: ODB no admite stock negativo).
export function objetivoStock(viejo) {
  if (viejo == null || Number.isNaN(Number(viejo))) return { revisar: 'cantidad ilegible en el sistema viejo' };
  const v = r3(viejo);
  if (v < 0) return { objetivo: 0, nota: `negativo en el sistema viejo (${v}): queda en 0` };
  return { objetivo: v };
}

// ---------------------------------------------------------------- códigos de barras
// Dígito de control GS1 (EAN-8, UPC-A, EAN-13, GTIN-14). Otros largos no se
// validan (códigos internos o Code128): devuelve null.
export function controlGtin(codigo) {
  const t = String(codigo ?? '');
  if (!/^\d+$/.test(t) || ![8, 12, 13, 14].includes(t.length)) return null;
  let suma = 0;
  for (let i = t.length - 2, peso = 3; i >= 0; i--, peso = peso === 3 ? 1 : 3) suma += Number(t[i]) * peso;
  return (10 - (suma % 10)) % 10 === Number(t.at(-1));
}
// EAN-13 con prefijo 2 y control válido: la caja de ODB lo lee como ETIQUETA DE
// BALANZA antes de buscarlo como código (apps/api/src/catalogo/balanza.ts), así
// que cargarlo no sirve: nunca se encontraría.
export const pareceBalanza = (codigo) => /^2\d{12}$/.test(String(codigo ?? '')) && controlGtin(codigo) === true;

// Qué se hace con un código de barras de la exportación.
//   b: { ean, tipo: 'UNIDAD'|'CAJA', cantidad, formato_raro, ean_repetido }
//   ctx: { producto: el de ODB al que va (o null), alta: true si el producto se
//          da de alta en esta carga, dueno: producto_id que ya lo tiene en ODB }
// → { accion: 'agregar'|'ya_esta'|'revisar'|'no', motivo, quitar? }
export function reglaBarra(b, { producto = null, alta = false, dueno = null } = {}) {
  if (b.formato_raro) return { accion: 'no', motivo: 'formato raro (vacío, corto, letras o más de 14 dígitos)' };
  if (!producto && !alta) return { accion: 'no', motivo: 'el artículo no se carga (no está en ODB o está a revisión)' };
  const propio = producto && dueno === producto.id;
  if (b.tipo === 'CAJA' && b.cantidad > 1) {
    if (propio) return { accion: 'revisar', motivo: `código de la CAJA ×${b.cantidad} cargado como si fuera la unidad: escanearlo cobra 1 unidad`, quitar: true };
    return { accion: 'revisar', motivo: `código de la CAJA ×${b.cantidad}: ODB no guarda cuántas unidades representa y lo cobraría como 1` };
  }
  if (propio) return { accion: 'ya_esta' };
  if (dueno) return { accion: 'revisar', motivo: 'en ODB ese código ya es de otro producto' };
  if (b.tipo === 'CAJA') return { accion: 'revisar', motivo: `figura como CAJA con ${b.cantidad ?? 0} unidades: ¿es el código de la unidad?` };
  if (pareceBalanza(b.ean)) return { accion: 'no', motivo: 'empieza con 2: la caja lo lee como etiqueta de balanza y nunca lo encontraría' };
  if (b.ean_repetido) return { accion: 'revisar', motivo: 'el mismo código está en otro artículo del sistema viejo' };
  if (controlGtin(b.ean) === false) return { accion: 'revisar', motivo: 'dígito verificador inválido: el lector puede no leerlo' };
  return { accion: 'agregar' };
}

// ---------------------------------------------------------------- CUIT, DNI, teléfono
const soloDigitos = (s) => String(s ?? '').replace(/\D/g, '');
export function cuitValido(cuit) {
  const t = soloDigitos(cuit);
  if (t.length !== 11 || /^(\d)\1+$/.test(t)) return null;
  const pesosCuit = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const suma = pesosCuit.reduce((s, p, i) => s + p * Number(t[i]), 0);
  let dv = 11 - (suma % 11);
  if (dv === 11) dv = 0;
  if (dv === 10 || dv !== Number(t[10])) return null;
  return t;
}
// DNI de una persona humana a partir de su CUIT/CUIL (prefijos 20, 23, 24, 27).
// Una empresa (30, 33, 34) no tiene DNI.
export function dniDeCuit(cuit) {
  const t = cuitValido(cuit);
  if (!t || !['20', '23', '24', '27'].includes(t.slice(0, 2))) return null;
  return String(Number(t.slice(2, 10)));
}
// Teléfono: el primero si vienen varios pegados ("1122334455 - 42345678"), solo
// dígitos, sin 54 / 9 / 0 adelante. Para cruzar se usan los últimos 10 dígitos.
export function telefono(s) {
  const primero = String(s ?? '').split(/\s+-\s+|\/|;|,/)[0];
  let t = soloDigitos(primero);
  if (t.length > 10 && t.startsWith('54')) t = t.slice(2);
  if (t.length > 10 && t.startsWith('9')) t = t.slice(1);
  if (t.length === 11 && t.startsWith('0')) t = t.slice(1);
  return t.length >= 8 ? t : null;
}
export const claveTelefono = (s) => { const t = telefono(s); return t && t.length >= 10 ? t.slice(-10) : null; };
export const emailValido = (s) => { const t = String(s ?? '').trim().toLowerCase(); return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(t) ? t : null; };

// ---------------------------------------------------------------- proveedores
const FORMAS = new Set(['sa', 's', 'a', 'srl', 'r', 'l', 'sas', 'sacif', 'saic', 'saci', 'sacifi', 'sacifia', 'saicf', 'sh', 'ltda', 'sociedad', 'anonima', 'responsabilidad', 'limitada', 'cia', 'y', 'e', 'de', 'del', 'la', 'el', 'los', 'las']);
export const claveProveedor = (s) => normal(s).split(' ').filter((w) => w && !FORMAS.has(w)).join(' ');
const GENERICAS = new Set(['distribuidora', 'distribuciones', 'distribucion', 'bebidas', 'alimentos', 'comercial', 'importadora', 'mayorista', 'grupo', 'argentina', 'bodega', 'bodegas', 'odb']);
// Parecido entre razones sociales para PROPONER (nunca aplicar) una equivalencia:
// palabras en común sobre la razón más corta, sin formas societarias ni palabras
// genéricas. El relevamiento encontró falsos parecidos (Molinos/Olin, Drink
// Lovers/Drink Solutions): por eso solo propone.
export function parecidoProveedor(a, b) {
  const pal = (s) => new Set(claveProveedor(s).split(' ').filter((w) => w.length > 2 && !GENERICAS.has(w)));
  const A = pal(a), B = pal(b);
  if (!A.size || !B.size) return 0;
  let c = 0; for (const w of A) if (B.has(w)) c++;
  return c / Math.min(A.size, B.size);
}

// ---------------------------------------------------------------- clientes
// Clave de nombre sin orden ("PEREZ, JUAN" = "Juan Perez")
export const claveNombre = (s) => normal(s).split(' ').filter(Boolean).sort().join(' ');
// Las palabras del nombre más corto están todas en el otro ("Juan Perez" y "Juan
// Carlos Perez" sí; "Marta Ruiz" y "Pedro Ruiz" no: comparten solo el apellido).
export function nombreCompatible(a, b) {
  const A = new Set(normal(a).split(' ').filter((w) => w.length > 2)), B = new Set(normal(b).split(' ').filter((w) => w.length > 2));
  const [chico, grande] = A.size <= B.size ? [A, B] : [B, A];
  return chico.size > 0 && [...chico].every((w) => grande.has(w));
}
const IVA = {
  'consumidor final': 'consumidor_final', 'consumidor_final': 'consumidor_final',
  'responsable inscripto': 'responsable_inscripto', 'responsable_inscripto': 'responsable_inscripto',
  'exento': 'exento', 'iva exento': 'exento',
  'monotributo': 'monotributo', 'responsable monotributo': 'monotributo', 'monotributista': 'monotributo',
};
export const CONDICIONES_IVA = ['consumidor_final', 'responsable_inscripto', 'monotributo', 'exento'];
// Condición de IVA de ODB ('responsable_inscripto' escrito exacto: lo pide la
// factura A). "RESP NO INSCRIPTO" ya no existe: queda consumidor final.
export const condicionIva = (s) => IVA[normal(s).replace(/_/g, ' ')] ?? IVA[String(s ?? '').trim()] ?? null;

// Cruce de UN cliente del viejo contra los índices de ODB. Devuelve
// { cliente_id, por } o { revisar, candidatos } o null (no está).
//   idx: { porCuit, porDni, porNombre, porTelefono, porEmail }: Map clave → [ids]
//   nombreDe: id → nombre (para no aceptar un teléfono de otra persona)
// El código del viejo NUNCA se usa para cruzar: es otra numeración que
// clientes.codigo_legacy (529 de 536 coincidencias eran otra persona).
export function cruzarCliente(c, idx, nombreDe) {
  const hits = [];
  const cuit = cuitValido(c.cuit);
  const unico = (m, k) => (k && m?.get(k)?.length === 1 ? m.get(k)[0] : k && m?.get(k)?.length > 1 ? 'varios' : null);
  const porCuit = unico(idx.porCuit, cuit);
  const porDni = unico(idx.porDni, dniDeCuit(cuit));
  const porNombre = unico(idx.porNombre, claveNombre(c.nombre));
  const porTel = unico(idx.porTelefono, claveTelefono(c.telefono));
  const porMail = unico(idx.porEmail, emailValido(c.email));
  if (porCuit && porCuit !== 'varios') hits.push({ id: porCuit, por: 'CUIT' });
  if (porDni && porDni !== 'varios') hits.push({ id: porDni, por: 'DNI' });
  if (porNombre && porNombre !== 'varios') hits.push({ id: porNombre, por: 'nombre' });
  for (const [id, por] of [[porTel, 'teléfono'], [porMail, 'email']]) {
    if (!id || id === 'varios') continue;
    // un teléfono o un mail compartidos (familia, empresa) no alcanzan: el nombre
    // tiene que ser compatible (no alcanza con el apellido)
    if (nombreCompatible(c.nombre, nombreDe(id))) hits.push({ id, por });
  }
  const ids = [...new Set(hits.map((h) => h.id))];
  if (ids.length === 1) return { cliente_id: ids[0], por: hits.filter((h) => h.id === ids[0]).map((h) => h.por).join(' + ') };
  if (ids.length > 1) return { revisar: `coincide con ${ids.length} clientes distintos de ODB (${hits.map((h) => h.por).join(', ')})`, candidatos: ids };
  if (porCuit === 'varios') return { revisar: 'hay varios clientes de ODB con ese CUIT', candidatos: idx.porCuit.get(cuit) };
  return null;
}

// ---------------------------------------------------------------- cuenta corriente
export const CONCEPTO_SALDO_INICIAL = (corte) => `Saldo inicial del sistema anterior (corte ${corte})`;
// Saldo de apertura de un cliente: el de la ficha (clientes.csv), que coincide
// con el último saldo corrido de su cuenta corriente. Si no coinciden, o el
// código está repetido (dos personas), va a revisión.
export function saldoInicial({ ficha, ultimoCorrido = null, repetido = false }) {
  const f = r2(ficha ?? 0);
  if (repetido) return f ? { revisar: 'código de cliente repetido en el sistema viejo (dos personas): no se sabe de quién es el saldo' } : null;
  if (ultimoCorrido != null && Math.abs(r2(ultimoCorrido) - f) >= 0.01) return { revisar: `la ficha dice $${pesos(f)} y la cuenta corriente termina en $${pesos(ultimoCorrido)}` };
  if (Math.abs(f) < 0.01) return null;
  return { saldo: f, debe: f > 0 ? f : 0, haber: f < 0 ? -f : 0 };
}

// ---------------------------------------------------------------- historial de ventas
const dia = (s) => new Date(`${s}T00:00:00Z`);
const iso = (d) => d.toISOString().slice(0, 10);
const mas = (s, n) => iso(new Date(dia(s).getTime() + n * 86400_000));
export const diasEntre = (desde, hasta) => Math.round((dia(hasta) - dia(desde)) / 86400_000) + 1;
// Períodos para ventas_historicas sin pisar los que ya hay:
//   - el día del corte no entra si la exportación se cortó a media jornada;
//   - los últimos 60 días van en DOS períodos de 30 (abastecimiento usa los dos
//     últimos de cada sucursal: 0,7 del último + 0,3 del anterior; estadísticas
//     suma los que terminan en los últimos 30 días: tiene que haber uno solo);
//   - lo anterior, por mes calendario;
//   - se recortan los rangos que ODB ya tiene (por ejemplo access-julio-2026).
// Si un período existente cae en los últimos 60 días, falla: se decide a mano.
export function periodosHistorial({ primero, corte, existentes = [] }) {
  const corteDia = corte.slice(0, 10);
  const completo = /T23:5\d/.test(corte);
  const fin = completo ? corteDia : mas(corteDia, -1);
  const ultimo = { desde: mas(fin, -29), hasta: fin }, anterior = { desde: mas(fin, -59), hasta: mas(fin, -30) };
  for (const e of existentes) {
    if (e.hasta >= anterior.desde && e.desde <= fin) throw new Error(`ya hay un período ${e.desde}–${e.hasta} (${e.origen ?? '?'}) dentro de los últimos 60 días: decidir a mano`);
  }
  const meses = [];
  let d = primero;
  const tope = mas(anterior.desde, -1);
  while (d <= tope) {
    const finMes = iso(new Date(Date.UTC(dia(d).getUTCFullYear(), dia(d).getUTCMonth() + 1, 0)));
    meses.push({ desde: d, hasta: finMes < tope ? finMes : tope });
    d = mas(finMes < tope ? finMes : tope, 1);
  }
  // recortar lo que ya existe
  let libres = meses;
  for (const e of existentes) {
    const out = [];
    for (const p of libres) {
      if (e.hasta < p.desde || e.desde > p.hasta) { out.push(p); continue; }
      if (p.desde < e.desde) out.push({ desde: p.desde, hasta: mas(e.desde, -1) });
      if (p.hasta > e.hasta) out.push({ desde: mas(e.hasta, 1), hasta: p.hasta });
    }
    libres = out;
  }
  return [...libres, anterior, ultimo].map((p) => ({ ...p, dias: diasEntre(p.desde, p.hasta) }));
}
export const periodoDe = (periodos, fecha) => periodos.findIndex((p) => fecha >= p.desde && fecha <= p.hasta);
// Renglón de venta que no se suma: cantidad o importe absurdos (una etiqueta o
// un EAN leídos como cantidad o como precio).
export const CANTIDAD_ABSURDA = 5000, IMPORTE_ABSURDO = 50_000_000;
export function renglonAbsurdo({ cantidad, precio }) {
  if (Math.abs(cantidad) > CANTIDAD_ABSURDA) return `cantidad ${cantidad}`;
  if (Math.abs((cantidad ?? 0) * (precio ?? 0)) > IMPORTE_ABSURDO) return `importe $${pesos(cantidad * precio)}`;
  return null;
}
