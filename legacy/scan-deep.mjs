// Scan EXHAUSTIVO: toda tabla/columna de TODOS los .mdb, detecta EAN por nombre y por contenido.
import MDBReader from 'mdb-reader';
import { readFileSync } from 'node:fs';

const DIR = '/Volumes/NO NAME';
const FILES = ['climatizacion.copia.mdb', 'arreglo.mdb', 'basetemporal.mdb', 'bd1.mdb', 'bd1ok.mdb', 'pasarrubros.mdb', 'precios.mdb', 'ZAPATERIA.MDB'];

const isEan = (v) => /^\d{8,14}$/.test(String(v ?? '').trim());
const isEanAR = (v) => /^77\d{11}$/.test(String(v ?? '').trim()) || /^779\d{10}$/.test(String(v ?? '').trim());
const nameBar = (c) => /barra|ean|cbar|cod.?bar|c_?bar|gtin|scan/i.test(c);

for (const f of FILES) {
  let r;
  try { r = new (MDBReader.default ?? MDBReader)(readFileSync(`${DIR}/${f}`)); }
  catch (e) { console.log(`\n📁 ${f} — ABRIR FALLO: ${e.message}`); continue; }
  const eansFile = new Set();
  const hits = [];
  let tablas = 0;
  for (const t of r.getTableNames()) {
    let data;
    try { data = r.getTable(t).getData({ rowLimit: 1e6 }); } catch { continue; }
    if (!data.length) continue;
    tablas++;
    const cols = Object.keys(data[0]);
    for (const c of cols) {
      let ean = 0, eanAR = 0, n = 0; const ex = [];
      for (const row of data) {
        const v = row[c]; if (v == null || v === '') continue; n++;
        if (isEan(v)) { ean++; if (ex.length < 2) ex.push(String(v).trim()); }
        if (isEanAR(v)) { eanAR++; eansFile.add(String(v).trim()); }
      }
      const flag = nameBar(c) || eanAR >= 3 || (n > 0 && ean / n > 0.3 && ean >= 10);
      if (flag) hits.push(`${t}.${c}  (tabla ${data.length}f) · ean ${ean}/${n} · AR ${eanAR}${nameBar(c) ? ' · NOMBRE' : ''}  ej: ${ex.join(', ')}`);
    }
  }
  console.log(`\n📁 ${f} — ${tablas} tablas con datos · EAN-AR distintos: ${eansFile.size}`);
  hits.forEach((h) => console.log('   ↳ ' + h));
}
console.log('\n=== fin ===');
