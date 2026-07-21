import Link from 'next/link';
import { BuscadorGlobal } from './BuscadorGlobal';
import { MobileMenu } from './MobileMenu';

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
  comparador: 'M12 4v16M8 20h8M6 8h12M6 8l-2.5 5a2.5 2.5 0 005 0zm12 0l-2.5 5a2.5 2.5 0 005 0z',
  pedidos: 'M9 4h6a1 1 0 011 1v1h2v14H6V6h2V5a1 1 0 011-1zM9 6h6M9 11h6M9 15h4',
  envases: 'M10 3h4v2l1 2v12a1 1 0 01-1 1h-4a1 1 0 01-1-1V7l1-2zM9 11h6',
  reparto: 'M12 2a6 6 0 016 6c0 4-6 12-6 12S6 12 6 8a6 6 0 016-6zm0 4a2 2 0 100 4 2 2 0 000-4z',
  cheques: 'M3 7h18v10H3zM3 11h18M7 15h4',
  libroiva: 'M5 4h11l3 3v13H5zM9 4v16M12 9h5M12 13h5',
  tiendanube: 'M7 18a4 4 0 010-8 5 5 0 019.6-1.3A3.5 3.5 0 0117 18z',
  agente: 'M12 3v2M7 8h10a2 2 0 012 2v7a2 2 0 01-2 2H7a2 2 0 01-2-2v-7a2 2 0 012-2zM9 13h.01M15 13h.01',
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
      { href: '/envios', label: 'Envíos', icono: 'envios' },
      { href: '/repartidor', label: 'Repartidor', icono: 'repartidor' },
      { href: '/repartidores', label: 'Repartidores', icono: 'repartidor' },
      { href: '/reparto', label: 'Reparto', icono: 'reparto' },
      { href: '/envases', label: 'Envases', icono: 'envases' },
      { href: '/salida', label: 'Salida', icono: 'salida' },
      { href: '/cierres', label: 'Cierres', icono: 'cierres' },
    ],
  },
  {
    titulo: 'Catálogo',
    items: [
      { href: '/productos', label: 'Productos', icono: 'productos' },
      { href: '/stock', label: 'Stock', icono: 'stock' },
      { href: '/conteo', label: 'Conteo', icono: 'stock' },
      { href: '/promociones', label: 'Promociones', icono: 'promociones' },
      { href: '/listas', label: 'Listas de precios', icono: 'listas' },
      { href: '/tiendanube', label: 'Tienda Nube', icono: 'tiendanube' },
    ],
  },
  {
    titulo: 'Abastecimiento',
    items: [
      { href: '/compras', label: 'Compras', icono: 'compras' },
      { href: '/comparador', label: 'Proveedores', icono: 'comparador' },
      { href: '/analista', label: 'Analista ODB', icono: 'analista' },
      { href: '/agente', label: 'Agente IA', icono: 'agente' },
    ],
  },
  {
    titulo: 'Clientes',
    items: [
      { href: '/clientes', label: 'Clientes', icono: 'clientes' },
      { href: '/mensajes', label: 'Mensajes', icono: 'mensajes' },
      { href: '/eventos', label: 'Eventos', icono: 'eventos' },
      { href: '/sommelier', label: 'Somelier ODB', icono: 'somelier' },
      { href: '/bot', label: 'Bot WhatsApp', icono: 'agente' },
    ],
  },
  {
    titulo: 'Dirección',
    items: [
      { href: '/estadisticas', label: 'Estadísticas', icono: 'estadisticas' },
      { href: '/conciliacion', label: 'Conciliación', icono: 'conciliacion' },
      { href: '/cheques', label: 'Cheques', icono: 'cheques' },
      { href: '/libro-iva', label: 'Libro IVA', icono: 'libroiva' },
      { href: '/informes', label: 'Informe diario', icono: 'informe' },
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
  '/deposito': { titulo: 'Depósito', bajada: 'Pedidos web y PedidosYa: armado, retiro y entrega' },
  '/envios': { titulo: 'Envíos a domicilio', bajada: 'Despacho: asigná repartidores y seguí cada entrega en vivo' },
  '/repartidor': { titulo: 'Repartidor', bajada: 'Tus entregas asignadas y compartir tu ubicación en vivo' },
  '/salida': { titulo: 'Control de salida', bajada: 'Validación de códigos de Comprá Fácil' },
  '/cierres': { titulo: 'Cierres', bajada: 'Cierres de caja por sucursal y diferencias' },
  '/productos': { titulo: 'Productos', bajada: 'Catálogo completo: precios, stock y fotos' },
  '/stock': { titulo: 'Stock', bajada: 'Quiebres, reposición y vencimientos por sucursal' },
  '/conteo': { titulo: 'Conteo de inventario', bajada: 'Contá el depósito y ajustá diferencias con autorización' },
  '/promociones': { titulo: 'Promociones', bajada: 'Descuentos vigentes, programados y Comunidad ODB' },
  '/listas': { titulo: 'Listas de precios', bajada: 'Lectura con IA de listas de proveedores y aplicación de costos' },
  '/tiendanube': { titulo: 'Tienda Nube', bajada: 'Sincronización del catálogo y de los pedidos con tu tienda de Tienda Nube' },
  '/compras': { titulo: 'Compras', bajada: 'Órdenes de compra, aprobaciones con PIN y recepción' },
  '/comparador': { titulo: 'Proveedores', bajada: 'Cargá listas, compará precios y decidí dónde conviene comprar cada producto' },
  '/pedidos': { titulo: 'Pedidos', bajada: 'Centro omnicanal: WhatsApp, app, web, PedidosYa, pick-up y domicilio en un solo lugar' },
  '/envases': { titulo: 'Envases', bajada: 'Envases retornables: qué tiene cada cliente, valor en la calle y movimientos' },
  '/repartidores': { titulo: 'Repartidores', bajada: 'Alta de repartidores, vehículos y seguros para las autorizaciones de barrio' },
  '/reparto': { titulo: 'Reparto', bajada: 'Hojas de ruta por chofer/zona, flota en vivo en el mapa y rendición' },
  '/analista': { titulo: 'Analista ODB', bajada: 'El asesor de abastecimiento: quiebres, reposición y oportunidades' },
  '/agente': { titulo: 'Agente IA Operativo', bajada: 'Carga y mantiene el catálogo solo, con autonomía supervisada: audita cada acción y escala a un humano cuando duda' },
  '/clientes': { titulo: 'Clientes', bajada: 'Cuentas, clasificación RFM y Comunidad ODB' },
  '/mensajes': { titulo: 'Mensajes', bajada: 'Solicitudes de clientes, envíos y notificaciones automáticas' },
  '/eventos': { titulo: 'Eventos', bajada: 'Oportunidades de cumpleaños, casamientos y fiestas: armá propuestas' },
  '/sommelier': { titulo: 'Somelier ODB', bajada: 'El experto en vinos que atiende a tus clientes' },
  '/bot': { titulo: 'Bot WhatsApp', bajada: 'Probá el bot que atiende por WhatsApp: mismo cerebro, catálogo y pedidos reales' },
  '/estadisticas': { titulo: 'Estadísticas', bajada: 'El negocio en números: 30 días de venta real' },
  '/conciliacion': { titulo: 'Conciliación', bajada: 'Acreditaciones de tarjeta y Mercado Pago: lo que te deben y las comisiones' },
  '/cheques': { titulo: 'Cheques', bajada: 'Cartera de valores: cheques de terceros y propios, depósitos, vencimientos y rechazos' },
  '/libro-iva': { titulo: 'Libro IVA', bajada: 'IVA ventas y compras del mes, débito vs crédito y saldo de la posición' },
  '/informes': { titulo: 'Informe diario', bajada: 'El parte matutino del Analista, todos los días a las 7:00' },
  '/eficiencia': { titulo: 'Eficiencia', bajada: 'Productividad por empleado: tiempos por cliente y de preparación' },
  '/usuarios': { titulo: 'Usuarios', bajada: 'Equipo, roles y permisos de firma' },
};

function Icono({ d, activo }: { d: string; activo: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`w-[18px] h-[18px] shrink-0 ${activo ? 'text-white' : 'text-white/40 group-hover:text-white/70'}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={d} />
    </svg>
  );
}

export function Header({ activo, sinCabecera }: { activo: string; sinCabecera?: boolean }) {
  const seccion = TITULOS[activo] ?? { titulo: 'O.D.B', bajada: '' };
  return (
    <>
      {/* ---- barra lateral ---- */}
      <aside className="fixed inset-y-0 left-0 w-64 bg-[#121212] text-white flex-col z-40 hidden lg:flex">
        <div className="px-6 pt-7 pb-6">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/odb-logo-blanco.png" alt="O.D.B Premium Market" className="h-12 w-auto" />
        </div>

        <nav className="flex-1 overflow-y-auto px-3 pb-4 space-y-5">
          {GRUPOS.map((g) => (
            <div key={g.titulo}>
              <p className="px-3 mb-1.5 text-[10px] font-semibold tracking-[0.18em] text-white/30 uppercase">
                {g.titulo}
              </p>
              {g.items.map((i) => {
                const esActivo = i.href === activo;
                return (
                  <Link
                    key={i.href}
                    href={i.href}
                    className={`group flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] mb-0.5 transition-colors ${
                      esActivo
                        ? 'bg-[#B82D25] text-white font-medium'
                        : 'text-white/60 hover:text-white hover:bg-white/5'
                    }`}
                  >
                    <Icono d={ICONOS[i.icono]} activo={esActivo} />
                    {i.label}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="px-3 py-4 border-t border-white/10">
          <a
            href="/api/salir"
            className="flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] text-white/50 hover:text-white hover:bg-white/5"
          >
            <svg viewBox="0 0 24 24" className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 4H4v16h6M14 8l4 4-4 4M8 12h10" />
            </svg>
            Cerrar sesión
          </a>
        </div>
      </aside>

      {/* ---- navegación móvil: hamburguesa + cajón ---- */}
      <MobileMenu grupos={GRUPOS} iconos={ICONOS} activo={activo} titulo={seccion.titulo} />

      {/* ---- cabecera de sección ---- */}
      {!sinCabecera && (
        <div className="bg-white border-b border-black/5">
          <div className="px-6 lg:px-10 py-5 flex items-center justify-between gap-4">
            <div className="shrink-0">
              <h1 className="text-xl font-semibold text-black">{seccion.titulo}</h1>
              {seccion.bajada && <p className="text-[13px] text-black/45 mt-0.5 hidden md:block">{seccion.bajada}</p>}
            </div>
            <div className="flex-1 flex justify-end max-w-md ml-auto">
              <BuscadorGlobal />
            </div>
            <p className="text-[13px] text-black/40 whitespace-nowrap hidden xl:block capitalize">
              {new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })}
            </p>
          </div>
        </div>
      )}
    </>
  );
}
