import Link from 'next/link';
import { cookies } from 'next/headers';
import { ICONOS } from '../ui/Header';
import { Pantalla } from '../ui/kit/Pantalla';
import { Aviso, Etiqueta, FOCO, Kpi, ROTULO, unir } from '../ui/kit';
import { apiFetch } from '../../lib/api';
import { fecha, numero, pesos } from '../lib/formato';
import { puedeVer, rolDesdeToken } from '../lib/permisos';

const miles = (n: any) => numero(n ?? 0);

export const dynamic = 'force-dynamic';

async function json(path: string, fallback: any, errs: string[]) {
  try {
    const r = await apiFetch(path);
    if (!r.ok) { errs.push(path); return fallback; }
    return await r.json();
  } catch { errs.push(path); return fallback; }
}

// path SVG extra para módulos que todavía no tienen sección
const EXTRA: Record<string, string> = {
  sueldos: 'M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6',
  fondos: 'M3 7h18v10H3zM16 12h3M6 12h.5',
  horarios: 'M12 7v5l3 2M12 3a9 9 0 100 18 9 9 0 000-18z',
};

function Ico({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

// Tarjeta de acceso: blanca, del mismo alto en toda la grilla. El número rojo
// es "algo espera" (como en el menú); el gris, un dato (cantidad de productos).
const TARJETA = 'flex min-h-28 min-w-0 flex-col justify-between rounded-2xl border p-4';

export default async function Inicio() {
  const rol = rolDesdeToken((await cookies()).get('odb_token')?.value);
  const errs: string[] = [];
  const [ventas, stock, compras, fact, caja, pedidos] = await Promise.all([
    json('/ventas/resumen', {}, errs),
    json('/stock/resumen', {}, errs),
    json('/compras/resumen', {}, errs),
    json('/facturacion/resumen', {}, errs),
    json('/caja/resumen', {}, errs),
    json('/pedidos', [], errs),
  ]);
  const apiCaida = errs.length >= 4;

  const quiebres = (Number(stock.negativos) || 0) + (Number(stock.bajo_reposicion) || 0);
  const pedidosActivos = Array.isArray(pedidos) ? pedidos.length : 0;

  const kpis = [
    { label: 'Facturado hoy', valor: pesos(ventas.facturado ?? 0) },
    { label: 'Ventas', valor: miles(ventas.tickets) },
    { label: 'Por cobrar', valor: pesos(fact.porCobrar ?? 0) },
    { label: 'Quiebres', valor: miles(quiebres), alerta: quiebres > 0 },
  ];

  const GRUPOS: any[] = [
    {
      titulo: 'Operación',
      items: [
        { label: 'Facturación', href: '/facturacion', icon: 'facturacion', sub: 'A · B · R · cuenta corriente' },
        { label: 'Pedidos', href: '/pedidos', icon: 'pedidos', sub: 'whatsapp · web · PY', badge: pedidosActivos },
        { label: 'Reparto', href: '/reparto', icon: 'reparto', sub: 'hojas de ruta' },
        { label: 'Envíos', href: '/envios', icon: 'envios', sub: 'despacho a domicilio' },
        { label: 'Cierres', href: '/cierres', icon: 'cierres', sub: 'caja y arqueo' },
      ],
    },
    {
      titulo: 'Catálogo y abastecimiento',
      items: [
        { label: 'Productos', href: '/productos', icon: 'productos', sub: 'catálogo y precios', count: stock.skus_activos ? miles(stock.skus_activos) : null },
        { label: 'Stock', href: '/stock', icon: 'stock', sub: 'quiebres y vencimientos', badge: quiebres },
        { label: 'Precios y listas', href: '/listas', icon: 'listas', sub: 'de proveedor' },
        { label: 'Compras', href: '/compras', icon: 'compras', sub: 'OC y pagos', badge: compras.pendientesAprobacion },
        { label: 'Proveedores', href: '/comparador', icon: 'comparador', sub: 'directorio y comparador' },
        { label: 'Agente IA', href: '/agente', icon: 'agente', sub: 'carga y mantiene' },
        { label: 'Tienda Nube', href: '/tiendanube', icon: 'tiendanube', sub: 'sync catálogo y pedidos' },
        { label: 'Analista ODB', href: '/analista', icon: 'analista', sub: 'asesor de abastecimiento' },
      ],
    },
    {
      titulo: 'Clientes y administración',
      items: [
        { label: 'Clientes', href: '/clientes', icon: 'clientes', sub: 'RFM y comunidad' },
        { label: 'Cuenta corriente', href: '/facturacion', icon: 'facturacion', sub: 'cobranzas', badge: fact.cuentasActivas },
        { label: 'Cheques', href: '/cheques', icon: 'cheques', sub: 'cartera de valores' },
        { label: 'Conciliación', href: '/conciliacion', icon: 'conciliacion', sub: 'MP · tarjeta · efectivo' },
        { label: 'Libro IVA', href: '/libro-iva', icon: 'libroiva', sub: 'ventas y compras' },
        { label: 'Mensajes', href: '/mensajes', icon: 'mensajes', sub: 'solicitudes' },
        { label: 'Eventos', href: '/eventos', icon: 'eventos', sub: 'oportunidades' },
      ],
    },
    {
      titulo: 'Dirección',
      items: [
        { label: 'Estadísticas', href: '/estadisticas', icon: 'estadisticas', sub: 'el negocio en números' },
        { label: 'Informe diario', href: '/informes', icon: 'informe', sub: 'parte de las 7:00' },
        { label: 'Eficiencia', href: '/eficiencia', icon: 'eficiencia', sub: 'por empleado' },
        { label: 'Usuarios', href: '/usuarios', icon: 'usuarios', sub: 'roles y permisos' },
        { label: 'Sueldos', path: EXTRA.sueldos, sub: 'liquidación y comisiones', pronto: true },
        { label: 'Fondos de caja', path: EXTRA.fondos, sub: 'gastos y retiros', pronto: true },
        { label: 'Horarios', path: EXTRA.horarios, sub: 'del equipo', pronto: true },
      ],
    },
  ];

  // Los accesos muestran solo lo que el rol puede abrir (el mismo filtro que el menú).
  const grupos = GRUPOS.map((g) => ({ ...g, items: g.items.filter((it: any) => !it.href || puedeVer(rol, it.href)) })).filter(
    (g) => g.items.length > 0,
  );
  const veCaja = puedeVer(rol, '/caja');

  const hoy = fecha(new Date(), 'dia');

  return (
    <Pantalla activo="/inicio" ancho="ancho">
      <section aria-labelledby="inicio-hoy" className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-0.5">
          <h2 id="inicio-hoy" className={ROTULO}>Centro de operación</h2>
          <p className="text-sm text-tinta/60">
            <span className="inline-block first-letter:uppercase">{hoy}</span> · Caja 1 · Canning
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {kpis.map((k) => (
            <Kpi key={k.label} etiqueta={k.label} valor={k.valor} tono={k.alerta ? 'atencion' : 'neutro'} />
          ))}
        </div>
      </section>

      {apiCaida && (
        <Aviso tono="error">
          No pude consultar la API: revisá tu sesión (quizás expiró) o la conexión. Los números pueden no ser reales.
        </Aviso>
      )}

      {grupos.map((g, gi) => (
        <section key={g.titulo} aria-labelledby={`inicio-grupo-${gi}`}>
          <h2 id={`inicio-grupo-${gi}`} className={unir(ROTULO, 'mb-2.5 px-0.5')}>{g.titulo}</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {g.titulo === 'Operación' && veCaja && (
              <Link
                href="/caja"
                className={unir(
                  'col-span-2 flex min-h-28 min-w-0 flex-col justify-between rounded-2xl bg-marca p-4 text-white shadow-tarjeta transition-colors hover:bg-marca-hondo',
                  FOCO,
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="flex size-10 items-center justify-center rounded-xl bg-white/20">
                    <Ico d={ICONOS.caja} />
                  </span>
                  <span className="text-sm text-white/85" aria-hidden="true">cobrar →</span>
                </div>
                <div className="mt-3">
                  <p className="text-base font-semibold">Caja</p>
                  <p className="mt-0.5 text-sm text-white/85">cobrar · escanear · facturar</p>
                </div>
              </Link>
            )}
            {g.items.map((it: any) => {
              const inner = (
                <>
                  <div className="flex items-start justify-between gap-2">
                    <span
                      className={unir(
                        'flex size-10 shrink-0 items-center justify-center rounded-xl',
                        it.pronto ? 'bg-crema text-tinta/40' : 'bg-crema text-tinta/70',
                      )}
                    >
                      <Ico d={it.path ?? ICONOS[it.icon]} />
                    </span>
                    {it.badge ? (
                      <span className="importe rounded-full bg-marca px-2 text-xs font-semibold leading-5 text-white">{it.badge}</span>
                    ) : it.count ? (
                      <span className="importe text-xs text-tinta/60">{it.count}</span>
                    ) : it.pronto ? (
                      <Etiqueta>pronto</Etiqueta>
                    ) : null}
                  </div>
                  <div className="mt-3 min-w-0">
                    <p className={unir('truncate text-sm font-semibold', it.pronto ? 'text-tinta/60' : 'text-tinta')}>{it.label}</p>
                    {it.sub && <p className="mt-0.5 text-xs leading-snug text-tinta/60">{it.sub}</p>}
                  </div>
                </>
              );
              return it.pronto ? (
                <div key={it.label} className={unir(TARJETA, 'border-dashed border-black/15 bg-white/60')} aria-disabled="true">
                  {inner}
                </div>
              ) : (
                <Link
                  key={it.label}
                  href={it.href}
                  className={unir(TARJETA, 'border-black/[0.06] bg-white shadow-tarjeta transition-colors hover:border-black/15 hover:bg-crema-claro', FOCO)}
                >
                  {inner}
                </Link>
              );
            })}
          </div>
        </section>
      ))}
    </Pantalla>
  );
}
