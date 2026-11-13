"use client";

import { useEffect, useState } from "react";
import { api } from "./lib/api";
import { NOMBRE_METODO, pesos } from "./lib/formato";
import { ETIQUETA_ESTADO, ETIQUETA_SIGUIENTE, conConsumo, siguienteEstado, type MesaPiso, type Mozo } from "./lib/piso";
import { Accion, Boton, Fila, Hoja, Marca, Opciones } from "./ui";
import { ComandaPicker } from "./mozo/ComandaPicker";
import { CobrarHoja, type Cuenta } from "./CobrarHoja";

type Derivador = { id: string; nombre: string; tipo: string; activo: boolean };

// Todo lo que se puede hacer con una mesa, en un solo lugar. Se abre tocando
// la mesa en el Piso vivo. Cada cosa tiene su botón; nada queda escondido.
export function MesaHoja({ mesa, mozos, cerrar, alCambiar }: {
  mesa: MesaPiso; mozos: Mozo[]; cerrar: () => void; alCambiar: () => Promise<void> | void;
}) {
  const [cubiertos, setCubiertos] = useState<number | null>(null);
  const [mozoId, setMozoId] = useState<string | null>(null);
  const [derivadorId, setDerivadorId] = useState<string>("");
  const [derivadores, setDerivadores] = useState<Derivador[]>([]);
  const [cuenta, setCuenta] = useState<Cuenta | null>(null);
  const [comanda, setComanda] = useState<"primera" | "sumar" | null>(null);
  const [cobrando, setCobrando] = useState(false);
  const [cambiandoMozo, setCambiandoMozo] = useState(false);

  const libre = mesa.estado === "libre";
  const sig = siguienteEstado(mesa.estado);
  const consumo = conConsumo(mesa.estado);

  useEffect(() => {
    if (libre) {
      api("/admin/derivadores").then((r) => setDerivadores(r.derivadores.filter((d: Derivador) => d.activo))).catch(() => {});
    } else if (consumo || mesa.estado === "pago") {
      api(`/admin/mesas/${mesa.mesaId}/cuenta`).then(setCuenta).catch(() => setCuenta(null));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mesa.mesaId, mesa.estado]);

  const post = (ruta: string, body: unknown = {}) => api(`/admin/mesas/${mesa.mesaId}/${ruta}`, { method: "POST", body: JSON.stringify(body) });

  async function sentar() {
    if (!cubiertos) throw new Error("Elegí cuántos son");
    await post("abrir", { cubiertos, mozoId: mozoId ?? undefined, derivadorId: derivadorId || null });
    await alCambiar();
    cerrar();
  }
  async function paso(ruta: string, cerrarDespues = false) {
    await post(ruta);
    await alCambiar();
    if (cerrarDespues) cerrar();
  }
  async function mandarComanda(items: { itemId: string; cantidad: number }[]) {
    await post("comanda", { items });
    setComanda(null);
    await alCambiar();
    api(`/admin/mesas/${mesa.mesaId}/cuenta`).then(setCuenta).catch(() => {});
  }

  if (comanda) {
    return <ComandaPicker mesaNumero={mesa.numero} sumando={comanda === "sumar"} onCerrar={() => setComanda(null)} onConfirmar={mandarComanda} />;
  }
  if (cobrando) {
    return <CobrarHoja mesaId={mesa.mesaId} mesaNumero={mesa.numero} cerrar={() => { setCobrando(false); alCambiar(); }} alCambiar={() => alCambiar()} />;
  }

  // ── mesa libre: sentar gente ──
  if (libre) {
    return (
      <Hoja
        titulo={`Mesa ${mesa.numero}`}
        bajada={`${mesa.sector ?? ""} · Libre`}
        cerrar={cerrar}
        pie={<Accion hacer={sentar} variante="principal" tamano="grande" ancho haciendo="Sentando…" listo="Sentados" disabled={!cubiertos}>Sentar {cubiertos ? `a ${cubiertos}` : ""}</Accion>}
      >
        <div className="flex flex-col gap-4">
          <div>
            <p className="text-[12px] font-semibold text-dim mb-1.5">¿Cuántos son?</p>
            <Opciones valor={cubiertos} alElegir={setCubiertos} opciones={[1, 2, 3, 4, 5, 6, 7, 8, 10, 12].map((n) => ({ valor: n, texto: String(n) }))} />
          </div>
          <div>
            <p className="text-[12px] font-semibold text-dim mb-1.5">¿Quién la atiende?</p>
            {mozos.length === 0 ? (
              <p className="text-[12.5px] text-dim">No hay mozos cargados. Se cargan en Configuración.</p>
            ) : (
              <Opciones valor={mozoId} alElegir={setMozoId} opciones={mozos.map((m) => ({ valor: m.id, texto: m.nombre }))} />
            )}
          </div>
          <div>
            <p className="text-[12px] font-semibold text-dim mb-1.5">¿Los mandó un hotel, un guía o una agencia?</p>
            <Opciones
              valor={derivadorId}
              alElegir={setDerivadorId}
              opciones={[{ valor: "", texto: "Nadie" }, ...derivadores.map((d) => ({ valor: d.id, texto: d.nombre }))]}
              chico
            />
            <p className="text-[11.5px] text-faint mt-1">Así queda anotado quién trajo la mesa y se calcula su comisión.</p>
          </div>
        </div>
      </Hoja>
    );
  }

  // ── mesa ocupada ──
  const tono = mesa.color === "rojo" ? "mal" : mesa.color === "amarillo" ? "ojo" : "bien";
  return (
    <Hoja
      titulo={`Mesa ${mesa.numero}`}
      bajada={`${mesa.sector ?? ""}${mesa.cubiertos ? ` · ${mesa.cubiertos} personas` : ""} · ${mesa.mozoNombre ?? "sin mozo"}`}
      cerrar={cerrar}
    >
      <div className="flex flex-wrap items-center gap-1.5 mb-3">
        <Marca tono={tono}>{ETIQUETA_ESTADO[mesa.estado]} · hace {mesa.minutosEnEstado} min</Marca>
        <Marca>Sentados hace {mesa.minutosTotal} min</Marca>
        {mesa.derivadorNombre && <Marca tono="puerta">Vino por {mesa.derivadorNombre}</Marca>}
        {mesa.pagoPreferido && <Marca tono="plata">Quiere pagar con {NOMBRE_METODO[mesa.pagoPreferido.metodo]}</Marca>}
      </div>

      {mesa.llamadoHaceMin != null && (
        <div className="rounded-lg border border-salon bg-salon/10 px-3 py-2 mb-3 flex flex-wrap items-center justify-between gap-2">
          <span className="text-[13px] font-semibold">Está llamando al mozo hace {mesa.llamadoHaceMin} min</span>
          <Accion hacer={() => paso("llamado-atendido")} tamano="chico" variante="principal" haciendo="Anotando…" listo="Atendido">Ya fui</Accion>
        </div>
      )}

      {/* el paso que sigue, grande */}
      <div className="flex flex-col gap-2 mb-4">
        {sig === "comanda_tomada" && <Boton variante="principal" tamano="grande" onClick={() => setComanda("primera")}>Tomar la comanda</Boton>}
        {sig === "pago" && <Boton variante="principal" tamano="grande" onClick={() => setCobrando(true)}>Cobrar la mesa</Boton>}
        {sig && sig !== "comanda_tomada" && sig !== "pago" && (
          <Accion hacer={() => paso("avanzar", sig === "libre")} variante="principal" tamano="grande" ancho haciendo="Anotando…" listo="Anotado">
            {ETIQUETA_SIGUIENTE[sig]}
          </Accion>
        )}
        <div className="grid grid-cols-2 gap-2">
          {consumo && <Boton onClick={() => setComanda("sumar")}>Sumar a la comanda</Boton>}
          {consumo && sig !== "pago" && <Boton onClick={() => setCobrando(true)}>Cobrar ahora</Boton>}
        </div>
      </div>

      {cuenta && cuenta.renglones.length > 0 && (
        <div className="mb-4">
          <p className="text-[11px] font-bold uppercase tracking-wide text-faint mb-1">Lo que pidieron</p>
          {cuenta.renglones.map((r) => (
            <Fila key={r.id} que={<>{r.cantidad} × {r.nombre}</>} cuanto={pesos(r.total)} />
          ))}
          <Fila fuerte que="Total" cuanto={pesos(cuenta.total)} />
          {cuenta.pagado > 0 && <Fila que="Ya cobrado" cuanto={pesos(cuenta.pagado)} tinta="text-good" />}
        </div>
      )}

      <p className="text-[11px] font-bold uppercase tracking-wide text-faint mb-1.5">Más</p>
      <div className="flex flex-wrap gap-1.5">
        <Boton tamano="chico" onClick={() => setCambiandoMozo(!cambiandoMozo)}>Cambiar de mozo</Boton>
        {mesa.estado !== "sentada" && mesa.estado !== "pago" && (
          <Accion hacer={() => paso("retroceder")} tamano="chico" confirmar="¿Deshacer? Tocá de nuevo" haciendo="Deshaciendo…" listo="Deshecho">
            Deshacer el último paso
          </Accion>
        )}
        {(mesa.estado === "sentada" || mesa.estado === "vio_carta") && (
          <Accion hacer={() => paso("cancelar", true)} tamano="chico" variante="peligro" confirmar="¿Anular la mesa? Tocá de nuevo" haciendo="Anulando…">
            Se sentó por error
          </Accion>
        )}
        {mesa.estado === "pago" && <Boton tamano="chico" onClick={() => setCobrando(true)}>Ver o corregir el cobro</Boton>}
      </div>
      {cambiandoMozo && (
        <div className="mt-2.5">
          <Opciones
            chico
            valor={mesa.mozoId}
            alElegir={async (id) => { await post("mozo", { mozoId: id }); setCambiandoMozo(false); await alCambiar(); }}
            opciones={mozos.map((m) => ({ valor: m.id, texto: m.nombre }))}
          />
        </div>
      )}
    </Hoja>
  );
}
