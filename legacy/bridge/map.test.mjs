// Tests de la lógica pura del bridge. Correr: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapProductos, mapClientes, diff, hashRow, PROD_HASH_FIELDS, CLI_HASH_FIELDS } from './map.mjs';

test('mapProductos une lprecios (precio) ∪ repuestos (costo/stock) por código', () => {
  const lp = [{ codigo: '10', articulo: 'Vino Malbec', rubro: 'Vinos Tintos', precio: '1.500' }];
  const rep = [{ codigo: '10', descripcion: 'Vino Malbec 750', rubro: 'Vinos Tintos', pcosto: '900', CANTIDAD: '12', stockmin: '3', caja: '6' }];
  const [p] = mapProductos(lp, rep);
  assert.equal(p.codigo, '10');
  assert.equal(p.precioFinal, 1500); // viene de lprecios.precio
  assert.equal(p.costo, 900);
  assert.equal(p.stock, 12);
  assert.equal(p.unidades_pack, 6);
  assert.equal(p.es_alcohol, true); // "Vino/Malbec"
});

test('mapProductos usa pventa si no hay precio de lprecios', () => {
  const [p] = mapProductos([], [{ codigo: '7', descripcion: 'Agua', rubro: 'Aguas', pcosto: '100', pventa: '250', CANTIDAD: '0' }]);
  assert.equal(p.precioFinal, 250);
  assert.equal(p.es_alcohol, false);
});

test('mapClientes arma fila por codigo_legacy y detecta cta cte', () => {
  const [c] = mapClientes([{ ID: '500', NOMBRE: 'Kiosco Sur', celular: '11-5555', saldo: '6391', iva: 'consumidor final', dia: 'LUNES', zona: 'Canning' }]);
  assert.equal(c.codigo_legacy, '500');
  assert.equal(c.cta_cte_habilitada, true); // saldo != 0
  assert.equal(c.telefono, '11-5555');
  assert.equal(c.condicion_iva, 'CONSUMIDOR FINAL');
  assert.equal(c.dia_reparto, 'LUNES');
});

test('mapClientes descarta filas sin código o sin nombre', () => {
  const rows = mapClientes([{ ID: '', NOMBRE: 'X' }, { ID: '1', NOMBRE: '' }, { ID: '2', NOMBRE: 'OK' }]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].codigo_legacy, '2');
});

test('diff: primera corrida marca todo como cambiado', () => {
  const rows = mapProductos([{ codigo: '1', articulo: 'A', precio: '10' }], []);
  const d = diff(rows, 'codigo', PROD_HASH_FIELDS, {});
  assert.equal(d.changed.length, 1);
  assert.equal(d.sinCambio, 0);
});

test('diff: sin cambios reales → 0 cambiados (sync incremental)', () => {
  const rows = mapProductos([{ codigo: '1', articulo: 'A', precio: '10' }], []);
  const estado = diff(rows, 'codigo', PROD_HASH_FIELDS, {}).next;
  const d2 = diff(rows, 'codigo', PROD_HASH_FIELDS, estado);
  assert.equal(d2.changed.length, 0);
  assert.equal(d2.sinCambio, 1);
});

test('diff: detecta SOLO la fila que cambió (precio nuevo)', () => {
  const r1 = mapProductos([{ codigo: '1', articulo: 'A', precio: '10' }, { codigo: '2', articulo: 'B', precio: '20' }], []);
  const estado = diff(r1, 'codigo', PROD_HASH_FIELDS, {}).next;
  const r2 = mapProductos([{ codigo: '1', articulo: 'A', precio: '10' }, { codigo: '2', articulo: 'B', precio: '99' }], []);
  const d = diff(r2, 'codigo', PROD_HASH_FIELDS, estado);
  assert.equal(d.changed.length, 1);
  assert.equal(d.changed[0].codigo, '2');
});

test('hashRow es estable e ignora campos no listados', () => {
  const a = { nombre: 'X', precioFinal: 10, otro: 1 };
  const b = { nombre: 'X', precioFinal: 10, otro: 999 };
  assert.equal(hashRow(a, ['nombre', 'precioFinal']), hashRow(b, ['nombre', 'precioFinal']));
});
