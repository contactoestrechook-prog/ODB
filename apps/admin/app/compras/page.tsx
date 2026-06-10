import { Header } from '../ui/Header';

const API = process.env.API_URL ?? 'http://localhost:3001';

type Sugerencia = {
  sku: string;
  producto: string;
  sucursal: string;
  cantidad: number;
  punto_reposicion: number;
  cantidad_sugerida: number;
  proveedor: string | null;
  ultimo_costo: number | null;
  lead_time_dias: number | null;
};

type Orden = {
  numero: number;
  estado: string;
  total: number;
  creado_en: string;
  proveedor: { razon_social: string } | null;
  sucursal: { nombre: string } | null;
  items: {
    cantidad: number;
    cantidad_recibida: number;
    producto: { sku: string; nombre: string } | null;
  }[];
  firmadaPor: string | null;
};

const pesos = (n: number | null) =>
  n == null ? '—' : '$' + Math.round(Number(n)).toLocaleString('es-AR');

const ESTADO_ESTILO: Record<string, string> = {
  borrador: 'bg-[#F0EBE2] text-black/60',
  pendiente_aprobacion: 'bg-[#B82D25] text-white',
  aprobada: 'bg-black text-white',
  enviada: 'bg-black text-white',
  recibida_parcial: 'bg-[#F0EBE2] text-[#932A1F]',
  recibida: 'bg-[#F0EBE2] text-black',
  cancelada: 'bg-[#F0EBE2] text-black/40',
};

const ESTADO_LABEL: Record<string, string> = {
  pendiente_aprobacion: 'pendiente de firma',
  recibida_parcial: 'recibida parcial',
};

export const dynamic = 'force-dynamic';

export default async function Compras() {
  let sugerencias: Sugerencia[] = [];
  let ordenes: Orden[] = [];
  let error: string | null = null;
  try {
    const [rs, ro] = await Promise.all([
      fetch(`${API}/compras/sugerencias`, { cache: 'no-store' }),
      fetch(`${API}/compras/ordenes`, { cache: 'no-store' }),
    ]);
    if (!rs.ok || !ro.ok) throw new Error('La API respondió con error');
    sugerencias = await rs.json();
    ordenes = await ro.json();
  } catch (e) {
    error = e instanceof Error ? e.message : 'Error desconocido';
  }

  return (
    <main className="min-h-screen bg-[#F0EBE2]">
      <Header activo="/compras" />
      <div className="max-w-5xl mx-auto p-6 space-y-6">
        {error && (
          <p className="rounded-lg bg-white p-4 text-sm text-[#932A1F]">
            No pude consultar la API ({error}).
          </p>
        )}

        <section className="rounded-xl bg-white overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-black/10">
            <h2 className="font-medium text-black">Sugerencias de compra</h2>
            <span className="rounded-full bg-[#B82D25] px-3 py-0.5 text-xs font-medium text-white">
              {sugerencias.length}
            </span>
          </div>
          {sugerencias.length === 0 ? (
            <p className="px-4 py-6 text-sm text-black/50">
              Nada para reponer por ahora.
            </p>
          ) : (
            <table className="w-full text-sm text-black">
              <thead>
                <tr className="text-left text-xs text-black/50 border-b border-black/5">
                  <th className="px-4 py-2 font-medium">Producto</th>
                  <th className="px-4 py-2 font-medium">Sucursal</th>
                  <th className="px-4 py-2 font-medium text-right">Stock</th>
                  <th className="px-4 py-2 font-medium text-right">Sugerido</th>
                  <th className="px-4 py-2 font-medium">Proveedor</th>
                  <th className="px-4 py-2 font-medium text-right">Costo u.</th>
                </tr>
              </thead>
              <tbody>
                {sugerencias.map((s) => (
                  <tr key={`${s.sku}-${s.sucursal}`} className="border-b border-black/5 last:border-0">
                    <td className="px-4 py-3">
                      <p className="font-medium">{s.producto}</p>
                      <p className="text-xs text-black/50">{s.sku}</p>
                    </td>
                    <td className="px-4 py-3 text-black/70">{s.sucursal}</td>
                    <td className="px-4 py-3 text-right">
                      <span className="rounded-full bg-[#B82D25] px-2.5 py-0.5 text-xs font-medium text-white">
                        {Math.round(Number(s.cantidad))}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-medium">
                      {Math.round(Number(s.cantidad_sugerida))} u.
                    </td>
                    <td className="px-4 py-3 text-black/70">
                      {s.proveedor ?? 'sin proveedor asignado'}
                      {s.lead_time_dias != null && (
                        <p className="text-xs text-black/50">entrega en {s.lead_time_dias} días</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-black/70">{pesos(s.ultimo_costo)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="rounded-xl bg-white overflow-hidden">
          <h2 className="px-4 py-3 border-b border-black/10 font-medium text-black">
            Órdenes de compra
          </h2>
          <table className="w-full text-sm text-black">
            <tbody>
              {ordenes.map((o) => (
                <tr key={o.numero} className="border-b border-black/5 last:border-0 align-top">
                  <td className="px-4 py-3 w-20 font-medium">#{o.numero}</td>
                  <td className="px-4 py-3">
                    <p className="font-medium">{o.proveedor?.razon_social ?? '—'}</p>
                    <p className="text-xs text-black/50">
                      {o.items
                        .map(
                          (i) =>
                            `${i.producto?.nombre ?? '—'} × ${Math.round(Number(i.cantidad))}` +
                            (Number(i.cantidad_recibida) > 0
                              ? ` (${Math.round(Number(i.cantidad_recibida))} recibidas)`
                              : ''),
                        )
                        .join(' · ')}
                    </p>
                    {o.firmadaPor && (
                      <p className="text-xs text-black/50 mt-1">Firmada por {o.firmadaPor}</p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-black/70">{o.sucursal?.nombre}</td>
                  <td className="px-4 py-3 text-right font-medium">{pesos(o.total)}</td>
                  <td className="px-4 py-3 text-right">
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${ESTADO_ESTILO[o.estado] ?? 'bg-[#F0EBE2] text-black'}`}
                    >
                      {ESTADO_LABEL[o.estado] ?? o.estado.replaceAll('_', ' ')}
                    </span>
                  </td>
                </tr>
              ))}
              {ordenes.length === 0 && (
                <tr>
                  <td className="px-4 py-6 text-sm text-black/50">Sin órdenes de compra.</td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      </div>
    </main>
  );
}
