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
