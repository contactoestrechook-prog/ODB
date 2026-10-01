'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Aviso, Boton, Campo, Chips, Entrada, Etiqueta, IconoOk, Kpi, Modal, TablaResponsiva, Tarjeta, TarjetaCabecera, Vacio, unir } from './kit';
import { fecha as formatoFecha, pesos, pesosCorto } from '../lib/formato';

const fecha = (s: string | null) => formatoFecha(s, 'corta');

const TIPO: Record<string, string> = {
  account_money: 'Dinero en cuenta',
  credit_card: 'Tarjeta de crédito',
  debit_card: 'Tarjeta de débito',
  bank_transfer: 'Transferencia',
  ticket: 'Efectivo (Rapipago/PF)',
  prepaid_card: 'Prepaga',
  digital_currency: 'Moneda digital',
};
const TIPO_COLOR: Record<string, string> = {
  account_money: 'bg-info',
  credit_card: 'bg-atencion',
  debit_card: 'bg-ok',
  bank_transfer: 'bg-dorado-hondo',
  ticket: 'bg-marca',
  prepaid_card: 'bg-marca/50',
  digital_currency: 'bg-tinta/40',
};

// Identidad de cada empresa en todo el panel
const EMPRESAS: Record<string, { nombre: string; corto: string; bg: string; chip: string }> = {
  principal: { nombre: 'Sant Thomas · Chinvenguencha SRL', corto: 'Sant Thomas', bg: 'bg-marca', chip: 'bg-marca-suave text-marca-hondo' },
  santa_ines: { nombre: 'Santa Inés · ODB SRL', corto: 'Santa Inés', bg: 'bg-info', chip: 'bg-info-suave text-info' },
};

export function MercadoPagoWorkspace({ estado, resumen: resumenInicial, pagos: pagosIniciales }: { estado: any; resumen: any; pagos: any[] }) {
  const router = useRouter();
  const [cargando, setCargando] = useState(false);
  const [aviso, setAviso] = useState('');
  const [filtro, setFiltro] = useState<string>(''); // '' = las dos
  const [dias, setDias] = useState<number>(30);
  const [resumen, setResumen] = useState<any>(resumenInicial);
  const [pagos, setPagos] = useState<any[]>(pagosIniciales);
  const [modalLink, setModalLink] = useState(false);
  const [link, setLink] = useState<{ url: string; monto: number; concepto: string } | null>(null);
  const [copiado, setCopiado] = useState(false);

  const recargar = async (cuenta: string, d: number) => {
    setCargando(true);
    try {
      const q = cuenta ? `&cuenta=${cuenta}` : '';
      const [rr, rp] = await Promise.all([
        fetch(`/api/mercadopago?recurso=resumen&dias=${d}${q}`),
        fetch(`/api/mercadopago?recurso=pagos&dias=${d}${q}`),
      ]);
      if (rr.ok) setResumen(await rr.json());
      if (rp.ok) setPagos(await rp.json());
    } finally {
      setCargando(false);
    }
  };
  const filtrar = (cuenta: string) => { setFiltro(cuenta); void recargar(cuenta, dias); };
  const cambiarPeriodo = (d: number) => { setDias(d); void recargar(filtro, d); };

  const PERIODOS: [number, string][] = [[1, 'Hoy'], [7, 'Semana'], [15, 'Quincena'], [30, 'Mes']];
  const periodoLabel = (PERIODOS.find(([d]) => d === dias)?.[1] ?? `${dias} días`).toLowerCase();

  const importar = async () => {
    setCargando(true);
    setAviso('');
    try {
      const res = await fetch('/api/mercadopago', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accion: 'importar', dias: 30 }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.message ?? 'Error');
      const detalle = (d.porCuenta ?? []).map((c: any) => `${EMPRESAS[c.cuenta]?.corto ?? c.cuenta}: ${c.importados}`).join(' · ');
      setAviso(`Importados ${d.importados} pagos (${detalle}) · ${d.vinculados} vinculados a ventas · ${d.acreditacionesActualizadas} acreditaciones al día.`);
      router.refresh();
      await recargar(filtro, dias);
    } catch (e) {
      setAviso(e instanceof Error ? e.message : 'No se pudo importar');
    } finally {
      setCargando(false);
    }
  };

  const generarLink = async () => {
    setCargando(true);
    setAviso('');
    try {
      const monto = Number((document.getElementById('linkMonto') as HTMLInputElement)?.value || 0);
      const concepto = (document.getElementById('linkConcepto') as HTMLInputElement)?.value || '';
      const res = await fetch('/api/mercadopago', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accion: 'link', monto, concepto }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.message ?? 'Error');
      setLink(d);
      setCopiado(false);
    } catch (e) {
      setAviso(e instanceof Error ? e.message : 'No se pudo crear el link');
    } finally {
      setCargando(false);
    }
  };

  const copiar = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopiado(true);
    } catch {}
  };

  if (!estado?.vinculado) {
    return (
      <Vacio titulo="Mercado Pago no está vinculado" texto="Faltan las credenciales en Railway (servicio odb-api)." />
    );
  }

  const porCuenta: any[] = resumen?.porCuenta ?? [];
  const totalCuentas = porCuenta.reduce((s, c) => s + c.bruto, 0) || 1;
  const serie: any[] = resumen?.porDia ?? [];
  const maxDia = Math.max(...serie.map((d) => d.principal + d.santa_ines), 1);

  // pagos no aprobados: la fila se ve apagada
  const tenue = (p: any) => (p.estado !== 'approved' ? 'opacity-50' : undefined);

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* estado + acciones */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Chips
            etiquetaAccesible="Empresa"
            valor={filtro}
            onCambiar={filtrar}
            opciones={[['', 'Las dos'], ['principal', 'Sant Thomas'], ['santa_ines', 'Santa Inés']].map(([id, label]) => ({ valor: id, etiqueta: label }))}
          />
          {cargando && <span role="status" className="text-xs text-tinta/60">actualizando…</span>}
        </div>
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          <Boton variante="secundario" onClick={() => { setModalLink(true); setLink(null); }} className="flex-1 sm:flex-none">
            Generar link de pago
          </Boton>
          <Boton onClick={importar} disabled={cargando} className="flex-1 sm:flex-none">
            {cargando ? 'Trayendo…' : 'Importar de Mercado Pago'}
          </Boton>
        </div>
      </div>

      {/* período: hoy / semana / quincena / mes */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-tinta/60">Período:</span>
        <Chips
          etiquetaAccesible="Período"
          valor={String(dias)}
          onCambiar={(v) => cambiarPeriodo(Number(v))}
          opciones={PERIODOS.map(([d, label]) => ({ valor: String(d), etiqueta: label }))}
        />
      </div>

      {aviso && <Aviso tono="neutro">{aviso}</Aviso>}

      {/* comparativa entre empresas (solo en vista "las dos") */}
      {!filtro && porCuenta.length > 1 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {porCuenta.map((c) => {
            const e = EMPRESAS[c.cuenta] ?? EMPRESAS.principal;
            const share = Math.round((c.bruto / totalCuentas) * 100);
            const est = (estado.cuentas ?? []).find((x: any) => x.slug === c.cuenta);
            return (
              <Tarjeta key={c.cuenta} relleno={false} className="overflow-hidden">
                <div className={unir(e.bg, 'flex flex-wrap items-center justify-between gap-2 px-4 py-3 sm:px-5')}>
                  <p className="min-w-0 text-sm font-semibold text-white">{e.nombre}</p>
                  <span className="rounded-full bg-white/20 px-2 py-0.5 text-xs text-white">
                    {est?.vinculado ? 'conectada' : 'pendiente'}
                  </span>
                </div>
                <div className="px-4 py-4 sm:px-5">
                  <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-1">
                    <p className="importe text-2xl font-bold leading-none text-tinta">{pesos(c.bruto)}</p>
                    <p className="text-xs text-tinta/60">{c.cantidad.toLocaleString('es-AR')} cobros · {share}%</p>
                  </div>
                  <div className="mt-3 h-2 rounded-full bg-black/[0.06]">
                    <div className={unir('h-2 rounded-full', e.bg)} style={{ width: `${share}%` }} />
                  </div>
                </div>
              </Tarjeta>
            );
          })}
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Kpi etiqueta={`Cobrado (${periodoLabel})`} valor={pesos(resumen?.bruto)} sub={`${resumen?.cobros ?? 0} cobros`} />
        <Kpi etiqueta="Comisión MP" valor={pesos(resumen?.comision)} tono="error" sub={`${resumen?.comisionPromedioPct ?? 0} % promedio`} />
        <Kpi etiqueta="Neto" valor={pesos(resumen?.neto)} tono="info" />
        <Kpi etiqueta="Ya liberado" valor={pesos(resumen?.liberado)} tono="ok" />
        <Kpi etiqueta="Por liberar" valor={pesos(resumen?.porLiberar)} tono={resumen?.porLiberar > 0 ? 'atencion' : 'neutro'} />
      </div>

      {/* cobros por día */}
      {serie.length > 0 && (
        <Tarjeta>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <h2 className="text-base font-semibold text-tinta">Cobros por día ({periodoLabel})</h2>
            <div className="flex items-center gap-3 text-xs text-tinta/70">
              <span className="flex items-center gap-1"><span className="inline-block size-2.5 rounded-sm bg-marca" /> Sant Thomas</span>
              <span className="flex items-center gap-1"><span className="inline-block size-2.5 rounded-sm bg-info" /> Santa Inés</span>
            </div>
          </div>
          {/* sin items-end: cada columna se estira a los 128 px y la barra (en %) toma su alto */}
          <div className="flex h-32 gap-[3px]">
            {serie.map((d) => {
              const total = d.principal + d.santa_ines;
              return (
                <div key={d.fecha} className="group flex min-w-0 flex-1 flex-col justify-end gap-[1px]" title={`${fecha(d.fecha)}: ${pesosCorto(total)} (ST ${pesosCorto(d.principal)} · SI ${pesosCorto(d.santa_ines)})`}>
                  <div className="rounded-t-sm bg-info group-hover:opacity-70" style={{ height: `${Math.max((d.santa_ines / maxDia) * 100, d.santa_ines > 0 ? 2 : 0)}%` }} />
                  <div className="rounded-t-sm bg-marca group-hover:opacity-70" style={{ height: `${Math.max((d.principal / maxDia) * 100, d.principal > 0 ? 2 : 0.5)}%` }} />
                </div>
              );
            })}
          </div>
          <div className="mt-1 flex justify-between text-xs text-tinta/60">
            <span>hace {dias} días</span>
            <span>hoy</span>
          </div>
        </Tarjeta>
      )}

      {/* próximas liberaciones */}
      {(resumen?.proximasLiberaciones ?? []).length > 0 && (
        <Tarjeta>
          <p className="mb-2 text-sm font-semibold text-tinta">Próximas liberaciones de dinero</p>
          <div className="flex flex-wrap gap-2">
            {resumen.proximasLiberaciones.map((p: any) => (
              <span key={p.fecha} className="rounded-full border border-atencion/20 bg-atencion-suave px-3 py-1 text-xs text-atencion">
                {fecha(p.fecha)} · <span className="importe font-bold">{pesos(p.neto)}</span>
              </span>
            ))}
          </div>
        </Tarjeta>
      )}

      {/* desglose por medio */}
      {(resumen?.porTipo ?? []).length > 0 && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {resumen.porTipo.map((t: any) => (
            <Tarjeta key={t.tipo}>
              <div className="flex min-w-0 items-center gap-2">
                <span className={`inline-block size-2.5 shrink-0 rounded-full ${TIPO_COLOR[t.tipo] ?? 'bg-tinta/30'}`} />
                <p className="min-w-0 truncate text-xs font-semibold text-tinta/70">{TIPO[t.tipo] ?? t.tipo}</p>
              </div>
              <p className="importe mt-1.5 truncate text-lg font-bold text-tinta">{pesos(t.bruto)}</p>
              <p className="text-xs text-tinta/60">{t.cantidad.toLocaleString('es-AR')} cobros</p>
            </Tarjeta>
          ))}
        </div>
      )}

      {/* listado */}
      <Tarjeta relleno={false} className="overflow-hidden">
        <TarjetaCabecera titulo={`Pagos ${filtro ? `de ${EMPRESAS[filtro]?.corto}` : 'de las dos empresas'} (${periodoLabel} · ${pagos.length})`} />
        <TablaResponsiva
          sinMarco
          etiqueta="Pagos de Mercado Pago"
          filas={pagos}
          claveFila="id"
          vacio={<p className="px-4 py-10 text-center text-sm text-tinta/60">Sin pagos en este período.</p>}
          columnas={[
            { clave: 'fecha', titulo: 'Fecha', celda: (p) => <span className={unir('importe text-xs text-tinta/70', tenue(p))}>{fecha(p.aprobado_en)}</span> },
            {
              clave: 'empresa',
              titulo: 'Empresa',
              celda: (p) => {
                const e = EMPRESAS[p.cuenta ?? 'principal'] ?? EMPRESAS.principal;
                return <span className={unir('inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap', e.chip, tenue(p))}>{e.corto}</span>;
              },
            },
            {
              clave: 'medio',
              titulo: 'Medio',
              principal: true,
              celda: (p) => (
                <span className={unir('text-xs font-normal', tenue(p))}>
                  <span className={`mr-1.5 inline-block size-2 rounded-full ${TIPO_COLOR[p.tipo] ?? 'bg-tinta/30'}`} />
                  {TIPO[p.tipo] ?? p.tipo ?? '—'}{p.cuotas > 1 ? ` · ${p.cuotas} cuotas` : ''}
                  {p.estado !== 'approved' && <Etiqueta tono="neutro" className="ml-1">{p.estado}</Etiqueta>}
                </span>
              ),
            },
            { clave: 'bruto', titulo: 'Bruto', importe: true, celda: (p) => <span className={unir('font-semibold', tenue(p))}>{pesos(p.bruto)}</span> },
            { clave: 'comision', titulo: 'Comisión', importe: true, celda: (p) => <span className={unir('text-xs text-marca-hondo', tenue(p))}>{pesos(p.comision)}</span> },
            { clave: 'neto', titulo: 'Neto', importe: true, celda: (p) => <span className={unir('text-xs', tenue(p))}>{pesos(p.neto)}</span> },
            {
              clave: 'liberacion',
              titulo: 'Liberación',
              alinear: 'derecha',
              celda: (p) => (
                <span className={tenue(p)}>
                  {p.liberado
                    ? <Etiqueta tono="ok">liberado</Etiqueta>
                    : <Etiqueta tono="atencion">{fecha(p.liberacion_en)}</Etiqueta>}
                </span>
              ),
            },
            {
              clave: 'venta',
              titulo: 'Venta',
              alinear: 'centro',
              celda: (p) => (
                <span className={tenue(p)}>
                  {p.venta_id
                    ? <span className="inline-flex text-ok"><IconoOk className="size-4" /><span className="sr-only">vinculado a una venta</span></span>
                    : <span className="text-tinta/60">—</span>}
                </span>
              ),
            },
          ]}
        />
      </Tarjeta>

      {/* modal link de pago */}
      <Modal
        abierto={modalLink}
        onCerrar={() => setModalLink(false)}
        ancho="chico"
        titulo="Link de pago"
        descripcion={!link ? 'Generá un link para cobrar a distancia (WhatsApp, teléfono). El pago entra solo al sistema.' : undefined}
        pie={!link ? (
          <>
            <Boton variante="secundario" onClick={() => setModalLink(false)}>Cancelar</Boton>
            <Boton onClick={generarLink} cargando={cargando}>Generar</Boton>
          </>
        ) : (
          <>
            <Boton variante="secundario" onClick={() => setModalLink(false)}>Cerrar</Boton>
            <Boton onClick={copiar} icono={copiado ? <IconoOk className="size-4" /> : undefined}>
              {copiado ? 'Copiado' : 'Copiar link'}
            </Boton>
          </>
        )}
      >
        {!link ? (
          <div className="space-y-3">
            <Campo etiqueta="Monto" id="linkMonto">
              <Entrada type="number" inputMode="decimal" min="1" step="0.01" autoFocus placeholder="15000" />
            </Campo>
            <Campo etiqueta="Concepto (lo ve el cliente)" id="linkConcepto">
              <Entrada type="text" placeholder="Pedido O.D.B" />
            </Campo>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-tinta">Link por <span className="importe font-semibold">{pesos(link.monto)}</span> — {link.concepto}</p>
            <p className="break-all rounded-xl bg-crema p-3 text-xs text-tinta/70">{link.url}</p>
          </div>
        )}
      </Modal>
    </div>
  );
}
