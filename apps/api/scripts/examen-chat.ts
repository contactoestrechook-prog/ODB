// ============================================================
// EL EXAMEN DEL CHAT DE LA FACTURA (18/11/2026). Leandro: «siempre encontrás la
// falla pero nunca encontrás el problema de raíz».
//
// La mitad de la raíz era de trabajo: cada arreglo del chat se probaba con el
// caso que había fallado y después lo probaba Ana con las facturas del día. No
// había forma de saber, ANTES de publicar, si una versión nueva resolvía más o
// menos que la anterior («peor que ayer»).
//
// Este examen le toma a la versión que está en esta copia las charlas REALES:
//   · los casos fundadores: las dos del 18/11 que originaron el reclamo
//     (Conallison y Distribuidora City), armadas desde sus lecturas;
//   · desde ese día, cada mensaje que una persona le escribe al chat queda
//     guardado con la factura como estaba (compras_chat_turnos.uso.entrada):
//     cada uno es un caso, y si la factura se registró, lo registrado es la
//     respuesta correcta.
// Usa el chat de verdad (gasta IA: lo dice al terminar) y la misma cuenta que
// la pantalla. NO escribe nada en la base.
//
//   cd apps/api && npx ts-node --transpile-only scripts/examen-chat.ts [.env] [--fundadores] [--desde=2026-11-19] [--tope=40]
//
// Sale con 1 si falla un caso fundador, o si la versión dice que hizo algo que
// la pantalla no puede aplicar.
// ============================================================
import { existsSync, readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { aplicarCambiosIA, cantidadQueEntra, cuentaDelPapel, faltanteDe, papelDeLectura, tablaParaIA } from '../src/compras/panel/tabla-factura';
import { FacturaChatService, MARCA_AUTOMATICO } from '../src/compras/factura-chat.service';
import { costoUSD } from '../src/bot/tarifas';

const args = process.argv.slice(2);
const rutaEnv = args.find((a) => !a.startsWith('--')) ?? '.env';
const opcion = (n: string) => args.find((a) => a.startsWith(`--${n}=`))?.split('=')[1] ?? null;
// sin archivo .env (dentro del servidor) valen las variables del proceso
const env: Record<string, string | undefined> = existsSync(rutaEnv)
  ? Object.fromEntries(readFileSync(rutaEnv, 'utf8').split('\n').map((l) => l.match(/^([A-Z_0-9]+)=(.*)$/)).filter(Boolean).map((m) => [m![1], m![2].replace(/^["']|["']$/g, '')]))
  : process.env;
for (const k of ['ANTHROPIC_API_KEY']) if (env[k] && !process.env[k]) process.env[k] = env[k];
const real = createClient(String(env.SUPABASE_URL), String(env.SUPABASE_SERVICE_KEY || env.SUPABASE_KEY), { auth: { persistSession: false } });

// La base, SOLO PARA LEER: lo que el chat quiera guardar (el turno, una regla) no se escribe.
const usos: any[] = [];
const soloLeer: any = {
  storage: real.storage,
  rpc: (...a: any[]) => (real as any).rpc(...a),
  from: (tabla: string) => new Proxy(real.from(tabla) as any, {
    get: (t, k) => {
      if (k === 'insert' || k === 'update' || k === 'upsert' || k === 'delete') {
        return (fila: any) => {
          if (tabla === 'compras_chat_turnos' && k === 'insert') usos.push(fila?.uso ?? null);
          const fin: any = new Proxy({}, { get: (_x, m) => (m === 'then' ? (ok: any, err: any) => Promise.resolve({ data: null, error: null }).then(ok, err) : m === 'single' || m === 'maybeSingle' ? async () => ({ data: { id: 'examen' }, error: null }) : () => fin) });
          return fin;
        };
      }
      const v = t[k];
      return typeof v === 'function' ? v.bind(t) : v;
    },
  }),
};

const num = (v: unknown): number | null => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const cerca = (a: number | null, b: number | null) => a != null && b != null && Math.abs(a - b) <= 0.002 * Math.max(1, Math.abs(b));
const esDesc = (f: any) => !!f?._esDescuento;
const suma = (xs: any[]) => Math.round(xs.reduce((s, x) => s + (Number(x.importe) || 0), 0) * 100) / 100;
const traba = (f: any) => !esDesc(f) && !f.esDevolucion && !f.porPeso && !f.juntadoEn && !!f.papel && !cuentaDelPapel(f.papel).cierra;

/** El renglón como lo arma la pantalla al cargar una lectura (solo para los casos fundadores). */
function filaDePantalla(i: any): Record<string, any> {
  const r = i.interpretado ?? {};
  const porPeso = !!r.porPeso;
  const sugerido = i.match?.sugerido === true;
  return {
    descripcion: i.descripcion, codigo: i.codigo ?? null, cantidad: r.cantidad ?? i.cantidad ?? '', porPeso, kg: i.kg ?? null, precio: i.precio ?? '',
    sku: i.match?.sku ?? '', nombre: i.match?.nombre ?? null, sugerido, unidadesPorBulto: r.unidadesPorBulto ?? null, razonBulto: r.razonBulto ?? null,
    bonificacionPct: r.bonificacionPct ?? i.bonificacionPct ?? null, importe: r.importeNeto ?? i.importe ?? null,
    esDescuento: !!i.esDescuento, esDevolucion: !!i.esDevolucion, devueltoAMano: !!i.devueltoAMano, recibidoAMano: null,
    alicuotaIva: i.alicuotaIva ?? r.alicuotaDeducida ?? null, costoCatalogo: i.match?.costoActual ?? null, incluir: !!i.match?.sku && !sugerido,
    papel: i.esDescuento || i.esDevolucion || porPeso ? null : papelDeLectura({ ...i, unidadesDelCatalogo: i.unidadesDelCatalogo ?? null }),
    _esDescuento: !!i.esDescuento, _conDescuentoEncima: false,
  };
}

type Caso = {
  nombre: string; mensaje: string; cuerpo: any; filas: any[];
  /** lo que tiene que quedar; devuelve los motivos por los que no (vacío = aprobado) */
  espera?: (final: any[]) => string[];
  /** renglón (desde 1) → lo que entró al stock cuando la factura se registró */
  registrado?: Map<number, number>;
};

async function fundadores(): Promise<Caso[]> {
  const lectura = async (id: string) => (await real.from('lecturas_comprobante').select('resultado').eq('id', id).single()).data!.resultado as any;
  const cuerpoDe = (r: any, filas: any[], mensaje: string) => ({
    proveedor: r.proveedor?.match?.razon_social ?? null, comprobante: r.comprobante ?? null, filas,
    tabla: tablaParaIA(filas, esDesc, () => null), pie: r.impuestos ?? null,
    controles: { sumaRenglones: suma(filas), totalDelPie: r.impuestos?.total ?? null, renglonesQueNoCierran: filas.map((f, k) => (traba(f) ? k + 1 : 0)).filter(Boolean) },
    mensajes: [{ rol: 'usuario', texto: mensaje }],
  });
  // Conallison 0020-00127749 como la tenía Ana a las 12:15: la carne pasada a peso, con su papel de 1 pieza
  const con = await lectura('76dab573-ddac-4449-8661-1df06cd46960');
  const filasCon0 = (con.items as any[]).map(filaDePantalla);
  const filasCon = aplicarCambiosIA(filasCon0, filasCon0.map((f, k) => ({ renglon: k + 1, campo: 'kilos', valor: f.kg })), esDesc).items;
  const msgCon = 'en rack de ojo de bife no entro 4.52 kilos entraron 3.475 kg, en vacio porcionado b entro 1.840 kg no 3.74, estaba en mal estado la mercaderia y no ingreso';
  // Distribuidora City 12046: 54 renglones, 46 de Saphirus
  const city = await lectura('80006f39-53ec-4bfd-9fe3-7da3eebb4b25');
  const filasCity = (city.items as any[]).map(filaDePantalla);
  const msgCity = 'apliquemos la regla de distribuidora city los saphirus en un solo renglon agrupados por textil, difusor y aero';
  return [
    {
      nombre: 'Conallison · llegó menos, por peso', mensaje: msgCon, filas: filasCon, cuerpo: cuerpoDe(con, filasCon, msgCon),
      espera: (f) => [
        ...(cerca(cantidadQueEntra(f[0]), 3.475) ? [] : [`del rack entran ${cantidadQueEntra(f[0])} y tenían que entrar 3,475 kg`]),
        ...(cerca(cantidadQueEntra(f[7]), 1.84) ? [] : [`del vacío B entran ${cantidadQueEntra(f[7])} y tenían que entrar 1,84 kg`]),
        ...(cerca(faltanteDe(f[0]), 1.045) ? [] : ['no quedó anotado lo que faltó del rack']),
        ...(suma(f) === suma(filasCon) ? [] : ['cambió la plata de la factura']),
      ],
    },
    {
      nombre: 'Distribuidora City · juntar los Saphirus por tipo', mensaje: msgCity, filas: filasCity, cuerpo: cuerpoDe(city, filasCity, msgCity),
      espera: (f) => {
        const saphirus = f.map((x, k) => ({ x, k })).filter(({ x }) => /saphirus/i.test(String(x.descripcion)));
        const aLaVista = saphirus.filter(({ x }) => !x.juntadoEn).length;
        return [
          ...(suma(f) === suma(filasCity) ? [] : [`la plata de la factura pasó de ${suma(filasCity)} a ${suma(f)}`]),
          ...(f.some(traba) ? [`quedan renglones trabando el registro: ${f.map((x, k) => (traba(x) ? k + 1 : 0)).filter(Boolean).join(', ')}`] : []),
          ...(aLaVista <= 12 ? [] : [`siguen a la vista ${aLaVista} renglones de Saphirus de ${saphirus.length}`]),
        ];
      },
    },
  ];
}

/** Las charlas reales guardadas con su factura (desde el 18/11/2026). */
async function grabados(desde: string, tope: number): Promise<Caso[]> {
  const { data, error } = await real.from('compras_chat_turnos')
    .select('id, lectura_id, proveedor_id, creado_en, mensaje, entrada:uso->entrada')
    .gte('creado_en', desde).not('uso->entrada', 'is', null).not('mensaje', 'like', `${MARCA_AUTOMATICO}%`)
    .order('creado_en', { ascending: true }).limit(tope);
  if (error) throw new Error(error.message);
  const casos: Caso[] = [];
  for (const t of (data ?? []) as any[]) {
    const e = t.entrada;
    if (!Array.isArray(e?.filas) || !e.filas.length) continue;
    let registrado: Map<number, number> | undefined;
    if (t.lectura_id) {
      const { data: h } = await real.from('compras_historial').select('renglon, cantidad_stock, incluido').eq('lectura_id', t.lectura_id);
      if (h?.length) registrado = new Map((h as any[]).filter((x) => x.incluido).map((x) => [Number(x.renglon), Number(x.cantidad_stock)]));
    }
    casos.push({
      nombre: `${String(t.creado_en).slice(5, 16).replace('T', ' ')} · ${String(e.proveedor ?? 'sin proveedor').slice(0, 26)}`,
      mensaje: String(t.mensaje), filas: e.filas, registrado,
      // sin proveedor: el examen no carga ni toca reglas; la factura va como estaba
      cuerpo: { proveedor: e.proveedor, comprobante: e.comprobante, filas: e.filas, tabla: e.tabla, pie: e.pie, controles: e.controles, mensajes: e.mensajes },
    });
  }
  return casos;
}

(async () => {
  const casos = [...(await fundadores()), ...(args.includes('--fundadores') ? [] : await grabados(opcion('desde') ?? '2026-11-18', Number(opcion('tope') ?? 40)))];
  const chat = new FacturaChatService(soloLeer, {} as any);
  const t = { casos: 0, sinRechazos: 0, aprobados: 0, conEspera: 0, renglonesConVerdad: 0, renglonesBien: 0, segundos: 0, usd: 0, noPuedo: 0 };
  let fallaFundador = false;
  let mintio = false;
  for (const c of casos) {
    usos.length = 0;
    const t0 = Date.now();
    let r: any;
    try { r = await chat.chat('examen', c.cuerpo, undefined); } catch (e: any) { console.log(`\n✗ ${c.nombre}\n    EL CHAT FALLÓ: ${e?.message ?? e}`); if (c.espera) { fallaFundador = true; t.conEspera++; } t.casos++; continue; }
    const seg = (Date.now() - t0) / 1000;
    const llamadas: any[] = usos.flatMap((u) => u?.llamadas ?? []);
    const usd = llamadas.reduce((s, l) => s + costoUSD(String(l.modelo ?? ''), { entrada: Number(l.entrada) || 0, cacheLeida: Number(l.cacheLeida) || 0, cacheEscrita: Number(l.cacheEscrita) || 0, salida: Number(l.salida) || 0 }), 0);
    // lo que va a hacer la pantalla con lo que el chat devolvió
    const pantalla = aplicarCambiosIA(c.filas, (r.cambios ?? []).filter((x: any) => x.campo !== 'producto'), esDesc);
    const rechazos = pantalla.descartados.length;
    const quedaron = (r.descartados ?? []).length;
    const dijoNoPuedo = /todav[ií]a no se puede|no se puede .{0,40}(desde|chat)|no (lo )?puedo .{0,30}(desde|chat)/i.test(String(r.respuesta));
    const motivos = c.espera ? c.espera(pantalla.items) : [];
    let bien = 0; let conVerdad = 0;
    if (c.registrado) {
      for (const k of new Set(pantalla.registros.map((g) => g.renglon))) {
        const verdad = c.registrado.get(k);
        if (verdad == null) continue;
        conVerdad++;
        if (cerca(cantidadQueEntra(pantalla.items[k - 1]), verdad)) bien++;
      }
    }
    t.casos++; t.segundos += seg; t.usd += usd; if (!rechazos) t.sinRechazos++; if (dijoNoPuedo) t.noPuedo++;
    if (c.espera) { t.conEspera++; if (!motivos.length && !rechazos) t.aprobados++; else fallaFundador = true; }
    t.renglonesConVerdad += conVerdad; t.renglonesBien += bien;
    // «mentir»: la pantalla rechaza algo que el chat mandó como hecho (con la prueba en el servidor no puede pasar)
    if (rechazos) mintio = true;
    const marca = rechazos || motivos.length ? '✗' : '✓';
    console.log(`\n${marca} ${c.nombre}`);
    console.log(`    «${c.mensaje.slice(0, 110)}»`);
    console.log(`    → ${String(r.respuesta).slice(0, 230)}`);
    console.log(`    cambios ${(r.cambios ?? []).length} · la pantalla aplica ${pantalla.registros.length} y rechaza ${rechazos} · sin poder ${quedaron} · vueltas ${(llamadas.length || 1)} · ${seg.toFixed(1)} s · USD ${usd.toFixed(3)}${c.registrado ? ` · contra lo registrado: ${bien} de ${conVerdad} renglones` : ''}`);
    for (const m of motivos) console.log(`    NO: ${m}`);
    for (const d of pantalla.descartados) console.log(`    LA PANTALLA RECHAZA: renglón ${d.renglon} ${d.campo} (${(d as any).porque})`);
  }
  console.log(`\nEXAMEN: ${t.casos} casos · la pantalla aplica todo lo que el chat mandó en ${t.sinRechazos} · fundadores aprobados ${t.aprobados} de ${t.conEspera}${t.renglonesConVerdad ? ` · renglones como se registraron: ${t.renglonesBien} de ${t.renglonesConVerdad}` : ''} · dijo «no se puede» en ${t.noPuedo} · ${t.segundos.toFixed(0)} s · USD ${t.usd.toFixed(2)}`);
  if (fallaFundador) console.log('NO APRUEBA: falló un caso fundador.');
  if (mintio) console.log('NO APRUEBA: el chat dio por hecho algo que la pantalla rechaza.');
  process.exit(fallaFundador || mintio ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
