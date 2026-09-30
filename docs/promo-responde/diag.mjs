import { chromium } from 'playwright-core';
const b = await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless:true});
const p = await b.newPage({viewport:{width:1080,height:1920}});
await p.goto('file:///private/tmp/claude-501/-Users-leandroalonso-Projects-odb/c268126a-b387-418a-b5fb-be72fa1d0e33/scratchpad/responde-video/composition-h.html');
await p.evaluate(()=>window.READY);
const r = await p.evaluate(()=>{
  const st=document.getElementById('stage');
  const prev=st.style.transform; st.style.transform='none';
  const cam=document.getElementById('camera'); const pc=cam.style.transform; cam.style.transform='none';
  const out=[...st.children].map((c,i)=>{ const b=c.getBoundingClientRect();
    return {i, top:Math.round(b.top), h:Math.round(b.height), cy:Math.round(b.top+b.height/2),
            left:Math.round(b.left), w:Math.round(b.width), cx:Math.round(b.left+b.width/2),
            txt:(c.textContent||'').replace(/\s+/g,' ').trim().slice(0,34)}; });
  st.style.transform=prev; cam.style.transform=pc;
  return out;
});
console.table(r);
await b.close();
