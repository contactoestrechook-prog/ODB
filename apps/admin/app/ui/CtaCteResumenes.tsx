'use client';

import { useCallback, useEffect, useState } from 'react';
import { AreaTexto, Aviso, Boton, Cargando, Chips, Etiqueta, Modal, Tarjeta, unir, useConfirmar, FOCO } from './kit';
import { fecha, pesos } from '../lib/formato';

// Resumen de saldo por WhatsApp (24/10/2026): los días 1 y 16 a las 10 h, por
// la línea general, a todos los que deben. Nace pausado: el dueño se manda una
// prueba, la mira en su teléfono y recién ahí lo prende.

type Candidato = { clienteId: string; nombre: string; telefono: string | null; destino: string | null; saldo: number; texto: string; estado: 'pendiente' | 'sin_telefono' };
type Tanda = { tanda: string; enviados: number; errores: number; pendientes: number; sinTelefono: number; monto: number; manual: boolean };
type Estado = {
  config: { activo: boolean; dias: number[]; hora: number; piso: number; plantilla: string };
  proxima: string;
  lista: Candidato[];
  historial: Tanda[];
};

const MARCAS = ['{nombre}', '{saldo}', '{fecha}', '{movimientos}', '{alias}', '{titular}'];

async function leer(r: Response) {
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(Array.isArray(j?.message) ? j.message.join(', ') : j?.message || 'No se pudo');
  return j;
}

export function CtaCteResumenes({ esDueno, onAbrirCuenta, version }: { esDueno: boolean; onAbrirCuenta: (id: string) => void; version: number }) {
  const [datos, setDatos] = useState<Estado | null>(null);
  const [error, setError] = useState('');
  const [verLista, setVerLista] = useState<'no' | 'reciben' | 'sin_telefono'>('no');
  const [ejemplo, setEjemplo] = useState<Candidato | null>(null);
  const [editando, setEditando] = useState(false);
  const [plantilla, setPlantilla] = useState('');
  const [trabajando, setTrabajando] = useState(false);
  const { confirmar, pedirTexto, avisar, dialogo } = useConfirmar();

  const cargar = useCallback(async () => {
    try { setDatos(await leer(await fetch('/api/cta-cte/resumenes'))); setError(''); }
    catch (e) { setError(e instanceof Error ? e.message : 'Sin conexión'); }
  }, []);
  useEffect(() => { cargar(); }, [cargar, version]);

  if (error) return <Aviso tono="error">{error}</Aviso>;
  if (!datos) return <Cargando bloque />;

  const { config, lista, historial } = datos;
  const reciben = lista.filter((c) => c.estado === 'pendiente');
  const sinTel = lista.filter((c) => c.estado === 'sin_telefono');
  const montoReciben = reciben.reduce((s, c) => s + c.saldo, 0);
  const visibles = verLista === 'reciben' ? reciben : verLista === 'sin_telefono' ? sinTel : [];

  const accion = async (fn: () => Promise<void>) => {
    if (trabajando) return;
    setTrabajando(true);
    try { await fn(); } catch (e) { await avisar({ titulo: 'No se pudo', texto: e instanceof Error ? e.message : String(e) }); }
    finally { setTrabajando(false); }
  };

  const prenderPausar = () => accion(async () => {
    const prender = !config.activo;
    if (prender && !(await confirmar({
      titulo: '¿Prender el resumen automático?',
      texto: `Desde el ${fecha(datos.proxima)} a las ${config.hora} h, ${reciben.length} clientes van a recibir su saldo por WhatsApp desde la línea general, y así cada día ${config.dias.join(' y ')} del mes.`,
      textoConfirmar: 'Prender', variante: 'ok',
    }))) return;
    await leer(await fetch('/api/cta-cte/resumenes', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ activo: prender }) }));
    await cargar();
  });

  const prueba = () => accion(async () => {
    const tel = await pedirTexto({
      titulo: 'Mandarme una prueba',
      texto: `Te llega el mensaje de ${ejemplo?.nombre ?? reciben[0]?.nombre ?? 'un cliente'}, tal cual lo recibiría, con la marca [PRUEBA]. A ningún cliente le sale nada.`,
      campo: { etiqueta: 'Tu celular', placeholder: '11 2345-6789', obligatorio: true },
      textoConfirmar: 'Mandar prueba',
    });
    if (!tel) return;
    const r = await leer(await fetch('/api/cta-cte/resumenes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'prueba', telefono: tel, clienteId: ejemplo?.clienteId }) }));
    await avisar({ titulo: 'Prueba enviada', texto: `Mirá tu WhatsApp: es el mensaje de ${r.cliente}.` });
  });

  const mandarAhora = () => accion(async () => {
    if (!(await confirmar({
      titulo: `¿Mandar el saldo a ${reciben.length} clientes ahora?`,
      texto: `Salen de a uno, con medio minuto entre cada uno: termina en unos ${Math.ceil((reciben.length * 35) / 60)} minutos. Total que se informa: ${pesos(montoReciben)}. Quien ya lo recibió hoy no lo vuelve a recibir.`,
      textoConfirmar: 'Mandar ahora', variante: 'primario',
    }))) return;
    const r = await leer(await fetch('/api/cta-cte/resumenes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'enviar-ahora' }) }));
    await avisar({ titulo: 'Saliendo', texto: `${r.pendientes} en camino. Actualizá esta pantalla para ver cómo avanza.` });
    await cargar();
  });

  const guardarPlantilla = () => accion(async () => {
    await leer(await fetch('/api/cta-cte/resumenes', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plantilla }) }));
    setEditando(false);
    await cargar();
  });

  const muestra = ejemplo ?? reciben[0] ?? lista[0];

  return (
    <Tarjeta>
      {dialogo}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold text-tinta">Resumen de saldo por WhatsApp</h2>
            <Etiqueta tono={config.activo ? 'ok' : 'atencion'} punto>{config.activo ? 'Prendido' : 'Pausado'}</Etiqueta>
          </div>
          <p className="mt-1 text-sm text-tinta/70">
            Los días {config.dias.join(' y ')} de cada mes a las {config.hora} h, desde la línea general.{' '}
            {config.activo ? <>Próximo: <b className="text-tinta">{fecha(datos.proxima)}</b>.</> : <>Mientras esté pausado no le sale nada a nadie.</>}
          </p>
        </div>
        {esDueno && (
          <div className="flex flex-wrap gap-2">
            <Boton tamano="chico" variante="secundario" onClick={prueba} disabled={trabajando || !lista.length}>Mandarme una prueba</Boton>
            <Boton tamano="chico" variante="secundario" onClick={mandarAhora} disabled={trabajando || !reciben.length}>Mandar ahora</Boton>
            <Boton tamano="chico" variante={config.activo ? 'peligro' : 'ok'} onClick={prenderPausar} disabled={trabajando}>
              {config.activo ? 'Pausar' : 'Prender'}
            </Boton>
          </div>
        )}
      </div>

      {/* quiénes lo reciben: cada número abre la lista */}
      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <button type="button" onClick={() => setVerLista(verLista === 'reciben' ? 'no' : 'reciben')}
          className={unir('rounded-xl border p-3 text-left transition', verLista === 'reciben' ? 'border-ok/40 bg-ok-suave' : 'border-black/10 bg-white hover:bg-crema-claro', FOCO)}>
          <p className="text-xs text-tinta/70">Lo reciben</p>
          <p className="text-xl font-bold text-ok">{reciben.length}</p>
          <p className="text-xs text-tinta/60">{pesos(montoReciben)} informados · ver lista</p>
        </button>
        <button type="button" onClick={() => setVerLista(verLista === 'sin_telefono' ? 'no' : 'sin_telefono')}
          className={unir('rounded-xl border p-3 text-left transition', verLista === 'sin_telefono' ? 'border-marca/40 bg-marca-suave' : 'border-black/10 bg-white hover:bg-crema-claro', FOCO)}>
          <p className="text-xs text-tinta/70">Deben y no tienen celular</p>
          <p className={unir('text-xl font-bold', sinTel.length ? 'text-marca-hondo' : 'text-tinta')}>{sinTel.length}</p>
          <p className="text-xs text-tinta/60">{pesos(sinTel.reduce((s, c) => s + c.saldo, 0))} sin avisar · cargar celulares</p>
        </button>
        <div className="rounded-xl border border-black/10 bg-white p-3">
          <p className="text-xs text-tinta/70">Último envío</p>
          {historial[0] ? (
            <>
              <p className="text-xl font-bold text-tinta">{fecha(historial[0].tanda)}</p>
              <p className="text-xs text-tinta/60">
                {historial[0].enviados} enviados{historial[0].pendientes ? ` · ${historial[0].pendientes} en camino` : ''}{historial[0].errores ? ` · ${historial[0].errores} con error` : ''}
              </p>
            </>
          ) : (
            <><p className="text-xl font-bold text-tinta/60">Todavía no</p><p className="text-xs text-tinta/60">nunca salió un resumen</p></>
          )}
        </div>
      </div>

      {verLista !== 'no' && (
        <div className="mt-3 max-h-80 divide-y divide-black/[0.06] overflow-y-auto rounded-xl border border-black/10">
          {visibles.map((c) => (
            <div key={c.clienteId} className="flex items-center justify-between gap-3 px-3 py-2">
              <button type="button" onClick={() => onAbrirCuenta(c.clienteId)} className={unir('min-w-0 rounded-sm text-left text-sm text-tinta underline-offset-2 hover:underline', FOCO)}>
                <span className="break-words">{c.nombre}</span>
                <span className="block text-xs text-tinta/60">{c.destino ? `+${c.destino}` : c.telefono ? `«${c.telefono}» no sirve: tocá para corregirlo` : 'sin teléfono: tocá para cargarlo'}</span>
              </button>
              <div className="flex shrink-0 items-center gap-2">
                <span className="importe text-sm font-semibold text-tinta">{pesos(c.saldo)}</span>
                {c.estado === 'pendiente' && (
                  <Boton tamano="chico" variante="fantasma" onClick={() => setEjemplo(c)}>ver mensaje</Boton>
                )}
              </div>
            </div>
          ))}
          {!visibles.length && <p className="px-3 py-3 text-sm text-tinta/60">Nadie en esta lista.</p>}
        </div>
      )}

      {/* el mensaje, como le llega al cliente */}
      {muestra && (
        <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_auto]">
          <div>
            <p className="mb-1 text-xs text-tinta/70">Así le llega a <b className="text-tinta">{muestra.nombre}</b>{ejemplo && <> · <button type="button" className={unir('rounded-sm underline', FOCO)} onClick={() => setEjemplo(null)}>volver al primero</button></>}</p>
            <div className="max-w-md whitespace-pre-wrap rounded-2xl rounded-tl-sm bg-ok-suave px-4 py-3 text-sm text-tinta shadow-tarjeta">{muestra.texto}</div>
          </div>
          {esDueno && (
            <div className="flex items-start">
              <Boton tamano="chico" variante="secundario" onClick={() => { setPlantilla(config.plantilla); setEditando(true); }}>Cambiar el mensaje</Boton>
            </div>
          )}
        </div>
      )}

      {/* tandas anteriores */}
      {historial.length > 0 && (
        <div className="mt-4">
          <p className="mb-1 text-xs text-tinta/70">Envíos anteriores</p>
          <div className="flex flex-wrap gap-2">
            {historial.map((t) => (
              <span key={t.tanda} className="rounded-full border border-black/10 bg-white px-3 py-1 text-xs text-tinta/80">
                {fecha(t.tanda, 'corta')}{t.manual ? ' (a mano)' : ''} · {t.enviados} enviados{t.errores ? ` · ${t.errores} error` : ''}{t.pendientes ? ` · ${t.pendientes} en camino` : ''}
              </span>
            ))}
          </div>
        </div>
      )}

      <Modal
        abierto={editando}
        onCerrar={() => setEditando(false)}
        titulo="El mensaje del resumen"
        descripcion="Las palabras entre llaves se reemplazan con los datos de cada cliente."
        ancho="normal"
        bloquearCierre={trabajando}
        cerrarAlTocarAfuera={false}
        pie={<>
          <Boton variante="secundario" onClick={() => setEditando(false)} disabled={trabajando}>Cancelar</Boton>
          <Boton onClick={guardarPlantilla} disabled={trabajando || !plantilla.includes('{saldo}')}>Guardar</Boton>
        </>}
      >
        <AreaTexto value={plantilla} onChange={(e) => setPlantilla(e.target.value)} rows={9} aria-label="Mensaje" />
        <div className="mt-2">
          <Chips
            etiquetaAccesible="Agregar un dato"
            valor=""
            onCambiar={(m: string) => setPlantilla((p) => `${p}${p.endsWith(' ') || p.endsWith('\n') ? '' : ' '}${m}`)}
            opciones={MARCAS.map((m) => ({ valor: m, etiqueta: m }))}
          />
        </div>
        {!plantilla.includes('{saldo}') && <p className="mt-2 text-xs text-marca-hondo">Tiene que llevar {'{saldo}'}.</p>}
        <p className="mt-2 text-xs text-tinta/60">{'{movimientos}'} pone las compras y los pagos desde el último resumen; si no hubo, no aparece.</p>
      </Modal>
    </Tarjeta>
  );
}
