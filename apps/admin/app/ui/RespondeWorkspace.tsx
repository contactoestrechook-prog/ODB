'use client';

import { useCallback, useEffect, useState } from 'react';
import { Boton, Etiqueta, ROTULO, Tarjeta, useConfirmar } from './kit';

// RESPONDE — UNA sola pantalla (1/10/2026). Leandro: "hay dos RESPONDE que no
// van, uno solo tiene las conversaciones reales; confunden". Es la app RESPONDE
// con la línea REAL de WhatsApp: contestar, pausar o devolver al bot, fotos,
// notas, programados y difusión. Antes esta página sumaba otra bandeja que
// mezclaba las charlas del simulador con las de clientes y un segundo
// simulador; probar el bot es "Probar el bot" (/bot) y las campañas por listas,
// "Difusiones" (/bandeja). Lo único que la app no tiene es apagar la línea
// entera, y va arriba: es una de las formas de frenar el bot.
export function RespondeWorkspace({ tokenResponde }: { tokenResponde?: string | null }) {
  const [linea, setLinea] = useState<any>(null);
  const [ocupado, setOcupado] = useState(false);
  const { confirmar, dialogo } = useConfirmar();

  const cargar = useCallback(async () => {
    try {
      const r = await fetch('/api/responde?recurso=linea&linea=pedidos', { cache: 'no-store' });
      if (r.ok) setLinea(await r.json());
    } catch { /* sin red: mantiene lo que hay */ }
  }, []);
  useEffect(() => { cargar(); const t = setInterval(cargar, 15000); return () => clearInterval(t); }, [cargar]);

  async function botLinea(activo: boolean) {
    if (ocupado) return;
    if (!activo && !(await confirmar({
      titulo: '¿Pausar RESPONDE en TODAS las conversaciones?',
      texto: 'Nadie recibe respuesta automática hasta que lo vuelvas a encender.',
      variante: 'peligro',
      textoConfirmar: 'Pausar en todas',
    }))) return;
    setOcupado(true);
    try {
      await fetch('/api/responde', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'botLinea', linea: 'pedidos', activo }) });
      await cargar();
    } finally {
      setOcupado(false);
    }
  }

  const pausada = linea?.bot_activo === false;
  return (
    <div className="space-y-4">
      <Tarjeta>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className={ROTULO}>Línea de WhatsApp</p>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
              <p className="importe text-xl font-bold text-tinta">{linea?.numero_legible ?? '11 2281-2200'}</p>
              {linea && (
                <Etiqueta tono={pausada ? 'atencion' : 'ok'} punto>
                  {pausada ? 'Pausado en todas' : 'Atendiendo'}
                </Etiqueta>
              )}
            </div>
          </div>
          <Boton
            variante={pausada ? 'primario' : 'peligro'}
            tamano="chico"
            onClick={() => botLinea(pausada)}
            disabled={ocupado || !linea}
          >
            {pausada ? 'Encender en todas' : 'Pausar en todas'}
          </Boton>
        </div>
      </Tarjeta>
      <Tarjeta relleno={false} className="overflow-hidden">
        {/* embed + token del tenant: entra derecho, sin pedir clave (el mismo
            camino que usa /whatsapp, la versión a pantalla completa) */}
        <iframe
          src={tokenResponde ? `/responde-app.html?embed=1&conector=odb&token=${encodeURIComponent(tokenResponde)}` : '/responde-app.html?conector=odb'}
          title="RESPONDE · MetoGroup"
          className="block h-[calc(100dvh-13rem)] min-h-[32rem] w-full border-0"
        />
      </Tarjeta>
      {dialogo}
    </div>
  );
}
