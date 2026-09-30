/* Orquestador de Higgsfield: genera, espera y descarga. Nunca imprime la clave.
   Uso:
     node higgs.mjs probe
     node higgs.mjs image "<prompt>" salida.jpg [aspect] [resolution]
     node higgs.mjs video "<image_url>" "<prompt>" <segundos> salida.mp4
     node higgs.mjs status <request_id>
*/
import { readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';

const env = Object.fromEntries(
  readFileSync(homedir() + '/.higgsfield.env', 'utf8').split('\n')
    .filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()])
);
const AUTH = `Key ${env.HF_KEY_ID}:${env.HF_KEY_SECRET}`;
const BASE = 'https://platform.higgsfield.ai';
const H = { 'Authorization': AUTH, 'Content-Type': 'application/json', 'Accept': 'application/json' };

const redact = s => String(s).replaceAll(env.HF_KEY_SECRET, '<secret>').replaceAll(env.HF_KEY_ID, '<key-id>');
const log = (...a) => console.log(...a.map(redact));

async function req(method, path, body) {
  const r = await fetch(BASE + path, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  const txt = await r.text();
  let j; try { j = JSON.parse(txt); } catch { j = { raw: txt.slice(0, 600) }; }
  return { status: r.status, j };
}

function findId(j) {
  for (const k of ['request_id', 'id', 'requestId']) if (j && j[k]) return j[k];
  if (j && j.data) return findId(j.data);
  return null;
}
function findUrls(o, acc = []) {
  if (!o || typeof o !== 'object') return acc;
  for (const [k, v] of Object.entries(o)) {
    if (typeof v === 'string' && /^https?:\/\//.test(v) && /(\.mp4|\.png|\.jpe?g|\.webp)(\?|$)|media|storage|cdn/i.test(v)) acc.push(v);
    else if (typeof v === 'object') findUrls(v, acc);
  }
  return acc;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function poll(id, maxMin = 12) {
  const paths = [`/requests/${id}/status`, `/v1/requests/${id}/status`, `/requests/${id}`];
  let path = null;
  for (const p of paths) { const { status } = await req('GET', p); if (status !== 404) { path = p; break; } }
  if (!path) throw new Error('no encuentro el endpoint de status');
  const t0 = Date.now();
  for (;;) {
    const { j } = await req('GET', path);
    const st = j.status || j.state || (j.jobs && j.jobs[0] && j.jobs[0].status) || '?';
    process.stdout.write(`\r  estado: ${st}  ${((Date.now() - t0) / 1000).toFixed(0)}s   `);
    if (/completed|succeeded|done|ready/i.test(st)) { console.log(); return j; }
    if (/failed|error|nsfw|canceled/i.test(st)) { console.log(); throw new Error('falló: ' + redact(JSON.stringify(j)).slice(0, 500)); }
    if ((Date.now() - t0) / 60000 > maxMin) throw new Error('timeout de polling');
    await sleep(6000);
  }
}

async function download(url, out) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('descarga falló ' + r.status);
  writeFileSync(out, Buffer.from(await r.arrayBuffer()));
  log('  guardado →', out);
}

const [cmd, ...args] = process.argv.slice(2);

if (cmd === 'probe') {
  const { status, j } = await req('GET', '/requests/00000000-0000-0000-0000-000000000000/status');
  log('status endpoint →', status, JSON.stringify(j).slice(0, 200));
  const { status: s2, j: j2 } = await req('POST', '/higgsfield-ai/soul/standard', {});
  log('soul (payload vacío) →', s2, JSON.stringify(j2).slice(0, 400));
  process.exit(0);
}

if (cmd === 'image') {
  const [prompt, out, aspect = '9:16', resolution = '1080p'] = args;
  const body = { prompt, aspect_ratio: aspect, resolution };
  let { status, j } = await req('POST', '/higgsfield-ai/soul/standard', body);
  if (status >= 400 && /resolution/i.test(JSON.stringify(j))) {
    ({ status, j } = await req('POST', '/higgsfield-ai/soul/standard', { prompt, aspect_ratio: aspect, resolution: '720p' }));
  }
  log('submit →', status, JSON.stringify(j).slice(0, 500));
  if (status >= 400) process.exit(1);
  const id = findId(j);
  log('request_id:', id);
  const done = await poll(id);
  const urls = [...new Set(findUrls(done))];
  log('urls:', JSON.stringify(urls, null, 1));
  const img = urls.find(u => /\.(png|jpe?g|webp)(\?|$)/i.test(u)) || urls[0];
  if (img && out) { await download(img, out); log('IMAGE_URL=' + img); }
  process.exit(0);
}

if (cmd === 'video') {
  const [imageUrl, prompt, dur, out] = args;
  const bodies = [
    { model: 'dop-turbo', prompt, duration: Number(dur), input_images: [{ type: 'image_url', image_url: imageUrl }] },
    { prompt, duration: Number(dur), image_url: imageUrl },
  ];
  let resp = null;
  for (const b of bodies) {
    const r = await req('POST', '/higgsfield-ai/dop/standard', b);
    log('submit →', r.status, JSON.stringify(r.j).slice(0, 500));
    if (r.status < 400) { resp = r; break; }
  }
  if (!resp) process.exit(1);
  const id = findId(resp.j);
  log('request_id:', id);
  const done = await poll(id, 20);
  const urls = [...new Set(findUrls(done))];
  log('urls:', JSON.stringify(urls, null, 1));
  const mp4 = urls.find(u => /\.mp4(\?|$)/i.test(u)) || urls[0];
  if (mp4 && out) await download(mp4, out);
  process.exit(0);
}

if (cmd === 'status') {
  const done = await poll(args[0], 0.2).catch(e => log(String(e)));
  if (done) log(JSON.stringify(done, null, 1).slice(0, 1500));
  process.exit(0);
}

log('comando desconocido');
process.exit(1);
