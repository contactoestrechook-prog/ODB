import Link from 'next/link';
import { BuscadorGlobal } from './BuscadorGlobal';
import { MobileMenu } from './MobileMenu';

type Item = { href: string; label: string; icono: string };
type Grupo = { titulo: string; items: Item[] };

// path SVG (24x24, stroke) por sección
const ICONOS: Record<string, string> = {
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
};

const GRUPOS: Grupo[] = [
  {
    titulo: 'Operación',
    items: [
      { href: '/inicio', label: 'Inicio', icono: 'inicio' },
      { href: '/ventas', label: 'Ventas', icono: 'ventas' },
      { href: '/caja', label: 'Caja', icono: 'caja' },
      { href: '/facturacion', label: 'Facturación', icono: 'facturacion' },
      { href: '/deposito', label: 'Depósito', icono: 'deposito' },
      { href: '/envios', label: 'Envíos', icono: 'envios' },
      { href: '/repartidor', label: 'Repartidor', icono: 'repartidor' },
      { href: '/salida', label: 'Salida', icono: 'salida' },
      { href: '/cierres', label: 'Cierres', icono: 'cierres' },
    ],
  },
  {
    titulo: 'Catálogo',
    items: [
      { href: '/productos', label: 'Productos', icono: 'productos' },
      { href: '/stock', label: 'Stock', icono: 'stock' },
      { href: '/promociones', label: 'Promociones', icono: 'promociones' },
      { href: '/listas', label: 'Listas de precios', icono: 'listas' },
    ],
  },
  {
    titulo: 'Abastecimiento',
    items: [
      { href: '/compras', label: 'Compras', icono: 'compras' },
      { href: '/comparador', label: 'Comparador', icono: 'comparador' },
      { href: '/analista', label: 'Analista ODB', icono: 'analista' },
    ],
  },
  {
    titulo: 'Clientes',
    items: [
      { href: '/clientes', label: 'Clientes', icono: 'clientes' },
      { href: '/mensajes', label: 'Mensajes', icono: 'mensajes' },
      { href: '/eventos', label: 'Eventos', icono: 'eventos' },
      { href: '/sommelier', label: 'Somelier ODB', icono: 'somelier' },
    ],
  },
  {
    titulo: 'Dirección',
    items: [
      { href: '/estadisticas', label: 'Estadísticas', icono: 'estadisticas' },
      { href: '/conciliacion', label: 'Conciliación', icono: 'conciliacion' },
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
  '/promociones': { titulo: 'Promociones', bajada: 'Descuentos vigentes, programados y Comunidad ODB' },
  '/listas': { titulo: 'Listas de precios', bajada: 'Lectura con IA de listas de proveedores y aplicación de costos' },
  '/compras': { titulo: 'Compras', bajada: 'Órdenes de compra, aprobaciones con PIN y recepción' },
  '/comparador': { titulo: 'Comparador', bajada: 'Compará precios entre proveedores: dónde conviene comprar cada producto' },
  '/analista': { titulo: 'Analista ODB', bajada: 'El asesor de abastecimiento: quiebres, reposición y oportunidades' },
  '/clientes': { titulo: 'Clientes', bajada: 'Cuentas, clasificación RFM y Comunidad ODB' },
  '/mensajes': { titulo: 'Mensajes', bajada: 'Solicitudes de clientes, envíos y notificaciones automáticas' },
  '/eventos': { titulo: 'Eventos', bajada: 'Oportunidades de cumpleaños, casamientos y fiestas: armá propuestas' },
  '/sommelier': { titulo: 'Somelier ODB', bajada: 'El experto en vinos que atiende a tus clientes' },
  '/estadisticas': { titulo: 'Estadísticas', bajada: 'El negocio en números: 30 días de venta real' },
  '/conciliacion': { titulo: 'Conciliación', bajada: 'Acreditaciones de tarjeta y Mercado Pago: lo que te deben y las comisiones' },
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

export function Header({ activo }: { activo: string }) {
  const seccion = TITULOS[activo] ?? { titulo: 'O.D.B', bajada: '' };
  return (
    <>
      {/* ---- barra lateral ---- */}
      <aside className="fixed inset-y-0 left-0 w-64 bg-[#121212] text-white flex-col z-40 hidden lg:flex">
        <div className="px-6 pt-7 pb-6">
          <p className="text-xl font-semibold tracking-[0.3em]">O.D.B</p>
          <p className="text-[10px] tracking-[0.22em] text-[#B82D25] font-semibold mt-1">PREMIUM MARKET</p>
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
    </>
  );
}
