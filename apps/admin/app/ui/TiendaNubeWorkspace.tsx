'use client';

import { useState } from 'react';

const API_WEBHOOK = 'https://odb-api-production.up.railway.app/tiendanube/webhook';
const haceTxt = (iso?: string) => {
  if (!iso) return '—';
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return min < 1 ? 'recién' : min < 60 ? `hace ${min} min` : min < 1440 ? `hace ${Math.round(min / 60)} h` : `hace ${Math.round(min / 1440)} d`;
};

export function TiendaNubeWorkspace({ inicial }: { inicial: any }) {
  const [estado, setEstado] = useState<any>(inicial);
  const [corriendo, setCorriendo] = useState<string | null>(null);
  const [resultado, setResultado] = useState<string | null>(null);

  const conf = !!estado?.configurado;

  const accion = async (accion: 'sync' | 'importar') => {
    setCorriendo(accion);
    setResultado(null);
    try {
      const r = await fetch('/api/tiendanube', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion }) }).then((x) => x.json());
      if (accion === 'sync') setResultado(`Catálogo: ${r.creados ?? 0} creados, ${r.actualizados ?? 0} actualizados, ${r.errores ?? 0} con error · faltan crear ${r.faltanPorCrear ?? 0}`);
      else setResultado(`Pedidos: ${r.importados ?? 0} importados, ${r.duplicados ?? 0} ya estaban, ${r.errores ?? 0} con error (de ${r.revisados ?? 0})`);
      const e = await fetch('/api/tiendanube').then((x) => x.json());
      setEstado(e);
    } catch {
      setResultado('No se pudo ejecutar la acción.');
    } finally {
      setCorriendo(null);
    }
  };

  return (
    <div className="space-y-5">
      {/* estado de conexión */}
      <section className="rounded-xl bg-white p-5 border border-black/[0.04] flex items-center gap-3">
        <span className={`w-3 h-3 rounded-full shrink-0 ${conf ? 'bg-emerald-500' : 'bg-[#B82D25]'}`} />
        <div className="flex-1">
          <p className="font-medium text-black">{conf ? `Conectado a Tienda Nube` : 'No conectado'}</p>
          <p className="text-xs text-black/45 mt-0.5">
            {conf ? `Tienda #${estado.storeId} · última sincronización ${haceTxt(estado?.ultimaSync?.corrida_en)}` : 'Falta cargar las credenciales de la API de Tienda Nube'}
          </p>
        </div>
      </section>

      {conf && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-white p-4 border border-black/[0.04]">
              <p className="text-xl font-semibold text-black">{(estado.productosEnTiendanube ?? 0).toLocaleString('es-AR')}</p>
              <p className="text-[11px] text-black/45 mt-1">productos publicados en Tienda Nube</p>
            </div>
            <div className="rounded-xl bg-white p-4 border border-black/[0.04]">
              <p className="text-xl font-semibold text-black">{(estado.pedidosImportados ?? 0).toLocaleString('es-AR')}</p>
              <p className="text-[11px] text-black/45 mt-1">pedidos importados desde Tienda Nube</p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button onClick={() => accion('sync')} disabled={!!corriendo} className="rounded-lg bg-[#B82D25] text-white text-sm font-medium px-4 py-2 disabled:opacity-40 hover:bg-[#9e251e]">
              {corriendo === 'sync' ? 'Sincronizando…' : 'Sincronizar catálogo'}
            </button>
            <button onClick={() => accion('importar')} disabled={!!corriendo} className="rounded-lg bg-white border border-black/15 text-black text-sm font-medium px-4 py-2 disabled:opacity-40 hover:bg-black/5">
              {corriendo === 'importar' ? 'Importando…' : 'Importar pedidos'}
            </button>
          </div>
          {resultado && <p className="text-sm text-black/70 bg-[#F0EBE2]/60 rounded-lg px-3 py-2">{resultado}</p>}
        </>
      )}

      {/* instrucciones de activación */}
      <section className="rounded-xl bg-white p-5 border border-black/[0.04]">
        <h2 className="font-medium text-black text-sm mb-2">{conf ? 'Configuración' : 'Cómo activar la integración'}</h2>
        <ol className="text-sm text-black/65 space-y-1.5 list-decimal pl-5">
          <li>Crear una app en el Portal de Partners de Tienda Nube e instalarla en la tienda de ODB.</li>
          <li>Cargar en Railway (servicio <code className="text-xs bg-black/5 px-1 rounded">odb-api</code>) las variables <code className="text-xs bg-black/5 px-1 rounded">TIENDANUBE_STORE_ID</code> y <code className="text-xs bg-black/5 px-1 rounded">TIENDANUBE_ACCESS_TOKEN</code>.</li>
          <li>Configurar el webhook de pedidos (<code className="text-xs bg-black/5 px-1 rounded">order/created</code>) apuntando a:</li>
        </ol>
        <p className="mt-2 ml-5 text-xs font-mono bg-black/5 rounded px-2 py-1.5 break-all text-black/70">{API_WEBHOOK}</p>
        <p className="text-xs text-black/45 mt-3">Una vez cargadas las credenciales, esta pantalla pasa a verde y los botones quedan activos. El catálogo sube los productos con stock; los pedidos entran al centro de Pedidos como canal “Tienda Nube”.</p>
      </section>
    </div>
  );
}
