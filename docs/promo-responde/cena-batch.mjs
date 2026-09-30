/* Genera los 7 planos restantes de LA CENA en paralelo y los baja a footage/. */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { homedir } from 'os';

const env = Object.fromEntries(
  readFileSync(homedir() + '/.higgsfield.env', 'utf8').split('\n')
    .filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()])
);
const BASE = 'https://platform.higgsfield.ai';
const H = { 'Authorization': `Key ${env.HF_KEY_ID}:${env.HF_KEY_SECRET}`, 'Content-Type': 'application/json', 'Accept': 'application/json' };
const MASTER = 'https://d3u0tzju9qaucj.cloudfront.net/5148c1d3-6ada-4b2d-8469-1927ac4c532f/25bdf9bd-f53c-4f18-a718-7a3cdbd3e570.png';
const SUFFIX = ' ONLY the woman ever speaks; the man never talks, his lips stay closed. Upscale candle-lit restaurant, warm key light, deep shadows, crushed blacks, subtle handheld micro-movement, cinematic, photorealistic, film grain.';

const SHOTS = [
  ['p01', 'Slow dolly-in on the two-shot at the elegant dinner table. The woman talks warmly, gesturing gently; the man listens IN SILENCE, mouth closed, nodding slightly, and glances down twice at the glowing lit phone screen on the tablecloth.'],
  ['p04', 'Medium close on the businessman, silent, mouth closed. The smartphone on the tablecloth LIGHTS UP with a new notification, its bright screen casting a glow on the white cloth; his eyes drop to the glowing screen, then back up to the woman, then down to the screen again. He never speaks.'],
  ['p07', 'The businessman, silent, mouth closed, stares down at the glowing lit smartphone screen on the table, completely absorbed, the cold screen light reflecting on his face, while the woman keeps talking to him. He never looks up and never speaks.'],
  ['p12', 'Very slow push-in on the two-shot. The phone lies face-down and dark on the tablecloth, ignored. The businessman, silent with his mouth closed, looks only at the woman with warm full attention while she talks and smiles. He just listens.'],
];

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function req(method, path, body) {
  const r = await fetch(BASE + path, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = { raw: t.slice(0, 300) }; }
  return { status: r.status, j };
}
function findUrls(o, acc = []) {
  if (!o || typeof o !== 'object') return acc;
  for (const v of Object.values(o)) {
    if (typeof v === 'string' && /^https?:\/\//.test(v) && /\.mp4(\?|$)/i.test(v)) acc.push(v);
    else if (typeof v === 'object') findUrls(v, acc);
  }
  return acc;
}

async function one(name, prompt) {
  const out = `footage/${name}.mp4`;
  if (existsSync(out)) { console.log(name, 'ya existe, salto'); return; }
  let status, j;
  for (let intento = 0; intento < 40; intento++) {
    ({ status, j } = await req('POST', '/higgsfield-ai/dop/standard', { image_url: MASTER, prompt: prompt + SUFFIX, duration: 5 }));
    if (status < 400) break;
    if (/concurrent/i.test(JSON.stringify(j))) { console.log(name, 'slots llenos, espero…'); await sleep(45000); continue; }
    console.log(name, 'SUBMIT FALLÓ', status, JSON.stringify(j).slice(0, 300)); return;
  }
  if (status >= 400) { console.log(name, 'SUBMIT FALLÓ tras reintentos'); return; }
  const id = j.request_id;
  console.log(name, 'enviado', id);
  const t0 = Date.now();
  for (;;) {
    await sleep(9000);
    const { j: s } = await req('GET', `/requests/${id}/status`);
    const st = s.status || '?';
    if (/completed/i.test(st)) {
      const url = findUrls(s)[0];
      const r = await fetch(url);
      writeFileSync(out, Buffer.from(await r.arrayBuffer()));
      console.log(name, 'LISTO en', ((Date.now() - t0) / 60000).toFixed(1), 'min →', out);
      return;
    }
    if (/failed|error|nsfw|canceled/i.test(st)) { console.log(name, 'FALLÓ', JSON.stringify(s).slice(0, 300)); return; }
    if ((Date.now() - t0) / 60000 > 25) { console.log(name, 'TIMEOUT'); return; }
  }
}

/* máximo 4 simultáneos */
const queue = [...SHOTS];
async function worker(){ for(;;){ const it = queue.shift(); if(!it) return; await one(it[0], it[1]); } }
await Promise.all([worker(), worker(), worker(), worker()]);
console.log('BATCH TERMINADO');
