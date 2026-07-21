import Link from 'next/link';
import { Header, ICONOS } from '../ui/Header';
import { apiFetch } from '../../lib/api';

const pesos = (n: any) => '$' + Math.round(Number(n) || 0).toLocaleString('es-AR');
const miles = (n: any) => (Number(n) || 0).toLocaleString('es-AR');

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
    <svg viewBox="0 0 24 24" className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

export default async function Inicio() {
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
    { label: 'Facturado hoy', valor: pesos(ventas.facturado) },
    { label: 'Ventas', valor: miles(ventas.tickets) },
    { label: 'Por cobrar', valor: pesos(fact.porCobrar) },
    { label: 'Quiebres', valor: miles(quiebres), alerta: quiebres > 0 },
  ];

  const GRUPOS: any[] = [
    {
      titulo: 'Operación', color: '#F0837B', card: '#1d1712',
      items: [
        { label: 'Facturación', href: '/facturacion', icon: 'facturacion', sub: 'A · B · R · cuenta corriente' },
        { label: 'Pedidos', href: '/pedidos', icon: 'pedidos', sub: 'whatsapp · web · PY', badge: pedidosActivos },
        { label: 'Reparto', href: '/reparto', icon: 'reparto', sub: 'hojas de ruta' },
        { label: 'Envíos', href: '/envios', icon: 'envios', sub: 'despacho a domicilio' },
        { label: 'Cierres', href: '/cierres', icon: 'cierres', sub: 'caja y arqueo' },
      ],
    },
    {
      titulo: 'Catálogo y abastecimiento', color: '#EBB25A', card: '#1d1a12',
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
      titulo: 'Clientes y administración', color: '#57C6B4', card: '#12191a',
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
      titulo: 'Dirección', color: '#B4A4E4', card: '#171522',
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

  const hoy = new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <main className="min-h-screen bg-[#14100d] lg:pl-64">
      <Header activo="/inicio" sinCabecera />
      <div className="max-w-6xl mx-auto p-4 sm:p-6">

        {/* cabecera oscura: marca + KPIs en vivo */}
        <div className="rounded-2xl bg-[#1c1712] p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/odb-logo-blanco.png" alt="O.D.B" className="h-8 w-auto" />
              <span className="text-[#9a8f86] text-[13px] hidden sm:inline">Centro de operación</span>
            </div>
            <div className="text-right text-[#867e74] text-[11.5px] leading-snug capitalize">
              Caja 1 · Canning<br />{hoy}
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-px mt-4 bg-white/[0.08] rounded-xl overflow-hidden">
            {kpis.map((k) => (
              <div key={k.label} className="bg-[#221a15] px-3.5 py-3">
                <p className="text-[#867e74] text-[11px]">{k.label}</p>
                <p className={`text-[17px] font-semibold mt-0.5 tabular-nums ${k.alerta ? 'text-[#EBB25A]' : 'text-[#F0EBE2]'}`}>{k.valor}</p>
              </div>
            ))}
          </div>
        </div>

        {apiCaida && (
          <p className="mt-4 rounded-xl bg-[#3a1512] border border-[#B82D25]/30 px-4 py-3 text-sm text-[#E8837B]">
            No pude consultar la API: revisá tu sesión (quizás expiró) o la conexión. Los números pueden no ser reales.
          </p>
        )}

        {GRUPOS.map((g) => (
          <div key={g.titulo}>
            <p className="text-[12px] font-medium mt-5 mb-2 px-0.5" style={{ color: g.color }}>{g.titulo}</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
              {g.titulo === 'Operación' && (
                <Link href="/caja" className="col-span-2 rounded-xl bg-[#B82D25] p-4 flex flex-col justify-between min-h-[92px] transition hover:-translate-y-0.5">
                  <div className="flex items-center justify-between">
                    <span className="w-9 h-9 rounded-[9px] bg-white/20 flex items-center justify-center text-white"><Ico d={ICONOS.caja} /></span>
                    <span className="text-white/85 text-[11.5px]">cobrar →</span>
                  </div>
                  <div>
                    <p className="text-[16px] font-medium text-white">Caja</p>
                    <p className="text-[12px] text-white/80 mt-0.5">cobrar · escanear · facturar</p>
                  </div>
                </Link>
              )}
              {g.items.map((it: any) => {
                const inner = (
                  <>
                    <div className="flex items-start justify-between">
                      <span className="w-9 h-9 rounded-[9px] flex items-center justify-center shrink-0" style={{ backgroundColor: g.color + '26', color: g.color }}>
                        <Ico d={it.path ?? ICONOS[it.icon]} />
                      </span>
                      {it.badge ? (
                        <span className="text-[11px] font-medium rounded-full px-2 py-0.5 bg-[#B82D25] text-white">{it.badge}</span>
                      ) : it.count ? (
                        <span className="text-[11px] text-white/45 tabular-nums">{it.count}</span>
                      ) : it.pronto ? (
                        <span className="text-[10px] text-white/40 border border-white/15 rounded-full px-1.5 py-0.5">pronto</span>
                      ) : null}
                    </div>
                    <div>
                      <p className="text-[13.5px] font-medium text-[#EDE6DA] mt-2.5">{it.label}</p>
                      {it.sub && <p className="text-[11px] text-white/35 mt-0.5">{it.sub}</p>}
                    </div>
                  </>
                );
                const cls = 'rounded-xl p-3.5 border border-white/[0.07] flex flex-col justify-between min-h-[92px] transition';
                return it.pronto ? (
                  <div key={it.label} className={`${cls} opacity-45`} style={{ backgroundColor: g.card }}>{inner}</div>
                ) : (
                  <Link key={it.label} href={it.href} className={`${cls} hover:-translate-y-0.5 hover:border-white/25`} style={{ backgroundColor: g.card }}>{inner}</Link>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
