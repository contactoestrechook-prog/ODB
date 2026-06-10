import { Header } from '../ui/Header';

const API = process.env.API_URL ?? 'http://localhost:3001';

type Critico = {
  sku: string;
  producto: string;
  sucursal: string;
  cantidad: number;
  stock_minimo: number;
  punto_reposicion: number;
};

type Movimiento = {
  id: number;
  tipo: string;
  cantidad: number;
  motivo: string | null;
  creado_en: string;
  producto: { sku: string; nombre: string } | null;
  sucursal: { nombre: string } | null;
};

const TIPO_LABEL: Record<string, string> = {
  venta: 'Venta',
  devolucion: 'Devolución',
  compra: 'Compra',
  ajuste: 'Ajuste',
  merma: 'Merma',
  transferencia_salida: 'Transf. salida',
  transferencia_entrada: 'Transf. entrada',
  reserva: 'Reserva',
  liberacion_reserva: 'Reserva liberada',
};

export const dynamic = 'force-dynamic';

export default async function Stock() {
  let criticos: Critico[] = [];
  let movimientos: Movimiento[] = [];
  let error: string | null = null;
  try {
    const [rc, rm] = await Promise.all([
      fetch(`${API}/stock/bajo-minimo`, { cache: 'no-store' }),
      fetch(`${API}/stock/movimientos?limite=20`, { cache: 'no-store' }),
    ]);
    if (!rc.ok || !rm.ok) throw new Error('La API respondió con error');
    criticos = await rc.json();
    movimientos = await rm.json();
  } catch (e) {
    error = e instanceof Error ? e.message : 'Error desconocido';
  }

  return (
    <main className="min-h-screen bg-[#F0EBE2]">
      <Header activo="/stock" />
      <div className="max-w-5xl mx-auto p-6 space-y-6">
        {error && (
          <p className="rounded-lg bg-white p-4 text-sm text-[#932A1F]">
            No pude consultar la API ({error}). ¿Está corriendo en {API}?
          </p>
        )}

        <section className="rounded-xl bg-white overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-black/10">
            <h2 className="font-medium text-black">Bajo punto de reposición</h2>
            <span className="rounded-full bg-[#B82D25] px-3 py-0.5 text-xs font-medium text-white">
              {criticos.length}
            </span>
          </div>
          {criticos.length === 0 ? (
            <p className="px-4 py-6 text-sm text-black/50">
              Ningún producto por debajo de su punto de reposición.
            </p>
          ) : (
            <table className="w-full text-sm text-black">
              <thead>
                <tr className="text-left text-xs text-black/50 border-b border-black/5">
                  <th className="px-4 py-2 font-medium">Producto</th>
                  <th className="px-4 py-2 font-medium">Sucursal</th>
                  <th className="px-4 py-2 font-medium text-right">Stock</th>
                  <th className="px-4 py-2 font-medium text-right">Mínimo</th>
                  <th className="px-4 py-2 font-medium text-right">Reposición</th>
                </tr>
              </thead>
              <tbody>
                {criticos.map((c) => (
                  <tr key={`${c.sku}-${c.sucursal}`} className="border-b border-black/5 last:border-0">
                    <td className="px-4 py-3">
                      <p className="font-medium">{c.producto}</p>
                      <p className="text-xs text-black/50">{c.sku}</p>
                    </td>
                    <td className="px-4 py-3 text-black/70">{c.sucursal}</td>
                    <td className="px-4 py-3 text-right">
                      <span className="rounded-full bg-[#B82D25] px-2.5 py-0.5 text-xs font-medium text-white">
                        {Math.round(Number(c.cantidad))}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-black/70">{Math.round(Number(c.stock_minimo))}</td>
                    <td className="px-4 py-3 text-right text-black/70">{Math.round(Number(c.punto_reposicion))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="rounded-xl bg-white overflow-hidden">
          <h2 className="px-4 py-3 border-b border-black/10 font-medium text-black">
            Últimos movimientos
          </h2>
          <table className="w-full text-sm text-black">
            <tbody>
              {movimientos.map((m) => {
                const salida = Number(m.cantidad) < 0;
                return (
                  <tr key={m.id} className="border-b border-black/5 last:border-0">
                    <td className="px-4 py-3 w-32">
                      <span
                        className={
                          'rounded-full px-2.5 py-0.5 text-xs font-medium ' +
                          (m.tipo === 'merma'
                            ? 'bg-[#B82D25] text-white'
                            : salida
                              ? 'bg-black text-white'
                              : 'bg-[#F0EBE2] text-black')
                        }
                      >
                        {TIPO_LABEL[m.tipo] ?? m.tipo}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium">{m.producto?.nombre ?? '—'}</p>
                      {m.motivo && <p className="text-xs text-black/50">{m.motivo}</p>}
                    </td>
                    <td className="px-4 py-3 text-black/70">{m.sucursal?.nombre ?? '—'}</td>
                    <td
                      className={
                        'px-4 py-3 text-right font-medium ' +
                        (salida ? 'text-[#932A1F]' : 'text-black')
                      }
                    >
                      {salida ? '' : '+'}
                      {Math.round(Number(m.cantidad))}
                    </td>
                    <td className="px-4 py-3 text-right text-xs text-black/50">
                      {new Date(m.creado_en).toLocaleString('es-AR', {
                        day: '2-digit',
                        month: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      </div>
    </main>
  );
}
