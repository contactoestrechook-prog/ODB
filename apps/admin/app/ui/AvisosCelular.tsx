'use client';

import { useCallback, useEffect, useState } from 'react';
import { Boton, FOCO, ROTULO, unir } from './kit';
import { fecha } from '../lib/formato';
import {
  activarAvisos, desactivarAvisos, endpointDeEsteAparato, estadoAvisos, misAparatos, nombreDelAparato, probarAvisos, quitarAparato,
  type Aparato, type EstadoAvisos,
} from '../lib/avisos-celular';

// AVISOS EN EL CELULAR (/avisos) — 6/11/2026, Leandro: «que les lleguen a los
// celulares, como una aplicación, lo mismo que hicimos para MetoGroup».
// Quién la usa: cada uno, casi siempre desde el celular, una sola vez.
// Qué viene a hacer: activar los avisos en este aparato y ver en cuáles los tiene.
// Al celular va solo lo importante (configuracion.avisos_celular.tipos en la base);
// lo demás sigue en la campanita. Si cambia esa lista, cambiar también QUE_AVISA.

const QUE_AVISA: Record<string, string[]> = {
  jefes: [
    'Un pedido que nadie tomó, y un pedido cuyo aviso no le llegó a administración.',
    'Un comprobante o una consulta de pago de un cliente.',
    'Cuando se cae una línea de WhatsApp o el bot no puede responder.',
  ],
  administrativo: ['Un proveedor que hay que completar para poder pedirle.'],
};

type Mensaje = { ok: boolean; texto: string } | null;

export function AvisosCelular({ rol }: { rol: string | null }) {
  const [estado, setEstado] = useState<EstadoAvisos | null>(null);
  const [aparatos, setAparatos] = useState<Aparato[] | null>(null);
  const [propio, setPropio] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [msg, setMsg] = useState<Mensaje>(null);
  const [nombre, setNombre] = useState('');

  const cargar = useCallback(async () => {
    setEstado(await estadoAvisos().catch(() => 'sin-soporte' as const));
    setNombre(nombreDelAparato());
    setAparatos(await misAparatos().catch(() => []));
    setPropio(await endpointDeEsteAparato());
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  async function hacer(fn: () => Promise<string>) {
    if (ocupado) return;
    setOcupado(true);
    setMsg(null);
    try { setMsg({ ok: true, texto: await fn() }); }
    catch (e) { setMsg({ ok: false, texto: e instanceof Error ? e.message : String(e) }); }
    finally { setOcupado(false); await cargar(); }
  }

  const activar = () => hacer(async () => {
    await activarAvisos();
    const r = await probarAvisos().catch(() => null);
    return r?.enviados ? 'Listo: te mandamos uno de prueba.' : 'Listo: este aparato ya recibe los avisos.';
  });
  const probar = () => hacer(async () => {
    const r = await probarAvisos();
    return r.enviados ? `Salió a ${r.enviados} ${r.enviados === 1 ? 'aparato' : 'aparatos'}.` : 'No hay aparatos con avisos activos.';
  });
  const apagar = () => hacer(async () => { await desactivarAvisos(); return 'Este aparato ya no recibe avisos.'; });
  const quitar = (a: Aparato) => hacer(async () => {
    if (a.endpoint === propio) await desactivarAvisos();
    else await quitarAparato(a.id);
    return `${a.dispositivo || 'Ese aparato'} ya no recibe avisos.`;
  });

  const lista = rol === 'dueno' || rol === 'gerente' ? QUE_AVISA.jefes : QUE_AVISA[rol ?? ''] ?? [];

  return (
    <div className="max-w-2xl space-y-8">
      {/* en la computadora lo dice la bajada del título */}
      <p className="text-sm text-tinta/70 lg:hidden">
        Lo importante te llega al celular o a la computadora aunque no tengas el sistema abierto. Se activa en cada aparato.
      </p>

      <section aria-labelledby="av-este">
        <h2 id="av-este" className={ROTULO}>Este aparato{nombre ? ` · ${nombre}` : ''}</h2>
        <div className="mt-3 border-t border-black/[0.06] pt-3">
          {estado === null && <p className="text-sm text-tinta/60">Mirando…</p>}

          {estado === 'activos' && (
            <>
              <p className="flex items-center gap-2 text-base font-semibold text-ok">
                <span aria-hidden="true" className="size-2 rounded-full bg-ok" />
                Este aparato recibe los avisos.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Boton variante="secundario" onClick={probar} disabled={ocupado}>Mandar uno de prueba</Boton>
                <Boton variante="fantasma" onClick={apagar} disabled={ocupado}>Dejar de recibir acá</Boton>
              </div>
            </>
          )}

          {estado === 'apagados' && (
            <>
              <p className="text-base text-tinta">Este aparato todavía no recibe avisos.</p>
              <div className="mt-3">
                <Boton onClick={activar} cargando={ocupado}>{ocupado ? 'Activando…' : 'Activar avisos'}</Boton>
              </div>
              <p className="mt-2 text-sm text-tinta/60">El navegador te va a preguntar si permitís las notificaciones: tocá <b className="font-semibold text-tinta">Permitir</b>.</p>
            </>
          )}

          {estado === 'bloqueados' && (
            <>
              <p className="text-base font-semibold text-marca-hondo">Los avisos están bloqueados para el sistema en este navegador.</p>
              <ul className="mt-2 space-y-1.5 text-sm text-tinta/70">
                <li><b className="font-semibold text-tinta">En la computadora:</b> tocá el candado al lado de la dirección → Notificaciones → Permitir, y recargá la página.</li>
                <li><b className="font-semibold text-tinta">En Android:</b> Ajustes → Apps → Chrome → Notificaciones → permitir para este sitio.</li>
                <li><b className="font-semibold text-tinta">En el iPhone:</b> Ajustes → Notificaciones → O.D.B → Permitir notificaciones.</li>
              </ul>
            </>
          )}

          {estado === 'instalar-iphone' && (
            <>
              <p className="text-base text-tinta">En el iPhone los avisos llegan al sistema de la pantalla de inicio, no a una pestaña de Safari. Se hace una sola vez:</p>
              <ol className="mt-3 divide-y divide-black/[0.06] border-y border-black/[0.06]">
                {[
                  <>Si ya tenés un ícono de O.D.B y al mantenerlo apretado dice «Eliminar marcador», borralo.</>,
                  <>Acá, en Safari, tocá <b className="font-semibold">Compartir</b> (el cuadrado con la flecha para arriba) → <b className="font-semibold">Agregar a pantalla de inicio</b> → <b className="font-semibold">Agregar</b>.</>,
                  <>Abrí O.D.B desde ese ícono nuevo, entrá con tu usuario, abrí el menú → <b className="font-semibold">Avisos en el celular</b> → <b className="font-semibold">Activar avisos</b>.</>,
                ].map((paso, i) => (
                  <li key={i} className="grid grid-cols-[2rem_1fr] gap-2 py-3 text-sm text-tinta">
                    <span className="importe text-xs font-semibold text-tinta/60">{String(i + 1).padStart(2, '0')}</span>
                    <span>{paso}</span>
                  </li>
                ))}
              </ol>
              <p className="mt-2 text-sm text-tinta/60">Hace falta iOS 16.4 o más nuevo.</p>
            </>
          )}

          {estado === 'sin-soporte' && (
            <p className="text-base text-tinta">Este navegador no recibe avisos. Probá con Chrome, Edge, Safari o Firefox actualizados.</p>
          )}

          {msg && (
            <p role="status" className={unir('mt-3 text-sm font-medium', msg.ok ? 'text-ok' : 'text-marca-hondo')}>{msg.texto}</p>
          )}
        </div>
      </section>

      <section aria-labelledby="av-aparatos">
        <h2 id="av-aparatos" className={ROTULO}>Tus aparatos con avisos{aparatos ? ` · ${aparatos.length}` : ''}</h2>
        {aparatos === null ? (
          <p className="mt-3 border-t border-black/[0.06] pt-3 text-sm text-tinta/60">Buscando…</p>
        ) : aparatos.length === 0 ? (
          <p className="mt-3 border-t border-black/[0.06] pt-3 text-sm text-tinta/60">Todavía ninguno.</p>
        ) : (
          <ul className="mt-3 divide-y divide-black/[0.06] border-y border-black/[0.06]">
            {aparatos.map((a) => (
              <li key={a.id} className="flex items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-tinta">
                    {a.dispositivo || 'Aparato'}{a.endpoint === propio ? ' · este' : ''}
                  </p>
                  <p className="text-xs text-tinta/60">
                    Desde el {fecha(a.creada_en, 'corta')} · {a.ultimo_ok_en ? `último aviso el ${fecha(a.ultimo_ok_en, 'corta')}` : 'todavía sin avisos'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => quitar(a)}
                  disabled={ocupado}
                  className={unir('min-h-11 shrink-0 rounded-full px-3 text-sm font-medium text-tinta/60 hover:text-marca-hondo disabled:opacity-50', FOCO)}
                >
                  Quitar
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="av-que">
        <h2 id="av-que" className={ROTULO}>Qué te avisa</h2>
        <ul className="mt-3 divide-y divide-black/[0.06] border-y border-black/[0.06]">
          {(lista.length ? lista : ['Hoy a tu usuario no le llega ningún aviso al celular: todo sigue en la campanita.']).map((t, i) => (
            <li key={i} className="py-3 text-sm text-tinta">{t}</li>
          ))}
          <li className="py-3 text-sm text-tinta"><b className="font-semibold">De 22 a 8 no suena.</b> Lo que llega de noche te lo juntamos en un solo aviso a las 8.</li>
        </ul>
        <p className="mt-2 text-sm text-tinta/60">Todo lo demás sigue en la campanita, como siempre. Al tocar un aviso se abre la pantalla donde se resuelve.</p>
      </section>
    </div>
  );
}
