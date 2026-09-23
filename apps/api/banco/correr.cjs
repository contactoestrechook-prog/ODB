// ============================================================
// BANCO DE PRUEBAS DEL BOT DE ODB (23/9/2026)
//
// Corre las charlas de banco/casos.json contra el bot REAL: el mismo código
// (guardas, búsqueda, cotización), el catálogo real y el modelo de producción.
// Lo único simulado son las acciones con efecto afuera: crear el pedido,
// avisar a la casa, derivar, registrar proveedores y mandar WhatsApp. Nada
// llega a ningún cliente ni se crea ningún pedido.
//
// Cada caso se corrige dos veces: con reglas fijas (lo que no puede fallar:
// "sin cargo", no repetir, la herramienta que corresponde) y con un juez (un
// modelo que lee la charla y la puntúa de 1 a 5 contra lo esperado).
//
// Uso, desde apps/api:
//   npm run build && node banco/correr.cjs            → todos los casos
//   node banco/correr.cjs envio-01 pedido-02          → solo esos
// Deja el resultado en banco/resultados/ y compara con la corrida anterior.
// ============================================================
process.loadEnvFile(require('path').join(__dirname, '..', '.env'));
const fs = require('fs');
const path = require('path');
const { NestFactory } = require('@nestjs/core');
const Anthropic = require('@anthropic-ai/sdk').default;
const { AppModule } = require('../dist/app.module.js');
const { BotService } = require('../dist/bot/bot.service.js');
const { casiIgual } = require('../dist/bot/prolijo.js');

const CASOS = JSON.parse(fs.readFileSync(path.join(__dirname, 'casos.json'), 'utf8'));
const SALIDA = path.join(__dirname, 'resultados');
const JUEZ = process.env.BANCO_JUEZ ?? 'claude-sonnet-5';
const EN_PARALELO = Number(process.env.BANCO_PARALELO ?? 4);
const soloIds = process.argv.slice(2);

// un comprobante de transferencia mínimo, en PDF válido, para el caso con archivo
function pdfComprobante() {
  const texto = 'Comprobante de transferencia - Monto $12.000 - Destinatario O.D.B Premium Market - 23/09/2026';
  const stream = `BT /F1 12 Tf 40 760 Td (${texto}) Tj ET`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n'; const offs = [];
  objs.forEach((o, i) => { offs.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('')}`;
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf).toString('base64');
}

// reglas que valen para CUALQUIER respuesta del bot
function chequeosGenerales(resp, previa) {
  const f = [];
  if (/\bSant Thomas\b/.test(resp)) f.push('dice "Sant Thomas" (es sucursal Saint Thomas)');
  if (/\busted\b/i.test(resp)) f.push('trata de usted'); // «ustedes» es el plural del voseo: está bien
  if (/env[ií]o[^.\n]{0,40}(va aparte|no est[aá] incluid|se cobra|tiene un costo)|lo define (el sector de )?reparto/i.test(resp)) f.push('cobra el envío');
  if (/[\u{1F300}-\u{1FAFF}]/u.test(resp)) f.push('usa emojis');
  if (/\S\.[A-ZÁÉÍÓÚ]/.test(resp.replace(/\d\.\d/g, '').replace(/[A-Z]\.[A-Z]/g, ''))) f.push('oraciones pegadas sin espacio');
  if (previa && casiIgual(resp, previa)) f.push('repite el mensaje anterior');
  return f;
}

function chequeosDelTurno(espera, resp, herramientas) {
  const f = [];
  if (!espera) return f;
  const callado = !resp.trim();
  if (espera.silencio && !callado && resp.split(/\s+/).length > 8) f.push('debía no contestar (o algo mínimo) y contestó');
  if ((espera.no_silencio || espera.debe) && callado) f.push('no contestó nada');
  for (const re of espera.debe ?? []) if (!new RegExp(re, 'i').test(resp)) f.push(`falta: /${re}/`);
  for (const re of espera.no_debe ?? []) if (new RegExp(re, 'im').test(resp)) f.push(`no debía: /${re}/`);
  for (const h of espera.herramientas ?? []) if (!herramientas.includes(h)) f.push(`no usó ${h}`);
  for (const h of espera.sin_herramientas ?? []) if (herramientas.includes(h)) f.push(`usó ${h} y no debía`);
  if (espera.max_lineas && resp.split('\n').filter((l) => l.trim()).length > espera.max_lineas) f.push(`más de ${espera.max_lineas} líneas`);
  return f;
}

async function juzgar(claude, caso, charla) {
  const guion = charla.map((t) => `CLIENTE: ${t.cliente}${t.archivo ? ' [adjunta un PDF: comprobante de transferencia de $12.000]' : ''}\nBOT: ${t.respuesta || '(no contestó)'}\n(herramientas: ${t.herramientas.join(', ') || 'ninguna'})`).join('\n\n');
  const r = await claude.messages.create({
    model: JUEZ, max_tokens: 4000, thinking: { type: 'adaptive' },
    system: 'Sos un evaluador exigente de un bot de WhatsApp de un almacén premium argentino (O.D.B, Canning). Reglas de la casa: envío SIN CARGO siempre; nunca repetir un mensaje; la cantidad la dice el cliente; mostrar el producto puntual; "sin stock" no es "no existe"; sucursal Saint Thomas (Castex 3601) es la única de retiro; corto y concreto, voseo, sin emojis; no inventar precios ni datos; lo que no sabe lo consulta y avisa UNA vez; pagos siempre por adentro (quiere decir: alias, comprobantes y cobros los maneja administración por este mismo chat, nunca se manda a otro teléfono; pagar al retirar o al recibir en efectivo o tarjeta es correcto). Santa Inés (Juana de Arco 7300) también es del local, pero solo para compra presencial: nombrarla así es correcto. Cada charla del banco empieza de cero: el saludo "Buenas tardes, te damos la bienvenida a O.D.B." en el PRIMER mensaje es la regla de la casa, no lo penalices (sí en los siguientes). Ante un "gracias" o un cierre suelto la casa prefiere no contestar: el silencio ahí es correcto. Las herramientas de crear pedido, derivar y avisar a la casa están simuladas (el código de pedido siempre sale PICKUP-BANCO…, aunque sea envío): no las penalices por eso.',
    messages: [{ role: 'user', content: `Qué tenía que hacer el bot: ${caso.juez}\n\nLa charla:\n${guion}\n\nPuntuá de 1 a 5 (5 = lo que haría el mejor vendedor del local; 4 = bien con detalles menores; 3 = cumple a medias; 1-2 = mal). Respondé SOLO un JSON: {"puntaje": n, "problemas": ["..."]}` }],
  });
  const txt = r.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  try { return JSON.parse(txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1)); } catch { return { puntaje: 0, problemas: ['el juez no devolvió JSON'] }; }
}

(async () => {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const bot = app.get(BotService);
  const claude = new Anthropic();
  let costo = 0;

  // ---- simulación de lo que tiene efecto afuera ----
  const registro = new Map(); // telefono → herramientas del turno
  const original = bot.ejecutarHerramienta.bind(bot);
  bot.ejecutarHerramienta = async (block, telefono, ...resto) => {
    registro.get(telefono)?.push(block.name);
    return original(block, telefono, ...resto);
  };
  bot.consultarInterno = async (_l, _t, area) => ({ consultado: true, area, avisoPorWhatsapp: true, aviso: '' });
  bot.derivarAHumano = async () => ({ derivada: true, aviso: 'El equipo ya fue notificado por el sistema' });
  bot.derivarPago = async () => ({ derivado: true, aviso: 'Administración ya fue notificada' });
  bot.registrarProveedor = async () => ({ registrado: true });
  bot.linkDelPedido = async (_t, codigo) => ({ url: 'https://mpago.la/banco', monto: 0, codigo });
  bot.enviarPorWhatsapp = async () => ({ enviado: true, id: null, via: 'banco' });
  bot.respondeRpc = async () => null;
  // crear_pedido: la guarda real corre entera; solo la última escritura es simulada
  const cotizaciones = new Map();
  const rpcReal = bot.db.rpc.bind(bot.db);
  bot.db.rpc = async (fn, args) => {
    if (fn !== 'confirmar_cotizacion_bot') return rpcReal(fn, args);
    const { data: q } = await bot.db.from('bot_cotizaciones').select('total').eq('id', args.p_id).maybeSingle();
    const id = `00000000-0000-4000-8000-${String(cotizaciones.size + 1).padStart(12, '0')}`;
    cotizaciones.set(id, Number(q?.total ?? 0));
    return { data: id, error: null };
  };
  bot.pedidos.obtener = async (id) => ({ id, qr_retiro: 'PICKUP-BANCO' + id.slice(-4), total: cotizaciones.get(id) ?? 0, estado: 'recibido' });
  const logReal = bot.log.log.bind(bot.log);
  bot.log.log = (m, ...r) => { const c = /≈ USD ([\d.]+)/.exec(String(m)); if (c) costo += Number(c[1]); return undefined; };
  bot.log.warn = () => undefined;

  const casos = CASOS.filter((c) => !soloIds.length || soloIds.includes(c.id));
  const resultados = [];
  const cola = [...casos.entries()];
  async function trabajador() {
    while (cola.length) {
      const [i, caso] = cola.shift();
      const telefono = `54911000000${100 + CASOS.indexOf(caso)}`;
      await bot.borrarConversacion('pedidos', telefono).catch(() => null);
      await bot.db.from('bot_cotizaciones').delete().eq('telefono', telefono);
      const charla = []; const fallas = []; let previa = null;
      try {
        for (const [k, t] of caso.turnos.entries()) {
          registro.set(telefono, []);
          const r = await bot.charla({ linea: 'pedidos', telefono, mensaje: t.cliente, ...(t.archivo ? { archivoBase64: pdfComprobante(), mimeType: 'application/pdf' } : {}) });
          const resp = String(r?.respuesta ?? '');
          const herramientas = registro.get(telefono);
          charla.push({ cliente: t.cliente, archivo: !!t.archivo, respuesta: resp, herramientas });
          const f = [...(resp ? chequeosGenerales(resp, previa) : []), ...chequeosDelTurno(t.espera, resp, herramientas)];
          fallas.push(...f.map((x) => `turno ${k + 1}: ${x}`));
          if (resp) previa = resp;
        }
        const juicio = await juzgar(claude, caso, charla);
        const ok = !fallas.length && juicio.puntaje >= 4;
        resultados.push({ id: caso.id, categoria: caso.categoria, titulo: caso.titulo, ok, puntaje: juicio.puntaje, fallas, problemas: juicio.problemas ?? [], charla });
        process.stdout.write(`${ok ? '✓' : '✗'} ${caso.id.padEnd(12)} ${String(juicio.puntaje).padStart(1)}/5 ${fallas.length ? '· ' + fallas.join(' · ') : ''}\n`);
      } catch (e) {
        resultados.push({ id: caso.id, categoria: caso.categoria, titulo: caso.titulo, ok: false, puntaje: 0, fallas: [`error: ${e?.message ?? e}`], problemas: [], charla });
        process.stdout.write(`✗ ${caso.id.padEnd(12)} ERROR ${e?.message ?? e}\n`);
      }
      // limpieza: nada del banco queda en la base
      await bot.borrarConversacion('pedidos', telefono).catch(() => null);
      for (const t of ['bot_cotizaciones', 'bot_notas_equipo', 'bot_mensajes']) await bot.db.from(t).delete().eq('telefono', telefono).then(() => null, () => null);
    }
  }
  await Promise.all(Array.from({ length: EN_PARALELO }, trabajador));

  resultados.sort((a, b) => CASOS.findIndex((c) => c.id === a.id) - CASOS.findIndex((c) => c.id === b.id));
  const pasan = resultados.filter((r) => r.ok).length;
  const promedio = resultados.reduce((s, r) => s + (r.puntaje || 0), 0) / (resultados.length || 1);
  fs.mkdirSync(SALIDA, { recursive: true });
  const previos = fs.readdirSync(SALIDA).filter((f) => f.endsWith('.json') && !f.startsWith('parcial-')).sort();
  const anterior = previos.length ? JSON.parse(fs.readFileSync(path.join(SALIDA, previos.at(-1)), 'utf8')) : null;
  const sello = new Date().toISOString().replace(/[:.]/g, '-');
  fs.writeFileSync(path.join(SALIDA, `${soloIds.length ? 'parcial-' : ''}${sello}.json`), JSON.stringify({ fecha: new Date().toISOString(), pasan, total: resultados.length, promedio, costoBot: costo, resultados }, null, 1));

  console.log(`\nPasan ${pasan} de ${resultados.length} · puntaje promedio ${promedio.toFixed(2)}/5 · costo del bot ≈ USD ${costo.toFixed(2)} (más el juez)`);
  if (anterior && !soloIds.length) {
    const antes = new Map(anterior.resultados.map((r) => [r.id, r.ok]));
    const rotos = resultados.filter((r) => antes.get(r.id) === true && !r.ok).map((r) => r.id);
    const arreglados = resultados.filter((r) => antes.get(r.id) === false && r.ok).map((r) => r.id);
    console.log(`Contra la corrida anterior (${anterior.pasan}/${anterior.total}): ${arreglados.length} arreglados${arreglados.length ? ' (' + arreglados.join(', ') + ')' : ''} · ${rotos.length} ROTOS${rotos.length ? ' (' + rotos.join(', ') + ')' : ''}`);
    if (rotos.length) process.exitCode = 1;
  }
  await app.close();
  process.exit(process.exitCode ?? 0);
})();
