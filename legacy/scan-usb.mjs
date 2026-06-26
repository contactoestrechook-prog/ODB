// Escanea (SOLO LECTURA) los .mdb del USB: tablas con datos, columnas y detección de EAN/código de barras.
import MDBReader from 'mdb-reader';
import { readFileSync } from 'node:fs';

const DIR = '/Volumes/NO NAME';
const FILES = ['arreglo.mdb', 'basetemporal.mdb', 'bd1.mdb', 'bd1ok.mdb', 'pasarrubros.mdb', 'precios.mdb', 'ZAPATERIA.MDB'];

const esEan = (v) => { const s = String(v ?? '').trim(); return /^\d{8,14}$/.test(s); };
const esEanAR = (v) => /^77\d{11}$/.test(String(v ?? '').trim()); // EAN-13 argentino (779...)

for (const f of FILES) {
  console.log('\n========================================');
  console.log('📁', f);
  let r;
  try { r = new (MDBReader.default ?? MDBReader)(readFileSync(`${DIR}/${f}`)); }
  catch (e) { console.log('  ✗ no se pudo abrir:', e.message); continue; }
  let tablas;
  try { tablas = r.getTableNames(); } catch (e) { console.log('  ✗ sin tablas:', e.message); continue; }

  for (const t of tablas) {
    let data;
    try { data = r.getTable(t).getData({ rowLimit: 100000 }); } catch { continue; }
    if (!data.length) continue;
    const cols = Object.keys(data[0]);
    // detección de columnas tipo código de barras
    const flags = [];
    for (const c of cols) {
      let ean = 0, eanAR = 0, n = 0;
      for (const row of data) { const v = row[c]; if (v == null || v === '') continue; n++; if (esEan(v)) ean++; if (esEanAR(v)) eanAR++; }
      if (n > 0 && ean / n > 0.5 && ean >= 5) {
        const ej = data.map((x) => x[c]).filter((v) => esEan(v)).slice(0, 2);
        flags.push(`${c} [${ean}/${n} num 8-14díg${eanAR ? `, ${eanAR} EAN-AR 779` : ''}] ej: ${ej.join(', ')}`);
      }
    }
    const marca = flags.length ? '  🔵 POSIBLE CÓDIGO DE BARRA' : '';
    console.log(`  • ${t} — ${data.length} filas, ${cols.length} cols${marca}`);
    if (flags.length) flags.forEach((x) => console.log(`        ↳ ${x}`));
    // mostrar columnas solo para tablas con datos relevantes (<=40 cols)
    if (data.length >= 3 && cols.length <= 40) console.log(`        cols: ${cols.join(', ')}`);
  }
}
console.log('\n=== fin ===');
