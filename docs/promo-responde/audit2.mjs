/* Auditor v2 · contención total: mide TODOS los elementos visibles del stage
   (texto por glifos + cajas con fondo/borde por su rect) contra el marco
   interior del HUD, a 30 muestras por segundo (atrapa los picos de shake). */
import { chromium } from 'playwright-core';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const args = process.argv.slice(2);
const FILE = args[args.indexOf('--file') + 1];
const STEP = 1 / 30;
const SAFE = { x0: 76, x1: 1004, y0: 94, y1: 1826 };

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
page.on('pageerror', e => console.error('PAGE ERROR:', e.message));
await page.goto('file://' + join(HERE, FILE));
await page.evaluate(() => window.READY);

const DUR = await page.evaluate(() => window.DURATION);
const worst = new Map();
for (let t = 0; t <= DUR; t += STEP) {
  const bad = await page.evaluate(({ t, SAFE }) => {
    window.seek(t);
    const out = [];
    const stage = document.getElementById('stage');
    const push = (el, r, kind) => {
      if (r.width < 2 || r.height < 2) return;
      if (r.left < SAFE.x0 || r.right > SAFE.x1 || r.top < SAFE.y0 || r.bottom > SAFE.y1) {
        out.push({ id: el.id || (el.className && String(el.className).split(' ')[0]) || el.tagName, kind,
          l: Math.round(r.left), r: Math.round(r.right), tp: Math.round(r.top), b: Math.round(r.bottom),
          txt: (el.textContent || '').trim().slice(0, 24) });
      }
    };
    const walk = el => {
      for (const c of el.children) {
        const cs = getComputedStyle(c);
        if (cs.display === 'none' || parseFloat(cs.opacity) < 0.05) continue;
        /* ¿lo recorta una máscara? */
        let clipped = false;
        for (let p = c.parentElement; p && p !== document.body; p = p.parentElement) {
          if (getComputedStyle(p).overflow === 'hidden') {
            const pr = p.getBoundingClientRect(), cr = c.getBoundingClientRect();
            const ov = Math.min(cr.bottom, pr.bottom) - Math.max(cr.top, pr.top);
            if (ov < cr.height * 0.4) { clipped = true; break; }
          }
        }
        if (clipped) continue;
        if (String(c.className).includes('ghostnum')) continue;
        const hasText = [...c.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
        if (hasText) {
          const rg = document.createRange(); rg.selectNodeContents(c);
          push(c, rg.getBoundingClientRect(), 'txt');
        }
        const hasBox = (cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && !c.classList.contains('layer'))
                    || parseFloat(cs.borderTopWidth) > 0;
        if (hasBox && !hasText) push(c, c.getBoundingClientRect(), 'box');
        walk(c);
      }
    };
    walk(stage);
    return out;
  }, { t, SAFE });
  for (const b of bad) {
    const over = Math.max(SAFE.x0 - b.l, b.r - SAFE.x1, SAFE.y0 - b.tp, b.b - SAFE.y1);
    const k = b.id + '|' + b.txt + '|' + b.kind;
    if (!worst.has(k) || worst.get(k).over < over) worst.set(k, { ...b, over, t: t.toFixed(2) });
  }
}
await browser.close();
if (!worst.size) console.log('✓ contención total —', FILE);
else {
  console.log('FUERA DEL MARCO en', FILE);
  [...worst.values()].sort((a, b) => b.over - a.over).slice(0, 14).forEach(w =>
    console.log(`  ${String(Math.round(w.over)).padStart(4)}px  t=${w.t}  [${w.kind}] ${w.id}  x[${w.l}→${w.r}] y[${w.tp}→${w.b}]  "${w.txt}"`));
}
