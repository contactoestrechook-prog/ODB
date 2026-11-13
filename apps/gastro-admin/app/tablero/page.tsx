"use client";

import Link from "next/link";
import { useState } from "react";
import { api } from "../lib/api";
import { NOMBRE_METODO, NOMBRE_MONEDA, fechaCorta, fechaLarga, pesos, plata, type Metodo, type Moneda } from "../lib/formato";
import { Accion, Boton, Caja, Campo, Cargando, DeDondeSale, ErrorCarga, Fila, Hoja, Marca, Opciones, Seccion, Titulo, Vacio, useDatos } from "../ui";

type Metricas = {
  ciclosCerrados: number; tiempoMesaProm: number | null; tiempoMuertoProm: number | null; ticketProm: number | null;
  ingresoTotal: number; cubiertosTotal: number; revPash: number | null; tasaSatisfaccion: number | null;
};
type Ayer = { fecha: string; metricas: Metricas; insight: string };
type Wa = { fecha: string; mensaje: string; whatsappDueno: string | null; waLink: string | null };
type MozoFila = { id: string; nombre: string; activo: boolean; mesas: number; cubiertos: number; ventas: number; ticketPorCubierto: number | null; atencionMin: number | null; tiempoMesaMin: number | null; tasaPostre: number | null };
type Mozos = { dias: number; mozos: MozoFila[]; salon: { mesas: number; ticketPorCubierto: number | null; atencionMin: number | null; tasaPostre: number | null } };
type Clase = "estrella" | "vende_deja_poco" | "deja_vende_poco" | "ni_vende_ni_deja" | "sin_costo";
type Plato = { id: string; nombre: string; categoria: string; precio: number; costo: number | null; unidades: number; ingreso: number; margenUnidad: number | null; margenPct: number | null; margenTotal: number | null; clase: Clase; consejo: string };
type Menu = { dias: number; platos: Plato[]; vara: { pisoUnidades: number; margenMedio: number }; total: { ingreso: number; margen: number; sinCosto: number } };
type DiaPron = { fecha: string; dia: string; base: number | null; semanas: number; feriados: { pais: string; nombre: string }[]; esperados: number | null; reservados: number; clima: { maxima: number; lluviaPct: number } | null };
type Pronostico = { dias: DiaPron[]; factorFeriado: number; hayClima: boolean };
type Cobros = { dias: number; totalArs: number; cobros: number; porMedio: { metodo: Metodo; moneda: Moneda; cobros: number; monto: number; montoArs: number; partePct: number }[] };
type Feriado = { id: string; fecha: string; pais: "AR" | "BR"; nombre: string };

const CLASE: Record<Clase, { texto: string; tono: "bien" | "ojo" | "negocio" | "mal" | "gris" }> = {
  estrella: { texto: "Se vende y deja", tono: "bien" },
  vende_deja_poco: { texto: "Se vende, deja poco", tono: "ojo" },
  deja_vende_poco: { texto: "Deja, se vende poco", tono: "negocio" },
  ni_vende_ni_deja: { texto: "Ni se vende ni deja", tono: "mal" },
  sin_costo: { texto: "Falta el costo", tono: "gris" },
};
const PERIODOS = [{ valor: 7, texto: "7 días" }, { valor: 30, texto: "30 días" }, { valor: 90, texto: "90 días" }];

// El tablero del dueño está escrito como un informe: una pregunta por sección,
// los números adentro de la explicación y, plegado, de dónde sale cada uno.
export default function TableroPage() {
  const [dias, setDias] = useState(30);
  const ayer = useDatos<Ayer>(() => api("/admin/analista/resumen"));
  const wa = useDatos<Wa>(() => api("/admin/tablero/resumen-whatsapp"));
  const cobros = useDatos<Cobros>(() => api(`/admin/tablero/cobros?dias=${dias}`), undefined, [dias]);
  const mozos = useDatos<Mozos>(() => api(`/admin/tablero/mozos?dias=${dias}`), undefined, [dias]);
  const menu = useDatos<Menu>(() => api(`/admin/tablero/menu?dias=${dias}`), undefined, [dias]);
  const pron = useDatos<Pronostico>(() => api("/admin/tablero/pronostico"));
  const [plato, setPlato] = useState<Plato | null>(null);
  const [verFeriados, setVerFeriados] = useState(false);
  const [verMensaje, setVerMensaje] = useState(false);
  const [numero, setNumero] = useState("");
  const [claseFiltro, setClaseFiltro] = useState<Clase | "todas">("todas");

  const m = ayer.datos?.metricas;
  const platos = (menu.datos?.platos ?? []).filter((p) => claseFiltro === "todas" || p.clase === claseFiltro);

  return (
    <div className="max-w-3xl">
      <Titulo
        bajada="Cómo anduvo el restaurante, explicado. Cada sección contesta una pregunta."
        acciones={
          <>
            <span className="text-[12px] text-dim">Mirar los últimos</span>
            <Opciones chico valor={dias} alElegir={setDias} opciones={PERIODOS} />
            <Boton tamano="chico" onClick={() => window.print()}>Imprimir</Boton>
          </>
        }
      >
        Tablero del dueño
      </Titulo>

      {/* ── 1. ayer ── */}
      <Seccion
        titulo="¿Cómo fue ayer?"
        acciones={
          <>
            {wa.datos?.waLink ? (
              <a href={wa.datos.waLink} target="_blank" rel="noreferrer"><Boton tamano="chico" variante="principal">Mandármelo por WhatsApp</Boton></a>
            ) : (
              <Boton tamano="chico" variante="principal" onClick={() => setVerMensaje(true)}>Mandármelo por WhatsApp</Boton>
            )}
            <Boton tamano="chico" onClick={() => setVerMensaje(!verMensaje)}>{verMensaje ? "Ocultar el mensaje" : "Ver el mensaje"}</Boton>
          </>
        }
      >
        {ayer.error && <ErrorCarga error={ayer.error} reintentar={ayer.recargar} />}
        {!ayer.datos && !ayer.error && <Cargando />}
        {m && ayer.datos && (
          <>
            <p className="text-[14px] leading-relaxed max-w-[64ch] mb-3">
              El <b>{fechaLarga(ayer.datos.fecha)}</b> se atendieron <b>{m.ciclosCerrados} mesas</b> ({m.cubiertosTotal} personas) y entraron{" "}
              <b>{pesos(m.ingresoTotal)}</b>. Cada mesa dejó en promedio <b>{pesos(m.ticketProm)}</b> y estuvo ocupada{" "}
              <b>{m.tiempoMesaProm ?? "—"} minutos</b>
              {m.tiempoMuertoProm != null && <>, de los cuales <b>{m.tiempoMuertoProm} fueron tiempo muerto</b> (ya habían pagado y la mesa seguía sin liberarse)</>}.
            </p>
            <Caja className="px-3">
              <Fila que="Lo que rindió cada asiento por hora" nota="Es el número que junta ocupación, rotación y ticket" cuanto={pesos(m.revPash)} fuerte />
              <Fila que="Clientes contentos" nota="De los que opinaron desde la mesa" cuanto={m.tasaSatisfaccion != null ? `${m.tasaSatisfaccion} %` : "nadie opinó"} />
            </Caja>
            {ayer.datos.insight && <p className="text-[13.5px] leading-relaxed max-w-[64ch] mt-3"><Marca tono="negocio">Para hoy</Marca> {ayer.datos.insight}</p>}
            <DeDondeSale>
              Sale del reloj de cada mesa (la hora en que se sentó, pagó y se liberó) y de lo cobrado. «Lo que rindió cada asiento por
              hora» es lo que entró dividido por los asientos del salón y las horas de servicio, que se cargan en{" "}
              <Link href="/configuracion" className="underline">Configuración</Link>.
            </DeDondeSale>
          </>
        )}
        {verMensaje && wa.datos && (
          <Caja className="p-3 mt-3">
            <pre className="whitespace-pre-wrap text-[12.5px] font-[inherit] leading-relaxed mb-3">{wa.datos.mensaje}</pre>
            {wa.datos.whatsappDueno ? (
              <p className="text-[12px] text-dim">Se manda al {wa.datos.whatsappDueno}. <button className="underline" onClick={() => setNumero(wa.datos!.whatsappDueno!)}>Cambiar el número</button></p>
            ) : (
              <p className="text-[12px] text-dim mb-2">Falta cargar tu WhatsApp para mandarlo con un toque.</p>
            )}
            {(!wa.datos.whatsappDueno || numero) && (
              <div className="flex flex-wrap items-end gap-2 mt-2">
                <Campo etiqueta="Tu WhatsApp, con código de país"><input className="campo num !w-52" inputMode="tel" value={numero} onChange={(e) => setNumero(e.target.value)} /></Campo>
                <Accion haciendo="Guardando…" listo="Guardado" hacer={async () => { await api("/admin/configuracion", { method: "PUT", body: JSON.stringify({ whatsappDueno: numero }) }); setNumero(""); await wa.recargar(); }}>
                  Guardar el número
                </Accion>
              </div>
            )}
            <div className="flex gap-1.5 mt-3">
              <Boton tamano="chico" onClick={() => navigator.clipboard.writeText(wa.datos!.mensaje)}>Copiar el mensaje</Boton>
              {wa.datos.waLink && <a href={wa.datos.waLink} target="_blank" rel="noreferrer"><Boton tamano="chico" variante="principal">Abrir WhatsApp</Boton></a>}
            </div>
          </Caja>
        )}
      </Seccion>

      {/* ── 2. por dónde entra la plata ── */}
      <Seccion titulo="¿Por dónde entra la plata?" bajada={`Lo cobrado en los últimos ${dias} días, por medio de pago y moneda.`} acciones={<Link href="/caja"><Boton tamano="chico">Ir a Caja</Boton></Link>}>
        {cobros.error && <ErrorCarga error={cobros.error} reintentar={cobros.recargar} />}
        {!cobros.datos && !cobros.error && <Cargando />}
        {cobros.datos && (
          <>
            {cobros.datos.porMedio.length === 0 && <Vacio>Todavía no hay cobros anotados en el período.</Vacio>}
            {cobros.datos.porMedio.length > 0 && (
              <Caja className="px-3">
                {cobros.datos.porMedio.map((g) => (
                  <div key={`${g.metodo}${g.moneda}`} className="py-[7px] border-b border-line last:border-b-0">
                    <div className="flex items-baseline justify-between gap-4 text-[13.5px]">
                      <span className="text-dim">{NOMBRE_METODO[g.metodo]} · {NOMBRE_MONEDA[g.moneda].toLowerCase()} <span className="text-faint text-[11.5px]">· {g.cobros} cobros{g.moneda !== "ARS" ? ` · ${plata(g.monto, g.moneda)}` : ""}</span></span>
                      <span className="num font-medium whitespace-nowrap">{pesos(g.montoArs)} <span className="text-faint">· {g.partePct} %</span></span>
                    </div>
                    <div className="h-1 rounded-full bg-card-2 mt-1"><div className="h-1 rounded-full bg-plata" style={{ width: `${g.partePct}%` }} /></div>
                  </div>
                ))}
                <Fila fuerte que="Total cobrado, en pesos" cuanto={pesos(cobros.datos.totalArs)} />
              </Caja>
            )}
            <DeDondeSale>Suma los cobros anotados en Caja. Lo que entró en reales o dólares está pasado a pesos con el cambio de la casa del día en que se cobró.</DeDondeSale>
          </>
        )}
      </Seccion>

      {/* ── 3. mozos ── */}
      <Seccion titulo="¿Cómo trabaja cada mozo?" bajada={`Últimos ${dias} días. Mirá sobre todo el postre y la demora en tomar la comanda: son las dos cosas que más cambian de uno a otro.`}>
        {mozos.error && <ErrorCarga error={mozos.error} reintentar={mozos.recargar} />}
        {!mozos.datos && !mozos.error && <Cargando />}
        {mozos.datos && (
          <>
            <div className="overflow-x-auto rounded-lg border border-line bg-card">
              <table className="w-full text-[13px] min-w-[560px]">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-faint">
                    <th className="font-semibold px-3 py-2">Mozo</th>
                    <th className="font-semibold px-2 py-2 text-right">Mesas</th>
                    <th className="font-semibold px-2 py-2 text-right">Vendió</th>
                    <th className="font-semibold px-2 py-2 text-right">Por persona</th>
                    <th className="font-semibold px-2 py-2 text-right">Tarda en la comanda</th>
                    <th className="font-semibold px-3 py-2 text-right">Vende postre</th>
                  </tr>
                </thead>
                <tbody>
                  {mozos.datos.mozos.map((z) => {
                    const s = mozos.datos!.salon;
                    const lento = z.atencionMin != null && s.atencionMin != null && z.atencionMin > s.atencionMin * 1.25;
                    const pocoPostre = z.tasaPostre != null && s.tasaPostre != null && z.tasaPostre < s.tasaPostre * 0.7;
                    return (
                      <tr key={z.id} className="border-t border-line">
                        <td className="px-3 py-2 font-semibold">{z.nombre}{!z.activo && <span className="text-faint font-normal"> · inactivo</span>}</td>
                        <td className="px-2 py-2 text-right num">{z.mesas}</td>
                        <td className="px-2 py-2 text-right num">{pesos(z.ventas)}</td>
                        <td className="px-2 py-2 text-right num">{pesos(z.ticketPorCubierto)}</td>
                        <td className={`px-2 py-2 text-right num ${lento ? "text-loss font-bold" : ""}`}>{z.atencionMin != null ? `${z.atencionMin} min` : "—"}</td>
                        <td className={`px-3 py-2 text-right num ${pocoPostre ? "text-loss font-bold" : ""}`}>{z.tasaPostre != null ? `${z.tasaPostre} %` : "—"}</td>
                      </tr>
                    );
                  })}
                  <tr className="border-t border-line bg-card-2 text-dim">
                    <td className="px-3 py-2">Todo el salón</td>
                    <td className="px-2 py-2 text-right num">{mozos.datos.salon.mesas}</td>
                    <td />
                    <td className="px-2 py-2 text-right num">{pesos(mozos.datos.salon.ticketPorCubierto)}</td>
                    <td className="px-2 py-2 text-right num">{mozos.datos.salon.atencionMin != null ? `${mozos.datos.salon.atencionMin} min` : "—"}</td>
                    <td className="px-3 py-2 text-right num">{mozos.datos.salon.tasaPostre != null ? `${mozos.datos.salon.tasaPostre} %` : "—"}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <DeDondeSale>
              «Tarda en la comanda» es el tiempo entre que la mesa se sienta y se carga su comanda. «Vende postre» es la parte de sus mesas
              que pidió algo de la categoría Postres. En rojo, lo que está bastante peor que el promedio del salón.
            </DeDondeSale>
          </>
        )}
      </Seccion>

      {/* ── 4. la carta ── */}
      <Seccion titulo="¿Qué deja cada plato?" bajada={`Lo vendido en los últimos ${dias} días, ordenado por la ganancia que dejó. Tocá un plato para ver la cuenta.`} acciones={<Link href="/carta"><Boton tamano="chico">Ir a la Carta</Boton></Link>}>
        {menu.error && <ErrorCarga error={menu.error} reintentar={menu.recargar} />}
        {!menu.datos && !menu.error && <Cargando />}
        {menu.datos && (
          <>
            <div className="mb-2">
              <Opciones
                chico
                valor={claseFiltro}
                alElegir={setClaseFiltro}
                opciones={[{ valor: "todas" as const, texto: "Todos" }, ...(Object.keys(CLASE) as Clase[]).map((c) => ({ valor: c, texto: `${CLASE[c].texto} · ${menu.datos!.platos.filter((p) => p.clase === c).length}` }))]}
              />
            </div>
            <Caja>
              {platos.length === 0 && <div className="px-3"><Vacio>No hay platos en ese grupo.</Vacio></div>}
              {platos.map((p) => (
                <button key={p.id} onClick={() => setPlato(p)} className="w-full flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 border-b border-line last:border-b-0 text-left hover:bg-card-2">
                  <span className="flex-1 min-w-[150px]">
                    <span className="block font-semibold text-[13.5px]">{p.nombre}</span>
                    <span className="block text-faint text-[11.5px]">{p.categoria} · {p.unidades} vendidos</span>
                  </span>
                  <Marca tono={CLASE[p.clase].tono}>{CLASE[p.clase].texto}</Marca>
                  <span className="text-right w-[118px]">
                    <span className="block num font-bold text-[13.5px]">{p.margenTotal != null ? pesos(p.margenTotal) : "—"}</span>
                    <span className="block text-faint text-[11.5px]">{p.margenPct != null ? `deja ${p.margenPct} % de cada uno` : "sin costo cargado"}</span>
                  </span>
                </button>
              ))}
            </Caja>
            {menu.datos.total.sinCosto > 0 && <p className="text-[12.5px] text-warn mt-2">A {menu.datos.total.sinCosto} platos les falta el costo: sin eso no se sabe qué dejan.</p>}
            <DeDondeSale>
              Ganancia = (precio − costo) × unidades vendidas. Un plato «se vende» si llegó a {menu.datos.vara.pisoUnidades} unidades
              (el 70 % de lo que le tocaría si todos se vendieran igual) y «deja» si gana más que {pesos(menu.datos.vara.margenMedio)} por
              unidad, que es el promedio de lo vendido. El costo de cada plato se carga en la Carta.
            </DeDondeSale>
          </>
        )}
      </Seccion>

      {/* ── 5. pronóstico ── */}
      <Seccion
        titulo="¿Cuánta gente viene esta semana?"
        bajada="Lo esperado por día, para armar los turnos y la compra."
        acciones={<><Boton tamano="chico" onClick={() => setVerFeriados(true)}>Feriados</Boton><Link href="/carne"><Boton tamano="chico">Qué preparar mañana</Boton></Link></>}
      >
        {pron.error && <ErrorCarga error={pron.error} reintentar={pron.recargar} />}
        {!pron.datos && !pron.error && <Cargando />}
        {pron.datos && (
          <>
            <Caja>
              {pron.datos.dias.map((d, i) => (
                <div key={d.fecha} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 border-b border-line last:border-b-0">
                  <span className="w-[112px] flex-none text-[13.5px]"><b className="mayus">{i === 0 ? "Hoy" : i === 1 ? "Mañana" : d.dia}</b> <span className="num text-faint">{fechaCorta(d.fecha)}</span></span>
                  <span className="flex-1 min-w-[140px] flex flex-wrap items-center gap-1.5">
                    {d.feriados.map((f) => <Marca key={f.pais + f.nombre} tono="negocio">Feriado en {f.pais === "BR" ? "Brasil" : "Argentina"}: {f.nombre}</Marca>)}
                    {d.reservados > 0 && <Marca tono="puerta">{d.reservados} ya reservaron</Marca>}
                    {d.clima && <span className="text-faint text-[11.5px]">{d.clima.maxima}° · lluvia {d.clima.lluviaPct} %</span>}
                  </span>
                  <span className="text-right">
                    <span className="num font-bold text-[14px] text-negocio">{d.esperados ?? "—"}</span>
                    <span className="text-faint text-[11.5px]"> personas</span>
                  </span>
                </div>
              ))}
            </Caja>
            <DeDondeSale>
              Es un <b>supuesto</b> (por eso va en otro color): el promedio de personas de ese día de la semana en las últimas seis semanas.
              Si es feriado en Argentina o en Brasil se multiplica por {String(pron.datos.factorFeriado).replace(".", ",")}. Las reservas y el clima se
              muestran al lado para que decidas vos: no cambian la cuenta.{!pron.datos.hayClima && " Hoy no se pudo consultar el clima."}
            </DeDondeSale>
          </>
        )}
      </Seccion>

      {plato && (
        <Hoja titulo={plato.nombre} bajada={`${plato.categoria} · últimos ${dias} días`} cerrar={() => setPlato(null)} pie={<Link href="/carta"><Boton variante="principal">Cambiar precio o costo en la Carta</Boton></Link>}>
          <p className="mb-3"><Marca tono={CLASE[plato.clase].tono}>{CLASE[plato.clase].texto}</Marca></p>
          <p className="text-[13.5px] leading-relaxed mb-4">{plato.consejo}</p>
          <Fila que="Precio en la carta" cuanto={pesos(plato.precio)} />
          <Fila que="Costo del plato" cuanto={plato.costo != null ? pesos(plato.costo) : "sin cargar"} />
          <Fila que="Deja por cada uno" cuanto={plato.margenUnidad != null ? `${pesos(plato.margenUnidad)} · ${plato.margenPct} %` : "—"} />
          <Fila que="Vendidos" cuanto={plato.unidades} />
          <Fila que="Entró por este plato" cuanto={pesos(plato.ingreso)} />
          <Fila fuerte que="Ganancia que dejó" cuanto={plato.margenTotal != null ? pesos(plato.margenTotal) : "—"} />
        </Hoja>
      )}

      {verFeriados && <Feriados cerrar={() => { setVerFeriados(false); pron.recargar(); }} />}
    </div>
  );
}

function Feriados({ cerrar }: { cerrar: () => void }) {
  const lista = useDatos<Feriado[]>(() => api("/admin/tablero/feriados"));
  const [fecha, setFecha] = useState("");
  const [pais, setPais] = useState<"AR" | "BR">("BR");
  const [nombre, setNombre] = useState("");
  return (
    <Hoja titulo="Feriados" bajada="Los de Argentina y los de Brasil suben el pronóstico. Los que cambian de fecha (Carnaval, Semana Santa, puentes) se cargan acá." cerrar={cerrar}>
      <div className="flex flex-col gap-2.5 mb-5">
        <div className="grid grid-cols-2 gap-2.5">
          <Campo etiqueta="Fecha"><input type="date" className="campo" value={fecha} onChange={(e) => setFecha(e.target.value)} /></Campo>
          <div>
            <p className="text-[12px] font-semibold text-dim mb-1">País</p>
            <Opciones valor={pais} alElegir={setPais} opciones={[{ valor: "BR" as const, texto: "Brasil" }, { valor: "AR" as const, texto: "Argentina" }]} />
          </div>
        </div>
        <Campo etiqueta="Nombre del feriado"><input className="campo" value={nombre} onChange={(e) => setNombre(e.target.value)} /></Campo>
        <Accion variante="principal" haciendo="Agregando…" listo="Agregado" hacer={async () => { await api("/admin/tablero/feriados", { method: "POST", body: JSON.stringify({ fecha, pais, nombre }) }); setNombre(""); setFecha(""); await lista.recargar(); }}>
          Agregar el feriado
        </Accion>
      </div>
      <p className="text-[11px] font-bold uppercase tracking-wide text-faint mb-1">Los que vienen</p>
      {!lista.datos && <Cargando />}
      {lista.datos?.length === 0 && <Vacio>No hay feriados cargados.</Vacio>}
      {lista.datos?.map((f) => (
        <div key={f.id} className="flex items-center justify-between gap-2 py-1.5 border-b border-line text-[13px]">
          <span><span className="num">{fechaCorta(f.fecha)}/{f.fecha.slice(0, 4)}</span> · {f.pais === "BR" ? "Brasil" : "Argentina"} · {f.nombre}</span>
          <Accion tamano="chico" variante="suave" confirmar="¿Quitar? Tocá de nuevo" haciendo="Quitando…" hacer={async () => { await api(`/admin/tablero/feriados/${f.id}`, { method: "DELETE" }); await lista.recargar(); }}>Quitar</Accion>
        </div>
      ))}
    </Hoja>
  );
}
