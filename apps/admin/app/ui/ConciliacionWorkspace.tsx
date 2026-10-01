'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Aviso, Boton, Campo, Cargando, Entrada, Etiqueta, IconoAtencion, IconoOk, Kpi, Modal, Pestanas, Selector, TablaResponsiva, Tarjeta, TarjetaCabecera } from './kit';
import { fecha as formatoFecha, pesos } from '../lib/formato';

const fecha = (s: string) => formatoFecha(s, 'corta');
const hoy = () => new Date().toISOString().slice(0, 10);
const MEDIO: Record<string, string> = { mercadopago: 'Mercado Pago', tarjeta: 'Tarjeta' };
// mismo tono para el mismo medio en todo el panel
const TONO_MEDIO = (medio: string) => (medio === 'mercadopago' ? 'info' : 'neutro') as 'info' | 'neutro';

const TABS = [['pendientes', 'Por acreditar'], ['acreditadas', 'Acreditadas']] as const;

export function ConciliacionWorkspace({ resumen, pendientes }: { resumen: any; pendientes: any[] }) {
  const router = useRouter();
  const [tab, setTab] = useState('pendientes');
  const [modal, setModal] = useState<any>(null);
  const [aviso, setAviso] = useState('');
  const [acreditadas, setAcreditadas] = useState<any[] | null>(null);

  if (tab === 'acreditadas' && acreditadas === null) {
    fetch('/api/conciliacion?recurso=listar&estado=acreditada&dias=120')
      .then((r) => r.json())
      .then((d) => setAcreditadas(Array.isArray(d) ? d : []))
      .catch(() => setAcreditadas([]));
  }

  const post = async (body: any) => {
    setAviso('');
    const res = await fetch('/api/conciliacion', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const d = await res.json();
    if (!res.ok) { setAviso(d.message ?? 'Error'); return null; }
    setModal(null);
    router.refresh();
    return d;
  };

  const conciliarMP = async () => {
    const d = await post({ accion: 'mp' });
    if (d) setAviso(`Mercado Pago: ${d.conciliadas} acreditación(es) conciliada(s) de ${d.revisados} revisadas.`);
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi etiqueta="Por acreditar" valor={pesos(resumen?.porAcreditar)} tono={resumen?.porAcreditar > 0 ? 'atencion' : 'neutro'} />
        <Kpi etiqueta="Pendientes" valor={resumen?.pendientes ?? 0} />
        <Kpi etiqueta="Atrasadas" valor={resumen?.atrasadas ?? 0} tono={resumen?.atrasadas > 0 ? 'error' : 'neutro'} />
        <Kpi etiqueta="Acreditado (mes)" valor={pesos(resumen?.acreditadoMes)} />
      </div>

      {/* por medio */}
      {Array.isArray(resumen?.porMedio) && resumen.porMedio.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {resumen.porMedio.map((m: any) => (
            <Tarjeta key={m.medio} className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold text-tinta">{MEDIO[m.medio] ?? m.medio}</p>
                <p className="mt-0.5 text-xs text-tinta/60">{m.pendientes} por acreditar</p>
              </div>
              <p className="importe shrink-0 text-base font-semibold text-tinta">{pesos(m.por_acreditar)}</p>
            </Tarjeta>
          ))}
        </div>
      )}

      <Pestanas
        etiquetaAccesible="Vistas de conciliación"
        valor={tab}
        onCambiar={setTab}
        opciones={TABS.map(([k, label]) => ({ valor: k, etiqueta: label }))}
      />

      {aviso && <Aviso tono="neutro">{aviso}</Aviso>}

      {/* PENDIENTES */}
      {tab === 'pendientes' && (
        <>
          <div className="flex flex-wrap gap-2">
            <Boton onClick={conciliarMP} className="flex-1 sm:flex-none">Conciliar con Mercado Pago</Boton>
            <Boton variante="secundario" onClick={() => setModal({ tipo: 'lote' })} className="flex-1 sm:flex-none">Acreditar en lote</Boton>
          </div>
          <Tarjeta relleno={false} className="overflow-hidden">
            <TarjetaCabecera titulo={`Pendientes de acreditación (${pendientes.length})`} />
            <TablaResponsiva
              sinMarco
              etiqueta="Pendientes de acreditación"
              filas={pendientes}
              claveFila="id"
              vacio={
                <p className="flex items-center justify-center gap-1.5 px-4 py-8 text-center text-sm text-ok">
                  <IconoOk className="size-5 shrink-0" />Todo conciliado. No hay acreditaciones pendientes.
                </p>
              }
              columnas={[
                {
                  clave: 'medio',
                  titulo: 'Medio',
                  principal: true,
                  celda: (a) => (
                    <Etiqueta tono={TONO_MEDIO(a.medio)}>
                      {MEDIO[a.medio] ?? a.medio}
                      {a.medio === 'tarjeta' && a.pago?.terminal ? ` · ${a.pago.terminal === 'clover' ? 'Clover' : 'Getnet'}` : ''}
                    </Etiqueta>
                  ),
                },
                { clave: 'venta', titulo: 'Venta', celda: (a) => <span className="importe text-xs text-tinta/70">{fecha(a.venta?.vendida_en ?? a.creado_en)}</span> },
                { clave: 'bruto', titulo: 'Bruto', importe: true, celda: (a) => <span className="font-semibold">{pesos(a.bruto)}</span> },
                {
                  clave: 'acredita',
                  titulo: 'Acredita',
                  importe: true,
                  celda: (a) => {
                    const atrasada = a.fecha_estimada && a.fecha_estimada < hoy();
                    return (
                      <span className={`inline-flex items-center gap-1 text-xs ${atrasada ? 'font-semibold text-atencion' : 'text-tinta/70'}`}>
                        {fecha(a.fecha_estimada)}
                        {atrasada ? <><IconoAtencion className="size-4 shrink-0" /><span className="sr-only">atrasada</span></> : ''}
                      </span>
                    );
                  },
                },
                {
                  clave: 'acciones',
                  titulo: '',
                  acciones: true,
                  celda: (a) => <Boton variante="ok" tamano="chico" onClick={() => setModal({ tipo: 'acreditar', a })}>Acreditar</Boton>,
                },
              ]}
            />
          </Tarjeta>
          <p className="px-1 text-xs text-tinta/60">La comisión real de Mercado Pago y tarjetas se carga sola al conciliar el extracto o al vincular el medio por API. Acá solo seguimos el bruto por acreditar.</p>
        </>
      )}

      {/* ACREDITADAS */}
      {tab === 'acreditadas' && (
        acreditadas === null ? <Tarjeta><Cargando bloque /></Tarjeta> :
        <Tarjeta relleno={false} className="overflow-hidden">
          <TarjetaCabecera titulo={`Acreditadas (últimos 120 días · ${acreditadas.length})`} />
          <TablaResponsiva
            sinMarco
            etiqueta="Acreditadas"
            filas={acreditadas}
            claveFila="id"
            vacio={<p className="px-4 py-8 text-center text-sm text-tinta/60">Sin acreditaciones todavía.</p>}
            columnas={[
              { clave: 'medio', titulo: 'Medio', principal: true, celda: (a) => <Etiqueta tono={TONO_MEDIO(a.medio)}>{MEDIO[a.medio] ?? a.medio}</Etiqueta> },
              { clave: 'acredito', titulo: 'Acreditó', celda: (a) => <span className="importe text-xs text-tinta/70">{fecha(a.fecha_real)}</span> },
              { clave: 'bruto', titulo: 'Bruto', importe: true, celda: (a) => <span className="text-tinta/70">{pesos(a.bruto)}</span> },
              { clave: 'comision', titulo: 'Comisión real', importe: true, celda: (a) => <span className="text-marca-hondo">{pesos(a.comision_real)}</span> },
              {
                clave: 'pct',
                titulo: '%',
                importe: true,
                celda: (a) => {
                  const pct = Number(a.bruto) > 0 ? (Number(a.comision_real ?? 0) / Number(a.bruto)) * 100 : 0;
                  return <span className="text-xs text-tinta/60">{pct.toFixed(1)}%</span>;
                },
              },
              { clave: 'neto', titulo: 'Neto real', importe: true, celda: (a) => <span className="font-semibold">{pesos(a.neto_real)}</span> },
            ]}
          />
        </Tarjeta>
      )}

      {/* MODAL acreditar */}
      <Modal
        abierto={modal?.tipo === 'acreditar'}
        onCerrar={() => setModal(null)}
        ancho="chico"
        titulo={`Acreditar ${modal?.a ? MEDIO[modal.a.medio] ?? modal.a.medio : ''}`}
        descripcion={modal?.a ? `Bruto ${pesos(modal.a.bruto)} · neto estimado ${pesos(modal.a.neto_estimado)}. Cargá lo que realmente acreditó.` : undefined}
        pie={<Acciones cerrar={() => setModal(null)} okLabel="Marcar acreditada" variante="ok" onOk={() => post({ accion: 'acreditar', id: modal.a.id, netoReal: Number((document.getElementById('netoReal') as HTMLInputElement)?.value || 0), fechaReal: (document.getElementById('fechaReal') as HTMLInputElement)?.value })} />}
      >
        {modal?.tipo === 'acreditar' && (
          <div className="space-y-3">
            <Campo etiqueta="Neto real acreditado" id="netoReal">
              <Entrada type="number" inputMode="decimal" defaultValue={Math.round(Number(modal.a.neto_estimado))} autoFocus />
            </Campo>
            <Campo etiqueta="Fecha de acreditación" id="fechaReal">
              <Entrada type="date" defaultValue={hoy()} />
            </Campo>
          </div>
        )}
      </Modal>

      {/* MODAL lote */}
      <Modal
        abierto={modal?.tipo === 'lote'}
        onCerrar={() => setModal(null)}
        ancho="chico"
        titulo="Acreditar en lote"
        descripcion="Marca como acreditadas (al neto estimado) todas las pendientes de un medio hasta una fecha. Útil cuando llega una liquidación que cubre muchas ventas."
        pie={<Acciones cerrar={() => setModal(null)} okLabel="Acreditar lote" variante="ok" onOk={() => post({ accion: 'lote', medio: (document.getElementById('loteMedio') as HTMLSelectElement)?.value, hasta: (document.getElementById('loteHasta') as HTMLInputElement)?.value })} />}
      >
        {modal?.tipo === 'lote' && (
          <div className="space-y-3">
            <Campo etiqueta="Medio" id="loteMedio">
              <Selector defaultValue="tarjeta">
                <option value="tarjeta">Tarjeta</option>
                <option value="mercadopago">Mercado Pago</option>
              </Selector>
            </Campo>
            <Campo etiqueta="Hasta la fecha" id="loteHasta">
              <Entrada type="date" defaultValue={hoy()} />
            </Campo>
          </div>
        )}
      </Modal>
    </div>
  );
}

function Acciones({ cerrar, onOk, okLabel, variante = 'primario' }: any) {
  const [c, setC] = useState(false);
  return (
    <>
      <Boton variante="secundario" onClick={cerrar}>Cancelar</Boton>
      <Boton variante={variante} onClick={async () => { setC(true); try { await onOk(); } finally { setC(false); } }} cargando={c}>{okLabel}</Boton>
    </>
  );
}
