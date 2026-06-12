import { Header } from '../ui/Header';
import { apiFetch } from '../../lib/api';

type Sesion = {
  id: string;
  monto_inicial: number;
  monto_cierre: number | null;
  diferencia: number | null;
  abierta_en: string;
  cerrada_en: string | null;
  caja: { nombre: string; sucursal: { nombre: string } } | null;
  usuario: { nombre: string } | null;
};

type Arca = { total: number; configurado: boolean };

const pesos = (n: number | null) =>
  n == null ? '—' : '$' + Math.round(Number(n)).toLocaleString('es-AR');

const fechaHora = (iso: string) =>
  new Date(iso).toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

export const dynamic = 'force-dynamic';

export default async function Cierres() {
  let sesiones: Sesion[] = [];
  let arca: Arca | null = null;
  let error: string | null = null;
  try {
    const [rs, ra] = await Promise.all([
      apiFetch('/caja/sesiones'),
      apiFetch('/arca/pendientes'),
    ]);
    if (!rs.ok || !ra.ok) throw new Error('La API respondió con error');
    sesiones = await rs.json();
    arca = await ra.json();
  } catch (e) {
    error = e instanceof Error ? e.message : 'Error desconocido';
  }

  const abiertas = sesiones.filter((s) => !s.cerrada_en).length;
  const conDiferencia = sesiones.filter((s) => s.diferencia != null && Number(s.diferencia) !== 0);

  return (
    <main className="min-h-screen bg-[#F0EBE2] lg:pl-64">
      <Header activo="/cierres" />
      <div className="max-w-5xl mx-auto p-6 space-y-6">
        {error && (
          <p className="rounded-lg bg-white p-4 text-sm text-[#932A1F]">
            No pude consultar la API ({error}).
          </p>
        )}

        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <div className="rounded-xl bg-white p-4">
            <p className="text-xs text-black/50">Cajas abiertas ahora</p>
            <p className="text-xl font-medium text-black">{abiertas}</p>
          </div>
          <div
            className={
              'rounded-xl p-4 ' +
              (conDiferencia.length > 0 ? 'bg-[#B82D25]' : 'bg-white')
            }
          >
            <p className={'text-xs ' + (conDiferencia.length > 0 ? 'text-[#F0EBE2]' : 'text-black/50')}>
              Cierres con diferencia
            </p>
            <p className={'text-xl font-medium ' + (conDiferencia.length > 0 ? 'text-white' : 'text-black')}>
              {conDiferencia.length}
            </p>
          </div>
          <div className="rounded-xl bg-white p-4">
            <p className="text-xs text-black/50">Comprobantes ARCA en cola</p>
            <p className="text-xl font-medium text-black">
              {arca?.total ?? '—'}
              {arca && !arca.configurado && (
                <span className="ml-2 align-middle rounded-full bg-[#F0EBE2] px-2 py-0.5 text-[11px] text-[#932A1F]">
                  sin certificado
                </span>
              )}
            </p>
          </div>
        </div>

        <section className="rounded-xl bg-white overflow-hidden">
          <h2 className="px-4 py-3 border-b border-black/10 font-medium text-black">
            Sesiones de caja
          </h2>
          <table className="w-full text-sm text-black">
            <thead>
              <tr className="text-left text-xs text-black/50 border-b border-black/5">
                <th className="px-4 py-2 font-medium">Caja</th>
                <th className="px-4 py-2 font-medium">Cajero</th>
                <th className="px-4 py-2 font-medium">Apertura → cierre</th>
                <th className="px-4 py-2 font-medium text-right">Fondo inicial</th>
                <th className="px-4 py-2 font-medium text-right">Contado</th>
                <th className="px-4 py-2 font-medium text-right">Arqueo</th>
              </tr>
            </thead>
            <tbody>
              {sesiones.map((s) => (
                <tr key={s.id} className="border-b border-black/5 last:border-0">
                  <td className="px-4 py-3">
                    <p className="font-medium">{s.caja?.nombre}</p>
                    <p className="text-xs text-black/50">{s.caja?.sucursal?.nombre}</p>
                  </td>
                  <td className="px-4 py-3 text-black/70">{s.usuario?.nombre ?? '—'}</td>
                  <td className="px-4 py-3 text-black/70">
                    {fechaHora(s.abierta_en)} → {s.cerrada_en ? fechaHora(s.cerrada_en) : 'abierta'}
                  </td>
                  <td className="px-4 py-3 text-right text-black/70">{pesos(s.monto_inicial)}</td>
                  <td className="px-4 py-3 text-right text-black/70">{pesos(s.monto_cierre)}</td>
                  <td className="px-4 py-3 text-right">
                    {s.cerrada_en == null ? (
                      <span className="rounded-full bg-black px-2.5 py-0.5 text-xs font-medium text-white">
                        abierta
                      </span>
                    ) : Number(s.diferencia) === 0 ? (
                      <span className="rounded-full bg-[#F0EBE2] px-2.5 py-0.5 text-xs font-medium text-black">
                        exacto
                      </span>
                    ) : (
                      <span className="rounded-full bg-[#B82D25] px-2.5 py-0.5 text-xs font-medium text-white">
                        {Number(s.diferencia) > 0 ? 'sobran ' : 'faltan '}
                        {pesos(Math.abs(Number(s.diferencia)))}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {sesiones.length === 0 && (
                <tr>
                  <td className="px-4 py-6 text-sm text-black/50">Sin sesiones de caja.</td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      </div>
    </main>
  );
}
