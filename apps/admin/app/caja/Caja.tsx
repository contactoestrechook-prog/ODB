'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';

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
};

type Renglon = Producto & { cantidad: number };

type Cliente = {
  existe: boolean;
  dni: string;
  nombre?: string;
  tipo?: string;
  compras?: number;
  ticketPromedio?: number;
};

type Pago = { medio: string; monto: number };

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

const pesos = (n: number | null | undefined) =>
  n == null ? '—' : '$' + Math.round(Number(n)).toLocaleString('es-AR');

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

const NOTA_MEDIO: Record<string, string> = {
  mercadopago: 'Mostrá el QR de tu caja para que pague',
  tarjeta: 'Cobrá en la terminal (Clover)',
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

export function Caja({ sucursales }: { sucursales: { id: string; nombre: string }[] }) {
  const [sucursalId, setSucursalId] = useState(sucursales[0]?.id ?? '');
  const sucursalNombre = sucursales.find((s) => s.id === sucursalId)?.nombre ?? 'esta sucursal';
  const [comprobante, setComprobante] = useState<TipoComprobante>('B');
  const [busqueda, setBusqueda] = useState('');
  const [resultados, setResultados] = useState<Producto[]>([]);
  const [carrito, setCarrito] = useState<Renglon[]>([]);
  const [dni, setDni] = useState('');
  const [clientes, setClientes] = useState<{ dni: string; nombre: string }[]>([]); // autocompletar por nombre
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [receptorCuit, setReceptorCuit] = useState('');
  const [receptorNombre, setReceptorNombre] = useState('');
  const [medio, setMedio] = useState('efectivo');
  const [mayorista, setMayorista] = useState(false); // venta a precio mayorista
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
      setSesion(null);
      setMontoBuf('');
      cargarCajas();
    } catch (e) {
      setEstado({ tipo: 'error', texto: e instanceof Error ? e.message : 'No se pudo cerrar la caja' });
    }
    setCerrando(false);
  }

  // ---- catálogo local para búsqueda instantánea (las PC de caja tienen ~25 Mbps) ----
  useEffect(() => {
    fetch('/api/pos-catalogo')
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) => setCatalogoLocal((d.items ?? []).map((p: any) => ({ ...p, _n: norm(p.nombre) }))))
      .catch(() => {});
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
    () => (dividido ? pagos : [{ medio, monto: totalFinal }]),
    [dividido, pagos, medio, totalFinal],
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

  function agregar(p: Producto) {
    if (p.precio == null) {
      setEstado({ tipo: 'error', texto: `"${p.nombre}" no tiene precio cargado — no se puede vender` });
      setBusqueda(''); setResultados([]);
      return;
    }
    setCarrito((c) => {
      const existente = c.find((r) => r.sku === p.sku);
      if (existente) {
        return c.map((r) => (r.sku === p.sku ? { ...r, cantidad: r.cantidad + 1 } : r));
      }
      return [...c, { ...p, cantidad: 1 }];
    });
    setBusqueda('');
    setResultados([]);
    setEstado(null);
  }

  function onBuscar(termino: string) {
    setBusqueda(termino);
    setEstado(null);
    if (debRef.current) clearTimeout(debRef.current);
    const t = termino.trim();
    if (t.length < 2) { setResultados([]); return; }
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
      const datos: Producto[] = res.ok ? ((await res.json()).items ?? []) : [];
      if (seq !== seqRef.current) return;
      const esCodigo = /^\d{6,14}$/.test(t);
      if (esCodigo || esEnter) {
        const exacto = datos.find((p) => p.codigo === t || p.sku === t || (p.codigosBarras ?? []).includes(t)) ?? (datos.length === 1 ? datos[0] : null);
        if (exacto) { agregar(exacto); return; }
        if (esCodigo && datos.length === 0) { setEstado({ tipo: 'error', texto: `Código ${t} no encontrado` }); setResultados([]); return; }
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
    const ex = catalogoLocal.find((p) => p.codigo === t || p.sku === t || (p.codigosBarras ?? []).includes(t));
    if (ex) { agregar(ex); return; }
    if (resultados[0]) { agregar(resultados[0]); return; }
    if (t.length >= 1) ejecutar(t, true);
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
    setPagos([{ medio, monto: totalFinal }]);
    setPagaCon('');
    setFoco(null);
  }
  function agregarPago(m: string) {
    setPagos((ps) => {
      const falta = Math.max(0, Math.round((totalFinal - ps.reduce((s, p) => s + p.monto, 0)) * 100) / 100);
      const nuevos = [...ps, { medio: m, monto: falta }];
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
      if (res.ok) setCliente(await res.json());
    } catch {}
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
    setCarrito([]);
    setCliente(null);
    setClientes([]);
    setDni('');
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

  // ---- impresión de ticket (térmica 80mm vía diálogo del navegador) ----
  function imprimir(t: TicketData) {
    imprimirRef.current = t;
    setTicket(t);
    // esperar el render del ticket antes de abrir el diálogo
    setTimeout(() => window.print(), 60);
  }

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
  async function cobrar() {
    if (carrito.length === 0 || cobrando) return;
    if (faltaCliente) {
      setEstado({ tipo: 'error', texto: comprobante === 'A' ? 'Factura A: cargá el CUIT del receptor' : 'Cuenta corriente: identificá al cliente' });
      dniRef.current?.focus();
      return;
    }
    if (dividido && restante !== 0) {
      setEstado({ tipo: 'error', texto: restante > 0 ? `Falta asignar ${pesos(restante)} entre los medios de pago` : `Los pagos superan el total por ${pesos(-restante)}` });
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
      const pin = window.prompt(`${datos.message}\n\nPIN de supervisor para autorizar la venta bajo costo (o Cancelar):`);
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
    if (!window.confirm(`¿Anular la última venta (${pesos(ultima.ticket.total)})? Devuelve stock y emite nota de crédito.`)) return;
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
          setMedio((m) => {
            const i = MEDIOS.findIndex((x) => x.id === m);
            return MEDIOS[(i + 1) % MEDIOS.length].id;
          });
          break;
        case 'F6': // estacionar ticket
          e.preventDefault();
          estacionarRef.current?.();
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

  return (
    <main className="h-screen bg-[#F0EBE2] flex flex-col overflow-hidden print:hidden">
      <header className="bg-black px-4 py-3 flex items-center justify-between shrink-0">
        <span className="text-white tracking-widest font-medium">
          O.D.B <span className="tracking-normal font-normal text-[#F0EBE2]/70">· Caja</span>
          {sesion && <span className="ml-3 rounded-lg bg-white/10 px-2 py-1 text-xs text-[#F0EBE2]/80">{sesion.cajaNombre}</span>}
          {sinRed && <span className="ml-2 rounded-lg bg-[#B82D25] px-2 py-1 text-xs text-white">SIN RED · {cola.length} en cola</span>}
          {!sinRed && cola.length > 0 && <span className="ml-2 rounded-lg bg-amber-500 px-2 py-1 text-xs text-black">{cola.length} por enviar</span>}
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setAutoPrint((a) => !a)}
            title={autoPrint ? 'Impresión automática: SÍ' : 'Impresión automática: NO'}
            className={'rounded-lg px-3 py-2 text-sm ' + (autoPrint ? 'bg-white/20 text-white' : 'bg-white/10 text-[#F0EBE2]/50')}
          >
            🖨 {autoPrint ? 'Auto' : 'Manual'}
          </button>
          <select
            value={sucursalId}
            onChange={(e) => setSucursalId(e.target.value)}
            className="rounded-lg bg-white/10 text-[#F0EBE2] px-3 py-2 text-sm"
          >
            {sucursales.map((s) => (
              <option key={s.id} value={s.id} className="text-black">{s.nombre}</option>
            ))}
          </select>
          {sesion && (
            <button onClick={() => { setModalExtra('movimiento'); setMovMonto(''); setMovMotivo(''); }} className="rounded-lg bg-white/10 text-[#F0EBE2]/80 px-3 py-2 text-sm" title="Ingreso / retiro de efectivo">
              💵 Mov.
            </button>
          )}
          <button onClick={abrirStock} className="rounded-lg bg-white/10 text-[#F0EBE2]/80 px-3 py-2 text-sm" title="Consultar stock en ambas sucursales (F9)">
            📦 Stock
          </button>
          <button onClick={abrirDevolucion} className="rounded-lg bg-white/10 text-[#F0EBE2]/80 px-3 py-2 text-sm" title="Devolución de una venta">
            ↩ Dev.
          </button>
          {sesion && (
            <button onClick={() => { setModalCaja('cerrar'); setMontoBuf(''); }} className="rounded-lg bg-white/10 text-[#F0EBE2]/80 px-3 py-2 text-sm">
              Cerrar caja
            </button>
          )}
          <Link href="/inicio" className="rounded-lg bg-white/10 text-[#F0EBE2]/80 px-3 py-2 text-sm">Panel</Link>
        </div>
      </header>

      {/* tickets estacionados: la barra del "segundo cliente" */}
      {estacionados.length > 0 && (
        <div className="shrink-0 px-3 pt-2 flex items-center gap-2 flex-wrap">
          <span className="text-[11px] uppercase tracking-wider text-black/40">En espera</span>
          {estacionados.map((e) => (
            <button
              key={e.id}
              onClick={() => retomar(e.id)}
              className="rounded-xl bg-amber-100 border border-amber-300 px-3 py-1.5 text-sm text-amber-900 active:scale-95"
            >
              ⏸ {e.etiqueta} · {e.carrito.reduce((s, r) => s + r.cantidad, 0)} u.
            </button>
          ))}
        </div>
      )}

      {/* PASO 1: qué comprobante + a quién (lo primero que define el cajero) */}
      <div className="shrink-0 px-3 pt-3">
        <div className="rounded-2xl bg-white px-3 py-2.5 flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex items-center gap-2">
            <span className="text-[11px] uppercase tracking-wider text-black/40 hidden sm:inline">Comprobante</span>
            <div className="flex gap-1.5">
              {COMPROBANTES.map((c) => {
                const on = comprobante === c.id;
                return (
                  <button
                    key={c.id}
                    onClick={() => setComprobante(c.id)}
                    className={'rounded-xl px-3.5 py-1.5 text-left border-2 active:scale-95 transition ' +
                      (on ? 'bg-black text-white border-black' : 'bg-[#F0EBE2] text-black border-transparent')}
                  >
                    <span className="text-xl font-bold leading-none">{c.label}</span>
                    <span className={'block text-[10px] leading-tight ' + (on ? 'text-white/70' : 'text-black/45')}>{c.desc}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex items-center gap-2 ml-auto relative">
            <span className={'text-[11px] uppercase tracking-wider hidden sm:inline ' + (requiereCliente ? 'text-[#B82D25]' : 'text-black/40')}>
              Cliente{requiereCliente ? ' *' : ''}
            </span>
            <input
              ref={dniRef}
              value={dni}
              onChange={(e) => onCambioCliente(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && buscarCliente()}
              placeholder={requiereCliente ? 'DNI o nombre (requerido)' : 'DNI o nombre (opcional)'}
              className={'w-48 rounded-xl border-2 px-3 py-2 text-base text-black outline-none ' +
                (faltaCliente && comprobante !== 'A' ? 'border-[#B82D25] bg-[#B82D25]/5' : 'border-black/10 focus:border-[#B82D25]')}
            />
            <button onClick={() => buscarCliente()} className="rounded-xl bg-black px-4 py-2 text-sm text-white active:scale-95">Buscar</button>
            {clientes.length > 0 && (
              <div className="absolute z-20 top-full mt-1 right-0 w-72 rounded-xl bg-white border border-black/10 shadow-xl overflow-hidden">
                {clientes.map((c) => (
                  <button key={c.dni} onClick={() => buscarCliente(c.dni)} className="w-full px-3 py-2.5 text-left text-sm text-black hover:bg-[#F0EBE2] border-b border-black/5 last:border-0">
                    <span className="font-medium">{c.nombre}</span>
                    <span className="text-black/45"> · DNI {c.dni}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Factura A: datos del receptor (CUIT obligatorio) */}
        {comprobante === 'A' && (
          <div className="mt-1.5 rounded-2xl bg-white px-3 py-2 flex flex-wrap items-center gap-2">
            <span className="text-[11px] uppercase tracking-wider text-[#B82D25]">Receptor A *</span>
            <input
              value={receptorCuit}
              onChange={(e) => setReceptorCuit(e.target.value.replace(/[^\d-]/g, ''))}
              placeholder="CUIT (20-12345678-9)"
              inputMode="numeric"
              className={'w-48 rounded-xl border-2 px-3 py-2 text-base text-black outline-none ' +
                (faltaCliente ? 'border-[#B82D25] bg-[#B82D25]/5' : 'border-black/10 focus:border-[#B82D25]')}
            />
            <input
              value={receptorNombre}
              onChange={(e) => setReceptorNombre(e.target.value)}
              placeholder="Razón social"
              className="flex-1 min-w-40 rounded-xl border-2 border-black/10 px-3 py-2 text-base text-black outline-none focus:border-[#B82D25]"
            />
          </div>
        )}
        {cliente && (
          <p className={'mt-1.5 rounded-xl px-3 py-1.5 text-sm inline-block ' + (cliente.existe ? 'bg-black text-white' : 'bg-white text-black')}>
            {cliente.existe ? `${cliente.nombre ? cliente.nombre + ' · ' : ''}${cliente.tipo} · ${cliente.compras} compras · ticket ${pesos(cliente.ticketPromedio)}` : 'Cliente nuevo: se registra con esta venta'}
          </p>
        )}
      </div>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[1fr_420px] gap-3 p-3 overflow-hidden">
        {/* IZQUIERDA: búsqueda + carrito */}
        <section className="rounded-2xl bg-white p-3 flex flex-col overflow-hidden">
          <div className="relative shrink-0">
            <input
              ref={inputRef}
              value={busqueda}
              onChange={(e) => onBuscar(e.target.value)}
              onKeyDown={onKeyBuscar}
              placeholder="Escaneá o buscá un producto…"
              autoFocus
              inputMode="search"
              className="w-full rounded-2xl border-2 border-[#B82D25] px-5 py-4 text-lg text-black outline-none"
            />
            {buscando && <span className="absolute right-5 top-1/2 -translate-y-1/2 text-sm text-black/40">buscando…</span>}
            {resultados.length > 0 && (
              <div className="absolute z-10 mt-1 w-full rounded-2xl bg-white border border-black/10 overflow-hidden shadow-xl">
                {resultados.map((p) => {
                  const sinStock = p.stock != null && p.stock <= 0;
                  const pocoStock = p.stock != null && p.stock > 0 && p.stock <= 3;
                  return (
                  <button
                    key={p.sku}
                    onClick={() => agregar(p)}
                    className={`w-full px-4 py-3.5 text-left flex items-center justify-between gap-3 border-b border-black/5 last:border-0 ${sinStock ? 'bg-[#B82D25]/10 text-[#932A1F] active:bg-[#B82D25]/20 hover:bg-[#B82D25]/20' : 'text-black active:bg-[#F0EBE2] hover:bg-[#F0EBE2]'}`}
                  >
                    <span className="flex items-center gap-3 min-w-0">
                      {p.imagenUrl && <img src={p.imagenUrl} alt="" className="h-11 w-11 rounded-lg object-cover shrink-0" />}
                      <span className="min-w-0">
                        <span className="truncate text-base block">{p.nombre}</span>
                        {sinStock && <span className="text-xs font-semibold text-[#B82D25]">Sin stock en {sucursalNombre}</span>}
                        {pocoStock && <span className="text-xs text-black/45">Quedan {Math.round(p.stock as number)} u.</span>}
                      </span>
                      {p.esAlcohol && <span className="rounded-full bg-black px-1.5 py-0.5 text-[10px] text-white shrink-0">+18</span>}
                    </span>
                    <span className="font-semibold text-lg whitespace-nowrap">{pesos(p.precio)}</span>
                  </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* carrito */}
          <div className="flex-1 overflow-y-auto mt-3 -mx-1 px-1">
            {carrito.length === 0 && (
              <div className="h-full flex items-center justify-center text-black/35 text-base">
                Escaneá un producto para empezar
              </div>
            )}
            {carrito.map((r) => {
              const sel = foco?.tipo === 'linea' && foco.sku === r.sku;
              return (
                <div
                  key={r.sku}
                  className={`rounded-xl mb-2 px-3 py-2.5 flex items-center gap-2 border-2 ${sel ? 'border-[#B82D25] bg-[#B82D25]/5' : 'border-transparent bg-[#F0EBE2]/50'}`}
                >
                  <button onClick={() => seleccionarLinea(r.sku)} className="flex-1 min-w-0 text-left">
                    <p className="font-medium text-black leading-tight">
                      {r.nombre}
                      {r.stock != null && r.stock <= 0 && <span className="ml-2 rounded bg-[#B82D25]/15 px-1.5 py-0.5 text-[11px] font-semibold text-[#B82D25] align-middle">sin stock</span>}
                    </p>
                    <p className="text-xs text-black/45">{pesos(precioDe(r))} c/u{mayorista && r.precioMayorista != null ? ' · may.' : ''}{r.descuento ? ` · ${r.descuento}` : ''}{sel ? ' · tocá los números para la cantidad' : ''}</p>
                  </button>
                  <button onClick={() => cambiarCantidad(r.sku, -1)} className="h-12 w-12 rounded-xl bg-white border border-black/10 text-2xl text-black active:scale-95 shrink-0" aria-label="Restar">−</button>
                  <span className="w-9 text-center text-xl font-semibold tabular-nums">{r.cantidad}</span>
                  <button onClick={() => cambiarCantidad(r.sku, 1)} className="h-12 w-12 rounded-xl bg-black text-white text-2xl active:scale-95 shrink-0" aria-label="Sumar">+</button>
                  <span className="w-24 text-right font-semibold text-lg whitespace-nowrap shrink-0">{pesos(precioDe(r) * r.cantidad)}</span>
                  <button onClick={() => quitar(r.sku)} className="h-12 w-10 rounded-xl text-black/30 active:text-[#B82D25] text-xl shrink-0" aria-label="Quitar">✕</button>
                </div>
              );
            })}
          </div>

          {/* acciones del ticket actual */}
          {carrito.length > 0 && (
            <div className="shrink-0 pt-2 flex gap-2">
              <button onClick={estacionar} className="rounded-xl bg-amber-100 border border-amber-300 px-4 py-2.5 text-sm font-medium text-amber-900 active:scale-95">
                ⏸ Estacionar (F6)
              </button>
              <button onClick={() => { if (window.confirm('¿Vaciar el ticket actual?')) limpiarVenta(); }} className="rounded-xl bg-white border border-black/10 px-4 py-2.5 text-sm text-black/60 active:scale-95">
                Vaciar
              </button>
            </div>
          )}
        </section>

        {/* DERECHA: total + medios + teclado + cobrar */}
        <section className="rounded-2xl bg-white p-3 flex flex-col gap-3 overflow-y-auto">
          {/* total */}
          <div className="rounded-xl bg-black text-white px-4 py-3">
            <div className="flex justify-between items-baseline">
              <span className="text-sm text-white/60">{unidades} u.</span>
              {subtotalLista > total && <span className="text-xs text-[#F0EBE2]/60 line-through">{pesos(subtotalLista)}</span>}
            </div>
            <div className="flex justify-between items-baseline mt-0.5">
              <span className="text-sm text-white/70">Total</span>
              <span className="text-4xl font-semibold tabular-nums">{pesos(totalFinal)}</span>
            </div>
            {descuento && (
              <div className="mt-1 flex items-center justify-between rounded-lg bg-white/10 px-2 py-1">
                <span className="text-xs text-emerald-300">Desc. {pesos(descuento.monto)} · aut. {descuento.nombre}</span>
                <button onClick={() => setDescuento(null)} className="text-white/50 text-xs px-1">✕</button>
              </div>
            )}
            {mayorista && (
              <div className="mt-1 rounded-lg bg-[#C9A96E]/25 px-2 py-1 text-center text-xs text-[#C9A96E] font-semibold tracking-wide">
                PRECIO MAYORISTA
              </div>
            )}
          </div>

          {/* toggle mayorista: cambia la lista de precios de toda la venta */}
          <button
            onClick={() => setMayorista((v) => !v)}
            className={'rounded-xl py-2.5 text-sm font-semibold border-2 active:scale-95 ' +
              (mayorista ? 'bg-[#C9A96E] text-black border-[#C9A96E]' : 'bg-white text-black/70 border-black/10')}
          >
            {mayorista ? '★ Vendiendo MAYORISTA' : 'Precio mayorista'}
          </button>

          {carrito.length > 0 && !descuento && (
            <button
              onClick={() => { setModalExtra('descuento'); setDescBuf(''); setPinBuf(''); }}
              className="-mt-1 self-end text-xs text-[#B82D25] font-semibold underline underline-offset-2"
            >
              % Descuento con autorización
            </button>
          )}

          {/* medios: camino rápido (1 toque) o dividido (chips) */}
          {!dividido ? (
            <>
              <div className="grid grid-cols-2 gap-2">
                {MEDIOS.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => setMedio(m.id)}
                    className={'rounded-xl py-3.5 text-base font-medium border-2 active:scale-95 ' +
                      (medio === m.id ? 'bg-black text-white border-black' : 'bg-white text-black border-black/10')}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
              <div className="flex items-center justify-between -mt-1">
                {NOTA_MEDIO[medio] ? <p className="text-xs text-black/50">{NOTA_MEDIO[medio]}</p> : <span />}
                <button onClick={activarDividido} className="text-xs text-[#B82D25] font-semibold underline underline-offset-2">
                  ➗ Dividir pago
                </button>
              </div>
            </>
          ) : (
            <div className="rounded-xl border-2 border-black/10 p-2 flex flex-col gap-1.5">
              <div className="flex items-center justify-between px-1">
                <span className="text-[11px] uppercase tracking-wider text-black/45">Pago dividido</span>
                <button onClick={salirDividido} className="text-xs text-black/50 underline">volver a un solo medio</button>
              </div>
              {pagos.map((p, i) => {
                const sel = foco?.tipo === 'pago' && foco.idx === i;
                return (
                  <div key={i} className={'rounded-lg px-3 py-2 flex items-center gap-2 border-2 ' + (sel ? 'border-[#B82D25] bg-[#B82D25]/5' : 'border-transparent bg-[#F0EBE2]/60')}>
                    <span className="text-sm font-medium flex-1">{MEDIO_LABEL[p.medio] ?? p.medio}</span>
                    <button onClick={() => { setFoco({ tipo: 'pago', idx: i }); setCantBuf(''); }} className="text-lg font-semibold tabular-nums">
                      {pesos(p.monto)}
                    </button>
                    <button onClick={() => quitarPago(i)} className="text-black/30 px-1" aria-label="Quitar pago">✕</button>
                  </div>
                );
              })}
              <div className="grid grid-cols-4 gap-1.5">
                {MEDIOS.map((m) => (
                  <button key={m.id} onClick={() => agregarPago(m.id)} className="rounded-lg bg-white border border-black/10 py-2 text-xs font-medium active:scale-95">
                    + {m.label}
                  </button>
                ))}
              </div>
              <p className={'text-center text-sm font-semibold ' + (restante === 0 ? 'text-emerald-700' : 'text-[#932A1F]')}>
                {restante === 0 ? '✓ Pagos completos' : restante > 0 ? `Falta asignar ${pesos(restante)}` : `Sobran ${pesos(-restante)}`}
              </p>
            </div>
          )}

          {/* display del teclado: cantidad / monto de pago / paga con */}
          {tecladoVisible && (
            <div className="rounded-xl bg-[#F0EBE2]/60 px-4 py-2.5 flex items-center justify-between">
              {lineaFoco ? (
                <>
                  <span className="text-sm text-black/60 truncate mr-2">Cantidad · {lineaFoco.nombre}</span>
                  <span className="text-2xl font-semibold tabular-nums">{lineaFoco.cantidad}</span>
                </>
              ) : pagoFoco ? (
                <>
                  <span className="text-sm text-black/60 truncate mr-2">Monto · {MEDIO_LABEL[pagoFoco.medio]}</span>
                  <span className="text-2xl font-semibold tabular-nums">{pesos(pagoFoco.monto)}</span>
                </>
              ) : (
                <>
                  <span className="text-sm text-black/60">Paga con</span>
                  <span className="text-2xl font-semibold tabular-nums">{pagaCon ? pesos(pagaConN) : '$0'}</span>
                </>
              )}
            </div>
          )}

          {/* atajos de efectivo */}
          {!lineaFoco && !pagoFoco && esEfectivoSimple && (
            <div className="grid grid-cols-4 gap-2">
              <button onClick={() => setPagaCon(String(total))} className="rounded-lg bg-emerald-600 text-white py-2.5 text-sm font-medium active:scale-95">Justo</button>
              {[1000, 2000, 5000].map((n) => (
                <button key={n} onClick={() => sumarCash(n)} className="rounded-lg bg-white border border-black/10 py-2.5 text-sm font-medium active:scale-95">+{n / 1000}k</button>
              ))}
            </div>
          )}

          {/* teclado numérico */}
          {tecladoVisible && (
            <div className="grid grid-cols-3 gap-2">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'].map((k) => (
                <button
                  key={k}
                  onClick={() => tecla(k)}
                  className={'rounded-xl py-4 text-2xl font-medium active:scale-95 ' +
                    (k === 'C' ? 'bg-[#B82D25]/10 text-[#932A1F]' : k === '⌫' ? 'bg-black/5 text-black' : 'bg-[#F0EBE2] text-black')}
                >
                  {k}
                </button>
              ))}
            </div>
          )}

          {vuelto != null && (
            <div className={`rounded-xl px-4 py-3 text-center text-lg font-semibold ${vuelto < 0 ? 'bg-[#B82D25]/10 text-[#932A1F]' : 'bg-emerald-50 text-emerald-700'}`}>
              {vuelto < 0 ? `Faltan ${pesos(-vuelto)}` : `Vuelto ${pesos(vuelto)}`}
            </div>
          )}

          {faltaCliente && (
            <p className="rounded-xl bg-[#B82D25]/10 px-3 py-2 text-sm text-[#932A1F] text-center">
              {comprobante === 'A' ? 'Factura A: cargá el CUIT del receptor' : 'Cuenta corriente: identificá al cliente (F3)'}
            </p>
          )}

          {/* cobrar */}
          <button
            onClick={cobrar}
            disabled={carrito.length === 0 || cobrando || faltaCliente || (dividido && restante !== 0)}
            className="mt-auto rounded-2xl bg-[#B82D25] py-6 text-2xl font-semibold text-white active:scale-95 disabled:opacity-40"
          >
            {cobrando ? 'Cobrando…' : usaCtaCte && !dividido ? `Cargar a cuenta ${pesos(totalFinal)}` : `Cobrar ${pesos(totalFinal)}`}
          </button>

          {/* última venta: reimprimir / anular */}
          {ultima && (
            <div className="flex gap-2">
              <button onClick={() => imprimir(ultima.ticket)} className="flex-1 rounded-xl bg-white border border-black/10 py-2.5 text-sm font-medium active:scale-95">
                🖨 Reimprimir (F8)
              </button>
              <button onClick={anularUltima} className="flex-1 rounded-xl bg-white border border-[#B82D25]/40 py-2.5 text-sm font-medium text-[#932A1F] active:scale-95">
                Anular última
              </button>
            </div>
          )}

          <p className="text-center text-[11px] text-black/35 -mt-1">
            F2 comprobante · F3 cliente · F4 medio · F6 estacionar · F8 reimprimir · F9 stock · F12 cobrar · F10 salir
          </p>

          {estado && (
            <p className={'rounded-xl px-3 py-3 text-base ' + (estado.tipo === 'ok' ? 'bg-emerald-50 text-emerald-800' : 'bg-[#B82D25]/10 text-[#932A1F]')}>
              {estado.texto}
            </p>
          )}
        </section>
      </div>

      {/* ---- modal apertura / cierre de caja ---- */}
      {(modalCaja || arqueo) && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-5">
            {arqueo ? (
              <>
                <h2 className="text-xl font-bold text-black">Arqueo de caja</h2>
                <div className="mt-3 space-y-1.5 text-black">
                  <p className="flex justify-between"><span className="text-black/55">Efectivo esperado</span><span className="font-semibold tabular-nums">{pesos(arqueo.esperado)}</span></p>
                  <p className="flex justify-between"><span className="text-black/55">Contado</span><span className="font-semibold tabular-nums">{pesos(arqueo.contado)}</span></p>
                  <p className={'flex justify-between rounded-lg px-2 py-1.5 ' + (arqueo.diferencia === 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-[#B82D25]/10 text-[#932A1F]')}>
                    <span>Diferencia</span>
                    <span className="font-bold tabular-nums">{arqueo.diferencia === 0 ? 'Sin diferencia ✓' : pesos(arqueo.diferencia)}</span>
                  </p>
                </div>
                <button onClick={() => { setArqueo(null); setModalCaja('abrir'); }} className="mt-4 w-full rounded-xl bg-black py-3 text-white font-medium">
                  Listo
                </button>
              </>
            ) : modalCaja === 'abrir' ? (
              <>
                <h2 className="text-xl font-bold text-black">Abrir caja</h2>
                <p className="mt-1 text-sm text-black/55">Elegí tu línea de caja e ingresá la base de efectivo.</p>
                <div className="mt-3 grid gap-1.5">
                  {cajas.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => setCajaElegida(c.id)}
                      className={'rounded-xl border-2 px-3 py-2.5 text-left ' + (cajaElegida === c.id ? 'border-[#B82D25] bg-[#B82D25]/5' : 'border-black/10')}
                    >
                      <span className="font-semibold text-black">
                        {c.nombre}
                        {c.sucursal?.nombre ? <span className="font-normal text-black/50"> · {c.sucursal.nombre}</span> : null}
                      </span>
                      <span className="block text-xs text-black/50">
                        {c.sesionAbierta ? `Abierta por ${c.sesionAbierta.usuario?.nombre ?? '—'} · se retoma la sesión` : 'Cerrada · se abre nueva sesión'}
                      </span>
                    </button>
                  ))}
                  {cajas.length === 0 && <p className="text-sm text-black/50">No hay cajas configuradas (se pueden crear desde Cierres).</p>}
                </div>
                {!cajas.find((c) => c.id === cajaElegida)?.sesionAbierta && (
                  <input
                    value={montoBuf}
                    onChange={(e) => setMontoBuf(e.target.value.replace(/[^\d]/g, ''))}
                    placeholder="Base de efectivo (ej: 20000)"
                    inputMode="numeric"
                    className="mt-3 w-full rounded-xl border-2 border-black/10 px-3 py-3 text-lg text-black outline-none focus:border-[#B82D25]"
                  />
                )}
                <div className="mt-4 flex gap-2">
                  <Link href="/inicio" className="flex-1 rounded-xl border border-black/10 py-3 text-center text-black/60">Salir</Link>
                  <button onClick={abrirCaja} disabled={!cajaElegida || cajas.length === 0} className="flex-1 rounded-xl bg-[#B82D25] py-3 text-white font-semibold disabled:opacity-40">
                    {cajas.find((c) => c.id === cajaElegida)?.sesionAbierta ? 'Retomar sesión' : 'Abrir caja'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <h2 className="text-xl font-bold text-black">Cerrar caja · arqueo</h2>
                <p className="mt-1 text-sm text-black/55">Contá el efectivo del cajón e ingresá el total. El sistema compara contra lo esperado.</p>
                <input
                  value={montoBuf}
                  onChange={(e) => setMontoBuf(e.target.value.replace(/[^\d]/g, ''))}
                  placeholder="Efectivo contado"
                  inputMode="numeric"
                  autoFocus
                  className="mt-3 w-full rounded-xl border-2 border-black/10 px-3 py-3 text-lg text-black outline-none focus:border-[#B82D25]"
                />
                {cola.length > 0 && (
                  <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    ⚠ Hay {cola.length} venta(s) sin enviar. El arqueo del sistema no las incluye hasta que se envíen.
                  </p>
                )}
                <div className="mt-4 flex gap-2">
                  <button onClick={() => setModalCaja(null)} className="flex-1 rounded-xl border border-black/10 py-3 text-black/60">Cancelar</button>
                  <button onClick={cerrarCaja} disabled={cerrando || montoBuf === ''} className="flex-1 rounded-xl bg-black py-3 text-white font-semibold disabled:opacity-40">
                    {cerrando ? 'Cerrando…' : 'Cerrar y arquear'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ---- modales: descuento / movimiento de efectivo / devolución ---- */}
      {modalExtra && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 max-h-[85vh] overflow-y-auto">
            {modalExtra === 'descuento' && (
              <>
                <h2 className="text-xl font-bold text-black">Descuento con autorización</h2>
                <p className="mt-1 text-sm text-black/55">Un gerente o el dueño autoriza con su PIN de firma. Queda auditado.</p>
                <input
                  value={descBuf}
                  onChange={(e) => setDescBuf(e.target.value.replace(/[^\d]/g, ''))}
                  placeholder={`Monto a descontar (total ${pesos(total)})`}
                  inputMode="numeric"
                  autoFocus
                  className="mt-3 w-full rounded-xl border-2 border-black/10 px-3 py-3 text-lg text-black outline-none focus:border-[#B82D25]"
                />
                <input
                  value={pinBuf}
                  onChange={(e) => setPinBuf(e.target.value)}
                  placeholder="PIN del supervisor"
                  type="password"
                  inputMode="numeric"
                  className="mt-2 w-full rounded-xl border-2 border-black/10 px-3 py-3 text-lg text-black outline-none focus:border-[#B82D25]"
                />
                <div className="mt-4 flex gap-2">
                  <button onClick={() => setModalExtra(null)} className="flex-1 rounded-xl border border-black/10 py-3 text-black/60">Cancelar</button>
                  <button onClick={aplicarDescuento} disabled={procesando} className="flex-1 rounded-xl bg-[#B82D25] py-3 text-white font-semibold disabled:opacity-40">
                    {procesando ? 'Verificando…' : 'Autorizar'}
                  </button>
                </div>
              </>
            )}

            {modalExtra === 'movimiento' && (
              <>
                <h2 className="text-xl font-bold text-black">Movimiento de efectivo</h2>
                <p className="mt-1 text-sm text-black/55">Ingresos (cambio) o retiros (a tesorería). Entra al arqueo del cierre.</p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {(['ingreso', 'egreso'] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => setMovTipo(t)}
                      className={'rounded-xl py-3 font-medium border-2 ' + (movTipo === t ? 'bg-black text-white border-black' : 'bg-white text-black border-black/10')}
                    >
                      {t === 'ingreso' ? '↓ Ingreso' : '↑ Retiro'}
                    </button>
                  ))}
                </div>
                <input
                  value={movMonto}
                  onChange={(e) => setMovMonto(e.target.value.replace(/[^\d]/g, ''))}
                  placeholder="Monto"
                  inputMode="numeric"
                  className="mt-2 w-full rounded-xl border-2 border-black/10 px-3 py-3 text-lg text-black outline-none focus:border-[#B82D25]"
                />
                <input
                  value={movMotivo}
                  onChange={(e) => setMovMotivo(e.target.value)}
                  placeholder={movTipo === 'ingreso' ? 'Motivo (ej: cambio de tesorería)' : 'Motivo (ej: retiro a tesorería)'}
                  className="mt-2 w-full rounded-xl border-2 border-black/10 px-3 py-3 text-base text-black outline-none focus:border-[#B82D25]"
                />
                <div className="mt-4 flex gap-2">
                  <button onClick={() => setModalExtra(null)} className="flex-1 rounded-xl border border-black/10 py-3 text-black/60">Cancelar</button>
                  <button onClick={registrarMovimiento} disabled={procesando} className="flex-1 rounded-xl bg-black py-3 text-white font-semibold disabled:opacity-40">
                    {procesando ? 'Guardando…' : 'Registrar'}
                  </button>
                </div>
              </>
            )}

            {modalExtra === 'devolucion' && (
              <>
                <h2 className="text-xl font-bold text-black">Devolución de venta</h2>
                {!devVenta ? (
                  <>
                    <p className="mt-1 text-sm text-black/55">Elegí la venta (últimas 24 h).</p>
                    <div className="mt-3 grid gap-1.5">
                      {devVentas.length === 0 && <p className="text-sm text-black/45">No hay ventas completadas hoy.</p>}
                      {devVentas.map((v: any) => (
                        <button
                          key={v.id}
                          onClick={() => { setDevVenta(v); setDevolver({}); }}
                          className="rounded-xl border-2 border-black/10 px-3 py-2.5 text-left hover:border-[#B82D25]"
                        >
                          <span className="flex justify-between">
                            <span className="font-semibold text-black">
                              {new Date(v.vendida_en).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
                              {v.cliente?.dni ? ` · DNI ${v.cliente.dni}` : ''}
                            </span>
                            <span className="font-semibold text-black tabular-nums">{pesos(v.total)}</span>
                          </span>
                          <span className="block text-xs text-black/50 truncate">
                            {(v.items ?? []).map((i: any) => `${i.cantidad}x ${i.producto?.nombre}`).join(' · ')}
                          </span>
                        </button>
                      ))}
                    </div>
                    <button onClick={() => setModalExtra(null)} className="mt-4 w-full rounded-xl border border-black/10 py-3 text-black/60">Cancelar</button>
                  </>
                ) : (
                  <>
                    <p className="mt-1 text-sm text-black/55">Marcá qué se devuelve (repone stock y emite nota de crédito).</p>
                    <div className="mt-3 grid gap-1.5">
                      {(devVenta.items ?? []).map((i: any) => {
                        const sku = i.producto?.sku;
                        const max = Number(i.cantidad);
                        const cant = devolver[sku] ?? 0;
                        return (
                          <div key={sku} className="rounded-xl bg-[#F0EBE2]/60 px-3 py-2 flex items-center gap-2">
                            <span className="flex-1 min-w-0">
                              <span className="block text-sm font-medium text-black truncate">{i.producto?.nombre}</span>
                              <span className="text-xs text-black/50">{pesos(i.precio_unitario)} c/u · compró {max}</span>
                            </span>
                            <button onClick={() => setDevolver((d) => ({ ...d, [sku]: Math.max(0, (d[sku] ?? 0) - 1) }))} className="h-10 w-10 rounded-lg bg-white border border-black/10 text-xl">−</button>
                            <span className="w-7 text-center font-semibold tabular-nums">{cant}</span>
                            <button onClick={() => setDevolver((d) => ({ ...d, [sku]: Math.min(max, (d[sku] ?? 0) + 1) }))} className="h-10 w-10 rounded-lg bg-black text-white text-xl">+</button>
                          </div>
                        );
                      })}
                    </div>
                    <label className="mt-3 flex items-center gap-2 text-sm text-black">
                      <input type="checkbox" checked={devEfectivo} onChange={(e) => setDevEfectivo(e.target.checked)} className="h-4 w-4" />
                      Reintegro en efectivo (registra egreso de caja)
                    </label>
                    <input
                      value={pinBuf}
                      onChange={(e) => setPinBuf(e.target.value)}
                      placeholder="PIN del supervisor"
                      type="password"
                      inputMode="numeric"
                      className="mt-2 w-full rounded-xl border-2 border-black/10 px-3 py-3 text-lg text-black outline-none focus:border-[#B82D25]"
                    />
                    <div className="mt-4 flex gap-2">
                      <button onClick={() => setDevVenta(null)} className="flex-1 rounded-xl border border-black/10 py-3 text-black/60">Volver</button>
                      <button onClick={confirmarDevolucion} disabled={procesando} className="flex-1 rounded-xl bg-[#B82D25] py-3 text-white font-semibold disabled:opacity-40">
                        {procesando ? 'Procesando…' : 'Confirmar devolución'}
                      </button>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* ---- consulta de stock en ambas sucursales ---- */}
      {modalStock && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center p-4 pt-16" onClick={() => setModalStock(false)}>
          <div className="w-full max-w-lg rounded-2xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xl font-bold text-black">Stock por sucursal</h2>
              <button onClick={() => setModalStock(false)} className="text-black/40 text-xl px-1">✕</button>
            </div>
            <div className="relative">
              <input
                ref={stockInputRef}
                value={stockQ}
                onChange={(e) => onBuscarStock(e.target.value)}
                placeholder="Escaneá o buscá el producto…"
                className="w-full rounded-xl border-2 border-[#B82D25] px-4 py-3 text-base text-black outline-none"
              />
              {stockBuscando && <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-black/40">buscando…</span>}
            </div>
            <div className="mt-3 max-h-[55vh] overflow-y-auto -mx-1 px-1">
              {stockQ.trim().length >= 2 && !stockBuscando && stockRes.length === 0 && (
                <p className="text-center text-black/40 py-8 text-sm">Sin resultados.</p>
              )}
              {stockRes.map((p) => (
                <div key={p.sku} className="rounded-xl bg-[#F0EBE2]/50 px-4 py-3 mb-2">
                  <p className="font-medium text-black leading-tight">{p.nombre}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {p.sucursales.map((s) => (
                      <span
                        key={s.sucursal}
                        className={'rounded-lg px-3 py-1.5 text-sm font-semibold tabular-nums ' +
                          (s.cantidad > 0 ? 'bg-emerald-100 text-emerald-800' : 'bg-[#B82D25]/10 text-[#932A1F]')}
                      >
                        {s.sucursal}: {Math.round(s.cantidad)}
                      </span>
                    ))}
                    <span className="rounded-lg px-3 py-1.5 text-sm font-semibold bg-black text-white tabular-nums">Total {Math.round(p.total)}</span>
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-2 text-center text-[11px] text-black/35">Consulta sin afectar la venta · Esc o F9 para cerrar</p>
          </div>
        </div>
      )}

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
              {i.cantidad} x {i.nombre.slice(0, 26)}
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
