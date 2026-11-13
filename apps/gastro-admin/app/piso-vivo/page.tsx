"use client";

import Link from "next/link";
import { useState } from "react";
import { api } from "../lib/api";
import { ETIQUETA_ESTADO, agruparPorSector, type MesaPiso, type Mozo } from "../lib/piso";
import { Accion, Boton, Caja, Cargando, ErrorCarga, Marca, Opciones, Titulo, useDatos } from "../ui";
import { MesaHoja } from "../MesaHoja";

type Director = { ocupacion: number; dosPorUnoActivo: boolean; sugerencias: { tipo: string; mensaje: string }[] };
type Filtro = "todas" | "ocupadas" | "libres" | "atencion";

const BORDE = { verde: "border-good/60", amarillo: "border-warn/70", rojo: "border-loss" };
const PUNTO = { verde: "bg-good", amarillo: "bg-warn", rojo: "bg-loss" };

export default function PisoVivoPage() {
  const piso = useDatos<MesaPiso[]>(() => api("/admin/piso-vivo"), 5000);
  const director = useDatos<Director>(() => api("/admin/director/sugerencias"), 20000);
  const mozos = useDatos<Mozo[]>(() => api("/admin/mozos"));
  const [abierta, setAbierta] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<Filtro>("todas");
  const [mozoFiltro, setMozoFiltro] = useState<string>("");

  if (piso.error && !piso.datos) return <ErrorCarga error={piso.error} reintentar={piso.recargar} />;
  if (!piso.datos) return <Cargando />;

  const mesas = piso.datos;
  const activos = (mozos.datos ?? []).filter((m) => m.activo);
  const ocupadas = mesas.filter((m) => m.estado !== "libre");
  const pideAtencion = (m: MesaPiso) => m.color === "rojo" || m.llamadoHaceMin != null || m.estado === "pidio_cuenta" || m.estado === "pago";
  const visibles = mesas.filter(
    (m) =>
      (filtro === "todas" || (filtro === "ocupadas" && m.estado !== "libre") || (filtro === "libres" && m.estado === "libre") || (filtro === "atencion" && pideAtencion(m))) &&
      (!mozoFiltro || m.mozoId === mozoFiltro),
  );
  const mesaAbierta = mesas.find((m) => m.mesaId === abierta) ?? null;
  const d = director.datos;

  return (
    <div>
      <Titulo
        bajada="Cada mesa con su reloj. Tocá una mesa para sentar gente, tomar la comanda, cobrar o lo que haga falta."
        acciones={
          <>
            <Link href="/reservas"><Boton tamano="chico">Reservas y espera</Boton></Link>
            <Link href="/caja"><Boton tamano="chico">Caja</Boton></Link>
            <Link href="/cocina"><Boton tamano="chico">Cocina</Boton></Link>
          </>
        }
      >
        Piso vivo
      </Titulo>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-3">
        <Opciones
          chico
          valor={filtro}
          alElegir={setFiltro}
          opciones={[
            { valor: "todas", texto: `Todas · ${mesas.length}` },
            { valor: "ocupadas", texto: `Ocupadas · ${ocupadas.length}` },
            { valor: "libres", texto: `Libres · ${mesas.length - ocupadas.length}` },
            { valor: "atencion", texto: `Piden atención · ${mesas.filter(pideAtencion).length}` },
          ]}
        />
        {activos.length > 0 && (
          <select value={mozoFiltro} onChange={(e) => setMozoFiltro(e.target.value)} className="campo !w-auto !min-h-[28px] !py-0.5 text-[12px]" aria-label="Filtrar por mozo">
            <option value="">Todos los mozos</option>
            {activos.map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}
          </select>
        )}
      </div>

      {d && (
        <Caja className="px-3 py-2 mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="min-w-0 text-[13px]">
            <span className="font-semibold">2x1: {d.dosPorUnoActivo ? "prendido" : "apagado"}</span>
            <span className="text-dim"> · salón al {d.ocupacion} %</span>
            {d.sugerencias.map((s, i) => <p key={i} className="text-[12.5px] text-dim mt-0.5"><Marca tono="ojo">Sugerencia</Marca> {s.mensaje}</p>)}
          </div>
          <Accion
            tamano="chico"
            haciendo="Cambiando…"
            listo="Cambiado"
            hacer={async () => {
              await api("/admin/configuracion", { method: "PUT", body: JSON.stringify({ dosPorUnoActivo: !d.dosPorUnoActivo }) });
              await director.recargar();
            }}
          >
            {d.dosPorUnoActivo ? "Apagar el 2x1" : "Prender el 2x1"}
          </Accion>
        </Caja>
      )}

      {visibles.length === 0 && <p className="text-dim text-[13px]">No hay mesas con ese filtro.</p>}

      {Object.entries(agruparPorSector(visibles)).map(([sector, mesasSector]) => (
        <section key={sector} className="mb-5">
          <h2 className="flex items-baseline justify-between text-[11px] font-bold text-dim uppercase tracking-wide mb-1.5">
            {sector}
            <span className="text-faint font-medium normal-case tracking-normal">
              {mesasSector.filter((m) => m.estado !== "libre").length} de {mesasSector.length} ocupadas
            </span>
          </h2>
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-1.5">
            {mesasSector.map((m) => (
              <button
                key={m.mesaId}
                onClick={() => setAbierta(m.mesaId)}
                className={`text-left rounded-lg border-2 bg-card px-2 py-1.5 min-h-[76px] hover:bg-card-2 ${m.estado === "libre" ? "border-line border" : BORDE[m.color ?? "verde"]}`}
              >
                <span className="flex items-center justify-between">
                  <span className="font-bold text-[13.5px]">{m.numero}</span>
                  <span className="flex items-center gap-1">
                    {m.llamadoHaceMin != null && <span className="text-[10px] font-bold text-salon">LLAMA</span>}
                    {m.estado !== "libre" && <span className={`w-2 h-2 rounded-full ${PUNTO[m.color ?? "verde"]}`} />}
                  </span>
                </span>
                {m.estado === "libre" ? (
                  <span className="block text-faint text-[11.5px] mt-1">Libre · tocar para sentar</span>
                ) : (
                  <>
                    <span className="block num text-[15px] font-bold leading-tight mt-0.5">{m.minutosTotal} min</span>
                    <span className="block text-[11px] text-dim leading-tight truncate">{ETIQUETA_ESTADO[m.estado].split(" (")[0].split(" —")[0]}</span>
                    <span className="block text-[10.5px] text-faint leading-tight truncate">{m.mozoNombre ?? "sin mozo"}{m.cubiertos ? ` · ${m.cubiertos}` : ""}</span>
                  </>
                )}
              </button>
            ))}
          </div>
        </section>
      ))}

      <p className="text-[11.5px] text-faint mt-2">
        Borde verde: va bien. Amarillo: hay algo para aprovechar o apurar. Rojo: lleva demasiado en el mismo paso.
      </p>

      {mesaAbierta && <MesaHoja mesa={mesaAbierta} mozos={activos} cerrar={() => setAbierta(null)} alCambiar={piso.recargar} />}
    </div>
  );
}
