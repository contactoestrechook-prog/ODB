'use client';

// CAJA DEL DUEÑO, AL DÍA (26/11/2026). Juan Pablo vio la hoja igual a su Excel (25/11) y dijo
// «si lo tengo igual que Excel me quedo ahí haciéndolo»; Leandro: «no necesariamente tiene que
// ser formato Excel, sino que sea práctico».
//
// Quién: Juan Pablo, el dueño, casi siempre desde el celular (hasta reparte pedidos).
// Qué viene a hacer: anotar la plata que agarra (retiros de la caja de St Thomas, lo del
// reparto, otros ingresos) y la que paga (CCU, Leo, retiros), y saber cuánto tiene.
// Lo que el Excel no le hace:
//  · se escribe o se dicta como se diría («pagué 686 mil a CCU») y queda anotado;
//  · lo de siempre se repite de un toque;
//  · las cuentas salen solas: cuánto tiene, cuánto entró y salió en el mes, de dónde entró y
//    en qué se fue, con el mes pasado al lado.
// Las cuentas y la lectura de la frase están en lib/caja-dueno.ts (con pruebas en el API).

import { useMemo, useState } from 'react';
import { Aviso, Boton, Chips, Entrada, Modal, useConfirmar, unir, FOCO } from './kit';
import { BotonMicrofono } from './BotonMicrofono';
import {
  conPuntos, csvCaja, diaLegible, fechaLarga, frecuentesDe, hoyBA, leerDicho, mesLegible, montoEscrito, montoParaCampo, porDia,
  rangoPeriodo, resumenDe, saldoDe, sinTildes, sumarDias,
  type CuadroCaja, type Leido, type MovCaja, type Parte, type Periodo, type TipoMov,
} from '../lib/caja-dueno';

export type Hoja = {
  periodo: { desde: string | null; hasta: string | null };
  cuadros: CuadroCaja[];
  movimientos: MovCaja[];
  total: number;
};

type Ficha = { id?: string; tipoAntes?: TipoMov; tipo: TipoMov | null; monto: string; motivo: string; cuadroId: string | null; origenNuevo: string; fecha: string };
type Hecho = { texto: string; id?: string };

/** $ 686.000 · $ 1.500,50 · −$ 20.000 */
function plata(n: number): string {
  const abs = Math.abs(n);
  const t = abs.toLocaleString('es-AR', { minimumFractionDigits: Number.isInteger(abs) ? 0 : 2, maximumFractionDigits: 2 });
  return `${n < 0 ? '−' : ''}$ ${t}`;
}

async function pedir(body: Record<string, unknown>): Promise<{ id?: string }> {
  const r = await fetch('/api/caja-dueno', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(Array.isArray(d?.message) ? d.message.join(' ') : d?.message ?? 'No se pudo guardar.');
  return d;
}

const fichaDe = (l: Leido, id?: string, tipoAntes?: TipoMov): Ficha => ({
  id, tipoAntes, tipo: l.tipo, monto: l.monto ? montoParaCampo(l.monto) : '', motivo: l.motivo, cuadroId: l.cuadroId, origenNuevo: '', fecha: l.fecha,
});

/** Lo que falta para poder anotar. */
function faltaDe(l: Pick<Leido, 'tipo' | 'monto' | 'cuadroId'>): string[] {
  const f: string[] = [];
  if (!l.tipo) f.push('si entró o salió');
  if (!l.monto) f.push('cuánto');
  if (l.tipo === 'ingreso' && !l.cuadroId) f.push('de dónde entró');
  return f;
}

/** `anotar`: la frase ya escrita (/caja-dueno?anotar=…), para un atajo de dictado del celular. */
export function CajaDuenoAlDia({ inicial, anotar = '' }: { inicial: Hoja; anotar?: string }) {
  const [hoja, setHoja] = useState<Hoja>(inicial);
  const [periodo, setPeriodo] = useState<Periodo>('mes');
  const [dicho, setDicho] = useState(anotar.slice(0, 300));
  // «Entró» / «Salió» tocado cuando la frase no lo dice (vuelve a cero al cambiar la frase)
  const [lado, setLado] = useState<TipoMov | null>(null);
  const [ficha, setFicha] = useState<Ficha | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hecho, setHecho] = useState<Hecho | null>(null);
  const [buscar, setBuscar] = useState('');
  const { confirmar, dialogo } = useConfirmar();

  const hoy = hoyBA();
  const { cuadros, movimientos: movs } = hoja;
  const saldo = saldoDe(movs);
  const primero = movs.reduce<string | null>((min, m) => (!min || m.fecha < min ? m.fecha : min), null);
  const nombreCuadro = (id: string | null) => cuadros.find((c) => c.id === id)?.nombre ?? '';

  const rango = useMemo(() => rangoPeriodo(periodo, hoy), [periodo, hoy]);
  const delPeriodo = useMemo(() => (rango ? movs.filter((m) => m.fecha >= rango.desde && m.fecha <= rango.hasta) : movs), [movs, rango]);
  const resumen = useMemo(() => resumenDe(delPeriodo, cuadros), [delPeriodo, cuadros]);
  // el mes pasado, para comparar con este
  const pasado = useMemo(() => {
    const r = rangoPeriodo('pasado', hoy)!;
    return resumenDe(movs.filter((m) => m.fecha >= r.desde && m.fecha <= r.hasta), cuadros);
  }, [movs, cuadros, hoy]);
  const frecuentes = useMemo(() => frecuentesDe(movs), [movs]);
  const motivos = useMemo(() => [...new Map(movs.filter((m) => m.motivo.trim()).map((m) => [sinTildes(m.motivo).trim(), m.motivo.trim()])).values()].sort(), [movs]);
  const leido = useMemo(() => (dicho.trim() ? leerDicho(dicho, cuadros, movs, hoy, lado) : null), [dicho, cuadros, movs, hoy, lado]);
  const escribir = (t: string) => { setDicho(t); setLado(null); setHecho(null); };
  const q = sinTildes(buscar.trim());
  const lista = q ? movs.filter((m) => sinTildes(`${m.motivo} ${nombreCuadro(m.cuadroId)}`).includes(q)) : delPeriodo;
  const dias = porDia(lista);

  async function recargar() {
    const r = await fetch('/api/caja-dueno', { cache: 'no-store' });
    const d = await r.json().catch(() => null);
    if (r.ok && d?.movimientos) setHoja(d as Hoja);
  }

  // guardar: lo nuevo se crea; lo corregido se edita (si cambió de lado, se rehace)
  async function guardar(f: Ficha): Promise<boolean> {
    const monto = montoEscrito(f.monto);
    const falta = faltaDe({ tipo: f.tipo, monto, cuadroId: f.cuadroId ?? (f.origenNuevo.trim() ? 'nuevo' : null) });
    if (falta.length) { setError(`Falta ${falta.join(' y ')}.`); return false; }
    setGuardando(true);
    setError(null);
    try {
      let cuadroId = f.tipo === 'ingreso' ? f.cuadroId : null;
      if (f.tipo === 'ingreso' && !cuadroId && f.origenNuevo.trim()) cuadroId = (await pedir({ accion: 'cuadro-crear', nombre: f.origenNuevo.trim() })).id ?? null;
      const datos = { tipo: f.tipo, cuadroId, fecha: f.fecha, motivo: f.motivo.trim(), monto };
      let id = f.id;
      if (f.id && f.tipoAntes === f.tipo) await pedir({ accion: 'editar', id: f.id, ...datos });
      else {
        id = (await pedir({ accion: 'crear', ...datos })).id;
        if (f.id) await pedir({ accion: 'borrar', id: f.id });
      }
      await recargar();
      const lado = f.tipo === 'ingreso' ? 'entró' : 'salió';
      setHecho({
        texto: `${f.id ? 'Corregido' : 'Anotado'}: ${lado} ${plata(monto!)}${datos.motivo ? ` · ${datos.motivo}` : ''}${f.fecha !== hoy ? ` · ${diaLegible(f.fecha, hoy).toLowerCase()}` : ''}.`,
        id: f.id ? undefined : id,
      });
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar.');
      return false;
    } finally {
      setGuardando(false);
    }
  }

  // «Anotar» desde la frase: si está todo, se guarda; si falta algo, se abre la ficha para completarlo
  async function anotarDicho() {
    if (!leido || guardando) return;
    const f = fichaDe(leido);
    if (faltaDe(leido).length) { setError(null); setFicha(f); return; }
    if (await guardar(f)) { setDicho(''); setLado(null); }
  }

  // la frase no dice si entró o salió: un toque y queda anotado (o se abre la ficha si falta algo más)
  async function anotarComo(t: TipoMov) {
    if (guardando) return;
    setLado(t);
    const l = leerDicho(dicho, cuadros, movs, hoy, t);
    if (faltaDe(l).length) { setError(null); setFicha(fichaDe(l)); return; }
    if (await guardar(fichaDe(l))) { setDicho(''); setLado(null); }
  }

  async function deshacer(h: Hecho) {
    if (!h.id) return;
    try {
      await pedir({ accion: 'borrar', id: h.id });
      await recargar();
      setHecho({ texto: 'Listo, lo saqué.' });
    } catch (e) {
      setHecho({ texto: e instanceof Error ? e.message : 'No se pudo deshacer.' });
    }
  }

  async function borrar(f: Ficha) {
    if (!f.id) return;
    const ok = await confirmar({ titulo: '¿Lo borro?', texto: `${f.tipo === 'ingreso' ? 'Entró' : 'Salió'} ${f.monto ? `$ ${f.monto}` : ''}${f.motivo ? ` · ${f.motivo}` : ''}. Deja de contar en lo que tenés.`, variante: 'peligro', textoConfirmar: 'Borrar' });
    if (!ok) return;
    setGuardando(true);
    try {
      await pedir({ accion: 'borrar', id: f.id });
      await recargar();
      setFicha(null);
      setHecho({ texto: 'Borrado.' });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo borrar.');
    } finally {
      setGuardando(false);
    }
  }

  function bajar() {
    const blob = new Blob([csvCaja(movs, cuadros)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `caja-del-dueno-${hoy}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const abrirNuevo = (tipo: TipoMov) => { setError(null); setFicha({ tipo, monto: '', motivo: '', cuadroId: null, origenNuevo: '', fecha: hoy }); };
  const abrirMov = (m: MovCaja) => { setError(null); setFicha(fichaDe({ tipo: m.tipo, monto: m.monto, motivo: m.motivo, cuadroId: m.cuadroId, fecha: m.fecha }, m.id, m.tipo)); };
  const falta = leido ? faltaDe(leido) : [];

  return (
    <div className="space-y-5">
      {/* lo que tiene */}
      <section aria-label="Lo que tenés" className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/[0.06] sm:p-5">
        <p className="text-sm text-tinta/70">Tenés</p>
        <p className={unir('importe text-4xl font-bold tracking-tight sm:text-5xl', saldo < 0 ? 'text-marca' : 'text-tinta')}>{plata(saldo)}</p>
        <p className="mt-1 text-xs text-tinta/60">
          Todo lo que entró menos todo lo que salió{primero ? ` desde el ${fechaLarga(primero)}` : ''}.
        </p>

        {/* anotar como se diría */}
        <div className="mt-4 space-y-2">
          <label htmlFor="caja-dicho" className="block text-sm font-semibold text-tinta">Anotá como lo dirías</label>
          <div className="flex items-center gap-2">
            <Entrada id="caja-dicho" value={dicho} onChange={(e) => escribir(e.target.value)} autoComplete="off"
              className="flex-1" onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void anotarDicho(); } }} />
            <BotonMicrofono textoActual={dicho} onTexto={escribir} titulo="Dictar" />
            <Boton onClick={anotarDicho} disabled={!leido} cargando={guardando && !ficha}>Anotar</Boton>
          </div>
          {leido ? (
            <div className="space-y-2 text-sm text-tinta">
              <p>
                <span className="text-tinta/60">Entendí: </span>
                {leido.tipo && <b className={unir('font-semibold', leido.tipo === 'ingreso' ? 'text-ok' : 'text-marca')}>{leido.tipo === 'ingreso' ? 'entró' : 'salió'} </b>}
                {leido.monto ? <b className="importe font-semibold">{plata(leido.monto)}</b> : null}
                {leido.motivo && <> · {leido.motivo}</>}
                {leido.tipo === 'ingreso' && leido.cuadroId && <> · de {nombreCuadro(leido.cuadroId)}</>}
                {' · '}{diaLegible(leido.fecha, hoy).toLowerCase()}
                {falta.filter((x) => x !== 'si entró o salió').length > 0 && <span className="text-atencion"> · falta {falta.filter((x) => x !== 'si entró o salió').join(' y ')}</span>}
                {' '}
                <button type="button" onClick={() => { setError(null); setFicha(fichaDe(leido)); }} className={unir('font-semibold text-marca underline-offset-2 hover:underline', FOCO)}>Cambiar</button>
              </p>
              {!leido.tipo && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-atencion">¿Entró o salió?</span>
                  <Boton tamano="chico" variante="ok" onClick={() => anotarComo('ingreso')} disabled={guardando}>Entró</Boton>
                  <Boton tamano="chico" variante="peligro" onClick={() => anotarComo('egreso')} disabled={guardando}>Salió</Boton>
                </div>
              )}
            </div>
          ) : (
            <p className="text-xs text-tinta/60">Decí si entró o salió, cuánto y de qué. Antes de guardar te muestro lo que entendí.</p>
          )}
          {error && !ficha && <Aviso tono="error">{error}</Aviso>}
          {hecho && (
            <Aviso tono="ok" accion={hecho.id ? <Boton tamano="chico" variante="secundario" onClick={() => deshacer(hecho)}>Deshacer</Boton> : undefined}>
              {hecho.texto} Tenés {plata(saldo)}.
            </Aviso>
          )}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <button type="button" onClick={() => abrirNuevo('ingreso')} className={unir('rounded-xl bg-ok-suave px-3 py-3 text-left text-sm font-semibold text-ok hover:brightness-95', FOCO)}>+ Entró plata</button>
          <button type="button" onClick={() => abrirNuevo('egreso')} className={unir('rounded-xl bg-marca-suave px-3 py-3 text-left text-sm font-semibold text-marca hover:brightness-95', FOCO)}>− Salió plata</button>
        </div>

        {frecuentes.length > 0 && (
          <div className="mt-4">
            <p className="mb-1.5 text-xs font-semibold text-tinta/70">Lo de siempre (tocá y confirmás)</p>
            <div className="flex flex-wrap gap-2">
              {frecuentes.map((f) => (
                <button key={`${f.tipo}|${f.cuadroId}|${f.motivo}`} type="button"
                  onClick={() => { setError(null); setFicha(fichaDe({ tipo: f.tipo, monto: f.monto, motivo: f.motivo, cuadroId: f.cuadroId, fecha: hoy })); }}
                  className={unir('rounded-full border border-black/[0.1] bg-crema-claro px-3 py-1.5 text-left text-xs text-tinta hover:bg-white', FOCO)}>
                  <span className={unir('font-semibold', f.tipo === 'ingreso' ? 'text-ok' : 'text-marca')}>{f.tipo === 'ingreso' ? 'Entró' : 'Salió'}</span>
                  {' '}{f.motivo} · <span className="importe">{plata(f.monto)}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* las cuentas del período */}
      <section aria-label="Cómo viene" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-tinta">
            {periodo === 'mes' ? `Este mes · ${mesLegible(hoy)}` : periodo === 'pasado' ? `El mes pasado · ${mesLegible(rango!.desde)}` : 'Desde el principio'}
          </h2>
          <Chips<Periodo> etiquetaAccesible="Período" valor={periodo} onCambiar={setPeriodo}
            opciones={[{ valor: 'mes', etiqueta: 'Este mes' }, { valor: 'pasado', etiqueta: 'Mes pasado' }, { valor: 'todo', etiqueta: 'Todo' }]} />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Numero rotulo="Entró" valor={resumen.entro} tono="ok" antes={periodo === 'mes' && pasado.entro > 0 ? pasado.entro : null} />
          <Numero rotulo="Salió" valor={resumen.salio} tono="marca" antes={periodo === 'mes' && pasado.salio > 0 ? pasado.salio : null} />
          <Numero rotulo={resumen.queda >= 0 ? 'Quedó' : 'Faltó'} valor={resumen.queda} tono={resumen.queda >= 0 ? 'tinta' : 'marca'} antes={null} />
        </div>
        {(resumen.deDonde.length > 0 || resumen.enQue.length > 0) ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Partes titulo="De dónde entró" partes={resumen.deDonde} total={resumen.entro} tono="ok" />
            <Partes titulo="En qué se fue" partes={resumen.enQue} total={resumen.salio} tono="marca" />
          </div>
        ) : (
          <p className="text-sm text-tinta/60">{periodo === 'mes' ? 'Este mes todavía no anotaste nada.' : 'No hay nada anotado en ese período.'}</p>
        )}
      </section>

      {/* los movimientos */}
      <section aria-label="Movimientos" className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="min-w-0 break-words text-base font-semibold text-tinta">{q ? `Lo que dice «${buscar.trim()}»` : 'Movimientos'}</h2>
          <Boton tamano="chico" variante="fantasma" onClick={bajar} className="shrink-0">Bajar en Excel</Boton>
        </div>
        <Entrada aria-label="Buscar en los movimientos" value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Buscar" />
        {q && lista.length > 0 && (() => {
          const r = resumenDe(lista, cuadros);
          return <p className="text-sm text-tinta">{lista.length === 1 ? '1 vez' : `${lista.length} veces`}: entró <b className="importe text-ok">{plata(r.entro)}</b> · salió <b className="importe text-marca">{plata(r.salio)}</b></p>;
        })()}
        {dias.length === 0 ? (
          <p className="text-sm text-tinta/60">{q ? 'No encontré nada con eso.' : 'Nada anotado en este período.'}</p>
        ) : (
          <div className="space-y-3">
            {dias.map((d) => (
              <div key={d.fecha} className="rounded-xl bg-white ring-1 ring-black/[0.06]">
                <div className="flex items-baseline justify-between gap-2 border-b border-black/[0.06] px-3 py-2">
                  <h3 className="text-sm font-semibold text-tinta first-letter:uppercase">{diaLegible(d.fecha, hoy)}</h3>
                  <p className="importe text-xs text-tinta/60">
                    {d.entro > 0 && <span className="text-ok">+{plata(d.entro)}</span>}
                    {d.entro > 0 && d.salio > 0 && ' · '}
                    {d.salio > 0 && <span className="text-marca">−{plata(d.salio)}</span>}
                  </p>
                </div>
                <ul className="divide-y divide-black/[0.05]">
                  {d.movs.map((m) => (
                    <li key={m.id}>
                      <button type="button" onClick={() => abrirMov(m)} className={unir('flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-crema-claro', FOCO)}>
                        <span aria-hidden="true" className={unir('size-2 shrink-0 rounded-full', m.tipo === 'ingreso' ? 'bg-ok' : 'bg-marca')} />
                        <span className="min-w-0 flex-1">
                          <span className="block break-words text-sm text-tinta">{m.motivo || (m.tipo === 'ingreso' ? 'Entró' : 'Salió')}</span>
                          <span className="block text-xs text-tinta/60">{m.tipo === 'ingreso' ? `Entró de ${nombreCuadro(m.cuadroId) || 'otro lado'}` : 'Salió'}</span>
                        </span>
                        <span className={unir('importe shrink-0 text-sm font-semibold', m.tipo === 'ingreso' ? 'text-ok' : 'text-marca')}>
                          {m.tipo === 'ingreso' ? '+' : '−'}{plata(m.monto)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      <datalist id="caja-motivos">{motivos.map((m) => <option key={m} value={m} />)}</datalist>
      {ficha && (
        <FichaMovimiento ficha={ficha} cuadros={cuadros} hoy={hoy} guardando={guardando} error={error}
          onCambiar={setFicha} onCerrar={() => { setFicha(null); setError(null); }}
          onGuardar={async () => { if (await guardar(ficha)) { setFicha(null); if (!ficha.id) { setDicho(''); setLado(null); } } }}
          onBorrar={() => borrar(ficha)} />
      )}
      {dialogo}
    </div>
  );
}

function Numero({ rotulo, valor, tono, antes }: { rotulo: string; valor: number; tono: 'ok' | 'marca' | 'tinta'; antes: number | null }) {
  return (
    <div className="rounded-xl bg-white px-3 py-2.5 ring-1 ring-black/[0.06]">
      <p className="text-xs text-tinta/60">{rotulo}</p>
      <p className={unir('importe break-all text-base font-bold sm:text-xl', tono === 'ok' ? 'text-ok' : tono === 'marca' ? 'text-marca' : 'text-tinta')}>{plata(valor)}</p>
      {antes != null && <p className="text-xs text-tinta/60">El mes pasado <span className="importe">{plata(antes)}</span></p>}
    </div>
  );
}

/** Un desglose con barras; muestra hasta 6 y junta el resto, así siempre suma el total. */
function Partes({ titulo, partes, total, tono }: { titulo: string; partes: Parte[]; total: number; tono: 'ok' | 'marca' }) {
  const [todas, setTodas] = useState(false);
  if (!partes.length) return null;
  const visibles = todas || partes.length <= 7 ? partes : partes.slice(0, 6);
  const resto = partes.slice(visibles.length);
  const maximo = Math.max(...partes.map((p) => p.monto), 1);
  return (
    <div className="rounded-xl bg-white p-3 ring-1 ring-black/[0.06]">
      <h3 className="mb-2 text-sm font-semibold text-tinta">{titulo}</h3>
      <ul className="space-y-2">
        {visibles.map((p) => (
          <li key={p.clave}>
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="min-w-0 break-words text-tinta">{p.nombre}{p.veces > 1 && <span className="text-xs text-tinta/60"> · {p.veces} veces</span>}</span>
              <span className="importe shrink-0 font-semibold text-tinta">{plata(p.monto)}</span>
            </div>
            <div className="mt-1 h-1.5 rounded-full bg-black/[0.05]">
              <div className={unir('h-1.5 rounded-full', tono === 'ok' ? 'bg-ok' : 'bg-marca')} style={{ width: `${Math.max(2, (p.monto / maximo) * 100)}%` }} />
            </div>
          </li>
        ))}
        {resto.length > 0 && (
          <li>
            <button type="button" onClick={() => setTodas(true)} className={unir('flex w-full items-baseline justify-between gap-2 text-sm text-tinta/70 hover:text-tinta', FOCO)}>
              <span>{resto.length} más (ver)</span>
              <span className="importe">{plata(resto.reduce((s, p) => s + p.monto, 0))}</span>
            </button>
          </li>
        )}
      </ul>
      <div className="mt-2 flex items-baseline justify-between border-t border-black/[0.06] pt-2 text-sm">
        <span className="text-tinta/70">Total</span>
        <span className={unir('importe font-bold', tono === 'ok' ? 'text-ok' : 'text-marca')}>{plata(total)}</span>
      </div>
    </div>
  );
}

function FichaMovimiento({ ficha, cuadros, hoy, guardando, error, onCambiar, onCerrar, onGuardar, onBorrar }: {
  ficha: Ficha; cuadros: CuadroCaja[]; hoy: string; guardando: boolean; error: string | null;
  onCambiar: (f: Ficha) => void; onCerrar: () => void; onGuardar: () => void; onBorrar: () => void;
}) {
  const f = ficha;
  const poner = (cambio: Partial<Ficha>) => onCambiar({ ...f, ...cambio });
  const ayer = sumarDias(hoy, -1);
  const [otroOrigen, setOtroOrigen] = useState(!!f.origenNuevo);
  const titulo = f.id ? 'Corregir' : f.tipo === 'ingreso' ? 'Entró plata' : f.tipo === 'egreso' ? 'Salió plata' : 'Anotar';
  return (
    <Modal abierto onCerrar={onCerrar} titulo={titulo} ancho="chico" bloquearCierre={guardando}
      pie={(
        <>
          {f.id && <Boton variante="fantasma" onClick={onBorrar} disabled={guardando}>Borrar</Boton>}
          <Boton variante="secundario" onClick={onCerrar} disabled={guardando}>Cancelar</Boton>
          <Boton onClick={onGuardar} cargando={guardando}>{f.id ? 'Guardar' : 'Anotar'}</Boton>
        </>
      )}>
      <div className="space-y-4">
        <div role="group" aria-label="Entró o salió" className="grid grid-cols-2 gap-2">
          {(['ingreso', 'egreso'] as const).map((t) => (
            <button key={t} type="button" aria-pressed={f.tipo === t} onClick={() => poner({ tipo: t })}
              className={unir('rounded-xl px-3 py-2.5 text-sm font-semibold ring-1', FOCO,
                f.tipo === t ? (t === 'ingreso' ? 'bg-ok text-white ring-ok' : 'bg-marca text-white ring-marca') : 'bg-white text-tinta ring-black/[0.12] hover:bg-crema-claro')}>
              {t === 'ingreso' ? 'Entró' : 'Salió'}
            </button>
          ))}
        </div>

        <div>
          <label htmlFor="caja-monto" className="mb-1 block text-sm font-semibold text-tinta">¿Cuánto?</label>
          <Entrada id="caja-monto" prefijo="$" inputMode="decimal" autoComplete="off" value={f.monto} className="importe text-lg"
            onChange={(e) => poner({ monto: conPuntos(e.target.value) })} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onGuardar(); } }} />
        </div>

        {f.tipo === 'ingreso' && (
          <div>
            <p className="mb-1 text-sm font-semibold text-tinta">¿De dónde entró?</p>
            <div className="flex flex-wrap gap-2">
              {cuadros.map((c) => (
                <button key={c.id} type="button" aria-pressed={!otroOrigen && f.cuadroId === c.id} onClick={() => { setOtroOrigen(false); poner({ cuadroId: c.id, origenNuevo: '' }); }}
                  className={unir('rounded-full px-3 py-1.5 text-xs font-semibold ring-1', FOCO,
                    !otroOrigen && f.cuadroId === c.id ? 'bg-ok text-white ring-ok' : 'bg-white text-tinta ring-black/[0.12] hover:bg-crema-claro')}>
                  {c.nombre}
                </button>
              ))}
              <button type="button" aria-pressed={otroOrigen} onClick={() => { setOtroOrigen(true); poner({ cuadroId: null }); }}
                className={unir('rounded-full px-3 py-1.5 text-xs font-semibold ring-1', FOCO, otroOrigen ? 'bg-ok text-white ring-ok' : 'bg-white text-tinta ring-black/[0.12] hover:bg-crema-claro')}>
                + Otro
              </button>
            </div>
            {otroOrigen && (
              <Entrada aria-label="Nombre del origen nuevo" className="mt-2" value={f.origenNuevo} autoComplete="off" placeholder="Nombre del origen"
                onChange={(e) => poner({ origenNuevo: e.target.value })} />
            )}
          </div>
        )}

        <div>
          <label htmlFor="caja-motivo" className="mb-1 block text-sm font-semibold text-tinta">{f.tipo === 'egreso' ? '¿En qué?' : '¿De qué?'}</label>
          <Entrada id="caja-motivo" list="caja-motivos" autoComplete="off" value={f.motivo} onChange={(e) => poner({ motivo: e.target.value })}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onGuardar(); } }} />
        </div>

        <div>
          <p className="mb-1 text-sm font-semibold text-tinta">¿Cuándo?</p>
          <div className="flex flex-wrap items-center gap-2">
            {[{ v: hoy, t: 'Hoy' }, { v: ayer, t: 'Ayer' }].map((o) => (
              <button key={o.t} type="button" aria-pressed={f.fecha === o.v} onClick={() => poner({ fecha: o.v })}
                className={unir('rounded-full px-3 py-1.5 text-xs font-semibold ring-1', FOCO, f.fecha === o.v ? 'bg-tinta text-white ring-tinta' : 'bg-white text-tinta ring-black/[0.12] hover:bg-crema-claro')}>
                {o.t}
              </button>
            ))}
            <Entrada type="date" aria-label="Otro día" value={f.fecha} max={hoy} onChange={(e) => e.target.value && poner({ fecha: e.target.value })} className="w-auto" />
          </div>
        </div>
        {error && <Aviso tono="error">{error}</Aviso>}
      </div>
    </Modal>
  );
}
