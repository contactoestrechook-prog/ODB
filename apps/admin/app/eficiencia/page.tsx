import { Header } from '../ui/Header';
import { apiFetch } from '../../lib/api';

const pesos = (n: any) => '$' + Math.round(Number(n) || 0).toLocaleString('es-AR');

export const dynamic = 'force-dynamic';

function Barra({ valor, max, invertido }: { valor: number; max: number; invertido?: boolean }) {
  // invertido=true: menos es mejor (verde para los más bajos)
  const pct = max > 0 ? Math.max((valor / max) * 100, 3) : 0;
  return (
    <div className="h-1.5 rounded-full bg-[#F0EBE2] mt-1">
      <div className={`h-1.5 rounded-full ${invertido ? 'bg-emerald-600' : 'bg-[#B82D25]'}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export default async function Eficiencia() {
  const [rc, rp] = await Promise.all([
    apiFetch('/eficiencia/cajeros'),
    apiFetch('/eficiencia/preparadores'),
  ]);
  const cajeros: any[] = rc.ok ? await rc.json() : [];
  const preparadores: any[] = rp.ok ? await rp.json() : [];

  const maxTph = Math.max(...cajeros.map((c) => Number(c.tickets_hora) || 0), 1);
  const maxPrep = Math.max(...preparadores.map((p) => Number(p.prep_min) || 0), 1);

  return (
    <main className="min-h-screen bg-[#F0EBE2] lg:pl-64">
      <Header activo="/eficiencia" />
      <div className="max-w-5xl mx-auto p-6 space-y-5">
        <div className="rounded-xl bg-[#121212] text-white p-4">
          <p className="font-medium">⏱️ Ley ODB: todo medido, cada empleado cuantificado</p>
          <p className="text-xs text-white/60 mt-1">El sistema cronometra cada operación y la atribuye a quien la hizo: el cajero por cada cliente, el repositor por cada pedido. Las métricas se llenan a medida que se opera.</p>
        </div>

        {/* CAJEROS */}
        <section className="rounded-xl bg-white overflow-hidden">
          <h2 className="px-4 py-3 border-b border-black/10 font-medium text-black text-sm">Cajeros · velocidad de atención</h2>
          {cajeros.length === 0 ? <p className="px-4 py-8 text-center text-black/40 text-sm">Sin sesiones de caja medidas todavía.</p> : (
            <table className="w-full text-sm text-black">
              <thead><tr className="text-left text-xs text-black/50 border-b border-black/5">
                <th className="px-4 py-2 font-medium">Empleado</th><th className="px-4 py-2 font-medium text-right">Tickets</th><th className="px-4 py-2 font-medium text-right">Min/cliente</th><th className="px-4 py-2 font-medium">Clientes/hora</th><th className="px-4 py-2 font-medium text-right">Facturado</th>
              </tr></thead>
              <tbody>
                {cajeros.map((c, i) => (
                  <tr key={c.usuario} className="border-b border-black/5 last:border-0">
                    <td className="px-4 py-3"><p className="font-medium">{i === 0 && '🏆 '}{c.usuario}</p><p className="text-xs text-black/45">{c.rol} · {c.sesiones} sesión(es)</p></td>
                    <td className="px-4 py-3 text-right">{c.tickets}</td>
                    <td className="px-4 py-3 text-right font-medium">{c.min_por_ticket ?? '—'}′</td>
                    <td className="px-4 py-3 w-40"><span className="text-xs">{c.tickets_hora ?? '—'}/h</span><Barra valor={Number(c.tickets_hora) || 0} max={maxTph} /></td>
                    <td className="px-4 py-3 text-right text-black/70">{pesos(c.monto)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {/* PREPARADORES */}
        <section className="rounded-xl bg-white overflow-hidden">
          <h2 className="px-4 py-3 border-b border-black/10 font-medium text-black text-sm">Preparación de pedidos · tiempo de armado</h2>
          {preparadores.length === 0 ? <p className="px-4 py-8 text-center text-black/40 text-sm">Sin pedidos preparados medidos todavía.</p> : (
            <table className="w-full text-sm text-black">
              <thead><tr className="text-left text-xs text-black/50 border-b border-black/5">
                <th className="px-4 py-2 font-medium">Empleado</th><th className="px-4 py-2 font-medium text-right">Pedidos</th><th className="px-4 py-2 font-medium">Tiempo de armado</th><th className="px-4 py-2 font-medium text-right">Entrega</th>
              </tr></thead>
              <tbody>
                {[...preparadores].sort((a, b) => Number(a.prep_min) - Number(b.prep_min)).map((p, i) => (
                  <tr key={p.usuario} className="border-b border-black/5 last:border-0">
                    <td className="px-4 py-3"><p className="font-medium">{i === 0 && '🏆 '}{p.usuario}</p><p className="text-xs text-black/45">{p.rol}</p></td>
                    <td className="px-4 py-3 text-right">{p.pedidos}</td>
                    <td className="px-4 py-3 w-48"><span className="text-xs font-medium">{p.prep_min ?? '—'} min/pedido</span><Barra valor={Number(p.prep_min) || 0} max={maxPrep} invertido /></td>
                    <td className="px-4 py-3 text-right text-black/70">{p.entrega_min ?? '—'} min</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </main>
  );
}
