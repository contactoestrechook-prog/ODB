/* ============================================================
   MOTOR compartido de la serie RESPONDE · estética metogroup.ar
   Newsreader (serif editorial) + Inter Tight (micro-labels) ·
   negro #0c0c0c/#161616 · hueso #f5f3ee · tan #c9a96e · grano pesado.
   Cada composición define escenas y llama a estas piezas.
   ============================================================ */

/* ---------- utilidades ---------- */
const $ = id => document.getElementById(id);
const clamp01 = x => x < 0 ? 0 : x > 1 ? 1 : x;
const lerp = (a, b, x) => a + (b - a) * x;
const iv = (t, a, b) => clamp01((t - a) / (b - a));
const E = {
  linear: x => x,
  outQuad: x => 1 - (1 - x) * (1 - x),
  inQuad: x => x * x,
  outCubic: x => 1 - Math.pow(1 - x, 3),
  inCubic: x => x * x * x,
  inOutCubic: x => x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2,
  outExpo: x => x >= 1 ? 1 : 1 - Math.pow(2, -10 * x),
  inExpo: x => x <= 0 ? 0 : Math.pow(2, 10 * x - 10),
  outQuint: x => 1 - Math.pow(1 - x, 5),
  outBack: x => { const c = 1.70158; const d = c + 1; return 1 + d * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); },
  outBackS: x => { const c = 1.1; const d = c + 1; return 1 + d * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); },
};
function seg(t, a, b, e) { return (e || E.linear)(iv(t, a, b)); }
function kf(t, stops) {
  if (t <= stops[0].t) return stops[0].v;
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i].t) {
      const a = stops[i - 1], b = stops[i];
      return lerp(a.v, b.v, (b.e || E.linear)(iv(t, a.t, b.t)));
    }
  }
  return stops[stops.length - 1].v;
}
function mulberry(s) { return function () { let z = s += 0x6D2B79F5; z = Math.imul(z ^ z >>> 15, z | 1); z ^= z + Math.imul(z ^ z >>> 7, z | 61); return ((z ^ z >>> 14) >>> 0) / 4294967296; }; }
function decayShake(t, t0, amp, freq, dur) {
  if (t < t0 || t > t0 + dur) return { x: 0, y: 0, r: 0 };
  const p = (t - t0) / dur, d = Math.pow(1 - p, 2.2);
  return {
    x: Math.sin((t - t0) * freq * 2 * Math.PI) * amp * d,
    y: Math.cos((t - t0) * freq * 1.7 * Math.PI) * amp * .7 * d,
    r: Math.sin((t - t0) * freq * 1.3 * Math.PI) * amp * .05 * d
  };
}

/* ---------- CSS base ---------- */
const BASE_CSS = `
  * { margin:0; padding:0; box-sizing:border-box; }
  html,body { background:#000; overflow:hidden; }
  #viewport { position:fixed; inset:0; width:1080px; height:1920px; overflow:hidden; background:#0c0c0c; }
  #camera { position:absolute; left:0; top:0; width:1080px; height:1920px; transform-origin:0 0; will-change:transform,filter; }
  .layer { position:absolute; left:0; top:0; width:1080px; height:1920px; }
  .lbl { font-family:'Inter Tight',sans-serif; font-weight:300; text-transform:uppercase; letter-spacing:.24em; }
  .lblb { font-family:'Inter Tight',sans-serif; font-weight:700; }
  .ser { font-family:'Newsreader',Georgia,serif; letter-spacing:-.03em; }
  .seri { font-family:'Newsreader',Georgia,serif; font-style:italic; letter-spacing:-.02em; }
  .tan { color:#c9a96e; }
  .bone { color:#f5f3ee; }
  .dim { color:rgba(245,243,238,.42); }
  .ink { color:#0d0c0a; }

  /* mundo: papel vs oscuro */
  #paperbg { position:absolute; inset:0; background:#f5f3ee; opacity:0; }
  #fogdark, #fogpaper { position:absolute; inset:0; }
  .fog { position:absolute; border-radius:50%; filter:blur(90px); }

  /* overlays fijos */
  #grainD { position:fixed; left:-80px; top:-80px; width:1240px; height:2080px; opacity:.11; pointer-events:none; z-index:60; mix-blend-mode:screen;
    background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='260' height='260'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.75' numOctaves='2'/%3E%3C/filter%3E%3Crect width='260' height='260' filter='url(%23n)' opacity='0.95'/%3E%3C/svg%3E"); }
  #grainP { position:fixed; left:-80px; top:-80px; width:1240px; height:2080px; opacity:0; pointer-events:none; z-index:60; mix-blend-mode:multiply;
    background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='260' height='260'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.75' numOctaves='2'/%3E%3C/filter%3E%3Crect width='260' height='260' filter='url(%23n)' opacity='0.95'/%3E%3C/svg%3E"); }
  #scan { position:fixed; inset:0; z-index:57; pointer-events:none; opacity:.05;
    background:repeating-linear-gradient(0deg, rgba(255,255,255,.09) 0 1px, transparent 1px 4px); }
  #vigD { position:fixed; inset:0; z-index:55; pointer-events:none;
    background:radial-gradient(ellipse 125% 92% at 50% 44%, transparent 52%, rgba(0,0,0,.5) 100%); }
  #vigP { position:fixed; inset:0; z-index:55; pointer-events:none; opacity:0;
    background:radial-gradient(ellipse 125% 92% at 50% 44%, transparent 55%, rgba(60,48,30,.32) 100%); }
  #flash { position:fixed; inset:0; z-index:58; pointer-events:none; opacity:0;
    background:radial-gradient(ellipse 85% 60% at 50% 44%, rgba(240,225,195,.95), rgba(201,169,110,.3) 55%, transparent 78%); }
  #blackout { position:fixed; inset:0; z-index:70; background:#000; opacity:0; pointer-events:none; }
  #boneout { position:fixed; inset:0; z-index:69; background:#f5f3ee; opacity:0; pointer-events:none; }

  .dust { position:absolute; border-radius:50%; }

  /* teléfono / chat */
  .phone { position:absolute; left:190px; top:400px; width:700px; height:1330px; background:#060505;
    border-radius:58px; padding:14px; box-shadow:0 60px 130px rgba(0,0,0,.65), 0 0 0 2px rgba(245,243,238,.07); }
  .screen { width:100%; height:100%; border-radius:46px; overflow:hidden; position:relative; }
  .screen.dark { background:#111010; }
  .screen.paper { background:#efece4; }
  .notch { position:absolute; left:50%; top:12px; transform:translateX(-50%); width:170px; height:30px; background:#060505; border-radius:18px; z-index:5; }
  .chathead { padding:58px 34px 20px; display:flex; align-items:center; gap:18px; border-bottom:1px solid rgba(128,120,105,.18); }
  .mono { width:64px; height:64px; border-radius:14px; display:grid; place-items:center; font-size:34px; flex-shrink:0;
    background:#c9a96e; color:#141210; font-family:'Newsreader',serif; font-weight:600; }
  .chatname { font-family:'Inter Tight',sans-serif; font-weight:700; font-size:26px; }
  .chatsub { font-family:'Inter Tight',sans-serif; font-weight:300; font-size:19px; letter-spacing:.14em; text-transform:uppercase; margin-top:3px; }
  .chanbadge { margin-left:auto; font-family:'Inter Tight',sans-serif; font-weight:300; letter-spacing:.16em; font-size:17px;
    padding:10px 16px; border:1px solid rgba(201,169,110,.6); color:#c9a96e; border-radius:8px; white-space:nowrap; }
  .stream { position:absolute; left:0; right:0; top:168px; bottom:0; padding:28px 30px; display:flex; flex-direction:column; gap:18px; }
  .bub { max-width:520px; padding:22px 26px; border-radius:22px; position:relative;
    font-family:'Inter Tight',sans-serif; font-weight:500; font-size:25px; line-height:1.42; }
  .bub .btime { display:block; margin-top:10px; font-size:16px; font-weight:300; letter-spacing:.1em; opacity:.55; text-align:right; }
  .bubin { align-self:flex-start; border-bottom-left-radius:6px; }
  .bubout { align-self:flex-end; border-bottom-right-radius:6px; }
  .dark .bubin { background:#1f1e1c; color:#f5f3ee; }
  .dark .bubout { background:#2c2517; color:#f5f3ee; border:1px solid rgba(201,169,110,.35); }
  .paper .bubin { background:#ffffff; color:#171512; box-shadow:0 6px 18px rgba(40,32,18,.08); }
  .paper .bubout { background:#e2d3b1; color:#171512; }
  .typing { display:inline-flex; gap:9px; padding:24px 28px; }
  .typing i { width:12px; height:12px; border-radius:50%; background:#8b8378; display:block; }
  .linkpill { margin-top:14px; display:flex; align-items:center; gap:12px; border-radius:14px; padding:16px 18px;
    font-family:'Inter Tight',sans-serif; font-weight:700; font-size:21px; }
  .dark .linkpill { background:#101b25; color:#9fc6ea; border:1px solid rgba(120,180,230,.35); }
  .calcard { margin-top:14px; border-radius:14px; padding:18px 20px; display:flex; gap:16px; align-items:center;
    font-family:'Inter Tight',sans-serif; }

  /* piezas gráficas */
  .chipR { position:absolute; display:flex; align-items:center; gap:14px; border-radius:6px; padding:17px 24px;
    font-family:'Inter Tight',sans-serif; font-weight:300; letter-spacing:.14em; text-transform:uppercase; font-size:22px; white-space:nowrap; }
  .chipR .dot { width:10px; height:10px; background:#c9a96e; flex-shrink:0; }
  .chipR.ondark { background:rgba(10,9,8,.9); border:1px solid rgba(201,169,110,.55); color:#f5f3ee; box-shadow:0 20px 50px rgba(0,0,0,.5); }
  .chipR.onpaper { background:rgba(245,243,238,.95); border:1px solid rgba(20,16,10,.5); color:#171512; box-shadow:0 16px 40px rgba(50,40,22,.14); }
  .pill { display:inline-block; background:#c9a96e; color:#141210; font-family:'Inter Tight',sans-serif; font-weight:700;
    letter-spacing:.12em; text-transform:uppercase; padding:28px 56px; border-radius:6px; }
  .thinpill { display:inline-block; border:1px solid rgba(201,169,110,.65); color:#c9a96e; font-family:'Inter Tight',sans-serif;
    font-weight:300; letter-spacing:.2em; text-transform:uppercase; padding:14px 26px; border-radius:999px; }
  .rbox { display:inline-grid; place-items:center; border:1.5px solid #c9a96e; color:#c9a96e;
    font-family:'Newsreader',serif; font-weight:600; }
  .ghostnum { position:absolute; font-family:'Newsreader',serif; font-weight:600; color:rgba(245,243,238,.05); pointer-events:none; }
  .odigit { overflow:hidden; position:relative; display:inline-block; }
  .odstrip { position:absolute; left:0; top:0; width:100%; text-align:center;
    font-variant-numeric:lining-nums tabular-nums; font-feature-settings:"lnum" 1,"tnum" 1; }
  .w { display:inline-block; }
`;

/* ---------- paletas de fondo (el dorado #c9a96e no se toca) ---------- */
const PALETTES = {
  /* cálida, la de los 3 primeros reels */
  brasa: {
    bg: `radial-gradient(ellipse 95% 60% at 50% 26%, #191612 0%, transparent 68%),
         radial-gradient(ellipse 85% 50% at 50% 96%, #14110d 0%, transparent 62%), #0c0b0a`,
    fogD: i => `rgba(${120 + i * 8},${100 + i * 5},70,.10)`,
    fogP: i => `rgba(${150 - i * 6},${128 - i * 5},96,.14)`,
    dustD: 'rgba(201,169,110,.75)', dustP: 'rgba(90,74,50,.55)',
    paper: '#f5f3ee', vigD: 'rgba(0,0,0,.5)',
  },
  /* grafito frío: acero/tinta. El dorado salta por contraste de temperatura */
  grafito: {
    bg: `radial-gradient(ellipse 95% 60% at 50% 24%, #1b2127 0%, transparent 66%),
         radial-gradient(ellipse 90% 55% at 50% 98%, #0e1317 0%, transparent 60%), #0a0d10`,
    fogD: i => `rgba(${64 + i * 6},${84 + i * 6},${108 + i * 7},.12)`,
    fogP: i => `rgba(${132 - i * 5},${140 - i * 5},${148 - i * 5},.13)`,
    dustD: 'rgba(201,169,110,.7)', dustP: 'rgba(60,68,78,.5)',
    paper: '#edecE8', vigD: 'rgba(0,0,0,.58)',
  },
  /* petróleo: verde-azulado profundo, más de autor */
  petroleo: {
    bg: `radial-gradient(ellipse 95% 60% at 50% 25%, #10231f 0%, transparent 66%),
         radial-gradient(ellipse 90% 55% at 50% 97%, #08120f 0%, transparent 60%), #060d0c`,
    fogD: i => `rgba(${40 + i * 6},${96 + i * 6},${88 + i * 6},.12)`,
    fogP: i => `rgba(${126 - i * 5},${142 - i * 5},${134 - i * 5},.13)`,
    dustD: 'rgba(201,169,110,.72)', dustP: 'rgba(46,70,64,.5)',
    paper: '#ecEDe9', vigD: 'rgba(0,0,0,.55)',
  },
};

function injectBase(paletteName) {
  const PAL = PALETTES[paletteName || 'brasa'];
  window.__PAL = PAL;
  const st = document.createElement('style');
  st.textContent = BASE_CSS;
  document.head.appendChild(st);
  const vp = document.createElement('div');
  vp.id = 'viewport';
  vp.innerHTML = `
    <div id="camera">
      <div class="layer" id="bgdark" style="background:${PAL.bg};"></div>
      <div class="layer" id="paperbg"></div>
      <div class="layer" id="fogdark"></div>
      <div class="layer" id="fogpaper" style="opacity:0"></div>
      <div class="layer" id="dustL"></div>
      <!-- margen de seguridad para Instagram: el contenido se encoge 7%,
           los fondos/grano quedan a sangre completa -->
      <div class="layer" id="stage" style="transform:scale(0.93);transform-origin:540px 960px;"></div>
    </div>
    <div id="flash"></div>
    <div id="vigD"></div><div id="vigP"></div>
    <div id="scan"></div>
    <div id="grainD"></div><div id="grainP"></div>
    <div id="boneout"></div>
    <div id="blackout"></div>`;
  document.body.appendChild(vp);
  $('paperbg').style.background = PAL.paper;
  $('vigD').style.background = `radial-gradient(ellipse 125% 92% at 50% 44%, transparent 52%, ${PAL.vigD} 100%)`;
  /* niebla procedural */
  const fd = $('fogdark'), fp = $('fogpaper');
  const rnd = mulberry(31);
  window.__FOGS = [];
  for (let i = 0; i < 4; i++) {
    const mk = (parent, col) => {
      const f = document.createElement('div');
      f.className = 'fog';
      const w = 620 + rnd() * 520;
      f.style.width = w + 'px'; f.style.height = w * (0.55 + rnd() * .3) + 'px';
      f.style.background = col;
      parent.appendChild(f);
      return f;
    };
    window.__FOGS.push({
      d: mk(fd, PAL.fogD(i)),
      p: mk(fp, PAL.fogP(i)),
      x: rnd() * 1080, y: rnd() * 1700, sx: 14 + rnd() * 22, ph: rnd() * 6.28
    });
  }
  /* polvo */
  const dl = $('dustL');
  window.__DUST = [];
  for (let i = 0; i < 30; i++) {
    const el = document.createElement('div');
    el.className = 'dust';
    const sz = 2.5 + rnd() * 4.5;
    el.style.width = sz + 'px'; el.style.height = sz + 'px';
    dl.appendChild(el);
    window.__DUST.push({ el, x0: rnd() * 1080, y0: rnd() * 2100, spd: 20 + rnd() * 38, ph: rnd() * 6.28, amp: 16 + rnd() * 30, op: .2 + rnd() * .4 });
  }
}

/* mundo papel(1) / oscuro(0) + niebla + polvo */
function setWorld(t, paper) {
  $('paperbg').style.opacity = paper;
  $('grainD').style.opacity = .11 * (1 - paper);
  $('grainP').style.opacity = .13 * paper;
  $('vigD').style.opacity = 1 - paper;
  $('vigP').style.opacity = paper;
  $('scan').style.opacity = .05 * (1 - paper) + .025 * paper;
  $('fogdark').style.opacity = 1 - paper;
  $('fogpaper').style.opacity = paper;
  const gi = Math.floor(t * 24) % 9;
  const tr = `translate(${(gi % 3) * -22}px,${Math.floor(gi / 3) * -18}px)`;
  $('grainD').style.transform = tr; $('grainP').style.transform = tr;
  for (const f of window.__FOGS) {
    const x = f.x + Math.sin(t * .11 + f.ph) * 130, y = f.y + Math.cos(t * .09 + f.ph * 2) * 90;
    f.d.style.transform = `translate(${x - 400}px,${y - 400}px)`;
    f.p.style.transform = `translate(${x - 400}px,${y - 400}px)`;
  }
  for (const d of window.__DUST) {
    const y = ((d.y0 - t * d.spd) % 2100 + 2100) % 2100 - 90;
    const x = d.x0 + Math.sin(t * .6 + d.ph) * d.amp;
    const tw = .6 + .4 * Math.sin(t * 2.1 + d.ph * 3);
    d.el.style.opacity = d.op * tw;
    d.el.style.background = paper > .5 ? window.__PAL.dustP : window.__PAL.dustD;
    d.el.style.transform = `translate(${x}px,${y}px)`;
    d.el.style.filter = 'blur(1px)';
  }
}

/* cámara genérica */
function makeCamera(cfg) {
  return function camera(t) {
    let s = kf(t, cfg.S), x = kf(t, cfg.X), y = kf(t, cfg.Y), r = 0;
    for (const sh of (cfg.shakes || [])) { const d = decayShake(t, sh.t, sh.amp, sh.freq || 11, sh.dur || .5); x += d.x; y += d.y; r += d.r; }
    x += Math.sin(t * 0.7) * 3 + Math.sin(t * 1.9) * 1.5;
    y += Math.cos(t * 0.55) * 3.5 + Math.sin(t * 1.3) * 1.5;
    r += Math.sin(t * 0.4) * 0.22;
    let blur = 0;
    for (const w of (cfg.whips || [])) {
      if (t > w.a && t < w.b) {
        const bell = Math.sin(iv(t, w.a, w.b) * Math.PI);
        blur = Math.max(blur, bell * 9); r += bell * 1.1;
      }
    }
    const cam = $('camera');
    cam.style.transform = `translate(540px,960px) rotate(${r}deg) scale(${s}) translate(${-x}px,${-y}px)`;
    cam.style.filter = blur > .3 ? `blur(${blur.toFixed(1)}px)` : 'none';
    let fl = 0;
    for (const f of (cfg.flashes || [])) { if (t >= f.t && t < f.t + .45) { const p = iv(t, f.t, f.t + .45); fl = Math.max(fl, f.p * (p < .18 ? p / .18 : 1 - E.outQuad(iv(p, .18, 1)))); } }
    $('flash').style.opacity = fl;
    let bo = Math.max(1 - seg(t, 0, .18, E.outQuad), seg(t, cfg.fade[0], cfg.fade[1], E.inQuad));
    for (const m of (cfg.cutsBlack || [])) if (t > m.a && t < m.b) bo = Math.max(bo, Math.sin(iv(t, m.a, m.b) * Math.PI) * .95);
    $('blackout').style.opacity = bo;
    let wo = 0;
    for (const m of (cfg.cutsBone || [])) if (t > m.a && t < m.b) wo = Math.max(wo, Math.sin(iv(t, m.a, m.b) * Math.PI) * .95);
    $('boneout').style.opacity = wo;
  };
}

/* texto: palabras con stagger */
function words(el, txt, italTanWords) {
  const set = new Set(italTanWords || []);
  el.innerHTML = txt.split(' ').map((w, i) =>
    `<span class="w ${set.has(i) ? 'seri tan' : ''}">${w}</span>`).join('&nbsp;');
  return el.querySelectorAll('.w');
}
function staggerWords(spans, t, t0, step, dur) {
  spans.forEach((w, i) => {
    const q = seg(t, t0 + i * step, t0 + i * step + dur, E.outExpo);
    w.style.opacity = q;
    w.style.transform = `translateY(${lerp(44, 0, q)}px) scale(${lerp(1.18, 1, q)})`;
  });
}

/* decode/scramble determinístico */
const GLYPHS = 'R3SP0ND#/·—E10M7X';
/* managed=true → el caller controla opacity (para labels que se desvanecen) */
function scramble(el, finalTxt, t, t0, t1, managed) {
  if (t < t0) { el.textContent = ''; if (!managed) el.style.opacity = 0; return; }
  if (!managed) el.style.opacity = 1;
  const p = iv(t, t0, t1);
  const solved = Math.floor(p * finalTxt.length + 1e-6);
  const frame = Math.floor(t * 30);
  let out = '';
  for (let i = 0; i < finalTxt.length; i++) {
    if (i < solved || finalTxt[i] === ' ') out += finalTxt[i];
    else out += GLYPHS[(frame * 7 + i * 13) % GLYPHS.length];
  }
  el.textContent = out;
}

/* odómetro genérico: val continuo → dígitos que ruedan */
function makeOdometer(el, nDigits, digitW, digitH, fontCss) {
  el.innerHTML = '';
  const digs = [];
  for (let i = 0; i < nDigits; i++) {
    const d = document.createElement('span');
    d.className = 'odigit';
    d.style.width = digitW + 'px'; d.style.height = digitH + 'px';
    const s = document.createElement('span');
    s.className = 'odstrip';
    s.style.cssText = fontCss + `;line-height:${digitH}px;`;
    s.innerHTML = '0<br>1<br>2<br>3<br>4<br>5<br>6<br>7<br>8<br>9<br>0';
    d.appendChild(s);
    el.appendChild(d);
    digs.push(s);
  }
  return function set(val) {
    for (let i = 0; i < nDigits; i++) {
      const place = nDigits - 1 - i;
      const v = (val / Math.pow(10, place)) % 10;
      digs[i].style.transform = `translateY(${-v * digitH}px)`;
    }
  };
}

/* chat: burbuja con pop */
function popIn(el, t, t0, dur = .38) {
  const q = seg(t, t0, t0 + dur, E.outExpo);
  el.style.opacity = q;
  el.style.transform = `translateY(${lerp(46, 0, q)}px) scale(${lerp(.92, 1, q)})`;
  return q;
}
function typingDots(el, t, t0, t1) {
  if (t < t0 || t > t1) { el.style.display = 'none'; return; }
  el.style.display = 'inline-flex';
  el.style.opacity = Math.min(seg(t, t0, t0 + .25, E.outCubic), 1 - seg(t, t1 - .2, t1, E.inQuad));
  [...el.children].forEach((dot, i) => {
    dot.style.transform = `translateY(${Math.sin((t * 4.2 + i * .9)) * -6}px)`;
    dot.style.opacity = .45 + .55 * clamp01(Math.sin(t * 4.2 + i * .9));
  });
}
/* aberración cromática para golpes (texto) */
function aberr(el, amt) {
  el.style.textShadow = amt > .01
    ? `${amt * 5}px 0 rgba(210,60,40,.5), ${-amt * 5}px 0 rgba(60,140,220,.5)`
    : 'none';
}
