'use client';

// FACTURACIÓN (rehecha el 17/11/2026). Leandro, mirando la de antes: «hay que
// hacer una pantalla digna… esto es una poronga». La de antes sumaba solo lo
// emitido desde NÚCLEO (2 comprobantes en la historia) y mostraba seis cajas
// en $0. Lo que ODB factura de verdad todavía sale del sistema anterior (el
// Crack) y ya está cargado por cliente: la API lo junta con lo de NÚCLEO
// (GET /facturacion/tablero) y acá se lee el mes: cuánto se facturó contra el
// mes anterior al mismo día, día por día y por sucursal, cómo pagaron, qué
// tipo de comprobante, quién compró, qué se debe y desde cuándo, y cada
// comprobante con lo que se llevó. Todo número lleva a su detalle.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { EmitirComprobante } from './EmitirComprobante';
import { FacturacionDias, diaCorto, type DiaSucursales } from './FacturacionDias';
import {
  Boton, BotonLink, Chips, Entrada, Etiqueta, FOCO, FOCO_ADENTRO, IconoCerrar, Modal, Pestanas, ROTULO, Selector, TablaResponsiva, Vacio, unir,
  type TonoEtiqueta,
} from './kit';
import { pesos } from '../lib/formato';
import { linkWhatsapp, telefonoLegible } from '../lib/pedidos';

type Sucursal = 'st' | 'si';
type Comp = {
  id: string;
  origen: 'crack' | 'nucleo';
  fecha: string;
  sucursal: Sucursal | null;
  clase: 'factura' | 'nc' | 'nd' | 'remito' | 'recibo' | 'interno';
  letra: string | null;
  tipo: string;
  numero: string;
  clienteId: string | null;
  cliente: string;
  medio: string;
  total: number;
  renglones: number;
  anulado: boolean;
  cae?: string | null;
};
type Cifras = { facturado: number; notasCredito: number; neto: number; facturas: number; notas: number; clientes: number; ticketPromedio: number };
type Partida = { clave: string; etiqueta: string; total: number; comprobantes: number };
type Tablero = {
  mes: string;
  anterior: string;
  sucursal: Sucursal | 'todas';
  hoy: string;
  frescura: Record<Sucursal, string | null>;
  hastaDia: number;
  dibujarHasta: number;
  cifras: Cifras;
  comparacion: { actual: Cifras; anterior: Cifras; anteriorMesEntero: Cifras };
  porDia: { dia: number; fecha: string; neto: number; comprobantes: number }[];
  porDiaAnterior: { dia: number; fecha: string; neto: number; comprobantes: number }[];
  porMedio: Partida[];
  porTipo: Partida[];
  notasPorTipo: Partida[];
  porSucursal: Partida[];
  clientes: { id: string; nombre: string; telefono: string | null; total: number; comprobantes: number; saldo: number | null }[];
  clientesTotal: number;
  cobrar: {
    total: number;
    cuentas: number;
    diasPromedio: number | null;
    tramos: { clave: string; etiqueta: string; total: number; cuentas: number }[];
    deudores: { id: string; nombre: string; telefono: string | null; saldo: number; limite: number | null; dias: number | null }[];
  };
  arca: { pendientes: number; errores: number };
  comprobantes: Comp[];
};

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const nombreMes = (mes: string) => MESES[Number(mes.slice(5, 7)) - 1];
const mesLargo = (mes: string) => `${nombreMes(mes)} ${mes.slice(0, 4)}`;
const conMayuscula = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const moverMes = (mes: string, n: number) => {
  const [y, m] = mes.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
};
const mesDeHoy = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date()).slice(0, 7);
const NOMBRE_SUC: Record<Sucursal, string> = { st: 'Sant Thomas', si: 'Santa Inés' };
const porcentaje = (parte: number, total: number) => (total > 0 ? Math.round((parte / total) * 100) : 0);

// tono de la etiqueta del comprobante: sin amarillo (la pantalla lleva el azul de Sant Thomas)
const TONO_CLASE: Record<Comp['clase'], TonoEtiqueta> = { factura: 'neutro', nc: 'error', nd: 'neutro', remito: 'neutro', recibo: 'ok', interno: 'neutro' };

const VISTAS = ['resumen', 'comprobantes'] as const;
type Vista = (typeof VISTAS)[number];

const CLASES_FILTRO = [
  { valor: 'todos', etiqueta: 'Todos' },
  { valor: 'factura', etiqueta: 'Facturas' },
  { valor: 'nc', etiqueta: 'Notas de crédito' },
  { valor: 'nd', etiqueta: 'Notas de débito' },
  { valor: 'otros', etiqueta: 'Remitos y recibos' },
];

export function FacturacionWorkspace({
  sucursales,
  ventaInicial,
}: {
  sucursales: { id: string; nombre: string }[];
  ventaInicial?: { id: string; total: number } | null;
}) {
  const [mes, setMes] = useState<string>(mesDeHoy);
  const [sucursal, setSucursal] = useState<'todas' | Sucursal>('todas');
  const [vista, setVista] = useState<Vista>('resumen');
  const [datos, setDatos] = useState<Record<string, Tablero>>({});
  const [error, setError] = useState('');
  const [pedidoEmitir, setPedidoEmitir] = useState<{ tipo: string; n: number } | null>(null);
  // filtros de la lista de comprobantes
  const [clase, setClase] = useState('todos');
  const [medio, setMedio] = useState('todos');
  const [tipo, setTipo] = useState('todos');
  const [dia, setDia] = useState<string | null>(null);
  const [buscar, setBuscar] = useState('');
  const [abierto, setAbierto] = useState<Comp | null>(null);

  // ?mes=2026-10&sucursal=st&vista=comprobantes: se puede compartir el link
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const m = q.get('mes');
    if (m && /^\d{4}-\d{2}$/.test(m)) setMes(m);
    const s = q.get('sucursal');
    if (s === 'st' || s === 'si') setSucursal(s);
    const v = q.get('vista');
    if (v === 'comprobantes') setVista(v);
  }, []);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    q.delete('venta');
    q.delete('total');
    if (mes !== mesDeHoy()) q.set('mes', mes); else q.delete('mes');
    if (sucursal !== 'todas') q.set('sucursal', sucursal); else q.delete('sucursal');
    if (vista !== 'resumen') q.set('vista', vista); else q.delete('vista');
    const qs = q.toString();
    window.history.replaceState(null, '', `/facturacion${qs ? `?${qs}` : ''}`);
  }, [mes, sucursal, vista]);

  const clave = `${mes}|${sucursal}`;
  const t = datos[clave] ?? null;
  const pedidos = useRef(new Set<string>());
  const cargar = useCallback(async (m: string, s: string, forzar = false) => {
    const k = `${m}|${s}`;
    if (pedidos.current.has(k) && !forzar) return;
    pedidos.current.add(k);
    setError('');
    const r = await fetch(`/api/facturacion/tablero?mes=${m}${s !== 'todas' ? `&sucursal=${s}` : ''}`, { cache: 'no-store' }).catch(() => null);
    const d = r ? await r.json().catch(() => null) : null;
    if (!r || !r.ok || !d?.cifras) {
      pedidos.current.delete(k);
      setError(d?.message ?? 'No pude traer la facturación. Probá de nuevo.');
      return;
    }
    setDatos((x) => ({ ...x, [k]: d }));
  }, []);
  useEffect(() => { cargar(mes, sucursal); }, [mes, sucursal, cargar]);
  // el mes de al lado queda listo antes de tocar la flecha
  useEffect(() => {
    if (!t) return;
    const antes = moverMes(mes, -1);
    const id = setTimeout(() => cargar(antes, sucursal), 600);
    return () => clearTimeout(id);
  }, [t, mes, sucursal, cargar]);

  // al cambiar de mes o sucursal, el día elegido ya no vale
  useEffect(() => { setDia(null); }, [mes, sucursal]);

  const emitir = (tipoComp: string) => setPedidoEmitir((p) => ({ tipo: tipoComp, n: (p?.n ?? 0) + 1 }));
  const verComprobantes = (f: { clase?: string; medio?: string; tipo?: string; dia?: string | null }) => {
    setClase(f.clase ?? 'todos');
    setMedio(f.medio ?? 'todos');
    setTipo(f.tipo ?? 'todos');
    setDia(f.dia ?? null);
    setBuscar('');
    setVista('comprobantes');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const esMesActual = mes === mesDeHoy();
  const puedeAvanzar = mes < mesDeHoy();

  return (
    <div className="mx-auto w-full max-w-[100rem] space-y-4 sm:space-y-5">
      {/* EL PERÍODO Y LAS ACCIONES: una sola fila */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="flex items-center gap-1">
          <BotonFlecha direccion="atras" onClick={() => setMes((m) => moverMes(m, -1))} etiqueta={`Ir a ${mesLargo(moverMes(mes, -1))}`} />
          <h2 className="min-w-[10.5rem] text-center text-lg font-bold tracking-tight text-tinta sm:min-w-[12rem] sm:text-xl">{conMayuscula(mesLargo(mes))}</h2>
          <BotonFlecha direccion="adelante" onClick={() => setMes((m) => moverMes(m, 1))} etiqueta={`Ir a ${mesLargo(moverMes(mes, 1))}`} disabled={!puedeAvanzar} />
          {!esMesActual && (
            <button type="button" onClick={() => setMes(mesDeHoy())} className={unir('ml-1 rounded-full px-2.5 py-1 text-xs font-semibold text-marca-hondo hover:bg-marca-suave', FOCO)}>
              Volver a este mes
            </button>
          )}
        </div>
        <Segmentado
          valor={sucursal}
          onCambiar={(v) => setSucursal(v as 'todas' | Sucursal)}
          opciones={[
            { valor: 'todas', etiqueta: 'Las dos sucursales' },
            { valor: 'st', etiqueta: 'Sant Thomas', punto: 'bg-dato-1' },
            { valor: 'si', etiqueta: 'Santa Inés', punto: 'bg-dato-2' },
          ]}
        />
        <div className="flex w-full flex-wrap items-center gap-2 lg:ml-auto lg:w-auto">
          <MenuMas
            opciones={[
              { etiqueta: 'Nota de crédito', accion: () => emitir('NCB') },
              { etiqueta: 'Nota de débito', accion: () => emitir('NDB') },
              { etiqueta: 'Recibo de cobranza', accion: () => emitir('REC') },
              { etiqueta: 'Anticipo', accion: () => emitir('ANT') },
              { etiqueta: 'Remito', accion: () => emitir('REM') },
            ]}
          />
          <BotonLink href="/libro-iva" variante="secundario" tamano="chico">Libro IVA</BotonLink>
          <BotonLink href="/arca" variante="secundario" tamano="chico">ARCA y contador</BotonLink>
          <Boton tamano="chico" onClick={() => emitir('FB')}>+ Emitir factura</Boton>
        </div>
      </div>
      <EmitirComprobante sucursales={sucursales} ventaInicial={ventaInicial ?? null} pedido={pedidoEmitir} sinBoton />

      {error && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-marca-suave px-4 py-3 text-sm text-marca-hondo">
          <span>{error}</span>
          <Boton tamano="chico" variante="secundario" onClick={() => cargar(mes, sucursal, true)}>Reintentar</Boton>
        </div>
      )}

      {/* LAS CIFRAS DEL MES */}
      <Cifras t={t} mes={mes} sucursal={sucursal} onCobrar={() => (window.location.href = '/cuentas-corrientes')} onComprobantes={(f) => verComprobantes(f)} />

      {t && (t.arca.pendientes > 0 || t.arca.errores > 0) && (
        <Link href="/arca" className={unir('flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border border-marca/25 bg-white px-4 py-2.5 text-sm text-tinta transition-colors hover:bg-marca-suave/50', FOCO)}>
          <span className="size-2 shrink-0 rounded-full bg-marca" aria-hidden="true" />
          <span>
            <b className="font-semibold">ARCA:</b>{' '}
            {t.arca.errores > 0 && <>{t.arca.errores} {t.arca.errores === 1 ? 'factura rechazada' : 'facturas rechazadas'}{t.arca.pendientes > 0 ? ' y ' : ''}</>}
            {t.arca.pendientes > 0 && <>{t.arca.pendientes} {t.arca.pendientes === 1 ? 'venta de la caja espera' : 'ventas de la caja esperan'} su factura electrónica</>}
          </span>
          <span className="ml-auto font-semibold text-marca-hondo">Ver en ARCA →</span>
        </Link>
      )}

      <Pestanas
        etiquetaAccesible="Qué ver de la facturación"
        valor={vista}
        onCambiar={(v) => setVista(v as Vista)}
        opciones={[
          { valor: 'resumen', etiqueta: 'Resumen del mes' },
          { valor: 'comprobantes', etiqueta: 'Comprobantes', cuenta: t?.comprobantes.length },
          { valor: 'cuentas', etiqueta: 'Cuentas corrientes', cuenta: t?.cobrar.cuentas, href: '/cuentas-corrientes' },
        ]}
      />

      {vista === 'resumen' && <Resumen t={t} mes={mes} sucursal={sucursal} onComprobantes={verComprobantes} onAbrir={setAbierto} />}
      {vista === 'comprobantes' && (
        <ListaComprobantes
          t={t}
          mes={mes}
          filtros={{ clase, medio, tipo, dia, buscar }}
          cambiar={{ setClase, setMedio, setTipo, setDia, setBuscar }}
          onAbrir={setAbierto}
        />
      )}

      {abierto && <DetalleComprobante c={abierto} onCerrar={() => setAbierto(null)} />}
    </div>
  );
}

// ─── piezas chicas ────────────────────────────────────────────────────────

function BotonFlecha({ direccion, onClick, etiqueta, disabled }: { direccion: 'atras' | 'adelante'; onClick: () => void; etiqueta: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={etiqueta}
      title={etiqueta}
      className={unir('flex size-9 items-center justify-center rounded-full border border-black/10 bg-white text-tinta transition-colors hover:bg-crema-claro disabled:opacity-35 disabled:hover:bg-white', FOCO)}
    >
      <svg viewBox="0 0 24 24" className={unir('size-4', direccion === 'adelante' && 'rotate-180')} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M15 6l-6 6 6 6" />
      </svg>
    </button>
  );
}

function Segmentado({ valor, onCambiar, opciones }: { valor: string; onCambiar: (v: string) => void; opciones: { valor: string; etiqueta: string; punto?: string }[] }) {
  return (
    <div role="radiogroup" aria-label="Sucursal" className="flex max-w-full overflow-x-auto rounded-full border border-black/10 bg-white p-0.5">
      {opciones.map((o) => {
        const activo = o.valor === valor;
        return (
          <button
            key={o.valor}
            type="button"
            role="radio"
            aria-checked={activo}
            onClick={() => onCambiar(o.valor)}
            className={unir(
              'flex min-h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-sm font-semibold transition-colors',
              activo ? 'bg-tinta text-white' : 'text-tinta/70 hover:text-tinta',
              FOCO_ADENTRO,
            )}
          >
            {o.punto && <span className={unir('size-2 rounded-full', o.punto)} aria-hidden="true" />}
            {o.etiqueta}
          </button>
        );
      })}
    </div>
  );
}

function MenuMas({ opciones }: { opciones: { etiqueta: string; accion: () => void }[] }) {
  const [abierto, setAbierto] = useState(false);
  const caja = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: MouseEvent) => { if (!caja.current?.contains(e.target as Node)) setAbierto(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setAbierto(false); };
    document.addEventListener('mousedown', fuera);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', fuera); document.removeEventListener('keydown', esc); };
  }, [abierto]);
  return (
    <div ref={caja} className="relative">
      <Boton tamano="chico" variante="secundario" onClick={() => setAbierto((a) => !a)} aria-expanded={abierto} aria-haspopup="menu">
        Otro comprobante
        <svg viewBox="0 0 24 24" className={unir('ml-1 size-4 transition-transform', abierto && 'rotate-180')} fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
      </Boton>
      {abierto && (
        <div role="menu" className="absolute right-0 z-modal mt-1 w-56 overflow-hidden rounded-2xl border border-black/[0.08] bg-white py-1 shadow-flotante">
          {opciones.map((o) => (
            <button
              key={o.etiqueta}
              type="button"
              role="menuitem"
              onClick={() => { setAbierto(false); o.accion(); }}
              className={unir('block min-h-10 w-full px-4 text-left text-sm text-tinta hover:bg-crema-claro', FOCO_ADENTRO)}
            >
              {o.etiqueta}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Flecha({ sube }: { sube: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={sube ? 'M12 19V5M6 11l6-6 6 6' : 'M12 5v14M6 13l6 6 6-6'} />
    </svg>
  );
}

const SUMANDO = <span className="text-tinta/40">Sumando…</span>;

// ─── las cifras de arriba ─────────────────────────────────────────────────

function Cifras({
  t, mes, sucursal, onCobrar, onComprobantes,
}: {
  t: Tablero | null; mes: string; sucursal: string; onCobrar: () => void; onComprobantes: (f: { clase?: string }) => void;
}) {
  const c = t?.cifras;
  const comp = t?.comparacion;
  const diasMes = t?.porDia.length ?? 30;
  const mesCompleto = t ? t.hastaDia >= diasMes : false;
  const delta = comp && comp.anterior.neto > 0 ? Math.round(((comp.actual.neto - comp.anterior.neto) / comp.anterior.neto) * 100) : null;
  const ant = t ? nombreMes(t.anterior) : '';
  const hastaTexto = t && !mesCompleto && t.dibujarHasta > 0 ? `al ${t.dibujarHasta}/${Number(mes.slice(5, 7))}` : '';
  return (
    <section aria-label="Las cifras del mes" className="grid grid-cols-2 overflow-hidden rounded-2xl border border-black/[0.06] bg-white shadow-tarjeta lg:grid-cols-[1.6fr_1fr_1fr_1fr_1.3fr]">
      {/* lo facturado: la cifra grande */}
      <div className="col-span-2 border-b border-black/[0.06] p-4 sm:p-5 lg:col-span-1 lg:border-r lg:border-b-0">
        <p className={ROTULO}>Facturado en {nombreMes(mes)}{hastaTexto && <span className="normal-case tracking-normal"> · {hastaTexto}</span>}</p>
        <p className="importe mt-1.5 text-3xl font-bold leading-none tracking-tight text-tinta sm:text-4xl">{c ? pesos(c.neto) : SUMANDO}</p>
        {comp && (
          <div className="mt-2.5 space-y-1 text-sm">
            {delta != null ? (
              <p className={unir('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold', delta >= 0 ? 'bg-ok-suave text-ok' : 'bg-marca-suave text-marca-hondo')}>
                <Flecha sube={delta >= 0} />
                {Math.abs(delta)} % {delta >= 0 ? 'más' : 'menos'} que {mesCompleto ? ant : `del 1 al ${t!.hastaDia} de ${ant}`}
              </p>
            ) : (
              <p className="text-xs text-tinta/60">Sin datos de {ant} para comparar</p>
            )}
            <p className="text-xs text-tinta/60">
              {mesCompleto
                ? <>{conMayuscula(ant)}: <span className="importe">{pesos(comp.anterior.neto)}</span></>
                : <>Del 1 al {t!.hastaDia}: <span className="importe text-tinta/80">{pesos(comp.actual.neto)}</span> contra <span className="importe text-tinta/80">{pesos(comp.anterior.neto)}</span> · {ant} entero <span className="importe">{pesos(comp.anteriorMesEntero.neto)}</span></>}
            </p>
          </div>
        )}
      </div>
      <CifraChica
        rotulo="Facturas"
        valor={c ? c.facturas.toLocaleString('es-AR') : null}
        bajada={c ? <>ticket promedio <span className="importe">{pesos(c.ticketPromedio)}</span></> : null}
        onClick={() => onComprobantes({ clase: 'factura' })}
        className="border-r border-b border-black/[0.06] lg:border-b-0"
      />
      <CifraChica
        rotulo="Notas de crédito"
        valor={c ? pesos(c.notasCredito) : null}
        bajada={c ? `${c.notas} ${c.notas === 1 ? 'nota' : 'notas'} · ${porcentaje(c.notasCredito, c.facturado)} % de lo facturado` : null}
        onClick={() => onComprobantes({ clase: 'nc' })}
        className="border-b border-black/[0.06] lg:border-r lg:border-b-0"
      />
      <CifraChica
        rotulo="Clientes que compraron"
        valor={c ? c.clientes.toLocaleString('es-AR') : null}
        bajada={comp ? `${comp.anterior.clientes} del 1 al ${t!.hastaDia} de ${ant}` : null}
        className="border-r border-black/[0.06]"
      />
      <CifraChica
        rotulo={`Por cobrar hoy${sucursal !== 'todas' ? ` · ${NOMBRE_SUC[sucursal as Sucursal]}` : ''}`}
        valor={t ? pesos(t.cobrar.total) : null}
        bajada={t ? `${t.cobrar.cuentas} cuentas${t.cobrar.diasPromedio != null ? ` · ${t.cobrar.diasPromedio} días de deuda promedio` : ''}` : null}
        onClick={onCobrar}
        tono="text-marca-hondo"
      />
    </section>
  );
}

function CifraChica({ rotulo, valor, bajada, onClick, className, tono }: { rotulo: string; valor: string | null; bajada: React.ReactNode; onClick?: () => void; className?: string; tono?: string }) {
  const cuerpo = (
    <>
      <p className={ROTULO}>{rotulo}</p>
      <p className={unir('importe mt-1.5 text-xl font-bold leading-none tracking-tight sm:text-2xl', tono ?? 'text-tinta')}>{valor ?? SUMANDO}</p>
      {bajada && <p className="mt-2 text-xs leading-snug text-tinta/60">{bajada}</p>}
    </>
  );
  return onClick ? (
    <button type="button" onClick={onClick} className={unir('group min-w-0 p-4 text-left transition-colors hover:bg-crema-claro sm:p-5', FOCO_ADENTRO, className)}>
      {cuerpo}
    </button>
  ) : (
    <div className={unir('min-w-0 p-4 sm:p-5', className)}>{cuerpo}</div>
  );
}

// ─── resumen ──────────────────────────────────────────────────────────────

function Bloque({ titulo, bajada, accion, children, className }: { titulo: string; bajada?: React.ReactNode; accion?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={unir('min-w-0 rounded-2xl border border-black/[0.06] bg-white p-4 shadow-tarjeta sm:p-5', className)}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-tinta">{titulo}</h3>
          {bajada && <p className="mt-0.5 text-xs text-tinta/60">{bajada}</p>}
        </div>
        {accion}
      </div>
      {children}
    </section>
  );
}

function Resumen({
  t, mes, sucursal, onComprobantes, onAbrir,
}: {
  t: Tablero | null; mes: string; sucursal: string; onComprobantes: (f: { clase?: string; medio?: string; tipo?: string; dia?: string | null }) => void; onAbrir: (c: Comp) => void;
}) {
  // los días, partidos por sucursal (con los comprobantes del mes)
  const dias: DiaSucursales[] = useMemo(() => {
    if (!t) return [];
    const base = t.porDia.map((d) => ({ dia: d.dia, fecha: d.fecha, st: 0, si: 0, otros: 0, comprobantes: 0 }));
    for (const c of t.comprobantes) {
      if (c.anulado || !['factura', 'nd', 'nc'].includes(c.clase)) continue;
      const d = base[Number(c.fecha.slice(8, 10)) - 1];
      if (!d) continue;
      if (c.sucursal === 'st') d.st += c.total;
      else if (c.sucursal === 'si') d.si += c.total;
      else d.otros += c.total;
      if (c.clase !== 'nc') d.comprobantes += 1;
    }
    return base;
  }, [t]);

  if (!t) return <EsqueletoResumen />;
  const hoyDia = t.hoy.slice(0, 7) === mes ? Number(t.hoy.slice(8, 10)) : null;
  const totalSuc = (s: Sucursal) => t.porSucursal.find((p) => p.clave === s)?.total ?? 0;
  const conDatos = t.comprobantes.length > 0;

  return (
    <div className="grid gap-4 lg:grid-cols-12">
      {/* día por día */}
      <Bloque
        className="lg:col-span-8"
        titulo="Facturado por día"
        bajada={`Tocá un día para ver sus comprobantes. La línea gris es el mismo día de ${nombreMes(t.anterior)}.`}
        accion={
          <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-tinta/70">
            {sucursal !== 'si' && <li className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-dato-1" />Sant Thomas <span className="importe font-semibold text-tinta">{pesos(totalSuc('st'))}</span></li>}
            {sucursal !== 'st' && <li className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-dato-2" />Santa Inés <span className="importe font-semibold text-tinta">{pesos(totalSuc('si'))}</span></li>}
            <li className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded-full bg-tinta/35" />{conMayuscula(nombreMes(t.anterior))}</li>
          </ul>
        }
      >
        {conDatos ? (
          <FacturacionDias
            dias={dias}
            anterior={t.porDiaAnterior}
            dibujarHasta={t.dibujarHasta}
            hoyDia={hoyDia}
            mostrarSucursales={{ st: sucursal !== 'si', si: sucursal !== 'st' }}
            nombreAnterior={nombreMes(t.anterior)}
            onElegirDia={(fecha) => onComprobantes({ dia: fecha })}
          />
        ) : (
          <Vacio titulo={`No hay comprobantes de ${mesLargo(mes)}`} texto="Lo del sistema anterior llega con cada carga de sus archivos." />
        )}
        <Frescura t={t} sucursal={sucursal} />
      </Bloque>

      {/* cómo pagaron y qué comprobante */}
      <div className="grid gap-4 lg:col-span-4">
        <Bloque titulo="Cómo pagaron" bajada="Lo facturado según el medio de pago">
          <Barras partidas={t.porMedio} total={t.cifras.neto} onElegir={(p) => onComprobantes({ medio: p.clave })} />
        </Bloque>
        <Bloque titulo="Por tipo de comprobante">
          <Barras partidas={t.porTipo} total={t.cifras.facturado} onElegir={(p) => onComprobantes({ tipo: p.clave })} />
          {t.notasPorTipo.length > 0 && (
            <ul className="mt-3 space-y-1 border-t border-black/[0.06] pt-3">
              {t.notasPorTipo.map((p) => (
                <li key={p.clave}>
                  <button type="button" onClick={() => onComprobantes({ tipo: p.clave })} className={unir('flex w-full items-center justify-between gap-3 rounded-lg py-1 text-left text-sm hover:bg-crema-claro', FOCO)}>
                    <span className="text-tinta/80">{p.etiqueta} <span className="text-tinta/60">· {p.comprobantes}</span></span>
                    <span className="importe font-semibold text-marca-hondo">{pesos(p.total)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Bloque>
      </div>

      {/* quién compró */}
      <Bloque
        className="lg:col-span-7"
        titulo="Los que más compraron"
        bajada={`${t.clientes.length} de ${t.clientesTotal} clientes · lo que debe cada uno es el saldo de hoy`}
      >
        {t.clientes.length ? (
          <ol className="divide-y divide-black/[0.06]">
            {t.clientes.map((c, i) => {
              const wa = linkWhatsapp(c.telefono);
              return (
                <li key={c.id} className="flex items-center gap-3 py-2">
                  <span className="importe w-5 shrink-0 text-right text-xs text-tinta/60">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-3">
                      <Link href={`/facturacion/cuentas/${c.id}`} className={unir('min-w-0 truncate text-sm font-semibold text-tinta underline-offset-2 hover:underline', FOCO)}>{c.nombre}</Link>
                      <span className="importe shrink-0 text-sm font-semibold text-tinta">{pesos(c.total)}</span>
                    </div>
                    <div className="mt-1 flex items-center gap-3">
                      <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-tinta/[0.06]">
                        <span className="block h-full rounded-full bg-tinta/70" style={{ width: `${Math.max(2, (c.total / t.clientes[0].total) * 100)}%` }} />
                      </span>
                      <span className="shrink-0 text-xs text-tinta/60">{c.comprobantes} comp.</span>
                      <span className={unir('importe w-32 shrink-0 text-right text-xs', c.saldo && c.saldo > 0 ? 'font-semibold text-marca-hondo' : 'text-tinta/60')}>
                        {c.saldo && c.saldo > 0 ? `debe ${pesos(c.saldo)}` : c.saldo && c.saldo < 0 ? `a favor ${pesos(-c.saldo)}` : 'al día'}
                      </span>
                      {wa ? (
                        <a href={wa} target="_blank" rel="noreferrer" title={`WhatsApp a ${telefonoLegible(c.telefono) ?? ''}`} aria-label={`WhatsApp a ${c.nombre}`} className={unir('flex size-7 shrink-0 items-center justify-center rounded-full text-ok hover:bg-ok-suave', FOCO)}>
                          <IconoWhatsapp />
                        </a>
                      ) : <span className="size-7 shrink-0" />}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="py-6 text-center text-sm text-tinta/60">Nadie compró con ficha este mes.</p>
        )}
      </Bloque>

      {/* lo que se debe */}
      <PorCobrar t={t} className="lg:col-span-5" />

      {/* lo último */}
      <Bloque
        className="lg:col-span-12"
        titulo="Últimos comprobantes"
        accion={<Boton tamano="chico" variante="secundario" onClick={() => onComprobantes({})}>Ver los {t.comprobantes.length}</Boton>}
      >
        <TablaComprobantes filas={t.comprobantes.slice(0, 10)} onAbrir={onAbrir} sinMarco />
      </Bloque>
    </div>
  );
}

function Frescura({ t, sucursal }: { t: Tablero; sucursal: string }) {
  const partes = (['st', 'si'] as Sucursal[])
    .filter((s) => sucursal === 'todas' || sucursal === s)
    .map((s) => (t.frescura[s] ? `${NOMBRE_SUC[s]} hasta el ${diaCorto(t.frescura[s]!)}` : `${NOMBRE_SUC[s]} sin datos`));
  return (
    <p className="mt-2 text-xs text-tinta/60">
      Ventas con cliente identificado (cuentas corrientes y fichas) del sistema anterior: {partes.join(' · ')}. Lo emitido en este sistema se suma en el momento. El mostrador a consumidor final no se cuenta acá.
    </p>
  );
}

function Barras({ partidas, total, onElegir }: { partidas: Partida[]; total: number; onElegir: (p: Partida) => void }) {
  if (!partidas.length) return <p className="py-4 text-center text-sm text-tinta/60">Sin comprobantes.</p>;
  const max = Math.max(...partidas.map((p) => p.total), 1);
  return (
    <ul className="space-y-1">
      {partidas.map((p) => (
        <li key={p.clave}>
          <button type="button" onClick={() => onElegir(p)} className={unir('block w-full rounded-lg px-1 py-1.5 text-left transition-colors hover:bg-crema-claro', FOCO)}>
            <span className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate text-tinta">{p.etiqueta} <span className="text-xs text-tinta/60">· {p.comprobantes}</span></span>
              <span className="shrink-0">
                <span className="importe font-semibold text-tinta">{pesos(p.total)}</span>
                <span className="importe ml-2 inline-block w-9 text-right text-xs text-tinta/60">{porcentaje(p.total, total)} %</span>
              </span>
            </span>
            <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-tinta/[0.06]">
              <span className="block h-full rounded-full bg-tinta/75" style={{ width: `${Math.max(1.5, (Math.max(0, p.total) / max) * 100)}%` }} />
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

// la antigüedad de la deuda: un rojo que se oscurece con los días
const COLOR_TRAMO: Record<string, string> = { '0-30': 'bg-marca/25', '31-60': 'bg-marca/50', '61-90': 'bg-marca/75', '90+': 'bg-marca-hondo', sin: 'bg-tinta/15' };

function PorCobrar({ t, className }: { t: Tablero; className?: string }) {
  const tramos = t.cobrar.tramos.filter((x) => x.cuentas > 0);
  return (
    <Bloque
      className={className}
      titulo="Por cobrar"
      bajada={<>Desde la factura impaga más vieja de cada cuenta{t.cobrar.diasPromedio != null && <> · <b className="font-semibold text-tinta">{t.cobrar.diasPromedio} días</b> de deuda promedio</>}</>}
      accion={<BotonLink href="/cuentas-corrientes" tamano="chico" variante="secundario">Las {t.cobrar.cuentas} cuentas</BotonLink>}
    >
      <p className="importe text-2xl font-bold tracking-tight text-marca-hondo">{pesos(t.cobrar.total)}</p>
      {/* barra partida por antigüedad, con 2 px de aire entre tramos */}
      <div className="mt-3 flex h-3 w-full gap-0.5 overflow-hidden rounded-full" role="img" aria-label="Lo que se debe, por antigüedad">
        {tramos.map((x) => (
          <span key={x.clave} className={unir('h-full first:rounded-l-full last:rounded-r-full', COLOR_TRAMO[x.clave])} style={{ width: `${(x.total / Math.max(1, t.cobrar.total)) * 100}%` }} title={`${x.etiqueta}: ${pesos(x.total)}`} />
        ))}
      </div>
      <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
        {t.cobrar.tramos.map((x) => (
          <li key={x.clave} className="min-w-0">
            <p className="flex items-center gap-1.5 text-xs text-tinta/70"><span className={unir('size-2.5 shrink-0 rounded-sm', COLOR_TRAMO[x.clave])} />{x.etiqueta}</p>
            <p className="importe text-sm font-semibold text-tinta">{pesos(x.total)}</p>
            <p className="text-xs text-tinta/60">{x.cuentas} {x.cuentas === 1 ? 'cuenta' : 'cuentas'} · {porcentaje(x.total, t.cobrar.total)} %</p>
          </li>
        ))}
      </ul>
      <h4 className={unir(ROTULO, 'mt-4 mb-1')}>Los que más deben</h4>
      <ol className="divide-y divide-black/[0.06]">
        {t.cobrar.deudores.slice(0, 7).map((d) => {
          const wa = linkWhatsapp(d.telefono);
          const usoLimite = d.limite && d.limite > 0 ? Math.round((d.saldo / d.limite) * 100) : null;
          return (
            <li key={d.id} className="flex items-center gap-2 py-1.5">
              <Link href={`/facturacion/cuentas/${d.id}`} className={unir('min-w-0 flex-1 truncate text-sm text-tinta underline-offset-2 hover:underline', FOCO)}>{d.nombre}</Link>
              {d.dias != null && <span className={unir('shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold', d.dias > 60 ? 'bg-marca text-white' : d.dias > 30 ? 'bg-marca-suave text-marca-hondo' : 'bg-tinta/[0.06] text-tinta/70')}>{d.dias} días</span>}
              {usoLimite != null && usoLimite > 100 && <span className="shrink-0 text-xs font-semibold text-marca-hondo" title={`Límite ${pesos(d.limite)}`}>pasó el límite</span>}
              <span className="importe w-28 shrink-0 text-right text-sm font-semibold text-tinta">{pesos(d.saldo)}</span>
              {wa ? (
                <a href={wa} target="_blank" rel="noreferrer" aria-label={`WhatsApp a ${d.nombre}`} title={`WhatsApp a ${telefonoLegible(d.telefono) ?? ''}`} className={unir('flex size-7 shrink-0 items-center justify-center rounded-full text-ok hover:bg-ok-suave', FOCO)}>
                  <IconoWhatsapp />
                </a>
              ) : <span className="size-7 shrink-0" title="Sin celular cargado" />}
            </li>
          );
        })}
      </ol>
    </Bloque>
  );
}

function EsqueletoResumen() {
  return (
    <div className="grid gap-4 lg:grid-cols-12" aria-busy="true" aria-label="Sumando la facturación">
      <div className="h-80 animate-pulse rounded-2xl bg-white/70 lg:col-span-8" />
      <div className="h-80 animate-pulse rounded-2xl bg-white/70 lg:col-span-4" />
      <div className="h-96 animate-pulse rounded-2xl bg-white/70 lg:col-span-7" />
      <div className="h-96 animate-pulse rounded-2xl bg-white/70 lg:col-span-5" />
    </div>
  );
}

// ─── la lista de comprobantes ─────────────────────────────────────────────

function TablaComprobantes({ filas, onAbrir, sinMarco, pie }: { filas: Comp[]; onAbrir: (c: Comp) => void; sinMarco?: boolean; pie?: React.ReactNode }) {
  return (
    <TablaResponsiva
      etiqueta="Comprobantes"
      filas={filas}
      claveFila="id"
      sinMarco={sinMarco}
      pie={pie}
      vacio={<Vacio titulo="No hay comprobantes con estos filtros" texto="Probá con otro tipo, otro medio de pago o borrá la búsqueda." />}
      columnas={[
        { clave: 'fecha', titulo: 'Fecha', claseCelda: 'whitespace-nowrap', celda: (c) => <span className="text-tinta/70">{diaCorto(c.fecha)}</span> },
        {
          clave: 'comprobante',
          titulo: 'Comprobante',
          principal: true,
          celda: (c) => (
            <button type="button" onClick={() => onAbrir(c)} className={unir('inline-flex flex-wrap items-center gap-2 rounded-lg text-left', FOCO, c.anulado && 'opacity-60')}>
              <Etiqueta tono={TONO_CLASE[c.clase]}>{c.tipo}</Etiqueta>
              <span className="importe text-xs font-semibold text-tinta underline-offset-2 hover:underline">{c.numero}</span>
              {c.anulado && <Etiqueta tono="error">Anulado</Etiqueta>}
            </button>
          ),
        },
        {
          clave: 'cliente',
          titulo: 'Cliente',
          celda: (c) => c.clienteId
            ? <Link href={`/facturacion/cuentas/${c.clienteId}`} className={unir('break-words text-tinta underline-offset-2 hover:underline', FOCO)}>{c.cliente}</Link>
            : <span className="text-tinta/70">{c.cliente}</span>,
        },
        { clave: 'medio', titulo: 'Cómo pagó', ocultarEnMovil: true, celda: (c) => <span className="text-tinta/70">{c.medio}</span> },
        {
          clave: 'sucursal',
          titulo: 'Sucursal',
          ocultarEnMovil: true,
          celda: (c) => c.sucursal
            ? <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-tinta/70"><span className={unir('size-2 rounded-full', c.sucursal === 'st' ? 'bg-dato-1' : 'bg-dato-2')} />{NOMBRE_SUC[c.sucursal]}</span>
            : <span className="text-tinta/40">—</span>,
        },
        { clave: 'origen', titulo: 'Sistema', ocultarEnMovil: true, celda: (c) => <span className="text-xs text-tinta/60">{c.origen === 'crack' ? 'Anterior' : c.cae ? 'Este · con CAE' : 'Este'}</span> },
        { clave: 'total', titulo: 'Total', importe: true, celda: (c) => <span className={unir('importe font-semibold', c.total < 0 ? 'text-marca-hondo' : 'text-tinta', c.anulado && 'line-through opacity-60')}>{pesos(c.total)}</span> },
      ]}
    />
  );
}

function ListaComprobantes({
  t, mes, filtros, cambiar, onAbrir,
}: {
  t: Tablero | null;
  mes: string;
  filtros: { clase: string; medio: string; tipo: string; dia: string | null; buscar: string };
  cambiar: { setClase: (v: string) => void; setMedio: (v: string) => void; setTipo: (v: string) => void; setDia: (v: string | null) => void; setBuscar: (v: string) => void };
  onAbrir: (c: Comp) => void;
}) {
  const [cuantos, setCuantos] = useState(60);
  useEffect(() => { setCuantos(60); }, [filtros.clase, filtros.medio, filtros.tipo, filtros.dia, filtros.buscar, mes]);
  const lista = useMemo(() => {
    if (!t) return [];
    const q = filtros.buscar.trim().toLowerCase();
    return t.comprobantes.filter((c) => {
      if (filtros.clase !== 'todos') {
        if (filtros.clase === 'otros') { if (!['remito', 'recibo', 'interno'].includes(c.clase)) return false; } else if (c.clase !== filtros.clase) return false;
      }
      if (filtros.medio !== 'todos' && c.medio !== filtros.medio) return false;
      if (filtros.tipo !== 'todos' && c.tipo !== filtros.tipo) return false;
      if (filtros.dia && c.fecha !== filtros.dia) return false;
      if (q && !c.cliente.toLowerCase().includes(q) && !c.numero.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [t, filtros]);
  if (!t) return <div className="h-96 animate-pulse rounded-2xl bg-white/70" aria-busy="true" />;

  const medios = [...new Set(t.comprobantes.map((c) => c.medio))].sort();
  const tipos = [...new Set(t.comprobantes.map((c) => c.tipo))].sort();
  const total = lista.filter((c) => !c.anulado && ['factura', 'nd', 'nc'].includes(c.clase)).reduce((s, c) => s + c.total, 0);
  const hayFiltro = filtros.clase !== 'todos' || filtros.medio !== 'todos' || filtros.tipo !== 'todos' || !!filtros.dia || !!filtros.buscar;

  const exportar = () => {
    const filas = [['Fecha', 'Tipo', 'Número', 'Cliente', 'Cómo pagó', 'Sucursal', 'Sistema', 'Total']];
    for (const c of lista) {
      filas.push([c.fecha, c.tipo, c.numero, c.cliente, c.medio, c.sucursal ? NOMBRE_SUC[c.sucursal] : '', c.origen === 'crack' ? 'Anterior' : 'Este', String(c.total).replace('.', ',')]);
    }
    const csv = filas.map((f) => f.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(';')).join('\r\n');
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `comprobantes-${mes}${filtros.dia ? `-${filtros.dia.slice(8)}` : ''}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Chips etiquetaAccesible="Tipo de comprobante" valor={filtros.clase} onCambiar={(v) => { cambiar.setClase(v); cambiar.setTipo('todos'); }} opciones={CLASES_FILTRO} desplazable className="min-w-0 max-w-full" />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-full sm:w-72">
          <Entrada type="search" value={filtros.buscar} onChange={(e) => cambiar.setBuscar(e.target.value)} placeholder="Buscar cliente o número" aria-label="Buscar cliente o número" />
        </div>
        <div className="w-[calc(50%-0.25rem)] sm:w-48">
          <Selector value={filtros.medio} onChange={(e) => cambiar.setMedio(e.target.value)} aria-label="Cómo pagó">
            <option value="todos">Todos los medios</option>
            {medios.map((m) => <option key={m} value={m}>{m}</option>)}
          </Selector>
        </div>
        <div className="w-[calc(50%-0.25rem)] sm:w-48">
          <Selector value={filtros.tipo} onChange={(e) => cambiar.setTipo(e.target.value)} aria-label="Tipo exacto">
            <option value="todos">Todas las letras</option>
            {tipos.map((m) => <option key={m} value={m}>{m}</option>)}
          </Selector>
        </div>
        {filtros.dia && (
          <button type="button" onClick={() => cambiar.setDia(null)} className={unir('inline-flex min-h-9 items-center gap-1.5 rounded-full bg-tinta px-3 text-sm font-semibold text-white', FOCO)}>
            {diaCorto(filtros.dia)}
            <IconoCerrar className="size-4" />
            <span className="sr-only">Sacar el filtro del día</span>
          </button>
        )}
        {hayFiltro && (
          <button type="button" onClick={() => { cambiar.setClase('todos'); cambiar.setMedio('todos'); cambiar.setTipo('todos'); cambiar.setDia(null); cambiar.setBuscar(''); }} className={unir('min-h-9 rounded-full px-3 text-sm font-semibold text-marca-hondo hover:bg-marca-suave', FOCO)}>
            Borrar filtros
          </button>
        )}
        <div className="flex w-full items-center gap-3 sm:ml-auto sm:w-auto">
          <p className="text-sm text-tinta/70">
            <b className="importe font-semibold text-tinta">{lista.length.toLocaleString('es-AR')}</b> {lista.length === 1 ? 'comprobante' : 'comprobantes'} · <b className="importe font-semibold text-tinta">{pesos(total)}</b>
          </p>
          <Boton tamano="chico" variante="secundario" onClick={exportar} disabled={!lista.length} className="ml-auto sm:ml-0">Exportar</Boton>
        </div>
      </div>
      <TablaComprobantes
        filas={lista.slice(0, cuantos)}
        onAbrir={onAbrir}
        pie={lista.length > cuantos ? (
          <div className="flex justify-center p-3">
            <Boton tamano="chico" variante="secundario" onClick={() => setCuantos((n) => n + 100)}>Ver {Math.min(100, lista.length - cuantos)} más (quedan {lista.length - cuantos})</Boton>
          </div>
        ) : undefined}
      />
    </div>
  );
}

// ─── el comprobante abierto: qué se llevó ─────────────────────────────────

function DetalleComprobante({ c, onCerrar }: { c: Comp; onCerrar: () => void }) {
  const [renglones, setRenglones] = useState<{ codigo: string; productoId: string | null; nombre: string; cantidad: number; precio: number; subtotal: number }[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (c.origen !== 'crack') return;
    const [, suc, ticket, fecha, cliente] = c.id.split('|');
    const qs = new URLSearchParams({ sucursal: suc, ticket, fecha, cliente });
    fetch(`/api/facturacion/ticket?${qs}`, { cache: 'no-store' })
      .then(async (r) => { const d = await r.json().catch(() => null); if (!r.ok || !Array.isArray(d)) throw new Error(d?.message ?? 'No pude traer el detalle'); setRenglones(d); })
      .catch((e) => setError(e.message));
  }, [c]);

  return (
    <Modal
      abierto
      onCerrar={onCerrar}
      ancho="ancho"
      titulo={`${c.tipo} ${c.numero}`}
      descripcion={`${c.cliente} · ${diaCorto(c.fecha)} · ${c.sucursal ? NOMBRE_SUC[c.sucursal] : 'Sin sucursal'} · ${c.medio}`}
      pie={
        <>
          {c.clienteId && <BotonLink href={`/facturacion/cuentas/${c.clienteId}`} variante="secundario">Ver la cuenta del cliente</BotonLink>}
          {c.origen === 'nucleo' && <BotonLink href={`/facturacion/${c.id}`}>Abrir el comprobante</BotonLink>}
          <Boton variante="secundario" onClick={onCerrar}>Cerrar</Boton>
        </>
      }
    >
      {c.origen === 'nucleo' ? (
        <p className="text-sm text-tinta/70">Emitido en este sistema{c.cae ? ` con CAE ${c.cae}` : ', sin CAE'}. Total <b className="importe font-semibold text-tinta">{pesos(c.total)}</b>. Abrilo para ver los renglones, imprimirlo o anularlo.</p>
      ) : error ? (
        <p className="rounded-xl bg-marca-suave p-3 text-sm text-marca-hondo">{error}</p>
      ) : !renglones ? (
        <p className="py-8 text-center text-sm text-tinta/60">Buscando lo que se llevó…</p>
      ) : (
        <TablaResponsiva
          etiqueta="Lo que se llevó"
          sinMarco
          filas={renglones}
          claveFila={(_, i) => i}
          columnas={[
            {
              clave: 'producto',
              titulo: 'Producto',
              principal: true,
              celda: (r) => r.productoId
                ? <Link href={`/inventario?producto=${r.productoId}`} className={unir('break-words text-tinta underline-offset-2 hover:underline', FOCO)}>{r.nombre}</Link>
                : <span className="text-tinta/70">{r.nombre}</span>,
            },
            { clave: 'cantidad', titulo: 'Cantidad', alinear: 'derecha', celda: (r) => <span className="importe">{r.cantidad.toLocaleString('es-AR', { maximumFractionDigits: 3 })}</span> },
            { clave: 'precio', titulo: 'Precio', importe: true, celda: (r) => pesos(r.precio) },
            { clave: 'subtotal', titulo: 'Subtotal', importe: true, celda: (r) => <span className="font-semibold">{pesos(r.subtotal)}</span> },
          ]}
          pie={
            <div className="flex justify-between gap-3 border-t border-black/[0.08] px-4 py-3 text-sm">
              <span className="text-tinta/70">{renglones.length} {renglones.length === 1 ? 'renglón' : 'renglones'}</span>
              <span>Total <b className="importe text-base font-bold text-tinta">{pesos(c.total)}</b></span>
            </div>
          }
        />
      )}
    </Modal>
  );
}

function IconoWhatsapp() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3.5 20.5l1.3-4A8.5 8.5 0 1 1 8 19.6z" />
      <path d="M9 8.5c.2 2.8 3.3 6 6.5 6.4l1-1.3-2-1-1 .8c-1-.4-2.4-1.8-2.8-2.8l.8-1-1-2z" />
    </svg>
  );
}
