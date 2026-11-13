"use client";

import Link from "next/link";
import { useState } from "react";
import { api } from "../lib/api";
import { fechaCorta, pesos } from "../lib/formato";
import { Accion, Boton, Caja, Campo, Cargando, DeDondeSale, ErrorCarga, Fila, Hoja, Marca, Opciones, Seccion, Titulo, Vacio, useDatos } from "../ui";

type CorteRinde = {
  id: string; nombre: string; objetivoPct: number; kilosComprados: number; kilosServidos: number; porciones: number;
  rindePct: number | null; diferencia: number | null; precioKilo: number | null; kilosDeMas: number; plataDeMas: number;
};
type Rendimiento = { dias: number; cortes: CorteRinde[]; plataDeMas: number; platosSinCorte: string[] };
type Mise = {
  manana: { fecha: string; dia: string; esperados: number | null; feriados: { pais: string; nombre: string }[]; reservados: number } | null;
  platos: { id: string; nombre: string; corteId: string; gramos: number; cadaCienPersonas: number; porciones: number | null }[];
  porCorte: { id: string; nombre: string; porciones: number; kilosLimpios: number; kilosEnCrudo: number }[];
  agotados: { id: string; nombre: string }[];
};
type Corte = { id: string; nombre: string; rinde_objetivo_pct: number; activo: boolean };
type Item = { id: string; nombre: string; activo: boolean; agotado: boolean; categoria: { nombre: string } | null };

const kg = (n: number) => `${n.toLocaleString("es-AR", { maximumFractionDigits: 1 })} kg`;

export default function CarnePage() {
  const [dias, setDias] = useState(30);
  const rinde = useDatos<Rendimiento>(() => api(`/admin/carne/rendimiento?dias=${dias}`), undefined, [dias]);
  const mise = useDatos<Mise>(() => api("/admin/carne/mise-en-place"));
  const items = useDatos<Item[]>(() => api("/admin/carta/items"));
  const [cortesAbierto, setCortesAbierto] = useState(false);
  const [detalle, setDetalle] = useState<CorteRinde | null>(null);
  const [buscar, setBuscar] = useState("");

  async function agotar(it: { id: string }, agotado: boolean) {
    await api(`/admin/carta/items/${it.id}`, { method: "PUT", body: JSON.stringify({ agotado }) });
    await Promise.all([items.recargar(), mise.recargar()]);
  }

  const m = mise.datos;
  const activos = (items.datos ?? []).filter((i) => i.activo);
  const agotados = activos.filter((i) => i.agotado);
  const paraAgotar = activos.filter((i) => !i.agotado && buscar.trim() && i.nombre.toLowerCase().includes(buscar.trim().toLowerCase())).slice(0, 8);

  return (
    <div className="max-w-3xl">
      <Titulo
        bajada="Qué sacar para mañana, qué está agotado y cuánto rinde cada corte."
        acciones={<><Link href="/cocina"><Boton tamano="chico">Pantalla de cocina</Boton></Link><Link href="/compras"><Boton tamano="chico">Compras</Boton></Link></>}
      >
        Carne y preparación
      </Titulo>

      {/* ── agotados ── */}
      <Seccion titulo={`Agotado ahora${agotados.length ? ` · ${agotados.length}` : ""}`} bajada="Lo que se marca acá deja de poder pedirse: el mozo lo ve tachado y en la carta del cliente sale como agotado.">
        <Caja className="px-3 py-2">
          {agotados.length === 0 && <p className="text-dim text-[13px] py-1">No hay nada agotado.</p>}
          {agotados.map((i) => (
            <div key={i.id} className="flex items-center justify-between gap-2 py-1.5 border-b border-line last:border-b-0">
              <span className="text-[13.5px]"><Marca tono="mal">Agotado</Marca> <span className="ml-1">{i.nombre}</span></span>
              <Accion tamano="chico" variante="principal" hacer={() => agotar(i, false)} haciendo="Volviendo…" listo="Disponible">Volvió a haber</Accion>
            </div>
          ))}
          <div className="pt-2">
            <input value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Buscar un plato para marcarlo agotado" aria-label="Buscar un plato para marcarlo agotado" className="campo" />
            {paraAgotar.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {paraAgotar.map((i) => (
                  <Accion key={i.id} tamano="chico" hacer={async () => { await agotar(i, true); setBuscar(""); }} haciendo="Marcando…" listo="Agotado">Se terminó: {i.nombre}</Accion>
                ))}
              </div>
            )}
          </div>
        </Caja>
      </Seccion>

      {/* ── mañana ── */}
      <Seccion titulo="¿Qué saco para mañana?" acciones={<Boton tamano="chico" onClick={() => window.print()}>Imprimir</Boton>}>
        {mise.error && <ErrorCarga error={mise.error} reintentar={mise.recargar} />}
        {!m && !mise.error && <Cargando />}
        {m && (
          <>
            {m.manana?.esperados == null ? (
              <Vacio>Todavía no hay historia suficiente para estimar cuánta gente viene mañana.</Vacio>
            ) : (
              <p className="text-[14px] leading-relaxed max-w-[64ch] mb-3">
                Mañana <b>{m.manana.dia} {fechaCorta(m.manana.fecha)}</b> se esperan <b className="text-negocio">{m.manana.esperados} personas</b>
                {m.manana.feriados.length > 0 && <> (es feriado en {m.manana.feriados.map((f) => (f.pais === "BR" ? "Brasil" : "Argentina")).join(" y ")})</>}
                {m.manana.reservados > 0 && <>; {m.manana.reservados} ya reservaron</>}. Con lo que pide la gente en promedio, hay que tener:
              </p>
            )}
            {m.porCorte.length > 0 && (
              <Caja className="px-3 mb-3">
                {m.porCorte.map((c) => (
                  <Fila key={c.id} fuerte que={c.nombre} nota={`${c.porciones} porciones · ${kg(c.kilosLimpios)} ya limpio`} cuanto={`${kg(c.kilosEnCrudo)} en crudo`} />
                ))}
              </Caja>
            )}
            {m.platos.length > 0 && (
              <details className="text-[13px]">
                <summary className="font-semibold text-dim">Ver plato por plato</summary>
                <Caja className="px-3 mt-2">
                  {m.platos.map((p) => (
                    <Fila key={p.id} que={p.nombre} nota={`${p.cadaCienPersonas} de cada 100 personas lo piden · porción de ${p.gramos} g`} cuanto={p.porciones != null ? `${p.porciones} porciones` : "—"} />
                  ))}
                </Caja>
              </details>
            )}
            <DeDondeSale>
              La gente esperada es un <b>supuesto</b>: sale del pronóstico del Tablero (promedio del mismo día de la semana, más feriados).
              Las porciones salen de lo que se vendió por persona en los últimos 30 días. Los kilos en crudo son los kilos limpios divididos
              por el rinde que se espera de cada corte.
            </DeDondeSale>
          </>
        )}
      </Seccion>

      {/* ── rinde ── */}
      <Seccion
        titulo="¿Cuánto rinde cada corte?"
        bajada="De cada kilo que se compra, cuánto llega al plato. Tocá un corte para ver la cuenta."
        acciones={
          <>
            <Opciones chico valor={dias} alElegir={setDias} opciones={[{ valor: 30, texto: "30 días" }, { valor: 90, texto: "90 días" }]} />
            <Boton tamano="chico" onClick={() => setCortesAbierto(true)}>Cortes y rinde esperado</Boton>
          </>
        }
      >
        {rinde.error && <ErrorCarga error={rinde.error} reintentar={rinde.recargar} />}
        {!rinde.datos && !rinde.error && <Cargando />}
        {rinde.datos && (
          <>
            {rinde.datos.cortes.length === 0 && <Vacio>No hay cortes cargados. Agregalos con «Cortes y rinde esperado».</Vacio>}
            {rinde.datos.cortes.length > 0 && (
              <Caja>
                {rinde.datos.cortes.map((c) => {
                  const mal = c.diferencia != null && c.diferencia < -2;
                  return (
                    <button key={c.id} onClick={() => setDetalle(c)} className="w-full text-left px-3 py-2 border-b border-line last:border-b-0 hover:bg-card-2">
                      <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                        <span className="font-semibold text-[13.5px]">{c.nombre}</span>
                        <span className="num text-[13.5px]">
                          {c.rindePct != null ? <b className={mal ? "text-loss" : ""}>{String(c.rindePct).replace(".", ",")} %</b> : <span className="text-faint">sin compras</span>}
                          <span className="text-faint"> · se espera {c.objetivoPct} %</span>
                        </span>
                      </span>
                      {c.rindePct != null && (
                        <span className="block relative h-1.5 rounded-full bg-card-2 mt-1.5">
                          <span className={`absolute left-0 top-0 h-1.5 rounded-full ${mal ? "bg-loss" : "bg-cocina"}`} style={{ width: `${Math.min(100, c.rindePct)}%` }} />
                          <span className="absolute top-[-3px] w-[2px] h-3 bg-ink" style={{ left: `${c.objetivoPct}%` }} />
                        </span>
                      )}
                      <span className="block text-faint text-[11.5px] mt-1">
                        Se compraron {kg(c.kilosComprados)} · llegaron al plato {kg(c.kilosServidos)}
                        {c.plataDeMas > 0 && <span className="text-loss"> · se fueron {pesos(c.plataDeMas)} de más</span>}
                      </span>
                    </button>
                  );
                })}
              </Caja>
            )}
            {rinde.datos.plataDeMas > 0 && (
              <p className="text-[13.5px] mt-3 max-w-[64ch]">
                En los últimos {dias} días, rendir por debajo de lo esperado costó <b className="text-loss">{pesos(rinde.datos.plataDeMas)}</b>.
              </p>
            )}
            {rinde.datos.platosSinCorte.length > 0 && <p className="text-[12.5px] text-warn mt-2">Falta cargar los gramos de la porción en: {rinde.datos.platosSinCorte.join(", ")}.</p>}
            <DeDondeSale>
              Kilos comprados: los renglones de Compras marcados con ese corte. Kilos al plato: porciones vendidas por los gramos de cada
              porción (se cargan en la Carta). <b>No descuenta lo que había en la cámara al empezar ni lo que quedó al terminar</b>: en 30 días
              se compensa bastante, en pocos días puede engañar.
            </DeDondeSale>
          </>
        )}
      </Seccion>

      {detalle && (
        <Hoja titulo={detalle.nombre} bajada={`Últimos ${dias} días`} cerrar={() => setDetalle(null)}>
          <Fila que="Kilos comprados" cuanto={kg(detalle.kilosComprados)} />
          <Fila que="Precio promedio del kilo" cuanto={pesos(detalle.precioKilo)} />
          <Fila que="Porciones vendidas" cuanto={detalle.porciones} />
          <Fila que="Kilos que llegaron al plato" cuanto={kg(detalle.kilosServidos)} />
          <Fila fuerte que="Rinde" cuanto={detalle.rindePct != null ? `${String(detalle.rindePct).replace(".", ",")} %` : "—"} />
          <Fila que="Rinde que se espera" cuanto={`${detalle.objetivoPct} %`} />
          <Fila que="Kilos de más que hubo que comprar" cuanto={kg(detalle.kilosDeMas)} tinta={detalle.kilosDeMas > 0 ? "text-loss" : ""} />
          <Fila fuerte que="En plata" cuanto={pesos(detalle.plataDeMas)} tinta={detalle.plataDeMas > 0 ? "text-loss" : ""} />
          <p className="text-[12.5px] text-dim mt-4 leading-relaxed">
            Si el rinde da por encima de lo esperado, lo más probable es que haya compras sin marcar con este corte, o que la porción cargada
            en la Carta sea más grande que la que sale.
          </p>
        </Hoja>
      )}

      {cortesAbierto && <Cortes cerrar={() => { setCortesAbierto(false); rinde.recargar(); mise.recargar(); }} />}
    </div>
  );
}

function Cortes({ cerrar }: { cerrar: () => void }) {
  const lista = useDatos<Corte[]>(() => api("/admin/carne/cortes"));
  const [nombre, setNombre] = useState("");
  const [rinde, setRinde] = useState(80);
  return (
    <Hoja titulo="Cortes y rinde esperado" bajada="El rinde esperado es qué parte de cada kilo comprado tiene que llegar al plato." cerrar={cerrar}>
      {!lista.datos && <Cargando />}
      {lista.datos?.map((c) => (
        <div key={c.id} className={`flex flex-wrap items-center justify-between gap-2 py-2 border-b border-line ${c.activo ? "" : "opacity-55"}`}>
          <span className="text-[13.5px] font-semibold flex-1 min-w-[120px]">{c.nombre}</span>
          <span className="flex items-center gap-1.5">
            <input
              type="number" min={1} max={100} defaultValue={Number(c.rinde_objetivo_pct)} aria-label={`Rinde esperado de ${c.nombre}`}
              className="campo num !w-20 text-right"
              onBlur={async (e) => { const v = Number(e.target.value); if (v && v !== Number(c.rinde_objetivo_pct)) { await api(`/admin/carne/cortes/${c.id}`, { method: "PUT", body: JSON.stringify({ rindeObjetivoPct: v }) }); lista.recargar(); } }}
            />
            <span className="text-dim text-[12.5px]">%</span>
            <Accion tamano="chico" variante="suave" haciendo="Guardando…" hacer={async () => { await api(`/admin/carne/cortes/${c.id}`, { method: "PUT", body: JSON.stringify({ activo: !c.activo }) }); await lista.recargar(); }}>
              {c.activo ? "Dejar de usar" : "Volver a usar"}
            </Accion>
          </span>
        </div>
      ))}
      <div className="flex flex-wrap items-end gap-2 mt-4">
        <Campo etiqueta="Corte nuevo" className="flex-1 min-w-[150px]"><input className="campo" value={nombre} onChange={(e) => setNombre(e.target.value)} /></Campo>
        <Campo etiqueta="Rinde esperado, en %"><input type="number" min={1} max={100} className="campo num !w-24" value={rinde} onChange={(e) => setRinde(Number(e.target.value))} /></Campo>
        <Accion variante="principal" haciendo="Agregando…" listo="Agregado" hacer={async () => { await api("/admin/carne/cortes", { method: "POST", body: JSON.stringify({ nombre, rindeObjetivoPct: rinde }) }); setNombre(""); await lista.recargar(); }}>
          Agregar
        </Accion>
      </div>
      <p className="text-[12px] text-faint mt-4 leading-relaxed">
        Para que el rinde se calcule: en la Carta, a cada plato de carne se le pone su corte y los gramos de la porción; y en Compras, a cada
        renglón de carne se le marca el corte y los kilos.
      </p>
    </Hoja>
  );
}
