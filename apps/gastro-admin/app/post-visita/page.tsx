"use client";

import Link from "next/link";
import { useState } from "react";
import { api } from "../lib/api";
import { BANDERA, haceCuanto } from "../lib/formato";
import { Accion, Boton, Caja, Cargando, DeDondeSale, ErrorCarga, Marca, Seccion, Titulo, Vacio, useDatos } from "../ui";

type Contacto = {
  id: string; nombre: string | null; telefono: string; idioma: string; mesaNumero: number | null;
  visitaEn: string; enviadoEn: string | null; mensaje: string; waLink: string;
};
type Datos = { hayLinkGoogle: boolean; pendientes: Contacto[]; enviados: Contacto[] };

// El mensaje del día siguiente. Se manda uno por uno desde el WhatsApp del
// restaurante: un toque abre el chat con el texto ya escrito en el idioma del cliente.
export default function PostVisitaPage() {
  const datos = useDatos<Datos>(() => api("/admin/post-visita"), 60000);
  const [verMensaje, setVerMensaje] = useState<string | null>(null);

  async function mandar(c: Contacto) {
    window.open(c.waLink, "_blank");
    await api(`/admin/post-visita/${c.id}`, { method: "POST", body: JSON.stringify({ enviado: true }) });
    await datos.recargar();
  }

  const d = datos.datos;
  return (
    <div className="max-w-3xl">
      <Titulo
        bajada="A quien dejó su WhatsApp en la mesa, un agradecimiento al día siguiente con el link para opinar en Google."
        acciones={<><Link href="/resenas"><Boton tamano="chico">Reseñas</Boton></Link><Link href="/clientes"><Boton tamano="chico">Clientes</Boton></Link></>}
      >
        Después de la visita
      </Titulo>

      {datos.error && <ErrorCarga error={datos.error} reintentar={datos.recargar} />}
      {!d && !datos.error && <Cargando />}

      {d && (
        <>
          {!d.hayLinkGoogle && (
            <p className="rounded-lg border border-warn/50 bg-warn/10 px-3 py-2 text-[13px] mb-4">
              Falta el link de «dejar una reseña» de Google: por ahora el mensaje sale sólo con el agradecimiento.
            </p>
          )}

          <Seccion titulo={`Para mandar · ${d.pendientes.length}`} bajada="Clientes de los últimos días que todavía no recibieron el mensaje.">
            {d.pendientes.length === 0 && <Vacio>No hay mensajes pendientes.</Vacio>}
            {d.pendientes.length > 0 && (
              <Caja>
                {d.pendientes.map((c) => (
                  <div key={c.id} className="px-3 py-2 border-b border-line last:border-b-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="flex-1 min-w-[160px] text-[13.5px]">
                        <b>{c.nombre ?? "Sin nombre"}</b> <span className="text-dim num">· +{c.telefono}</span>
                        <span className="block text-faint text-[11.5px]">Vino {haceCuanto(c.visitaEn)}{c.mesaNumero ? ` · mesa ${c.mesaNumero}` : ""}</span>
                      </span>
                      <Marca>{BANDERA[c.idioma] ?? c.idioma}</Marca>
                      <Boton tamano="chico" variante="suave" onClick={() => setVerMensaje(verMensaje === c.id ? null : c.id)}>{verMensaje === c.id ? "Ocultar" : "Ver el mensaje"}</Boton>
                      <Accion tamano="chico" variante="principal" hacer={() => mandar(c)} haciendo="Abriendo WhatsApp…" listo="Mandado">Mandar por WhatsApp</Accion>
                      <Accion tamano="chico" variante="suave" hacer={async () => { await api(`/admin/post-visita/${c.id}`, { method: "POST", body: JSON.stringify({ enviado: true }) }); await datos.recargar(); }} haciendo="Anotando…">No mandar</Accion>
                    </div>
                    {verMensaje === c.id && <p className="text-[12.5px] text-dim mt-2 bg-card-2 rounded-md px-2.5 py-2">{c.mensaje}</p>}
                  </div>
                ))}
              </Caja>
            )}
            <DeDondeSale titulo="Las reglas de Google">
              Se le escribe a todos por igual, estén contentos o no, y no se ofrece nada a cambio de la reseña. Elegir sólo a los contentos
              o premiar la reseña va contra las políticas de Google y puede costar el perfil.
            </DeDondeSale>
          </Seccion>

          {d.enviados.length > 0 && (
            <Seccion titulo={`Ya mandados · ${d.enviados.length}`}>
              <Caja>
                {d.enviados.map((c) => (
                  <div key={c.id} className="flex flex-wrap items-center gap-2 px-3 py-1.5 border-b border-line last:border-b-0 text-[13px]">
                    <span className="flex-1 min-w-[160px]">{c.nombre ?? "Sin nombre"} <span className="text-faint num">· +{c.telefono}</span></span>
                    <span className="text-faint text-[11.5px]">Mandado {haceCuanto(c.enviadoEn)}</span>
                    <Accion tamano="chico" variante="suave" hacer={async () => { await api(`/admin/post-visita/${c.id}`, { method: "POST", body: JSON.stringify({ enviado: false }) }); await datos.recargar(); }} haciendo="Deshaciendo…">No se mandó</Accion>
                  </div>
                ))}
              </Caja>
            </Seccion>
          )}
        </>
      )}
    </div>
  );
}
