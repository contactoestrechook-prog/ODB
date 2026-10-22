#!/usr/bin/env node
// Paso 1 de la carga de la EXPORTACIÓN completa del sistema viejo (9 .csv): SOLO
// LEE (los .csv y la base por GET) y deja en --salida:
//   - informe-exportacion.xlsx: lo que cambiaría, entidad por entidad, la hoja
//     Revisar (lo que NO se aplica sin que el dueño lo apruebe) y las decisiones;
//   - plan-<entidad>.json: lo que preparar.mjs guarda en auditoria y aplicar/<entidad>.sql aplica;
//   - resumen.json: los números.
// Entidades, en el orden en que se aplican: proveedores, articulos, precios,
// costos, barras, clientes, ctacte, historial y stock (el stock al final, con el
// sistema viejo congelado y una exportación nueva).
//
// Mismas reglas que el circuito de las planillas (actualizar.mjs): cruce por
// productos.codigo_legacy, precios como vigencia NUEVA en Minorista, stock por
// diferencia con registrar_movimiento, negativos → 0, lo dudoso a revisión y lo
// que la exportación no trae no se toca. Las reglas están en reglas.mjs.
//
// Uso (desde apps/api, que tiene el .env):
//   node ../../scripts/sistema-viejo/exportacion/simular.mjs --exportacion <dir con los .csv> --salida <dir> [--equivalencias <csv>]
// --equivalencias: proveedores del viejo que el dueño confirmó que son uno de ODB
// ("código del viejo;razón social o id del proveedor de ODB", uno por renglón).
// La exportación y la salida van AFUERA del repo: traen datos de clientes.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { conexion, xlsx, fueraDelRepo, SUC_ST, REFERENCIA } from './base.mjs';
import { leerExportacion, recorrerVentas, columnaDeLista, claveClienteOdb } from './leer.mjs';
import {
  r2, r3, pesos, variacion, normal, mismoArticulo, VINCULAR_MIN, resolver, MOTIVO_ESTADO, reglaPeso, RUBRO_ALCOHOL,
  motivoPrecio, motivoMayorista, reglaCosto, objetivoStock, reglaBarra, cuitValido, dniDeCuit, telefono, claveTelefono,
  emailValido, claveProveedor, parecidoProveedor, claveNombre, condicionIva, CONDICIONES_IVA, cruzarCliente,
  CONCEPTO_SALDO_INICIAL, saldoInicial, periodosHistorial, periodoDe, renglonAbsurdo, PISO_PRECIO,
} from './reglas.mjs';

const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
const DIR = arg('--exportacion'), SALIDA = arg('--salida'), EQUIV = arg('--equivalencias');
if (!DIR || !SALIDA) { console.error('Uso: simular.mjs --exportacion <dir> --salida <dir> [--equivalencias <csv>]'); process.exit(1); }
fueraDelRepo(DIR, '--exportacion'); fueraDelRepo(SALIDA, '--salida');
const XLSX = xlsx();
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);

// ---------------------------------------------------------------- exportación
const exp = leerExportacion(DIR);
const CORTE = exp.corte, DIA_CORTE = exp.diaCorte;
const corteTexto = new Date(CORTE).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).replace(',', '');
const stST = exp.stock.get(SUC_ST);
if (!stST) throw new Error('la exportación no trae stock de Sant Thomas');
log(`exportación: corte ${CORTE}, ${exp.articulos.length} artículos, ${exp.clientes.length} clientes, ${exp.avisos.length} avisos de lectura`);

// ---------------------------------------------------------------- base (solo GET)
const { todo } = conexion();
const [productos, categorias, listas, stockST, cargas, proveedores, provProd, costosHist, barrasOdb, clientes, ctacteOdb, vhPeriodos, pedidos] = await Promise.all([
  todo('productos', 'id,sku,codigo_legacy,nombre,activo,costo,vendido_por_peso,categoria_id'),
  todo('categorias', 'id,nombre'),
  todo('listas_precios', 'id,nombre'),
  todo('stock', 'producto_id,cantidad', `&sucursal_id=eq.${SUC_ST}`, 'producto_id.asc'),
  todo('auditoria', 'id,entidad,entidad_id,aplicado_en:datos_antes->aplicado->>en', '&accion=eq.importacion_sistema_viejo'),
  todo('proveedores', 'id,razon_social,cuit,telefono,email,activo'),
  todo('proveedor_productos', 'proveedor_id,producto_id,ultimo_costo,actualizado_en', '', 'proveedor_id.asc,producto_id.asc'),
  todo('costos_historial', 'id,producto_id,proveedor_id,costo,creado_en,origen'),
  todo('codigos_barras', 'codigo,producto_id', '', 'codigo.asc'),
  todo('clientes', 'id,nombre,razon_social,cuit,dni,telefono,email,codigo_legacy,condicion_iva,saldo_cta_cte,cta_cte_habilitada,barrio'),
  todo('cuenta_corriente', 'id,cliente_id,concepto,debe,haber'),
  todo('ventas_historicas', 'id,origen,sucursal_id,desde,hasta'),
  todo('pedidos', 'id,estado,creado_en', `&sucursal_id=eq.${SUC_ST}&reserva_stock=is.true&estado=in.(recibido,pagado,en_preparacion,listo,en_camino)`),
]);
const lista = (n) => { const l = listas.find((x) => x.nombre === n); if (!l) throw new Error(`no encuentro la lista ${n}`); return l; };
const MINORISTA = lista('Minorista'), MAYORISTA = lista('Mayorista');
const [preciosMin, preciosMay] = await Promise.all([
  todo('precios', 'id,producto_id,precio,vigente_desde', `&lista_id=eq.${MINORISTA.id}`),
  todo('precios', 'id,producto_id,precio,vigente_desde', `&lista_id=eq.${MAYORISTA.id}`),
]);
// la carga anterior aplicada (la de las planillas o una de esta exportación)
const anterior = cargas.filter((c) => c.aplicado_en).sort((a, b) => a.aplicado_en.localeCompare(b.aplicado_en)).at(-1) ?? null;
const movDesde = anterior ? await todo('movimientos_stock', 'id,producto_id,tipo,cantidad,referencia_tipo,referencia_id', `&sucursal_id=eq.${SUC_ST}&creado_en=gt.${encodeURIComponent(anterior.aplicado_en)}`) : [];
const movPedidos = pedidos.length ? await todo('movimientos_stock', 'id,producto_id,cantidad,referencia_id', `&sucursal_id=eq.${SUC_ST}&referencia_tipo=eq.pedido`) : [];
log(`base: ${productos.length} productos, ${preciosMin.length}+${preciosMay.length} vigencias, ${clientes.length} clientes, ${barrasOdb.length} códigos; carga anterior ${anterior?.entidad_id ?? '—'} (${anterior?.aplicado_en ?? '—'})`);

const porId = new Map(productos.map((p) => [p.id, p]));
const porCodigo = new Map(productos.filter((p) => p.codigo_legacy).map((p) => [String(p.codigo_legacy).trim(), p]));
const vigenteDe = (filas) => {
  const m = new Map();
  for (const f of filas) { const v = m.get(f.producto_id); if (!v || f.vigente_desde > v.vigente_desde || (f.vigente_desde === v.vigente_desde && f.id > v.id)) m.set(f.producto_id, f); }
  return m;
};
const vigMin = vigenteDe(preciosMin), vigMay = vigenteDe(preciosMay);
const stockActual = new Map(stockST.map((s) => [s.producto_id, Number(s.cantidad)]));
const barraDe = new Map(barrasOdb.map((b) => [b.codigo, b.producto_id]));

// ---------------------------------------------------------------- ventas (una pasada)
// por código: cuántas veces, con decimales, unidades en 90 días, desde la carga
// anterior; y el agregado por período para ventas_historicas
const periodos = periodosHistorial({
  primero: (() => { for (const v of recorrerVentas(exp.ventasTexto, [], {})) if (v.fecha) return v.fecha; })(),
  corte: CORTE,
  existentes: vhPeriodos.filter((v) => v.sucursal_id === SUC_ST).reduce((acc, v) => (acc.some((a) => a.desde === v.desde && a.hasta === v.hasta) ? acc : [...acc, v]), []),
});
const masDias = (s, n) => new Date(new Date(`${s}T00:00:00Z`).getTime() + n * 86400_000).toISOString().slice(0, 10);
const DESDE_90 = masDias(DIA_CORTE, -90), DESDE_365 = masDias(DIA_CORTE, -365);
const DESDE_ANTERIOR = anterior?.aplicado_en ? new Date(new Date(anterior.aplicado_en).getTime() - 3 * 3600_000).toISOString().slice(0, 10) : null;
const ventas = new Map();
const agregado = new Map(), porMedio = new Map(), absurdos = [];
const fueraDePeriodo = { renglones: 0, unidades: 0 };
let renglonesST = 0;
for (const v of recorrerVentas(exp.ventasTexto, exp.avisos, { corte: DIA_CORTE })) {
  if (v.sucursal_id !== SUC_ST || v.cantidad == null || Number.isNaN(v.cantidad) || !v.fecha) continue;
  renglonesST++;
  const x = ventas.get(v.codigo) ?? ventas.set(v.codigo, { n: 0, conDecimales: 0, u90: 0, desdeAnterior: 0, ultima: null }).get(v.codigo);
  x.n++;
  if (!Number.isInteger(v.cantidad)) x.conDecimales++;
  if (v.fecha >= DESDE_90) x.u90 += v.cantidad;
  if (DESDE_ANTERIOR && v.fecha >= DESDE_ANTERIOR) x.desdeAnterior += v.cantidad;
  if (!x.ultima || v.fecha > x.ultima) x.ultima = v.fecha;
  const malo = renglonAbsurdo(v);
  if (malo) { absurdos.push({ fecha: v.fecha, comprobante: v.comprobante, codigo: v.codigo, cantidad: v.cantidad, precio: v.precio, motivo: malo }); continue; }
  const i = periodoDe(periodos, v.fecha);
  if (i < 0) { fueraDePeriodo.renglones++; fueraDePeriodo.unidades += v.cantidad; continue; }
  const k = `${v.codigo}|${i}`;
  const a = agregado.get(k) ?? agregado.set(k, { codigo: v.codigo, i, unidades: 0, importe: 0, renglones: 0 }).get(k);
  a.unidades += v.cantidad; a.importe += v.cantidad * (v.precio ?? 0); a.renglones++;
  const km = `${i}|${v.medio || '(sin dato)'}`;
  const m = porMedio.get(km) ?? porMedio.set(km, { i, medio: v.medio || '(sin dato)', comprobantes: new Set(), importe: 0 }).get(km);
  m.comprobantes.add(v.comprobante); m.importe += v.cantidad * (v.precio ?? 0);
}
delete exp.ventasTexto;
log(`ventas: ${renglonesST} renglones de ST, ${agregado.size} producto×período, ${absurdos.length} renglones absurdos`);

// ---------------------------------------------------------------- utilidades del plan
const revisar = [];   // { clave, entidad, tipo, motivo, ..., propuesta, aplicar: { seccion: [tupla] } }
const rev = (entidad, fila) => revisar.push({ entidad, ...fila });
const hojas = {};     // nombre → filas del Excel
const planes = {};
const resumen = {};

// ======================================================================= PROVEEDORES
{
  const odb = proveedores.filter((p) => !/\bprueba\b/i.test(p.razon_social));
  const porCuit = new Map(), porClave = new Map(), porId = new Map(odb.map((p) => [p.id, p]));
  for (const p of odb) {
    const c = cuitValido(p.cuit); if (c) porCuit.set(c, p);
    const k = claveProveedor(p.razon_social); (porClave.get(k) ?? porClave.set(k, []).get(k)).push(p);
  }
  // equivalencias confirmadas por el dueño
  const equiv = new Map();
  if (EQUIV) for (const l of readFileSync(EQUIV, 'utf8').split(/\r?\n/)) {
    const [cod, destino] = l.split(';').map((s) => s?.trim());
    if (!cod || !destino || !/^\d+$/.test(cod)) continue;
    const p = porId.get(destino) ?? odb.find((x) => normal(x.razon_social) === normal(destino));
    if (!p) throw new Error(`equivalencias: no encuentro el proveedor de ODB '${destino}'`);
    equiv.set(cod, p);
  }
  // proveedores que el viejo usa en productosxproveedor
  const usados = new Map();
  for (const pp of exp.porProveedor) if (pp.proveedor) usados.set(pp.proveedor, (usados.get(pp.proveedor) ?? 0) + 1);
  const mapa = new Map();     // código del viejo → { id } | { alta: [cuit, razon] } | null
  const altas = new Map(), completar = new Map(), hoja = [];
  const cuitsUsados = new Set(porCuit.keys());
  for (const v of exp.proveedores) {
    const cuit = cuitValido(v.cuit), clave = claveProveedor(v.razon_social);
    const fila = { codigo: v.codigo, razon_social: v.razon_social, cuit: v.cuit, articulos: usados.get(v.codigo) ?? 0 };
    let p = equiv.get(v.codigo) ?? null, por = p ? 'equivalencia del dueño' : null;
    if (!p && cuit && porCuit.has(cuit)) { p = porCuit.get(cuit); por = 'CUIT'; }
    if (!p && porClave.get(clave)?.length === 1) { p = porClave.get(clave)[0]; por = 'nombre'; }
    if (p) {
      mapa.set(v.codigo, { id: p.id, razon: p.razon_social });
      const c = completar.get(p.id) ?? { id: p.id, cuit: null, telefono: null, email: null };
      if (!cuitValido(p.cuit) && cuit && !cuitsUsados.has(cuit)) { c.cuit = cuit; cuitsUsados.add(cuit); }
      if (!p.telefono && telefono(v.telefono)) c.telefono = telefono(v.telefono);
      if (!p.email && emailValido(v.email)) c.email = emailValido(v.email);
      if (c.cuit || c.telefono || c.email) completar.set(p.id, c);
      hoja.push({ ...fila, que_se_hace: `es ${p.razon_social} (por ${por})`, completa: [c.cuit && 'CUIT', c.telefono && 'teléfono', c.email && 'email'].filter(Boolean).join(', ') });
      continue;
    }
    const candidatos = odb.map((o) => ({ o, s: parecidoProveedor(v.razon_social, o.razon_social) })).filter((x) => x.s >= 0.5).sort((a, b) => b.s - a.s);
    if (candidatos.length) {
      mapa.set(v.codigo, null);
      rev('proveedores', { clave: `proveedor:${v.codigo}`, tipo: 'proveedor', codigo: v.codigo, nombre_viejo: v.razon_social, nombre_odb: candidatos.slice(0, 3).map((c) => c.o.razon_social).join(' / '),
        motivo: `¿es el mismo que ${candidatos[0].o.razon_social}? Si sí, anotarlo en el archivo de equivalencias y volver a simular (${usados.get(v.codigo) ?? 0} artículos)`, propuesta: candidatos[0].o.razon_social, aplicar: null });
      hoja.push({ ...fila, que_se_hace: 'a Revisar: se parece a uno de ODB' });
      continue;
    }
    if (!usados.get(v.codigo)) { mapa.set(v.codigo, null); hoja.push({ ...fila, que_se_hace: 'no se crea: ningún artículo lo tiene como proveedor del último costo' }); continue; }
    // alta (los repetidos del viejo con el mismo nombre se crean una sola vez)
    const k = cuit ?? `n:${clave}`;
    const a = altas.get(k) ?? altas.set(k, { razon: v.razon_social.trim(), cuit: cuit && !cuitsUsados.has(cuit) ? cuit : null, telefono: null, email: null, codigos: [] }).get(k);
    if (a.cuit) cuitsUsados.add(a.cuit);
    a.telefono ??= telefono(v.telefono); a.email ??= emailValido(v.email); a.codigos.push(v.codigo);
    mapa.set(v.codigo, { alta: [a.cuit, a.razon] });
    hoja.push({ ...fila, que_se_hace: 'se da de alta (queda «incompleto» hasta cargarle CUIT, teléfono, condición de pago y plazo)' });
  }
  // dos altas con la misma razón social (una con CUIT y otra sin): una sola
  const porRazon = new Map();
  for (const [k, a] of altas) { const kk = claveProveedor(a.razon); if (porRazon.has(kk)) { const b = porRazon.get(kk); b.codigos.push(...a.codigos); for (const c of a.codigos) mapa.set(c, { alta: [b.cuit, b.razon] }); altas.delete(k); } else porRazon.set(kk, a); }
  planes.proveedores = {
    formato: { altas: ['razon_social', 'cuit', 'telefono', 'email', 'codigos_viejos'], completar: ['proveedor_id', 'cuit', 'telefono', 'email'] },
    secciones: {
      altas: [...altas.values()].map((a) => [a.razon, a.cuit, a.telefono, a.email, a.codigos.join('+')]),
      completar: [...completar.values()].map((c) => [c.id, c.cuit, c.telefono, c.email]),
    },
  };
  hojas['Proveedores'] = hoja;
  resumen.proveedores = {
    en_el_viejo: exp.proveedores.length, ya_estan: [...mapa.values()].filter((m) => m?.id).length, altas: altas.size,
    se_completan: completar.size, a_revisar: revisar.filter((r) => r.entidad === 'proveedores').length,
    sin_articulos_no_se_crean: hoja.filter((h) => h.que_se_hace.startsWith('no se crea')).length,
  };
  var mapaProveedores = mapa;   // lo usan los costos
}

// ======================================================================= ARTÍCULOS
const renglones = exp.articulos.filter((a) => !a.invalido).map((a) => ({
  codigo: a.codigo, descripcion: a.descripcion, rubro: a.rubro, pos: a.pos, pack: a.pack, costo: a.costo, p1: a.p1, p4: a.p4,
  cantidad: stST.alineado ? stST.filas[a.pos].cantidad : null,
}));
const res = resolver(renglones, porCodigo);
// final: código → { p (producto de ODB o null), r (renglón del viejo), alta, vinculado }
const final = new Map();
{
  const usosCat = new Map(); for (const p of productos) if (p.activo) usosCat.set(p.categoria_id, (usosCat.get(p.categoria_id) ?? 0) + 1);
  const categoriaDe = (rubro) => categorias.filter((c) => normal(c.nombre) === normal(rubro)).sort((a, b) => (usosCat.get(b.id) ?? 0) - (usosCat.get(a.id) ?? 0))[0] ?? null;
  const sinCodigo = productos.filter((p) => p.activo && !p.codigo_legacy);
  const nombreConCodigo = new Map(productos.filter((p) => p.codigo_legacy).map((p) => [normal(p.nombre), p]));
  const vincular = [], altas = [], peso = [], hojaAltas = [], hojaPeso = [];
  const yaVinculado = new Set();
  for (const x of res) {
    const v = ventas.get(x.codigo) ?? { n: 0, conDecimales: 0, u90: 0 };
    const base = { codigo: x.codigo, sku: x.p?.sku ?? '', nombre_odb: x.p?.nombre ?? '', nombre_viejo: x.r.descripcion };
    for (const s of x.sobrantes) {
      rev('articulos', { clave: `repetido:${x.codigo}:${s.pos}`, tipo: 'artículo', ...base, nombre_viejo: s.descripcion, motivo: `código ${x.codigo} repetido en el sistema viejo: en ODB es ${x.p.nombre}; este otro artículo no tiene producto propio (darle un código nuevo en el viejo)`, propuesta: '', aplicar: null });
    }
    if (x.estado === 'ok') {
      final.set(x.codigo, { p: x.p, r: x.r });
      const rp = reglaPeso({ nombre: x.r.descripcion, ventas: v.n, conDecimales: v.conDecimales, yaPorPeso: x.p.vendido_por_peso });
      if (rp.estado === 'marcar') { peso.push([x.codigo]); hojaPeso.push({ ...base, ventas: v.n, con_decimales: v.conDecimales, motivo: rp.motivo, se_aplica: 'sí' }); }
      if (rp.estado === 'dudoso') {
        hojaPeso.push({ ...base, ventas: v.n, con_decimales: v.conDecimales, motivo: rp.motivo, se_aplica: 'no: a Revisar' });
        rev('articulos', { clave: `peso:${x.codigo}`, tipo: 'por peso', ...base, motivo: rp.motivo, antes: 'por unidad', propuesta: 'por peso', aplicar: { peso: [[x.codigo]] } });
      }
      continue;
    }
    if (x.estado === 'inactivo') {
      const vendeOTiene = v.u90 > 0 || Number(x.r.cantidad) > 0;
      if (vendeOTiene) rev('articulos', { clave: `reactivar:${x.codigo}`, tipo: 'artículo', ...base, motivo: `${MOTIVO_ESTADO.inactivo} y el viejo lo sigue vendiendo (${r3(v.u90)} u en 90 días, stock ${x.r.cantidad})`, antes: 'dado de baja', propuesta: 'reactivar', aplicar: { reactivar: [[x.codigo]] } });
      continue;
    }
    if (x.estado !== 'sin_producto') {
      rev('articulos', { clave: `articulo:${x.codigo}`, tipo: 'artículo', ...base, nombre_viejo: x.todos.map((t) => t.descripcion).join(' / '), motivo: MOTIVO_ESTADO[x.estado], propuesta: '', aplicar: null });
      continue;
    }
    // ---- código que ODB no tiene
    const r = x.r;
    if (!(r.p1 >= PISO_PRECIO)) { rev('articulos', { clave: `alta:${x.codigo}`, tipo: 'alta', ...base, motivo: `alta sin precio válido ($${pesos(r.p1)})`, propuesta: '', aplicar: null }); continue; }
    const mismoNombre = nombreConCodigo.get(normal(r.descripcion));
    if (mismoNombre) { rev('articulos', { clave: `alta:${x.codigo}`, tipo: 'alta', ...base, sku: mismoNombre.sku, nombre_odb: mismoNombre.nombre, motivo: `ya existe con el código ${mismoNombre.codigo_legacy}: duplicado en el sistema viejo`, propuesta: '', aplicar: null }); continue; }
    const candidatos = sinCodigo.filter((p) => !yaVinculado.has(p.id)).map((p) => ({ p, s: mismoArticulo(r.descripcion, p.nombre) })).filter((c) => c.s >= VINCULAR_MIN)
      .sort((a, b) => (stockActual.get(b.p.id) ?? 0) - (stockActual.get(a.p.id) ?? 0) || b.s - a.s);
    if (candidatos.length) {
      const p = candidatos[0].p; yaVinculado.add(p.id);
      vincular.push([p.id, x.codigo, p.nombre]);
      final.set(x.codigo, { p, r, vinculado: true });
      hojaAltas.push({ codigo: x.codigo, nombre_viejo: r.descripcion, rubro: r.rubro, precio: r.p1, que_se_hace: `se VINCULA a ${p.sku} ${p.nombre} (no tiene código viejo)${candidatos.length > 1 ? `; también se parece a ${candidatos.slice(1, 3).map((c) => c.p.sku).join(', ')}` : ''}` });
      continue;
    }
    const cat = categoriaDe(r.rubro);
    const rp = reglaPeso({ nombre: r.descripcion, ventas: v.n, conDecimales: v.conDecimales });
    altas.push([x.codigo, r.descripcion.trim(), cat?.id ?? null, RUBRO_ALCOHOL.test(String(r.rubro).trim()), r2(r.p1), rp.estado === 'marcar']);
    final.set(x.codigo, { p: null, r, alta: true });
    hojaAltas.push({ codigo: x.codigo, nombre_viejo: r.descripcion, rubro: r.rubro, categoria: cat?.nombre ?? '(sin categoría)', alcohol: RUBRO_ALCOHOL.test(String(r.rubro).trim()) ? 'sí' : '', por_peso: rp.estado === 'marcar' ? 'sí' : '', precio: r.p1, stock_viejo: r.cantidad, que_se_hace: 'se da de alta' });
  }
  // activos de ODB que el viejo ya no tiene: no se tocan
  const enExp = new Set(renglones.map((r) => r.codigo));
  const fuera = productos.filter((p) => p.activo && p.codigo_legacy && !enExp.has(String(p.codigo_legacy).trim()))
    .map((p) => ({ codigo: p.codigo_legacy, sku: p.sku, nombre_odb: p.nombre, stock_st: stockActual.get(p.id) ?? 0, vendido_en_el_año: ventas.get(String(p.codigo_legacy))?.n ?? 0 }));
  planes.articulos = {
    formato: { vincular: ['producto_id', 'codigo', 'nombre_odb'], altas: ['codigo', 'nombre', 'categoria_id', 'es_alcohol', 'precio', 'por_peso'], peso: ['codigo'], reactivar: ['codigo'] },
    datos: { lista_id: MINORISTA.id },
    secciones: { vincular, altas, peso, reactivar: [] },
  };
  hojas['Altas y vínculos'] = hojaAltas;
  hojas['Por peso'] = hojaPeso;
  hojas['Fuera del viejo'] = fuera;
  const est = (e) => res.filter((x) => x.estado === e).length;
  resumen.articulos = {
    en_el_viejo: renglones.length, codigos: res.length, cruzan_bien: est('ok'), altas: altas.length, se_vinculan: vincular.length,
    altas_sin_categoria: altas.filter((a) => !a[2]).length, pasan_a_por_peso: peso.length,
    nombre_distinto: est('nombre_distinto'), dados_de_baja_en_odb: est('inactivo'), repetidos: res.filter((x) => x.todos.length > 1).length,
    activos_de_odb_que_el_viejo_no_tiene: fuera.length, de_esos_con_stock_en_st: fuera.filter((f) => f.stock_st !== 0).length,
    pack_del_viejo_distinto_no_se_carga: renglones.filter((r) => r.pack > 1).length,
    a_revisar: revisar.filter((r) => r.entidad === 'articulos').length,
  };
}
// productos que reciben precio, costo, códigos y stock: los que cruzan bien, los
// vinculados y las altas (estas se resuelven por código al aplicar)
const conProducto = [...final.entries()].filter(([, f]) => f.p);
log(`artículos: ${resumen.articulos.cruzan_bien} cruzan, ${resumen.articulos.altas} altas, ${resumen.articulos.se_vinculan} vínculos`);

// ======================================================================= PRECIOS
const precioFinal = new Map();   // código → precio minorista que queda
{
  const lista1 = new Map();
  for (const l of exp.listas) if (columnaDeLista(l.lista) === 'p1') (lista1.get(l.codigo) ?? lista1.set(l.codigo, []).get(l.codigo)).push(l.precio);
  const desdeCarga = anterior?.aplicado_en ?? null;
  const minorista = [], mayorista = [], hojaMin = [], hojaMay = [];
  let iguales = 0, igualesMay = 0;
  for (const [codigo, { p, r }] of conProducto) {
    const nuevo = r.p1;
    const vig = vigMin.get(p.id), actual = vig ? Number(vig.precio) : null;
    precioFinal.set(codigo, actual);
    const fila = { codigo, sku: p.sku, nombre_odb: p.nombre, nombre_viejo: r.descripcion, antes: pesos(actual), ahora: pesos(nuevo), variacion: variacion(nuevo, actual) };
    const enLista = lista1.get(codigo) ?? [];
    if (enLista.length && !enLista.some((x) => Math.abs(x - nuevo) < 0.005)) {
      const otro = enLista.length === 1 ? enLista[0] : null;
      rev('precios', { clave: `precio:${codigo}`, tipo: 'precio', ...fila, motivo: `la exportación trae dos precios: articulos $${pesos(nuevo)} y la lista de precios $${enLista.map(pesos).join(' / ')} (cambió mientras se exportaba)`, propuesta: pesos(otro),
        aplicar: otro != null && !motivoPrecio(otro, actual) ? { minorista: [[codigo, otro, actual]] } : null });
      continue;
    }
    if (actual != null && Math.abs(nuevo - actual) < 0.01) { iguales++; continue; }
    const motivo = motivoPrecio(nuevo, actual);
    if (motivo) { rev('precios', { clave: `precio:${codigo}`, tipo: 'precio', ...fila, motivo, propuesta: pesos(nuevo), aplicar: nuevo >= PISO_PRECIO ? { minorista: [[codigo, nuevo, actual]] } : null }); continue; }
    if (vig && desdeCarga && vig.vigente_desde > desdeCarga) {
      rev('precios', { clave: `precio:${codigo}`, tipo: 'precio', ...fila, motivo: `el precio se cambió en ODB el ${vig.vigente_desde.slice(0, 10)}, después de la última carga: ¿vale el de ODB o el del viejo?`, propuesta: pesos(nuevo), aplicar: { minorista: [[codigo, nuevo, actual]] } });
      continue;
    }
    minorista.push([codigo, nuevo, actual]); precioFinal.set(codigo, nuevo);
    hojaMin.push(fila);
  }
  for (const [codigo, { r }] of final) if (final.get(codigo).alta) precioFinal.set(codigo, r.p1);
  // ---- Mayorista desde la lista sin nombre del viejo (pendiente de decisión)
  for (const [codigo, { p, r }] of conProducto) {
    const nuevo = r.p4;
    if (nuevo == null) continue;
    const vig = vigMay.get(p.id), actual = vig ? Number(vig.precio) : null;
    if (actual != null && Math.abs(nuevo - actual) < 0.01) { igualesMay++; continue; }
    const costo = r.costo >= 1 ? r.costo : null;
    const motivo = motivoMayorista(nuevo, actual, { costo, minorista: precioFinal.get(codigo) });
    const fila = { codigo, sku: p.sku, nombre_odb: p.nombre, mayorista_hoy: pesos(actual), lista_sin_nombre: pesos(nuevo), variacion: variacion(nuevo, actual), costo_viejo: pesos(costo), minorista: pesos(precioFinal.get(codigo)) };
    if (motivo) { hojaMay.push({ ...fila, que_se_hace: `no: ${motivo}` }); continue; }
    mayorista.push([codigo, nuevo, actual]); hojaMay.push({ ...fila, que_se_hace: 'se aplica si el dueño elige esta lista' });
  }
  planes.precios = {
    formato: { minorista: ['codigo', 'precio', 'antes'], mayorista: ['codigo', 'precio', 'antes'] },
    datos: { lista_minorista: MINORISTA.id, lista_mayorista: MAYORISTA.id },
    secciones: { minorista, mayorista },
    pendientes: { mayorista: 'la lista Mayorista pasa a ser la lista sin nombre del viejo (≈ costo × 1,4): decisión del dueño' },
  };
  hojas['Precios que cambian'] = hojaMin.sort((a, b) => String(a.nombre_odb).localeCompare(String(b.nombre_odb)));
  hojas['Mayorista (propuesta)'] = hojaMay;
  const sube = minorista.filter((m) => m[2] != null && m[1] > m[2]).length;
  resumen.precios = {
    minorista_cambian: minorista.length, suben: sube, bajan: minorista.filter((m) => m[2] != null && m[1] < m[2]).length, no_tenian: minorista.filter((m) => m[2] == null).length,
    iguales, a_revisar: revisar.filter((r) => r.entidad === 'precios').length,
    mayorista_propuesta: mayorista.length, mayorista_iguales: igualesMay, mayorista_no_cumple: hojaMay.filter((h) => h.que_se_hace.startsWith('no')).length,
    lista_odb_y_restos: 'no se cargan (iguales al Precio 1 en el 99% y con errores ×10; decisión del 1/10)',
  };
}

// ======================================================================= COSTOS
{
  const ultimoOdb = new Map();
  for (const c of costosHist) { const u = ultimoOdb.get(c.producto_id); if (!u || c.creado_en > u.creado_en) ultimoOdb.set(c.producto_id, c); }
  const vinculo = new Map(provProd.map((v) => [`${v.proveedor_id}|${v.producto_id}`, v]));
  const costos = [], costosViejos = [], hoja = [];
  let iguales = 0, odbMasNuevo = 0, sinDato = 0;
  for (const [codigo, f] of final) {
    const { p, r } = f;
    const pp = exp.porProveedor[r.pos];
    const fecha = pp?.coincide && pp.fecha ? pp.fecha : DIA_CORTE;   // sin fecha legible: la del corte
    const prov = pp?.proveedor ? mapaProveedores.get(pp.proveedor) ?? null : null;
    const base = { codigo, sku: p?.sku ?? `L${codigo} (alta)`, nombre_odb: p?.nombre ?? '', nombre_viejo: r.descripcion, costo_odb: pesos(p ? Number(p.costo) || null : null), costo_viejo: pesos(r.costo), fecha, precio: pesos(precioFinal.get(codigo)) };
    if (pp && !pp.coincide && pp.costo > 0) {
      const rc2 = reglaCosto({ costo: pp.costo, precio: precioFinal.get(codigo) });
      rev('costos', { clave: `costo:${codigo}`, tipo: 'costo', ...base, motivo: `la exportación trae dos costos: articulos $${pesos(r.costo)} y productosxproveedor $${pesos(pp.costo)} del ${pp.fecha ?? '?'}`, antes: base.costo_odb, propuesta: rc2.estado === 'aplicar' ? rc2.costo : '',
        aplicar: rc2.estado === 'aplicar' ? { costos: [[codigo, rc2.costo, pp.fecha ?? DIA_CORTE, prov?.id ?? null, prov?.alta?.[0] ?? null, prov?.alta?.[1] ?? null, p ? Number(p.costo) || null : null]] } : null });
      continue;
    }
    const rc = reglaCosto({ costo: r.costo, precio: precioFinal.get(codigo) });
    if (rc.estado === 'sin_dato') { sinDato++; continue; }
    if (rc.estado === 'revisar') { rev('costos', { clave: `costo:${codigo}`, tipo: 'costo', ...base, motivo: rc.motivo, antes: base.costo_odb, propuesta: '', aplicar: null }); continue; }
    const deOdb = p ? ultimoOdb.get(p.id) : null;
    if (deOdb && deOdb.origen !== REFERENCIA && deOdb.creado_en.slice(0, 10) > fecha) { odbMasNuevo++; hoja.push({ ...base, que_se_hace: `no: ODB tiene un costo más nuevo ($${pesos(Number(deOdb.costo))} del ${deOdb.creado_en.slice(0, 10)})` }); continue; }
    const igualCosto = p && p.costo != null && Math.abs(Number(p.costo) - rc.costo) < 0.01;
    const v = p && prov?.id ? vinculo.get(`${prov.id}|${p.id}`) : null;
    const igualVinculo = !prov || (prov.id && v && Math.abs(Number(v.ultimo_costo) - rc.costo) < 0.01);
    if (igualCosto && igualVinculo) { iguales++; continue; }
    // un costo de hace más de un año (con la inflación) no sirve para el margen: lo decide el dueño
    const viejo = fecha < DESDE_365;
    (viejo ? costosViejos : costos).push([codigo, rc.costo, fecha, prov?.id ?? null, prov?.alta?.[0] ?? null, prov?.alta?.[1] ?? null, p ? Number(p.costo) || null : null]);
    hoja.push({ ...base, variacion: variacion(rc.costo, p ? Number(p.costo) : null), proveedor: prov?.razon ?? prov?.alta?.[1] ?? '(sin proveedor en ODB)', que_se_hace: viejo ? 'solo si el dueño lo decide: costo de hace más de un año' : 'se aplica' });
  }
  planes.costos = {
    formato: { costos: ['codigo', 'costo', 'fecha', 'proveedor_id', 'proveedor_cuit', 'proveedor_razon', 'antes'], costos_viejos: ['codigo', 'costo', 'fecha', 'proveedor_id', 'proveedor_cuit', 'proveedor_razon', 'antes'] },
    secciones: { costos, costos_viejos: costosViejos },
    pendientes: { costos_viejos: 'costos con fecha de hace más de un año (con la inflación muestran un margen que no es): decisión del dueño' },
  };
  hojas['Costos'] = hoja;
  resumen.costos = {
    cambian: costos.length, de_mas_de_un_anio_pendientes: costosViejos.length, sin_costo_hoy: costos.filter((c) => c[6] == null).length, con_proveedor_de_odb: costos.filter((c) => c[3]).length,
    con_proveedor_que_se_da_de_alta: costos.filter((c) => !c[3] && c[5]).length, sin_proveedor: costos.filter((c) => !c[3] && !c[5]).length,
    iguales, odb_tiene_uno_mas_nuevo: odbMasNuevo, sin_dato_en_el_viejo: sinDato, a_revisar: revisar.filter((r) => r.entidad === 'costos').length,
  };
}

// ======================================================================= CÓDIGOS DE BARRAS
{
  const agregar = [], quitar = [], hoja = [];
  const vistos = new Set();
  let yaEstan = 0, noSeCargan = 0;
  for (const b of exp.barras) {
    const k = `${b.codigo}|${b.ean}`; if (vistos.has(k)) continue; vistos.add(k);
    const f = final.get(b.codigo);
    const producto = f?.p ?? null, alta = !!f?.alta;
    const dueno = barraDe.get(b.ean) ?? null;
    const rb = reglaBarra(b, { producto, alta, dueno });
    const fila = { codigo: b.codigo, producto: producto?.nombre ?? (alta ? `${f.r.descripcion} (alta)` : ''), ean: b.ean, tipo: b.tipo, unidades: b.cantidad ?? '', en_odb: dueno ? `${porId.get(dueno)?.sku ?? '?'} ${porId.get(dueno)?.nombre ?? ''}` : '' };
    if (rb.accion === 'ya_esta') { yaEstan++; continue; }
    if (rb.accion === 'agregar') { agregar.push([b.ean, b.codigo]); hoja.push({ ...fila, que_se_hace: 'se agrega' }); continue; }
    if (rb.accion === 'no') { noSeCargan++; hoja.push({ ...fila, que_se_hace: `no se carga: ${rb.motivo}` }); continue; }
    if (rb.quitar) { quitar.push([b.ean, b.codigo, b.cantidad]); hoja.push({ ...fila, que_se_hace: `se QUITA si el dueño lo decide: ${rb.motivo}` }); continue; }
    const aprobable = b.tipo !== 'CAJA' || !(b.cantidad > 1);
    rev('barras', { clave: `barra:${b.ean}:${b.codigo}`, tipo: 'código de barras', codigo: b.codigo, nombre_odb: fila.producto, nombre_viejo: `${b.ean} (${b.tipo}${b.cantidad != null ? ` ×${b.cantidad}` : ''})`, motivo: rb.motivo, antes: fila.en_odb, propuesta: aprobable && !dueno ? 'cargarlo' : '',
      aplicar: aprobable && !dueno ? { agregar: [[b.ean, b.codigo]] } : null });
    hoja.push({ ...fila, que_se_hace: `a Revisar: ${rb.motivo}` });
  }
  planes.barras = {
    formato: { agregar: ['ean', 'codigo'], quitar_cajas: ['ean', 'codigo', 'unidades'] },
    secciones: { agregar, quitar_cajas: quitar },
    pendientes: { quitar_cajas: 'sacar de ODB los códigos de CAJA que hoy se cobran como 1 unidad (hasta que la caja sepa multiplicar): decisión del dueño' },
  };
  hojas['Códigos de barras'] = hoja;
  resumen.barras = {
    en_el_viejo: exp.barras.length, ya_estan: yaEstan, se_agregan: agregar.length, de_altas: agregar.filter((a) => final.get(a[1])?.alta).length,
    cajas_ya_cargadas_que_cobran_1: quitar.length, no_se_cargan: noSeCargan, a_revisar: revisar.filter((r) => r.entidad === 'barras').length,
  };
}

// ======================================================================= CLIENTES
const clienteDe = new Map();   // código del viejo → { id } | { alta: true } | { revisar: true } | { no: true }
{
  const idx = { porCuit: new Map(), porNombre: new Map(), porTelefono: new Map(), porEmail: new Map(), porDni: new Map() };
  const add = (m, k, id) => { if (!k) return; const l = m.get(k) ?? m.set(k, []).get(k); if (!l.includes(id)) l.push(id); };
  const cli = new Map(clientes.map((c) => [c.id, c]));
  for (const c of clientes) {
    add(idx.porCuit, cuitValido(c.cuit), c.id);
    add(idx.porNombre, claveNombre(c.nombre), c.id); if (c.razon_social) add(idx.porNombre, claveNombre(c.razon_social), c.id);
    add(idx.porTelefono, claveTelefono(c.telefono), c.id);
    add(idx.porEmail, emailValido(c.email), c.id);
    if (c.dni) add(idx.porDni, String(Number(String(c.dni).replace(/\D/g, '')) || ''), c.id);
  }
  const nombreDe = (id) => cli.get(id)?.nombre ?? '';
  const codigosOdb = new Set(clientes.map((c) => c.codigo_legacy).filter(Boolean));
  const dnisOdb = new Set(clientes.map((c) => c.dni && String(Number(String(c.dni).replace(/\D/g, '')))).filter(Boolean));
  // movimiento de cuenta corriente en el último año (para decidir el alta)
  const movAnio = new Set(exp.ctacte.filter((m) => m.fecha && m.fecha >= DESDE_365).map((m) => m.codigo_viejo));
  const cruces = new Map();   // cliente_id → [código del viejo]
  const resultado = [];
  for (const v of exp.clientes) {
    if (v.invalido) continue;
    if (v.repetido) { resultado.push({ v, revisar: 'código repetido en el sistema viejo (dos personas con el mismo código)' }); continue; }
    const c = cruzarCliente(v, idx, nombreDe);
    if (c?.cliente_id) { resultado.push({ v, id: c.cliente_id, por: c.por }); (cruces.get(c.cliente_id) ?? cruces.set(c.cliente_id, []).get(c.cliente_id)).push(v.codigo_viejo); continue; }
    if (c?.revisar) { resultado.push({ v, revisar: c.revisar, candidatos: c.candidatos }); continue; }
    resultado.push({ v });
  }
  const altas = [], vincular = [], hoja = [];
  const dnisNuevos = new Set();
  const dniLibre = (d) => d && !dnisOdb.has(d) && !dnisNuevos.has(d) && (dnisNuevos.add(d), true);
  let noSeCrean = 0;
  for (const x of resultado) {
    const { v } = x;
    const clave = claveClienteOdb(v.codigo_viejo);
    const cuit = cuitValido(v.cuit), tel = telefono(v.telefono), mail = emailValido(v.email);
    const iva = condicionIva(v.iva) ?? 'consumidor_final';
    const fila = { codigo: v.codigo_viejo, nombre: v.nombre, cuit: v.cuit, iva: v.iva, saldo: v.saldo ?? 0 };
    if (x.id && cruces.get(x.id).length > 1) x.revisar = `${cruces.get(x.id).length} clientes del viejo (${cruces.get(x.id).join(', ')}) caen en el mismo cliente de ODB`;
    if (x.revisar) {
      clienteDe.set(v.codigo_viejo, { revisar: true });
      rev('clientes', { clave: `cliente:${v.codigo_viejo}:${v.renglon}`, tipo: 'cliente', codigo: v.codigo_viejo, nombre_viejo: v.nombre, nombre_odb: (x.candidatos ?? (x.id ? [x.id] : [])).map(nombreDe).join(' / '), motivo: x.revisar, propuesta: '', aplicar: null });
      hoja.push({ ...fila, que_se_hace: `a Revisar: ${x.revisar}` });
      continue;
    }
    if (x.id) {
      const o = cli.get(x.id);
      const d = !o.dni ? dniDeCuit(cuit) : null;
      const ivaOdbValida = CONDICIONES_IVA.includes(o.condicion_iva);
      const cuitFinal = cuitValido(o.cuit) ?? cuit;
      let ivaNueva = null;
      if (!ivaOdbValida) ivaNueva = condicionIva(o.condicion_iva) ?? iva;
      else if (o.condicion_iva === 'consumidor_final' && iva !== 'consumidor_final' && cuitFinal) ivaNueva = iva;
      if (ivaNueva === o.condicion_iva) ivaNueva = null;
      const t = [x.id, v.codigo_viejo, !cuitValido(o.cuit) && cuit ? cuit : null, d && dniLibre(d) ? d : null, !o.telefono && tel ? tel : null, !o.email && mail ? mail : null, ivaNueva, !o.barrio && v.barrio ? v.barrio : null];
      vincular.push(t);
      clienteDe.set(v.codigo_viejo, { id: x.id });
      hoja.push({ ...fila, que_se_hace: `es ${o.nombre} (por ${x.por})${o.codigo_legacy ? ` — conserva su código ${o.codigo_legacy}` : ` — queda con código ${clave}`}`, completa: [t[2] && 'CUIT', t[3] && 'DNI', t[4] && 'teléfono', t[5] && 'email', t[6] && `IVA → ${t[6]}`, t[7] && 'barrio'].filter(Boolean).join(', ') });
      continue;
    }
    const activo = Math.abs(v.saldo ?? 0) >= 0.01 || movAnio.has(v.codigo_viejo) || cuit || tel || mail;
    if (!activo) { noSeCrean++; clienteDe.set(v.codigo_viejo, { no: true }); hoja.push({ ...fila, que_se_hace: 'no se crea: sin CUIT, teléfono ni email, sin saldo y sin movimientos en el último año' }); continue; }
    if (codigosOdb.has(clave)) { clienteDe.set(v.codigo_viejo, { revisar: true }); rev('clientes', { clave: `cliente:${v.codigo_viejo}:${v.renglon}`, tipo: 'cliente', codigo: v.codigo_viejo, nombre_viejo: v.nombre, motivo: `ya hay un cliente de ODB con el código ${clave}`, propuesta: '', aplicar: null }); continue; }
    let ivaAlta = iva;
    if (iva === 'responsable_inscripto' && !cuit) {
      ivaAlta = 'consumidor_final';
      rev('clientes', { clave: `cliente-iva:${v.codigo_viejo}`, tipo: 'cliente', codigo: v.codigo_viejo, nombre_viejo: v.nombre, motivo: 'responsable inscripto sin CUIT válido: se crea como consumidor final (la factura A pide CUIT); cargarle el CUIT', propuesta: '', aplicar: null });
    }
    const d = dniDeCuit(cuit);
    altas.push([v.codigo_viejo, v.nombre, cuit, d && dniLibre(d) ? d : null, ivaAlta, ivaAlta !== 'consumidor_final' ? v.nombre : null, tel, mail, v.barrio || null]);
    clienteDe.set(v.codigo_viejo, { alta: true });
    hoja.push({ ...fila, que_se_hace: `se da de alta con código ${clave}` });
  }
  // condición de IVA mal escrita en ODB (MAYÚSCULAS de la carga de junio): la
  // factura A pide 'responsable_inscripto' exacto
  const vinculados = new Set(vincular.map((t) => t[0]));
  const normalizarIva = clientes.filter((c) => !CONDICIONES_IVA.includes(c.condicion_iva) && !vinculados.has(c.id))
    .map((c) => [c.id, condicionIva(c.condicion_iva) ?? 'consumidor_final']);
  planes.clientes = {
    formato: {
      altas: ['codigo_viejo', 'nombre', 'cuit', 'dni', 'condicion_iva', 'razon_social', 'telefono', 'email', 'barrio'],
      vincular: ['cliente_id', 'codigo_viejo', 'cuit', 'dni', 'telefono', 'email', 'condicion_iva', 'barrio'],
      normalizar_iva: ['cliente_id', 'condicion_iva'],
    },
    secciones: { altas, vincular, normalizar_iva: normalizarIva },
  };
  // el mismo CUIT en dos clientes del viejo: se respetan las dos cuentas (cada una
  // tiene su saldo), pero queda a la vista
  const porCuitViejo = new Map();
  for (const v of exp.clientes) { const c = cuitValido(v.cuit); if (c) porCuitViejo.set(c, (porCuitViejo.get(c) ?? 0) + 1); }
  for (const h of hoja) { const c = cuitValido(h.cuit); if (c && porCuitViejo.get(c) > 1) h.nota = `el mismo CUIT está en ${porCuitViejo.get(c)} clientes del viejo`; }
  hojas['Clientes'] = hoja;
  const por = (t) => resultado.filter((x) => x.por?.includes(t)).length;
  resumen.clientes = {
    en_el_viejo: exp.clientes.length, ya_estan: vincular.length, por_cuit: por('CUIT'), por_nombre: por('nombre'), por_telefono: por('teléfono'), por_email: por('email'), por_dni: por('DNI'),
    altas: altas.length, altas_sin_contacto_con_saldo_o_movimiento: altas.filter((a) => !a[2] && !a[6] && !a[7]).length,
    no_se_crean: noSeCrean, con_cuit_repetido_en_el_viejo: hoja.filter((h) => h.nota).length, iva_en_mayusculas_que_se_corrige: normalizarIva.length + vincular.filter((t) => t[6] && !CONDICIONES_IVA.includes(cli.get(t[0]).condicion_iva)).length,
    a_revisar: revisar.filter((r) => r.entidad === 'clientes').length,
  };
}

// ======================================================================= CUENTA CORRIENTE
{
  const concepto = CONCEPTO_SALDO_INICIAL(corteTexto);
  const ultimo = new Map(), movs = new Map();
  for (const m of exp.ctacte) { ultimo.set(m.codigo_viejo, m.saldo); movs.set(m.codigo_viejo, (movs.get(m.codigo_viejo) ?? 0) + 1); }
  const repetidos = new Set(exp.clientes.filter((c) => c.repetido).map((c) => c.codigo_viejo));
  const ficha = new Map();
  for (const c of exp.clientes) if (!c.invalido) ficha.set(c.codigo_viejo, (ficha.get(c.codigo_viejo) ?? 0) + (c.saldo ?? 0));
  const saldos = [], hoja = [], habilitar = [];
  const conLibro = new Set(ctacteOdb.map((m) => m.cliente_id));
  const tocados = new Set();
  for (const [cod, f] of ficha) {
    const s = saldoInicial({ ficha: f, ultimoCorrido: ultimo.has(cod) ? ultimo.get(cod) : null, repetido: repetidos.has(cod) });
    if (!s) continue;
    const c = clienteDe.get(cod) ?? {};
    const fila = { codigo: cod, saldo: pesos(f), movimientos: movs.get(cod) ?? 0 };
    if (s.revisar || c.revisar || c.no) {
      const motivo = s.revisar ?? (c.revisar ? 'el cliente está a revisión: el saldo se carga cuando se resuelva' : 'el cliente no se crea');
      rev('ctacte', { clave: `saldo:${cod}`, tipo: 'cuenta corriente', codigo: cod, nombre_viejo: exp.clientes.find((x) => x.codigo_viejo === cod)?.nombre ?? '', motivo, antes: '', propuesta: pesos(f), aplicar: null });
      hoja.push({ ...fila, que_se_hace: `a Revisar: ${motivo}` });
      continue;
    }
    if (c.id) tocados.add(c.id);
    saldos.push([c.id ?? null, cod, s.saldo]);
    hoja.push({ ...fila, que_se_hace: `línea de saldo inicial al ${s.saldo > 0 ? 'DEBE' : 'HABER'}; cuenta corriente habilitada${c.alta ? ' (cliente nuevo)' : ''}` });
  }
  // saldos sueltos de ODB (sin libro): no se pisan solos
  for (const o of clientes) {
    if (Math.abs(Number(o.saldo_cta_cte)) < 0.01 || tocados.has(o.id) || conLibro.has(o.id)) continue;
    const cod = [...clienteDe.entries()].find(([, v]) => v.id === o.id)?.[0];
    const motivo = cod ? `ODB tiene $${pesos(Number(o.saldo_cta_cte))} sin movimientos que lo respalden y el sistema viejo dice $0 (cliente ${cod})` : `ODB tiene $${pesos(Number(o.saldo_cta_cte))} sin movimientos que lo respalden y no está en el sistema viejo`;
    rev('ctacte', { clave: `saldo-odb:${o.id}`, tipo: 'cuenta corriente', codigo: cod ?? '', nombre_odb: o.nombre, motivo, antes: pesos(Number(o.saldo_cta_cte)), propuesta: cod ? 0 : '', aplicar: cod ? { igualar: [[o.id]] } : null });
  }
  // clientes con movimientos en el último año: habilitar la cuenta corriente (pendiente)
  const movAnio = new Set(exp.ctacte.filter((m) => m.fecha && m.fecha >= DESDE_365).map((m) => m.codigo_viejo));
  for (const cod of movAnio) {
    const c = clienteDe.get(cod);
    if (!c || !(c.id || c.alta) || saldos.some((s) => s[1] === cod)) continue;
    habilitar.push([c.id ?? null, cod]);
  }
  planes.ctacte = {
    formato: { saldos: ['cliente_id', 'codigo_viejo', 'saldo'], igualar: ['cliente_id'], habilitar_activos: ['cliente_id', 'codigo_viejo'] },
    datos: { concepto, corte: CORTE },
    secciones: { saldos, igualar: [], habilitar_activos: habilitar },
    pendientes: { habilitar_activos: 'habilitar la cuenta corriente también a los clientes con movimientos en el último año y saldo 0: decisión del dueño' },
  };
  // resumen por cliente del historial (queda como referencia; no se carga)
  const porCli = new Map();
  for (const m of exp.ctacte) {
    const x = porCli.get(m.codigo_viejo) ?? porCli.set(m.codigo_viejo, { codigo: m.codigo_viejo, movimientos: 0, desde: null, hasta: null, ventas: 0, pagos: 0, ultimo_saldo: 0 }).get(m.codigo_viejo);
    x.movimientos++; if (m.fecha) { if (!x.desde || m.fecha < x.desde) x.desde = m.fecha; if (!x.hasta || m.fecha > x.hasta) x.hasta = m.fecha; }
    if (m.tipo === 'VENTA' && Math.abs(m.importe ?? 0) < 1e9) x.ventas += m.importe ?? 0;
    if (m.tipo === 'PAGO') x.pagos += m.importe ?? 0;
    x.ultimo_saldo = m.saldo;
  }
  hojas['Cuenta corriente'] = hoja;
  hojas['Cta cte: historial (ref.)'] = [...porCli.values()].map((x) => ({ ...x, ventas: pesos(x.ventas), pagos: pesos(x.pagos), ultimo_saldo: pesos(x.ultimo_saldo) }));
  const deben = saldos.filter((s) => s[2] > 0), aFavor = saldos.filter((s) => s[2] < 0);
  resumen.ctacte = {
    lineas_de_saldo_inicial: saldos.length, deben: deben.length, deben_total: pesos(deben.reduce((s, x) => s + x[2], 0)),
    a_favor: aFavor.length, a_favor_total: pesos(aFavor.reduce((s, x) => s + x[2], 0)), neto: pesos(saldos.reduce((s, x) => s + x[2], 0)),
    de_clientes_nuevos: saldos.filter((s) => !s[0]).length, habilitar_activos_propuesta: habilitar.length,
    a_revisar: revisar.filter((r) => r.entidad === 'ctacte').length, concepto,
  };
}

// ======================================================================= HISTORIAL DE VENTAS
{
  const filas = [...agregado.values()].filter((a) => r3(a.unidades) > 0).sort((a, b) => a.i - b.i || a.codigo.localeCompare(b.codigo))
    .map((a) => [a.codigo, a.i, r3(a.unidades), r2(a.importe), a.renglones]);
  const nombreViejo = new Map(exp.articulos.map((a) => [a.codigo, a.descripcion]));
  const nombres = {};
  for (const f of filas) if (!final.get(f[0])?.p && !porCodigo.get(f[0])) nombres[f[0]] = nombreViejo.get(f[0]) ?? `Código ${f[0]} del sistema anterior`;
  const medios = [...porMedio.values()].map((m) => [m.i, m.medio, m.comprobantes.size, r2(m.importe)]);
  planes.historial = {
    formato: { filas: ['codigo', 'periodo', 'unidades', 'importe', 'renglones'], medios: ['periodo', 'medio', 'comprobantes', 'importe'] },
    datos: { sucursal_id: SUC_ST, origen: REFERENCIA, periodos: periodos.map((p) => [p.desde, p.hasta]), nombres },
    secciones: { filas, medios },
  };
  hojas['Historial de ventas'] = periodos.map((p, i) => {
    const fs = filas.filter((f) => f[1] === i);
    return { desde: p.desde, hasta: p.hasta, dias: p.dias, productos: fs.length, unidades: r3(fs.reduce((s, f) => s + f[2], 0)), importe: pesos(fs.reduce((s, f) => s + f[3], 0)) };
  });
  hojas['Ventas: renglones absurdos'] = absurdos;
  resumen.historial = {
    periodos: periodos.length, primer_dia: periodos[0]?.desde, ultimo_dia: periodos.at(-1)?.hasta, filas: filas.length,
    productos: new Set(filas.map((f) => f[0])).size, sin_producto_en_odb: Object.keys(nombres).length,
    unidades: r3(filas.reduce((s, f) => s + f[2], 0)), importe: pesos(filas.reduce((s, f) => s + f[3], 0)),
    fuera_de_periodo: { renglones: fueraDePeriodo.renglones, unidades: r3(fueraDePeriodo.unidades), por_que: 'del 1 al 21/7 (ya cargado, access-julio-2026) y el día del corte, que está a medias' },
    renglones_absurdos: absurdos.length,
  };
}

// ======================================================================= STOCK (Sant Thomas)
{
  // reservas abiertas en ST: el sistema viejo no las conoce
  const abiertos = new Set(pedidos.map((p) => p.id));
  const reserva = new Map();
  for (const m of movPedidos) if (abiertos.has(m.referencia_id)) reserva.set(m.producto_id, r3((reserva.get(m.producto_id) ?? 0) - Number(m.cantidad)));
  // compras que ODB recibió en ST desde la carga anterior
  const compras = new Map(), movNeto = new Map();
  for (const m of movDesde) {
    movNeto.set(m.producto_id, (movNeto.get(m.producto_id) ?? 0) + Number(m.cantidad));
    if (m.tipo === 'compra' || m.tipo === 'transferencia_entrada') compras.set(m.producto_id, (compras.get(m.producto_id) ?? 0) + Number(m.cantidad));
  }
  const ajustes = [], hoja = [];
  let iguales = 0, negativos = 0;
  for (const [codigo, f] of final) {
    const { p, r } = f;
    const viejo = r.cantidad;
    const os = objetivoStock(viejo);
    const actual = p ? stockActual.get(p.id) ?? 0 : 0;
    const base = { codigo, sku: p?.sku ?? `L${codigo} (alta)`, nombre_odb: p?.nombre ?? r.descripcion, antes: r3(actual), sistema_viejo: viejo == null ? '' : r3(viejo), por_peso: p?.vendido_por_peso ? 'sí' : '' };
    if (os.revisar) { rev('stock', { clave: `stock:${codigo}`, tipo: 'stock', ...base, motivo: os.revisar, propuesta: '', aplicar: null }); continue; }
    if (viejo < 0) negativos++;
    const res_ = p ? reserva.get(p.id) ?? 0 : 0;
    if (res_ > 0) {
      const propuesta = r3(Math.max(0, os.objetivo - res_));
      rev('stock', { clave: `stock:${codigo}`, tipo: 'stock', ...base, motivo: `ODB tiene ${res_} reservadas en pedidos abiertos que el viejo no conoce: llevarlo a ${os.objetivo} las libera`, propuesta, aplicar: { ajustes: [[codigo, propuesta, actual]] } });
      continue;
    }
    if (p && compras.has(p.id)) {
      const cargaAnterior = actual - (movNeto.get(p.id) ?? 0);
      const ingresoViejo = r3(Math.max(0, viejo) - cargaAnterior + (ventas.get(codigo)?.desdeAnterior ?? 0));
      const ingresoOdb = compras.get(p.id);
      if (ingresoViejo < ingresoOdb * 0.5) {
        const faltan = r3(ingresoOdb - Math.max(0, ingresoViejo));
        const propuesta = r3(os.objetivo + faltan);
        rev('stock', { clave: `stock:${codigo}`, tipo: 'stock', ...base, motivo: `ODB recibió ${r3(ingresoOdb)} desde la carga anterior y el viejo registró ≈${ingresoViejo}: si se iguala se pierden ${faltan}`, propuesta, aplicar: { ajustes: [[codigo, propuesta, actual]] } });
        continue;
      }
    }
    const delta = r3(os.objetivo - actual);
    if (Math.abs(delta) < 0.0005) { iguales++; continue; }
    ajustes.push([codigo, os.objetivo, actual]);
    hoja.push({ ...base, queda: os.objetivo, diferencia: delta, a_costo: pesos(delta * (r.costo >= 1 ? r.costo : 0)), nota: [os.nota, !Number.isInteger(os.objetivo) && !p?.vendido_por_peso && !planes.articulos.secciones.peso.some((x) => x[0] === codigo) ? 'decimales en un producto por unidad' : '', f.alta ? 'alta' : ''].filter(Boolean).join('; ') });
  }
  // los que no cruzan bien y tienen stock
  for (const x of res) {
    if (x.estado === 'ok' || x.estado === 'sin_producto' || final.has(x.codigo)) continue;
    const viejo = x.r.cantidad, actual = x.p ? stockActual.get(x.p.id) ?? 0 : 0;
    if (Math.abs(Math.max(0, r3(viejo ?? 0)) - actual) < 0.0005) continue;
    rev('stock', { clave: `stock:${x.codigo}`, tipo: 'stock', codigo: x.codigo, sku: x.p?.sku ?? '', nombre_odb: x.p?.nombre ?? '', nombre_viejo: x.todos.map((t) => `${t.descripcion}: ${t.cantidad}`).join(' / '), motivo: MOTIVO_ESTADO[x.estado], antes: actual, propuesta: '', aplicar: null });
  }
  planes.stock = { formato: { ajustes: ['codigo', 'objetivo', 'antes'] }, datos: { sucursal_id: SUC_ST }, secciones: { ajustes } };
  hojas['Stock que cambia'] = hoja.sort((a, b) => Math.abs(b.diferencia) - Math.abs(a.diferencia));
  const sube = ajustes.filter((a) => a[1] > a[2]), baja = ajustes.filter((a) => a[1] < a[2]);
  resumen.stock = {
    ajustes: ajustes.length, suben: sube.length, unidades_suben: r3(sube.reduce((s, a) => s + a[1] - a[2], 0)), bajan: baja.length, unidades_bajan: r3(baja.reduce((s, a) => s + a[1] - a[2], 0)),
    iguales, negativos_quedan_en_0: negativos, de_altas: ajustes.filter((a) => final.get(a[0])?.alta).length,
    reservas_abiertas: pedidos.length, a_revisar: revisar.filter((r) => r.entidad === 'stock').length,
    santa_ines: 'no se toca (la exportación no la trae)',
  };
}

// ---------------------------------------------------------------- decisiones del dueño
// Lo que el circuito no decide solo. Cada una dice qué se hace si no se decide nada.
function decisiones(r) {
  const d = (tema, pregunta, recomendacion, si_no_se_decide) => ({ tema, pregunta, recomendacion, si_no_se_decide });
  return [
    d('Corte', 'Fecha y hora del cambio de sistema.', 'Congelar el sistema viejo al cierre, sacar una exportación nueva y correr simular → preparar → aplicar en el orden del README, con el stock al final.', 'La exportación del 21/10 12:08 queda vieja: el stock no se aplica con ella.'),
    d('Precios', `Mayorista desde la lista sin nombre del viejo (≈ costo × 1,4): ${r.precios.mayorista_propuesta} vigencias nuevas; ${r.precios.mayorista_no_cumple} no cumplen (debajo del costo, arriba del minorista o saltos).`, 'Sí, si en el viejo a los mayoristas se les cobra esa lista (preparar --incluir mayorista). Si no, queda la de julio (Minorista × 0,78).', 'Queda la Mayorista del 2/7.'),
    d('Precios', 'Lista ODB (Precio 2) y Lista Restos (Precio 3).', 'No cargarlas: son iguales al Precio 1 en el 99% y tienen errores de ×10 (decisión del 1/10).', 'No se cargan.'),
    d('Precios', `Hoja Revisar, tipo precio: ${r.precios.a_revisar} (precios cambiados a mano en ODB después del 1/10, saltos de más de ±60%, basura y el 4330 con dos precios).`, 'Aprobar los saltos que corrigen precios de ODB que estaban debajo del costo; los cambiados a mano en ODB, uno por uno.', 'Quedan los precios de ODB.'),
    d('Costos', `${r.costos.cambian} costos recientes se cargan; ${r.costos.de_mas_de_un_anio_pendientes} tienen fecha de hace más de un año.`, 'Cargar los recientes; los de más de un año NO (con la inflación dan un margen que no es).', 'Los de más de un año no se cargan.'),
    d('Artículos', `${r.articulos.pasan_a_por_peso} productos pasan a venderse por peso (hoja Por peso); los dudosos están en Revisar.`, 'Mirar la hoja Por peso antes de abrir la caja: sin la marca, la etiqueta de la balanza entra como unidades.', 'Se marcan los de la hoja (los dudosos no).'),
    d('Artículos', `${r.articulos.altas} altas, ${r.articulos.se_vinculan} vínculo, ${r.articulos.nombre_distinto} códigos con otro producto en ODB, ${r.articulos.dados_de_baja_en_odb} dados de baja en ODB, ${r.articulos.repetidos} códigos repetidos.`, 'Altas sí. Los códigos reutilizados y repetidos: corregirlos en el viejo antes del export final.', 'Esos códigos no reciben precio, costo ni stock.'),
    d('Artículos', `${r.articulos.activos_de_odb_que_el_viejo_no_tiene} activos de ODB que el viejo ya no tiene (${r.articulos.de_esos_con_stock_en_st} con stock en ST).`, 'No darlos de baja hasta saber qué vende Santa Inés.', 'No se tocan.'),
    d('Códigos de barras', `${r.barras.cajas_ya_cargadas_que_cobran_1} códigos de CAJA ya cargados cobran 1 unidad.`, 'Sacarlos ya (preparar --incluir quitar_cajas) y programar "código de caja con cantidad" antes de volver a cargarlos.', 'Siguen cobrando 1 unidad.'),
    d('Proveedores', `${r.proveedores.altas} altas (quedan "incompletas" hasta cargar CUIT, teléfono y plazo) y ${r.proveedores.a_revisar} que se parecen a uno de ODB.`, 'Anotar las equivalencias que valen y volver a simular con --equivalencias; después cargar.', 'Los parecidos no se crean y sus costos van sin proveedor.'),
    d('Clientes', `${r.clientes.ya_estan} ya están, ${r.clientes.altas} altas, ${r.clientes.no_se_crean} no se crean (sin datos ni movimiento) y ${r.clientes.a_revisar} a revisar (códigos repetidos, RI sin CUIT).`, 'Cargar. Los de junio conservan su código; los nuevos quedan con "st-<código>". Corregir en el viejo los 16 códigos repetidos.', 'Se cargan como dice la hoja Clientes.'),
    d('Cuenta corriente', `${r.ctacte.lineas_de_saldo_inicial} saldos iniciales (${r.ctacte.deben} deben $${r.ctacte.deben_total}; ${r.ctacte.a_favor} a favor $${r.ctacte.a_favor_total}). Saldos sueltos de ODB sin libro y códigos repetidos con saldo, en Revisar.`, 'Cargar los saldos iniciales. Antes de aprobar "poner en 0" los saldos sueltos de junio, preguntar a administración si eran de Santa Inés. Poner límite de crédito a los que deben más de $1 M.', 'Los saldos sueltos quedan como están.'),
    d('Cuenta corriente', `Habilitar la cuenta corriente también a ${r.ctacte.habilitar_activos_propuesta} clientes con movimientos en el último año y saldo 0.`, 'No en bloque: habilitarla cuando la pidan.', 'Solo quedan habilitados los que tienen saldo.'),
    d('Historial de ventas', `${r.historial.filas} filas en ${r.historial.periodos} períodos (${r.historial.unidades} unidades) a ventas_historicas.`, 'Cargar. Aplicar antes db/migracion-ventas-historicas.sql para guardar también importes y medios de pago (opcional).', 'Sin la migración se cargan solo las unidades.'),
    d('Stock', `${r.stock.ajustes} ajustes en Sant Thomas; ${r.stock.negativos_quedan_en_0} negativos quedan en 0; ${r.stock.a_revisar} a revisar (reservas de pedidos y compras de ODB que el viejo no registró).`, 'Aplicar el día del cambio. Contar antes los negativos que más se venden: en 0 la caja de ODB no los deja vender.', 'No se aplica.'),
    d('Santa Inés', 'La exportación no trae su stock ni sus ventas.', 'Pedir el export de Santa Inés o hacer un conteo.', 'Queda la apertura del 11/8 (con 86 negativos).'),
    d('IVA', 'Todos los productos están al 21% en el viejo y en ODB.', 'Que el contador marque los de 10,5% antes de facturar desde ODB.', 'Todo al 21%.'),
    d('Caja (código)', 'La venta a cuenta corriente busca al cliente solo por DNI: una empresa con CUIT no se puede elegir.', 'Arreglarlo en la API antes de operar (las altas de personas ya llevan el DNI sacado del CUIT).', 'Las empresas no pueden comprar a cuenta en la caja.'),
  ];
}

// ---------------------------------------------------------------- salida
mkdirSync(SALIDA, { recursive: true });
const generado = new Date().toISOString();
for (const [entidad, plan] of Object.entries(planes)) {
  const deEntidad = revisar.filter((r) => r.entidad === entidad);
  const esperado = Object.fromEntries(Object.entries(plan.secciones).map(([k, v]) => [k, v.length]));
  writeFileSync(join(SALIDA, `plan-${entidad}.json`), JSON.stringify({ entidad, referencia: REFERENCIA, corte: CORTE, generado, pendientes: {}, datos: {}, ...plan, esperado, revisar: deEntidad }));
}
resumen.lectura = { corte: CORTE, avisos: exp.avisos.length, articulos: exp.articulos.length, clientes: exp.clientes.length, ctacte: exp.ctacte.length, ventas_st: renglonesST };
resumen.revisar_total = revisar.length;
writeFileSync(join(SALIDA, 'resumen.json'), JSON.stringify(resumen, null, 1));

const wb = XLSX.utils.book_new();
const hojaExcel = (nombre, filas) => XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filas.length ? filas : [{ '(vacío)': '' }]), nombre.slice(0, 31));
const filasResumen = [{ entidad: 'corte', concepto: 'datos del sistema viejo al', valor: `${corteTexto} — en pleno día de venta: para el cambio de sistema hace falta una exportación nueva con el viejo congelado` }];
for (const [e, r] of Object.entries(resumen)) if (typeof r === 'object') for (const [k, v] of Object.entries(r)) filasResumen.push({ entidad: e, concepto: k.replace(/_/g, ' '), valor: typeof v === 'object' ? JSON.stringify(v) : v });
hojaExcel('Resumen', filasResumen);
hojaExcel('Decisiones', decisiones(resumen));
hojaExcel('Revisar', revisar.map(({ aplicar, entidad, clave, ...r }) => ({ aprobar: '', entidad, ...r, se_puede_aprobar: aplicar ? 'sí' : 'no (se resuelve a mano)', clave })));
for (const [n, f] of Object.entries(hojas)) hojaExcel(n, f);
hojaExcel('Avisos de la lectura', exp.avisos.map((a) => ({ archivo: a.archivo, renglon: a.renglon ?? '', aviso: a.aviso })));
const ruta = join(SALIDA, 'informe-exportacion.xlsx');
XLSX.writeFile(wb, ruta);
log('listo');
console.log(JSON.stringify(resumen, null, 1));
console.log('informe →', ruta);
