// Lector de la EXPORTACIÓN CSV completa del sistema viejo (corte del 21/10/2026).
// Son 9 archivos en latin-1, separados por ';', con decimales con coma y renglones
// terminados en CRLF. Cada lector devuelve filas tipadas y deja anotado en
// `avisos` todo lo que tuvo que reparar o no pudo leer: nada se descarta en
// silencio.
//
// LA EXPORTACIÓN SE LEE DESDE AFUERA DEL REPO (por ejemplo el scratchpad o
// ~/Downloads): trae clientes con CUIT, teléfono y saldo. Nunca copiar los .csv a
// esta carpeta ni commitearlos (el .gitignore de scripts/sistema-viejo los frena igual).
//
// Lo que se sabe de esta exportación (relevado el 21/10/2026):
//   - listadeprecios.csv trae el ENCABEZADO CORRIDO: dice "Nombre de Lista;
//     código del producto; último precio" pero los datos son código;lista;precio.
//     Las columnas se deciden por el contenido: el código es la columna cuyos
//     valores existen en articulos.csv; si no queda claro, falla.
//   - clientes.csv tiene un renglón con un salto de línea suelto (LF) y
//     caracteres de control (\x01, \x02) dentro de un campo: el fin de registro
//     es CRLF; los LF sueltos y los caracteres de control se limpian.
//   - productosxproveedor.csv trae la columna "Código interno" VACÍA en todas
//     las filas: se cruza con articulos.csv por POSICIÓN y se valida con el
//     costo. Si no coincide, la fila se marca (no se descarta): puede ser un
//     costo MÁS NUEVO que el de articulos (la exportación no es una foto única).
//   - articulos.csv tiene códigos repetidos (dos artículos con el mismo código) y
//     clientes.csv también: las dos filas salen marcadas `repetido: true`.
//   - stock.csv viene alineado fila a fila con articulos.csv (se verifica por
//     sucursal).
//   - El "PLU de balanza" es igual al código en todas las filas y la alícuota de
//     IVA es 21 en todas: no se devuelven (no son datos, son el valor por defecto).
//   - El código de CLIENTE del sistema viejo NO es clientes.codigo_legacy de ODB:
//     los clientes que ODB ya tiene con código numérico vienen de otra numeración.
//     Se devuelve como `codigo_viejo`; en ODB se guarda con claveClienteOdb() ('st-<código>').
//   - En ctacte_clientes.csv el saldo corrido NO es la suma de los importes y no
//     coincide con la ficha: los movimientos sirven solo de historial (ver
//     validarCtaCte).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const ARCHIVOS = ['articulos', 'stock', 'codigobarras', 'listadeprecios', 'proveedores',
  'productosxproveedor', 'clientes', 'ctacte_clientes', 'ventas'];

// Sucursales de la exportación → sucursal de ODB. Una que no esté acá hace fallar
// la lectura del stock (no se mezcla el stock de una sucursal con el de otra).
export const SUCURSALES = {
  'sant thomas': '229906e6-df69-48eb-b027-2b57fefb89fe',
  'saint thomas': '229906e6-df69-48eb-b027-2b57fefb89fe',
  'santa ines': 'f117af1b-538d-4889-bbc2-e004a4a29048',
};
export const FECHA_MINIMA = '2015-01-01';     // antes de esto es basura (hay ventas del 28/1/1978)

// ---------------------------------------------------------------- texto
export const sinTildes = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
export const normal = (s) => sinTildes(s).toLowerCase()
  .replace(/\[fusionado en[^\]]*\]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const limpiar = (s) => String(s).replace(/[\x00-\x1f\x7f]+/g, ' ').replace(/\s+/g, ' ').trim();

// Un registro termina en CRLF. Si un registro trae menos campos que el
// encabezado (un CRLF dentro de un campo), se junta con el siguiente.
export function registros(texto, avisos = [], archivo = '') {
  const lineas = texto.split('\r\n');
  if (lineas.at(-1) === '') lineas.pop();
  if (!lineas.length) return { encabezado: [], filas: [] };
  const encabezado = lineas[0].split(';').map(limpiar);
  const n = encabezado.length;
  const filas = [];
  let pendiente = null, desde = 0;
  for (let i = 1; i < lineas.length; i++) {
    const linea = pendiente == null ? lineas[i] : `${pendiente} ${lineas[i]}`;
    if (pendiente == null) desde = i + 1;
    const campos = linea.split(';');
    if (campos.length < n) { pendiente = linea; continue; }
    if (pendiente != null) avisos.push({ archivo, renglon: desde, aviso: 'registro partido en dos renglones: se juntó' });
    pendiente = null;
    if (campos.length > n) { avisos.push({ archivo, renglon: desde, aviso: `tiene ${campos.length} campos y el encabezado ${n}: no se usa` }); continue; }
    if (/[\x00-\x09\x0b-\x1f\x7f]|\n/.test(linea)) avisos.push({ archivo, renglon: desde, aviso: 'caracteres de control o salto de línea dentro de un campo: se limpiaron' });
    filas.push({ renglon: desde, campos: campos.map(limpiar) });
  }
  if (pendiente != null) avisos.push({ archivo, renglon: desde, aviso: 'el último registro está incompleto: no se usa' });
  return { encabezado, filas };
}

// Las columnas se ubican por el título (cambian de lugar entre exportaciones).
export function columnas(encabezado, pedidas, archivo = '') {
  const titulos = encabezado.map(normal);
  const col = {};
  for (const [nombre, opciones] of Object.entries(pedidas)) {
    const i = titulos.findIndex((t) => [].concat(opciones).some((o) => t === normal(o) || t.startsWith(normal(o))));
    if (i < 0) throw new Error(`${archivo}: no encuentro la columna '${[].concat(opciones)[0]}' (encabezado: ${encabezado.join(' | ')})`);
    col[nombre] = i;
  }
  return col;
}

// "6510,23" → 6510.23 · "1.234,5" → 1234.5 · "" → null · lo que no es número → NaN.
// El punto se toma como separador de miles SOLO si el número también trae coma
// decimal: "0.105" o "1.500" sin coma son ambiguos (¿punto decimal de otra
// configuración regional?) y devuelven NaN para que el que llama avise.
export function numero(s) {
  const t = String(s ?? '').trim();
  if (t === '') return null;
  if (/^-?\d+(,\d+)?$/.test(t)) return Number(t.replace(',', '.'));
  if (/^-?\d{1,3}(\.\d{3})+,\d+$/.test(t)) return Number(t.replace(/\./g, '').replace(',', '.'));
  return NaN;
}
// numero() + aviso cuando el campo no está vacío y no se pudo leer
function leerNumero(s, avisos, archivo, renglon, campo) {
  const n = numero(s);
  if (Number.isNaN(n)) avisos.push({ archivo, renglon, aviso: `${campo} '${s}' no es un número que se pueda leer sin adivinar: queda sin dato` });
  return n;
}

// "21/10/2026" → "2026-10-21"; con hora → { dia, iso } en hora argentina (-03:00)
export function fecha(s) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(String(s ?? '').trim());
  if (!m) return null;
  const [, d, me, a, h, mi, se] = m;
  const dia = `${a}-${me.padStart(2, '0')}-${d.padStart(2, '0')}`;
  const chequeo = new Date(`${dia}T00:00:00Z`);
  if (Number.isNaN(chequeo.getTime()) || chequeo.toISOString().slice(0, 10) !== dia) return null;
  if (h == null) return dia;
  return { dia, iso: `${dia}T${h.padStart(2, '0')}:${mi}:${(se ?? '00').padStart(2, '0')}-03:00` };
}
// fecha() con control de rango: antes de 2015 o después del corte de la
// exportación es basura → null y aviso (nunca una fecha absurda en silencio).
export function fechaEnRango(s, { archivo = '', renglon = null, corte = null, avisos = [] } = {}) {
  const f = fecha(s);
  const dia = typeof f === 'string' ? f : f?.dia ?? null;
  if (String(s ?? '').trim() !== '' && !dia) { avisos.push({ archivo, renglon, aviso: `fecha '${s}' ilegible: queda sin fecha` }); return null; }
  if (dia && (dia < FECHA_MINIMA || (corte && dia > corte))) {
    avisos.push({ archivo, renglon, aviso: `fecha ${dia} fuera de rango (${FECHA_MINIMA} a ${corte ?? 'hoy'}): queda sin fecha` });
    return null;
  }
  return f;
}

const codigoValido = (c) => /^\d+$/.test(c);

// marca `repetido: true` en TODAS las filas de un código repetido y deja un aviso
// por código: un Map por código se quedaría con una sola fila en silencio
function marcarRepetidos(filas, campo, archivo, avisos, que) {
  const grupos = new Map();
  for (const f of filas) if (f[campo] != null && f[campo] !== '' && !f.invalido) (grupos.get(f[campo]) ?? grupos.set(f[campo], []).get(f[campo])).push(f);
  for (const [cod, fs] of grupos) {
    if (fs.length < 2) continue;
    for (const f of fs) f.repetido = true;
    avisos.push({ archivo, renglon: fs[0].renglon, aviso: `${que} ${cod} repetido en ${fs.length} filas (renglones ${fs.map((f) => f.renglon).join(', ')}): ninguna se toma por el orden` });
  }
  return filas;
}

// ---------------------------------------------------------------- archivos
export function leerArticulos(texto, avisos = []) {
  const { encabezado, filas } = registros(texto, avisos, 'articulos');
  const c = columnas(encabezado, {
    codigo: 'codigo interno', descripcion: 'descripcion', rubro: 'rubro', pack: 'unidades por pack', iva: 'alicuota',
    costo: 'costo actual', p1: 'lista precio 1', p2: 'lista precio 2', p3: 'lista precio 3', p4: 'lista precio 4',
    plu: 'plu', proveedor: 'proveedor habitual',
  }, 'articulos');
  const out = [];
  let pluIgual = 0, ivas = new Map();
  filas.forEach(({ renglon, campos }, pos) => {
    const r = { pos, renglon, codigo: campos[c.codigo], descripcion: campos[c.descripcion], rubro: campos[c.rubro] };
    if (!codigoValido(r.codigo)) { avisos.push({ archivo: 'articulos', renglon, aviso: `código '${r.codigo}' inválido: no se usa` }); out.push({ ...r, invalido: true }); return; }
    const pack = leerNumero(campos[c.pack], avisos, 'articulos', renglon, 'pack');
    r.pack = Number.isInteger(pack) && pack > 0 ? pack : null;          // 0, vacío o ilegible = sin dato
    r.costo = leerNumero(campos[c.costo], avisos, 'articulos', renglon, 'costo');
    for (const k of ['p1', 'p2', 'p3', 'p4']) r[k] = leerNumero(campos[c[k]], avisos, 'articulos', renglon, k);
    r.proveedor = campos[c.proveedor];
    if (campos[c.plu] === r.codigo) pluIgual++;
    else if (campos[c.plu]) r.plu = campos[c.plu];                      // solo si dice algo distinto del código
    const iva = campos[c.iva]; ivas.set(iva, (ivas.get(iva) ?? 0) + 1);
    out.push(r);
  });
  if (pluIgual) avisos.push({ archivo: 'articulos', aviso: `el PLU de balanza es igual al código en ${pluIgual} de ${out.length} filas: no se devuelve (no sirve para marcar productos de balanza)` });
  avisos.push({ archivo: 'articulos', aviso: `alícuota de IVA: ${[...ivas].map(([v, n]) => `${v || '(vacía)'} en ${n}`).join(', ')}; no se devuelve (no es confiable: ninguna carga la escribe)` });
  return marcarRepetidos(out, 'codigo', 'articulos', avisos, 'código');
}

// Stock agrupado por sucursal (de ODB). Una sucursal desconocida hace fallar la
// lectura: si la próxima exportación trae Santa Inés, no se mezcla con ST.
export function leerStock(texto, articulos, avisos = []) {
  const { encabezado, filas } = registros(texto, avisos, 'stock');
  const c = columnas(encabezado, { codigo: 'codigo interno', sucursal: 'sucursal', cantidad: 'cantidad a la fecha', corte: 'fecha y hora del corte', minimo: 'stock minimo', ultimo: 'ultimo costo' }, 'stock');
  const porSucursal = new Map();
  for (const { renglon, campos } of filas) {
    const nombre = campos[c.sucursal];
    const sucursal_id = SUCURSALES[normal(nombre)];
    if (!sucursal_id) throw new Error(`stock: la sucursal '${nombre}' (renglón ${renglon}) no es ninguna de ODB: agregarla a SUCURSALES antes de leer`);
    const lista = porSucursal.get(sucursal_id) ?? porSucursal.set(sucursal_id, { nombre, sucursal_id, filas: [] }).get(sucursal_id);
    lista.filas.push({
      pos: lista.filas.length, renglon, codigo: campos[c.codigo], sucursal: nombre, sucursal_id,
      cantidad: leerNumero(campos[c.cantidad], avisos, 'stock', renglon, 'cantidad'),
      corte: fecha(campos[c.corte]), minimo: numero(campos[c.minimo]), ultimo_costo: numero(campos[c.ultimo]),
    });
  }
  // cada sucursal tiene que venir alineada fila a fila con articulos: es lo que
  // permite separar el stock de los dos artículos de un código repetido
  for (const s of porSucursal.values()) {
    s.alineado = !!articulos && s.filas.length === articulos.length && s.filas.every((f, i) => f.codigo === articulos[i].codigo);
    if (articulos && !s.alineado) avisos.push({ archivo: 'stock', aviso: `${s.nombre}: no viene alineado con articulos.csv: los códigos repetidos van a revisión` });
    for (const f of s.filas) if (f.cantidad == null || Number.isNaN(f.cantidad)) avisos.push({ archivo: 'stock', renglon: f.renglon, aviso: `cantidad ilegible del código ${f.codigo}` });
    marcarRepetidos(s.filas, 'codigo', 'stock', [], 'código');
    const cortes = s.filas.map((f) => f.corte?.iso).filter(Boolean).sort();
    s.corte = cortes.at(-1) ?? null;
  }
  return porSucursal;
}

// EAN-13 con prefijo 2 y dígito de control válido: la caja de ODB lo lee como
// etiqueta de balanza (mismo criterio que apps/api/src/catalogo/balanza.ts)
export function pareceBalanza(ean) {
  const t = String(ean ?? '');
  if (!/^2\d{12}$/.test(t)) return false;
  let suma = 0;
  for (let i = 0; i < 12; i++) suma += Number(t[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (suma % 10)) % 10 === Number(t[12]);
}

export function leerBarras(texto, avisos = []) {
  const { encabezado, filas } = registros(texto, avisos, 'codigobarras');
  const c = columnas(encabezado, { codigo: 'codigo interno', ean: 'codigo de barras', tipo: 'descripcion', cantidad: 'cantidad' }, 'codigobarras');
  const out = filas.map(({ renglon, campos }) => {
    const ean = campos[c.ean].replace(/\s+/g, '');
    const r = { renglon, codigo: campos[c.codigo], ean, tipo: campos[c.tipo].toUpperCase(), cantidad: numero(campos[c.cantidad]) };
    if (!/^\d{8,14}$/.test(ean) || /^(\d)\1+$/.test(ean)) r.formato_raro = true;   // vacío, '2', 20+ dígitos, ASIN, ceros
    if (pareceBalanza(ean)) r.parece_balanza = true;
    return r;
  });
  const raros = out.filter((r) => r.formato_raro).length;
  if (raros) avisos.push({ archivo: 'codigobarras', aviso: `${raros} códigos con formato raro (vacíos, cortos, de más de 14 dígitos o letras): marcados formato_raro` });
  const balanza = out.filter((r) => r.parece_balanza).length;
  if (balanza) avisos.push({ archivo: 'codigobarras', aviso: `${balanza} códigos empiezan con 2 y tienen dígito de control válido: la caja los puede leer como etiqueta de balanza (parece_balanza)` });
  // un mismo EAN en dos códigos: se marca (cuál es el bueno lo decide una persona)
  const porEan = new Map();
  for (const r of out) if (!r.formato_raro) (porEan.get(r.ean) ?? porEan.set(r.ean, []).get(r.ean)).push(r);
  let rep = 0;
  for (const rs of porEan.values()) if (new Set(rs.map((r) => r.codigo)).size > 1) { rep++; for (const r of rs) r.ean_repetido = true; }
  if (rep) avisos.push({ archivo: 'codigobarras', aviso: `${rep} EAN aparecen en más de un artículo: marcados ean_repetido` });
  return out;
}

// El encabezado de listadeprecios viene corrido: las columnas se deciden por el
// CONTENIDO. El código es la columna cuyos valores existen en articulos.csv (al
// menos 99% de la muestra); la lista, la que no tiene números; el precio, la
// otra. Si no queda una sola candidata para cada una, falla: nunca supone el orden.
export function leerListas(texto, articulos, avisos = []) {
  const { encabezado, filas } = registros(texto, avisos, 'listadeprecios');
  if (encabezado.length !== 3) throw new Error(`listadeprecios: esperaba 3 columnas y hay ${encabezado.length}`);
  if (!articulos?.length) throw new Error('listadeprecios: hace falta articulos.csv para saber cuál columna es el código');
  const codigos = new Set(articulos.filter((a) => !a.invalido).map((a) => a.codigo));
  const muestra = filas.slice(0, 3000);
  const proporcion = (i, f) => muestra.filter((x) => f(x.campos[i])).length / Math.max(1, muestra.length);
  const enArticulos = [0, 1, 2].map((i) => proporcion(i, (v) => codigos.has(v)));
  const esTexto = [0, 1, 2].map((i) => proporcion(i, (v) => v === '' || /[a-z]/i.test(v)));
  const esNumero = [0, 1, 2].map((i) => proporcion(i, (v) => v !== '' && !Number.isNaN(numero(v)) && numero(v) != null));
  const candCodigo = [0, 1, 2].filter((i) => enArticulos[i] >= 0.99);
  const candLista = [0, 1, 2].filter((i) => esTexto[i] >= 0.99);
  if (candCodigo.length !== 1 || candLista.length !== 1 || candCodigo[0] === candLista[0]) {
    throw new Error(`listadeprecios: no puedo decidir las columnas por el contenido (en articulos: ${enArticulos.map((p) => p.toFixed(3))}, texto: ${esTexto.map((p) => p.toFixed(3))})`);
  }
  const [iCodigo] = candCodigo, [iLista] = candLista;
  const iPrecio = [0, 1, 2].find((i) => i !== iCodigo && i !== iLista);
  if (esNumero[iPrecio] < 0.99) throw new Error(`listadeprecios: la columna ${iPrecio + 1} debería ser el precio y no es numérica`);
  const titulos = encabezado.map(normal);
  if (!titulos[iCodigo].includes('codigo') || !titulos[iLista].includes('lista')) {
    avisos.push({ archivo: 'listadeprecios', aviso: `encabezado corrido ('${encabezado.join(';')}'): por el contenido, el código es la columna ${iCodigo + 1}, la lista la ${iLista + 1} y el precio la ${iPrecio + 1}` });
  }
  return filas.map(({ renglon, campos }) => ({ renglon, codigo: campos[iCodigo], lista: campos[iLista], precio: leerNumero(campos[iPrecio], avisos, 'listadeprecios', renglon, 'precio') }));
}

// Nombre de cada lista del sistema viejo → columna de articulos.csv
export const LISTAS = { 'lista unitaria': 'p1', 'lista odb': 'p2', 'lista restos': 'p3', '': 'p4' };
export const columnaDeLista = (nombre) => LISTAS[normal(nombre)] ?? null;

export function leerProveedores(texto, avisos = []) {
  const { encabezado, filas } = registros(texto, avisos, 'proveedores');
  const c = columnas(encabezado, { codigo: 'codigo interno', razon: 'razon social', cuit: 'cuit', telefono: 'telefono', email: 'email', descuento: 'descuento' }, 'proveedores');
  return filas.map(({ renglon, campos }) => ({
    renglon, codigo: campos[c.codigo], razon_social: campos[c.razon], cuit: campos[c.cuit], telefono: campos[c.telefono],
    email: campos[c.email], descuento: numero(campos[c.descuento]),
  }));
}

// productosxproveedor no trae el código del artículo: va por posición contra
// articulos.csv y se valida con el costo. Los pares de códigos repetidos vienen
// invertidos: si el costo cruza exacto con el otro renglón del mismo código, se
// corrige el par. Lo que no coincide queda marcado `coincide: false` (no se
// descarta): si su fecha es la del corte, es un costo más nuevo que el de articulos.
export function leerPorProveedor(texto, articulos, avisos = [], { corte = null } = {}) {
  const { encabezado, filas } = registros(texto, avisos, 'productosxproveedor');
  const c = columnas(encabezado, { codigo: 'codigo interno', proveedor: 'codigo del proveedor', costo: 'ultimo costo', fecha: 'fecha costo' }, 'productosxproveedor');
  if (filas.length !== articulos.length) {
    avisos.push({ archivo: 'productosxproveedor', aviso: `tiene ${filas.length} filas y articulos ${articulos.length}: no se puede cruzar por posición` });
    return [];
  }
  const igual = (a, b) => a != null && b != null && Math.abs(a - b) < 0.005;
  const out = filas.map(({ renglon, campos }, pos) => {
    const propio = campos[c.codigo];
    const a = articulos[pos];
    const costo = numero(campos[c.costo]);
    const r = { pos, renglon, codigo: a.codigo, proveedor: campos[c.proveedor], costo, fecha: fecha(campos[c.fecha]) };
    if (propio && propio !== a.codigo) return { ...r, coincide: false, motivo: `trae el código ${propio} y en esa posición está ${a.codigo}` };
    return { ...r, coincide: igual(costo, a.costo) };
  });
  // pares de códigos repetidos con el costo cruzado
  const porCodigo = new Map();
  articulos.forEach((a, i) => porCodigo.set(a.codigo, [...(porCodigo.get(a.codigo) ?? []), i]));
  for (const [codigo, pos] of porCodigo) {
    if (pos.length !== 2) continue;
    const [i, j] = pos;
    if (!out[i].coincide && !out[j].coincide && igual(out[i].costo, articulos[j].costo) && igual(out[j].costo, articulos[i].costo)) {
      const fi = out[i], fj = out[j];
      out[i] = { ...fj, pos: i, renglon: fi.renglon, codigo, coincide: true, corregido: 'par de código repetido con el costo cruzado' };
      out[j] = { ...fi, pos: j, renglon: fj.renglon, codigo, coincide: true, corregido: 'par de código repetido con el costo cruzado' };
    }
  }
  for (const r of out) {
    if (r.coincide) continue;
    r.mas_nuevo = !!(corte && r.fecha && r.fecha >= corte.slice(0, 10));
    avisos.push({ archivo: 'productosxproveedor', renglon: r.renglon, aviso: r.motivo ?? `el costo (${r.costo}, del ${r.fecha ?? '?'}) no coincide con el de articulos del código ${r.codigo} (${articulos[r.pos].costo})${r.mas_nuevo ? ': es del día del corte, más nuevo que articulos' : ''}: va a revisión con las dos versiones` });
  }
  return out;
}

// Clave con la que un cliente del sistema viejo queda en ODB (clientes.codigo_legacy).
// Lleva prefijo porque ODB ya usa códigos numéricos de OTRA numeración.
export const claveClienteOdb = (codigoViejo) => `st-${String(codigoViejo).trim()}`;

export function leerClientes(texto, avisos = []) {
  const { encabezado, filas } = registros(texto, avisos, 'clientes');
  const c = columnas(encabezado, {
    codigo: 'codigo interno', nombre: 'nombre y apellido', cuit: 'cuit', iva: 'condicion ante el iva', telefono: 'telefono',
    email: 'email', domicilio: 'domicilio', barrio: 'barrio', zona: 'zona', saldo: 'saldo actual', vendedor: 'vendedor',
  }, 'clientes');
  const out = filas.map(({ renglon, campos }) => ({
    renglon, codigo_viejo: campos[c.codigo], nombre: campos[c.nombre], cuit: campos[c.cuit], iva: campos[c.iva], telefono: campos[c.telefono],
    email: campos[c.email], domicilio: campos[c.domicilio], barrio: campos[c.barrio], zona: campos[c.zona],
    saldo: leerNumero(campos[c.saldo], avisos, 'clientes', renglon, 'saldo'), vendedor: campos[c.vendedor],
  }));
  for (const r of out) if (!codigoValido(r.codigo_viejo)) { r.invalido = true; avisos.push({ archivo: 'clientes', renglon: r.renglon, aviso: `código de cliente '${r.codigo_viejo}' inválido` }); }
  avisos.push({ archivo: 'clientes', aviso: 'el código de cliente del sistema viejo NO es clientes.codigo_legacy de ODB (otra numeración): cruzar por CUIT, DNI o teléfono y guardar con claveClienteOdb()' });
  return marcarRepetidos(out, 'codigo_viejo', 'clientes', avisos, 'código de cliente');
}

// Los movimientos de cuenta corriente son HISTORIAL: el saldo corrido del sistema
// viejo no es la suma de los importes (hay VENTA que no mueven el saldo y saltos).
// `importe` no se suma para armar un saldo: el saldo de apertura es el de la ficha.
export function leerCtaCte(texto, avisos = [], { corte = null } = {}) {
  const { encabezado, filas } = registros(texto, avisos, 'ctacte_clientes');
  const c = columnas(encabezado, { cliente: 'codigo del cliente', fecha: 'fecha', tipo: 'tipo', comprobante: 'numero de comprobante', importe: 'importe', saldo: 'saldo' }, 'ctacte_clientes');
  return filas.map(({ renglon, campos }) => ({
    renglon, codigo_viejo: campos[c.cliente],
    fecha: fechaEnRango(campos[c.fecha], { archivo: 'ctacte_clientes', renglon, corte, avisos }), fecha_original: campos[c.fecha],
    tipo: campos[c.tipo].toUpperCase(), comprobante: campos[c.comprobante],
    importe: leerNumero(campos[c.importe], avisos, 'ctacte_clientes', renglon, 'importe'),
    saldo: leerNumero(campos[c.saldo], avisos, 'ctacte_clientes', renglon, 'saldo'),
  }));
}

// Cruza la cuenta corriente con las fichas y deja a la vista que NO sirve para
// armar el saldo: suma de importes vs ficha, último saldo corrido vs ficha, saltos
// del saldo corrido y movimientos de códigos repetidos (dos personas mezcladas).
export function validarCtaCte(ctacte, clientes, avisos = []) {
  const ficha = new Map(), repetidos = new Set();
  for (const c of clientes) { if (c.repetido) repetidos.add(c.codigo_viejo); ficha.set(c.codigo_viejo, (ficha.get(c.codigo_viejo) ?? 0) + (c.saldo ?? 0)); }
  const porCliente = new Map();
  for (const m of ctacte) (porCliente.get(m.codigo_viejo) ?? porCliente.set(m.codigo_viejo, []).get(m.codigo_viejo)).push(m);
  const r = { clientes: porCliente.size, suma_importes: 0, suma_fichas: 0, no_suman: 0, ultimo_saldo_distinto: 0, saltos: 0, saldos_absurdos: 0, de_repetidos: 0, sin_ficha: 0 };
  for (const c of clientes) r.suma_fichas += c.saldo ?? 0;
  const SALDO_ABSURDO = 1e9;
  for (const [cod, ms] of porCliente) {
    let suma = 0, anterior = null, saltos = 0, absurdos = 0;
    for (const m of ms) {
      suma += m.importe ?? 0;
      if (anterior != null && m.saldo != null && m.importe != null && Math.abs(anterior + m.importe - m.saldo) > 0.01) saltos++;
      if (Math.abs(m.saldo ?? 0) > SALDO_ABSURDO) absurdos++;
      anterior = m.saldo;
    }
    r.suma_importes += suma; r.saltos += saltos; r.saldos_absurdos += absurdos;
    if (repetidos.has(cod)) { r.de_repetidos++; for (const m of ms) m.cliente_repetido = true; }
    if (!ficha.has(cod)) { r.sin_ficha++; avisos.push({ archivo: 'ctacte_clientes', aviso: `cliente ${cod}: tiene movimientos y no tiene ficha en clientes.csv` }); continue; }
    const f = ficha.get(cod);
    const noSuma = Math.abs(suma - f) > 0.01, ultimoDistinto = Math.abs((ms.at(-1).saldo ?? 0) - f) > 0.01;
    if (noSuma) r.no_suman++;
    if (ultimoDistinto) r.ultimo_saldo_distinto++;
    if (noSuma || ultimoDistinto || saltos || absurdos) {
      avisos.push({ archivo: 'ctacte_clientes', aviso: `cliente ${cod}: ficha ${f.toFixed(2)}, suma de importes ${suma.toFixed(2)}, último saldo corrido ${(ms.at(-1).saldo ?? 0).toFixed(2)}, ${saltos} saltos${absurdos ? `, ${absurdos} saldos de más de mil millones` : ''}${repetidos.has(cod) ? ', código repetido (dos personas)' : ''}` });
    }
  }
  avisos.push({ archivo: 'ctacte_clientes', aviso: `los movimientos suman ${r.suma_importes.toFixed(2)} y las fichas ${r.suma_fichas.toFixed(2)}: en ${r.no_suman} de ${r.clientes} clientes la suma no da la ficha y el saldo corrido salta ${r.saltos} veces. Se usan solo como historial; el saldo de apertura es el de la ficha` });
  return r;
}

// ventas.csv pesa ~37 MB (474.502 renglones): se recorre renglón por renglón.
// No trae hora: el día del corte viene a medias (ver periodosHistorial en reglas.mjs).
export function* recorrerVentas(texto, avisos = [], { corte = null } = {}) {
  const fin = texto.indexOf('\r\n');
  const encabezado = texto.slice(0, fin).split(';').map(limpiar);
  const c = columnas(encabezado, {
    fecha: 'fecha', sucursal: 'sucursal', comprobante: 'numero de ticket', codigo: 'codigo del producto', cantidad: 'cantidad',
    precio: 'precio unitario', medio: 'medio de pago', cliente: 'cliente',
  }, 'ventas');
  let desde = fin + 2, renglon = 1;
  while (desde < texto.length) {
    let hasta = texto.indexOf('\r\n', desde);
    if (hasta < 0) hasta = texto.length;
    const linea = texto.slice(desde, hasta);
    desde = hasta + 2; renglon++;
    if (!linea) continue;
    const campos = linea.split(';');
    if (campos.length !== encabezado.length) { avisos.push({ archivo: 'ventas', renglon, aviso: `tiene ${campos.length} campos: no se usa` }); continue; }
    yield {
      renglon, fecha: fechaEnRango(campos[c.fecha], { archivo: 'ventas', renglon, corte, avisos }), sucursal: campos[c.sucursal].trim(),
      sucursal_id: SUCURSALES[normal(campos[c.sucursal])] ?? null, comprobante: campos[c.comprobante], codigo: campos[c.codigo].trim(),
      cantidadTexto: campos[c.cantidad].trim(), cantidad: leerNumero(campos[c.cantidad], avisos, 'ventas', renglon, 'cantidad'), precio: numero(campos[c.precio]),
      medio: campos[c.medio].trim(), cliente: limpiar(campos[c.cliente]),
    };
  }
}

// ---------------------------------------------------------------- todo junto
export function leerExportacion(dir, { ventas = true } = {}) {
  const avisos = [];
  const txt = (n) => readFileSync(join(dir, `${n}.csv`)).toString('latin1');
  const articulos = leerArticulos(txt('articulos'), avisos);
  const stock = leerStock(txt('stock'), articulos, avisos);
  const cortes = [...stock.values()].map((s) => s.corte).filter(Boolean).sort();
  const corte = cortes.at(-1) ?? null;
  const diaCorte = corte?.slice(0, 10) ?? null;
  const clientes = leerClientes(txt('clientes'), avisos);
  const ctacte = leerCtaCte(txt('ctacte_clientes'), avisos, { corte: diaCorte });
  const exp = {
    dir, corte, diaCorte, articulos, stock,
    barras: leerBarras(txt('codigobarras'), avisos),
    listas: leerListas(txt('listadeprecios'), articulos, avisos),
    proveedores: leerProveedores(txt('proveedores'), avisos),
    porProveedor: leerPorProveedor(txt('productosxproveedor'), articulos, avisos, { corte }),
    clientes, ctacte, ctacteResumen: validarCtaCte(ctacte, clientes, avisos),
    avisos,
  };
  if (ventas) exp.ventasTexto = txt('ventas');
  return exp;
}
