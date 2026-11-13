"use client";

import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { fechaCorta, haceCuanto, mesAnterior, nombreDeMes, pesos } from "../lib/formato";
import { Accion, Boton, Caja, Campo, Cargando, DeDondeSale, ErrorCarga, Fila, Hoja, Marca, Opciones, Seccion, Titulo, Vacio, useDatos } from "../ui";

const WEB = process.env.NEXT_PUBLIC_WEB_URL ?? "http://localhost:3010";

type Tipo = "hotel" | "guia" | "agencia" | "remis" | "otro";
type Derivador = {
  id: string; nombre: string; tipo: Tipo; contacto: string | null; telefono: string | null; comisionPct: number; codigo: string;
  activo: boolean; notas: string | null; mesas: number; cubiertos: number; ventas: number; comision: number;
  liquidacion: { monto: number; pagadoEn: string; nota: string | null } | null;
};
type Lista = { mes: string; derivadores: Derivador[]; total: { mesas: number; cubiertos: number; ventas: number; comision: number; pagado: number } };
type Detalle = Derivador & {
  mes: string;
  visitas: { id: string; fecha: string; mesaNumero: number | null; cubiertos: number | null; monto: number; comision: number }[];
  pagosAnteriores: { mes: string; monto: number; pagadoEn: string; nota: string | null }[];
};

const TIPO: Record<Tipo, string> = { hotel: "Hotel", guia: "Guía", agencia: "Agencia", remis: "Remís", otro: "Otro" };
const mesDeHoy = () => new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 7);
const VACIO = { nombre: "", tipo: "hotel" as Tipo, contacto: "", telefono: "", comisionPct: 10, notas: "" };

export default function DerivadoresPage() {
  const [mes, setMes] = useState(mesDeHoy());
  const lista = useDatos<Lista>(() => api(`/admin/derivadores?mes=${mes}`), undefined, [mes]);
  const [abierto, setAbierto] = useState<string | null>(null);
  const [form, setForm] = useState<(typeof VACIO & { id?: string }) | null>(null);
  const [texto, setTexto] = useState("");
  const [tipo, setTipo] = useState<Tipo | "todos">("todos");
  const [verInactivos, setVerInactivos] = useState(false);

  async function guardar() {
    if (!form) return;
    if (!form.nombre.trim()) throw new Error("Falta el nombre");
    if (form.id) await api(`/admin/derivadores/${form.id}`, { method: "PUT", body: JSON.stringify(form) });
    else await api("/admin/derivadores", { method: "POST", body: JSON.stringify(form) });
    setForm(null);
    lista.recargar();
  }

  const d = lista.datos;
  const visibles = (d?.derivadores ?? []).filter(
    (x) => (verInactivos || x.activo) && (tipo === "todos" || x.tipo === tipo) && x.nombre.toLowerCase().includes(texto.trim().toLowerCase()),
  );
  const meses = [0, 1, 2, 3].map((n) => mesAnterior(mesDeHoy(), n));

  return (
    <div>
      <Titulo
        bajada="Los hoteles, guías, agencias y remises que mandan gente. Cada uno tiene su link y su QR; la mesa que entra por ahí queda a su nombre y suma para su comisión."
        acciones={<Boton variante="principal" onClick={() => setForm({ ...VACIO })}>Agregar uno</Boton>}
      >
        Hoteles y guías
      </Titulo>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mb-3">
        <Opciones chico valor={mes} alElegir={setMes} opciones={meses.map((m) => ({ valor: m, texto: <span className="mayus">{nombreDeMes(m)}</span> }))} />
      </div>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Buscar por nombre" aria-label="Buscar por nombre" className="campo !w-52" />
        <Opciones chico valor={tipo} alElegir={setTipo} opciones={[{ valor: "todos" as const, texto: "Todos" }, ...(Object.keys(TIPO) as Tipo[]).map((t) => ({ valor: t, texto: TIPO[t] }))]} />
        <Boton tamano="chico" variante="suave" onClick={() => setVerInactivos(!verInactivos)}>{verInactivos ? "Ocultar los dados de baja" : "Ver también los dados de baja"}</Boton>
      </div>

      {lista.error && <ErrorCarga error={lista.error} reintentar={lista.recargar} />}
      {!d && !lista.error && <Cargando />}

      {d && (
        <>
          <Seccion titulo={<span>En <span className="lowercase">{nombreDeMes(d.mes)}</span></span>}>
            <Caja className="px-3">
              <Fila que="Mesas que mandaron" nota={`${d.total.cubiertos} personas`} cuanto={d.total.mesas} />
              <Fila que="Lo que consumieron esas mesas" cuanto={pesos(d.total.ventas)} />
              <Fila fuerte que="Comisiones del mes" cuanto={pesos(d.total.comision)} />
              <Fila que="Ya pagadas" cuanto={pesos(d.total.pagado)} tinta="text-good" />
              <Fila que="Falta pagar" cuanto={pesos(Math.max(0, d.total.comision - d.total.pagado))} tinta={d.total.comision - d.total.pagado > 0 ? "text-loss" : ""} />
            </Caja>
            <DeDondeSale>
              Cuenta las mesas que el encargado sentó «por» cada uno (o que entraron con su reserva) y que ya se cobraron en el mes.
              La comisión es el consumo de esas mesas por el porcentaje de cada uno.
            </DeDondeSale>
          </Seccion>

          <Seccion titulo={`Quién mandó gente · ${visibles.length}`} bajada="Tocá un nombre para ver sus mesas, su QR y pagarle.">
            {visibles.length === 0 && <Vacio>No hay ninguno con ese filtro.</Vacio>}
            {visibles.length > 0 && (
              <Caja>
                {visibles.map((x) => (
                  <div key={x.id} className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2 border-b border-line last:border-b-0 ${x.activo ? "" : "opacity-55"}`}>
                    <button onClick={() => setAbierto(x.id)} className="flex-1 min-w-[170px] text-left">
                      <span className="block font-semibold text-[13.5px] underline decoration-line underline-offset-2">{x.nombre}</span>
                      <span className="flex flex-wrap items-center gap-1.5 mt-0.5">
                        <Marca tono="puerta">{TIPO[x.tipo]}</Marca>
                        <span className="text-faint text-[11.5px]">{x.comisionPct} % de comisión</span>
                        {!x.activo && <Marca>Dado de baja</Marca>}
                      </span>
                    </button>
                    <span className="text-right text-[12.5px] text-dim w-[92px]">
                      <b className="num text-ink">{x.mesas}</b> mesas<br /><span className="num">{x.cubiertos}</span> personas
                    </span>
                    <span className="text-right w-[120px]">
                      <span className="block num font-bold text-[13.5px]">{pesos(x.comision)}</span>
                      <span className="block text-[11.5px]">
                        {x.liquidacion ? <span className="text-good">Pagada</span> : x.comision > 0 ? <span className="text-loss">Falta pagar</span> : <span className="text-faint">Sin comisión</span>}
                      </span>
                    </span>
                    <span className="flex gap-1.5">
                      {x.telefono && <a href={`https://wa.me/${x.telefono}`} target="_blank" rel="noreferrer"><Boton tamano="chico">WhatsApp</Boton></a>}
                      <Boton tamano="chico" variante="principal" onClick={() => setAbierto(x.id)}>Abrir</Boton>
                    </span>
                  </div>
                ))}
              </Caja>
            )}
          </Seccion>
        </>
      )}

      {abierto && (
        <DetalleHoja
          id={abierto}
          mes={mes}
          cerrar={() => setAbierto(null)}
          alCambiar={lista.recargar}
          editar={(x) => { setAbierto(null); setForm({ id: x.id, nombre: x.nombre, tipo: x.tipo, contacto: x.contacto ?? "", telefono: x.telefono ?? "", comisionPct: x.comisionPct, notas: x.notas ?? "" }); }}
        />
      )}

      {form && (
        <Hoja
          titulo={form.id ? "Cambiar los datos" : "Agregar un hotel, guía o agencia"}
          cerrar={() => setForm(null)}
          pie={<Accion hacer={guardar} variante="principal" tamano="grande" ancho haciendo="Guardando…" listo="Guardado">Guardar</Accion>}
        >
          <div className="flex flex-col gap-3">
            <Campo etiqueta="Nombre"><input className="campo" value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} /></Campo>
            <div>
              <p className="text-[12px] font-semibold text-dim mb-1.5">¿Qué es?</p>
              <Opciones chico valor={form.tipo} alElegir={(v) => setForm({ ...form, tipo: v })} opciones={(Object.keys(TIPO) as Tipo[]).map((t) => ({ valor: t, texto: TIPO[t] }))} />
            </div>
            <Campo etiqueta="Persona de contacto"><input className="campo" value={form.contacto} onChange={(e) => setForm({ ...form, contacto: e.target.value })} /></Campo>
            <Campo etiqueta="WhatsApp" ayuda="Con código de país. Ahí le llega el resumen del mes.">
              <input className="campo num" inputMode="tel" value={form.telefono} onChange={(e) => setForm({ ...form, telefono: e.target.value })} />
            </Campo>
            <Campo etiqueta="Comisión, en % del consumo">
              <input type="number" min={0} max={50} step={0.5} className="campo num !w-28" value={form.comisionPct} onChange={(e) => setForm({ ...form, comisionPct: Number(e.target.value) })} />
            </Campo>
            <Campo etiqueta="Notas"><textarea rows={2} className="campo" value={form.notas} onChange={(e) => setForm({ ...form, notas: e.target.value })} /></Campo>
          </div>
        </Hoja>
      )}
    </div>
  );
}

function DetalleHoja({ id, mes, cerrar, alCambiar, editar }: { id: string; mes: string; cerrar: () => void; alCambiar: () => void; editar: (d: Detalle) => void }) {
  const det = useDatos<Detalle>(() => api(`/admin/derivadores/${id}?mes=${mes}`), undefined, [id, mes]);
  const [qr, setQr] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const d = det.datos;
  const link = d ? `${WEB}/r/${d.codigo}` : "";

  useEffect(() => {
    if (!link) return;
    QRCode.toDataURL(link, { width: 640, margin: 2, errorCorrectionLevel: "M" }).then(setQr).catch(() => setQr(null));
  }, [link]);

  async function hecho<T>(p: Promise<T>) {
    await p;
    await det.recargar();
    alCambiar();
  }

  if (det.error) return <Hoja titulo="No se pudo abrir" cerrar={cerrar}><ErrorCarga error={det.error} reintentar={det.recargar} /></Hoja>;
  if (!d) return <Hoja titulo="Abriendo…" cerrar={cerrar}><Cargando /></Hoja>;

  return (
    <Hoja titulo={d.nombre} bajada={`${TIPO[d.tipo]} · ${d.comisionPct} % de comisión${d.contacto ? ` · ${d.contacto}` : ""}`} cerrar={cerrar}>
      <div className="flex flex-wrap gap-1.5 mb-4">
        <Boton tamano="chico" onClick={() => editar(d)}>Cambiar los datos</Boton>
        {d.telefono && <a href={`https://wa.me/${d.telefono}`} target="_blank" rel="noreferrer"><Boton tamano="chico">WhatsApp</Boton></a>}
        {d.telefono && <a href={`tel:+${d.telefono}`}><Boton tamano="chico">Llamar</Boton></a>}
        <Accion
          tamano="chico" variante={d.activo ? "suave" : "normal"} confirmar={d.activo ? "¿Dar de baja? Tocá de nuevo" : undefined} haciendo="Guardando…"
          hacer={() => hecho(api(`/admin/derivadores/${d.id}`, { method: "PUT", body: JSON.stringify({ activo: !d.activo }) }))}
        >
          {d.activo ? "Dar de baja" : "Volver a activar"}
        </Accion>
      </div>

      <p className="text-[11px] font-bold uppercase tracking-wide text-faint mb-1">{nombreDeMes(d.mes)}</p>
      <div className="mb-3">
        <Fila que="Mesas que mandó" nota={`${d.cubiertos} personas`} cuanto={d.mesas} />
        <Fila que="Consumo de esas mesas" cuanto={pesos(d.ventas)} />
        <Fila fuerte que={`Comisión (${d.comisionPct} %)`} cuanto={pesos(d.comision)} />
      </div>
      <div className="flex flex-wrap items-center gap-2 mb-5">
        {d.liquidacion ? (
          <>
            <Marca tono="bien">Pagada {haceCuanto(d.liquidacion.pagadoEn)} · {pesos(d.liquidacion.monto)}</Marca>
            <Accion tamano="chico" variante="suave" confirmar="¿Deshacer el pago? Tocá de nuevo" haciendo="Deshaciendo…" hacer={() => hecho(api(`/admin/derivadores/${d.id}/pagar?mes=${d.mes}`, { method: "DELETE" }))}>
              No se pagó: deshacer
            </Accion>
          </>
        ) : (
          <Accion variante="principal" disabled={d.comision <= 0} haciendo="Anotando el pago…" listo="Pago anotado" hacer={() => hecho(api(`/admin/derivadores/${d.id}/pagar`, { method: "POST", body: JSON.stringify({ mes: d.mes }) }))}>
            Ya le pagué {pesos(d.comision)}
          </Accion>
        )}
        <Accion
          haciendo="Abriendo WhatsApp…" listo="Abierto" disabled={!d.telefono}
          hacer={async () => { const r = await api(`/admin/derivadores/${d.id}/whatsapp?mes=${d.mes}`); if (r.waLink) window.open(r.waLink, "_blank"); }}
        >
          Mandarle el resumen por WhatsApp
        </Accion>
      </div>

      <p className="text-[11px] font-bold uppercase tracking-wide text-faint mb-1">Su link y su QR</p>
      <Caja className="p-3 mb-5">
        <p className="num text-[12.5px] break-all mb-2">{link}</p>
        <div className="flex flex-wrap gap-1.5 mb-3">
          <Boton tamano="chico" onClick={async () => { await navigator.clipboard.writeText(link); setCopiado(true); setTimeout(() => setCopiado(false), 1600); }}>
            {copiado ? "● Copiado" : "Copiar el link"}
          </Boton>
          {qr && <a href={qr} download={`qr-${d.codigo}.png`}><Boton tamano="chico">Bajar el QR para imprimir</Boton></a>}
          <a href={link} target="_blank" rel="noreferrer"><Boton tamano="chico" variante="suave">Ver lo que ve el cliente</Boton></a>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {qr && <img src={qr} alt={`QR de ${d.nombre}`} className="w-40 h-40 rounded bg-white p-1" />}
        <p className="text-[11.5px] text-faint mt-2">El cliente que escanea este QR ve la carta y puede reservar; la reserva entra a nombre de {d.nombre}.</p>
      </Caja>

      <p className="text-[11px] font-bold uppercase tracking-wide text-faint mb-1">Mesas del mes · {d.visitas.length}</p>
      {d.visitas.length === 0 && <Vacio>Todavía no mandó mesas este mes.</Vacio>}
      {d.visitas.slice(0, 40).map((v) => (
        <Fila key={v.id} que={<><span className="num">{fechaCorta(v.fecha)}</span> · mesa {v.mesaNumero ?? "—"} · {v.cubiertos ?? "—"} pers.</>} nota={`Consumo ${pesos(v.monto)}`} cuanto={pesos(v.comision)} />
      ))}
      {d.visitas.length > 40 && <p className="text-[11.5px] text-faint mt-1">Se muestran las últimas 40 de {d.visitas.length}.</p>}

      {d.pagosAnteriores.length > 0 && (
        <>
          <p className="text-[11px] font-bold uppercase tracking-wide text-faint mb-1 mt-5">Pagos hechos</p>
          {d.pagosAnteriores.map((p) => <Fila key={p.mes} que={<span className="mayus">{nombreDeMes(p.mes)}</span>} cuanto={pesos(p.monto)} />)}
        </>
      )}
    </Hoja>
  );
}
