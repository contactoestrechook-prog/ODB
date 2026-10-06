'use client';

import { useCallback, useEffect, useState } from 'react';
import { fechaHora as fechaHoraFmt } from '../lib/formato';
import {
  AreaTexto,
  Aviso,
  Boton,
  Campo,
  Chips,
  Entrada,
  Pestanas,
  Selector,
  Tarjeta,
  Vacio,
  unir,
  useConfirmar,
} from './kit';
import { ChipLinea, deClientes, hayVarias, type LineaWhatsapp, TarjetasDeLineas, useLineasWhatsapp } from './LineasWhatsapp';

// Difusiones · O.D.B — campañas por listas y mensajes programados de la línea
// de WhatsApp. Hasta el 1/10/2026 esta pantalla se llamaba "RESPONDE · WhatsApp"
// y tenía una pestaña Charlas que mezclaba las del simulador con las reales:
// las conversaciones están en RESPONDE (/responde), una sola vez.
const fechaHora = (v?: string | null) => fechaHoraFmt(v, { vacio: '' });
const bonito = (t: string) => (t.length === 13 && t.startsWith('549') ? `+54 9 ${t.slice(3, 5)} ${t.slice(5, 9)}-${t.slice(9)}` : `+${t}`);

async function post(body: any) {
  const r = await fetch('/api/responde', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, ...j };
}

// Casilla y opción con zona táctil de 44 px.
const OPCION = 'flex min-h-11 cursor-pointer items-center gap-2 text-sm text-tinta/80';

// ============================================================================
// MULTILÍNEA (6/10/2026): una tarjeta por número, cada una con su interruptor;
// cada programado y cada difusión dicen por qué número salen, y la difusión
// nueva elige el número (arranca en la principal). Con una sola línea, igual que antes.
export function BandejaWhatsapp({ puedeApagarLinea }: { puedeApagarLinea: boolean }) {
  const [tab, setTab] = useState<'difusiones' | 'programados'>('difusiones');
  const { lineas, cargar } = useLineasWhatsapp(8000);

  return (
    <div className="space-y-4">
      <TarjetasDeLineas lineas={lineas} cargar={cargar} rotulo="Difusiones · O.D.B" puedeApagar={puedeApagarLinea} verbo="Apagar" />

      <Pestanas
        etiquetaAccesible="Difusiones y programados"
        valor={tab}
        onCambiar={setTab}
        opciones={[{ valor: 'difusiones', etiqueta: 'Difusiones' }, { valor: 'programados', etiqueta: 'Programados' }]}
      />

      {tab === 'programados' && <Programados lineas={lineas} />}
      {tab === 'difusiones' && <Difusiones puede={puedeApagarLinea} lineas={lineas} />}
    </div>
  );
}

/** Con más de una línea: «Todas · Línea general · Línea local», para filtrar una lista. */
function FiltroDeLinea({ lineas, valor, onCambiar }: { lineas: LineaWhatsapp[] | null; valor: string; onCambiar: (v: string) => void }) {
  if (!hayVarias(lineas)) return null;
  return (
    <Chips
      etiquetaAccesible="Línea de WhatsApp"
      valor={valor}
      onCambiar={onCambiar}
      opciones={[{ valor: '', etiqueta: 'Todas las líneas' }, ...deClientes(lineas).map((l) => ({ valor: l.linea, etiqueta: l.nombre }))]}
    />
  );
}

// ============================================================================
function Programados({ lineas }: { lineas: LineaWhatsapp[] | null }) {
  const [items, setItems] = useState<any[]>([]);
  const [filtro, setFiltro] = useState('');
  const { confirmar, dialogo } = useConfirmar();
  const cargar = useCallback(async () => {
    const r = await fetch('/api/responde?recurso=programados', { cache: 'no-store' });
    if (r.ok) setItems(await r.json());
  }, []);
  useEffect(() => { cargar(); const t = setInterval(cargar, 15000); return () => clearInterval(t); }, [cargar]);
  async function cancelar(id: string) {
    if (!(await confirmar({ titulo: '¿Cancelar este mensaje programado?', variante: 'peligro', textoConfirmar: 'Cancelar el mensaje', textoCancelar: 'Volver' }))) return;
    await post({ accion: 'cancelarProgramado', id }); cargar();
  }
  const visibles = filtro ? items.filter((m) => m.linea === filtro) : items;
  return (
    <>
      {items.length > 0 && <FiltroDeLinea lineas={lineas} valor={filtro} onCambiar={setFiltro} />}
      {visibles.length === 0 && <Vacio titulo="No hay mensajes programados." texto="Desde una charla, el reloj 🕒 programa uno." />}
      {visibles.length > 0 && (
        <Tarjeta relleno={false} className="divide-y divide-black/[0.06] overflow-hidden">
          {visibles.map((m) => (
            <div key={m.id} className="px-4 py-3 sm:px-5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
                <p className="importe flex flex-wrap items-center gap-2 text-sm font-medium text-tinta">{bonito(m.telefono)}<ChipLinea linea={m.linea} lineas={lineas} /></p>
                <span className="importe text-xs font-semibold text-atencion">{fechaHora(m.enviar_en)}</span>
              </div>
              <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-tinta/70">{m.texto}</p>
              {m.error && <p className="mt-0.5 break-words text-xs text-marca-hondo">Falló: {m.error}</p>}
              <Boton variante="peligro" tamano="chico" className="mt-2" onClick={() => cancelar(m.id)}>Cancelar</Boton>
            </div>
          ))}
        </Tarjeta>
      )}
      {dialogo}
    </>
  );
}

// ============================================================================
function Difusiones({ puede, lineas }: { puede: boolean; lineas: LineaWhatsapp[] | null }) {
  const [hist, setHist] = useState<any[]>([]);
  // por qué número sale la difusión nueva ('' = la principal) y qué historial se mira
  const [saleLinea, setSaleLinea] = useState('');
  const [filtro, setFiltro] = useState('');
  const varias = hayVarias(lineas);
  const principal = deClientes(lineas).find((l) => l.principal)?.linea ?? '';
  const [base, setBase] = useState<any[]>([]);
  const [armando, setArmando] = useState(false);
  const [texto, setTexto] = useState('');
  const [titulo, setTitulo] = useState('');
  const [segmento, setSegmento] = useState<'todos' | 'activo' | 'enfriándose' | 'dormido'>('todos');
  const [origen, setOrigen] = useState<'todos' | 'cliente' | 'agenda'>('todos');
  const [barrio, setBarrio] = useState<string>('todos');
  const [soloNuevos, setSoloNuevos] = useState(true);
  const [listas, setListas] = useState<any[]>([]);
  const [listaId, setListaId] = useState<string>('');
  const [telsLista, setTelsLista] = useState<Set<string> | null>(null);
  const [programarPara, setProgramarPara] = useState<string>('');
  const [aviso, setAviso] = useState('');
  const [enviando, setEnviando] = useState(false);
  const { confirmar, dialogo } = useConfirmar();

  const cargar = useCallback(async () => {
    const r = await fetch('/api/responde?recurso=difusiones', { cache: 'no-store' });
    if (r.ok) setHist(await r.json());
  }, []);
  useEffect(() => { cargar(); const t = setInterval(cargar, 10000); return () => clearInterval(t); }, [cargar]);
  useEffect(() => { if (armando && !base.length) fetch('/api/responde?recurso=base').then((r) => r.ok ? r.json() : []).then(setBase); }, [armando, base.length]);
  useEffect(() => { if (armando && !listas.length) fetch('/api/responde?recurso=listas').then((r) => r.ok ? r.json() : []).then(setListas); }, [armando, listas.length]);
  useEffect(() => {
    if (!listaId) { setTelsLista(null); return; }
    fetch(`/api/responde?recurso=listaTelefonos&id=${listaId}`)
      .then((r) => r.ok ? r.json() : { telefonos: [] })
      .then((d) => setTelsLista(new Set(d.telefonos ?? [])));
  }, [listaId]);

  // La lista se ARMA con filtros: estado de relación, origen (cliente real vs
  // agenda), barrio, y "sin difusiones previas" — que es lo que hace que las
  // campañas grandes salgan en tandas: hoy 300, mañana el filtro trae a los
  // que faltan. El tope de 300 por tanda lo controla también el servidor.
  const barrios = Array.from(new Set(base.map((b) => b.barrio).filter(Boolean))).sort() as string[];
  const filtrados = base.filter((b) =>
    (!telsLista || telsLista.has(b.telefono_wa)) &&
    (segmento === 'todos' ? true : b.estado_relacion === segmento) &&
    (origen === 'todos' ? true : b.origen === origen) &&
    (barrio === 'todos' ? true : b.barrio === barrio) &&
    (!soloNuevos || !b.ultima_difusion),
  );
  const destinatarios = filtrados.slice(0, 300);
  const recortada = filtrados.length > 300;

  async function enviar() {
    if (!texto.trim() || !destinatarios.length || enviando) return;
    if (!(await confirmar({
      titulo: `¿Enviar a ${destinatarios.length} contacto(s)?`,
      texto: 'Sale con pausa entre mensajes.',
      textoConfirmar: 'Enviar',
    }))) return;
    setEnviando(true); setAviso('');
    const r = await post({ accion: 'difusion', ...(varias ? { linea: saleLinea || principal || undefined } : {}), titulo, texto, telefonos: destinatarios.map((d) => d.telefono_wa), ...(programarPara ? { programadaPara: new Date(programarPara).toISOString() } : {}) });
    if (r.ok) { setAviso(r.programadaPara ? `Difusión programada: ${r.total} destinatarios.` : `Difusión en marcha: ${r.total} destinatarios.`); setTexto(''); setTitulo(''); setProgramarPara(''); setArmando(false); cargar(); }
    else setAviso(r?.message ?? 'No se pudo crear la difusión');
    setEnviando(false);
  }

  async function cancelarDifusion(id: string) {
    if (await confirmar({ titulo: '¿Cancelar esta difusión programada?', variante: 'peligro', textoConfirmar: 'Cancelar la difusión', textoCancelar: 'Volver' })) {
      await post({ accion: 'cancelarDifusion', id }); cargar();
    }
  }

  if (!puede) return <Vacio titulo="Las difusiones las manda gerencia." />;

  return (
    <div className="space-y-4">
      <Tarjeta>
        {!armando ? (
          <Boton anchoCompleto onClick={() => setArmando(true)}>Nueva difusión</Boton>
        ) : (
          <div className="space-y-3">
            <Entrada value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Título interno (ej: Oferta vinos agosto)" aria-label="Título interno" />
            <AreaTexto value={texto} onChange={(e) => setTexto(e.target.value)} rows={4} placeholder="El mensaje que van a recibir…" aria-label="Mensaje" />
            {varias && (
              <Campo etiqueta="Sale por" ayuda="El número desde el que la reciben. Cada número tiene su propio tope de 300 por tanda.">
                <Selector value={saleLinea || principal} onChange={(e) => setSaleLinea(e.target.value)} className="sm:max-w-sm">
                  {deClientes(lineas).map((l) => <option key={l.linea} value={l.linea}>{l.etiqueta}</option>)}
                </Selector>
              </Campo>
            )}
            <Campo etiqueta="Lista" ayuda={listaId && telsLista === null ? 'cargando lista…' : undefined}>
              <Selector value={listaId} onChange={(e) => setListaId(e.target.value)} className="sm:max-w-sm">
                <option value="">toda la base</option>
                {listas.map((l) => <option key={l.id} value={l.id}>{l.nombre} ({l.miembros})</option>)}
              </Selector>
            </Campo>
            <div>
              <p className="mb-1.5 text-sm font-medium text-tinta">Relación</p>
              <Chips
                etiquetaAccesible="Relación"
                valor={segmento}
                onCambiar={setSegmento}
                opciones={(['todos', 'activo', 'enfriándose', 'dormido'] as const).map((s) => ({ valor: s, etiqueta: s }))}
              />
            </div>
            <div>
              <p className="mb-1.5 text-sm font-medium text-tinta">Origen</p>
              <div className="flex flex-wrap items-center gap-2">
                <Chips
                  etiquetaAccesible="Origen"
                  valor={origen}
                  onCambiar={setOrigen}
                  opciones={([['todos', 'todos'], ['cliente', 'clientes reales'], ['agenda', 'agenda']] as const).map(([v, l]) => ({ valor: v, etiqueta: l }))}
                />
                {barrios.length > 0 && (
                  <Selector value={barrio} onChange={(e) => setBarrio(e.target.value)} aria-label="Barrio" className="w-full sm:w-auto">
                    <option value="todos">todos los barrios</option>
                    {barrios.map((b) => <option key={b} value={b}>{b}</option>)}
                  </Selector>
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <label className={OPCION}>
                <input type="checkbox" checked={soloNuevos} onChange={(e) => setSoloNuevos(e.target.checked)} className="size-4 accent-marca" />
                solo sin difusiones previas (arma las tandas)
              </label>
              <span className="text-sm font-semibold text-tinta sm:ml-auto">
                {destinatarios.length} destinatario(s){recortada ? ` · tanda de 300 (quedan ${filtrados.length - 300} para la próxima)` : ''}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <span className="text-sm font-medium text-tinta">Enviar:</span>
              <label className={OPCION}>
                <input type="radio" name="cuando" checked={!programarPara} onChange={() => setProgramarPara('')} className="size-4 accent-marca" /> ahora
              </label>
              <label className={OPCION}>
                <input type="radio" name="cuando" checked={!!programarPara} onChange={() => { const d = new Date(Date.now() + 3600_000); d.setMinutes(0, 0, 0); setProgramarPara(new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)); }} className="size-4 accent-marca" /> programar:
              </label>
              {programarPara !== '' && (
                <Entrada type="datetime-local" value={programarPara} onChange={(e) => setProgramarPara(e.target.value)} aria-label="Fecha y hora de envío" className="sm:w-auto" />
              )}
            </div>
            <p className="text-xs text-tinta/60">Solo a quien dio permiso. Sale de a uno con pausa para cuidar el número; el tope es 300 por tanda{varias ? ' y por número' : ''} — mañana el filtro trae a los que faltan.</p>
            <div className="flex gap-2">
              <Boton onClick={enviar} cargando={enviando} disabled={enviando || !texto.trim() || !destinatarios.length} className="flex-1">{enviando ? 'Enviando…' : 'Enviar'}</Boton>
              <Boton variante="secundario" onClick={() => setArmando(false)}>Cancelar</Boton>
            </div>
          </div>
        )}
        {aviso && <Aviso tono="info" className="mt-3">{aviso}</Aviso>}
      </Tarjeta>

      {hist.length > 0 && <FiltroDeLinea lineas={lineas} valor={filtro} onCambiar={setFiltro} />}
      {hist.length > 0 && (
        <Tarjeta relleno={false} className="divide-y divide-black/[0.06] overflow-hidden">
          {(filtro ? hist.filter((d: any) => d.linea === filtro) : hist).map((d: any) => d.programada_para && !d.despachada_en ? (
            <div key={d.id} className="bg-atencion-suave/60 px-4 py-3 sm:px-5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
                <p className="flex min-w-0 flex-wrap items-center gap-2 break-words text-sm font-semibold text-tinta">{d.titulo || 'Difusión programada'}<ChipLinea linea={d.linea} lineas={lineas} /></p>
                <span className="importe text-xs font-medium text-atencion">
                  programada · {fechaHora(d.programada_para)} hs
                </span>
              </div>
              <p className="mt-1 line-clamp-2 break-words text-sm text-tinta/70">{d.texto}</p>
              <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs text-tinta/60">{d.total} destinatario(s)</span>
                <Boton variante="peligro" tamano="chico" onClick={() => cancelarDifusion(d.id)}>Cancelar</Boton>
              </div>
            </div>
          ) : (
            <div key={d.id} className="px-4 py-3 sm:px-5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
                <p className="flex min-w-0 flex-wrap items-center gap-2 break-words text-sm font-medium text-tinta">{d.titulo || '(sin título)'}<ChipLinea linea={d.linea} lineas={lineas} /></p>
                <span className="importe text-xs text-tinta/60">{fechaHora(d.creado_en)}</span>
              </div>
              <p className="mt-0.5 line-clamp-2 break-words text-sm text-tinta/70">{d.texto}</p>
              <p className={unir('mt-1 text-xs', d.terminada_en ? 'text-tinta/60' : 'text-info')}>
                {d.enviados}/{d.total} enviados{d.fallidos ? ` · ${d.fallidos} fallidos` : ''}{d.terminada_en ? ' · terminada' : ' · en curso…'}
              </p>
            </div>
          ))}
        </Tarjeta>
      )}
      {dialogo}
    </div>
  );
}
