'use client';

import { Tarjeta } from './kit';
import { hayVarias, TarjetasDeLineas, useLineasWhatsapp } from './LineasWhatsapp';

// RESPONDE — UNA sola pantalla (1/10/2026). Leandro: "hay dos RESPONDE que no
// van, uno solo tiene las conversaciones reales; confunden". Es la app RESPONDE
// con la línea REAL de WhatsApp: contestar, pausar o devolver al bot, fotos,
// notas, programados y difusión. Antes esta página sumaba otra bandeja que
// mezclaba las charlas del simulador con las de clientes y un segundo
// simulador; probar el bot es "Probar el bot" (/bot) y las campañas por listas,
// "Difusiones" (/bandeja). Lo único que la app no tiene es apagar la línea
// entera, y va arriba: es una de las formas de frenar el bot.
//
// MULTILÍNEA (6/10/2026): una tarjeta por número, cada una con su interruptor
// (pausa SOLO ese número). Las charlas de todas las líneas están en la misma
// app de RESPONDE (un solo tenant de ODB): lo que se contesta ahí sale por la
// línea de esa charla.
export function RespondeWorkspace({ tokenResponde }: { tokenResponde?: string | null }) {
  const { lineas, cargar } = useLineasWhatsapp(15000);
  return (
    <div className="space-y-4">
      <TarjetasDeLineas lineas={lineas} cargar={cargar} rotulo="Línea de WhatsApp" />
      {hayVarias(lineas) && (
        <p className="text-sm text-tinta/70">
          Las charlas de todos los números están acá abajo. Lo que contestes sale por el número al que escribió ese cliente; si escribió a los dos, por el de su charla más reciente.
        </p>
      )}
      <Tarjeta relleno={false} className="overflow-hidden">
        {/* embed + token del tenant: entra derecho, sin pedir clave (el mismo
            camino que usa /whatsapp, la versión a pantalla completa) */}
        <iframe
          src={tokenResponde ? `/responde-app.html?embed=1&token=${encodeURIComponent(tokenResponde)}` : '/responde-app.html'}
          title="RESPONDE · MetoGroup"
          className="block h-[calc(100dvh-13rem)] min-h-[32rem] w-full border-0"
        />
      </Tarjeta>
    </div>
  );
}
