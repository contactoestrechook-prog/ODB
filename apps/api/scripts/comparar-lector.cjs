// Solo PDFs sintéticos. Sin conexiones a almacenamiento, catálogo ni base de datos.
require('reflect-metadata');
const fs = require('node:fs');
const path = require('node:path');
const { ListasService } = require('../dist/listas/listas.service');
const root = path.resolve(__dirname, '../../..');
const salida = path.join(root, 'docs/comparacion-lector-2026-09-21/resultados.json');
const db = { storage: { from: () => ({ upload: async () => ({ error: null }) }) }, from() {
  const b = {};
  for (const k of ['select','eq','neq','is','not','in','gte','gt','lte','lt','ilike','limit','order','range','or']) b[k] = () => b;
  b.single = b.maybeSingle = async () => ({ data: null, error: null });
  b.then = (ok, err) => Promise.resolve({ data: [], error: null }).then(ok, err);
  return b;
}};
const casos = [
  { file: '01-packs-bonificacion.pdf', total: 14520, neto: 12000, iva: 2520, rows: [{ cantidad: 2, precio: 6000, importe: 12000, unidadesPorBulto: 6 }, { cantidad: 1, precio: 6000, importe: 0, unidadesPorBulto: 6 }] },
  { file: '02-peso-decimales.pdf', total: 907.80, neto: 750.25, iva: 157.55, rows: [{ cantidad: 0.5, precio: 1500.5, importe: 750.25, porPeso: true }] },
  { file: '03-dos-paginas.pdf', total: 847, neto: 700, iva: 147, rows: [{ cantidad: 3, precio: 100, importe: 300 }, { cantidad: 2, precio: 200, importe: 400 }] },
];
(async () => {
  const results = [];
  for (const effort of ['medium', 'high']) {
    process.env.ODB_ESFUERZO_LECTURA = effort;
    for (const caso of casos) {
      const service = new ListasService(db);
      service.sugerirMatchConIA = async () => new Map();
      try {
        const result = await service.analizarComprobanteFoto({ buffer: fs.readFileSync(path.join(root, 'output/pdf/auditoria-integral', caso.file)), mimetype: 'application/pdf', originalname: caso.file });
        const diferencias = [];
        const check = (campo, actual, esperado) => { if (typeof esperado === 'number' ? actual == null || Math.abs(actual - esperado) > 0.011 : actual !== esperado) diferencias.push({ campo, actual, esperado }); };
        check('renglones', result.items.length, caso.rows.length);
        for (const k of ['total', 'neto', 'iva']) check(k, result.impuestos?.[k], caso[k]);
        caso.rows.forEach((expected, index) => {
          const row = result.items[index] ?? {};
          for (const [k, v] of Object.entries(expected)) check(`fila ${index + 1}.${k}`, k === 'cantidad' || k === 'porPeso' ? row.interpretado?.[k] : row[k], v);
        });
        results.push({ effort, file: caso.file, diferencias, result });
        console.log(JSON.stringify({ effort, file: caso.file, demora: result.demora, diferencias }));
      } catch (e) {
        results.push({ effort, file: caso.file, error: e.message });
        console.log(JSON.stringify({ effort, file: caso.file, error: e.message }));
      }
      fs.writeFileSync(salida, JSON.stringify({ azure: 'No evaluado: usuario confirma que no tiene recurso configurado', alcance: 'Tres PDFs sintéticos, una ejecución por configuración; no mide precisión en producción ni matching', results }, null, 2));
    }
  }
  if (results.some(r => r.error || r.diferencias.length)) process.exitCode = 1;
})();
