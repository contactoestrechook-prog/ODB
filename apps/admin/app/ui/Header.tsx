import Link from 'next/link';
import { cookies } from 'next/headers';
import { puedeVer, rolDesdeToken } from '../lib/permisos';
import { fecha } from '../lib/formato';
import { apiFetch } from '../../lib/api';
import { BuscadorGlobal } from './BuscadorGlobal';
import { MobileMenu } from './MobileMenu';
import { CampanaAlertas } from './CampanaAlertas';
import { InstalarApp } from './InstalarApp';

type Item = { href: string; label: string; icono: string };
type Grupo = { titulo: string; items: Item[] };

// path SVG (24x24, stroke) por sección
export const ICONOS: Record<string, string> = {
  inicio: 'M3 11l9-8 9 8M5 9v11h5v-6h4v6h5V9',
  ventas: 'M3 3h2l2 12h11l2-8H7M9 19a1 1 0 102 0 1 1 0 00-2 0zm7 0a1 1 0 102 0 1 1 0 00-2 0z',
  caja: 'M4 8h16v12H4zM4 8l2-4h12l2 4M9 12h6',
  facturacion: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h3',
  deposito: 'M3 9l9-6 9 6v11H3zM9 20v-6h6v6',
  salida: 'M14 4h6v16h-6M10 8l-4 4 4 4M6 12h9',
  cierres: 'M5 4h14v16H5zM9 8h6M9 12h6M9 16h3',
  productos: 'M8 3h8l1 5H7zM6 8h12v13H6zM10 12h4',
  stock: 'M4 20V9h4v11M10 20V4h4v16M16 20v-7h4v7',
  promociones: 'M5 5l14 14M8 6a2 2 0 11-4 0 2 2 0 014 0zm12 12a2 2 0 11-4 0 2 2 0 014 0z',
  listas: 'M7 3h10l4 4v14H7zM17 3v4h4M10 12h6M10 16h6',
  compras: 'M6 7h12l1 13H5zM9 7a3 3 0 016 0',
  analista: 'M4 19l5-6 4 3 7-9M4 5v14h16',
  clientes: 'M9 11a3 3 0 100-6 3 3 0 000 6zM3 20a6 6 0 0112 0M16 11a3 3 0 100-6M15 14a6 6 0 016 6',
  somelier: 'M8 3h8c0 5-1 8-4 9v6h3v2H9v-2h3v-6C9 11 8 8 8 3z',
  estadisticas: 'M12 3a9 9 0 109 9h-9z M14 3a9 9 0 017 7h-7z',
  informe: 'M5 3h14v18H5zM9 7h6M9 11h6M9 15h4',
  usuarios: 'M12 8a3 3 0 100-6 3 3 0 000 6zM5 21a7 7 0 0114 0M19 8h4M21 6v4',
  eficiencia: 'M12 8v4l3 2M12 3a9 9 0 100 18 9 9 0 000-18z',
  mensajes: 'M4 5h16v11H9l-5 4zM8 9h8M8 12h5',
  eventos: 'M4 5h16v15H4zM4 9h16M8 3v4M16 3v4M9 14h2v2H9z',
  envios: 'M3 7h10v8H3zM13 10h4l3 3v2h-7M6 18a1.6 1.6 0 100-3.2A1.6 1.6 0 006 18zm10 0a1.6 1.6 0 100-3.2A1.6 1.6 0 0016 18z',
  repartidor: 'M5 18a2 2 0 100-4 2 2 0 000 4zm14 0a2 2 0 100-4 2 2 0 000 4zM7 16l3-7h4l2 4h3M14 9l-1-3h-3',
  conciliacion: 'M7 8l-4 4 4 4M3 12h12M17 16l4-4-4-4M21 12H9',
  arca: 'M5 3h10l4 4v14H5zM14 3v5h5M8 12h8M8 15h8M8 18h5',
  tarjetas: 'M3 6h18v12H3zM3 10h18M6 15h5',
  mercadopago: 'M12 4C7 4 3 7 3 10.5S7 17 12 17s9-3 9-6.5S17 4 12 4zM7 17v3M17 17v3M8 10c1-1.5 2.5-1.5 3.5-.5l1 1c1 1 2.5 1 3.5-.5',
  comparador: 'M12 4v16M8 20h8M6 8h12M6 8l-2.5 5a2.5 2.5 0 005 0zm12 0l-2.5 5a2.5 2.5 0 005 0z',
  pedidos: 'M9 4h6a1 1 0 011 1v1h2v14H6V6h2V5a1 1 0 011-1zM9 6h6M9 11h6M9 15h4',
  reparto: 'M12 2a6 6 0 016 6c0 4-6 12-6 12S6 12 6 8a6 6 0 016-6zm0 4a2 2 0 100 4 2 2 0 000-4z',
  cheques: 'M3 7h18v10H3zM3 11h18M7 15h4',
  libroiva: 'M5 4h11l3 3v13H5zM9 4v16M12 9h5M12 13h5',
  tiendanube: 'M7 18a4 4 0 010-8 5 5 0 019.6-1.3A3.5 3.5 0 0117 18z',
  agente: 'M12 3v2M7 8h10a2 2 0 012 2v7a2 2 0 01-2 2H7a2 2 0 01-2-2v-7a2 2 0 012-2zM9 13h.01M15 13h.01',
  // pie del menú (escritorio y celular)
  manual: 'M4 5.5A1.5 1.5 0 015.5 4H10a2 2 0 012 2v13a2 2 0 00-2-2H5.5A1.5 1.5 0 014 15.5zM20 5.5A1.5 1.5 0 0018.5 4H14a2 2 0 00-2 2v13a2 2 0 012-2h4.5a1.5 1.5 0 001.5-1.5z',
  clave: 'M7 11V7a5 5 0 0110 0v4M6 11h12v9H6zM12 15v2',
  salir: 'M10 4H4v16h6M14 8l4 4-4 4M8 12h10',
};

const GRUPOS: Grupo[] = [
  {
    titulo: 'Operación',
    items: [
      { href: '/inicio', label: 'Inicio', icono: 'inicio' },
      { href: '/ventas', label: 'Ventas', icono: 'ventas' },
      { href: '/pedidos', label: 'Pedidos', icono: 'pedidos' },
      { href: '/caja', label: 'Caja', icono: 'caja' },
      { href: '/facturacion', label: 'Facturación', icono: 'facturacion' },
      { href: '/deposito', label: 'Depósito', icono: 'deposito' },
      { href: '/recepcion', label: 'Recepción', icono: 'compras' },
      { href: '/envios', label: 'Envíos', icono: 'envios' },
      { href: '/repartidor', label: 'Repartidor', icono: 'repartidor' },
      { href: '/repartidores', label: 'Repartidores', icono: 'repartidor' },
      { href: '/reparto', label: 'Reparto', icono: 'reparto' },
      { href: '/salida', label: 'Salida', icono: 'salida' },
      { href: '/cierres', label: 'Cierres', icono: 'cierres' },
    ],
  },
  {
    titulo: 'Catálogo',
    items: [
      { href: '/productos', label: 'Productos', icono: 'productos' },
      { href: '/precios', label: 'Precios', icono: 'productos' },
      { href: '/stock', label: 'Stock', icono: 'stock' },
      { href: '/conteo', label: 'Conteo', icono: 'stock' },
      { href: '/fraccionar', label: 'Fraccionar', icono: 'stock' },
      { href: '/promociones', label: 'Promociones', icono: 'promociones' },
      { href: '/listas-venta', label: 'Listas de venta', icono: 'listas' },
      { href: '/listas', label: 'Listas de proveedor', icono: 'listas' },
      { href: '/tiendanube', label: 'Tienda Nube', icono: 'tiendanube' },
    ],
  },
  {
    titulo: 'Abastecimiento',
    items: [
      { href: '/compras', label: 'Compras', icono: 'compras' },
      { href: '/pedido-proveedor', label: 'Pedido a proveedor', icono: 'compras' },
      { href: '/facturas-compra', label: 'Facturas de compra', icono: 'listas' },
      { href: '/mesa-compras', label: 'Mesa de compras', icono: 'comparador' },
      { href: '/comparador', label: 'Proveedores', icono: 'comparador' },
      { href: '/trazabilidad', label: 'Trazabilidad', icono: 'listas' },
      { href: '/analista', label: 'Analista ODB', icono: 'analista' },
      { href: '/agente', label: 'Agente IA', icono: 'agente' },
    ],
  },
  {
    titulo: 'Clientes',
    items: [
      { href: '/clientes', label: 'Clientes', icono: 'clientes' },
      { href: '/cuentas-corrientes', label: 'Cuentas corrientes', icono: 'clientes' },
      { href: '/mensajes', label: 'Mensajes', icono: 'mensajes' },
      { href: '/eventos', label: 'Eventos', icono: 'eventos' },
      { href: '/sommelier', label: 'Somelier ODB', icono: 'somelier' },
      // UN solo RESPONDE (1/10/2026): había tres entradas del bot y dos mostraban
      // charlas mezcladas con las del simulador. Las conversaciones reales están en
      // RESPONDE; las campañas, en Difusiones; probar el bot, aparte.
      { href: '/responde', label: 'RESPONDE', icono: 'agente' },
      { href: '/bandeja', label: 'Difusiones', icono: 'mensajes' },
      { href: '/bot', label: 'Probar el bot', icono: 'agente' },
    ],
  },
  {
    titulo: 'Dirección',
    items: [
      // Primero de la lista a propósito: es la cola que frena a todo el resto.
      { href: '/aprobaciones', label: 'Aprobaciones', icono: 'conciliacion' },
      // quién hizo qué en todo el sistema (6/10/2026)
      { href: '/actividad', label: 'Actividad del equipo', icono: 'usuarios' },
      { href: '/estadisticas', label: 'Estadísticas', icono: 'estadisticas' },
      { href: '/mercadopago', label: 'Mercado Pago', icono: 'mercadopago' },
      { href: '/tarjetas', label: 'Tarjetas', icono: 'tarjetas' },
      { href: '/arca', label: 'ARCA', icono: 'arca' },
      { href: '/contable', label: 'Contable', icono: 'libroiva' },
      { href: '/conciliacion', label: 'Conciliación', icono: 'conciliacion' },
      { href: '/cheques', label: 'Cheques', icono: 'cheques' },
      { href: '/libro-iva', label: 'Libro IVA', icono: 'libroiva' },
      { href: '/informes', label: 'Informe diario', icono: 'informe' },
      { href: '/reportes', label: 'Reportes del equipo', icono: 'usuarios' },
      { href: '/eficiencia', label: 'Eficiencia', icono: 'eficiencia' },
      { href: '/usuarios', label: 'Usuarios', icono: 'usuarios' },
    ],
  },
];

const TITULOS: Record<string, { titulo: string; bajada: string }> = {
  '/inicio': { titulo: 'Inicio', bajada: 'El negocio de un vistazo: hoy, alertas y accesos' },
  '/ventas': { titulo: 'Ventas', bajada: 'Tickets del día y últimas operaciones de las dos sucursales' },
  '/caja': { titulo: 'Caja', bajada: 'Sesiones de caja, arqueos y facturación ARCA' },
  '/facturacion': { titulo: 'Facturación', bajada: 'Facturas, notas, remitos, recibos y cuentas corrientes' },
  '/mercadopago': { titulo: 'Mercado Pago', bajada: 'Cobros reales de tu cuenta: comisiones, neto y cuándo se libera la plata' },
  '/arca': { titulo: 'ARCA · Facturación electrónica', bajada: 'Comprobantes con CAE, pendientes de emisión y el paquete mensual para el contador' },
  '/tarjetas': { titulo: 'Tarjetas', bajada: 'Cobros con Getnet y Clover: por acreditar, comisiones y cuándo entra cada pago' },
  '/contable': { titulo: 'Contable', bajada: 'El cierre del mes: IVA ventas y compras, percepciones, Ingresos Brutos y los libros en CSV' },
  '/deposito': { titulo: 'Depósito', bajada: 'Pedidos web y PedidosYa: armado, retiro y entrega' },
  '/recepcion': { titulo: 'Recepción', bajada: 'Escaneá lo que baja del camión: el remito se arma con lo que realmente entró' },
  '/envios': { titulo: 'Envíos a domicilio', bajada: 'Despacho: asigná repartidores y seguí cada entrega en vivo' },
  '/repartidor': { titulo: 'Repartidor', bajada: 'Tus entregas asignadas y compartir tu ubicación en vivo' },
  '/salida': { titulo: 'Control de salida', bajada: 'Validación de códigos de Comprá Fácil' },
  '/cierres': { titulo: 'Cierres', bajada: 'Cierres de caja por sucursal y diferencias' },
  '/productos': { titulo: 'Productos', bajada: 'Catálogo completo: precios, stock y fotos' },
  '/precios': { titulo: 'Precios', bajada: 'Escaneá y mirá el precio de góndola · imprimí la etiqueta' },
  '/stock': { titulo: 'Stock', bajada: 'Quiebres, reposición y vencimientos por sucursal' },
  '/conteo': { titulo: 'Conteo de inventario', bajada: 'Contá el depósito y ajustá diferencias con autorización' },
  '/promociones': { titulo: 'Promociones', bajada: 'Descuentos vigentes, programados y Comunidad ODB' },
  '/listas-venta': { titulo: 'Listas de venta', bajada: 'Las 4 listas de precios (Minorista, Por caja, Mayorista, Eventos), su % y regeneración' },
  '/listas': { titulo: 'Listas de proveedor', bajada: 'Lectura con IA de listas de proveedores y aplicación de costos' },
  '/tiendanube': { titulo: 'Tienda Nube', bajada: 'Sincronización del catálogo y de los pedidos con tu tienda de Tienda Nube' },
  '/compras': { titulo: 'Compras', bajada: 'Órdenes de compra, aprobaciones con PIN y recepción' },
  '/facturas-compra': { titulo: 'Facturas de compra', bajada: 'Todas las facturas de proveedores: vencimientos, pagos, gastos y comprobantes' },
  '/mesa-compras': { titulo: 'Mesa de compras', bajada: 'El costo real de cada compra, con las cuentas hechas por el sistema. El dueño aprueba antes de que se toque un precio.' },
  '/comparador': { titulo: 'Proveedores', bajada: 'Cargá listas, compará precios y decidí dónde conviene comprar cada producto' },
  '/pedidos': { titulo: 'Pedidos', bajada: 'Centro omnicanal: WhatsApp, app, web, PedidosYa, pick-up y domicilio en un solo lugar' },
  '/repartidores': { titulo: 'Repartidores', bajada: 'Alta de repartidores, vehículos y seguros para las autorizaciones de barrio' },
  '/reparto': { titulo: 'Reparto', bajada: 'Hojas de ruta por chofer/zona, flota en vivo en el mapa y rendición' },
  '/analista': { titulo: 'Analista ODB', bajada: 'El asesor de abastecimiento: quiebres, reposición y oportunidades' },
  '/agente': { titulo: 'Agente IA Operativo', bajada: 'Carga y mantiene el catálogo solo, con autonomía supervisada: audita cada acción y escala a un humano cuando duda' },
  '/cuentas-corrientes': { titulo: 'Cuentas corrientes', bajada: 'La plata en la calle: riesgo, topes y mejores pagadores' },
  '/clientes': { titulo: 'Clientes', bajada: 'Cuentas, clasificación RFM y Comunidad ODB' },
  '/mensajes': { titulo: 'Mensajes', bajada: 'Solicitudes de clientes, envíos y notificaciones automáticas' },
  '/eventos': { titulo: 'Eventos', bajada: 'Oportunidades de cumpleaños, casamientos y fiestas: armá propuestas' },
  '/sommelier': { titulo: 'Somelier ODB', bajada: 'El experto en vinos que atiende a tus clientes' },
  '/bot': { titulo: 'Probar el bot', bajada: 'Probá el bot que atiende por WhatsApp: mismo cerebro, catálogo y pedidos reales' },
  '/responde': { titulo: 'RESPONDE', bajada: 'Las conversaciones reales de WhatsApp: contestar, pausar el bot, notas, programados y difusión' },
  '/bandeja': { titulo: 'Difusiones', bajada: 'Campañas por listas y mensajes programados de la línea de WhatsApp' },
  '/estadisticas': { titulo: 'Estadísticas', bajada: 'El negocio en números: 30 días de venta real' },
  '/conciliacion': { titulo: 'Conciliación', bajada: 'Acreditaciones de tarjeta y Mercado Pago: lo que te deben y las comisiones' },
  '/cheques': { titulo: 'Cheques', bajada: 'Cartera de valores: cheques de terceros y propios, depósitos, vencimientos y rechazos' },
  '/libro-iva': { titulo: 'Libro IVA', bajada: 'IVA ventas y compras del mes, débito vs crédito y saldo de la posición' },
  '/informes': { titulo: 'Informe diario', bajada: 'El parte matutino del Analista, todos los días a las 7:00' },
  '/eficiencia': { titulo: 'Eficiencia', bajada: 'Productividad por empleado: tiempos por cliente y de preparación' },
  '/usuarios': { titulo: 'Usuarios', bajada: 'Equipo, roles y permisos de firma' },
  '/actividad': { titulo: 'Actividad del equipo', bajada: 'Quién hizo cada cosa: pedidos, compras, caja, stock, cobros y avisos' },
  '/reportes': { titulo: 'Reportes del equipo', bajada: 'Lo que marcaron con "Esto está mal", clasificado por la IA' },
  // Las cinco que faltaban: decían "O.D.B" en la barra y repetían un título propio.
  '/manual': { titulo: 'Manual del sistema', bajada: 'Cómo funciona cada área: buscá por lo que necesitás resolver' },
  '/pedido-proveedor': { titulo: 'Pedido a proveedor', bajada: 'Armá el pedido desde el celular, con la lista de cada proveedor' },
  '/aprobaciones': { titulo: 'Aprobaciones', bajada: 'Todo lo que espera tu firma: órdenes, pagos, cobros y cambios de costos' },
  '/trazabilidad': { titulo: 'Trazabilidad', bajada: 'Cada compra, de la orden al pago: quién la hizo, la aprobó y la recibió' },
  '/fraccionar': { titulo: 'Fraccionar', bajada: 'Lo que se arma en el local (docenas, maples) para que la caja lo venda' },
};

// Sobre el negro del menú, el gris más apagado es white/55 (6,2:1 de
// contraste); el /30 de antes daba 2,7:1 y no se leía.
function Icono({ d, activo }: { d: string; activo: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`size-[18px] shrink-0 ${activo ? 'text-white' : 'text-white/55 group-hover:text-white/80'}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}

const ENLACE_PIE =
  'group flex items-center gap-3 rounded-xl px-3 py-2 text-sm text-white/70 transition-colors hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50';

/**
 * Menú lateral (escritorio), barra y cajón (celular) y la cabecera blanca de
 * la sección. `titulo`/`bajada` pisan los de TITULOS (fichas, sub-pantallas).
 * En el celular el título va solo en la barra negra; la cabecera blanca queda
 * para el buscador, a lo ancho.
 */
export async function Header({
  activo,
  sinCabecera,
  titulo,
  bajada,
}: {
  activo: string;
  sinCabecera?: boolean;
  titulo?: string;
  bajada?: string;
}) {
  const base = TITULOS[activo] ?? { titulo: 'O.D.B', bajada: '' };
  const seccion = { titulo: titulo ?? base.titulo, bajada: bajada ?? base.bajada };
  // el menú muestra solo lo que el rol puede abrir (backoffice ve Abastecimiento);
  // los roles sin restricción ven todo, como siempre
  const rol = rolDesdeToken((await cookies()).get('odb_token')?.value);
  const grupos = GRUPOS.map((g) => ({ ...g, items: g.items.filter((i) => puedeVer(rol, i.href)) })).filter((g) => g.items.length > 0);

  // Lo que espera firma va con NÚMERO en el menú, no como alerta. Hay 124
  // alertas sin leer en el panel: un aviso que nadie mira no protege nada, y de
  // esto dependen la plata que trae el repartidor y los pedidos a proveedores.
  let porFirmar = 0;
  let cobrosPendientes = 0;
  if (rol === 'dueno' || rol === 'gerente') {
    try {
      const r = await apiFetch('/aprobaciones');
      if (r.ok) {
        const d = await r.json();
        porFirmar = Number(d?.total ?? 0);
        cobrosPendientes = Number(d?.porTipo?.cobranza ?? 0);
      }
    } catch { /* el menú nunca se cae por el contador */ }
  }
  const pendientes: Record<string, number> = { '/aprobaciones': porFirmar, '/clientes': cobrosPendientes };
  const pendientesDe = (href: string) => pendientes[href] ?? 0;

  return (
    <>
      {/* ---- barra lateral ---- */}
      <aside className="fixed inset-y-0 left-0 z-barra hidden w-64 flex-col bg-tinta text-white lg:flex">
        <div className="flex items-start justify-between px-6 pt-7 pb-6">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/odb-logo-blanco.png" alt="O.D.B Premium Market" className="h-12 w-auto" />
          {/* avisos internos: proveedores que escribieron, pagos, derivaciones */}
          <CampanaAlertas esDuenio={rol === 'dueno'} />
        </div>

        <nav aria-label="Secciones del sistema" className="flex-1 space-y-5 overflow-y-auto px-3 pb-4 [scrollbar-color:rgb(255_255_255/0.15)_transparent] [scrollbar-width:thin]">
          {grupos.map((g) => (
            <div key={g.titulo}>
              <p className="mb-1.5 px-3 text-xs font-semibold uppercase tracking-[0.14em] text-white/55">{g.titulo}</p>
              {g.items.map((i) => {
                const esActivo = i.href === activo;
                const n = pendientesDe(i.href);
                return (
                  <Link
                    key={i.href}
                    href={i.href}
                    aria-current={esActivo ? 'page' : undefined}
                    className={`group mb-0.5 flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 ${
                      esActivo ? 'bg-marca font-semibold text-white' : 'text-white/70 hover:bg-white/[0.06] hover:text-white'
                    }`}
                  >
                    <Icono d={ICONOS[i.icono]} activo={esActivo} />
                    <span className="min-w-0 flex-1 truncate">{i.label}</span>
                    {n > 0 && (
                      <span
                        className={`importe rounded-full px-2 text-xs font-semibold leading-5 ${esActivo ? 'bg-white text-marca' : 'bg-marca text-white'}`}
                        title={`${n} esperando tu aprobación`}
                      >
                        {n}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="space-y-0.5 border-t border-white/10 px-3 py-4">
          {/* El manual va en el pie y no en un grupo: lo puede abrir cualquiera
              que entre, sin importar el rol, y siempre está en el mismo lugar. */}
          <Link href="/manual" aria-current={activo === '/manual' ? 'page' : undefined} className={ENLACE_PIE}>
            <Icono d={ICONOS.manual} activo={false} />
            Manual del sistema
          </Link>
          <Link href="/cambiar-clave" className={ENLACE_PIE}>
            <Icono d={ICONOS.clave} activo={false} />
            Cambiar mi contraseña
          </Link>
          <InstalarApp />
          <a href="/api/salir" className={ENLACE_PIE}>
            <Icono d={ICONOS.salir} activo={false} />
            Cerrar sesión
          </a>
        </div>
      </aside>

      {/* ---- navegación móvil: barra negra + cajón ---- */}
      <MobileMenu grupos={grupos} iconos={ICONOS} activo={activo} titulo={seccion.titulo} pendientes={pendientes} esDuenio={rol === 'dueno'} />

      {/* ---- cabecera de sección ----
          celular: solo el buscador, a lo ancho (el título ya está en la barra negra)
          escritorio: título + bajada a la izquierda, buscador y fecha a la derecha */}
      {!sinCabecera && (
        <div className="border-b border-black/[0.06] bg-white">
          <div className="flex flex-col gap-3 px-4 py-3 sm:px-6 lg:flex-row lg:items-center lg:gap-6 lg:px-8 lg:py-5">
            <div className="hidden min-w-0 flex-1 lg:block">
              <h1 className="truncate text-xl font-bold tracking-tight text-tinta">{seccion.titulo}</h1>
              {seccion.bajada && <p className="mt-0.5 text-sm text-tinta/60">{seccion.bajada}</p>}
            </div>
            <div className="w-full lg:w-80 lg:shrink-0 xl:w-md">
              <BuscadorGlobal />
            </div>
            <p className="hidden shrink-0 whitespace-nowrap text-sm text-tinta/60 first-letter:uppercase xl:block">
              {fecha(new Date(), 'dia')}
            </p>
          </div>
        </div>
      )}
    </>
  );
}
