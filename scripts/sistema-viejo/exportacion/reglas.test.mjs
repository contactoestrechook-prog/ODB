// Pruebas de las reglas de la carga de la exportación y del armado de la carga
// y del ensayo. Correr: node --test scripts/sistema-viejo/exportacion
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { AQUI } from './base.mjs';
import * as R from './reglas.mjs';
import { armarCarga, sqlDeEnsayo, sqlEncadenado, sentenciasDe } from './carga.mjs';

test('los umbrales son los mismos que los del circuito de las planillas (actualizar.mjs)', () => {
  const viejo = readFileSync(join(AQUI, '..', 'actualizar.mjs'), 'utf8');
  const valor = (n) => Number(new RegExp(`const ${n} = ([0-9.]+)`).exec(viejo)?.[1]);
  assert.equal(valor('PISO_PRECIO'), R.PISO_PRECIO);
  assert.equal(valor('SALTO_MAX'), R.SALTO_MAX);
  assert.equal(valor('PARECIDO_MIN'), R.PARECIDO_MIN);
});

test('motivoPrecio: basura, menos de $100 y saltos de más de ±60% van a revisión', () => {
  assert.match(R.motivoPrecio(0.01, 500), /marcador/);
  assert.match(R.motivoPrecio(50, 60), /menor a \$100/);
  assert.match(R.motivoPrecio(2400, 180), /salto/);
  assert.equal(R.motivoPrecio(1100, 1000), null);
  assert.equal(R.motivoPrecio(1100, null), null);
});

test('motivoMayorista: además, ni debajo del costo ni arriba del minorista', () => {
  assert.match(R.motivoMayorista(900, 950, { costo: 1000, minorista: 1500 }), /debajo del costo/);
  assert.match(R.motivoMayorista(1600, 1550, { costo: 1000, minorista: 1500 }), /arriba del minorista/);
  assert.equal(R.motivoMayorista(1400, 1300, { costo: 1000, minorista: 1500 }), null);
});

test('resolver: cruza por código; nombre distinto, dado de baja y código repetido se separan', () => {
  const porCodigo = new Map([
    ['1', { id: 'a', nombre: 'Fernet Branca 750', activo: true }],
    ['2', { id: 'b', nombre: 'Vasco Viejo Tinto 375cc', activo: true }],
    ['3', { id: 'c', nombre: 'Coca Cola 2,25', activo: false }],
    ['4', { id: 'd', nombre: 'Domain Bousquet Reserva Cabernet Franc', activo: true }],
  ]);
  const r = R.resolver([
    { codigo: '1', descripcion: 'Fernet Branca x 750cc' }, { codigo: '2', descripcion: 'Galletitas Pepas Masa Madre' },
    { codigo: '3', descripcion: 'Coca Cola 2,25 lts' }, { codigo: '4', descripcion: 'Procenex 1800 ml' },
    { codigo: '4', descripcion: 'Domain Bousquet Reserva Cabernet Franc x750' }, { codigo: '9', descripcion: 'Nuevo' },
  ], porCodigo);
  const est = Object.fromEntries(r.map((x) => [x.codigo, x.estado]));
  assert.deepEqual(est, { 1: 'ok', 2: 'nombre_distinto', 3: 'inactivo', 4: 'ok', 9: 'sin_producto' });
  const cuatro = r.find((x) => x.codigo === '4');
  assert.equal(cuatro.r.descripcion, 'Domain Bousquet Reserva Cabernet Franc x750');
  assert.deepEqual(cuatro.sobrantes.map((s) => s.descripcion), ['Procenex 1800 ml']);
});

test('mismoArticulo: no cuenta medidas (un Malbec y un whisky de 750 no son lo mismo)', () => {
  assert.ok(R.mismoArticulo('Chips Maretti vegetales 140 g', 'Chips Maretti vegetales x 140gr') >= R.VINCULAR_MIN);
  assert.ok(R.mismoArticulo('Malbec Reserva 750cc', 'Whisky Reserva 750cc') < R.VINCULAR_MIN);
});

test('reglaPeso: con decimales la mayoría de las veces o el nombre lo dice; pocos decimales es dudoso', () => {
  assert.equal(R.reglaPeso({ nombre: 'Queso Tybo', ventas: 10, conDecimales: 8 }).estado, 'marcar');
  assert.equal(R.reglaPeso({ nombre: 'Colita de cuadril x peso Muge', ventas: 0, conDecimales: 0 }).estado, 'marcar');
  assert.equal(R.reglaPeso({ nombre: 'Longaniza x Fraccion', ventas: 1, conDecimales: 0 }).estado, 'marcar');
  assert.equal(R.reglaPeso({ nombre: 'Vino x 750', ventas: 100, conDecimales: 4 }).estado, 'dudoso');
  assert.equal(R.reglaPeso({ nombre: 'Agua x 2 kg', ventas: 100, conDecimales: 0 }).estado, 'no');
  assert.equal(R.reglaPeso({ yaPorPeso: true }).estado, 'ya');
});

test('reglaCosto: el costo no puede superar el precio; 0,01 no es dato', () => {
  assert.equal(R.reglaCosto({ costo: 0.01, precio: 100 }).estado, 'sin_dato');
  assert.equal(R.reglaCosto({ costo: 62074, precio: 9900 }).estado, 'revisar');
  assert.equal(R.reglaCosto({ costo: 500, precio: null }).estado, 'revisar');
  assert.deepEqual(R.reglaCosto({ costo: 6510.234, precio: 10900 }), { estado: 'aplicar', costo: 6510.23 });
});

test('objetivoStock: negativos a 0 (decisión del 1/10) y al gramo', () => {
  assert.equal(R.objetivoStock(-7).objetivo, 0);
  assert.match(R.objetivoStock(-7).nota, /queda en 0/);
  assert.equal(R.objetivoStock(6.8554).objetivo, 6.855);
  assert.ok(R.objetivoStock(null).revisar);
});

test('controlGtin y pareceBalanza', () => {
  assert.equal(R.controlGtin('4006381333931'), true);
  assert.equal(R.controlGtin('4006381333932'), false);
  assert.equal(R.controlGtin('036000291452'), true);
  assert.equal(R.controlGtin('73513537'), true);
  assert.equal(R.controlGtin('8048099011'), null);       // 10 dígitos: no se valida
  assert.equal(R.pareceBalanza('2003931002905'), true);    // la etiqueta de balanza.spec.ts
  assert.equal(R.pareceBalanza('7790577040525'), false);
});

test('reglaBarra: solo se agregan los códigos de UNIDAD seguros', () => {
  const p = { id: 'p1' };
  const b = (x) => ({ ean: '4006381333931', tipo: 'UNIDAD', cantidad: 1, ...x });
  assert.equal(R.reglaBarra(b(), { producto: p }).accion, 'agregar');
  assert.equal(R.reglaBarra(b(), { producto: null, alta: true }).accion, 'agregar');
  assert.equal(R.reglaBarra(b(), { producto: p, dueno: 'p1' }).accion, 'ya_esta');
  assert.equal(R.reglaBarra(b(), { producto: p, dueno: 'otro' }).accion, 'revisar');
  assert.equal(R.reglaBarra(b({ tipo: 'CAJA', cantidad: 6 }), { producto: p }).accion, 'revisar');
  const caja = R.reglaBarra(b({ tipo: 'CAJA', cantidad: 6 }), { producto: p, dueno: 'p1' });
  assert.equal(caja.quitar, true);
  assert.equal(R.reglaBarra(b({ tipo: 'CAJA', cantidad: 0 }), { producto: p }).accion, 'revisar');
  assert.equal(R.reglaBarra(b({ ean: '2003931002905' }), { producto: p }).accion, 'no');
  assert.equal(R.reglaBarra(b({ ean_repetido: true }), { producto: p }).accion, 'revisar');
  assert.equal(R.reglaBarra(b({ ean: '4006381333932' }), { producto: p }).accion, 'revisar');
  assert.equal(R.reglaBarra(b({ formato_raro: true }), { producto: p }).accion, 'no');
  assert.equal(R.reglaBarra(b(), {}).accion, 'no');
});

test('CUIT, DNI, teléfono y email', () => {
  assert.equal(R.cuitValido('20-12345678-6'), '20123456786');
  assert.equal(R.cuitValido('20123456785'), null);
  assert.equal(R.cuitValido('11111111111'), null);
  assert.equal(R.dniDeCuit('20123456786'), '12345678');
  assert.equal(R.dniDeCuit('30712345671'), null);          // una empresa no tiene DNI
  assert.equal(R.telefono('11 2233-4455 - 4234-5678'), '1122334455');
  assert.equal(R.telefono('+54 9 11 2233 4455'), '1122334455');
  assert.equal(R.telefono('123*456'), null);
  assert.equal(R.claveTelefono('42957723'), null);         // sin característica no cruza
  assert.equal(R.emailValido(' Ana@Mail.com '), 'ana@mail.com');
  assert.equal(R.emailValido('ana@'), null);
});

test('proveedores: forma societaria fuera; el parecido solo propone', () => {
  assert.equal(R.claveProveedor('BEAU LIEU S.A.'), R.claveProveedor('Beau Lieu SA'));
  assert.equal(R.parecidoProveedor('MOLINOS', 'Olin SRL'), 0);
  assert.equal(R.parecidoProveedor('Bodegas Lopez', 'BODEGAS SALENTEIN S.A.'), 0);
  assert.ok(R.parecidoProveedor('LUVIK', 'Luvik Mayorista') >= 0.5);
});

test('clientes: nombre sin orden, condición de IVA de ODB y cruce', () => {
  assert.equal(R.claveNombre('PEREZ, JUAN'), R.claveNombre('Juan Pérez'));
  assert.equal(R.condicionIva('RESPONSABLE INSCRIPTO'), 'responsable_inscripto');
  assert.equal(R.condicionIva('CONSUMIDOR FINAL'), 'consumidor_final');
  assert.equal(R.condicionIva('RESP NO INSCRIPTO'), null);
  const idx = {
    porCuit: new Map([['20123456786', ['c1']]]), porDni: new Map(), porNombre: new Map([[R.claveNombre('Ana Gomez'), ['c2']], [R.claveNombre('Luis Diaz'), ['c3', 'c4']]]),
    porTelefono: new Map([['1122334455', ['c5']]]), porEmail: new Map(),
  };
  const nombres = { c1: 'Juan Perez', c2: 'Ana Gomez', c5: 'Pedro Ruiz' };
  const nombreDe = (id) => nombres[id] ?? '';
  assert.deepEqual(R.cruzarCliente({ nombre: 'J. Perez', cuit: '20123456786' }, idx, nombreDe), { cliente_id: 'c1', por: 'CUIT' });
  assert.deepEqual(R.cruzarCliente({ nombre: 'GOMEZ ANA' }, idx, nombreDe), { cliente_id: 'c2', por: 'nombre' });
  assert.equal(R.cruzarCliente({ nombre: 'Luis Diaz' }, idx, nombreDe), null);                       // homónimos: no
  assert.equal(R.cruzarCliente({ nombre: 'Marta Ruiz', telefono: '1122334455' }, idx, nombreDe), null); // teléfono de otra persona
  assert.ok(R.cruzarCliente({ nombre: 'Ana Gomez', cuit: '20123456786' }, idx, nombreDe).revisar);       // CUIT y nombre de dos clientes
  assert.deepEqual(R.cruzarCliente({ nombre: 'Ruiz Pedro A', telefono: '11 2233-4455' }, idx, nombreDe), { cliente_id: 'c5', por: 'teléfono' });
  assert.equal(R.nombreCompatible('Juan Perez', 'Juan Carlos Perez'), true);
  assert.equal(R.nombreCompatible('Marta Ruiz', 'Pedro Ruiz'), false);
});

test('saldoInicial: sin facturas ni pagos inventados; lo dudoso a revisión', () => {
  assert.deepEqual(R.saldoInicial({ ficha: 1500.5, ultimoCorrido: 1500.5 }), { saldo: 1500.5, debe: 1500.5, haber: 0 });
  assert.deepEqual(R.saldoInicial({ ficha: -200 }), { saldo: -200, debe: 0, haber: 200 });
  assert.equal(R.saldoInicial({ ficha: 0 }), null);
  assert.match(R.saldoInicial({ ficha: 12000, ultimoCorrido: 0 }).revisar, /termina en/);
  assert.match(R.saldoInicial({ ficha: 50000, repetido: true }).revisar, /repetido/);
  assert.match(R.CONCEPTO_SALDO_INICIAL('21/10/2026 12:08'), /Saldo inicial del sistema anterior/);
});

test('periodosHistorial: no pisa julio, dos períodos de 30 días al final y el día del corte afuera', () => {
  const p = R.periodosHistorial({ primero: '2025-10-21', corte: '2026-10-21T12:08:11-03:00', existentes: [{ desde: '2026-07-01', hasta: '2026-07-21', origen: 'access-julio-2026' }] });
  assert.deepEqual(p.slice(-2).map((x) => [x.desde, x.hasta, x.dias]), [['2026-08-22', '2026-09-20', 30], ['2026-09-21', '2026-10-20', 30]]);
  assert.ok(p.some((x) => x.desde === '2026-07-22' && x.hasta === '2026-07-31'));
  assert.ok(!p.some((x) => x.desde <= '2026-07-21' && x.hasta >= '2026-07-01'));
  assert.equal(p[0].desde, '2025-10-21');
  for (let i = 1; i < p.length; i++) assert.ok(p[i].desde > p[i - 1].hasta, 'los períodos no se pisan');
  assert.throws(() => R.periodosHistorial({ primero: '2025-10-21', corte: '2026-10-21T12:08:11-03:00', existentes: [{ desde: '2026-10-01', hasta: '2026-10-10' }] }), /decidir a mano/);
  assert.equal(R.periodoDe(p, '2026-10-21'), -1);
  assert.match(R.renglonAbsurdo({ cantidad: 2009775001050, precio: 1 }), /cantidad/);
  assert.equal(R.renglonAbsurdo({ cantidad: 0.105, precio: 23600 }), null);
});

// ------------------------------------------------------------------ carga y ensayo
const PLAN = {
  entidad: 'precios', referencia: 'export-2110', corte: '2026-10-21T12:08:11-03:00', generado: 'x',
  formato: { minorista: ['codigo', 'precio', 'antes'] }, datos: { lista_minorista: 'm', lista_mayorista: 'M' },
  secciones: { minorista: [['1', 100, 90], ['2', 200, 180], ['3', 300, 280]], mayorista: [['1', 80, 70]] },
  pendientes: { mayorista: 'decisión del dueño' },
  revisar: [{ clave: 'precio:9', aplicar: { minorista: [['9', 999, 100]] } }, { clave: 'precio:8', aplicar: null }],
};

test('armarCarga: lo pendiente solo con --incluir y lo de Revisar solo si el dueño lo aprobó', () => {
  const a = armarCarga(PLAN, { usuario: 'u' });
  assert.deepEqual(Object.keys(a.carga.secciones), ['minorista']);
  const b = armarCarga(PLAN, { usuario: 'u', incluir: new Set(['mayorista']), aprobadas: new Set(['precio:9', 'precio:8']) });
  assert.equal(b.carga.secciones.mayorista.length, 1);
  assert.deepEqual(b.carga.secciones.minorista.at(-1), ['9', 999, 100]);
  assert.deepEqual(b.sinPropuesta, ['precio:8']);
  assert.throws(() => armarCarga(PLAN, { usuario: 'u', incluir: new Set(['minorista']) }), /no es una sección pendiente/);
  const m = armarCarga(PLAN, { usuario: 'u', muestra: 1, codigos: new Set(['3']) });
  assert.deepEqual(m.carga.secciones.minorista.map((f) => f[0]), ['1', '3']);
  assert.equal(m.carga.muestra.total.minorista, 3);
});

test('cada aplicar/*.sql tiene las marcas del ensayo una sola vez y un solo bloque', () => {
  for (const f of readdirSync(join(AQUI, 'aplicar'))) {
    const sql = readFileSync(join(AQUI, 'aplicar', f), 'utf8');
    for (const m of ['-- __CARGA_ENSAYO__', 'v_ensayo boolean := __ENSAYO__;', 'v_id bigint := __AUDITORIA_ID__;', '-- __FIN_ENSAYO__']) {
      assert.equal(sql.split(m).length, 2, `${f}: '${m}'`);
    }
    assert.equal(sql.match(/^do \$\$/gm)?.length, 1, `${f}: un solo bloque`);
    assert.ok(sql.includes(`'sistema_viejo:${f.replace('.sql', '')}'`), `${f}: lee su propia entidad`);
    assert.ok(/raise exception 'la carga % ya se aplicó'/.test(sql), `${f}: no se aplica dos veces`);
  }
});

test('sqlDeEnsayo: la carga va adentro con su md5, el bloque queda en ensayo y la migración corre adentro', () => {
  const { carga } = armarCarga({ ...PLAN, entidad: 'precios' }, { usuario: 'a1452314-4644-4eee-aa4c-806f77922197' });
  const { sql, md5 } = sqlDeEnsayo('precios', carga, { migracion: join(AQUI, '../../../db/migracion-ventas-historicas.sql') });
  assert.equal(md5, createHash('md5').update(JSON.stringify(carga), 'utf8').digest('hex'));
  assert.ok(sql.includes('v_ensayo boolean := true;'));
  assert.ok(sql.includes('v_id bigint := null;'));
  assert.ok(!sql.includes('__AUDITORIA_ID__;') && !sql.includes(':= __ENSAYO__'));
  assert.ok(sql.includes(`if md5(v_carga_texto) <> '${md5}'`));
  assert.ok(sql.includes('execute $m$create table if not exists public.ventas_historicas_medios'));
  assert.equal(sentenciasDe('-- x\nselect 1;\nselect 2;\n').length, 2);
  const enc = sqlEncadenado([{ entidad: 'precios', sql }]);
  assert.ok(enc.startsWith('do $$\ndeclare informe text'));
  assert.ok(enc.includes("informe := informe || chr(10) || v_msg;"));
  assert.ok(enc.trimEnd().endsWith("raise exception 'ENSAYO ENCADENADO OK (nada quedó escrito):%', informe;\nend $$;"));
});

// ------------------------------------------------------------------ revisión del 21/10
test('reglaPeso: "x fraccion" en el nombre no alcanza si siempre se vendió por unidad', () => {
  assert.equal(R.reglaPeso({ nombre: 'Mozzarella Arrivata para pizza x fraccion x 200g', ventas: 118, conDecimales: 0 }).estado, 'dudoso');
  assert.equal(R.reglaPeso({ nombre: 'Longaniza x Fraccion', ventas: 9, conDecimales: 0 }).estado, 'marcar');
});

test('motivoMayorista: no sale de un costo de hace más de un año y se controla con el costo más nuevo', () => {
  assert.match(R.motivoMayorista(37500, 78000, { costo: 26786, minorista: 100000, fechaCosto: '2022-05-01', limiteFecha: '2025-10-21' }), /más de un año/);
  assert.match(R.motivoMayorista(11200, 18330, { costo: 15000, minorista: 30000, fechaCosto: '2026-10-01', limiteFecha: '2025-10-21' }), /debajo del costo/);
  assert.equal(R.motivoMayorista(1400, 1300, { costo: 1000, minorista: 1500, fechaCosto: '2026-10-01', limiteFecha: '2025-10-21' }), null);
});

test('motivoDebajoDelCosto: el Minorista nuevo no puede quedar debajo del costo de ODB ni del viejo', () => {
  assert.match(R.motivoDebajoDelCosto(2800, { costoOdb: 7999 }), /ODB \$7999/);
  assert.match(R.motivoDebajoDelCosto(9900, { costoOdb: null, costoViejo: 62074 }), /sistema viejo/);
  assert.equal(R.motivoDebajoDelCosto(1000, { costoOdb: 600, costoViejo: 0.01 }), null);
});

test('cuenta corriente: idempotente por cliente, no por corte (una segunda exportación no duplica el saldo)', () => {
  const c1 = R.CONCEPTO_SALDO_INICIAL('21/10/2026 12:08'), c2 = R.CONCEPTO_SALDO_INICIAL('28/10/2026 21:00');
  assert.notEqual(c1, c2);
  // primera carga: saldo inicial completo
  assert.deepEqual(R.lineaDeSaldo({ saldo: 3039895.5 }), { tipo: 'inicial', monto: 3039895.5 });
  // segunda exportación con otro corte: el cliente ya tiene su línea → solo la diferencia
  const ya = R.aportadoDelViejo([{ concepto: c1, debe: 3039895.5, haber: 0 }, { concepto: 'Venta Factura B 0015-123', debe: 5000, haber: 0 }]);
  assert.deepEqual(ya, { aportado: 3039895.5, conInicial: true });
  assert.deepEqual(R.lineaDeSaldo({ saldo: 3100000, ...ya }), { tipo: 'ajuste', monto: 60104.5 });
  assert.equal(R.lineaDeSaldo({ saldo: 3039895.5, ...ya }), null);
  // el viejo lo deja en 0: ajuste por todo lo cargado
  assert.deepEqual(R.lineaDeSaldo({ saldo: 0, ...ya }), { tipo: 'ajuste', monto: -3039895.5 });
  // después del ajuste, la tercera pasada no hace nada
  const tras = R.aportadoDelViejo([{ concepto: c1, debe: 3039895.5, haber: 0 }, { concepto: R.CONCEPTO_AJUSTE_SALDO('28/10/2026 21:00'), debe: 60104.5, haber: 0 }]);
  assert.equal(R.lineaDeSaldo({ saldo: 3100000, ...tras }), null);
});

test('ctacte.sql reconoce las líneas del circuito por el principio del concepto, no por el concepto entero', () => {
  const sql = readFileSync(join(AQUI, 'aplicar', 'ctacte.sql'), 'utf8');
  assert.ok(sql.includes("concepto like 'Saldo inicial del sistema anterior%'"));
  assert.ok(sql.includes("concepto like 'Ajuste de saldo del sistema anterior%'"));
  assert.ok(!/cliente_id = v_cli and concepto = v_concepto\)/.test(sql), 'el candado viejo (concepto exacto) no puede volver');
  assert.ok(R.CONCEPTO_SALDO_INICIAL('x').startsWith(R.PREFIJO_SALDO_INICIAL));
  assert.ok(R.CONCEPTO_AJUSTE_SALDO('x').startsWith(R.PREFIJO_AJUSTE_SALDO));
});

test('periodosHistorial: sobre una exportación anterior agrega solo los días que faltan', () => {
  const primera = R.periodosHistorial({ primero: '2025-10-21', corte: '2026-10-21T12:08:11-03:00', existentes: [{ desde: '2026-07-01', hasta: '2026-07-21', origen: 'access-julio-2026' }] });
  const existentes = [{ desde: '2026-07-01', hasta: '2026-07-21', origen: 'access-julio-2026' }, ...primera.map((p) => ({ ...p, origen: 'export-2110' }))];
  const segunda = R.periodosHistorial({ primero: '2025-10-21', corte: '2026-10-28T21:00:00-03:00', existentes });
  assert.deepEqual(segunda.map((p) => [p.desde, p.hasta, p.dias]), [['2026-10-21', '2026-10-27', 7]]);
  assert.deepEqual(R.periodosHistorial({ primero: '2025-10-21', corte: '2026-10-21T12:08:11-03:00', existentes }), []);   // misma exportación: nada
  const lejos = R.periodosHistorial({ primero: '2025-10-21', corte: '2026-12-31T23:59:00-03:00', existentes });
  assert.equal(lejos[0].desde, '2026-10-21');
  assert.equal(lejos.at(-1).hasta, '2026-12-31');
  for (let i = 1; i < lejos.length; i++) assert.equal(lejos[i].desde, new Date(Date.parse(`${lejos[i - 1].hasta}T00:00:00Z`) + 86400_000).toISOString().slice(0, 10));
  assert.ok(lejos.every((p) => p.dias <= 30));
});

test('referenciaDe: sale del corte de cada exportación', async () => {
  const { referenciaDe } = await import('./base.mjs');
  assert.equal(referenciaDe('2026-10-21T12:08:11-03:00'), 'export-2110');
  assert.equal(referenciaDe('2026-10-28T23:30:00-03:00'), 'export-2810');
});

test('armarCarga: dos propuestas del mismo grupo (reemplazar o sumar) no se pueden aprobar juntas', () => {
  const plan = { ...PLAN, entidad: 'ctacte', pendientes: {}, secciones: { saldos: [] }, revisar: [
    { clave: 'saldo:710:reemplazar', grupo: 'saldo:710', aplicar: { saldos: [['c', '710', 100, 'inicial', 0, null]] } },
    { clave: 'saldo:710:sumar', grupo: 'saldo:710', aplicar: { saldos: [['c', '710', 100, 'inicial', 0, 50]] } },
  ] };
  assert.throws(() => armarCarga(plan, { usuario: 'u', aprobadas: new Set(['saldo:710:reemplazar', 'saldo:710:sumar']) }), /se excluyen/);
  assert.equal(armarCarga(plan, { usuario: 'u', aprobadas: new Set(['saldo:710:sumar']) }).carga.secciones.saldos[0][5], 50);
});

test('stock.sql, precios.sql, historial.sql y costos.sql: candados de la revisión del 21/10', () => {
  const leer = (f) => readFileSync(join(AQUI, 'aplicar', f), 'utf8');
  assert.match(leer('stock.sql'), /cambiaron_desde_la_simulacion/);
  assert.match(leer('precios.sql'), /v_t := now\(\)/);
  assert.match(leer('precios.sql'), /cambiados_en_odb_despues_de_simular/);
  assert.ok(!/pr\.codigo_legacy = f\.codigo/.test(leer('historial.sql')), 'el historial no busca el producto por código');
  assert.match(leer('costos.sql'), /ch\.creado_en = it\.fecha and ch\.costo = it\.costo/);
  assert.match(leer('costos.sql'), /not like 'export-%'/);
});

test('propuestaFracciones: el negativo de la media docena sale del maple (12 − ceil(4×6/30) = 11)', () => {
  const p = R.propuestaFracciones([{ id: 'media', viejo: -4, upf: 6 }, { id: 'maple', viejo: 12, upf: 30 }]);
  assert.equal(p.get('media'), 0);
  assert.equal(p.get('maple'), 11);
  assert.equal(R.propuestaFracciones([{ id: 'a', viejo: 3, upf: 6 }, { id: 'b', viejo: 2, upf: 30 }]).get('b'), 2);
});

test('destinoHistorial: las ventas de un código reutilizado o repetido no van a otro producto', () => {
  const p = { id: 'vasco' };
  assert.deepEqual(R.destinoHistorial({ estado: 'ok', p, todos: [{}] }, { p }), { prod: 'vasco' });
  assert.equal(R.destinoHistorial({ estado: 'nombre_distinto', p, todos: [{}] }, undefined).prod, null);   // código 20: galletitas ≠ Vasco Viejo
  assert.equal(R.destinoHistorial({ estado: 'ok', p, todos: [{}, {}] }, { p }).prod, null);               // repetido: ventas mezcladas
  assert.equal(R.destinoHistorial(undefined, undefined).prod, null);                                       // el viejo ya no lo tiene
  assert.deepEqual(R.destinoHistorial({ estado: 'sin_producto', p: null, todos: [{}] }, { p: null, alta: true }), { alta: true });
  assert.deepEqual(R.destinoHistorial({ estado: 'inactivo', p, todos: [{}] }, undefined), { prod: 'vasco' });
});
