// ============================================================
// EL EXAMEN DEL CHAT DE LA FACTURA (18/11/2026). Leandro: «siempre encontrás la
// falla pero nunca encontrás el problema de raíz». Y, cuando le pregunté si el
// examen tenía que frenar cada publicación que rinda peor: «Sí, que frene».
//
// La mitad de la raíz era de trabajo: cada arreglo del chat se probaba con el
// caso que había fallado y después lo probaba Ana con las facturas del día. No
// había forma de saber, ANTES de publicar, si una versión nueva resolvía más o
// menos que la anterior («peor que ayer»).
//
// Este examen le toma a la versión que está en esta imagen las charlas REALES:
//   · los casos fundadores: las dos del 18/11 que originaron el reclamo
//     (Conallison y Distribuidora City), armadas desde sus lecturas;
//   · las charlas grabadas: desde ese día cada mensaje que una persona le
//     escribe al chat queda guardado con la factura como estaba
//     (compras_chat_turnos.uso.entrada) y con los cambios que hizo la versión
//     publicada. Para las facturas que después se registraron, lo registrado es
//     la respuesta correcta: se compara la versión nueva contra la publicada.
// La cuenta que decide si aprueba está en puntaje.ts.
//
// Usa el chat de verdad (gasta IA: lo dice al terminar) y la misma cuenta que
// la pantalla. NO escribe nada en la base.
//
// Corre solo al publicar la API cuando cambió algo del chat (scripts/publicar.sh
// → infra/servidor/publicar.sh), con la imagen recién compilada y ANTES de
// levantarla: si no aprueba, queda corriendo la versión anterior.
//
//   en el servidor:  node dist/compras/examen/examen-chat.js [--tope=6] [--solo=texto] [--fundadores]
//   en una copia:    npx ts-node --transpile-only src/compras/examen/examen-chat.ts <.env> …
//     (la clave de IA de la copia tiene que servir; la de producción está solo en el servidor)
//
// Sale con 0 si aprueba y con 1 si no.
// ============================================================
import { existsSync, readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { aplicarCambiosIA, cantidadQueEntra, cuentaDelPapel, faltanteDe, papelDeLectura, tablaParaIA } from '../panel/tabla-factura';
import { FacturaChatService, MARCA_AUTOMATICO } from '../factura-chat.service';
import { costoUSD } from '../../bot/tarifas';
import { comparar, compararCharla, resultadoDe, veredicto, type Charla, type Verdad } from './puntaje';

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
  nombre: string; mensaje: string; lecturaId: string; cuerpo: any; filas: any[];
  /** caso fundador: lo que tiene que quedar; devuelve los motivos por los que no (vacío = aprobado) */
  espera?: (final: any[]) => string[];
  /** charla grabada: lo que hizo la versión publicada y lo que al final se registró */
  cambiosProd?: any[];
  verdad?: Verdad;
};

async function principal() {
  const args = process.argv.slice(2);
  const rutaEnv = args.find((a) => !a.startsWith('--')) ?? '.env';
  const opcion = (n: string) => args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? null;
  // sin archivo .env (dentro del servidor) valen las variables del proceso
  const env: Record<string, string | undefined> = existsSync(rutaEnv)
    ? Object.fromEntries(readFileSync(rutaEnv, 'utf8').split('\n').map((l) => l.match(/^([A-Z_0-9]+)=(.*)$/)).filter(Boolean).map((m) => [m![1], m![2].replace(/^["']|["']$/g, '')]))
    : process.env;
  if (env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_API_KEY) process.env.ANTHROPIC_API_KEY = env.ANTHROPIC_API_KEY;
  const real = createClient(String(env.SUPABASE_URL), String(env.SUPABASE_SERVICE_KEY || env.SUPABASE_KEY), { auth: { persistSession: false } });
  const tope = Math.max(0, Number(opcion('tope') ?? process.env.EXAMEN_CHAT_TOPE ?? 6) || 0);
  const solo = (opcion('solo') ?? '').toLowerCase();

  // La base, SOLO PARA LEER: lo que el chat quiera guardar (el turno, una regla) no se escribe.
  // Cada chat lleva su propia base para saber cuánta IA gastó ese caso.
  const baseSoloLeer = (usos: any[]): any => ({
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
  });

  const fundadores = async (): Promise<Caso[]> => {
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
        nombre: 'Conallison · llegó menos, por peso', mensaje: msgCon, lecturaId: 'examen', filas: filasCon, cuerpo: cuerpoDe(con, filasCon, msgCon),
        espera: (f) => [
          ...(cerca(cantidadQueEntra(f[0]), 3.475) ? [] : [`del rack entran ${cantidadQueEntra(f[0])} y tenían que entrar 3,475 kg`]),
          ...(cerca(cantidadQueEntra(f[7]), 1.84) ? [] : [`del vacío B entran ${cantidadQueEntra(f[7])} y tenían que entrar 1,84 kg`]),
          ...(cerca(faltanteDe(f[0]), 1.045) ? [] : ['no quedó anotado lo que faltó del rack']),
          ...(suma(f) === suma(filasCon) ? [] : ['cambió la plata de la factura']),
        ],
      },
      {
        nombre: 'Distribuidora City · juntar los Saphirus por tipo', mensaje: msgCity, lecturaId: 'examen', filas: filasCity, cuerpo: cuerpoDe(city, filasCity, msgCity),
        espera: (f) => {
          const saphirus = f.filter((x) => /saphirus/i.test(String(x.descripcion)));
          const aLaVista = saphirus.filter((x) => !x.juntadoEn).length;
          return [
            ...(suma(f) === suma(filasCity) ? [] : [`la plata de la factura pasó de ${suma(filasCity)} a ${suma(f)}`]),
            ...(f.some(traba) ? [`quedan renglones trabando el registro: ${f.map((x, k) => (traba(x) ? k + 1 : 0)).filter(Boolean).join(', ')}`] : []),
            ...(aLaVista <= 12 ? [] : [`siguen a la vista ${aLaVista} renglones de Saphirus de ${saphirus.length}`]),
          ];
        },
      },
    ];
  };

  /** Las últimas charlas reales grabadas con su factura, de facturas que después se registraron. */
  const grabadas = async (cuantas: number): Promise<Caso[]> => {
    if (!cuantas) return [];
    // primero lo liviano: qué turnos tienen la factura guardada y de qué lectura son
    const { data: turnos, error } = await real.from('compras_chat_turnos')
      .select('id, lectura_id, creado_en')
      .not('lectura_id', 'is', null).not('uso->entrada', 'is', null).not('mensaje', 'like', `${MARCA_AUTOMATICO}%`).is('error', null)
      .order('creado_en', { ascending: false }).limit(80);
    if (error) throw new Error(`charlas grabadas: ${error.message}`);
    const casos: Caso[] = [];
    const verdades = new Map<string, Verdad | null>();
    for (const t of (turnos ?? []) as any[]) {
      if (casos.length >= cuantas) break;
      if (!verdades.has(t.lectura_id)) {
        const { data: h } = await real.from('compras_historial').select('renglon, cantidad_stock, incluido').eq('lectura_id', t.lectura_id);
        const filas = ((h ?? []) as any[]).filter((x) => x.incluido && num(x.cantidad_stock) != null);
        verdades.set(t.lectura_id, filas.length ? new Map(filas.map((x) => [Number(x.renglon), Number(x.cantidad_stock)])) : null);
      }
      const verdad = verdades.get(t.lectura_id);
      if (!verdad) continue; // todavía no se registró: no hay respuesta correcta
      const { data: completo } = await real.from('compras_chat_turnos').select('mensaje, proveedor_id, cambios, entrada:uso->entrada').eq('id', t.id).single();
      const e = (completo as any)?.entrada;
      if (!Array.isArray(e?.filas) || !e.filas.length) continue;
      casos.push({
        nombre: `${String(t.creado_en).slice(5, 16).replace('T', ' ')} · ${String(e.proveedor ?? 'sin proveedor').slice(0, 26)}`,
        mensaje: String((completo as any).mensaje), lecturaId: String(t.lectura_id), filas: e.filas, verdad,
        cambiosProd: Array.isArray((completo as any).cambios) ? (completo as any).cambios : [],
        // con su proveedor (para que lea sus reglas) y su lectura (para que vea el papel), como en la charla real
        cuerpo: { proveedorId: (completo as any).proveedor_id ?? undefined, proveedor: e.proveedor, comprobante: e.comprobante, filas: e.filas, tabla: e.tabla, pie: e.pie, controles: e.controles, mensajes: e.mensajes },
      });
    }
    return casos;
  };

  const todos = [...(await fundadores()), ...(args.includes('--fundadores') ? [] : await grabadas(tope))];
  const casos = solo ? todos.filter((c) => c.nombre.toLowerCase().includes(solo)) : todos;
  if (!casos.length) { console.log('EXAMEN DEL CHAT: no hay casos para tomar.'); return 1; }

  const tomar = async (c: Caso) => {
    const usos: any[] = [];
    const chat = new FacturaChatService(baseSoloLeer(usos), {} as any);
    const t0 = Date.now();
    const lineas: string[] = [];
    let r: any;
    try { r = await chat.chat(c.lecturaId, c.cuerpo, undefined); } catch (e: any) {
      return { caso: c, lineas: [`\n✗ ${c.nombre}`, `    NO SE PUDO TOMAR: ${String(e?.message ?? e).slice(0, 200)}`], fallo: `${c.nombre} (no se pudo tomar)`, mentira: null as string | null, charla: null as Charla | null, usd: 0, seg: (Date.now() - t0) / 1000 };
    }
    const seg = (Date.now() - t0) / 1000;
    const llamadas: any[] = usos.flatMap((u) => u?.llamadas ?? []);
    const usd = llamadas.reduce((s, l) => s + costoUSD(String(l.modelo ?? ''), { entrada: Number(l.entrada) || 0, cacheLeida: Number(l.cacheLeida) || 0, cacheEscrita: Number(l.cacheEscrita) || 0, salida: Number(l.salida) || 0 }), 0);
    // lo que va a hacer la pantalla con lo que el chat devolvió
    const pantalla = resultadoDe(c.filas, r.cambios ?? []);
    const motivos = c.espera ? c.espera(pantalla.items) : [];
    const charla = c.verdad ? compararCharla(c.filas, c.cambiosProd ?? [], r.cambios ?? [], c.verdad) : null;
    const mal = pantalla.rechazos.length > 0 || motivos.length > 0 || (charla != null && charla.bienNuevo < charla.bienProd);
    lineas.push(`\n${mal ? '✗' : '✓'} ${c.nombre}`);
    lineas.push(`    «${c.mensaje.slice(0, 110)}»`);
    lineas.push(`    → ${String(r.respuesta).slice(0, 230)}`);
    lineas.push(`    cambios ${(r.cambios ?? []).length} · la pantalla toca ${pantalla.tocados.length} renglones${pantalla.rechazos.length ? ` y RECHAZA ${pantalla.rechazos.length} cambios` : ' y no rechaza nada'} · quedó dicho como no aplicado ${(r.descartados ?? []).length} · vueltas ${llamadas.length || 1} · ${seg.toFixed(1)} s · USD ${usd.toFixed(3)}${charla ? ` · renglones como se registraron: ${charla.bienNuevo} de ${charla.conVerdad} (lo publicado: ${charla.bienProd})` : ''}`);
    for (const m of motivos) lineas.push(`    NO: ${m}`);
    for (const d of pantalla.rechazos) lineas.push(`    LA PANTALLA RECHAZA: renglón ${d.renglon} ${d.campo} (${d.porque})`);
    return { caso: c, lineas, fallo: c.espera && motivos.length ? `${c.nombre} (${motivos[0]})` : null, mentira: pantalla.rechazos.length ? c.nombre : null, charla, usd, seg };
  };

  // de a tres a la vez: el examen entero tarda lo que tarda el caso más largo, no la suma
  const resultados: Awaited<ReturnType<typeof tomar>>[] = [];
  for (let k = 0; k < casos.length; k += 3) resultados.push(...(await Promise.all(casos.slice(k, k + 3).map(tomar))));
  for (const r of resultados) console.log(r.lineas.join('\n'));

  const comparacion = comparar(resultados.map((r) => r.charla).filter((c): c is Charla => !!c));
  const v = veredicto({
    fundadoresQueFallan: resultados.map((r) => r.fallo).filter((x): x is string => !!x),
    mentiras: resultados.map((r) => r.mentira).filter((x): x is string => !!x),
    comparacion,
  });
  const fund = resultados.filter((r) => r.caso.espera);
  console.log(`\nEXAMEN DEL CHAT (${process.env.ODB_VERSION ?? 'copia'}): ${resultados.length} casos · fundadores aprobados ${fund.filter((r) => !r.fallo).length} de ${fund.length}`
    + `${comparacion.charlas ? ` · charlas reales ${comparacion.charlas}: mejora ${comparacion.mejores}, igual ${comparacion.iguales}, peor ${comparacion.peores} (renglones como se registraron ${comparacion.bienNuevo} de ${comparacion.conVerdad}; lo publicado ${comparacion.bienProd})` : ' · todavía no hay charlas reales grabadas con su factura registrada'}`
    + ` · ${Math.max(0, ...resultados.map((r) => r.seg)).toFixed(0)} s · USD ${resultados.reduce((s, r) => s + r.usd, 0).toFixed(2)}`);
  console.log(v.aprueba ? 'APRUEBA.' : `NO APRUEBA: ${v.motivos.join(' | ')}`);
  return v.aprueba ? 0 : 1;
}

if (require.main === module) {
  principal().then((codigo) => process.exit(codigo)).catch((e) => { console.error('EXAMEN DEL CHAT: no se pudo tomar.', e); process.exit(1); });
}
