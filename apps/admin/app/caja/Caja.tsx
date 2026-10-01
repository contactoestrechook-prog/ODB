'use client';

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { ResumenCierre } from '../ui/ResumenCierre';
import { Aviso, BarraInferior, Boton, BotonLink, Entrada, IconoCerrar, IconoOk, Modal, Selector, unir, useConfirmar, FOCO, ROTULO } from '../ui/kit';
import { hora, pesos } from '../lib/formato';
import MiTurno from './MiTurno';

type Producto = {
  imagenUrl: string | null;
  sku: string;
  nombre: string;
  precio: number | null;
  precioMayorista?: number | null;
  precioLista: number | null;
  descuento: string | null;
  esAlcohol: boolean;
  codigosBarras: string[];
  codigo?: string | null; // código interno de ODB (lo que se escanea / imprime en la etiqueta)
  stock?: number | null; // stock en la sucursal de la caja (null = desconocido, <= 0 = sin stock)
  activo?: boolean; // false = dado de baja (se reconoce por código, no se vende)
  sinStockDesde?: string | null; // fecha del último egreso en la sucursal, si hoy no hay
  porPeso?: boolean; // se vende por kilo: la balanza manda gramos y el precio es $/kg
  plu?: string | null; // PLU de la balanza interna
  deBalanza?: boolean; // vino de una etiqueta de balanza
  cantidadBalanza?: number; // kilos o unidades que dice la etiqueta
};

type Renglon = Producto & { cantidad: number };

type Cliente = {
  existe: boolean;
  dni: string;
  nombre?: string;
  razonSocial?: string | null;
  cuit?: string | null;
  tipo?: string;
  compras?: number;
  ticketPromedio?: number;
  // cuenta corriente: saldo > 0 = el cliente DEBE
  ctaCte?: { habilitada: boolean; saldo: number; limite: number; disponible: number | null };
  // perfil de compra: aparece recién con 3 compras
  perfil?: {
    compras: number; gastado: number; ticketPromedio: number;
    cadaCuantosDias: number | null; diasDesdeUltima: number | null;
    rubros: { rubro: string; pct: number }[];
    habituales: { sku: string; nombre: string; veces: number }[];
  } | null;
  faltanParaPerfil?: number;
};

type Pago = { medio: string; monto: number; terminal?: string };

type SesionCaja = { sesionId: string; cajaId: string; cajaNombre: string; abiertaEn?: string };

type CajaInfo = {
  id: string;
  nombre: string;
  sucursal?: { id: string; nombre: string } | null;
  sesionAbierta?: { id: string; monto_inicial: number; abierta_en: string; usuario?: { nombre: string } } | null;
};

type TicketData = {
  numero?: string; // "FB 0001-00001234" (si hay comprobante emitido)
  etiqueta: string; // "Factura B" | "Remito" | "Ticket"
  fecha: string;
  items: { cantidad: number; nombre: string; precioUnitario: number; total: number }[];
  total: number;
  descuento: number;
  pagos: Pago[];
  vuelto: number | null;
  dni?: string;
  offline?: boolean;
};

type Estacionado = {
  id: string;
  etiqueta: string;
  carrito: Renglon[];
  dni: string;
  comprobante: TipoComprobante;
  ts: number;
};

type VentaPendiente = { ventaId: string; body: any; ticket: TicketData; ts: number };

const norm = (s: string) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

const MEDIOS = [
  { id: 'efectivo', label: 'Efectivo' },
  { id: 'mercadopago', label: 'MP QR' },
  { id: 'tarjeta', label: 'Tarjeta' },
  { id: 'cta_cte', label: 'Cta. cte.' },
];
const MEDIO_LABEL: Record<string, string> = Object.fromEntries(MEDIOS.map((m) => [m.id, m.label]));

// Lo PRIMERO que define el cajero: qué comprobante emite (pedido del dueño).
// 1 sola razón social por local → NO hay selector de emisor.
const COMPROBANTES = [
  { id: 'B', label: 'B', desc: 'Consumidor final' },
  { id: 'A', label: 'A', desc: 'Resp. inscripto' },
  { id: 'R', label: 'R', desc: 'Remito' },
] as const;
type TipoComprobante = (typeof COMPROBANTES)[number]['id'];

const ETIQUETA_COMP: Record<TipoComprobante, string> = { A: 'Factura A', B: 'Factura B', R: 'Remito' };

const TERMINAL_LABEL: Record<string, string> = { getnet: 'Getnet', clover: 'Clover' };

const NOTA_MEDIO: Record<string, string> = {
  mercadopago: 'Al cobrar, el importe se manda al QR de la caja y la venta se registra cuando MP confirma el pago',
  tarjeta: 'Cobrá en el posnet',
  cta_cte: 'Se carga a la cuenta corriente del cliente',
};

// ---- persistencia local (la caja tiene que sobrevivir a un F5 y a un corte de internet) ----
const LS = {
  sesion: 'odb_caja_sesion',
  carrito: 'odb_caja_carrito',
  estacionados: 'odb_caja_estacionados',
  cola: 'odb_caja_cola',
  autoprint: 'odb_caja_autoprint',
};
const leerLS = <T,>(k: string, def: T): T => {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : def;
  } catch {
    return def;
  }
};
const escribirLS = (k: string, v: unknown) => {
  try {
    if (v == null || (Array.isArray(v) && v.length === 0)) localStorage.removeItem(k);
    else localStorage.setItem(k, JSON.stringify(v));
  } catch {}
};

const fmtNumero = (c: { tipo: string; punto_venta: number; numero: number }) =>
  `${c.tipo} ${String(c.punto_venta).padStart(4, '0')}-${String(c.numero).padStart(8, '0')}`;

// ---- presentación: ¿la pantalla es de escritorio (lg, 1024 px)? ----
// En el celular y la tableta, Cobrar va en la barra fija de abajo
// (<BarraInferior>); en escritorio queda el botón grande al pie de la columna
// derecha. La barra se monta solo en pantallas chicas: si no, escondería el
// botón "Esto está mal" también en la caja de escritorio.
const CONSULTA_ANCHA = '(min-width: 1024px)';
const suscribirAncho = (avisar: () => void) => {
  const m = window.matchMedia(CONSULTA_ANCHA);
  m.addEventListener('change', avisar);
  return () => m.removeEventListener('change', avisar);
};
const leerAncho = () => window.matchMedia(CONSULTA_ANCHA).matches;
const anchoEnServidor = () => false;

// Íconos de línea de la cabecera de la caja (en el celular van solos, sin texto)
function IconoCaja({ d, className = 'size-5' }: { d: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={d} />
    </svg>
  );
}
const ICONO = {
  imprimir: 'M7 9V4h10v5M7 17H5a2 2 0 01-2-2v-4a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2h-2M7 14h10v6H7z',
  efectivo: 'M3 7h18v10H3zM12 9.5a2.5 2.5 0 110 5 2.5 2.5 0 010-5zM6.5 10v4M17.5 10v4',
  turno: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
  stock: 'M3 7.5l9-4.5 9 4.5v9l-9 4.5-9-4.5zM3 7.5l9 4.5 9-4.5M12 12v9',
  devolucion: 'M9 14l-5-5 5-5M4 9h11a5 5 0 010 10h-3',
  candado: 'M7 11V7a5 5 0 0110 0v4M6 11h12v9H6z',
  panel: 'M3 11l9-7 9 7M5.5 9.5V20h13V9.5',
  pausa: 'M9 6v12M15 6v12',
};

// Botón de la cabecera negra (sobre oscuro: foco blanco hacia adentro, que no
// lo corta el scroll de la fila)
const BOTON_CABECERA =
  'inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-xl px-3 text-sm transition-colors hover:bg-white/20 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/70 sm:min-h-10';

export function Caja({ sucursales }: { sucursales: { id: string; nombre: string; terminales_tarjeta?: string[] }[] }) {
  const [sucursalId, setSucursalId] = useState(sucursales[0]?.id ?? '');
  // confirmaciones con el diseño del panel (en lugar de confirm/prompt)
  const { confirmar, pedirTexto, dialogo } = useConfirmar();
  const pantallaAncha = useSyncExternalStore(suscribirAncho, leerAncho, anchoEnServidor);
  const sucursalNombre = sucursales.find((s) => s.id === sucursalId)?.nombre ?? 'esta sucursal';
  const fechaCorta = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' }) : '');
  const haceDias = (iso?: string | null) => { if (!iso) return ''; const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000); return d <= 0 ? 'hoy' : d === 1 ? 'ayer' : `hace ${d} días`; };
  const textoSinStock = (p: Producto) => `sin stock en ${sucursalNombre}${p.sinStockDesde ? ` · se terminó el ${fechaCorta(p.sinStockDesde)} (${haceDias(p.sinStockDesde)})` : ''}`;
  // Sant Thomas tiene DOS posnet (Getnet y Clover): la tarjeta se elige por terminal
  const [terminal, setTerminal] = useState<string | undefined>(undefined);
  const terminales = sucursales.find((s) => s.id === sucursalId)?.terminales_tarjeta ?? [];
  const medios = useMemo(
    () =>
      MEDIOS.flatMap((m) => {
        if (m.id !== 'tarjeta') return [{ ...m, terminal: undefined as string | undefined }];
        if (terminales.length <= 1) return [{ ...m, terminal: terminales[0] }];
        return terminales.map((t) => ({ id: 'tarjeta', label: `Tarjeta ${TERMINAL_LABEL[t] ?? t}`, terminal: t }));
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sucursalId],
  );
  const [comprobante, setComprobante] = useState<TipoComprobante>('B');
  const [busqueda, setBusqueda] = useState('');
  // '6*' (o '6x') antes de escanear: el próximo producto entra con esa cantidad
  const [multiplicador, setMultiplicador] = useState<number | null>(null);
  // código escaneado que el sistema no conoce: se busca el producto por nombre y se vincula
  const [codigoPendiente, setCodigoPendiente] = useState<string | null>(null);
  // "C" + cantidad + Enter: la cantidad va al ÚLTIMO producto escaneado (o al próximo si no hay)
  const [ultimoSku, setUltimoSku] = useState<string | null>(null);
  const modoCantidad = /^[cC]\d{0,3}$/.test(busqueda.trim());
  const cantidadTecleada = modoCantidad && busqueda.trim().length > 1 ? Number(busqueda.trim().slice(1)) : null;
  const [resultados, setResultados] = useState<Producto[]>([]);
  const [carrito, setCarrito] = useState<Renglon[]>([]);
  const [dni, setDni] = useState('');
  const [sinDni, setSinDni] = useState(false); // el cliente no quiso darlo: no se vuelve a preguntar en esta venta
  // alta del WhatsApp del cliente: sin teléfono y sin permiso no hay a quién
  // difundir, y este es el único momento en que la persona está enfrente
  const [waTel, setWaTel] = useState('');
  const [waGuardando, setWaGuardando] = useState(false);
  // pago a cuenta: el cajero lo TOMA pero no lo aplica; queda pendiente de que
  // el dueño lo apruebe en "Cobros a ingresar"
  const [cobro, setCobro] = useState<null | { monto: string; medio: string; nota: string; mandando: boolean; listo: boolean; error: string }>(null);
  const [waHecho, setWaHecho] = useState<'alta' | 'baja' | null>(null);
  const [clientes, setClientes] = useState<{ dni: string; nombre: string }[]>([]); // autocompletar por nombre
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [receptorCuit, setReceptorCuit] = useState('');
  const [receptorNombre, setReceptorNombre] = useState('');
  const [medio, setMedio] = useState('efectivo');
  const [mayorista, setMayorista] = useState(false); // venta a precio mayorista
  // "Mi turno": la cajera ve lo que lleva vendido sin salir de la caja (F7)
  const [verTurno, setVerTurno] = useState(false);
  const [pagos, setPagos] = useState<Pago[]>([]); // vacío = "todo con `medio`" (camino rápido)
  const [dividido, setDividido] = useState(false);
  const [estado, setEstado] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null);
  const [cobrando, setCobrando] = useState(false);
  const [pagaCon, setPagaCon] = useState('');
  const [buscando, setBuscando] = useState(false);
  const [catalogoLocal, setCatalogoLocal] = useState<any[]>([]);
  // teclado numérico: qué edita ('linea' cantidad, 'pago' monto, o pagaCon)
  const [foco, setFoco] = useState<{ tipo: 'linea'; sku: string } | { tipo: 'pago'; idx: number } | null>(null);
  const [cantBuf, setCantBuf] = useState('');
  const [hidratado, setHidratado] = useState(false);

  // sesión de caja (línea de caja = caja física con su sesión y arqueo)
  const [sesion, setSesion] = useState<SesionCaja | null>(null);
  const [cajas, setCajas] = useState<CajaInfo[]>([]);
  const [modalCaja, setModalCaja] = useState<'abrir' | 'cerrar' | null>(null);
  const [montoBuf, setMontoBuf] = useState('');
  const [sesionCerradaId, setSesionCerradaId] = useState<string | null>(null); // para la planilla final
  const [cajaElegida, setCajaElegida] = useState('');
  const [cerrando, setCerrando] = useState(false);
  const [arqueo, setArqueo] = useState<{ esperado: number; contado: number; diferencia: number } | null>(null);

  // descuento autorizado, movimientos de efectivo y devoluciones
  const [descuento, setDescuento] = useState<{ monto: number; autorizacionToken: string; nombre: string } | null>(null);
  const [modalExtra, setModalExtra] = useState<'descuento' | 'movimiento' | 'devolucion' | null>(null);
  const [pinBuf, setPinBuf] = useState('');
  const [descBuf, setDescBuf] = useState('');
  const [movTipo, setMovTipo] = useState<'ingreso' | 'egreso'>('egreso');
  const [movMonto, setMovMonto] = useState('');
  const [movMotivo, setMovMotivo] = useState('');
  const [devVentas, setDevVentas] = useState<any[]>([]);
  const [devVenta, setDevVenta] = useState<any | null>(null);
  const [devolver, setDevolver] = useState<Record<string, number>>({});
  // devolución pedida a distancia (sin supervisor en el local): se sigue hasta que la aprueban o rechazan
  type DevPedido = { id: string; monto: number; estado: 'pendiente' | 'aprobada' | 'rechazada' | 'error'; respuesta?: string | null; resueltaPor?: string | null; resultado?: any; error?: string | null; avisados?: string[] };
  const [devPedido, setDevPedido] = useState<DevPedido | null>(null);
  const [devEfectivo, setDevEfectivo] = useState(true);
  const [procesando, setProcesando] = useState(false);

  // tickets estacionados + cola offline + impresión
  const [estacionados, setEstacionados] = useState<Estacionado[]>([]);
  const [cola, setCola] = useState<VentaPendiente[]>([]);
  const [ticket, setTicket] = useState<TicketData | null>(null); // lo que se imprime
  const [autoPrint, setAutoPrint] = useState(true);
  const [ultima, setUltima] = useState<{ ventaId: string; ticket: TicketData } | null>(null);
  const [sinRed, setSinRed] = useState(false);

  // consulta de stock por sucursal (ambas sucursales, para responderle al cliente)
  const [modalStock, setModalStock] = useState(false);
  const [stockQ, setStockQ] = useState('');
  const [stockRes, setStockRes] = useState<{ sku: string; nombre: string; total: number; sucursales: { sucursal: string; cantidad: number }[] }[]>([]);
  const [stockBuscando, setStockBuscando] = useState(false);
  const stockDebRef = useRef<any>(null);
  const stockInputRef = useRef<HTMLInputElement>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const dniRef = useRef<HTMLInputElement>(null);
  const debRef = useRef<any>(null);
  const debCliRef = useRef<any>(null);
  const seqRef = useRef(0);
  const cobrarRef = useRef<() => void>(() => {});
  const imprimirRef = useRef<TicketData | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, [carrito.length]);

  // ---- hidratación: carrito, estacionados, cola y preferencias sobreviven al F5 ----
  useEffect(() => {
    setCarrito(leerLS<Renglon[]>(LS.carrito, []));
    setEstacionados(leerLS<Estacionado[]>(LS.estacionados, []));
    setCola(leerLS<VentaPendiente[]>(LS.cola, []));
    setAutoPrint(leerLS<boolean>(LS.autoprint, true));
    setSesion(leerLS<SesionCaja | null>(LS.sesion, null));
    setHidratado(true);
  }, []);
  useEffect(() => { if (hidratado) escribirLS(LS.carrito, carrito); }, [carrito, hidratado]);
  useEffect(() => { if (hidratado) escribirLS(LS.estacionados, estacionados); }, [estacionados, hidratado]);
  useEffect(() => { if (hidratado) escribirLS(LS.cola, cola); }, [cola, hidratado]);
  useEffect(() => { if (hidratado) escribirLS(LS.autoprint, autoPrint); }, [autoPrint, hidratado]);
  useEffect(() => { if (hidratado) escribirLS(LS.sesion, sesion); }, [sesion, hidratado]);

  // ---- sesión de caja: valida la guardada contra el servidor / pide apertura ----
  async function cargarCajas() {
    try {
      const r = await fetch('/api/caja?recurso=cajas');
      if (!r.ok) return;
      const data: CajaInfo[] = await r.json();
      setCajas(data);
      const guardada = leerLS<SesionCaja | null>(LS.sesion, null);
      if (guardada) {
        // ¿la sesión guardada sigue abierta en el servidor?
        const caja = data.find((c) => c.id === guardada.cajaId);
        if (caja?.sesionAbierta?.id === guardada.sesionId) return; // vigente
        setSesion(null); // la cerraron desde otro lado
      }
      if (!leerLS<SesionCaja | null>(LS.sesion, null)) setModalCaja('abrir');
      if (data[0]) setCajaElegida((prev) => prev || data[0].id);
    } catch {
      // sin red: se puede vender igual (cola offline); la sesión guardada vale
    }
  }
  useEffect(() => {
    if (hidratado) cargarCajas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hidratado]);

  async function abrirCaja() {
    const caja = cajas.find((c) => c.id === cajaElegida);
    if (!caja) return;
    // si la caja ya tiene una sesión abierta (p.ej. la abrió el turno anterior), se retoma
    if (caja.sesionAbierta) {
      setSesion({ sesionId: caja.sesionAbierta.id, cajaId: caja.id, cajaNombre: caja.nombre, abiertaEn: caja.sesionAbierta.abierta_en });
      setModalCaja(null);
      return;
    }
    const monto = Number(montoBuf);
    if (!(monto >= 0)) return;
    try {
      const r = await fetch('/api/caja', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accion: 'abrir', cajaId: caja.id, montoInicial: monto }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.message ?? 'No se pudo abrir la caja');
      setSesion({ sesionId: d.sesionId, cajaId: caja.id, cajaNombre: caja.nombre });
      setModalCaja(null);
      setMontoBuf('');
      setEstado(null);
    } catch (e) {
      setEstado({ tipo: 'error', texto: e instanceof Error ? e.message : 'No se pudo abrir la caja' });
    }
  }

  async function cerrarCaja() {
    if (!sesion || cerrando) return;
    const contado = Number(montoBuf);
    if (!(contado >= 0)) return;
    setCerrando(true);
    try {
      const r = await fetch('/api/caja', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accion: 'cerrar', sesionId: sesion.sesionId, montoCierre: contado }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.message ?? 'No se pudo cerrar la caja');
      setArqueo({ esperado: Number(d.esperado ?? 0), contado: Number(d.contado ?? contado), diferencia: Number(d.diferencia ?? 0) });
      setSesionCerradaId(sesion.sesionId);
      setSesion(null);
      setMontoBuf('');
      cargarCajas();
    } catch (e) {
      setEstado({ tipo: 'error', texto: e instanceof Error ? e.message : 'No se pudo cerrar la caja' });
    }
    setCerrando(false);
  }

  // ---- catálogo local para búsqueda instantánea, con copia en DISCO ----
  // La copia en localStorage es lo que permite que la caja siga vendiendo con
  // el internet cortado: si la página se recarga durante el corte, el service
  // worker sirve la pantalla y el catálogo (productos, códigos y precios) sale
  // de acá. Cuando hay red, se pisa con la versión fresca del servidor.
  useEffect(() => {
    try {
      const guardado = localStorage.getItem('odb_caja_catalogo');
      if (guardado) {
        const { items } = JSON.parse(guardado);
        if (Array.isArray(items) && items.length) {
          setCatalogoLocal(items.map((p: any) => ({ ...p, _n: norm(p.nombre) })));
        }
      }
    } catch { /* copia rota o inexistente: se sigue con la de red */ }
    fetch('/api/pos-catalogo')
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) => {
        const items = d.items ?? [];
        if (!items.length) return;
        setCatalogoLocal(items.map((p: any) => ({ ...p, _n: norm(p.nombre) })));
        try {
          localStorage.setItem('odb_caja_catalogo', JSON.stringify({ ts: Date.now(), items }));
        } catch { /* catálogo muy grande para el disco de este navegador: sin copia, todo sigue igual */ }
      })
      .catch(() => {});
  }, []);

  // La bandera de "sin red" también escucha al navegador, que se entera antes
  // que nosotros: así el cartel y el candado de medios aparecen al instante.
  useEffect(() => {
    const off = () => setSinRed(true);
    const on = () => setSinRed(false);
    window.addEventListener('offline', off);
    window.addEventListener('online', on);
    return () => { window.removeEventListener('offline', off); window.removeEventListener('online', on); };
  }, []);

  function filtrarLocal(t: string): Producto[] {
    const n = norm(t);
    const low = t.toLowerCase();
    return catalogoLocal
      .filter((p) =>
        p.codigo === t ||
        p._n?.includes(n) ||
        p.sku?.toLowerCase().startsWith(low) ||
        (p.codigosBarras ?? []).some((c: string) => c.includes(t)),
      )
      .slice(0, 8);
  }

  // precio efectivo del renglón: mayorista si la venta es mayorista y el producto
  // tiene precio en esa lista; si no, el minorista. El server recalcula igual.
  const precioDe = (r: Renglon | Producto) =>
    Number((mayorista && r.precioMayorista != null ? r.precioMayorista : r.precio)) || 0;

  // El total cobrable se recalcula también en el servidor: esto es solo display
  const total = carrito.reduce((s, r) => s + precioDe(r) * r.cantidad, 0);
  const unidades = carrito.reduce((s, r) => s + r.cantidad, 0);
  const subtotalLista = carrito.reduce(
    (s, r) => s + (Number(r.precioLista ?? r.precio) || 0) * r.cantidad,
    0,
  );
  const pagaConN = Number(pagaCon) || 0;

  // total a cobrar: display menos el descuento autorizado (el servidor lo revalida)
  const totalFinal = Math.max(0, Math.round((total - (descuento?.monto ?? 0)) * 100) / 100);

  // pagos efectivos a enviar: divididos, o todo con el medio activo
  const pagosVenta: Pago[] = useMemo(
    () => (dividido ? pagos : [{ medio, monto: totalFinal, ...(medio === 'tarjeta' && terminal ? { terminal } : {}) }]),
    [dividido, pagos, medio, totalFinal, terminal],
  );
  const pagado = pagosVenta.reduce((s, p) => s + p.monto, 0);
  const restante = Math.round((totalFinal - pagado) * 100) / 100;
  const esEfectivoSimple = !dividido && medio === 'efectivo';
  const vuelto = esEfectivoSimple && pagaConN > 0 ? pagaConN - totalFinal : null;
  const usaCtaCte = pagosVenta.some((p) => p.medio === 'cta_cte' && p.monto > 0);

  // Cuenta corriente y Factura A necesitan identificar al cliente (CUIT / cuenta).
  const requiereCliente = comprobante === 'A' || usaCtaCte;
  const clienteIdentificado = comprobante === 'A'
    ? receptorCuit.trim().length >= 8
    : (!!cliente?.existe || dni.trim().length >= 7);
  const faltaCliente = requiereCliente && !clienteIdentificado;

  // Suma un habitual del perfil con un toque. Se busca el producto por su SKU
  // para llevarlo con el precio y el stock del momento: el perfil dice QUÉ
  // lleva, nunca a qué precio lo llevó la vez pasada.
  async function agregarPorSku(sku: string) {
    try {
      const res = await fetch(`/api/pos-buscar?q=${encodeURIComponent(sku)}&sucursal=${encodeURIComponent(sucursalId)}`);
      if (!res.ok) return;
      const items = (await res.json()).items ?? [];
      const p = items.find((x: any) => x.sku === sku) ?? items[0];
      if (p) agregar(p);
      else setEstado({ tipo: 'error', texto: 'Ese producto ya no está disponible' });
    } catch {
      setEstado({ tipo: 'error', texto: 'No pude agregarlo, buscalo a mano' });
    }
  }

  const esCodigoBalanza = (t: string) => /^2\d{12}$/.test(t.trim());

  function agregar(p: Producto, cantidadFija?: number) {
    if (p.activo === false) {
      setEstado({ tipo: 'error', texto: `"${p.nombre}" está dado de baja: se reconoce pero no se vende. Avisá a backoffice si hay que reactivarlo.` });
      setBusqueda(''); setResultados([]);
      return;
    }
    if (p.precio == null) {
      setEstado({ tipo: 'error', texto: `"${p.nombre}" no tiene precio cargado — no se puede vender` });
      setBusqueda(''); setResultados([]);
      return;
    }
    const cant = cantidadFija ?? multiplicador ?? 1;
    setUltimoSku(p.sku);
    setCarrito((c) => {
      const existente = c.find((r) => r.sku === p.sku);
      if (existente) {
        // por peso: dos etiquetas del mismo producto suman kilos (0,290 + 0,415)
        const suma = existente.porPeso ? Math.round((existente.cantidad + cant) * 1000) / 1000 : Math.min(999, existente.cantidad + cant);
        return c.map((r) => (r.sku === p.sku ? { ...r, cantidad: suma } : r));
      }
      return [...c, { ...p, cantidad: cant }];
    });
    const sinStock = p.stock != null && p.stock <= 0;
    if (sinStock) setEstado({ tipo: 'error', texto: `⚠ ${p.nombre}: ${textoSinStock(p)}. Si lo tenés en la mano, el stock está mal: avisá a depósito.` });
    else if (cantidadFija != null && p.porPeso) setEstado({ tipo: 'ok', texto: `⚖ ${p.nombre}: ${cantidadFija.toFixed(3).replace('.', ',')} kg a ${pesos(p.precio)} el kilo = ${pesos((p.precio ?? 0) * cantidadFija)}` });
    else if (cantidadFija != null && cantidadFija !== 1) setEstado({ tipo: 'ok', texto: `${cantidadFija} × ${p.nombre} (etiqueta de balanza)` });
    else if (multiplicador) setEstado({ tipo: 'ok', texto: `×${multiplicador} · ${p.nombre}` });
    else setEstado(null);
    setMultiplicador(null);
    setCodigoPendiente(null);
    setBusqueda('');
    setResultados([]);
  }

  // Un código que el sistema no conoce: la cajera busca el producto por nombre
  // y lo vincula acá mismo. La próxima vez, el escaneo lo encuentra solo.
  async function vincularCodigo(p: Producto) {
    const codigo = codigoPendiente;
    if (!codigo) return;
    try {
      const esPlu = codigo.startsWith('PLU:');
      const cuerpo = esPlu
        ? { sku: p.sku, codigo: codigo.slice(4).split('|')[0], tipo: 'plu', porPeso: codigo.endsWith('|kg') }
        : { sku: p.sku, codigo };
      const r = await fetch('/api/pos-vincular', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setEstado({ tipo: 'error', texto: d.message ?? 'No se pudo vincular el código' }); return; }
      if (esPlu) {
        const plu = codigo.slice(4).split('|')[0]; const porPeso = codigo.endsWith('|kg');
        const valor = Number(codigo.split('|')[1] ?? '1') || 1;
        setCatalogoLocal((c) => c.map((x) => (x.sku === p.sku ? { ...x, plu, porPeso } : x)));
        agregar({ ...p, plu, porPeso }, porPeso ? Math.round(valor) / 1000 : Math.max(1, Math.round(valor)));
        setEstado({ tipo: 'ok', texto: `✓ PLU ${plu} vinculado a ${p.nombre}${porPeso ? ' (se vende por peso)' : ''}. La próxima etiqueta entra sola.` });
        return;
      }
      setCatalogoLocal((c) => c.map((x) => (x.sku === p.sku ? { ...x, codigosBarras: [...(x.codigosBarras ?? []), codigo] } : x)));
      agregar({ ...p, codigosBarras: [...(p.codigosBarras ?? []), codigo] });
      setEstado({ tipo: 'ok', texto: `✓ Código ${codigo} vinculado a ${p.nombre}. La próxima vez entra solo.` });
    } catch { setEstado({ tipo: 'error', texto: 'No se pudo vincular el código (revisá la conexión)' }); }
  }

  // C → modo cantidad: el buscador queda con "c", el último renglón queda
  // seleccionado (así el teclado numérico en pantalla también lo edita) y
  // "c10" + Enter pone 10 unidades. Sin producto escaneado, arma el próximo.
  function entrarModoCantidad() {
    setBusqueda('c');
    setResultados([]);
    if (ultimoSku && carrito.some((r) => r.sku === ultimoSku)) { setFoco({ tipo: 'linea', sku: ultimoSku }); setCantBuf(''); }
    setEstado(null);
    inputRef.current?.focus();
  }
  function aplicarCantidad(n: number) {
    const cant = Math.max(1, Math.min(999, Math.round(n)));
    const linea = ultimoSku ? carrito.find((r) => r.sku === ultimoSku) : null;
    if (linea) {
      if (linea.porPeso) setEstado({ tipo: 'error', texto: `${linea.nombre} se vende por peso: la cantidad la manda la etiqueta de la balanza` });
      else {
        setCarrito((c) => c.map((r) => (r.sku === linea.sku ? { ...r, cantidad: cant } : r)));
        setEstado({ tipo: 'ok', texto: `${linea.nombre}: ${cant} unidades` });
      }
    } else {
      setMultiplicador(cant);
      setEstado({ tipo: 'ok', texto: `×${cant} para el próximo producto que escanees` });
    }
    setFoco(null); setCantBuf('');
    setBusqueda('');
    inputRef.current?.focus();
  }

  // "6*" → los próximos productos escaneados entran de a 6. También "6*7791234567890"
  // todo junto (cantidad, asterisco, código). Devuelve true si el texto era eso.
  function tomarMultiplicador(texto: string): boolean {
    const t = texto.trim();
    const solo = /^(\d{1,3})\s*[*xX×]$/.exec(t);
    if (solo) {
      const n = Math.max(1, Math.min(999, Number(solo[1])));
      setMultiplicador(n);
      setBusqueda('');
      setResultados([]);
      setEstado({ tipo: 'ok', texto: `×${n} para el próximo producto que escanees` });
      return true;
    }
    const junto = /^(\d{1,3})\s*[*xX×]\s*([A-Za-z0-9-]{3,20})$/.exec(t);
    if (junto) {
      const n = Math.max(1, Math.min(999, Number(junto[1])));
      setMultiplicador(n);
      setTimeout(() => escanearRef.current?.(junto[2]), 0); // con el multiplicador ya seteado
      setBusqueda('');
      return true;
    }
    return false;
  }

  function onBuscar(termino: string) {
    setBusqueda(termino);
    setEstado(null);
    if (debRef.current) clearTimeout(debRef.current);
    const t = termino.trim();
    if (/^[cC]\d{0,3}$/.test(t)) {
      // recién entra en modo cantidad: seleccionar el último renglón
      if (t.length === 1 && ultimoSku && carrito.some((r) => r.sku === ultimoSku)) { setFoco({ tipo: 'linea', sku: ultimoSku }); setCantBuf(''); }
      setResultados([]);
      return;
    }
    if (t.length < 2) { setResultados([]); return; }
    if (esCodigoBalanza(t)) { ejecutar(t, true); return; }
    if (/^\d{4,14}$/.test(t)) {
      const ex = catalogoLocal.find((p) => p.codigo === t || p.sku === t || (p.codigosBarras ?? []).includes(t));
      if (ex) { agregar(ex); return; }
    }
    const locales = filtrarLocal(t);
    setResultados(locales);
    // Siempre refinamos contra el server: trae el stock por sucursal para marcar en rojo lo agotado.
    debRef.current = setTimeout(() => ejecutar(t, false), 170);
  }

  async function ejecutar(t: string, esEnter: boolean) {
    const seq = ++seqRef.current;
    setBuscando(true);
    try {
      const res = await fetch(`/api/pos-buscar?q=${encodeURIComponent(t)}&sucursal=${encodeURIComponent(sucursalId)}`);
      const j: any = res.ok ? await res.json() : {};
      const datos: Producto[] = j.items ?? [];
      if (seq !== seqRef.current) return;
      if (j.balanza) {
        // etiqueta de balanza: el producto entra con la cantidad de la etiqueta
        const it = datos[0];
        if (it) { agregar(it, it.cantidadBalanza ?? 1); return; }
        const gramos = Number(j.balanza.valor) >= 100; // 290 = gramos; 1 = unidades
        setCodigoPendiente(`PLU:${j.balanza.plu}|${j.balanza.valor}${gramos ? '|kg' : ''}`);
        setEstado({ tipo: 'error', texto: `Etiqueta de balanza con PLU ${j.balanza.plu}: el sistema no lo tiene vinculado. Buscá el producto por nombre y tocá «Vincular PLU ${j.balanza.plu}» en el resultado.` });
        setResultados([]);
        return;
      }
      const esCodigo = /^\d{6,14}$/.test(t);
      if (esCodigo || esEnter) {
        const exacto = datos.find((p) => p.codigo === t || p.sku === t || (p.codigosBarras ?? []).includes(t)) ?? (datos.length === 1 ? datos[0] : null);
        if (exacto) { agregar(exacto); return; }
        if (esCodigo && datos.length === 0) {
          setCodigoPendiente(t);
          setEstado({ tipo: 'error', texto: `Código ${t}: el sistema no lo tiene vinculado a ningún producto. Buscá el producto por nombre y tocá «Vincular este código» en el resultado.` });
          setResultados([]);
          return;
        }
      }
      setResultados(datos);
    } catch {
      if (seq === seqRef.current) setEstado({ tipo: 'error', texto: 'No se pudo buscar (revisá la conexión)' });
    } finally {
      if (seq === seqRef.current) setBuscando(false);
    }
  }

  function onKeyBuscar(e: React.KeyboardEvent) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (debRef.current) clearTimeout(debRef.current);
    const t = busqueda.trim();
    const mc = /^[cC](\d*)$/.exec(t);
    if (mc) {
      if (!mc[1]) { // "C" solo + Enter: ir al casillero de cantidad del último renglón
        const el = document.querySelector<HTMLInputElement>(`input[data-cantidad-de="${ultimoSku ?? ''}"]`);
        setBusqueda(''); if (el) { el.focus(); el.select(); } else if (!ultimoSku) setEstado({ tipo: 'error', texto: 'Escaneá un producto y después C + cantidad' });
        return;
      }
      if (mc[1].length <= 3) { aplicarCantidad(Number(mc[1])); return; }
      setBusqueda(''); escanear(mc[1]); return; // la pistola tipeó el código después de la c
    }
    if (tomarMultiplicador(t)) return;
    if (esCodigoBalanza(t)) { ejecutar(t, true); return; }
    const ex = catalogoLocal.find((p) => p.codigo === t || p.sku === t || (p.codigosBarras ?? []).includes(t));
    if (ex) { agregar(ex); return; }
    if (resultados[0]) { agregar(resultados[0]); return; }
    if (t.length >= 1) ejecutar(t, true);
  }

  // Escaneo de un código venga de donde venga el foco (la pistola tipea rápido
  // y termina en Enter; el listener global de abajo la captura aunque el
  // buscador no esté enfocado). Agrega directo si lo tiene el catálogo local,
  // si no lo busca en el server.
  function escanear(codigo: string) {
    const t = codigo.trim();
    if (!t) return;
    if (tomarMultiplicador(t)) return;
    setBusqueda('');
    if (esCodigoBalanza(t)) { ejecutar(t, true); inputRef.current?.focus(); return; }
    const ex = catalogoLocal.find((p) => p.codigo === t || p.sku === t || (p.codigosBarras ?? []).includes(t));
    if (ex) { agregar(ex); return; }
    ejecutar(t, true);
    inputRef.current?.focus();
  }

  function cambiarCantidad(sku: string, delta: number) {
    setCarrito((c) =>
      c
        .map((r) => (r.sku === sku ? { ...r, cantidad: r.cantidad + delta } : r))
        .filter((r) => r.cantidad > 0),
    );
  }
  function quitar(sku: string) {
    setCarrito((c) => c.filter((r) => r.sku !== sku));
    if (foco?.tipo === 'linea' && foco.sku === sku) setFoco(null);
  }

  // ---- teclado numérico en pantalla (cantidad de línea, monto de pago o efectivo) ----
  function seleccionarLinea(sku: string) {
    setFoco((f) => (f?.tipo === 'linea' && f.sku === sku ? null : { tipo: 'linea', sku }));
    setCantBuf('');
  }
  function tecla(k: string) {
    const apply = (cur: string) => (k === 'C' ? '' : k === '⌫' ? cur.slice(0, -1) : cur === '0' ? k : cur + k);
    if (foco?.tipo === 'linea') {
      const nb = apply(cantBuf);
      setCantBuf(nb);
      const n = Number(nb);
      setCarrito((c) => c.map((r) => (r.sku === foco.sku ? { ...r, cantidad: nb === '' ? r.cantidad : Math.max(1, Math.min(999, n || 1)) } : r)));
    } else if (foco?.tipo === 'pago') {
      const nb = apply(cantBuf);
      setCantBuf(nb);
      setPagos((ps) => ps.map((p, i) => (i === foco.idx ? { ...p, monto: Number(nb) || 0 } : p)));
    } else {
      setPagaCon((p) => apply(p));
    }
  }
  function sumarCash(n: number) { setFoco(null); setPagaCon((p) => String((Number(p) || 0) + n)); }

  // ---- pagos divididos ----
  function activarDividido() {
    setDividido(true);
    setPagos([{ medio, monto: totalFinal, ...(medio === 'tarjeta' && terminal ? { terminal } : {}) }]);
    setPagaCon('');
    setFoco(null);
  }
  function agregarPago(m: { id: string; terminal?: string }) {
    setPagos((ps) => {
      const falta = Math.max(0, Math.round((totalFinal - ps.reduce((s, p) => s + p.monto, 0)) * 100) / 100);
      const nuevos = [...ps, { medio: m.id, monto: falta, ...(m.terminal ? { terminal: m.terminal } : {}) }];
      setFoco({ tipo: 'pago', idx: nuevos.length - 1 });
      setCantBuf('');
      return nuevos;
    });
  }
  function quitarPago(idx: number) {
    setPagos((ps) => ps.filter((_, i) => i !== idx));
    setFoco(null);
  }
  function salirDividido() {
    setDividido(false);
    setPagos([]);
    setFoco(null);
  }

  // ---- cliente: por DNI o por nombre (autocompletar) ----
  function onCambioCliente(v: string) {
    setDni(v);
    setCliente(null);
    if (debCliRef.current) clearTimeout(debCliRef.current);
    const t = v.trim();
    if (/^\d+$/.test(t) || t.length < 3) { setClientes([]); return; }
    debCliRef.current = setTimeout(async () => {
      try {
        const r = await fetch(`/api/buscar-cliente?q=${encodeURIComponent(t)}`);
        if (!r.ok) return;
        const d = await r.json();
        const lista = (Array.isArray(d) ? d : d.clientes ?? d.items ?? [])
          .filter((c: any) => c?.dni)
          .slice(0, 6)
          .map((c: any) => ({ dni: String(c.dni), nombre: c.razon_social ?? c.nombre ?? c.dni }));
        setClientes(lista);
      } catch {}
    }, 250);
  }

  // ---- consulta de stock en ambas sucursales ----
  function abrirStock() {
    setModalStock(true);
    setStockQ('');
    setStockRes([]);
    setTimeout(() => stockInputRef.current?.focus(), 50);
  }
  function onBuscarStock(q: string) {
    setStockQ(q);
    if (stockDebRef.current) clearTimeout(stockDebRef.current);
    const t = q.trim();
    if (t.length < 2) { setStockRes([]); return; }
    // primero mira el catálogo ya precargado (instantáneo); si el término no está
    // ahí igual consulta al server para traer el detalle por sucursal
    stockDebRef.current = setTimeout(async () => {
      setStockBuscando(true);
      try {
        const r = await fetch(`/api/pos-stock?q=${encodeURIComponent(t)}`);
        if (r.ok) setStockRes((await r.json()).items ?? []);
      } catch {}
      setStockBuscando(false);
    }, 200);
  }

  async function buscarCliente(dniElegido?: string) {
    const d = (dniElegido ?? dni).trim();
    if (!d) return;
    setClientes([]);
    if (dniElegido) setDni(dniElegido);
    try {
      const res = await fetch(`/api/cliente?dni=${encodeURIComponent(d)}`);
      if (res.ok) {
        const c = await res.json();
        setCliente(c);
        setWaTel(c?.telefono ?? '');
        setWaHecho(c?.aceptaMarketing ? 'alta' : null);
      }
    } catch {}
  }

  // Toma un pago a cuenta. NO baja la deuda: crea el cobro pendiente y le avisa
  // al dueño. El cajero solo necesita saber que quedó registrado.
  async function tomarCobro() {
    if (!cobro || cobro.mandando || !cliente?.existe) return;
    const monto = Number(cobro.monto);
    if (!Number.isFinite(monto) || monto <= 0) { setCobro({ ...cobro, error: 'Poné el monto que dejó el cliente' }); return; }
    setCobro({ ...cobro, mandando: true, error: '' });
    try {
      const r = await fetch('/api/cobranzas', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clienteId: (cliente as any).id, monto, medio: cobro.medio, nota: cobro.nota.trim() || undefined }),
      });
      const d = await r.json();
      if (!r.ok) { setCobro({ ...cobro, mandando: false, error: d?.message ?? 'No se pudo registrar' }); return; }
      setCobro({ ...cobro, mandando: false, listo: true, error: '' });
    } catch {
      setCobro({ ...cobro, mandando: false, error: 'Sin conexión: probá de nuevo' });
    }
  }

  // Guarda teléfono + permiso. Un toque, sin sacar al cajero de la venta.
  async function guardarWhatsapp(acepta: boolean) {
    const d = (cliente?.dni ?? dni).trim();
    if (!d || waGuardando) return;
    setWaGuardando(true);
    try {
      const res = await fetch('/api/cliente', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dni: d, telefono: acepta ? waTel : undefined, acepta }),
      });
      const j = await res.json();
      if (!res.ok) { setEstado({ tipo: 'error', texto: j?.message ?? 'No pude guardar el contacto' }); return; }
      setWaHecho(acepta ? 'alta' : 'baja');
      setCliente((c: any) => (c ? { ...c, telefono: j.telefono ?? c.telefono, aceptaMarketing: acepta } : c));
    } catch {
      setEstado({ tipo: 'error', texto: 'No pude guardar el contacto' });
    } finally {
      setWaGuardando(false);
    }
  }

  // ---- estacionar / retomar tickets (multi-cliente en la misma línea de caja) ----
  function estacionar() {
    if (!carrito.length) return;
    const et: Estacionado = {
      id: crypto.randomUUID(),
      etiqueta: cliente?.nombre || (dni.trim() ? `DNI ${dni.trim()}` : new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })),
      carrito,
      dni,
      comprobante,
      ts: Date.now(),
    };
    setEstacionados((e) => [...e, et]);
    limpiarVenta();
    setEstado({ tipo: 'ok', texto: `⏸ Ticket estacionado (${et.etiqueta}) — retomalo desde la barra de arriba` });
  }
  function retomar(id: string) {
    const et = estacionados.find((e) => e.id === id);
    if (!et) return;
    if (carrito.length) {
      setEstado({ tipo: 'error', texto: 'Estacioná o cobrá el ticket actual antes de retomar otro' });
      return;
    }
    setCarrito(et.carrito);
    setDni(et.dni);
    setComprobante(et.comprobante);
    setEstacionados((e) => e.filter((x) => x.id !== id));
    if (et.dni) buscarCliente(et.dni);
  }

  function limpiarVenta() {
    fijarCobroMP(null);
    setCarrito([]);
    setCliente(null);
    setClientes([]);
    setDni('');
    setSinDni(false); // al cliente siguiente se le pregunta de nuevo
    setReceptorCuit('');
    setReceptorNombre('');
    setPagaCon('');
    setFoco(null);
    setDividido(false);
    setPagos([]);
    setDescuento(null);
    setMayorista(false);
    setComprobante('B');
    inputRef.current?.focus();
  }

  // PIN de supervisor: valida contra gerentes/dueños y devuelve un token de un
  // solo uso (no el usuarioId — así no se puede reusar la autorización)
  async function autorizarPin(pin: string): Promise<{ token: string; nombre: string }> {
    const r = await fetch('/api/caja', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accion: 'autorizar', pin }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.message ?? 'PIN incorrecto');
    return d;
  }

  async function aplicarDescuento() {
    const monto = Number(descBuf);
    if (!(monto > 0)) { setEstado({ tipo: 'error', texto: 'Ingresá el monto del descuento' }); return; }
    if (monto >= total) { setEstado({ tipo: 'error', texto: 'El descuento no puede superar el total' }); return; }
    setProcesando(true);
    try {
      const aut = await autorizarPin(pinBuf);
      setDescuento({ monto, autorizacionToken: aut.token, nombre: aut.nombre });
      setModalExtra(null);
      setPinBuf(''); setDescBuf('');
      setEstado({ tipo: 'ok', texto: `Descuento de ${pesos(monto)} autorizado por ${aut.nombre}` });
    } catch (e) {
      setEstado({ tipo: 'error', texto: e instanceof Error ? e.message : 'PIN incorrecto' });
    }
    setProcesando(false);
  }

  async function registrarMovimiento() {
    if (!sesion) return;
    const monto = Number(movMonto);
    if (!(monto > 0) || !movMotivo.trim()) {
      setEstado({ tipo: 'error', texto: 'Completá monto y motivo del movimiento' });
      return;
    }
    setProcesando(true);
    try {
      const r = await fetch('/api/caja', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accion: 'movimiento', sesionId: sesion.sesionId, tipo: movTipo, monto, motivo: movMotivo.trim() }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.message ?? 'No se pudo registrar');
      setModalExtra(null);
      setMovMonto(''); setMovMotivo('');
      setEstado({ tipo: 'ok', texto: `✓ ${movTipo === 'ingreso' ? 'Ingreso' : 'Retiro'} de ${pesos(monto)} registrado (entra al arqueo)` });
    } catch (e) {
      setEstado({ tipo: 'error', texto: e instanceof Error ? e.message : 'No se pudo registrar' });
    }
    setProcesando(false);
  }

  async function abrirDevolucion() {
    setModalExtra('devolucion');
    setDevVenta(null);
    setDevolver({});
    setPinBuf('');
    try {
      const r = await fetch('/api/ventas?dias=1&estado=completada&limite=15');
      if (r.ok) setDevVentas(await r.json());
    } catch { setDevVentas([]); }
  }

  // Devolución arrancando desde un ticket puntual (viene de "Mi turno"): evita
  // que la cajera tenga que buscarlo de nuevo en la lista de las últimas 24 h.
  async function abrirDevolucionDeVenta(ventaId: string) {
    setModalExtra('devolucion');
    setDevVenta(null);
    setDevolver({});
    setPinBuf('');
    try {
      const r = await fetch(`/api/ventas?dias=1&estado=completada&limite=300`);
      const lista = r.ok ? await r.json() : [];
      setDevVentas(lista);
      const v = (lista ?? []).find((x: any) => x.id === ventaId);
      if (v) setDevVenta(v);
    } catch { setDevVentas([]); }
  }

  async function confirmarDevolucion() {
    if (!devVenta) return;
    const items = Object.entries(devolver)
      .filter(([, c]) => c > 0)
      .map(([sku, cantidad]) => ({ sku, cantidad }));
    if (!items.length) { setEstado({ tipo: 'error', texto: 'Elegí qué renglones se devuelven' }); return; }
    setProcesando(true);
    try {
      const aut = await autorizarPin(pinBuf);
      const r = await fetch('/api/devolver', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ventaId: devVenta.id,
          items,
          reintegro: devEfectivo ? 'efectivo' : 'otro',
          sesionCajaId: sesion?.sesionId,
          autorizacionToken: aut.token,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.message ?? 'No se pudo devolver');
      setModalExtra(null);
      setPinBuf('');
      const ncTxt = d.nc ? ` · ${fmtNumero(d.nc)}` : '';
      setEstado({ tipo: 'ok', texto: `✓ Devolución de ${pesos(d.monto)}${ncTxt} — stock repuesto${devEfectivo ? ' y egreso de caja registrado' : ''}` });
    } catch (e) {
      setEstado({ tipo: 'error', texto: e instanceof Error ? e.message : 'No se pudo devolver' });
    }
    setProcesando(false);
  }

  // ---- devolución SIN supervisor presente: se pide a distancia ----
  // ANTES la devolución solo salía con el PIN tecleado en el mostrador: si el
  // supervisor no estaba, no había forma de avisarle y la nota de crédito no se
  // hacía (2026-09-08). AHORA la cajera pide la autorización; a los supervisores
  // les llega WhatsApp + campanita, aprueban desde /aprobaciones y el sistema
  // ejecuta la devolución (stock + NC + egreso) solo. La caja lo sigue acá.
  async function pedirAutorizacionDevolucion() {
    if (!devVenta) return;
    const items = Object.entries(devolver).filter(([, c]) => c > 0).map(([sku, cantidad]) => ({ sku, cantidad }));
    if (!items.length) { setEstado({ tipo: 'error', texto: 'Elegí qué renglones se devuelven' }); return; }
    setProcesando(true);
    try {
      const r = await fetch('/api/devolucion-pedir', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ventaId: devVenta.id, items, reintegro: devEfectivo ? 'efectivo' : 'otro', sesionCajaId: sesion?.sesionId }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.message ?? 'No se pudo pedir la autorización');
      setDevPedido({ id: d.id, monto: Number(d.monto), estado: 'pendiente', avisados: d.avisados });
      setModalExtra(null); setPinBuf('');
      setEstado({ tipo: 'ok', texto: `Pedido enviado: ${(d.avisados ?? []).join(', ') || 'los supervisores'} ya tienen el aviso. Podés seguir vendiendo.` });
    } catch (e) {
      setEstado({ tipo: 'error', texto: e instanceof Error ? e.message : 'No se pudo pedir la autorización' });
    }
    setProcesando(false);
  }
  useEffect(() => {
    if (!devPedido || devPedido.estado !== 'pendiente') return;
    let vivo = true;
    const tick = async () => {
      try {
        const d = await fetch(`/api/devolucion-pedir?id=${encodeURIComponent(devPedido.id)}`, { cache: 'no-store' }).then((r) => r.json());
        if (!vivo || !d?.estado || d.estado === 'pendiente') return;
        setDevPedido((p) => (p ? { ...p, estado: d.estado, respuesta: d.respuesta, resueltaPor: d.resueltaPor, resultado: d.resultado, error: d.error } : p));
      } catch { /* sin red momentánea */ }
    };
    const t = setInterval(tick, 5000);
    return () => { vivo = false; clearInterval(t); };
  }, [devPedido]);

  // ---- impresión de ticket (térmica 80mm vía diálogo del navegador) ----
  // El diálogo de impresión se abre DESPUÉS de que el ticket quedó dibujado.
  // Con un setTimeout de 60 ms, en la PC de la caja salía la hoja en blanco
  // (2026-09-08): React todavía no había pintado #ticket-odb.
  const [pendienteImprimir, setPendienteImprimir] = useState(0);
  function imprimir(t: TicketData) {
    imprimirRef.current = t;
    setTicket(t);
    setPendienteImprimir((n) => n + 1);
  }
  useEffect(() => {
    if (!pendienteImprimir || !ticket) return;
    let vivo = true;
    const esperar = (intentos: number) => {
      const el = document.getElementById('ticket-odb');
      if (el && el.textContent && el.textContent.trim().length > 0) {
        requestAnimationFrame(() => requestAnimationFrame(() => { if (vivo) window.print(); }));
      } else if (intentos > 0) setTimeout(() => esperar(intentos - 1), 50);
      else window.print();
    };
    esperar(20);
    return () => { vivo = false; };
  }, [pendienteImprimir, ticket]);

  function armarTicket(base: { items: TicketData['items']; total: number; descuento: number }, extras: Partial<TicketData>): TicketData {
    return {
      etiqueta: ETIQUETA_COMP[comprobante] ?? 'Ticket',
      fecha: new Date().toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }),
      items: base.items,
      total: base.total,
      descuento: base.descuento,
      pagos: pagosVenta,
      vuelto: vuelto != null && vuelto > 0 ? vuelto : null,
      dni: dni.trim() || undefined,
      ...extras,
    };
  }

  // ---- cobro (con cola offline idempotente) ----
  // ───────── Cobro con QR integrado de Mercado Pago (2026-09-08) ─────────
  // ANTES: "Cobrar" registraba la venta (y facturaba) al instante y el cliente
  // tenía que tipear el importe en el QR fijo. AHORA: primero se cobra. La caja
  // manda el importe exacto al QR de MP de esta caja, espera la aprobación y
  // recién entonces registra la venta e imprime. Cancelar = no se registra nada.
  type CobroMP = {
    id?: string;
    monto: number;
    estado: 'iniciando' | 'esperando' | 'aprobado' | 'omitido' | 'sin_qr' | 'error';
    qr?: string | null;
    mpPaymentId?: string;
    aviso?: string;
    error?: string;
    opcionesQR?: { id: string; nombre: string; externalId: string | null }[];
  };
  const [cobroMP, setCobroMP] = useState<CobroMP | null>(null);
  const cobroMPRef = useRef<CobroMP | null>(null);
  function fijarCobroMP(v: CobroMP | null) {
    cobroMPRef.current = v; // el ref se actualiza en el acto: cobrar() lo lee en la misma llamada
    setCobroMP(v);
  }
  async function pedirMP(body: Record<string, unknown>) {
    const r = await fetch('/api/mp-cobro', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({}));
    return { ok: r.ok, d };
  }
  function textoError(d: any, porDefecto: string): string {
    const m = d?.message;
    if (typeof m === 'string') return m;
    if (m && typeof m.message === 'string') return m.message;
    return porDefecto;
  }
  async function iniciarCobroMP(monto: number) {
    if (!sesion) {
      setEstado({ tipo: 'error', texto: 'Abrí la caja antes de cobrar con Mercado Pago' });
      return;
    }
    fijarCobroMP({ monto, estado: 'iniciando' });
    const detalle = `${carrito.length} artículo${carrito.length === 1 ? '' : 's'} · ${sesion.cajaNombre}`;
    const { ok, d } = await pedirMP({ accion: 'iniciar', cajaId: sesion.cajaId, monto, detalle });
    if (ok) {
      fijarCobroMP({ id: d.cobroId, monto, estado: 'esperando', qr: d.qr ?? null });
      return;
    }
    const codigo = d?.codigo ?? d?.message?.codigo;
    if (codigo === 'sin_qr') {
      const l = await fetch(`/api/mp-cobro?cajas=1&sucursalId=${encodeURIComponent(sucursalId)}`).then((x) => x.json()).catch(() => ({}));
      fijarCobroMP({ monto, estado: 'sin_qr', opcionesQR: l?.cajas ?? [] });
      return;
    }
    if (codigo === 'sin_mp') {
      // sucursal sin Mercado Pago integrado: se registra como siempre
      fijarCobroMP({ monto, estado: 'omitido' });
      void cobrar();
      return;
    }
    fijarCobroMP({ monto, estado: 'error', error: textoError(d, 'Mercado Pago no respondió') });
  }
  async function vincularQR(posId: string) {
    if (!sesion) return;
    const monto = cobroMPRef.current?.monto ?? 0;
    const { ok, d } = await pedirMP({ accion: 'vincular', cajaId: sesion.cajaId, posId });
    if (!ok) {
      fijarCobroMP({ monto, estado: 'error', error: textoError(d, 'No se pudo asignar ese QR') });
      return;
    }
    await iniciarCobroMP(monto);
  }
  async function cambiarQR() {
    const c = cobroMPRef.current;
    if (!c) return;
    if (c.id && c.estado === 'esperando') void pedirMP({ accion: 'cancelar', id: c.id });
    const l = await fetch(`/api/mp-cobro?cajas=1&sucursalId=${encodeURIComponent(sucursalId)}`).then((x) => x.json()).catch(() => ({}));
    fijarCobroMP({ monto: c.monto, estado: 'sin_qr', opcionesQR: l?.cajas ?? [] });
  }
  function cancelarCobroMP() {
    const c = cobroMPRef.current;
    if (c?.id && c.estado === 'esperando') void pedirMP({ accion: 'cancelar', id: c.id });
    fijarCobroMP(null);
    setEstado({ tipo: 'error', texto: 'Cobro con Mercado Pago cancelado: la venta NO se registró' });
  }
  function registrarIgual() {
    const c = cobroMPRef.current;
    if (!c) return;
    if (c.id && c.estado === 'esperando') void pedirMP({ accion: 'cancelar', id: c.id });
    fijarCobroMP({ ...c, estado: 'omitido' });
    void cobrar();
  }
  // Mientras se espera el pago: se consulta cada 2 segundos.
  useEffect(() => {
    if (cobroMP?.estado !== 'esperando' || !cobroMP.id) return;
    const id = cobroMP.id;
    let vivo = true;
    const tick = async () => {
      try {
        const d = await fetch(`/api/mp-cobro?id=${encodeURIComponent(id)}`, { cache: 'no-store' }).then((r) => r.json());
        if (!vivo || cobroMPRef.current?.id !== id) return;
        if (d.estado === 'aprobado') {
          fijarCobroMP({ ...(cobroMPRef.current as CobroMP), estado: 'aprobado', mpPaymentId: d.mpPaymentId });
        } else if (d.estado === 'vencido' || d.estado === 'cancelado' || d.estado === 'fallido') {
          fijarCobroMP(null);
          setEstado({
            tipo: 'error',
            texto: d.estado === 'vencido' ? 'Pasaron 10 minutos sin pago: el cobro venció y la venta NO se registró' : 'El cobro con Mercado Pago se canceló: la venta NO se registró',
          });
        } else if (d.aviso && cobroMPRef.current?.aviso !== d.aviso) {
          fijarCobroMP({ ...(cobroMPRef.current as CobroMP), aviso: d.aviso });
        }
      } catch {
        /* sin red momentánea: se vuelve a intentar en el próximo tick */
      }
    };
    const t = setInterval(tick, 2000);
    return () => { vivo = false; clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cobroMP?.estado, cobroMP?.id]);
  // Aprobado → recién ahora se registra la venta (y se imprime).
  useEffect(() => {
    if (cobroMP?.estado === 'aprobado' && !cobrando) void cobrar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cobroMP?.estado]);

  async function cobrar() {
    if (carrito.length === 0 || cobrando) return;
    // La restricción del candado también acá: el botón puede haber quedado
    // elegido de ANTES del corte (o el pago dividido esquiva los botones).
    if (sinRed && (medio !== 'efectivo' || (dividido && pagos.some((p: any) => p.medio !== 'efectivo')))) {
      setEstado({ tipo: 'error', texto: 'Sin conexión: solo se puede cobrar en efectivo. La venta queda guardada y se envía sola al volver la red.' });
      return;
    }
    if (faltaCliente) {
      setEstado({ tipo: 'error', texto: comprobante === 'A' ? 'Factura A: cargá el CUIT del receptor' : 'Cuenta corriente: identificá al cliente' });
      dniRef.current?.focus();
      return;
    }
    if (dividido && restante !== 0) {
      setEstado({ tipo: 'error', texto: restante > 0 ? `Falta asignar ${pesos(restante)} entre los medios de pago` : `Los pagos superan el total por ${pesos(-restante)}` });
      return;
    }
    // MERCADO PAGO: primero se cobra, después se registra. Si todavía no hay un
    // pago aprobado (ni el cajero eligió registrar igual), se manda el importe
    // al QR y se espera; cobrar() vuelve a llamarse solo al aprobarse.
    const montoMP = pagosVenta.filter((p) => p.medio === 'mercadopago').reduce((s, p) => s + p.monto, 0);
    const cMP = cobroMPRef.current;
    if (montoMP > 0 && !(cMP && (cMP.estado === 'aprobado' || cMP.estado === 'omitido'))) {
      if (cMP && (cMP.estado === 'iniciando' || cMP.estado === 'esperando')) return; // ya está en curso
      await iniciarCobroMP(montoMP);
      return;
    }
    setCobrando(true);
    setEstado(null);

    const ventaId = crypto.randomUUID(); // idempotencia: si se corta la red, el reintento no duplica
    const body = {
      ventaId,
      sucursalId,
      canal: 'mostrador',
      comprobante,
      items: carrito.map((r) => ({ sku: r.sku, cantidad: r.cantidad })),
      pagos: pagosVenta,
      clienteDni: cliente?.dni ?? (dni.trim() || undefined),
      sesionCajaId: sesion?.sesionId,
      ...(mayorista ? { mayorista: true } : {}),
      ...(descuento ? { descuentoExtra: descuento.monto, autorizacionToken: descuento.autorizacionToken } : {}),
      ...(comprobante === 'A'
        ? { receptor: { nombre: receptorNombre.trim() || undefined, docNumero: receptorCuit.trim() } }
        : {}),
    };
    // snapshot local por si hay que imprimir sin respuesta del servidor (offline)
    const itemsLocales = carrito.map((r) => ({
      porPeso: !!r.porPeso,
      cantidad: r.cantidad,
      nombre: r.nombre,
      precioUnitario: precioDe(r),
      total: precioDe(r) * r.cantidad,
    }));

    let res: Response;
    try {
      res = await fetch('/api/venta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch {
      // SIN RED: la venta va a la cola y se reintenta sola. El negocio no para.
      const t = armarTicket({ items: itemsLocales, total: totalFinal, descuento: Math.max(0, subtotalLista - totalFinal) }, { offline: true });
      setCola((c) => [...c, { ventaId, body, ticket: t, ts: Date.now() }]);
      setSinRed(true);
      setEstado({ tipo: 'ok', texto: `⚡ Sin conexión: venta guardada (${pesos(total)}). Se envía sola al volver internet.` });
      if (autoPrint) imprimir(t);
      limpiarVenta();
      setCobrando(false);
      return;
    }

    const datos = await res.json().catch(() => ({}));
    if (res.ok) {
      setSinRed(false);
      const numero = datos.comprobante ? fmtNumero(datos.comprobante) : undefined;
      const t = armarTicket(
        {
          items: (datos.items?.length ? datos.items : itemsLocales).map((i: any) => ({
            cantidad: i.cantidad, nombre: i.nombre, precioUnitario: i.precioUnitario, total: i.total,
          })),
          total: Number(datos.total ?? totalFinal),
          descuento: Number(datos.descuento ?? 0),
        },
        { numero },
      );
      setUltima({ ventaId, ticket: t });
      if (cobroMPRef.current?.id && cobroMPRef.current.estado === 'aprobado') {
        void pedirMP({ accion: 'venta', id: cobroMPRef.current.id, ventaId });
      }
      fijarCobroMP(null);
      const vueltoTxt = vuelto != null && vuelto > 0 ? ` · VUELTO ${pesos(vuelto)}` : '';
      const compTxt = numero ?? ETIQUETA_COMP[comprobante];
      setEstado({
        tipo: 'ok',
        texto: `✓ ${compTxt} · ${pesos(datos.total)}${Number(datos.descuento) > 0 ? ` (ahorró ${pesos(datos.descuento)})` : ''}${datos.tipo_cliente ? ` · ${datos.tipo_cliente}` : ''}${vueltoTxt}${datos.comprobanteError ? ` · ⚠ comprobante manual: ${datos.comprobanteError}` : ''}`,
      });
      if (autoPrint) imprimir(t);
      limpiarVenta();
    } else if (/debajo del costo/i.test(datos.message ?? '')) {
      // Guardarraíl de precio: la venta quedaría por debajo del costo. Un
      // supervisor puede autorizarla (liquidación real) tecleando su PIN; se
      // reintenta con el MISMO ventaId, así no hay riesgo de duplicar.
      const pin = await pedirTexto({
        titulo: 'Venta por debajo del costo',
        texto: datos.message,
        campo: { etiqueta: 'PIN de supervisor para autorizar la venta bajo costo', obligatorio: true },
        textoConfirmar: 'Autorizar',
      });
      if (pin && pin.trim()) {
        try {
          const aut = await autorizarPin(pin.trim());
          const res2 = await fetch('/api/venta', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...body, autorizacionToken: aut.token }),
          });
          const d2 = await res2.json().catch(() => ({}));
          if (res2.ok) {
            setEstado({ tipo: 'ok', texto: `✓ Venta autorizada por ${aut.nombre} · ${pesos(d2.total)}` });
            if (autoPrint) imprimir(armarTicket({ items: itemsLocales, total: Number(d2.total ?? totalFinal), descuento: Number(d2.descuento ?? 0) }, {}));
            limpiarVenta();
          } else {
            setEstado({ tipo: 'error', texto: d2.message ?? 'No se pudo registrar la venta' });
          }
        } catch (e) {
          setEstado({ tipo: 'error', texto: e instanceof Error ? e.message : 'PIN incorrecto' });
        }
      } else {
        setEstado({ tipo: 'error', texto: 'Venta cancelada (precio por debajo del costo)' });
      }
    } else {
      setEstado({ tipo: 'error', texto: datos.message ?? 'No se pudo registrar la venta' });
    }
    setCobrando(false);
  }

  // ---- cola offline: reintento automático cada 15s (idempotente por ventaId) ----
  useEffect(() => {
    if (!cola.length) return;
    const timer = setInterval(async () => {
      const pendiente = cola[0];
      try {
        const r = await fetch('/api/venta', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(pendiente.body),
        });
        if (r.ok) {
          setSinRed(false);
          setCola((c) => c.filter((p) => p.ventaId !== pendiente.ventaId));
          setEstado({ tipo: 'ok', texto: `✓ Venta pendiente enviada (${pesos(pendiente.ticket.total)})` });
        } else {
          const d = await r.json().catch(() => ({}));
          // error de negocio (p.ej. sin stock): sacarla de la cola y avisar fuerte
          setCola((c) => c.filter((p) => p.ventaId !== pendiente.ventaId));
          setEstado({ tipo: 'error', texto: `⚠ Venta offline rechazada: ${d.message ?? 'error'} — revisala en Ventas` });
        }
      } catch {
        setSinRed(true); // sigue sin red: se reintenta en el próximo ciclo
      }
    }, 15000);
    return () => clearInterval(timer);
  }, [cola]);

  async function anularUltima() {
    if (!ultima) return;
    if (
      !(await confirmar({
        titulo: `¿Anular la última venta (${pesos(ultima.ticket.total)})?`,
        texto: 'Devuelve stock y emite nota de crédito.',
        variante: 'peligro',
        textoConfirmar: 'Anular',
      }))
    )
      return;
    try {
      const r = await fetch('/api/anular', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ventaId: ultima.ventaId }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.message ?? 'No se pudo anular');
      setEstado({ tipo: 'ok', texto: `✓ Venta anulada (${pesos(d.total)}) — stock devuelto y NC emitida` });
      setUltima(null);
    } catch (e) {
      setEstado({ tipo: 'error', texto: e instanceof Error ? e.message : 'No se pudo anular (requiere gerente)' });
    }
  }

  // Atajos de teclado (el equipo pidió operar con mínimo mouse).
  cobrarRef.current = cobrar;
  const estacionarRef = useRef<() => void>(() => {});
  estacionarRef.current = estacionar;
  const reimprimirRef = useRef<() => void>(() => {});
  reimprimirRef.current = () => { if (ultima) imprimir(ultima.ticket); };
  const stockRef = useRef<() => void>(() => {});
  stockRef.current = abrirStock;
  const escanearRef = useRef<(c: string) => void>(() => {});
  escanearRef.current = escanear;
  const modoCantidadRef = useRef<() => void>(() => {});
  modoCantidadRef.current = entrarModoCantidad;

  // Captura global del lector de código de barras: la pistola manda los dígitos
  // muy rápido y cierra con Enter. Si el foco NO está en un campo de texto (el
  // caso en que "pita pero no impacta"), armamos el código y lo escaneamos.
  // Si el foco está en el buscador u otro input, dejamos que lo maneje el campo.
  useEffect(() => {
    let buffer = '';
    let ultima = 0;
    let limpiar: any = null;
    function esEditable(el: Element | null) {
      if (!el) return false;
      const tag = el.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || (el as HTMLElement).isContentEditable;
    }
    function onScan(e: KeyboardEvent) {
      if (esEditable(document.activeElement)) return; // un input activo maneja lo suyo
      const ahora = Date.now();
      // C suelta (no parte de un escaneo): modo cantidad para el último producto
      if ((e.key === 'c' || e.key === 'C') && buffer.length === 0 && ahora - ultima > 120 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault(); modoCantidadRef.current?.(); return;
      }
      if (e.key === 'Enter') {
        if (buffer.length >= 3) { escanearRef.current?.(buffer); }
        buffer = '';
        return;
      }
      if (e.key.length === 1 && /[A-Za-z0-9\-*×]/.test(e.key)) {
        if (ahora - ultima > 120) buffer = ''; // gap grande = arranque de un escaneo nuevo
        ultima = ahora;
        buffer += e.key;
        clearTimeout(limpiar);
        limpiar = setTimeout(() => { buffer = ''; }, 250); // sin Enter en 250ms, se descarta
      }
    }
    window.addEventListener('keydown', onScan);
    return () => window.removeEventListener('keydown', onScan);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      switch (e.key) {
        case 'F9': // consultar stock en ambas sucursales
          e.preventDefault();
          stockRef.current?.();
          break;
        case 'F2': // ciclar comprobante A/B/R
          e.preventDefault();
          setComprobante((c) => (c === 'B' ? 'A' : c === 'A' ? 'R' : 'B'));
          break;
        case 'F3': // identificar cliente / cta cte
          e.preventDefault();
          dniRef.current?.focus();
          break;
        case 'F4': // ciclar medio de pago
          e.preventDefault();
          {
            const i = medios.findIndex((x) => x.id === medio && x.terminal === terminal);
            const prox = medios[(i + 1) % medios.length];
            setMedio(prox.id);
            setTerminal(prox.terminal);
          }
          break;
        case 'F6': // estacionar ticket
          e.preventDefault();
          estacionarRef.current?.();
          break;
        case 'F7': // mi turno: lo vendido, las facturas y el cambio de medio de pago
          e.preventDefault();
          setVerTurno((v) => !v);
          break;
        case 'F8': // reimprimir último ticket
          e.preventDefault();
          reimprimirRef.current?.();
          break;
        case 'F12': // cobrar
          e.preventDefault();
          cobrarRef.current?.();
          break;
        case 'F10': // salir al panel
          e.preventDefault();
          window.location.href = '/inicio';
          break;
        case 'Escape':
          setFoco(null);
          setModalStock(false);
          break;
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const lineaFoco = foco?.tipo === 'linea' ? carrito.find((r) => r.sku === foco.sku) || null : null;
  const pagoFoco = foco?.tipo === 'pago' ? pagos[foco.idx] : null;
  const tecladoVisible = !!lineaFoco || !!pagoFoco || esEfectivoSimple;

  // botón Cobrar: el mismo en la barra del celular y al pie de la columna en escritorio
  const cobrarDeshabilitado = carrito.length === 0 || cobrando || faltaCliente || (dividido && restante !== 0);
  const textoCobrar = cobrando ? 'Cobrando…' : usaCtaCte && !dividido ? `Cargar a cuenta ${pesos(totalFinal)}` : `Cobrar ${pesos(totalFinal)}`;

  // ✕ y Escape del modal de apertura/cierre: hacen lo mismo que su botón
  // (Listo en el arqueo, Cancelar en el cierre). La apertura no se cierra:
  // sin caja abierta no se vende (la salida es "Salir").
  const cerrarModalCaja = () => {
    if (arqueo) { setArqueo(null); setSesionCerradaId(null); setModalCaja('abrir'); }
    else if (modalCaja === 'cerrar') setModalCaja(null);
  };

  // ✕ del cobro con QR: lo mismo que el botón de cancelar/cerrar de cada paso.
  // Mientras se manda el importe o se registra la venta, no se cierra.
  const cobroMPOcupado = cobroMP?.estado === 'iniciando' || (cobroMP?.estado === 'aprobado' && (cobrando || estado?.tipo !== 'error'));
  const cerrarCobroMP = () => {
    if (cobroMP?.estado === 'esperando') cancelarCobroMP();
    else fijarCobroMP(null);
  };

  return (
    <main className="flex min-h-dvh flex-col bg-crema print:hidden lg:h-dvh lg:overflow-hidden">
      <header className="flex shrink-0 flex-col gap-2 bg-tinta px-3 py-2 sm:px-4 lg:flex-row lg:items-center lg:justify-between lg:py-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-medium tracking-widest text-white">
            O.D.B <span className="font-normal tracking-normal text-crema/70">· Caja</span>
          </span>
          {sesion && <span className="rounded-full bg-white/10 px-2.5 py-1 text-xs text-crema/80">{sesion.cajaNombre}</span>}
          {sinRed && <span className="rounded-full bg-marca px-2.5 py-1 text-xs font-semibold text-white">SIN RED · {cola.length} en cola</span>}
          {!sinRed && cola.length > 0 && <span className="rounded-full bg-atencion px-2.5 py-1 text-xs font-semibold text-white">{cola.length} por enviar</span>}
        </div>
        {/* en el celular, una sola fila que se desliza de costado (solo íconos) */}
        <div className="-mx-3 flex items-center gap-2 overflow-x-auto px-3 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0 lg:justify-end [&::-webkit-scrollbar]:hidden">
          <button
            type="button"
            onClick={() => setAutoPrint((a) => !a)}
            title={autoPrint ? 'Impresión automática: SÍ' : 'Impresión automática: NO'}
            aria-label={autoPrint ? 'Impresión automática: SÍ' : 'Impresión automática: NO'}
            aria-pressed={autoPrint}
            className={unir(BOTON_CABECERA, autoPrint ? 'bg-white/20 text-white' : 'bg-white/10 text-white/60')}
          >
            <IconoCaja d={ICONO.imprimir} />
            <span className="hidden sm:inline">{autoPrint ? 'Auto' : 'Manual'}</span>
          </button>
          <select
            value={sucursalId}
            onChange={(e) => setSucursalId(e.target.value)}
            aria-label="Sucursal"
            className="min-h-11 max-w-44 shrink-0 rounded-xl bg-white/10 px-3 text-sm text-crema focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/70 sm:min-h-10"
          >
            {sucursales.map((s) => (
              <option key={s.id} value={s.id} className="text-tinta">{s.nombre}</option>
            ))}
          </select>
          {sesion && (
            <button type="button" onClick={() => { setModalExtra('movimiento'); setMovMonto(''); setMovMotivo(''); }} className={unir(BOTON_CABECERA, 'bg-white/10 text-crema/80')} title="Ingreso / retiro de efectivo" aria-label="Movimiento de efectivo">
              <IconoCaja d={ICONO.efectivo} />
              <span className="hidden sm:inline">Mov.</span>
            </button>
          )}
          {sesion && (
            <button type="button" onClick={() => setVerTurno(true)} className={unir(BOTON_CABECERA, 'bg-white/10 text-crema/80')} title="Lo que vendiste en este turno: tickets, facturas y medios de pago (F7)" aria-label="Mi turno">
              <IconoCaja d={ICONO.turno} />
              <span className="hidden sm:inline">Mi turno</span>
            </button>
          )}
          <button type="button" onClick={abrirStock} className={unir(BOTON_CABECERA, 'bg-white/10 text-crema/80')} title="Consultar stock en ambas sucursales (F9)" aria-label="Stock">
            <IconoCaja d={ICONO.stock} />
            <span className="hidden sm:inline">Stock</span>
          </button>
          <button type="button" onClick={abrirDevolucion} className={unir(BOTON_CABECERA, 'bg-white/10 text-crema/80')} title="Devolución de una venta" aria-label="Devolución">
            <IconoCaja d={ICONO.devolucion} />
            <span className="hidden sm:inline">Dev.</span>
          </button>
          {sesion && (
            <button type="button" onClick={() => { setModalCaja('cerrar'); setMontoBuf(''); }} className={unir(BOTON_CABECERA, 'bg-white/10 text-crema/80')} aria-label="Cerrar caja">
              <IconoCaja d={ICONO.candado} />
              <span className="hidden sm:inline">Cerrar caja</span>
            </button>
          )}
          <Link href="/inicio" className={unir(BOTON_CABECERA, 'bg-white/10 text-crema/80')} aria-label="Panel">
            <IconoCaja d={ICONO.panel} />
            <span className="hidden sm:inline">Panel</span>
          </Link>
        </div>
      </header>
      {devPedido && (
        <div className={'flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm ' + (devPedido.estado === 'pendiente' ? 'bg-atencion-suave text-atencion' : devPedido.estado === 'aprobada' ? 'bg-ok-suave text-ok' : 'bg-marca-suave text-marca-hondo')}>
          {devPedido.estado === 'pendiente' && <><span className="inline-block size-2.5 animate-pulse rounded-full bg-atencion motion-reduce:animate-none" /><b>Devolución de {pesos(devPedido.monto)} esperando autorización</b><span>{(devPedido.avisados ?? []).length ? `Avisados: ${devPedido.avisados!.join(', ')}` : 'Los supervisores ya tienen el aviso'}</span></>}
          {devPedido.estado === 'aprobada' && <><b className="inline-flex items-center gap-1"><IconoOk className="size-4 shrink-0" />Devolución de {pesos(devPedido.monto)} autorizada{devPedido.resueltaPor ? ` por ${devPedido.resueltaPor}` : ''}</b><span>Stock repuesto{devPedido.resultado?.nc ? ` · ${fmtNumero(devPedido.resultado.nc)}` : ''}{devPedido.resultado?.egreso ? ' · egreso de caja registrado: entregá el efectivo' : ''}</span></>}
          {devPedido.estado === 'rechazada' && <><b>Devolución de {pesos(devPedido.monto)} rechazada{devPedido.resueltaPor ? ` por ${devPedido.resueltaPor}` : ''}</b>{devPedido.respuesta && <span>«{devPedido.respuesta}»</span>}</>}
          {devPedido.estado === 'error' && <><b>La devolución fue autorizada pero no se pudo ejecutar</b><span>{devPedido.error}. Avisá a un supervisor.</span></>}
          {devPedido.estado !== 'pendiente' && <button type="button" onClick={() => setDevPedido(null)} className={unir('ml-auto inline-flex min-h-9 items-center rounded-sm text-xs font-semibold underline', FOCO)}>Cerrar</button>}
        </div>
      )}

      {/* tickets estacionados: la barra del "segundo cliente" */}
      {estacionados.length > 0 && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 px-3 pt-2">
          <span className={ROTULO}>En espera</span>
          {estacionados.map((e) => (
            <button
              key={e.id}
              type="button"
              onClick={() => retomar(e.id)}
              className={unir('inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-xl border border-atencion/30 bg-atencion-suave px-3 text-sm font-medium text-atencion active:scale-[0.98] sm:min-h-10', FOCO)}
            >
              <IconoCaja d={ICONO.pausa} className="size-4 shrink-0" />
              <span className="truncate">{e.etiqueta} · {e.carrito.reduce((s, r) => s + r.cantidad, 0)} u.</span>
            </button>
          ))}
        </div>
      )}

      {/* PASO 1: qué comprobante + a quién (lo primero que define el cajero) */}
      <div className="shrink-0 px-3 pt-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl bg-white px-3 py-2.5 shadow-tarjeta">
          <div className="flex items-center gap-2">
            <span className={unir(ROTULO, 'hidden sm:inline')}>Comprobante</span>
            <div className="flex gap-1.5">
              {COMPROBANTES.map((c) => {
                const on = comprobante === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setComprobante(c.id)}
                    className={unir(
                      'min-h-11 rounded-xl border-2 px-3.5 py-1.5 text-left transition active:scale-[0.98]',
                      on ? 'border-tinta bg-tinta text-white' : 'border-transparent bg-crema text-tinta',
                      FOCO,
                    )}
                  >
                    <span className="text-xl font-bold leading-none">{c.label}</span>
                    <span className={'block text-xs leading-tight ' + (on ? 'text-white/70' : 'text-tinta/60')}>{c.desc}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="relative flex w-full min-w-0 items-center gap-2 sm:ml-auto sm:w-auto">
            <span className={'hidden text-xs font-semibold uppercase tracking-[0.08em] sm:inline ' + (requiereCliente ? 'text-marca-hondo' : 'text-tinta/60')}>
              Cliente{requiereCliente ? ' *' : ''}
            </span>
            <div className="min-w-0 flex-1 sm:w-48 sm:flex-none">
              <Entrada
                ref={dniRef}
                value={dni}
                onChange={(e) => onCambioCliente(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && buscarCliente()}
                placeholder={requiereCliente ? 'DNI o nombre (requerido)' : 'DNI o nombre (opcional)'}
                aria-label="Cliente: DNI o nombre"
                invalido={faltaCliente && comprobante !== 'A'}
              />
            </div>
            <Boton variante="secundario" onClick={() => buscarCliente()}>Buscar</Boton>
            {clientes.length > 0 && (
              <div className="absolute right-0 top-full z-contenido mt-1 w-full overflow-hidden rounded-xl border border-black/[0.06] bg-white shadow-flotante sm:w-72">
                {clientes.map((c) => (
                  <button key={c.dni} type="button" onClick={() => buscarCliente(c.dni)} className="min-h-11 w-full border-b border-black/[0.06] px-3 py-2.5 text-left text-sm text-tinta last:border-0 hover:bg-crema focus-visible:bg-crema focus-visible:outline-none">
                    <span className="font-medium">{c.nombre}</span>
                    <span className="text-tinta/60"> · DNI {c.dni}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Alta de WhatsApp: aparece solo cuando el cliente está identificado y
            todavía no dio el permiso. La lista de difusión se construye acá, de
            a un cliente por vez, con su consentimiento fechado. */}
        {cliente?.existe && waHecho !== 'alta' && (
          <div className="mt-1.5 flex flex-wrap items-center gap-2 rounded-2xl bg-white px-3 py-2 shadow-tarjeta">
            <span className="text-xs font-semibold uppercase tracking-[0.08em] text-dorado-hondo">WhatsApp</span>
            {waHecho === 'baja' ? (
              <span className="text-sm text-tinta/60">Listo, no le mandamos nada.</span>
            ) : (
              <>
                <div className="w-40">
                  <Entrada
                    value={waTel}
                    onChange={(e) => setWaTel(e.target.value.replace(/[^\d]/g, ''))}
                    placeholder="11 2345 6789"
                    inputMode="numeric"
                    aria-label="WhatsApp del cliente"
                  />
                </div>
                <span className="text-sm text-tinta/70">¿Le mandamos ofertas y novedades?</span>
                <Boton
                  tamano="chico"
                  onClick={() => guardarWhatsapp(true)}
                  disabled={waGuardando || waTel.replace(/\D/g, '').length < 10}
                >
                  {waGuardando ? 'Guardando…' : 'Sí, sumar'}
                </Boton>
                <Boton variante="fantasma" tamano="chico" onClick={() => guardarWhatsapp(false)} disabled={waGuardando}>
                  No quiere
                </Boton>
              </>
            )}
          </div>
        )}

        {/* Factura A: datos del receptor (CUIT obligatorio) */}
        {comprobante === 'A' && (
          <div className="mt-1.5 flex flex-wrap items-center gap-2 rounded-2xl bg-white px-3 py-2 shadow-tarjeta">
            <span className="text-xs font-semibold uppercase tracking-[0.08em] text-marca-hondo">Receptor A *</span>
            <div className="w-full sm:w-48">
              <Entrada
                value={receptorCuit}
                onChange={(e) => setReceptorCuit(e.target.value.replace(/[^\d-]/g, ''))}
                placeholder="CUIT (20-12345678-9)"
                inputMode="numeric"
                aria-label="CUIT del receptor"
                invalido={faltaCliente}
              />
            </div>
            <div className="min-w-0 flex-1 basis-40">
              <Entrada
                value={receptorNombre}
                onChange={(e) => setReceptorNombre(e.target.value)}
                placeholder="Razón social"
                aria-label="Razón social del receptor"
              />
            </div>
          </div>
        )}
        {cliente && (
          <p className={'mt-1.5 inline-block max-w-full rounded-xl px-3 py-1.5 text-sm ' + (cliente.existe ? 'bg-tinta text-white' : 'bg-white text-tinta')}>
            {cliente.existe ? `${cliente.nombre ? cliente.nombre + ' · ' : ''}${cliente.tipo} · ${cliente.compras} compras · ticket ${pesos(cliente.ticketPromedio)}` : 'Cliente nuevo: se registra con esta venta'}
          </p>
        )}

        {/* PERFIL DE COMPRA. Con 3 compras el sistema ya sabe qué lleva este
            cliente y cada cuánto viene: el cajero lo usa para atenderlo por su
            nombre ("¿le pongo el de siempre?"). Antes de la tercera, se avisa
            cuántas faltan en vez de inventar un perfil con una sola visita. */}
        {cliente?.existe && cliente.perfil && (
          <div className="mt-1.5 max-w-2xl rounded-xl border border-black/[0.06] bg-white/95 px-3 py-2">
            <p className={ROTULO}>
              Suele llevar
              {cliente.perfil.cadaCuantosDias ? ` · viene cada ${cliente.perfil.cadaCuantosDias} días` : ''}
              {cliente.perfil.diasDesdeUltima != null ? ` · última hace ${cliente.perfil.diasDesdeUltima}` : ''}
            </p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {cliente.perfil.habituales.slice(0, 5).map((h) => (
                <button
                  key={h.sku}
                  type="button"
                  onClick={() => agregarPorSku(h.sku)}
                  title={`Lo llevó en ${h.veces} compras · tocá para agregarlo`}
                  className={unir('relative inline-flex min-h-9 max-w-full items-center rounded-full bg-crema px-3 text-xs text-tinta before:absolute before:inset-x-0 before:-inset-y-1 hover:bg-marca hover:text-white sm:before:hidden', FOCO)}
                >
                  <span className="truncate">{h.nombre}</span>
                </button>
              ))}
              {!cliente.perfil.habituales.length && <span className="text-xs text-tinta/60">todavía sin un producto que repita</span>}
            </div>
            {cliente.perfil.rubros?.length > 0 && (
              <p className="mt-1 text-xs text-tinta/60">
                {cliente.perfil.rubros.slice(0, 3).map((r) => `${r.rubro} ${r.pct}%`).join(' · ')}
              </p>
            )}
          </div>
        )}
        {cliente?.existe && !cliente.perfil && (cliente.faltanParaPerfil ?? 0) > 0 && (
          <p className="mt-1.5 text-xs text-tinta/60">
            {cliente.faltanParaPerfil === 1
              ? 'Con una compra más, el sistema arma su perfil.'
              : `Faltan ${cliente.faltanParaPerfil} compras para armar su perfil.`}
          </p>
        )}

        {/* CUENTA CORRIENTE. El cajero tiene que poder decirle al cliente, sin
            salir de la venta: "debías tanto, con lo de hoy es tanto". Antes ese
            dato no aparecía en ningún lado de la caja y había que ir a buscarlo
            a otra pantalla — o sea, no se lo decía nadie. */}
        {cliente?.existe && cliente.ctaCte?.habilitada && (
          <div className="mt-1.5 inline-flex max-w-full flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-marca/20 bg-marca-suave px-3 py-2 text-marca-hondo">
            <span className="text-xs font-semibold uppercase tracking-[0.08em]">Cuenta corriente</span>
            <span className="text-sm">
              Saldo anterior <b className="importe text-base">{pesos(cliente.ctaCte.saldo)}</b>
            </span>
            {total > 0 && (
              <span className="text-sm">
                Con esta venta <b className="importe text-base">{pesos(cliente.ctaCte.saldo + totalFinal)}</b>
              </span>
            )}
            {cliente.ctaCte.disponible != null && (
              <span className="text-xs text-tinta/70">
                disponible {pesos(cliente.ctaCte.disponible)} de {pesos(cliente.ctaCte.limite)}
              </span>
            )}
            <Boton
              variante="secundario"
              tamano="chico"
              onClick={() => setCobro(cobro ? null : { monto: '', medio: 'efectivo', nota: '', mandando: false, listo: false, error: '' })}
            >
              Dejó un pago
            </Boton>
          </div>
        )}

        {/* Pago a cuenta: queda PENDIENTE hasta que lo apruebe el dueño. El
            cajero nunca toca la cuenta corriente — toma el pago, avisa, sigue. */}
        {cobro && cliente?.existe && (
          <div className="mt-1.5 max-w-xl rounded-xl border-2 border-marca/30 bg-white p-3">
            {cobro.listo ? (
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ok">
                <span className="inline-flex items-center gap-1"><IconoOk className="size-4 shrink-0" />Registrado. Le avisamos a Juan Pablo: cuando lo apruebe, se descuenta de la cuenta.</span>
                <Boton variante="fantasma" tamano="chico" onClick={() => setCobro(null)}>cerrar</Boton>
              </p>
            ) : (
              <>
                <p className="mb-2 text-sm text-tinta/70">
                  El pago <b>no</b> baja la deuda todavía: queda para que lo apruebe Juan Pablo.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="w-32">
                    <Entrada
                      value={cobro.monto}
                      onChange={(e) => setCobro({ ...cobro, monto: e.target.value })}
                      type="number" inputMode="decimal" placeholder="$ monto" autoFocus
                      aria-label="Monto del pago"
                    />
                  </div>
                  <Selector value={cobro.medio} onChange={(e) => setCobro({ ...cobro, medio: e.target.value })} aria-label="Medio del pago" className="w-44">
                    <option value="efectivo">Efectivo</option>
                    <option value="transferencia">Transferencia</option>
                    <option value="tarjeta">Tarjeta / posnet</option>
                    <option value="cheque">Cheque</option>
                  </Selector>
                  <div className="min-w-0 flex-1 basis-32">
                    <Entrada
                      value={cobro.nota}
                      onChange={(e) => setCobro({ ...cobro, nota: e.target.value })}
                      placeholder="Nota (opcional)"
                      aria-label="Nota del pago"
                    />
                  </div>
                  <Boton onClick={tomarCobro} cargando={cobro.mandando}>
                    Registrar
                  </Boton>
                </div>
                {cobro.error && <p role="alert" className="mt-1.5 text-sm font-medium text-marca-hondo">{cobro.error}</p>}
              </>
            )}
          </div>
        )}
      </div>

      <div className="grid flex-1 grid-cols-1 gap-3 p-3 lg:min-h-0 lg:grid-cols-[1fr_420px] lg:overflow-hidden">
        {/* IZQUIERDA: búsqueda + carrito */}
        <section className="flex min-w-0 flex-col rounded-2xl bg-white p-3 shadow-tarjeta lg:min-h-0 lg:overflow-hidden">
          <div className="relative shrink-0">
            <input
              ref={inputRef}
              value={busqueda}
              onChange={(e) => onBuscar(e.target.value)}
              onKeyDown={onKeyBuscar}
              placeholder="Escaneá o buscá un producto…"
              aria-label="Escaneá o buscá un producto"
              autoFocus
              inputMode="search"
              className="w-full rounded-2xl border-2 border-marca bg-white px-4 py-3.5 text-lg text-tinta outline-none placeholder:text-tinta/40 focus:ring-4 focus:ring-marca/15 sm:px-5 sm:py-4"
            />
            {buscando && <span className="absolute right-5 top-1/2 -translate-y-1/2 text-sm text-tinta/60">buscando…</span>}
            {modoCantidad && (
              <span className="absolute right-3 top-1/2 flex max-w-[calc(100%-2rem)] -translate-y-1/2 items-center gap-2 rounded-full bg-tinta px-3 py-1 text-sm font-semibold text-crema">
                <span className="min-w-0 truncate">Cantidad{ultimoSku && carrito.some((r) => r.sku === ultimoSku) ? ` de ${carrito.find((r) => r.sku === ultimoSku)?.nombre}` : ' para el próximo'}: {cantidadTecleada ?? '…'}</span> <span className="shrink-0 font-normal text-crema/60">Enter</span>
              </span>
            )}
            {multiplicador && !buscando && !modoCantidad && (
              <span className="absolute right-3 top-1/2 flex max-w-[calc(100%-2rem)] -translate-y-1/2 items-center gap-1 rounded-full bg-tinta py-1 pl-3 pr-1 text-sm font-semibold text-crema">
                ×{multiplicador} al próximo
                <button type="button" onClick={() => setMultiplicador(null)} aria-label="Cancelar cantidad" className="grid size-8 place-items-center rounded-full text-crema/70 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70">
                  <IconoCerrar className="size-4" />
                </button>
              </span>
            )}
            {resultados.length > 0 && (
              <div className="absolute z-contenido mt-1 w-full overflow-hidden rounded-2xl border border-black/[0.06] bg-white shadow-flotante">
                {resultados.map((p) => {
                  const sinStock = p.stock != null && p.stock <= 0;
                  const pocoStock = p.stock != null && p.stock > 0 && p.stock <= 3;
                  return (
                  <button
                    key={p.sku}
                    type="button"
                    onClick={() => agregar(p)}
                    className={`flex w-full items-center justify-between gap-3 border-b border-black/[0.06] px-3 py-3 text-left last:border-0 focus-visible:outline-none sm:px-4 sm:py-3.5 ${sinStock ? 'bg-marca-suave text-marca-hondo hover:bg-marca/15 focus-visible:bg-marca/15 active:bg-marca/15' : 'text-tinta hover:bg-crema focus-visible:bg-crema active:bg-crema'}`}
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      {p.imagenUrl && <img src={p.imagenUrl} alt="" className="size-11 shrink-0 rounded-xl object-cover" />}
                      <span className="min-w-0">
                        <span className="block min-w-0 break-words text-base">{p.nombre}</span>
                        {p.activo === false && <span className="block text-xs font-semibold text-tinta/70">Dado de baja · se reconoce pero no se vende</span>}
                        {sinStock && p.activo !== false && <span className="block text-xs font-semibold text-marca-hondo">Sin stock en {sucursalNombre}{p.sinStockDesde ? ` · se terminó el ${fechaCorta(p.sinStockDesde)} (${haceDias(p.sinStockDesde)})` : ''}</span>}
                        {pocoStock && <span className="text-xs text-tinta/60">Quedan {Math.round(p.stock as number)} u.</span>}
                        {codigoPendiente && p.activo !== false && (
                          <span role="button" tabIndex={0} onClick={(e) => { e.stopPropagation(); vincularCodigo(p); }} onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); vincularCodigo(p); } }}
                            className="mt-1 inline-block rounded-full bg-tinta px-3 py-1.5 text-xs font-semibold text-crema hover:bg-tinta/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marca">
                            {codigoPendiente.startsWith('PLU:') ? `Vincular PLU ${codigoPendiente.slice(4).split('|')[0]}${codigoPendiente.endsWith('|kg') ? ' (por peso)' : ''}` : `Vincular este código (${codigoPendiente})`}
                          </span>
                        )}
                      </span>
                      {p.esAlcohol && <span className="shrink-0 rounded-full bg-tinta px-1.5 py-0.5 text-xs text-white">+18</span>}
                    </span>
                    <span className="importe shrink-0 text-lg font-semibold">{pesos(p.precio)}</span>
                  </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* carrito: en el celular cada renglón va en dos líneas (nombre arriba,
              cantidad y total abajo) para que nada se salga del ancho */}
          <div className="-mx-1 mt-3 px-1 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
            {carrito.length === 0 && (
              <div className="flex min-h-32 items-center justify-center text-center text-base text-tinta/60 lg:h-full">
                Escaneá un producto para empezar
              </div>
            )}
            {carrito.map((r) => {
              const sel = foco?.tipo === 'linea' && foco.sku === r.sku;
              return (
                <div
                  key={r.sku}
                  className={`mb-2 flex flex-wrap items-center gap-2 rounded-xl border-2 px-3 py-2.5 sm:flex-nowrap ${sel ? 'border-marca bg-marca-suave' : 'border-transparent bg-crema/50'}`}
                >
                  <button type="button" onClick={() => seleccionarLinea(r.sku)} className={unir('order-1 min-w-0 flex-1 basis-[calc(100%-3rem)] rounded-xl text-left sm:order-none sm:basis-auto', FOCO)}>
                    <p className="break-words font-medium leading-tight text-tinta">
                      {r.nombre}
                      {r.stock != null && r.stock <= 0 && <span className="ml-2 inline-block rounded-full bg-marca/15 px-2 py-0.5 align-middle text-xs font-semibold text-marca-hondo">sin stock{r.sinStockDesde ? ` · desde el ${fechaCorta(r.sinStockDesde)}` : ''}</span>}
                    </p>
                    <p className="text-xs text-tinta/60">{pesos(precioDe(r))} {r.porPeso ? 'el kilo' : 'c/u'}{mayorista && r.precioMayorista != null ? ' · may.' : ''}{r.descuento ? ` · ${r.descuento}` : ''}{sel ? ' · tocá los números para la cantidad' : ''}</p>
                  </button>
                  {!r.porPeso && <button type="button" onClick={() => cambiarCantidad(r.sku, -1)} className={unir('order-3 size-11 shrink-0 rounded-xl border border-black/15 bg-white text-2xl text-tinta active:scale-95 sm:order-none sm:size-12', FOCO)} aria-label="Restar">−</button>}
                  <input
                    type="number" inputMode={r.porPeso ? 'decimal' : 'numeric'} min={r.porPeso ? 0.001 : 1} max={999} step={r.porPeso ? 0.001 : 1} value={r.cantidad}
                    onFocus={(e) => e.currentTarget.select()}
                    onChange={(e) => { const v = Number(e.target.value); const n = r.porPeso ? Math.max(0.001, Math.min(999, Math.round((v || 0.001) * 1000) / 1000)) : Math.max(1, Math.min(999, Math.round(v || 1))); setCarrito((c) => c.map((x) => (x.sku === r.sku ? { ...x, cantidad: n } : x))); }}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); (e.target as HTMLInputElement).blur(); inputRef.current?.focus(); } }}
                    aria-label="Cantidad"
                    data-cantidad-de={r.sku}
                    title="Escribí la cantidad y Enter"
                    className="order-3 h-11 w-16 shrink-0 rounded-xl border border-black/15 bg-white text-center [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none text-xl font-bold tabular-nums text-tinta outline-none focus:border-marca focus:ring-4 focus:ring-marca/15 sm:order-none sm:h-12 sm:w-20 sm:text-2xl"
                  />
                  {r.porPeso ? <span className="order-3 w-11 shrink-0 text-center text-sm text-tinta/60 sm:order-none sm:w-12">kg</span> : <button type="button" onClick={() => cambiarCantidad(r.sku, 1)} className={unir('order-3 size-11 shrink-0 rounded-xl bg-crema-hondo text-2xl text-tinta active:scale-95 sm:order-none sm:size-12', FOCO)} aria-label="Sumar">+</button>}
                  <span className="importe order-3 ml-auto shrink-0 text-right text-lg font-bold text-tinta sm:order-none sm:w-28 sm:text-xl">{pesos(precioDe(r) * r.cantidad)}</span>
                  <button type="button" onClick={() => quitar(r.sku)} className={unir('order-2 grid h-11 w-10 shrink-0 place-items-center self-start rounded-xl text-tinta/60 hover:text-marca-hondo active:text-marca sm:order-none sm:h-12 sm:self-center', FOCO)} aria-label="Quitar">
                    <IconoCerrar className="size-6" />
                  </button>
                </div>
              );
            })}
          </div>

          {/* acciones del ticket actual */}
          {carrito.length > 0 && (
            <div className="flex shrink-0 flex-wrap gap-2 pt-2">
              <Boton variante="secundario" onClick={estacionar} icono={<IconoCaja d={ICONO.pausa} className="size-4" />}>
                Estacionar (F6)
              </Boton>
              <Boton
                variante="fantasma"
                onClick={async () => { if (await confirmar({ titulo: '¿Vaciar el ticket actual?', variante: 'peligro', textoConfirmar: 'Vaciar' })) limpiarVenta(); }}
              >
                Vaciar
              </Boton>
            </div>
          )}
        </section>

        {/* DERECHA: total + medios + teclado + cobrar */}
        <section className="flex min-w-0 flex-col gap-3 rounded-2xl bg-white p-3 shadow-tarjeta lg:min-h-0 lg:overflow-y-auto">
          {/* total */}
          <div className="rounded-xl bg-tinta px-4 py-3 text-white">
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-white/70">{unidades} u.</span>
              {subtotalLista > total && <span className="importe text-xs text-crema/60 line-through">{pesos(subtotalLista)}</span>}
            </div>
            <div className="mt-0.5 flex items-baseline justify-between gap-3">
              <span className="text-sm text-white/70">Total</span>
              <span className="importe text-4xl font-bold">{pesos(totalFinal)}</span>
            </div>
            {descuento && (
              <div className="mt-1 flex items-center justify-between gap-2 rounded-xl bg-white/10 py-0.5 pl-2 pr-0.5">
                <span className="text-xs text-ok-suave">Desc. {pesos(descuento.monto)} · aut. {descuento.nombre}</span>
                <button type="button" onClick={() => setDescuento(null)} aria-label="Quitar descuento" className="grid size-9 place-items-center rounded-xl text-white/60 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70">
                  <IconoCerrar className="size-4" />
                </button>
              </div>
            )}
            {mayorista && (
              <div className="mt-1 rounded-xl bg-dorado/25 px-2 py-1 text-center text-xs font-semibold tracking-wide text-dorado">
                PRECIO MAYORISTA
              </div>
            )}
          </div>

          {/* toggle mayorista: cambia la lista de precios de toda la venta */}
          <button
            type="button"
            aria-pressed={mayorista}
            onClick={() => setMayorista((v) => !v)}
            className={unir(
              'min-h-11 rounded-xl border-2 py-2.5 text-sm font-semibold active:scale-[0.98]',
              mayorista ? 'border-dorado bg-dorado text-tinta' : 'border-black/10 bg-white text-tinta/70',
              FOCO,
            )}
          >
            {mayorista ? '★ Vendiendo MAYORISTA' : 'Precio mayorista'}
          </button>

          {carrito.length > 0 && !descuento && (
            <button
              type="button"
              onClick={() => { setModalExtra('descuento'); setDescBuf(''); setPinBuf(''); }}
              className={unir('-mt-1 inline-flex min-h-9 items-center self-end rounded-sm text-xs font-semibold text-marca-hondo underline underline-offset-2', FOCO)}
            >
              % Descuento con autorización
            </button>
          )}

          {/* medios: camino rápido (1 toque) o dividido (chips) */}
          {!dividido ? (
            <>
              {/* Sin red, solo EFECTIVO. El posnet y el QR están muertos igual
                  (necesitan internet propio), y la cuenta corriente sería vender
                  a ciegas: el saldo y el tope no se pueden verificar hasta que
                  vuelva la conexión, y el rechazo llegaría con el cliente ya ido. */}
              {sinRed && (
                <p className="rounded-xl bg-marca-suave px-3 py-2 text-xs font-medium text-marca-hondo">
                  Sin conexión: solo efectivo. La venta queda guardada en esta máquina y se envía sola al volver la red.
                </p>
              )}
              <div className="grid grid-cols-2 gap-2">
                {medios.map((m) => {
                  const bloqueado = sinRed && m.id !== 'efectivo';
                  const elegido = medio === m.id && terminal === m.terminal;
                  return (
                  <button
                    key={m.id + (m.terminal ?? '')}
                    type="button"
                    disabled={bloqueado}
                    aria-pressed={elegido}
                    title={bloqueado ? 'Sin conexión: solo efectivo' : undefined}
                    onClick={() => { setMedio(m.id); setTerminal(m.terminal); }}
                    className={unir(
                      'min-h-12 rounded-xl border-2 px-2 py-3 text-base font-medium active:scale-[0.98] disabled:opacity-30',
                      elegido ? 'border-tinta bg-tinta text-white' : 'border-black/10 bg-white text-tinta',
                      FOCO,
                    )}
                  >
                    {m.label}
                  </button>
                  );
                })}
              </div>
              <div className="-mt-1 flex flex-wrap items-center justify-between gap-x-3">
                {NOTA_MEDIO[medio] ? <p className="min-w-0 flex-1 text-xs text-tinta/60">{medio === 'tarjeta' && terminal ? `Cobrá en el posnet ${TERMINAL_LABEL[terminal] ?? terminal}` : NOTA_MEDIO[medio]}</p> : <span />}
                <button type="button" onClick={activarDividido} className={unir('inline-flex min-h-9 shrink-0 items-center rounded-sm text-xs font-semibold text-marca-hondo underline underline-offset-2', FOCO)}>
                  Dividir pago
                </button>
              </div>
            </>
          ) : (
            <div className="flex flex-col gap-1.5 rounded-xl border-2 border-black/10 p-2">
              <div className="flex items-center justify-between gap-2 px-1">
                <span className={ROTULO}>Pago dividido</span>
                <button type="button" onClick={salirDividido} className={unir('inline-flex min-h-9 items-center rounded-sm text-xs text-tinta/60 underline', FOCO)}>volver a un solo medio</button>
              </div>
              {pagos.map((p, i) => {
                const sel = foco?.tipo === 'pago' && foco.idx === i;
                return (
                  <div key={i} className={'flex items-center gap-2 rounded-xl border-2 py-1 pl-3 pr-1 ' + (sel ? 'border-marca bg-marca-suave' : 'border-transparent bg-crema/60')}>
                    <span className="min-w-0 flex-1 break-words text-sm font-medium">{p.medio === 'tarjeta' && p.terminal ? `Tarjeta ${TERMINAL_LABEL[p.terminal] ?? p.terminal}` : MEDIO_LABEL[p.medio] ?? p.medio}</span>
                    <button type="button" onClick={() => { setFoco({ tipo: 'pago', idx: i }); setCantBuf(''); }} className={unir('importe min-h-11 shrink-0 rounded-xl px-1 text-lg font-semibold', FOCO)}>
                      {pesos(p.monto)}
                    </button>
                    <button type="button" onClick={() => quitarPago(i)} className={unir('grid size-11 shrink-0 place-items-center rounded-xl text-tinta/60 hover:text-marca-hondo', FOCO)} aria-label="Quitar pago">
                      <IconoCerrar className="size-5" />
                    </button>
                  </div>
                );
              })}
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                {medios.map((m) => (
                  <button key={m.id + (m.terminal ?? '')} type="button" onClick={() => agregarPago(m)} className={unir('min-h-11 rounded-xl border border-black/10 bg-white px-1 py-2 text-xs font-medium active:scale-[0.98]', FOCO)}>
                    + {m.label}
                  </button>
                ))}
              </div>
              <p className={'flex items-center justify-center gap-1 text-center text-sm font-semibold ' + (restante === 0 ? 'text-ok' : 'text-marca-hondo')}>
                {restante === 0 ? <><IconoOk className="size-4 shrink-0" />Pagos completos</> : restante > 0 ? `Falta asignar ${pesos(restante)}` : `Sobran ${pesos(-restante)}`}
              </p>
            </div>
          )}

          {/* display del teclado: cantidad / monto de pago / paga con */}
          {tecladoVisible && (
            <div className="flex items-center justify-between gap-2 rounded-xl bg-crema/60 px-4 py-2.5">
              {lineaFoco ? (
                <>
                  <span className="mr-2 min-w-0 break-words text-sm text-tinta/70">Cantidad · {lineaFoco.nombre}</span>
                  <span className="importe text-2xl font-semibold">{lineaFoco.cantidad}</span>
                </>
              ) : pagoFoco ? (
                <>
                  <span className="mr-2 truncate text-sm text-tinta/70">Monto · {MEDIO_LABEL[pagoFoco.medio]}</span>
                  <span className="importe text-2xl font-semibold">{pesos(pagoFoco.monto)}</span>
                </>
              ) : (
                <>
                  <span className="text-sm text-tinta/70">Paga con</span>
                  <span className="importe text-2xl font-semibold">{pagaCon ? pesos(pagaConN) : '$0'}</span>
                </>
              )}
            </div>
          )}

          {/* atajos de efectivo */}
          {!lineaFoco && !pagoFoco && esEfectivoSimple && (
            <div className="grid grid-cols-4 gap-2">
              <button type="button" onClick={() => setPagaCon(String(total))} className={unir('min-h-11 rounded-xl border border-ok/20 bg-ok-suave py-2.5 text-sm font-semibold text-ok active:scale-[0.98]', FOCO)}>Justo</button>
              {[1000, 2000, 5000].map((n) => (
                <button key={n} type="button" onClick={() => sumarCash(n)} className={unir('min-h-11 rounded-xl border border-black/10 bg-white py-2.5 text-sm font-medium active:scale-[0.98]', FOCO)}>+{n / 1000}k</button>
              ))}
            </div>
          )}

          {/* teclado numérico */}
          {tecladoVisible && (
            <div className="grid grid-cols-3 gap-2">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'].map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => tecla(k)}
                  aria-label={k === 'C' ? 'Borrar todo' : k === '⌫' ? 'Borrar' : undefined}
                  className={unir(
                    'rounded-xl py-3.5 text-2xl font-medium active:scale-95 sm:py-4',
                    k === 'C' ? 'bg-marca-suave text-marca-hondo' : k === '⌫' ? 'bg-tinta/5 text-tinta' : 'bg-crema text-tinta',
                    FOCO,
                  )}
                >
                  {k}
                </button>
              ))}
            </div>
          )}

          {vuelto != null && (
            <div className={`importe rounded-xl px-4 py-3 text-center text-lg font-semibold ${vuelto < 0 ? 'bg-marca-suave text-marca-hondo' : 'bg-ok-suave text-ok'}`}>
              {vuelto < 0 ? `Faltan ${pesos(-vuelto)}` : `Vuelto ${pesos(vuelto)}`}
            </div>
          )}

          {faltaCliente && (
            <p className="rounded-xl bg-marca-suave px-3 py-2 text-center text-sm text-marca-hondo">
              {comprobante === 'A' ? 'Factura A: cargá el CUIT del receptor' : 'Cuenta corriente: identificá al cliente (F3)'}
            </p>
          )}

          {/* Pedir el DNI ANTES de cobrar. Sin DNI la venta no queda asociada a
              nadie y el cliente nunca junta las 3 compras que arman su perfil:
              es lo que convierte la caja en historia del cliente. No es
              obligatorio —hay quien no lo quiere dar— pero hay que preguntarlo,
              así que el pedido está a la vista y se salta con un toque. */}
          {!faltaCliente && carrito.length > 0 && !cliente && dni.trim().length < 7 && !sinDni && (
            <div className="rounded-xl bg-tinta px-3 py-2.5 text-center text-white">
              <p className="text-sm font-medium">¿Me decís tu DNI?</p>
              <p className="mt-0.5 text-xs text-white/70">
                Con 3 compras el sistema le arma su perfil y le recomienda lo que lleva siempre.
              </p>
              <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
                <Boton variante="secundario" tamano="chico" onClick={() => dniRef.current?.focus()}>
                  Cargar DNI (F3)
                </Boton>
                <button type="button" onClick={() => setSinDni(true)} className="inline-flex min-h-9 items-center rounded-sm text-xs text-white/70 underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70">
                  No quiere darlo
                </button>
              </div>
            </div>
          )}

          {/* cobrar (escritorio: botón grande al pie; celular: barra fija de abajo) */}
          {pantallaAncha && (
            <button
              type="button"
              onClick={cobrar}
              disabled={cobrarDeshabilitado}
              className={unir('mt-auto rounded-2xl bg-marca py-6 text-2xl font-semibold text-white transition-colors hover:bg-marca-hondo active:scale-[0.98] disabled:opacity-40', FOCO)}
            >
              {textoCobrar}
            </button>
          )}

          {/* última venta: reimprimir / anular */}
          {ultima && (
            <div className="flex gap-2 *:flex-1">
              <Boton variante="secundario" onClick={() => imprimir(ultima.ticket)} icono={<IconoCaja d={ICONO.imprimir} className="size-4" />}>
                Reimprimir (F8)
              </Boton>
              <Boton variante="peligro" onClick={anularUltima}>
                Anular última
              </Boton>
            </div>
          )}

          <p className="-mt-1 hidden text-center text-xs text-tinta/60 sm:block">
            C + cantidad + Enter = cantidad del último producto · 6* y escaneá = 6 unidades · etiqueta de balanza = entra con su peso/cantidad · F2 comprobante · F3 cliente · F4 medio · F6 estacionar · F7 mi turno · F8 reimprimir · F9 stock · F12 cobrar · F10 salir
          </p>

          {estado && (
            <p role={estado.tipo === 'error' ? 'alert' : 'status'} className={'rounded-xl px-3 py-3 text-base ' + (estado.tipo === 'ok' ? 'bg-ok-suave text-ok' : 'bg-marca-suave text-marca-hondo')}>
              {estado.texto}
            </p>
          )}
        </section>
      </div>

      {/* celular y tableta: Cobrar siempre a mano, fijo abajo */}
      {!pantallaAncha && (
        <BarraInferior etiqueta="Cobrar">
          <button
            type="button"
            onClick={cobrar}
            disabled={cobrarDeshabilitado}
            className={unir('min-h-14 w-full rounded-2xl bg-marca px-4 text-xl font-semibold text-white transition-colors hover:bg-marca-hondo active:scale-[0.98] disabled:opacity-40', FOCO)}
          >
            {textoCobrar}
          </button>
        </BarraInferior>
      )}

      {/* ---- modal apertura / cierre de caja ---- */}
      <Modal
        abierto={!!(modalCaja || arqueo)}
        onCerrar={cerrarModalCaja}
        titulo={arqueo ? 'Cierre de caja' : modalCaja === 'abrir' ? 'Abrir caja' : 'Cerrar caja · arqueo'}
        descripcion={arqueo ? undefined : modalCaja === 'abrir' ? 'Elegí tu línea de caja e ingresá la base de efectivo.' : 'Así va la caja. Contá el efectivo del cajón e ingresá el total: el sistema compara contra lo que tiene que haber.'}
        bloquearCierre={(!arqueo && modalCaja === 'abrir') || cerrando}
        cerrarAlTocarAfuera={false}
        pie={arqueo ? (
          <Boton anchoCompleto onClick={() => { setArqueo(null); setSesionCerradaId(null); setModalCaja('abrir'); }}>
            Listo
          </Boton>
        ) : modalCaja === 'abrir' ? (
          <>
            <BotonLink variante="secundario" href="/inicio">Salir</BotonLink>
            <Boton onClick={abrirCaja} disabled={!cajaElegida || cajas.length === 0}>
              {cajas.find((c) => c.id === cajaElegida)?.sesionAbierta ? 'Retomar sesión' : 'Abrir caja'}
            </Boton>
          </>
        ) : (
          <>
            <Boton variante="secundario" onClick={() => setModalCaja(null)}>Cancelar</Boton>
            <Boton onClick={cerrarCaja} disabled={cerrando || montoBuf === ''} cargando={cerrando}>
              {cerrando ? 'Cerrando…' : 'Cerrar y arquear'}
            </Boton>
          </>
        )}
      >
        {arqueo ? (
          <>
            {sesionCerradaId && <ResumenCierre sesionId={sesionCerradaId} />}
            <div className={'space-y-1.5 text-tinta' + (sesionCerradaId ? ' hidden' : '')}>
              <p className="flex justify-between gap-3"><span className="text-tinta/70">Efectivo esperado</span><span className="importe font-semibold">{pesos(arqueo.esperado)}</span></p>
              <p className="flex justify-between gap-3"><span className="text-tinta/70">Contado</span><span className="importe font-semibold">{pesos(arqueo.contado)}</span></p>
              <p className={'flex justify-between gap-3 rounded-xl px-2 py-1.5 ' + (arqueo.diferencia === 0 ? 'bg-ok-suave text-ok' : 'bg-marca-suave text-marca-hondo')}>
                <span>Diferencia</span>
                <span className="importe inline-flex items-center gap-1 font-bold">{arqueo.diferencia === 0 ? <>Sin diferencia <IconoOk className="size-4 shrink-0" /></> : pesos(arqueo.diferencia)}</span>
              </p>
            </div>
          </>
        ) : modalCaja === 'abrir' ? (
          <>
            <div className="grid gap-1.5">
              {cajas.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={cajaElegida === c.id}
                  onClick={() => setCajaElegida(c.id)}
                  className={unir('min-h-11 rounded-xl border-2 px-3 py-2.5 text-left', cajaElegida === c.id ? 'border-marca bg-marca-suave' : 'border-black/10', FOCO)}
                >
                  <span className="font-semibold text-tinta">
                    {c.nombre}
                    {c.sucursal?.nombre ? <span className="font-normal text-tinta/60"> · {c.sucursal.nombre}</span> : null}
                  </span>
                  <span className="block text-xs text-tinta/60">
                    {c.sesionAbierta ? `Abierta por ${c.sesionAbierta.usuario?.nombre ?? '—'} · se retoma la sesión` : 'Cerrada · se abre nueva sesión'}
                  </span>
                </button>
              ))}
              {cajas.length === 0 && <p className="text-sm text-tinta/60">No hay cajas configuradas (se pueden crear desde Cierres).</p>}
            </div>
            {!cajas.find((c) => c.id === cajaElegida)?.sesionAbierta && (
              <Entrada
                value={montoBuf}
                onChange={(e) => setMontoBuf(e.target.value.replace(/[^\d]/g, ''))}
                placeholder="Base de efectivo (ej: 20000)"
                aria-label="Base de efectivo"
                inputMode="numeric"
                className="mt-3"
              />
            )}
          </>
        ) : (
          <>
            {sesion && <div className="rounded-xl border border-black/[0.06] p-3"><ResumenCierre sesionId={sesion.sesionId} imprimible={false} /></div>}
            <Entrada
              value={montoBuf}
              onChange={(e) => setMontoBuf(e.target.value.replace(/[^\d]/g, ''))}
              placeholder="Efectivo contado"
              aria-label="Efectivo contado"
              inputMode="numeric"
              autoFocus
              className="mt-3"
            />
            {cola.length > 0 && (
              <Aviso tono="atencion" className="mt-2">
                Hay {cola.length} venta(s) sin enviar. El arqueo del sistema no las incluye hasta que se envíen.
              </Aviso>
            )}
          </>
        )}
      </Modal>

      {/* ---- modales: descuento / movimiento de efectivo / devolución ---- */}
      <Modal
        abierto={!!modalExtra}
        onCerrar={() => setModalExtra(null)}
        titulo={modalExtra === 'descuento' ? 'Descuento con autorización' : modalExtra === 'movimiento' ? 'Movimiento de efectivo' : 'Devolución de venta'}
        descripcion={
          modalExtra === 'descuento' ? 'Un gerente o el dueño autoriza con su PIN de firma. Queda auditado.'
          : modalExtra === 'movimiento' ? 'Ingresos (cambio) o retiros (a tesorería). Entra al arqueo del cierre.'
          : !devVenta ? 'Elegí la venta (últimas 24 h).'
          : 'Marcá qué se devuelve (repone stock y emite nota de crédito).'
        }
        bloquearCierre={procesando}
        cerrarAlTocarAfuera={false}
        pie={
          modalExtra === 'descuento' ? (
            <>
              <Boton variante="secundario" onClick={() => setModalExtra(null)}>Cancelar</Boton>
              <Boton onClick={aplicarDescuento} cargando={procesando}>{procesando ? 'Verificando…' : 'Autorizar'}</Boton>
            </>
          ) : modalExtra === 'movimiento' ? (
            <>
              <Boton variante="secundario" onClick={() => setModalExtra(null)}>Cancelar</Boton>
              <Boton onClick={registrarMovimiento} cargando={procesando}>{procesando ? 'Guardando…' : 'Registrar'}</Boton>
            </>
          ) : !devVenta ? (
            <Boton variante="secundario" onClick={() => setModalExtra(null)}>Cancelar</Boton>
          ) : (
            <>
              <Boton variante="secundario" onClick={() => setDevVenta(null)}>Volver</Boton>
              <Boton onClick={confirmarDevolucion} cargando={procesando}>{procesando ? 'Procesando…' : 'Confirmar devolución'}</Boton>
            </>
          )
        }
      >
        {modalExtra === 'descuento' && (
          <div className="space-y-2">
            <Entrada
              value={descBuf}
              onChange={(e) => setDescBuf(e.target.value.replace(/[^\d]/g, ''))}
              placeholder={`Monto a descontar (total ${pesos(total)})`}
              aria-label="Monto a descontar"
              inputMode="numeric"
              autoFocus
            />
            <Entrada
              value={pinBuf}
              onChange={(e) => setPinBuf(e.target.value)}
              placeholder="PIN del supervisor"
              aria-label="PIN del supervisor"
              type="password"
              inputMode="numeric"
            />
          </div>
        )}

        {modalExtra === 'movimiento' && (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              {(['ingreso', 'egreso'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  aria-pressed={movTipo === t}
                  onClick={() => setMovTipo(t)}
                  className={unir('min-h-11 rounded-xl border-2 py-3 font-medium', movTipo === t ? 'border-tinta bg-tinta text-white' : 'border-black/10 bg-white text-tinta', FOCO)}
                >
                  {t === 'ingreso' ? '↓ Ingreso' : '↑ Retiro'}
                </button>
              ))}
            </div>
            <Entrada
              value={movMonto}
              onChange={(e) => setMovMonto(e.target.value.replace(/[^\d]/g, ''))}
              placeholder="Monto"
              aria-label="Monto"
              inputMode="numeric"
            />
            <Entrada
              value={movMotivo}
              onChange={(e) => setMovMotivo(e.target.value)}
              placeholder={movTipo === 'ingreso' ? 'Motivo (ej: cambio de tesorería)' : 'Motivo (ej: retiro a tesorería)'}
              aria-label="Motivo"
            />
          </div>
        )}

        {modalExtra === 'devolucion' && (
          !devVenta ? (
            <div className="grid gap-1.5">
              {devVentas.length === 0 && <p className="text-sm text-tinta/60">No hay ventas completadas hoy.</p>}
              {devVentas.map((v: any) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => { setDevVenta(v); setDevolver({}); }}
                  className={unir('min-h-11 rounded-xl border-2 border-black/10 px-3 py-2.5 text-left hover:border-marca', FOCO)}
                >
                  <span className="flex justify-between gap-3">
                    <span className="font-semibold text-tinta">
                      {hora(v.vendida_en)}
                      {v.cliente?.dni ? ` · DNI ${v.cliente.dni}` : ''}
                    </span>
                    <span className="importe shrink-0 font-semibold text-tinta">{pesos(v.total)}</span>
                  </span>
                  <span className="block min-w-0 break-words text-xs text-tinta/60">
                    {(v.items ?? []).map((i: any) => `${i.cantidad}x ${i.producto?.nombre}`).join(' · ')}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <>
              <div className="grid gap-1.5">
                {(devVenta.items ?? []).map((i: any) => {
                  const sku = i.producto?.sku;
                  const max = Number(i.cantidad);
                  const cant = devolver[sku] ?? 0;
                  return (
                    <div key={sku} className="flex items-center gap-2 rounded-xl bg-crema/60 px-3 py-2">
                      <span className="min-w-0 flex-1">
                        <span className="block min-w-0 break-words text-sm font-medium text-tinta">{i.producto?.nombre}</span>
                        <span className="text-xs text-tinta/60">{pesos(i.precio_unitario)} c/u · compró {max}</span>
                      </span>
                      <button type="button" aria-label="Devolver uno menos" onClick={() => setDevolver((d) => ({ ...d, [sku]: Math.max(0, (d[sku] ?? 0) - 1) }))} className={unir('size-11 shrink-0 rounded-xl border border-black/10 bg-white text-xl', FOCO)}>−</button>
                      <span className="importe w-7 text-center font-semibold">{cant}</span>
                      <button type="button" aria-label="Devolver uno más" onClick={() => setDevolver((d) => ({ ...d, [sku]: Math.min(max, (d[sku] ?? 0) + 1) }))} className={unir('size-11 shrink-0 rounded-xl bg-crema-hondo text-xl text-tinta', FOCO)}>+</button>
                    </div>
                  );
                })}
              </div>
              <label className="mt-3 flex min-h-11 items-center gap-2 text-sm text-tinta">
                <input type="checkbox" checked={devEfectivo} onChange={(e) => setDevEfectivo(e.target.checked)} className="size-5 accent-marca" />
                Reintegro en efectivo (registra egreso de caja)
              </label>
              <Entrada
                value={pinBuf}
                onChange={(e) => setPinBuf(e.target.value)}
                placeholder="PIN del supervisor"
                aria-label="PIN del supervisor"
                type="password"
                inputMode="numeric"
                className="mt-2"
              />
              <button
                type="button"
                onClick={pedirAutorizacionDevolucion}
                disabled={procesando}
                className={unir('mt-2 min-h-11 w-full rounded-xl border-2 border-dashed border-marca/40 px-3 py-3 text-sm font-semibold text-marca-hondo hover:bg-marca-suave disabled:opacity-50', FOCO)}
              >
                ¿No hay supervisor en el local? Pedir autorización a distancia
              </button>
              <p className="mt-1 text-xs text-tinta/60">Les llega por WhatsApp y campanita a los supervisores; cuando uno aprueba, la devolución se hace sola y acá te avisa.</p>
            </>
          )
        )}
      </Modal>

      {/* ---- cobro con el QR de Mercado Pago ---- */}
      <Modal
        abierto={!!cobroMP && cobroMP.estado !== 'omitido'}
        onCerrar={cerrarCobroMP}
        ancho="chico"
        titulo={`Mercado Pago · QR de la caja${cobroMP?.qr ? ` (${cobroMP.qr})` : ''}`}
        bloquearCierre={cobroMPOcupado}
        cerrarAlTocarAfuera={false}
        pie={
          cobroMP?.estado === 'esperando' ? (
            <>
              <Boton variante="secundario" onClick={cancelarCobroMP}>Cancelar cobro</Boton>
              <Boton onClick={registrarIgual} title="Solo si ya viste el pago acreditado en el teléfono o en el Point">
                Ya pagó por fuera: registrar igual
              </Boton>
            </>
          ) : cobroMP?.estado === 'aprobado' && !cobrando && estado?.tipo === 'error' ? (
            <>
              <Boton variante="secundario" onClick={() => fijarCobroMP(null)}>Cerrar</Boton>
              <Boton onClick={() => void cobrar()}>Reintentar el registro</Boton>
            </>
          ) : cobroMP?.estado === 'sin_qr' ? (
            <>
              <Boton variante="secundario" onClick={() => fijarCobroMP(null)}>Cancelar</Boton>
              <Boton onClick={registrarIgual}>Cobrar con el QR fijo (como antes)</Boton>
            </>
          ) : cobroMP?.estado === 'error' ? (
            <>
              <Boton variante="secundario" onClick={() => fijarCobroMP(null)}>Cerrar</Boton>
              <Boton variante="secundario" onClick={registrarIgual}>Registrar igual</Boton>
              <Boton onClick={() => void iniciarCobroMP(cobroMP.monto)}>Reintentar</Boton>
            </>
          ) : undefined
        }
      >
        {cobroMP && (
          <>
            <div className="mb-4 flex items-center gap-3">
              <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-info text-sm font-bold text-white" aria-hidden="true">MP</span>
              <p className="importe text-3xl font-bold leading-tight">{pesos(cobroMP.monto)}</p>
            </div>
            {cobroMP.estado === 'iniciando' && <p className="text-sm text-tinta/70">Mandando el importe al QR…</p>}
            {cobroMP.estado === 'esperando' && (
              <>
                <p className="text-sm">
                  El cliente escanea el <b>QR de esta caja</b> con la app de Mercado Pago: ve <b>{pesos(cobroMP.monto)}</b> ya cargado y solo confirma.
                </p>
                <p role="status" className="mt-3 flex items-center gap-2 text-sm text-tinta/70">
                  <span className="inline-block size-3 shrink-0 animate-pulse rounded-full bg-info motion-reduce:animate-none" />
                  Esperando la confirmación del pago… al aprobarse, la venta se registra e imprime sola.
                </p>
                {cobroMP.aviso && <p className="mt-2 text-sm text-atencion">{cobroMP.aviso}</p>}
                <button type="button" onClick={() => void cambiarQR()} className={unir('mt-3 inline-flex min-h-9 items-center rounded-sm text-xs text-tinta/60 underline', FOCO)}>¿No es este QR? Cambiar</button>
              </>
            )}
            {cobroMP.estado === 'aprobado' && (
              <>
                <p className="flex items-center gap-1 text-sm font-semibold text-ok">
                  <IconoOk className="size-4 shrink-0" />Pago aprobado por Mercado Pago{cobroMP.mpPaymentId ? ` · operación ${cobroMP.mpPaymentId}` : ''}
                </p>
                <p className="mt-1 text-sm text-tinta/70">
                  {cobrando || estado?.tipo !== 'error' ? 'Registrando la venta…' : `El pago está cobrado pero la venta no se pudo registrar: ${estado.texto}`}
                </p>
              </>
            )}
            {cobroMP.estado === 'sin_qr' && (
              <>
                <p className="text-sm">
                  Esta caja todavía no tiene asignado su QR de Mercado Pago. Elegí el QR que está en este mostrador (queda guardado):
                </p>
                <div className="mt-3 grid gap-2">
                  {(cobroMP.opcionesQR ?? []).map((q) => (
                    <button key={q.id} type="button" onClick={() => void vincularQR(q.id)} className={unir('min-h-11 rounded-xl border border-black/15 px-3 py-2 text-left text-sm hover:border-tinta', FOCO)}>
                      <b>{q.nombre}</b>
                      {q.externalId ? <span className="text-tinta/60"> · {q.externalId}</span> : null}
                    </button>
                  ))}
                  {!(cobroMP.opcionesQR ?? []).length && <p className="text-sm text-tinta/60">No hay QR en la cuenta de Mercado Pago de esta sucursal.</p>}
                </div>
              </>
            )}
            {cobroMP.estado === 'error' && (
              <p role="alert" className="text-sm text-marca-hondo">{cobroMP.error}</p>
            )}
          </>
        )}
      </Modal>
      {/* ---- "Mi turno": lo vendido, las facturas y el cambio de medio de pago ---- */}
      {verTurno && sesion && (
        <MiTurno
          sesionId={sesion.sesionId}
          cajaNombre={`${sesion.cajaNombre}${sucursalNombre ? ` · ${sucursalNombre}` : ''}`}
          abiertaEn={sesion.abiertaEn}
          onCerrar={() => { setVerTurno(false); setTimeout(() => inputRef.current?.focus(), 60); }}
          onReimprimir={(d) => {
            // el ticket se rearma con lo que quedó guardado en la venta, no con
            // el carrito de ahora (que puede tener otra cosa a medio cobrar)
            const comp = (d.comprobantes ?? []).find((c: any) => ['FA', 'FB', 'FC', 'REM'].includes(c.tipo));
            imprimir({
              numero: comp ? `${comp.tipo} ${comp.numero}` : undefined,
              etiqueta: comp ? (ETIQUETA_COMP[(comp.tipo === 'FA' ? 'A' : comp.tipo === 'REM' ? 'R' : 'B') as TipoComprobante] ?? 'Ticket') : 'Ticket',
              fecha: new Date(d.vendidaEn).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }),
              items: d.items.map((i: any) => ({ cantidad: i.cantidad, nombre: i.nombre, precioUnitario: i.precioUnitario, total: i.total })),
              total: d.total,
              descuento: d.descuento,
              pagos: d.pagos.map((p: any) => ({ medio: p.medio, monto: p.monto, terminal: p.terminal ?? undefined })),
              vuelto: null,
              dni: d.cliente?.dni ?? undefined,
            });
          }}
          onDevolver={(ventaId) => { setVerTurno(false); void abrirDevolucionDeVenta(ventaId); }}
        />
      )}

      {/* ---- consulta de stock en ambas sucursales ---- */}
      <Modal abierto={modalStock} onCerrar={() => setModalStock(false)} titulo="Stock por sucursal">
        <div className="relative">
          <Entrada
            ref={stockInputRef}
            value={stockQ}
            onChange={(e) => onBuscarStock(e.target.value)}
            placeholder="Escaneá o buscá el producto…"
            aria-label="Escaneá o buscá el producto"
          />
          {stockBuscando && <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-tinta/60">buscando…</span>}
        </div>
        <div className="mt-3">
          {stockQ.trim().length >= 2 && !stockBuscando && stockRes.length === 0 && (
            <p className="py-8 text-center text-sm text-tinta/60">Sin resultados.</p>
          )}
          {stockRes.map((p) => (
            <div key={p.sku} className="mb-2 rounded-xl bg-crema/50 px-4 py-3">
              <p className="break-words font-medium leading-tight text-tinta">{p.nombre}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {p.sucursales.map((s) => (
                  <span
                    key={s.sucursal}
                    className={'rounded-xl px-3 py-1.5 text-sm font-semibold tabular-nums ' +
                      (s.cantidad > 0 ? 'bg-ok-suave text-ok' : 'bg-marca-suave text-marca-hondo')}
                  >
                    {s.sucursal}: {Math.round(s.cantidad)}
                  </span>
                ))}
                <span className="rounded-xl bg-tinta px-3 py-1.5 text-sm font-semibold tabular-nums text-white">Total {Math.round(p.total)}</span>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-2 text-center text-xs text-tinta/60">Consulta sin afectar la venta · Esc o F9 para cerrar</p>
      </Modal>

      {dialogo}

      {/* ---- ticket 80mm (solo visible al imprimir) ---- */}
      <TicketPrint t={ticket} />
    </main>
  );
}

// Ticket térmico 80mm: se imprime con el diálogo del navegador (la impresora
// térmica se configura como predeterminada con papel de 80mm, sin márgenes).
function TicketPrint({ t }: { t: TicketData | null }) {
  if (!t) return null;
  return (
    <>
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #ticket-odb, #ticket-odb * { visibility: visible; }
          #ticket-odb { position: absolute; left: 0; top: 0; width: 72mm; }
          @page { size: 80mm auto; margin: 2mm; }
        }
        #ticket-odb { display: none; }
        @media print { #ticket-odb { display: block; } }
      `}</style>
      <div id="ticket-odb" style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11.5, color: '#000', lineHeight: 1.35 }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: 3 }}>O.D.B</div>
          <div>Outlet de Bebidas</div>
          <div style={{ marginTop: 3 }}>
            {t.numero ?? t.etiqueta}{t.offline ? ' · PENDIENTE DE ENVÍO' : ''}
          </div>
          <div>{t.fecha}</div>
          {t.dni && <div>Cliente: {t.dni}</div>}
        </div>
        <div style={{ borderTop: '1px dashed #000', margin: '6px 0' }} />
        {t.items.map((i, idx) => (
          <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
            <span style={{ flex: 1, overflow: 'hidden' }}>
              {(i as any).porPeso ? `${Number(i.cantidad).toFixed(3).replace('.', ',')} kg` : `${i.cantidad} x`} {i.nombre.slice(0, 26)}
            </span>
            <span>{pesos(i.total)}</span>
          </div>
        ))}
        <div style={{ borderTop: '1px dashed #000', margin: '6px 0' }} />
        {t.descuento > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Ahorro</span>
            <span>-{pesos(t.descuento)}</span>
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 15, fontWeight: 700 }}>
          <span>TOTAL</span>
          <span>{pesos(t.total)}</span>
        </div>
        {t.pagos.map((p, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>{MEDIO_LABEL[p.medio] ?? p.medio}</span>
            <span>{pesos(p.monto)}</span>
          </div>
        ))}
        {t.vuelto != null && (
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Vuelto</span>
            <span>{pesos(t.vuelto)}</span>
          </div>
        )}
        <div style={{ borderTop: '1px dashed #000', margin: '6px 0' }} />
        <div style={{ textAlign: 'center' }}>
          {!t.numero && <div>Documento no válido como factura</div>}
          <div style={{ marginTop: 2 }}>¡Gracias por tu compra! 🍷</div>
        </div>
      </div>
    </>
  );
}
