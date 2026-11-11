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
//
// EL SELLO (11/11/2026). Leandro, sobre el de Il Molise: «más lindo, más
// destacado, más centrado y que diga que somos proveedores oficiales de Meta» →
// «quiero que eso lo traslademos a Car Cash y a ODB». El logo de RESPONDE by
// MetoGroup y, debajo, alineada con la palabra (el isotipo ocupa 132 de 443 px
// a 96 de alto), la credencial: MetoGroup está aprobado por Meta como proveedor
// de tecnología (4/11/2026), que es el nombre del programa.
const ALTO_SELLO = 40;
function SelloResponde() {
  return (
    <div
      className="inline-flex flex-col items-start leading-none"
      title="Las charlas funcionan con RESPONDE, de MetoGroup, proveedor oficial de tecnología de Meta"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/responde-claro.png" alt="RESPONDE by MetoGroup" width={443} height={96} decoding="async" style={{ height: ALTO_SELLO, width: 'auto' }} className="block" />
      <span
        className="grid items-center whitespace-nowrap font-mono text-[9.5px] font-semibold uppercase leading-[1.35] tracking-[.14em] text-tinta/70"
        style={{ gridTemplateColumns: '13px auto', columnGap: 7, marginTop: -2, marginLeft: (ALTO_SELLO * 132) / 96 - 20 }}
      >
        <svg viewBox="0 0 14 14" aria-hidden="true" width={13} height={13}>
          <circle cx="7" cy="7" r="7" style={{ fill: 'var(--color-tinta)' }} />
          <path d="M4 7.2 6.1 9.2 10 5" style={{ fill: 'none', stroke: 'var(--color-crema)', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' }} />
        </svg>
        <span>Proveedor oficial<br />de tecnología de Meta</span>
      </span>
    </div>
  );
}

export function RespondeWorkspace({ tokenResponde }: { tokenResponde?: string | null }) {
  const { lineas, cargar } = useLineasWhatsapp(15000);
  return (
    <div className="space-y-4">
      <SelloResponde />
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
          src={tokenResponde ? `/responde-app.html?embed=1&conector=odb&token=${encodeURIComponent(tokenResponde)}` : '/responde-app.html?conector=odb'}
          title="RESPONDE · MetoGroup"
          className="block h-[calc(100dvh-13rem)] min-h-[32rem] w-full border-0"
        />
      </Tarjeta>
    </div>
  );
}
