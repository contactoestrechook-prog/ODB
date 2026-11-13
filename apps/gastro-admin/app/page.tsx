"use client";

import Link from "next/link";
import { api } from "./lib/api";
import { fechaLarga, hoyArt, pesos } from "./lib/formato";
import { ORDEN_ZONAS, PANTALLAS, ZONAS } from "./lib/pantallas";
import { Accion, Boton, Caja, Fila, Marca, Seccion, Titulo, useDatos } from "./ui";

type Ahora = {
  ocupadas: number; totalMesas: number; ocupacionPct: number; llamadosPendientes: number; mesasEnRiesgo: number;
  cubiertosHoy: number; cobradoHoy: number; mesasCerradasHoy: number;
};
type Alerta = { id: string; sentimiento: string; creado_en: string; mesa: { numero: number; sector: string | null } | null; opinion: { comentario: string | null } | null };
type Abierta = { cicloId: string; mesaId: string; mesaNumero: number | null; estado: string; saldo: number; pidioCuentaHaceMin: number | null };
type Agenda = { resumen: { reservas: number; personas: number; sinConfirmar: number; senasPendientes: number } };
type Cambio = { BRL: number | null; USD: number | null; actualizadoEn: string | null };

// Inicio: lo que pasa ahora, lo que hay que hacer (cada cosa con su botón) y
// la puerta a todas las pantallas.
export default function InicioPage() {
  const ahora = useDatos<Ahora>(() => api("/admin/analista/ahora"), 10000);
  const alertas = useDatos<Alerta[]>(() => api("/admin/alertas"), 15000);
  const abiertas = useDatos<Abierta[]>(() => api("/admin/caja/abiertas"), 10000);
  const agenda = useDatos<Agenda>(() => api("/admin/reservas/agenda"), 60000);
  const postVisita = useDatos<{ pendientes: unknown[] }>(() => api("/admin/post-visita"), 120000);
  const cambio = useDatos<Cambio>(() => api("/monedas"), 120000);
  const items = useDatos<{ activo: boolean; agotado: boolean }[]>(() => api("/admin/carta/items"), 120000);

  const a = ahora.datos;
  const pidieron = (abiertas.datos ?? []).filter((x) => x.estado === "pidio_cuenta");
  const cambioViejo = cambio.datos ? !cambio.datos.BRL || !cambio.datos.USD || !cambio.datos.actualizadoEn || Date.now() - new Date(cambio.datos.actualizadoEn).getTime() > 20 * 3_600_000 : false;
  const agotados = (items.datos ?? []).filter((i) => i.activo && i.agotado).length;
  const r = agenda.datos?.resumen;
  const pendientesPv = postVisita.datos?.pendientes.length ?? 0;

  type Tarea = { clave: string; texto: React.ReactNode; boton: string; href: string; tono: "mal" | "ojo" | "gris" };
  const tareas: Tarea[] = [];
  if (a && a.llamadosPendientes > 0) tareas.push({ clave: "llamados", texto: <><b>{a.llamadosPendientes}</b> {a.llamadosPendientes === 1 ? "mesa llama" : "mesas llaman"} al mozo</>, boton: "Ver en el piso", href: "/piso-vivo", tono: "mal" });
  if (pidieron.length > 0) tareas.push({ clave: "cuenta", texto: <><b>{pidieron.length}</b> {pidieron.length === 1 ? "mesa pidió" : "mesas pidieron"} la cuenta ({pidieron.map((p) => p.mesaNumero).join(", ")})</>, boton: "Cobrar", href: "/caja", tono: "mal" });
  if (a && a.mesasEnRiesgo > 0) tareas.push({ clave: "riesgo", texto: <><b>{a.mesasEnRiesgo}</b> {a.mesasEnRiesgo === 1 ? "mesa lleva" : "mesas llevan"} demasiado en el mismo paso</>, boton: "Ver en el piso", href: "/piso-vivo", tono: "ojo" });
  if (cambioViejo) tareas.push({ clave: "cambio", texto: <>El cambio del real y del dólar no está cargado hoy</>, boton: "Cargar el cambio", href: "/caja", tono: "ojo" });
  if (r && r.sinConfirmar > 0) tareas.push({ clave: "reservas", texto: <><b>{r.sinConfirmar}</b> {r.sinConfirmar === 1 ? "reserva de hoy está" : "reservas de hoy están"} sin confirmar</>, boton: "Ver las reservas", href: "/reservas", tono: "ojo" });
  if (r && r.senasPendientes > 0) tareas.push({ clave: "senas", texto: <><b>{r.senasPendientes}</b> {r.senasPendientes === 1 ? "reserva tiene" : "reservas tienen"} la seña sin pagar</>, boton: "Ver las reservas", href: "/reservas", tono: "ojo" });
  if (agotados > 0) tareas.push({ clave: "agotados", texto: <><b>{agotados}</b> {agotados === 1 ? "plato está marcado" : "platos están marcados"} como agotado</>, boton: "Revisar", href: "/carne", tono: "gris" });
  if (pendientesPv > 0) tareas.push({ clave: "pv", texto: <><b>{pendientesPv}</b> {pendientesPv === 1 ? "cliente espera" : "clientes esperan"} el mensaje de agradecimiento</>, boton: "Mandarlos", href: "/post-visita", tono: "gris" });

  return (
    <div>
      <Titulo bajada={<span className="mayus">{fechaLarga(hoyArt())}</span>}>Gran Caminito</Titulo>

      <div className="grid lg:grid-cols-[1fr_300px] gap-x-6">
        <div>
          <Seccion titulo="Para hacer ahora" bajada="Lo que está esperando a alguien. Se actualiza solo.">
            <Caja>
              {(alertas.datos ?? []).map((al) => (
                <div key={al.id} className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-line">
                  <span className="flex-1 min-w-[180px] text-[13.5px]">
                    <Marca tono="mal">Cliente {al.sentimiento}</Marca>{" "}
                    <b>Mesa {al.mesa?.numero}</b>
                    {al.opinion?.comentario && <span className="text-dim"> · «{al.opinion.comentario}»</span>}
                  </span>
                  <Accion tamano="chico" variante="principal" haciendo="Anotando…" listo="Resuelta" hacer={async () => { await api(`/admin/alertas/${al.id}/resolver`, { method: "POST" }); await alertas.recargar(); }}>
                    Ya fui a la mesa
                  </Accion>
                </div>
              ))}
              {tareas.map((t) => (
                <div key={t.clave} className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-line last:border-b-0">
                  <span className={`w-2 h-2 rounded-full flex-none ${t.tono === "mal" ? "bg-loss" : t.tono === "ojo" ? "bg-warn" : "bg-faint"}`} />
                  <span className="flex-1 min-w-[180px] text-[13.5px]">{t.texto}</span>
                  <Link href={t.href}><Boton tamano="chico" variante={t.tono === "mal" ? "principal" : "normal"}>{t.boton}</Boton></Link>
                </div>
              ))}
              {tareas.length === 0 && (alertas.datos ?? []).length === 0 && (
                <p className="px-3 py-3 text-[13px] text-dim">{a ? "No hay nada esperando. Todo al día." : "◔ Cargando…"}</p>
              )}
            </Caja>
          </Seccion>
        </div>

        <Seccion titulo="Ahora en el salón" acciones={<Link href="/piso-vivo"><Boton tamano="chico">Abrir el piso</Boton></Link>}>
          <Caja className="px-3">
            <Fila que="Mesas ocupadas" cuanto={a ? `${a.ocupadas} de ${a.totalMesas}` : "—"} nota={a ? `Salón al ${a.ocupacionPct} %` : undefined} />
            <Fila que="Personas atendidas hoy" cuanto={a?.cubiertosHoy ?? "—"} />
            <Fila que="Mesas cerradas hoy" cuanto={a?.mesasCerradasHoy ?? "—"} />
            <Fila fuerte que="Cobrado hoy" cuanto={a ? pesos(a.cobradoHoy) : "—"} />
            {r && <Fila que="Reservas de hoy" cuanto={`${r.reservas} · ${r.personas} pers.`} />}
          </Caja>
        </Seccion>
      </div>

      <Seccion titulo="Todas las pantallas" bajada="Tocá a dónde querés ir. Desde cualquier pantalla se vuelve con «Volver», arriba a la izquierda.">
        {ORDEN_ZONAS.map((z) => (
          <div key={z} className="mb-4">
            <h3 className={`flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.1em] mb-1.5 ${ZONAS[z].tinta}`}>
              <span className={`w-2 h-2 rounded-sm ${ZONAS[z].fondo}`} /> {ZONAS[z].titulo}
            </h3>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {PANTALLAS.filter((p) => p.zona === z).map((p) => (
                <Link key={p.href} href={p.href} className="rounded-lg border border-line bg-card px-3 py-2.5 hover:bg-card-2">
                  <span className="block font-semibold text-[13.5px]">{p.titulo}</span>
                  <span className="block text-dim text-[12px] leading-snug mt-0.5">{p.que}</span>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </Seccion>
    </div>
  );
}
