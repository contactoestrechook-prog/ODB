import Link from 'next/link';
import { Header } from '../ui/Header';
import { apiFetch } from '../../lib/api';
import { SyncEstado } from '../ui/SyncEstado';

const pesos = (n: any) => '$' + Math.round(Number(n) || 0).toLocaleString('es-AR');

export const dynamic = 'force-dynamic';

async function json(path: string, fallback: any, errs: string[]) {
  try {
    const r = await apiFetch(path);
    if (!r.ok) { errs.push(path); return fallback; }
    return await r.json();
  } catch { errs.push(path); return fallback; }
}

export default async function Inicio() {
  const errs: string[] = [];
  const [ventas, stock, compras, fact, caja, venc, informes] = await Promise.all([
    json('/ventas/resumen', {}, errs),
    json('/stock/resumen', {}, errs),
    json('/compras/resumen', {}, errs),
    json('/facturacion/resumen', {}, errs),
    json('/caja/resumen', {}, errs),
    json('/vencimientos', { lotes: [] }, errs),
    json('/informes', [], errs),
  ]);
  // si fallaron casi todas, probablemente sea sesión vencida o API caída
  const apiCaida = errs.length >= 4;

  const vencProximos = (venc.lotes ?? []).filter((l: any) => ['vencido', 'critico', 'pronto'].includes(l.estado)).length;
  const relato = Array.isArray(informes) && informes[0]?.relato ? informes[0].relato : null;

  // alertas dinámicas: solo se muestran si hay algo que atender
  const alertas = [
    { n: compras.pendientesAprobacion, label: 'órdenes de compra por aprobar', href: '/compras' },
    { n: stock.bajo_reposicion, label: 'productos bajo reposición', href: '/stock' },
    { n: stock.negativos, label: 'productos con stock negativo', href: '/stock' },
    { n: vencProximos, label: 'lotes próximos a vencer', href: '/stock' },
    { n: compras.porRecibir, label: 'órdenes por recibir', href: '/compras' },
    { n: caja.conDiferenciaMes, label: 'cierres con diferencia este mes', href: '/cierres' },
    { n: fact.cuentasActivas, label: 'cuentas corrientes con saldo', href: '/facturacion' },
  ].filter((a) => Number(a.n) > 0);

  const kpis = [
    { label: 'Facturado hoy', valor: pesos(ventas.facturado), sub: `${ventas.tickets ?? 0} tickets`, href: '/ventas' },
    { label: 'Por cobrar', valor: pesos(fact.porCobrar), sub: `${fact.cuentasActivas ?? 0} cuentas`, href: '/facturacion', alerta: Number(fact.porCobrar) > 0 },
    { label: 'Valor de inventario', valor: pesos(stock.valor_inventario), sub: `${(stock.skus_activos ?? 0).toLocaleString('es-AR')} SKUs`, href: '/stock' },
    { label: 'Cajas abiertas', valor: `${caja.cajasAbiertas ?? 0}/${caja.cajasTotal ?? 0}`, sub: 'sesiones activas', href: '/cierres' },
  ];

  const accesos = [
    ['Vender (Caja)', '/caja'], ['Facturar', '/facturacion'], ['Cargar productos', '/productos'],
    ['Nueva promo', '/promociones'], ['Analista ODB', '/analista'], ['Eficiencia', '/eficiencia'],
  ];

  const hoy = new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <main className="min-h-screen bg-[#F0EBE2] lg:pl-64">
      <Header activo="/inicio" />
      <div className="max-w-5xl mx-auto p-6 space-y-5">
        <div>
          <h1 className="text-xl font-semibold text-black">Buen día 👋</h1>
          <p className="text-sm text-black/45 capitalize">{hoy}</p>
        </div>

        {errs.length > 0 && (
          <div className="rounded-xl bg-[#FBE9E7] border border-[#B82D25]/20 px-4 py-3 text-sm text-[#932A1F]">
            {apiCaida
              ? 'No pude consultar la API: revisá tu sesión (quizás expiró, volvé a entrar) o la conexión. Los números de abajo pueden no ser reales.'
              : 'Algunos datos no cargaron (permisos o conexión). Los números pueden estar incompletos.'}
          </div>
        )}

        {/* KPIs principales */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {kpis.map((k) => (
            <Link key={k.label} href={k.href} className="rounded-xl bg-white p-4 hover:shadow-sm border border-black/[0.04]">
              <p className="text-xs text-black/50">{k.label}</p>
              <p className={`text-2xl font-semibold mt-1 ${k.alerta ? 'text-[#B82D25]' : 'text-black'}`}>{k.valor}</p>
              <p className="text-[11px] text-black/40 mt-0.5">{k.sub}</p>
            </Link>
          ))}
        </div>

        {/* estado del bridge legacy → Supabase (módulo 2) */}
        <SyncEstado />

        {/* requiere atención */}
        <section className="rounded-xl bg-white overflow-hidden">
          <h2 className="px-4 py-3 border-b border-black/10 font-medium text-black text-sm">Requiere tu atención</h2>
          {alertas.length === 0 ? (
            <p className="px-4 py-6 text-sm text-emerald-700">✓ Todo en orden. No hay nada urgente.</p>
          ) : (
            <div className="divide-y divide-black/5">
              {alertas.map((a, i) => (
                <Link key={i} href={a.href} className="flex items-center justify-between px-4 py-3 hover:bg-[#F0EBE2]/40">
                  <span className="text-sm text-black">
                    <span className="inline-block min-w-7 text-center rounded-full bg-[#B82D25] text-white text-xs font-semibold px-2 py-0.5 mr-2">{a.n}</span>
                    {a.label}
                  </span>
                  <span className="text-xs text-black/40">→</span>
                </Link>
              ))}
            </div>
          )}
        </section>

        <div className="grid lg:grid-cols-2 gap-4">
          {/* parte del Analista */}
          {relato && (
            <section className="rounded-xl bg-white p-5">
              <div className="flex items-center justify-between mb-2">
                <h2 className="font-medium text-black text-sm">Parte del Analista ODB</h2>
                <Link href="/informes" className="text-xs text-[#B82D25] hover:underline">ver informe →</Link>
              </div>
              <p className="text-xs text-black/70 leading-relaxed whitespace-pre-line line-clamp-[10]">{relato}</p>
            </section>
          )}

          {/* accesos rápidos */}
          <section className="rounded-xl bg-white p-5">
            <h2 className="font-medium text-black text-sm mb-3">Accesos rápidos</h2>
            <div className="grid grid-cols-2 gap-2">
              {accesos.map(([label, href]) => (
                <Link key={href} href={href} className="rounded-lg border border-black/10 px-3 py-2.5 text-sm text-black hover:border-[#B82D25] hover:text-[#932A1F] text-center">
                  {label}
                </Link>
              ))}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
