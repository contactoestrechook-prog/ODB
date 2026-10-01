'use client';

import { useEffect, useState } from 'react';
import { Aviso, Boton, Campo, Chips, Entrada, Etiqueta, IconoAtencion, Kpi, Modal, Selector, TablaResponsiva, Tarjeta, Cargando, unir } from './kit';
import type { TonoEtiqueta } from './kit';
import { fecha, pesos } from '../lib/formato';

const ESTADO_TONO: Record<string, TonoEtiqueta> = {
  cartera: 'info',
  depositado: 'info',
  acreditado: 'ok',
  rechazado: 'error',
  aplicado: 'atencion',
  emitido: 'neutro',
  debitado: 'ok',
  anulado: 'neutro',
};
const ESTADO_LABEL: Record<string, string> = {
  cartera: 'En cartera', depositado: 'Depositado', acreditado: 'Acreditado', rechazado: 'Rechazado',
  aplicado: 'Endosado', emitido: 'Emitido', debitado: 'Debitado', anulado: 'Anulado',
};

type Cheque = any;

export function ChequesWorkspace({ resumen: resumenInicial, cheques: chequesInicial }: { resumen: any; cheques: Cheque[] }) {
  const [resumen, setResumen] = useState(resumenInicial);
  const [cheques, setCheques] = useState<Cheque[]>(chequesInicial ?? []);
  const [tipo, setTipo] = useState<'' | 'terceros' | 'propio'>('');
  const [estado, setEstado] = useState('');
  const [buscar, setBuscar] = useState('');
  const [cargando, setCargando] = useState(false);
  const [nuevo, setNuevo] = useState(false);
  const [accion, setAccion] = useState<{ id: string; tipo: 'rechazar' | 'aplicar' | 'depositar' | 'anular' } | null>(null);

  const recargar = async () => {
    setCargando(true);
    try {
      const qs = new URLSearchParams();
      if (tipo) qs.set('tipo', tipo);
      if (estado) qs.set('estado', estado);
      if (buscar.trim()) qs.set('buscar', buscar.trim());
      const [lst, res] = await Promise.all([
        fetch(`/api/cheques?${qs}`).then((r) => r.json()),
        fetch('/api/cheques?recurso=resumen').then((r) => r.json()),
      ]);
      setCheques(Array.isArray(lst) ? lst : []);
      setResumen(res);
    } catch {
      /* red caída: no dejamos la tabla colgada en "Cargando…" */
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => {
    const t = setTimeout(recargar, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tipo, estado, buscar]);

  const accionRapida = async (id: string, accion: string, extra?: any) => {
    await fetch('/api/cheques', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accion, id, ...extra }),
    });
    recargar();
  };

  const KPIS = [
    { label: 'En cartera', valor: pesos(resumen?.carteraImporte ?? 0), sub: `${resumen?.carteraCantidad ?? 0} cheques de terceros` },
    { label: 'Vencen en 7 días', valor: pesos(resumen?.venceEn7Importe ?? 0), sub: `${resumen?.venceEn7Cantidad ?? 0} a depositar`, alerta: (resumen?.venceEn7Cantidad ?? 0) > 0 },
    { label: 'Depositados', valor: pesos(resumen?.depositadosImporte ?? 0), sub: 'esperando acreditación' },
    { label: 'Rechazados', valor: pesos(resumen?.rechazadosImporte ?? 0), sub: `${resumen?.rechazadosCantidad ?? 0} rebotados`, alerta: (resumen?.rechazadosCantidad ?? 0) > 0 },
    { label: 'Propios pendientes', valor: pesos(resumen?.propiosPendientesImporte ?? 0), sub: 'a debitar del banco' },
  ];

  // anulado: la fila se ve apagada
  const tenue = (c: Cheque) => (c.estado === 'anulado' ? 'opacity-50' : undefined);

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {KPIS.map((k) => (
          <Kpi key={k.label} etiqueta={k.label} valor={k.valor} sub={k.sub} tono={k.alerta ? 'error' : 'neutro'} />
        ))}
      </div>

      {/* filtros */}
      <div className="flex flex-wrap items-center gap-2">
        <Chips
          etiquetaAccesible="Tipo de cheque"
          valor={tipo}
          onCambiar={(v) => setTipo(v as any)}
          opciones={[['', 'Todos'], ['terceros', 'De terceros'], ['propio', 'Propios']].map(([v, l]) => ({ valor: v, etiqueta: l }))}
        />
        <Selector aria-label="Estado del cheque" value={estado} onChange={(e) => setEstado(e.target.value)} className="w-full sm:w-52">
          <option value="">Todos los estados</option>
          <option value="cartera">En cartera</option>
          <option value="depositado">Depositados</option>
          <option value="acreditado">Acreditados</option>
          <option value="aplicado">Endosados</option>
          <option value="rechazado">Rechazados</option>
          <option value="emitido">Propios emitidos</option>
          <option value="debitado">Propios debitados</option>
        </Selector>
        <Entrada
          aria-label="Buscar cheque"
          value={buscar}
          onChange={(e) => setBuscar(e.target.value)}
          placeholder="Buscar N°, banco, librador…"
          className="w-full min-w-0 sm:w-auto sm:flex-1"
        />
        <Boton onClick={() => setNuevo(true)} className="w-full sm:w-auto">Cargar cheque</Boton>
      </div>

      {/* tabla */}
      {cargando && <Tarjeta><Cargando bloque /></Tarjeta>}
      {!cargando && cheques.length === 0 && (
        <Tarjeta><p className="py-6 text-center text-sm text-tinta/60">No hay cheques con estos filtros.</p></Tarjeta>
      )}
      {!cargando && cheques.length > 0 && (
        <TablaResponsiva
          etiqueta="Cheques"
          filas={cheques}
          claveFila="id"
          columnas={[
            {
              clave: 'cheque',
              titulo: 'Cheque',
              principal: true,
              celda: (c) => (
                <div className={unir('min-w-0', tenue(c))}>
                  <p className="font-mono text-sm">N° {c.numero}</p>
                  <p className="break-words text-xs font-normal text-tinta/60">{c.banco || 'banco s/d'}{c.titular ? ` · ${c.titular}` : ''} · {c.tipo === 'propio' ? 'propio' : 'terceros'}</p>
                </div>
              ),
            },
            {
              clave: 'origen',
              titulo: 'Origen / destino',
              celda: (c) => <span className={unir('break-words text-xs', tenue(c))}>{c.cliente?.razon_social ?? c.cliente?.nombre ?? c.proveedor?.razon_social ?? '—'}</span>,
            },
            {
              clave: 'cobro',
              titulo: 'Cobro',
              celda: (c) => {
                const vencido = c.estado === 'cartera' && c.fecha_cobro && c.fecha_cobro < new Date().toISOString().slice(0, 10);
                return (
                  <span className={unir('importe inline-flex items-center gap-1 text-xs', vencido ? 'font-semibold text-marca-hondo' : 'text-tinta/70', tenue(c))}>
                    {fecha(c.fecha_cobro)}
                    {vencido ? <><IconoAtencion className="size-4 shrink-0" /><span className="sr-only">vencido</span></> : ''}
                  </span>
                );
              },
            },
            { clave: 'importe', titulo: 'Importe', importe: true, celda: (c) => <span className={unir('font-semibold', tenue(c))}>{pesos(c.importe ?? 0)}</span> },
            {
              clave: 'estado',
              titulo: 'Estado',
              alinear: 'centro',
              celda: (c) => <Etiqueta tono={ESTADO_TONO[c.estado] ?? 'neutro'} className={tenue(c)}>{ESTADO_LABEL[c.estado] ?? c.estado}</Etiqueta>,
            },
            {
              clave: 'acciones',
              titulo: 'Acciones',
              acciones: true,
              celda: (c) => (
                <>
                  {c.tipo === 'terceros' && c.estado === 'cartera' && (
                    <>
                      <Boton variante="secundario" tamano="chico" onClick={() => accionRapida(c.id, 'depositar')}>Depositar</Boton>
                      <Boton variante="secundario" tamano="chico" onClick={() => setAccion({ id: c.id, tipo: 'aplicar' })}>Endosar</Boton>
                      <Boton variante="peligro" tamano="chico" onClick={() => setAccion({ id: c.id, tipo: 'rechazar' })}>Rechazar</Boton>
                    </>
                  )}
                  {c.tipo === 'terceros' && c.estado === 'depositado' && (
                    <>
                      <Boton variante="ok" tamano="chico" onClick={() => accionRapida(c.id, 'acreditar')}>Acreditar</Boton>
                      <Boton variante="peligro" tamano="chico" onClick={() => setAccion({ id: c.id, tipo: 'rechazar' })}>Rechazar</Boton>
                    </>
                  )}
                  {c.tipo === 'propio' && c.estado === 'emitido' && (
                    <>
                      <Boton variante="secundario" tamano="chico" onClick={() => accionRapida(c.id, 'debitar')}>Debitado</Boton>
                      <Boton variante="peligro" tamano="chico" onClick={() => setAccion({ id: c.id, tipo: 'rechazar' })}>Rechazar</Boton>
                    </>
                  )}
                  {['cartera', 'depositado', 'emitido'].includes(c.estado) && (
                    <Boton variante="fantasma" tamano="chico" onClick={() => setAccion({ id: c.id, tipo: 'anular' })}>Anular</Boton>
                  )}
                </>
              ),
            },
          ]}
        />
      )}

      {nuevo && <NuevoCheque onClose={() => setNuevo(false)} onSaved={() => { setNuevo(false); recargar(); }} />}
      {accion && <AccionCheque accion={accion} onClose={() => setAccion(null)} onDone={() => { setAccion(null); recargar(); }} />}
    </div>
  );
}

// ----- modal cargar cheque -----
function NuevoCheque({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<any>({ tipo: 'terceros', numero: '', banco: '', titular: '', importe: '', fechaCobro: '' });
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);
  const set = (k: string, v: any) => setF((p: any) => ({ ...p, [k]: v }));

  const guardar = async () => {
    setError('');
    if (!f.numero.trim() || !(Number(f.importe) > 0)) return setError('Número e importe son obligatorios');
    setGuardando(true);
    try {
      const res = await fetch('/api/cheques', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accion: 'crear', ...f, importe: Number(f.importe) }),
      });
      const d = await res.json();
      if (!res.ok) return setError(d?.message || 'No se pudo guardar');
      onSaved();
    } catch {
      setError('No se pudo conectar. Reintentá.');
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Modal
      abierto
      onCerrar={onClose}
      titulo="Cargar cheque"
      bloquearCierre={guardando}
      cerrarAlTocarAfuera={false}
      pie={<>
        <Boton variante="secundario" onClick={onClose}>Cancelar</Boton>
        <Boton onClick={guardar} cargando={guardando}>{guardando ? 'Guardando…' : 'Cargar'}</Boton>
      </>}
    >
      <div className="space-y-3">
        <Chips
          etiquetaAccesible="Tipo de cheque"
          valor={f.tipo}
          onCambiar={(v) => set('tipo', v)}
          opciones={[['terceros', 'De terceros (recibido)'], ['propio', 'Propio (emitido)']].map(([v, l]) => ({ valor: v, etiqueta: l }))}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <CampoTexto label="N° cheque" v={f.numero} on={(v) => set('numero', v)} />
          <CampoTexto label="Importe" v={f.importe} on={(v) => set('importe', v)} tipo="number" />
          <CampoTexto label="Banco" v={f.banco} on={(v) => set('banco', v)} />
          <CampoTexto label={f.tipo === 'propio' ? 'Titular' : 'Librador'} v={f.titular} on={(v) => set('titular', v)} />
          <CampoTexto label="Fecha de cobro" v={f.fechaCobro} on={(v) => set('fechaCobro', v)} tipo="date" />
        </div>
        {error && <Aviso tono="error">{error}</Aviso>}
      </div>
    </Modal>
  );
}

// ----- modal acción (rechazar / endosar / anular) -----
function AccionCheque({ accion, onClose, onDone }: { accion: { id: string; tipo: string }; onClose: () => void; onDone: () => void }) {
  const [motivo, setMotivo] = useState('');
  const [proveedorId, setProveedorId] = useState('');
  const [proveedores, setProveedores] = useState<any[]>([]);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (accion.tipo === 'aplicar') {
      fetch('/api/compras?recurso=proveedores').then((r) => r.json()).then((d) => setProveedores(Array.isArray(d) ? d : []));
    }
  }, [accion.tipo]);

  const ejecutar = async () => {
    setGuardando(true);
    const extra = accion.tipo === 'aplicar' ? { proveedorId } : accion.tipo === 'rechazar' || accion.tipo === 'anular' ? { motivo } : {};
    try {
      await fetch('/api/cheques', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accion: accion.tipo, id: accion.id, ...extra }),
      });
      onDone();
    } finally {
      setGuardando(false);
    }
  };

  const TITULO: Record<string, string> = { rechazar: 'Rechazar cheque', aplicar: 'Endosar a proveedor', anular: 'Anular cheque' };
  return (
    <Modal
      abierto
      onCerrar={onClose}
      ancho="chico"
      titulo={TITULO[accion.tipo] ?? 'Acción'}
      bloquearCierre={guardando}
      cerrarAlTocarAfuera={false}
      pie={<>
        <Boton variante="secundario" onClick={onClose}>Cancelar</Boton>
        <Boton
          variante={accion.tipo === 'aplicar' ? 'primario' : 'peligro'}
          onClick={ejecutar}
          cargando={guardando}
          disabled={guardando || (accion.tipo === 'aplicar' && !proveedorId)}
        >
          Confirmar
        </Boton>
      </>}
    >
      <div className="space-y-3">
        {accion.tipo === 'aplicar' && (
          <Selector aria-label="Proveedor" value={proveedorId} onChange={(e) => setProveedorId(e.target.value)}>
            <option value="">Elegí el proveedor…</option>
            {proveedores.map((p) => <option key={p.id} value={p.id}>{p.razon_social}</option>)}
          </Selector>
        )}
        {accion.tipo === 'rechazar' && (
          <>
            <p className="text-sm text-tinta/70">Si el cheque venía de una cobranza, se reabre la deuda del cliente en su cuenta corriente.</p>
            <CampoTexto label="Motivo del rechazo" v={motivo} on={setMotivo} />
          </>
        )}
        {accion.tipo === 'anular' && <CampoTexto label="Motivo (opcional)" v={motivo} on={setMotivo} />}
      </div>
    </Modal>
  );
}

function CampoTexto({ label, v, on, tipo = 'text' }: { label: string; v: string; on: (v: string) => void; tipo?: string }) {
  return (
    <Campo etiqueta={label}>
      <Entrada type={tipo} inputMode={tipo === 'number' ? 'decimal' : undefined} value={v} onChange={(e) => on(e.target.value)} />
    </Campo>
  );
}
