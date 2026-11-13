"use client";

import Link from "next/link";
import { useState } from "react";
import { api } from "../lib/api";
import { BANDERA, NOMBRE_IDIOMA, diaCorto, fechaCorta, fechaLarga, hoyArt, pesos } from "../lib/formato";
import type { Mozo } from "../lib/piso";
import { Accion, Boton, Caja, Campo, Cargando, ErrorCarga, Hoja, Marca, Monto, Opciones, Seccion, Titulo, Vacio, useDatos } from "../ui";

type Idioma = "es" | "pt" | "en";
type Estado = "pendiente" | "confirmada" | "sentada" | "no_vino" | "cancelada";
type Reserva = {
  id: string; nombre: string; telefono: string | null; personas: number; fecha: string; hora: string; idioma: Idioma;
  estado: Estado; origen: string; derivadorId: string | null; derivadorNombre: string | null; mesaNumero: number | null;
  senaMonto: number | null; senaPagada: boolean; notas: string | null; recordatorioEn: string | null;
};
type Espera = { id: string; nombre: string; telefono: string; personas: number; idioma: Idioma; estado: "esperando" | "avisado"; minutos: number };
type Agenda = {
  fecha: string; esHoy: boolean; reservas: Reserva[]; espera: Espera[];
  mesasLibres: { id: string; numero: number; sector: string | null }[];
  resumen: { reservas: number; personas: number; sinConfirmar: number; senasPendientes: number; mesasLibres: number; mesasTotal: number };
};
type Dia = { fecha: string; reservas: number; personas: number };
type Derivador = { id: string; nombre: string; activo: boolean };

const ESTADO: Record<Estado, { texto: string; tono: "gris" | "bien" | "mal" | "ojo" | "puerta" }> = {
  pendiente: { texto: "Sin confirmar", tono: "ojo" },
  confirmada: { texto: "Confirmada", tono: "puerta" },
  sentada: { texto: "Ya están sentados", tono: "bien" },
  no_vino: { texto: "No vino", tono: "mal" },
  cancelada: { texto: "Cancelada", tono: "gris" },
};
const ORIGEN: Record<string, string> = { salon: "Cargada en el salón", web: "Por la web", whatsapp: "Por WhatsApp", google: "Por Google", derivador: "Por hotel o guía" };

const VACIA = { nombre: "", telefono: "", personas: 2, hora: "21:00", idioma: "es" as Idioma, origen: "whatsapp", derivadorId: "", senaMonto: null as number | null, notas: "" };

export default function ReservasPage() {
  const [fecha, setFecha] = useState(hoyArt());
  const agenda = useDatos<Agenda>(() => api(`/admin/reservas/agenda?fecha=${fecha}`), 12000, [fecha]);
  const dias = useDatos<Dia[]>(() => api("/admin/reservas/proximos"), 60000);
  const mozos = useDatos<Mozo[]>(() => api("/admin/mozos"));
  const derivadores = useDatos<{ derivadores: Derivador[] }>(() => api("/admin/derivadores"));
  const [form, setForm] = useState<(typeof VACIA & { id?: string }) | null>(null);
  const [sentando, setSentando] = useState<Reserva | null>(null);
  const [verCerradas, setVerCerradas] = useState(false);

  function recargar() {
    agenda.recargar();
    dias.recargar();
  }
  const post = (ruta: string, body: unknown = {}) => api(`/admin/reservas/${ruta}`, { method: "POST", body: JSON.stringify(body) });

  async function guardar() {
    if (!form) return;
    if (!form.nombre.trim()) throw new Error("Falta el nombre");
    const cuerpo = { ...form, fecha, derivadorId: form.derivadorId || null, origen: form.derivadorId ? "derivador" : form.origen };
    if (form.id) await api(`/admin/reservas/${form.id}`, { method: "PUT", body: JSON.stringify(cuerpo) });
    else await api("/admin/reservas", { method: "POST", body: JSON.stringify(cuerpo) });
    setForm(null);
    recargar();
  }
  async function recordar(r: Reserva) {
    const res = await post(`${r.id}/recordatorio`);
    window.open(res.waLink, "_blank");
    recargar();
  }

  const a = agenda.datos;
  const vivas = a?.reservas.filter((r) => r.estado === "pendiente" || r.estado === "confirmada") ?? [];
  const cerradas = a?.reservas.filter((r) => !["pendiente", "confirmada"].includes(r.estado)) ?? [];
  const activosMozos = (mozos.datos ?? []).filter((m) => m.activo);
  const activosDer = (derivadores.datos?.derivadores ?? []).filter((d) => d.activo);

  return (
    <div>
      <Titulo
        bajada="La agenda de la puerta: quién reservó, quién espera y qué mesas hay. Todo en una sola pantalla."
        acciones={
          <>
            <Boton variante="principal" onClick={() => setForm({ ...VACIA })}>Nueva reserva</Boton>
            <Link href="/espera"><Boton>Anotar en espera</Boton></Link>
          </>
        }
      >
        Reservas y espera
      </Titulo>

      {/* elegir el día */}
      <div className="flex flex-wrap items-center gap-1.5 mb-4">
        {(dias.datos ?? [{ fecha: hoyArt(), reservas: 0, personas: 0 }]).map((d) => (
          <button
            key={d.fecha}
            onClick={() => setFecha(d.fecha)}
            className={`rounded-md border px-2.5 py-1 text-left min-w-[62px] ${fecha === d.fecha ? "bg-ink text-bg border-ink" : "bg-card border-line hover:bg-card-2"}`}
          >
            <span className="block text-[11px] font-semibold uppercase leading-tight">{d.fecha === hoyArt() ? "Hoy" : diaCorto(d.fecha)} {fechaCorta(d.fecha)}</span>
            <span className={`block text-[11px] leading-tight ${fecha === d.fecha ? "opacity-80" : "text-faint"}`}>
              {d.reservas ? `${d.reservas} · ${d.personas} pers.` : "sin reservas"}
            </span>
          </button>
        ))}
        <input type="date" value={fecha} onChange={(e) => e.target.value && setFecha(e.target.value)} className="campo !w-auto" aria-label="Otro día" />
      </div>

      {agenda.error && <ErrorCarga error={agenda.error} reintentar={agenda.recargar} />}
      {!a && !agenda.error && <Cargando />}

      {a && (
        <>
          <p className="text-[13.5px] mb-4">
            <b className="mayus">{fechaLarga(a.fecha)}</b>
            <span className="text-dim">
              {" "}· {a.resumen.reservas} {a.resumen.reservas === 1 ? "reserva" : "reservas"} para {a.resumen.personas} personas
              {a.resumen.sinConfirmar > 0 && <> · <span className="text-warn font-semibold">{a.resumen.sinConfirmar} sin confirmar</span></>}
              {a.resumen.senasPendientes > 0 && <> · <span className="text-warn font-semibold">{a.resumen.senasPendientes} con seña sin pagar</span></>}
              {a.esHoy && <> · ahora hay {a.resumen.mesasLibres} de {a.resumen.mesasTotal} mesas libres</>}
            </span>
          </p>

          <Seccion titulo="Reservas">
            {vivas.length === 0 && <Vacio>No hay reservas pendientes para este día.</Vacio>}
            {vivas.length > 0 && (
              <Caja>
                {vivas.map((r) => (
                  <div key={r.id} className="px-3 py-2.5 border-b border-line last:border-b-0">
                    <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
                      <span className="num font-bold text-[15px] w-[46px] flex-none">{r.hora}</span>
                      <div className="flex-1 min-w-[180px]">
                        <p className="font-semibold text-[13.5px] leading-tight">
                          {r.nombre} <span className="text-dim font-normal">· {r.personas} personas</span>
                        </p>
                        <p className="flex flex-wrap items-center gap-1.5 mt-1">
                          <Marca tono={ESTADO[r.estado].tono}>{ESTADO[r.estado].texto}</Marca>
                          <Marca>{BANDERA[r.idioma]}</Marca>
                          {r.derivadorNombre ? <Marca tono="puerta">Por {r.derivadorNombre}</Marca> : <span className="text-faint text-[11.5px]">{ORIGEN[r.origen] ?? r.origen}</span>}
                          {r.senaMonto != null && <Marca tono={r.senaPagada ? "bien" : "ojo"}>Seña {pesos(r.senaMonto)} · {r.senaPagada ? "pagada" : "sin pagar"}</Marca>}
                          {r.recordatorioEn && <span className="text-faint text-[11.5px]">Recordatorio mandado</span>}
                        </p>
                        {r.notas && <p className="text-dim text-[12.5px] mt-1">{r.notas}</p>}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5 mt-2 sm:pl-[58px]">
                      {a.esHoy && <Boton tamano="chico" variante="principal" onClick={() => setSentando(r)}>Llegaron: sentar</Boton>}
                      {r.estado === "pendiente" && (
                        <Accion tamano="chico" hacer={async () => { await post(`${r.id}/estado`, { estado: "confirmada" }); recargar(); }} haciendo="Confirmando…" listo="Confirmada">Confirmar</Accion>
                      )}
                      {r.telefono && <Accion tamano="chico" hacer={() => recordar(r)} haciendo="Abriendo WhatsApp…" listo="Abierto">Recordarle por WhatsApp</Accion>}
                      {r.telefono && <a href={`tel:+${r.telefono}`}><Boton tamano="chico">Llamar</Boton></a>}
                      {r.senaMonto != null && (
                        <Accion
                          tamano="chico"
                          hacer={async () => { await api(`/admin/reservas/${r.id}`, { method: "PUT", body: JSON.stringify({ senaPagada: !r.senaPagada }) }); recargar(); }}
                          haciendo="Anotando…" listo="Anotado"
                        >
                          {r.senaPagada ? "La seña no se pagó" : "Pagó la seña"}
                        </Accion>
                      )}
                      <Boton
                        tamano="chico"
                        onClick={() => setForm({ id: r.id, nombre: r.nombre, telefono: r.telefono ?? "", personas: r.personas, hora: r.hora, idioma: r.idioma, origen: r.origen, derivadorId: r.derivadorId ?? "", senaMonto: r.senaMonto, notas: r.notas ?? "" })}
                      >
                        Cambiar
                      </Boton>
                      <Accion tamano="chico" variante="suave" confirmar="¿No vino? Tocá de nuevo" hacer={async () => { await post(`${r.id}/estado`, { estado: "no_vino" }); recargar(); }} haciendo="Anotando…">No vino</Accion>
                      <Accion tamano="chico" variante="suave" confirmar="¿Cancelar? Tocá de nuevo" hacer={async () => { await post(`${r.id}/estado`, { estado: "cancelada" }); recargar(); }} haciendo="Cancelando…">Cancelar</Accion>
                    </div>
                  </div>
                ))}
              </Caja>
            )}
            {cerradas.length > 0 && (
              <div className="mt-2">
                <Boton tamano="chico" variante="suave" onClick={() => setVerCerradas(!verCerradas)}>
                  {verCerradas ? "Ocultar" : "Ver"} las {cerradas.length} ya resueltas (sentadas, canceladas, no vinieron)
                </Boton>
                {verCerradas && (
                  <Caja className="mt-1.5">
                    {cerradas.map((r) => (
                      <div key={r.id} className="flex flex-wrap items-center gap-2 px-3 py-1.5 border-b border-line last:border-b-0 text-[13px]">
                        <span className="num w-[46px]">{r.hora}</span>
                        <span className="flex-1 min-w-0 truncate">{r.nombre} · {r.personas} personas{r.mesaNumero ? ` · mesa ${r.mesaNumero}` : ""}</span>
                        <Marca tono={ESTADO[r.estado].tono}>{ESTADO[r.estado].texto}</Marca>
                        {r.estado !== "sentada" && (
                          <Accion tamano="chico" variante="suave" hacer={async () => { await post(`${r.id}/estado`, { estado: "confirmada" }); recargar(); }} haciendo="Reabriendo…">Reabrir</Accion>
                        )}
                      </div>
                    ))}
                  </Caja>
                )}
              </div>
            )}
          </Seccion>

          {a.esHoy && (
            <Seccion
              titulo={`En espera ahora${a.espera.length ? ` · ${a.espera.length}` : ""}`}
              bajada="Los que llegaron sin reserva y esperan mesa."
              acciones={<Link href="/espera"><Boton tamano="chico">Abrir la lista de espera</Boton></Link>}
            >
              {a.espera.length === 0 && <Vacio>Nadie está esperando.</Vacio>}
              {a.espera.length > 0 && (
                <Caja>
                  {a.espera.map((e) => (
                    <div key={e.id} className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-line last:border-b-0">
                      <span className="flex-1 min-w-[150px] text-[13.5px]">
                        <b>{e.nombre}</b> <span className="text-dim">· {e.personas} personas · espera hace {e.minutos} min</span>
                      </span>
                      <Marca tono={e.estado === "avisado" ? "bien" : "ojo"}>{e.estado === "avisado" ? "Ya se le avisó" : "Esperando"}</Marca>
                      <Accion
                        tamano="chico"
                        hacer={async () => { const r = await api(`/admin/espera/${e.id}/avisar`, { method: "POST" }); window.open(r.waLink, "_blank"); recargar(); }}
                        haciendo="Abriendo WhatsApp…" listo="Abierto"
                      >
                        Avisarle que hay mesa
                      </Accion>
                      <Accion tamano="chico" variante="principal" hacer={async () => { await api(`/admin/espera/${e.id}/sentar`, { method: "POST" }); recargar(); }} haciendo="Anotando…" listo="Sentado">Ya se sentó</Accion>
                      <Accion tamano="chico" variante="suave" confirmar="¿Se fue? Tocá de nuevo" hacer={async () => { await api(`/admin/espera/${e.id}/abandono`, { method: "POST" }); recargar(); }} haciendo="Anotando…">Se fue</Accion>
                    </div>
                  ))}
                </Caja>
              )}
            </Seccion>
          )}

          {a.esHoy && (
            <Seccion titulo={`Mesas libres ahora · ${a.mesasLibres.length}`} acciones={<Link href="/piso-vivo"><Boton tamano="chico">Ver el piso vivo</Boton></Link>}>
              {a.mesasLibres.length === 0 ? (
                <Vacio>El salón está lleno.</Vacio>
              ) : (
                <p className="text-[13px] text-dim leading-relaxed">
                  {a.mesasLibres.map((m) => `${m.numero}${m.sector ? ` (${m.sector})` : ""}`).join(" · ")}
                </p>
              )}
            </Seccion>
          )}
        </>
      )}

      {/* ── alta y cambio de una reserva ── */}
      {form && (
        <Hoja
          titulo={form.id ? "Cambiar la reserva" : "Nueva reserva"}
          bajada={<span className="mayus">{fechaLarga(fecha)}</span>}
          cerrar={() => setForm(null)}
          pie={<Accion hacer={guardar} variante="principal" tamano="grande" ancho haciendo="Guardando…" listo="Guardada">{form.id ? "Guardar los cambios" : "Guardar la reserva"}</Accion>}
        >
          <div className="flex flex-col gap-3">
            <Campo etiqueta="A nombre de"><input className="campo" value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} /></Campo>
            <Campo etiqueta="WhatsApp" ayuda="Con código de país, sin espacios. Sirve para el recordatorio.">
              <input className="campo num" inputMode="tel" value={form.telefono} onChange={(e) => setForm({ ...form, telefono: e.target.value })} />
            </Campo>
            <div className="grid grid-cols-2 gap-3">
              <Campo etiqueta="Hora"><input type="time" className="campo num" value={form.hora} onChange={(e) => setForm({ ...form, hora: e.target.value })} /></Campo>
              <Campo etiqueta="Personas">
                <input type="number" min={1} max={80} className="campo num" value={form.personas} onChange={(e) => setForm({ ...form, personas: Number(e.target.value) })} />
              </Campo>
            </div>
            <div>
              <p className="text-[12px] font-semibold text-dim mb-1.5">Idioma del cliente</p>
              <Opciones valor={form.idioma} alElegir={(v) => setForm({ ...form, idioma: v })} opciones={(["es", "pt", "en"] as Idioma[]).map((i) => ({ valor: i, texto: NOMBRE_IDIOMA[i] }))} chico />
            </div>
            <div>
              <p className="text-[12px] font-semibold text-dim mb-1.5">¿Cómo llegó la reserva?</p>
              <Opciones
                chico
                valor={form.derivadorId ? "derivador" : form.origen}
                alElegir={(v) => setForm({ ...form, origen: v, derivadorId: v === "derivador" ? form.derivadorId || activosDer[0]?.id || "" : "" })}
                opciones={[{ valor: "whatsapp", texto: "WhatsApp" }, { valor: "salon", texto: "En el salón" }, { valor: "google", texto: "Google" }, { valor: "derivador", texto: "Hotel o guía" }]}
              />
              {(form.derivadorId || form.origen === "derivador") && (
                <select className="campo mt-2" value={form.derivadorId} onChange={(e) => setForm({ ...form, derivadorId: e.target.value })} aria-label="Quién la mandó">
                  <option value="">Elegí quién la mandó</option>
                  {activosDer.map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>)}
                </select>
              )}
            </div>
            <Campo etiqueta="Seña, en pesos" ayuda="Opcional. Para grupos grandes o fechas pico.">
              <Monto valor={form.senaMonto} alCambiar={(n) => setForm({ ...form, senaMonto: n })} className="w-44" />
            </Campo>
            <Campo etiqueta="Notas"><textarea rows={2} className="campo" value={form.notas} onChange={(e) => setForm({ ...form, notas: e.target.value })} /></Campo>
          </div>
        </Hoja>
      )}

      {/* ── sentar una reserva que llegó ── */}
      {sentando && a && (
        <SentarReserva
          reserva={sentando}
          mesas={a.mesasLibres}
          mozos={activosMozos}
          cerrar={() => setSentando(null)}
          alSentar={async (mesaId, mozoId) => { await post(`${sentando.id}/sentar`, { mesaId, mozoId: mozoId ?? undefined }); setSentando(null); recargar(); }}
        />
      )}
    </div>
  );
}

function SentarReserva({ reserva, mesas, mozos, cerrar, alSentar }: {
  reserva: Reserva; mesas: { id: string; numero: number; sector: string | null }[]; mozos: Mozo[];
  cerrar: () => void; alSentar: (mesaId: string, mozoId: string | null) => Promise<void>;
}) {
  const [mesaId, setMesaId] = useState<string | null>(null);
  const [mozoId, setMozoId] = useState<string | null>(null);
  return (
    <Hoja
      titulo={`Sentar a ${reserva.nombre}`}
      bajada={`${reserva.personas} personas · reserva de las ${reserva.hora}${reserva.derivadorNombre ? ` · por ${reserva.derivadorNombre}` : ""}`}
      cerrar={cerrar}
      pie={
        <Accion hacer={() => { if (!mesaId) throw new Error("Elegí la mesa"); return alSentar(mesaId, mozoId); }} variante="principal" tamano="grande" ancho haciendo="Sentando…" listo="Sentados" disabled={!mesaId}>
          Sentar{mesaId ? ` en la mesa ${mesas.find((m) => m.id === mesaId)?.numero}` : ""}
        </Accion>
      }
    >
      <p className="text-[12px] font-semibold text-dim mb-1.5">¿En qué mesa?</p>
      {mesas.length === 0 ? <Vacio>No hay mesas libres en este momento.</Vacio> : (
        <Opciones valor={mesaId} alElegir={setMesaId} opciones={mesas.map((m) => ({ valor: m.id, texto: `${m.numero}${m.sector ? ` · ${m.sector}` : ""}` }))} chico />
      )}
      <p className="text-[12px] font-semibold text-dim mb-1.5 mt-4">¿Quién la atiende?</p>
      <Opciones valor={mozoId} alElegir={setMozoId} opciones={mozos.map((m) => ({ valor: m.id, texto: m.nombre }))} />
      {reserva.notas && <p className="text-[12.5px] text-dim mt-4"><b>Nota de la reserva:</b> {reserva.notas}</p>}
    </Hoja>
  );
}
