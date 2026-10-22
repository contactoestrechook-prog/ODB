// Pruebas del lector de la exportación CSV. Datos inventados (nunca los .csv
// reales: tienen datos de clientes). Correr: node --test scripts/sistema-viejo/exportacion
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  registros, numero, fecha, fechaEnRango, leerArticulos, leerStock, leerBarras, leerListas, columnaDeLista,
  leerPorProveedor, leerClientes, leerCtaCte, validarCtaCte, recorrerVentas, leerExportacion, claveClienteOdb,
} from './leer.mjs';

const csv = (...lineas) => lineas.join('\r\n') + '\r\n';

test('registros: CRLF separa registros; un LF suelto o \\x01 dentro de un campo se limpian y se avisa', () => {
  const avisos = [];
  const { encabezado, filas } = registros(csv('a;b;c', '1;dos\ny tres\x01;3', '4;5;6'), avisos, 'x');
  assert.deepEqual(encabezado, ['a', 'b', 'c']);
  assert.equal(filas.length, 2);
  assert.deepEqual(filas[0].campos, ['1', 'dos y tres', '3']);
  assert.ok(avisos.some((a) => /caracteres de control/.test(a.aviso)));
});

test('registros: un registro partido en dos renglones (CRLF dentro de un campo) se junta', () => {
  const avisos = [];
  const { filas } = registros(csv('a;b;c', '1;mitad', 'otra;3', '4;5;6'), avisos, 'x');
  assert.equal(filas.length, 2);
  assert.deepEqual(filas[0].campos, ['1', 'mitad otra', '3']);
  assert.ok(avisos.some((a) => /partido/.test(a.aviso)));
});

test('numero: coma decimal y miles con punto; lo ambiguo es NaN (nunca se adivina)', () => {
  assert.equal(numero('6510,23'), 6510.23);
  assert.equal(numero('1.234,5'), 1234.5);
  assert.equal(numero('-7'), -7);
  assert.equal(numero(''), null);
  assert.ok(Number.isNaN(numero('0.105')));
  assert.ok(Number.isNaN(numero('abc')));
});

test('fecha y fechaEnRango: día y hora argentina; las fechas de 1978 quedan sin fecha con aviso', () => {
  assert.equal(fecha('21/10/2026'), '2026-10-21');
  assert.deepEqual(fecha('21/10/2026 12:08:11'), { dia: '2026-10-21', iso: '2026-10-21T12:08:11-03:00' });
  assert.equal(fecha('31/02/2026'), null);
  const avisos = [];
  assert.equal(fechaEnRango('28/1/1978', { archivo: 'ctacte', avisos, corte: '2026-10-21' }), null);
  assert.equal(avisos.length, 1);
  assert.equal(fechaEnRango('22/10/2026', { corte: '2026-10-21', avisos }), null);
});

const ART = csv(
  'Código interno;Descripcion;RUBRO;unidades por pack o caja;alícuota de IVA;costo actual;Lista Precio 1;Lista Precio 2;Lista Precio 3;Lista Precio 4;PLU de balanza;proveedor habitual',
  '10;Trumpeter Malbec 750cc;Vinos;6;21;6510,23;10900;10900;10900;9114,32;10;DRINK',
  '20;Queso Tybo x kg;Quesos;0;21;8000;12000;12000;12000;11200;20;LACTEOS',
  '30;Procenex 1800 ml;Limpieza;1;21;1000;2000;2000;2000;1400;30;LIMPIA',
  '30;Gin Bombay Sunset;Gin;1;21;30000;45000;45000;45000;42000;30;DRINK',
);

test('leerArticulos: código repetido marca las DOS filas; pack 0 es sin dato; el PLU igual al código no se devuelve', () => {
  const avisos = [];
  const a = leerArticulos(ART, avisos);
  assert.equal(a.length, 4);
  assert.equal(a[0].costo, 6510.23);
  assert.equal(a[0].pack, 6);
  assert.equal(a[1].pack, null);
  assert.equal(a[0].plu, undefined);
  assert.deepEqual(a.filter((x) => x.repetido).map((x) => x.descripcion), ['Procenex 1800 ml', 'Gin Bombay Sunset']);
  assert.ok(avisos.some((x) => /repetido/.test(x.aviso)));
});

test('leerStock: alineado fila a fila con articulos; una sucursal desconocida frena la lectura', () => {
  const art = leerArticulos(ART, []);
  const st = leerStock(csv('Código interno;sucursal;cantidad a la fecha;fecha y hora del corte;stock mínimo;último costo de compra',
    '10;Sant Thomas;6,855;21/10/2026 12:08:11;12;6510,23', '20;Sant Thomas;-7;21/10/2026 12:08:11;0;8000',
    '30;Sant Thomas;3;21/10/2026 12:08:11;0;1000', '30;Sant Thomas;1;21/10/2026 12:08:11;0;30000'), art, []);
  const s = [...st.values()][0];
  assert.equal(s.alineado, true);
  assert.equal(s.corte, '2026-10-21T12:08:11-03:00');
  assert.equal(s.filas[0].cantidad, 6.855);
  assert.throws(() => leerStock(csv('Código interno;sucursal;cantidad a la fecha;fecha y hora del corte;stock mínimo;último costo de compra', '10;Otra;1;21/10/2026 12:08:11;0;1'), art, []), /no es ninguna de ODB/);
});

test('leerListas: el encabezado viene corrido; las columnas salen del contenido', () => {
  const art = leerArticulos(ART, []);
  const avisos = [];
  const l = leerListas(csv('Nombre de Lista;código del producto;último precio', '10;Lista Unitaria;10900', '20;Lista ODB ;12000', '30;;1400', '20;Lista Restos;12000'), art, avisos);
  assert.deepEqual(l[0], { renglon: 2, codigo: '10', lista: 'Lista Unitaria', precio: 10900 });
  assert.equal(columnaDeLista('Lista ODB'), 'p2');
  assert.equal(columnaDeLista(''), 'p4');
  assert.equal(columnaDeLista('Lista Restos'), 'p3');
  assert.ok(avisos.some((a) => /encabezado corrido/.test(a.aviso)));
  assert.throws(() => leerListas(csv('a;b;c', 'x;y;z'), art, []), /no puedo decidir/);
});

test('leerPorProveedor: va por posición y se valida con el costo; el par de un código repetido cruzado se corrige', () => {
  const art = leerArticulos(ART, []);
  const pp = leerPorProveedor(csv('Código interno;código del proveedor;último costo;fecha costo',
    ';1;6510,23;15/9/2026', ';7;9000;21/10/2026', ';3;30000;1/5/2026', ';1;1000;2/5/2026'), art, [], { corte: '2026-10-21T12:08:11-03:00' });
  assert.equal(pp[0].codigo, '10');
  assert.equal(pp[0].coincide, true);
  assert.equal(pp[1].coincide, false);           // 9000 ≠ 8000: dos versiones
  assert.equal(pp[1].mas_nuevo, true);           // del día del corte
  assert.equal(pp[2].coincide, true);            // corregido: el par venía al revés
  assert.equal(pp[2].costo, 1000);
  assert.equal(pp[3].costo, 30000);
  assert.match(pp[2].corregido, /cruzado/);
});

test('leerBarras: formato raro, EAN repetido en dos artículos y etiquetas de balanza', () => {
  const b = leerBarras(csv('Código interno del producto;código de barras (EAN);descripción del código;cantidad que representa',
    '10;7790577040525;UNIDAD;1', '10;7790577040532;CAJA;6', '20;2;UNIDAD;1', '30;4006381333931;UNIDAD;1', '20;4006381333931;UNIDAD;1', '20;2003931002905;UNIDAD;1'), []);
  assert.equal(b[1].tipo, 'CAJA');
  assert.equal(b[1].cantidad, 6);
  assert.equal(b[2].formato_raro, true);
  assert.equal(b[3].ean_repetido, true);
  assert.equal(b[5].parece_balanza, true);
});

const CLI = csv(
  'Código interno;nombre y apellido o razón social;CUIT;condición ante el IVA;teléfono;email;domicilio;barrio;zona;saldo actual;vendedor',
  '7;Juan Perez;20123456786;CONSUMIDOR FINAL;11 2233-4455;;;;;1500,5;Ana',
  '8;Empresa SA;30712345671;RESPONSABLE INSCRIPTO;;;;;;0;Ana',
  '8;Otra Persona;;CONSUMIDOR FINAL;;;;;;-200;Ana\x01',
);

test('leerClientes: un código repetido marca las dos filas (dos personas); la clave de ODB lleva prefijo', () => {
  const c = leerClientes(CLI, []);
  assert.equal(c.length, 3);
  assert.equal(c[0].saldo, 1500.5);
  assert.deepEqual(c.filter((x) => x.repetido).map((x) => x.nombre), ['Empresa SA', 'Otra Persona']);
  assert.equal(c[2].vendedor, 'Ana');
  assert.equal(claveClienteOdb(' 7 '), 'st-7');
});

test('leerCtaCte y validarCtaCte: el último saldo corrido se compara con la ficha; los repetidos se marcan', () => {
  const cli = leerClientes(CLI, []);
  const avisos = [];
  const cc = leerCtaCte(csv('Código del cliente;fecha;tipo;número de comprobante;importe;saldo',
    '7;1/10/2026;VENTA;1;1500,5;1500,5', '8;28/1/1978;VENTA;2;100;100', '8;2/10/2026;PAGO;3;-300;-200'), avisos, { corte: '2026-10-21' });
  assert.equal(cc[1].fecha, null);
  const r = validarCtaCte(cc, cli, avisos);
  assert.equal(r.clientes, 2);
  assert.equal(r.de_repetidos, 1);
  assert.equal(r.ultimo_saldo_distinto, 0);
});

test('recorrerVentas: un renglón por venta, sin hora; la sucursal se traduce a la de ODB', () => {
  const v = [...recorrerVentas(csv('Fecha;sucursal;número de ticket o factura;código del producto;CANTIDAD;precio unitario;medio de pago;cliente',
    '21/10/2025;Sant Thomas;FAC - R3-80007;9844;0,105;23600;CONTADO;Clientes Local'), [], { corte: '2026-10-21' })];
  assert.equal(v.length, 1);
  assert.equal(v[0].cantidad, 0.105);
  assert.equal(v[0].sucursal_id, '229906e6-df69-48eb-b027-2b57fefb89fe');
  assert.equal(v[0].fecha, '2025-10-21');
});

test('leerExportacion: lee los 9 archivos en latin-1 y saca el corte del stock', () => {
  const dir = mkdtempSync(join(tmpdir(), 'exp-'));
  try {
    const escribir = (n, t) => writeFileSync(join(dir, `${n}.csv`), Buffer.from(t, 'latin1'));
    escribir('articulos', ART);
    escribir('stock', csv('Código interno;sucursal;cantidad a la fecha;fecha y hora del corte;stock mínimo;último costo de compra',
      '10;Sant Thomas;1;21/10/2026 12:08:11;0;1', '20;Sant Thomas;2;21/10/2026 12:08:11;0;1', '30;Sant Thomas;3;21/10/2026 12:08:11;0;1', '30;Sant Thomas;4;21/10/2026 12:08:11;0;1'));
    escribir('codigobarras', csv('Código interno del producto;código de barras (EAN);descripción del código;cantidad que representa', '10;7790577040525;UNIDAD;1'));
    escribir('listadeprecios', csv('Nombre de Lista;código del producto;último precio', '10;Lista Unitaria;10900', '20;Lista Unitaria;12000', '30;Lista Unitaria;2000'));
    escribir('proveedores', csv('Código interno;razón social;CUIT;teléfono;email;descuento', '1;DRINK SOLUTIONS;;;;0'));
    escribir('productosxproveedor', csv('Código interno;código del proveedor;último costo;fecha costo', ';1;6510,23;15/9/2026', ';1;8000;1/9/2026', ';1;1000;1/9/2026', ';1;30000;1/9/2026'));
    escribir('clientes', CLI);
    escribir('ctacte_clientes', csv('Código del cliente;fecha;tipo;número de comprobante;importe;saldo', '7;1/10/2026;VENTA;1;1500,5;1500,5'));
    escribir('ventas', csv('Fecha;sucursal;número de ticket o factura;código del producto;CANTIDAD;precio unitario;medio de pago;cliente', '1/10/2026;Sant Thomas;T1;10;1;10900;CONTADO;Clientes Local'));
    const e = leerExportacion(dir);
    assert.equal(e.corte, '2026-10-21T12:08:11-03:00');
    assert.equal(e.diaCorte, '2026-10-21');
    assert.equal(e.articulos.length, 4);
    assert.equal(e.articulos[1].descripcion, 'Queso Tybo x kg');
    assert.ok(e.ventasTexto.includes('Clientes Local'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
