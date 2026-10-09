'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ResumenCierre } from './ResumenCierre';
import { Aviso, Boton, Campo, Cargando, Entrada, Etiqueta, Kpi, Modal, Pestanas, Selector, TablaResponsiva, Tarjeta, TarjetaCabecera } from './kit';
import type { ColumnaTabla } from './kit';
import { fechaHora, pesos } from '../lib/formato';

const TABS = [['cajas', 'Cajas'], ['porcajero', 'Por cajero'], ['diferencias', 'Diferencias'], ['historico', 'Histórico'], ['arca', 'Facturación ARCA']] as const;

export function CierresWorkspace({ resumen, cajas, sesiones, arca, empleados = [] }: { resumen: any; cajas: any[]; sesiones: any[]; arca: any; empleados?: any[] }) {
  const router = useRouter();
  const [tab, setTab] = useState('cajas');
  const [modal, setModal] = useState<any>(null);
  const [aviso, setAviso] = useState('');
  const [resultado, setResultado] = useState<any>(null);
  const [porCajero, setPorCajero] = useState<any[] | null>(null);

  if (tab === 'porcajero' && porCajero === null) {
    fetch('/api/caja?recurso=por-cajero').then((r) => r.json()).then((d) => setPorCajero(Array.isArray(d) ? d : []));
  }

  const post = async (body: any) => {
    setAviso('');
    const res = await fetch('/api/caja', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const d = await res.json();
    if (!res.ok) { setAviso(d.message ?? 'Error'); return; }
    if (body.accion === 'cerrar') { setResultado(d); return; } // mostrar arqueo
    setModal(null); router.refresh();
  };

  const cerradas = sesiones.filter((s) => s.cerrada_en);
  const conDif = cerradas.filter((s) => s.diferencia != null && Number(s.diferencia) !== 0);

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Kpi etiqueta="Cajas abiertas" valor={`${resumen?.cajasAbiertas ?? 0}/${resumen?.cajasTotal ?? 0}`} />
        <Kpi etiqueta="Base en cajas" valor={pesos(resumen?.baseEnCajas)} />
        <Kpi etiqueta="Cierres del mes" valor={resumen?.sesionesMes ?? 0} />
        <Kpi etiqueta="Con diferencia" valor={resumen?.conDiferenciaMes ?? 0} tono={resumen?.conDiferenciaMes > 0 ? 'error' : 'neutro'} />
        <Kpi etiqueta="Diferencia neta" valor={pesos(resumen?.diferenciaNetaMes)} tono={Number(resumen?.diferenciaNetaMes) !== 0 ? 'error' : 'neutro'} />
        <Kpi etiqueta="ARCA pendientes" valor={arca?.total ?? 0} tono={arca?.total > 0 ? 'atencion' : 'neutro'} />
      </div>

      <Pestanas
        etiquetaAccesible="Vistas de cierres"
        valor={tab}
        onCambiar={setTab}
        opciones={TABS.map(([k, label]) => ({ valor: k, etiqueta: label }))}
      />

      {aviso && <Aviso tono="error">{aviso}</Aviso>}

      {/* CAJAS: abrir / arquear */}
      {tab === 'cajas' && (
        <div className="grid gap-3 sm:grid-cols-2">
          {cajas.map((c) => (
            <Tarjeta key={c.id}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="break-words font-semibold text-tinta">{c.nombre}</p>
                  <p className="text-xs text-tinta/60">{c.sucursal?.nombre}</p>
                </div>
                <Etiqueta tono={c.sesionAbierta ? 'ok' : 'neutro'} className="shrink-0">{c.sesionAbierta ? 'abierta' : 'cerrada'}</Etiqueta>
              </div>
              {c.sesionAbierta ? (
                <div className="mt-3">
                  <p className="text-xs text-tinta/70">Base inicial {pesos(c.sesionAbierta.monto_inicial)} · abrió {c.sesionAbierta.usuario?.nombre ?? '—'}</p>
                  <p className="text-xs text-tinta/60">desde {fechaHora(c.sesionAbierta.abierta_en)}</p>
                  <Boton tamano="chico" className="mt-3" onClick={() => { setResultado(null); setModal({ tipo: 'cerrar', sesion: c.sesionAbierta, caja: c }); }}>Arquear y cerrar</Boton>
                </div>
              ) : (
                <Boton tamano="chico" className="mt-3" onClick={() => setModal({ tipo: 'abrir', caja: c })}>Abrir caja</Boton>
              )}
            </Tarjeta>
          ))}
        </div>
      )}

      {/* POR CAJERO (control de diferencias por persona) */}
      {tab === 'porcajero' && (
        porCajero === null ? <Tarjeta><Cargando bloque /></Tarjeta> :
        <Tabla titulo="Arqueos por cajero" vacio="Sin cierres registrados todavía."
          filas={porCajero} claveFila={(_: any, i: number) => i}
          columnas={[
            { clave: 'cajero', titulo: 'Cajero', principal: true, celda: (c: any) => <><p className="font-semibold">{c.usuario}</p><p className="text-xs font-normal text-tinta/60">{c.rol}</p></> },
            { clave: 'cierres', titulo: 'Cierres', importe: true, celda: (c: any) => c.cierres },
            { clave: 'total', titulo: 'Total cerrado', importe: true, celda: (c: any) => <span className="text-tinta/70">{pesos(c.totalCerrado)}</span> },
            { clave: 'condif', titulo: 'Con dif.', importe: true, celda: (c: any) => c.conDiferencia },
            { clave: 'dif', titulo: 'Diferencia acum.', importe: true, celda: (c: any) => <span className={`font-semibold ${Number(c.diferenciaNeta) !== 0 ? 'text-marca-hondo' : 'text-ok'}`}>{Number(c.diferenciaNeta) !== 0 ? pesos(c.diferenciaNeta) : 'justo'}</span> },
          ]} />
      )}

      {/* DIFERENCIAS */}
      {tab === 'diferencias' && (
        <Tabla titulo={`Cierres con diferencia (${conDif.length})`} vacio="Sin diferencias de caja. Todos los arqueos cerraron justos."
          filas={conDif} claveFila="id"
          columnas={[
            { clave: 'caja', titulo: 'Caja', principal: true, celda: (s: any) => <><p className="font-semibold">{s.caja?.nombre}</p><p className="text-xs font-normal text-tinta/60">{s.caja?.sucursal?.nombre}</p></> },
            { clave: 'cajero', titulo: 'Cajero', celda: (s: any) => <span className="text-tinta/70">{s.usuario?.nombre ?? '—'}</span> },
            // quién contó y cerró (puede ser un supervisor); en los cierres viejos no se guardaba
            { clave: 'cerro', titulo: 'Cerró', celda: (s: any) => <span className="text-tinta/70">{s.cerrador?.nombre ?? '—'}</span> },
            { clave: 'cerrada', titulo: 'Cerrada', celda: (s: any) => <span className="importe text-xs text-tinta/70">{fechaHora(s.cerrada_en)}</span> },
            { clave: 'esperado', titulo: 'Esperado', importe: true, celda: (s: any) => <span className="text-tinta/70">{pesos(Number(s.monto_cierre) - Number(s.diferencia))}</span> },
            { clave: 'dif', titulo: 'Diferencia', importe: true, celda: (s: any) => <span className={`font-semibold ${Number(s.diferencia) < 0 ? 'text-marca-hondo' : 'text-ok'}`}>{Number(s.diferencia) > 0 ? '+' : ''}{pesos(s.diferencia)}</span> },
          ]} />
      )}

      {/* HISTÓRICO */}
      {tab === 'historico' && (
        <Tabla titulo={`Histórico de cierres (${cerradas.length})`} vacio="Todavía no hay cierres."
          filas={cerradas} claveFila="id"
          columnas={[
            { clave: 'caja', titulo: 'Caja', principal: true, celda: (s: any) => <><p className="font-semibold">{s.caja?.nombre}</p><p className="text-xs font-normal text-tinta/60">{s.caja?.sucursal?.nombre}</p></> },
            { clave: 'cajero', titulo: 'Cajero', celda: (s: any) => <span className="text-xs text-tinta/70">{s.usuario?.nombre ?? '—'}</span> },
            { clave: 'cerro', titulo: 'Cerró', ocultarEnMovil: true, celda: (s: any) => <span className="text-xs text-tinta/70">{s.cerrador?.nombre ?? '—'}</span> },
            { clave: 'abierta', titulo: 'Abierta', celda: (s: any) => <span className="importe text-xs text-tinta/70">{fechaHora(s.abierta_en)}</span> },
            { clave: 'cerrada', titulo: 'Cerrada', celda: (s: any) => <span className="importe text-xs text-tinta/70">{fechaHora(s.cerrada_en)}</span> },
            { clave: 'cierre', titulo: 'Cierre', importe: true, celda: (s: any) => pesos(s.monto_cierre) },
            { clave: 'dif', titulo: 'Dif.', importe: true, celda: (s: any) => <span className={`text-xs font-medium ${Number(s.diferencia) !== 0 ? 'text-marca-hondo' : 'text-tinta/60'}`}>{Number(s.diferencia) !== 0 ? pesos(s.diferencia) : 'justo'}</span> },
            { clave: 'ver', titulo: '', acciones: true, celda: (s: any) => <Boton variante="fantasma" tamano="chico" onClick={() => setModal({ tipo: 'ver', sesion: s, caja: s.caja })}>Ver cierre</Boton> },
          ]} />
      )}

      {/* ARCA */}
      {tab === 'arca' && (
        <Tarjeta className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-tinta">Facturación electrónica ARCA</h2>
              <p className="mt-0.5 text-sm text-tinta/60">{arca?.total ?? 0} comprobantes esperando CAE.</p>
            </div>
            <Boton onClick={() => post({ accion: 'arca' })} disabled={!arca?.configurado} className="w-full sm:w-auto">Emitir pendientes</Boton>
          </div>
          {!arca?.configurado && (
            <Aviso tono="atencion">
              ARCA todavía no está configurado. Para emitir CAE reales hay que cargar el certificado digital del CUIT de O.D.B (ARCA_CUIT, ARCA_CERT_PATH, ARCA_KEY_PATH). Mientras tanto los comprobantes quedan numerados y en cola.
            </Aviso>
          )}
        </Tarjeta>
      )}

      {/* MODALES */}
      <Modal
        abierto={modal?.tipo === 'abrir'}
        onCerrar={() => setModal(null)}
        ancho="chico"
        titulo={`Abrir ${modal?.caja?.nombre ?? ''}`}
        descripcion={modal?.caja?.sucursal?.nombre}
        pie={<Acciones cerrar={() => setModal(null)} okLabel="Abrir caja" onOk={() => post({ accion: 'abrir', cajaId: modal.caja.id, montoInicial: Number((document.getElementById('montoInicial') as HTMLInputElement)?.value || 0), empleadoId: (document.getElementById('empleadoId') as HTMLSelectElement)?.value || undefined })} />}
      >
        <div className="space-y-3">
          <Campo etiqueta="Cajero que toma la caja" id="empleadoId">
            <Selector defaultValue="">
              <option value="">— elegir empleado —</option>
              {empleados.filter((e: any) => e.activo !== false).map((e: any) => <option key={e.id} value={e.id}>{e.nombre} ({e.rol})</option>)}
            </Selector>
          </Campo>
          <Campo etiqueta="Base inicial (efectivo en caja al abrir)" id="montoInicial">
            <Entrada type="number" inputMode="decimal" placeholder="0" />
          </Campo>
          {aviso && <Aviso tono="error">{aviso}</Aviso>}
        </div>
      </Modal>

      <Modal
        abierto={modal?.tipo === 'ver'}
        onCerrar={() => setModal(null)}
        titulo="Cierre de caja"
        pie={<Boton variante="secundario" onClick={() => setModal(null)}>Cerrar</Boton>}
      >
        {modal?.tipo === 'ver' && <ResumenCierre sesionId={modal.sesion.id} />}
      </Modal>

      <Modal
        abierto={modal?.tipo === 'cerrar'}
        onCerrar={() => { setModal(null); setResultado(null); }}
        titulo={resultado ? `Arqueo de ${modal?.caja?.nombre ?? ''}` : `Arquear ${modal?.caja?.nombre ?? ''}`}
        descripcion={resultado ? undefined : 'Así va la caja. Contá el efectivo y registralo: el sistema calcula la diferencia contra lo que tiene que haber.'}
        cerrarAlTocarAfuera={false}
        pie={resultado
          ? <Boton onClick={() => { setModal(null); setResultado(null); router.refresh(); }}>Listo</Boton>
          : <Acciones cerrar={() => setModal(null)} okLabel="Cerrar y arquear" onOk={() => post({ accion: 'cerrar', sesionId: modal.sesion.id, montoCierre: Number((document.getElementById('montoCierre') as HTMLInputElement)?.value || 0) })} />}
      >
        {modal?.tipo === 'cerrar' && (resultado ? (
          <ResumenCierre sesionId={modal.sesion.id} recargar={1} />
        ) : (
          <div className="space-y-3">
            <div className="rounded-xl border border-black/[0.06] p-3"><ResumenCierre sesionId={modal.sesion.id} imprimible={false} /></div>
            <Campo etiqueta="Efectivo contado en caja" id="montoCierre">
              <Entrada type="number" inputMode="decimal" placeholder="0" autoFocus />
            </Campo>
            {aviso && <Aviso tono="error">{aviso}</Aviso>}
          </div>
        ))}
      </Modal>
    </div>
  );
}

function Acciones({ cerrar, onOk, okLabel }: any) {
  const [c, setC] = useState(false);
  return (
    <>
      <Boton variante="secundario" onClick={cerrar}>Cancelar</Boton>
      <Boton onClick={async () => { setC(true); try { await onOk(); } finally { setC(false); } }} cargando={c}>{okLabel}</Boton>
    </>
  );
}
function Tabla({ titulo, vacio, filas, claveFila, columnas }: { titulo: string; vacio: string; filas: any[]; claveFila: any; columnas: ColumnaTabla<any>[] }) {
  return (
    <Tarjeta relleno={false} className="overflow-hidden">
      <TarjetaCabecera titulo={titulo} />
      <TablaResponsiva
        sinMarco
        etiqueta={titulo}
        filas={filas}
        claveFila={claveFila}
        columnas={columnas}
        vacio={<p className="px-4 py-8 text-center text-sm text-tinta/60">{vacio}</p>}
      />
    </Tarjeta>
  );
}
