'use client';

import { useState } from 'react';
import { numero } from '../lib/formato';
import { Aviso, Boton, Kpi, Tarjeta } from './kit';

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

  const code = 'rounded-sm bg-crema px-1 py-0.5 font-mono text-xs text-tinta [overflow-wrap:anywhere]';

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* estado de conexión */}
      <Tarjeta className="flex items-start gap-3">
        <span className={`mt-1.5 size-3 shrink-0 rounded-full ${conf ? 'bg-ok' : 'bg-marca'}`} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-base font-semibold text-tinta">{conf ? `Conectado a Tienda Nube` : 'No conectado'}</p>
          <p className="mt-0.5 break-words text-sm text-tinta/60">
            {conf ? `Tienda #${estado.storeId} · última sincronización ${haceTxt(estado?.ultimaSync?.corrida_en)}` : 'Falta cargar las credenciales de la API de Tienda Nube'}
          </p>
        </div>
      </Tarjeta>

      {conf && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Kpi etiqueta={<span className="whitespace-normal">Productos publicados</span>} valor={numero(estado.productosEnTiendanube ?? 0)} sub="en Tienda Nube" />
            <Kpi etiqueta={<span className="whitespace-normal">Pedidos importados</span>} valor={numero(estado.pedidosImportados ?? 0)} sub="desde Tienda Nube" />
          </div>

          <div className="flex flex-wrap gap-2">
            <Boton onClick={() => accion('sync')} disabled={!!corriendo} cargando={corriendo === 'sync'}>
              {corriendo === 'sync' ? 'Sincronizando…' : 'Sincronizar catálogo'}
            </Boton>
            <Boton variante="secundario" onClick={() => accion('importar')} disabled={!!corriendo} cargando={corriendo === 'importar'}>
              {corriendo === 'importar' ? 'Importando…' : 'Importar pedidos'}
            </Boton>
          </div>
          {resultado && <Aviso tono="neutro">{resultado}</Aviso>}
        </>
      )}

      {/* instrucciones de activación */}
      <Tarjeta>
        <h2 className="mb-2 text-base font-semibold text-tinta">{conf ? 'Configuración' : 'Cómo activar la integración'}</h2>
        <ol className="list-decimal space-y-1.5 pl-5 text-sm text-tinta/70">
          <li>Crear una app en el Portal de Partners de Tienda Nube e instalarla en la tienda de ODB.</li>
          <li>Cargar en Railway (servicio <code className={code}>odb-api</code>) las variables <code className={code}>TIENDANUBE_STORE_ID</code> y <code className={code}>TIENDANUBE_ACCESS_TOKEN</code>.</li>
          <li>Configurar el webhook de pedidos (<code className={code}>order/created</code>) apuntando a:</li>
        </ol>
        <p className="mt-2 rounded-xl bg-crema px-3 py-2 font-mono text-xs text-tinta/80 break-all sm:ml-5">{API_WEBHOOK}</p>
        <p className="mt-3 text-sm text-tinta/60">Una vez cargadas las credenciales, esta pantalla pasa a verde y los botones quedan activos. El catálogo sube los productos con stock; los pedidos entran al centro de Pedidos como canal “Tienda Nube”.</p>
      </Tarjeta>
    </div>
  );
}
