'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Aviso,
  Boton,
  Cargando,
  Chips,
  Entrada,
  Etiqueta,
  IconoAtencion,
  IconoOk,
  Kpi,
  Monto,
  TablaResponsiva,
  Tarjeta,
  TarjetaCabecera,
  Vacio,
} from './kit';
import { fecha, pesos } from '../lib/formato';

const EMISOR_LABEL: Record<string, string> = {
  principal: 'Sant Thomas · Chinvenguencha SRL',
  santa_ines: 'Santa Inés · ODB SRL',
};
const TIPO_LABEL: Record<string, string> = {
  FA: 'Factura A', FB: 'Factura B', NCA: 'Nota crédito A', NCB: 'Nota crédito B', NDA: 'Nota débito A', NDB: 'Nota débito B',
};

export function ArcaWorkspace({ estado, contador, pendientes }: { estado: any; contador: any; pendientes: any }) {
  const router = useRouter();
  const [cargando, setCargando] = useState(false);
  const [aviso, setAviso] = useState('');
  const [mes, setMes] = useState<string>(contador?.mes ?? new Date().toISOString().slice(0, 7));
  const [emisorSel, setEmisorSel] = useState<string>('principal');
  const [periodo, setPeriodo] = useState<string>('mes'); // hoy | semana | quincena | mes
  const [datos, setDatos] = useState<any>(contador);

  const hoyISO = () => new Date().toISOString().slice(0, 10);
  const hace = (d: number) => new Date(Date.now() - d * 86400_000).toISOString().slice(0, 10);
  const rangoDe = (p: string, m: string): string => {
    if (p === 'hoy') return `desde=${hoyISO()}&hasta=${hoyISO()}`;
    if (p === 'semana') return `desde=${hace(6)}&hasta=${hoyISO()}`;
    if (p === 'quincena') return `desde=${hace(14)}&hasta=${hoyISO()}`;
    return `mes=${m}`;
  };

  const cargar = async (p: string, m: string, e: string) => {
    setCargando(true);
    try {
      const res = await fetch(`/api/arca?recurso=contador&${rangoDe(p, m)}&emisor=${encodeURIComponent(e)}`);
      if (res.ok) setDatos(await res.json());
    } finally {
      setCargando(false);
    }
  };
  const cambiarPeriodo = (p: string) => { setPeriodo(p); void cargar(p, mes, emisorSel); };
  const cambiarMes = (nuevo: string) => { setMes(nuevo); setPeriodo('mes'); void cargar('mes', nuevo, emisorSel); };
  const cambiarEmisor = (nuevo: string) => { setEmisorSel(nuevo); void cargar(periodo, mes, nuevo); };

  const emitir = async () => {
    setCargando(true);
    setAviso('');
    try {
      const res = await fetch('/api/arca', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'emitir' }) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.message ?? 'Error');
      setAviso(`Emitidos ${d.emitidos} comprobante(s) con CAE${d.errores ? ` · ${d.errores} con error (mirá el detalle abajo)` : ''}.`);
      router.refresh();
      await cambiarMes(mes);
    } catch (e) {
      setAviso(e instanceof Error ? e.message : 'No se pudo emitir');
    } finally {
      setCargando(false);
    }
  };

  const descargarCsv = () => {
    const filas = datos?.comprobantes ?? [];
    const enc = ['Fecha', 'Tipo', 'Comprobante', 'Doc', 'Nro Doc', 'Receptor', 'Sucursal', 'Neto Gravado', 'IVA', 'Total', 'CAE', 'Vto CAE'];
    const esc = (v: any) => `"${String(v ?? '').replaceAll('"', '""')}"`;
    const cuerpo = filas.map((c: any) =>
      [c.fecha, TIPO_LABEL[c.tipo] ?? c.tipo, c.numero, c.docTipo, c.docNro, c.receptor, c.sucursal,
        c.neto.toFixed(2).replace('.', ','), c.iva.toFixed(2).replace('.', ','), c.total.toFixed(2).replace('.', ','), c.cae, c.caeVencimiento ?? '']
        .map(esc).join(';'),
    );
    const r = datos?.resumen ?? {};
    const csv = [
      `Comprobantes electrónicos ${datos?.emisor?.razonSocial ?? ''} - CUIT ${datos?.emisor?.cuit ?? ''} - Punto de venta ${String(datos?.emisor?.puntoVenta ?? '').padStart(4, '0')} - Período ${mes}`,
      '',
      enc.map(esc).join(';'),
      ...cuerpo,
      '',
      `TOTALES;;;;;;;${(r.neto ?? 0).toFixed(2).replace('.', ',')};${(r.ivaDebito ?? 0).toFixed(2).replace('.', ',')};${(r.total ?? 0).toFixed(2).replace('.', ',')};;`,
    ].join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `comprobantes-arca-${mes}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const r = datos?.resumen ?? {};
  const cola = pendientes?.comprobantes ?? [];
  const comprobantes: any[] = datos?.comprobantes ?? [];

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* estado de la conexión */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 space-y-2">
          <Chips
            etiquetaAccesible="Emisor"
            valor={emisorSel}
            onCambiar={cambiarEmisor}
            opciones={['principal', 'santa_ines'].map((e) => ({ valor: e, etiqueta: EMISOR_LABEL[e] ?? e }))}
          />
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-tinta/70">
            {(estado?.emisores ?? []).map((e: any) => (
              <span key={e.emisor} className="flex min-w-0 items-center gap-1.5">
                {EMISOR_LABEL[e.emisor]?.split(' · ')[0] ?? e.emisor}:
                {e.configurado && !e.error
                  ? <Etiqueta tono="ok">conectado{e.ultimaFacturaB != null ? ` · última FB ${e.ultimaFacturaB}` : ''}</Etiqueta>
                  : <span title={e.error}><Etiqueta tono="atencion">pendiente</Etiqueta></span>}
              </span>
            ))}
          </div>
        </div>
        <Boton variante="secundario" onClick={descargarCsv} disabled={!datos?.comprobantes?.length} className="w-full sm:w-auto lg:shrink-0">
          Descargar CSV para el contador
        </Boton>
      </div>

      {/* período: hoy / semana / quincena / mes */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-tinta/60">Período:</span>
        <Chips
          etiquetaAccesible="Período"
          valor={periodo}
          onCambiar={cambiarPeriodo}
          opciones={[['hoy', 'Hoy'], ['semana', 'Semana'], ['quincena', 'Quincena'], ['mes', 'Mes']].map(([id, label]) => ({ valor: id, etiqueta: label }))}
        />
        {periodo === 'mes' && (
          <div className="w-44">
            <Entrada type="month" value={mes} onChange={(e) => cambiarMes(e.target.value)} aria-label="Mes" />
          </div>
        )}
        {cargando && <Cargando texto="actualizando…" />}
      </div>

      {aviso && <Aviso tono="neutro">{aviso}</Aviso>}

      {/* resumen del mes */}
      {/* en el celular, neto y total (los importes largos) van a todo el ancho */}
      <div className="grid grid-flow-row-dense grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi etiqueta="Comprobantes" valor={r.comprobantes ?? 0} />
        <Kpi etiqueta="Neto gravado" valor={pesos(r.neto)} className="col-span-2 sm:col-span-1" />
        <Kpi etiqueta="IVA débito fiscal" valor={pesos(r.ivaDebito)} tono="error" />
        <Kpi etiqueta="Total facturado" valor={pesos(r.total)} className="col-span-2 sm:col-span-1" />
      </div>

      {(r.porTipo ?? []).length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {r.porTipo.map((t: any) => (
            <Tarjeta key={t.tipo} className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-tinta">{TIPO_LABEL[t.tipo] ?? t.tipo}</p>
                <p className="text-xs text-tinta/60">{t.cantidad} · IVA {pesos(t.iva)}</p>
              </div>
              <Monto valor={t.total} className="shrink-0 font-semibold text-tinta" />
            </Tarjeta>
          ))}
        </div>
      )}

      {/* cola pendiente */}
      <Tarjeta relleno={false} className="overflow-hidden">
        <TarjetaCabecera
          titulo={`Pendientes de CAE (${cola.length})`}
          accion={cola.length > 0 && (
            <Boton tamano="chico" onClick={emitir} disabled={cargando || !estado?.configurado}>
              {cargando ? 'Emitiendo…' : 'Emitir todos'}
            </Boton>
          )}
        />
        {cola.length === 0 ? (
          <p className="flex items-center justify-center gap-2 px-4 py-6 text-center text-sm text-ok">
            <IconoOk className="size-5 shrink-0" />
            Todo facturado. No hay comprobantes pendientes.
          </p>
        ) : (
          <TablaResponsiva
            sinMarco
            etiqueta="Pendientes de CAE"
            filas={cola}
            claveFila="id"
            columnas={[
              { clave: 'tipo', titulo: 'Tipo', principal: true, celda: (c: any) => TIPO_LABEL[c.tipo] ?? c.tipo },
              { clave: 'fecha', titulo: 'Fecha', claseCelda: 'whitespace-nowrap text-tinta/70', celda: (c: any) => fecha(c.creado_en, 'completa') },
              { clave: 'total', titulo: 'Total', importe: true, celda: (c: any) => pesos(c.venta?.total) },
              {
                clave: 'estado',
                titulo: 'Estado',
                celda: (c: any) =>
                  c.estado === 'error'
                    ? (
                      <span className="inline-flex items-start gap-1 text-xs text-marca-hondo" title={c.error_detalle}>
                        <IconoAtencion className="mt-px size-4 shrink-0" />
                        <span className="min-w-0 break-words">{String(c.error_detalle ?? 'error').slice(0, 60)}</span>
                      </span>
                    )
                    : <span className="text-xs text-tinta/60">pendiente</span>,
              },
            ]}
          />
        )}
      </Tarjeta>

      {/* comprobantes emitidos del mes */}
      <Tarjeta relleno={false} className="overflow-hidden">
        <TarjetaCabecera titulo={`Comprobantes con CAE — ${mes} (${comprobantes.length})`} />
        <TablaResponsiva
          sinMarco
          etiqueta="Comprobantes con CAE"
          filas={comprobantes}
          claveFila={(c: any) => c.numero + c.tipo}
          vacio={
            <Vacio
              className="m-4"
              titulo="Sin comprobantes electrónicos este mes todavía."
              texto="Cuando la caja facture, aparecen acá y en el CSV."
            />
          }
          columnas={[
            { clave: 'fecha', titulo: 'Fecha', claseCelda: 'whitespace-nowrap text-tinta/70', celda: (c: any) => c.fecha },
            {
              clave: 'comprobante',
              titulo: 'Comprobante',
              principal: true,
              claseCelda: 'whitespace-nowrap',
              celda: (c: any) => `${TIPO_LABEL[c.tipo] ?? c.tipo} ${c.numero}`,
            },
            {
              clave: 'receptor',
              titulo: 'Receptor',
              claseCelda: 'max-w-48',
              celda: (c: any) => <span className="break-words">{c.receptor}{c.docNro ? ` (${c.docTipo} ${c.docNro})` : ''}</span>,
            },
            { clave: 'neto', titulo: 'Neto', importe: true, celda: (c: any) => pesos(c.neto) },
            { clave: 'iva', titulo: 'IVA', importe: true, celda: (c: any) => <span className="text-marca-hondo">{pesos(c.iva)}</span> },
            { clave: 'total', titulo: 'Total', importe: true, celda: (c: any) => <span className="font-semibold">{pesos(c.total)}</span> },
            { clave: 'cae', titulo: 'CAE', celda: (c: any) => <span className="break-all font-mono text-xs text-tinta/70">{c.cae}</span> },
          ]}
        />
      </Tarjeta>
      <p className="px-1 text-xs text-tinta/60">
        El CSV incluye numeración completa, receptor, neto gravado, IVA débito, total y CAE de cada comprobante del período:
        listo para el libro IVA ventas del contador. Los importes usan coma decimal (formato Excel argentino).
      </p>
    </div>
  );
}
