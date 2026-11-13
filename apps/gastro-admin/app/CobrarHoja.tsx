"use client";

import { useEffect, useState } from "react";
import { api } from "./lib/api";
import { METODOS, NOMBRE_METODO, NOMBRE_MONEDA, plata, pesos, hora, type Metodo, type Moneda } from "./lib/formato";
import { Accion, Boton, Cargando, Fila, Hoja, Marca, Monto, Opciones } from "./ui";

export type Cuenta = {
  cicloId: string;
  mesaId: string;
  estado: string;
  cubiertos: number | null;
  renglones: { id: string; nombre: string; cantidad: number; precioUnitario: number; total: number }[];
  total: number;
  totalEn: Record<Moneda, number | null>;
  pagado: number;
  saldo: number;
  saldoEn: Record<Moneda, number | null>;
  pagada: boolean;
  preferido: { metodo: Metodo; moneda: Moneda } | null;
  pagos: { id: string; metodo: Metodo; moneda: Moneda; monto: number; montoArs: number; creadoEn: string; cargadoPor: string | null }[];
  cambio: { BRL: number | null; USD: number | null; actualizadoEn: string | null; pixModo: "terminal" | "api" };
};

// Con qué moneda se puede cobrar cada medio. Pix siempre es en reales (el
// brasileño paga desde su banco); QR y tarjeta, en pesos; el efectivo, en las tres.
const MONEDAS_DE: Record<Metodo, Moneda[]> = { pix: ["BRL"], qr: ["ARS"], tarjeta: ["ARS"], efectivo: ["ARS", "BRL", "USD"] };

// La hoja de cobro de una mesa. Se abre desde Caja, desde el Piso vivo y
// desde la cola del mozo: es siempre la misma.
export function CobrarHoja({ mesaId, mesaNumero, cerrar, alCambiar }: {
  mesaId: string; mesaNumero: number | null; cerrar: () => void; alCambiar?: () => void;
}) {
  const [cuenta, setCuenta] = useState<Cuenta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [metodo, setMetodo] = useState<Metodo>("tarjeta");
  const [moneda, setMoneda] = useState<Moneda>("ARS");
  const [partes, setPartes] = useState(1);
  const [monto, setMonto] = useState<number | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  async function cargar(primera = false) {
    try {
      const c: Cuenta = await api(`/admin/mesas/${mesaId}/cuenta`);
      setCuenta(c);
      if (primera && c.preferido) {
        setMetodo(c.preferido.metodo);
        setMoneda(MONEDAS_DE[c.preferido.metodo].includes(c.preferido.moneda) ? c.preferido.moneda : MONEDAS_DE[c.preferido.metodo][0]);
      }
    } catch (e: any) {
      setError(e.message);
    }
  }
  useEffect(() => { cargar(true); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [mesaId]);

  // el monto sugerido: lo que falta, en la moneda elegida, dividido en partes
  const faltaEnMoneda = cuenta ? cuenta.saldoEn[moneda] : null;
  useEffect(() => {
    if (faltaEnMoneda == null) return setMonto(null);
    const parte = faltaEnMoneda / partes;
    setMonto(moneda === "ARS" ? Math.round(parte) : Math.round(parte * 100) / 100);
  }, [faltaEnMoneda, partes, moneda]);

  function elegirMetodo(m: Metodo) {
    setMetodo(m);
    if (!MONEDAS_DE[m].includes(moneda)) setMoneda(MONEDAS_DE[m][0]);
  }

  async function cobrar() {
    if (!monto) throw new Error("Poné el monto cobrado");
    const r = await api(`/admin/mesas/${mesaId}/cobrar`, { method: "POST", body: JSON.stringify({ metodo, moneda, monto }) });
    setCuenta(r.cuenta);
    setPartes(1);
    setAviso(r.vuelto > 0 ? `Dar vuelto: ${pesos(r.vuelto)}` : null);
    alCambiar?.();
  }

  async function anular(id: string) {
    await api(`/admin/pagos/${id}/anular`, { method: "POST" });
    setAviso(null);
    await cargar();
    alCambiar?.();
  }

  async function liberar() {
    await api(`/admin/mesas/${mesaId}/avanzar`, { method: "POST", body: "{}" });
    alCambiar?.();
    cerrar();
  }

  const titulo = `Cobrar la mesa ${mesaNumero ?? ""}`;
  if (error) return <Hoja titulo={titulo} cerrar={cerrar}><p className="text-loss text-[13px]">■ {error}</p></Hoja>;
  if (!cuenta) return <Hoja titulo={titulo} cerrar={cerrar}><Cargando /></Hoja>;

  const sinCambio = moneda !== "ARS" && !cuenta.cambio[moneda];

  return (
    <Hoja
      titulo={titulo}
      bajada={cuenta.cubiertos ? `${cuenta.cubiertos} personas` : undefined}
      cerrar={cerrar}
      pie={
        cuenta.pagada || cuenta.estado === "pago" ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-good font-semibold text-[13.5px]">● Cuenta pagada{aviso ? ` · ${aviso}` : ""}</span>
            <Accion key="liberar" hacer={liberar} variante="principal" haciendo="Liberando…" listo="Mesa libre">Liberar la mesa</Accion>
          </div>
        ) : (
          <div>
            {metodo === "pix" && cuenta.cambio.pixModo === "terminal" && (
              <p className="text-[12px] text-dim mb-2">Pix se cobra en la terminal. Cuando el cliente pagó, tocá el botón para dejarlo anotado.</p>
            )}
            {sinCambio ? (
              <p className="text-loss text-[12.5px]">■ Falta cargar el cambio de hoy para {NOMBRE_MONEDA[moneda].toLowerCase()} (en Caja, arriba).</p>
            ) : (
              <Accion key="cobrar" hacer={cobrar} variante="principal" tamano="grande" ancho haciendo="Anotando el cobro…" listo="Cobro anotado" disabled={!monto}>
                Anotar {monto ? plata(monto, moneda) : ""} · {NOMBRE_METODO[metodo]}
              </Accion>
            )}
          </div>
        )
      }
    >
      <div className="mb-4">
        {cuenta.renglones.length === 0 && <p className="text-dim text-[13px]">Esta mesa todavía no tiene nada cargado.</p>}
        {cuenta.renglones.map((r) => (
          <Fila key={r.id} que={<>{r.cantidad} × {r.nombre}</>} cuanto={pesos(r.total)} />
        ))}
        <Fila fuerte que="Total" cuanto={pesos(cuenta.total)} />
        <div className="flex justify-end gap-3 pt-1.5 text-[12.5px] text-dim num">
          <span>{plata(cuenta.totalEn.BRL, "BRL")}</span>
          <span>{plata(cuenta.totalEn.USD, "USD")}</span>
        </div>
      </div>

      {cuenta.pagos.length > 0 && (
        <div className="mb-4">
          <p className="text-[11px] font-bold uppercase tracking-wide text-faint mb-1">Ya cobrado</p>
          {cuenta.pagos.map((p) => (
            <div key={p.id} className="flex items-center justify-between gap-2 py-1.5 border-b border-line text-[13px]">
              <span className="text-dim">
                {NOMBRE_METODO[p.metodo]} · {hora(p.creadoEn)}
                {p.moneda !== "ARS" && <span className="text-faint"> · {plata(p.monto, p.moneda)}</span>}
              </span>
              <span className="flex items-center gap-2">
                <span className="num font-medium">{pesos(p.montoArs)}</span>
                <Accion hacer={() => anular(p.id)} tamano="chico" variante="suave" confirmar="¿Anular? Tocá de nuevo" haciendo="Anulando…">Anular</Accion>
              </span>
            </div>
          ))}
          <Fila fuerte que="Falta cobrar" cuanto={pesos(cuenta.saldo)} tinta={cuenta.saldo > 0 ? "text-loss" : "text-good"} />
        </div>
      )}

      {!cuenta.pagada && cuenta.estado !== "pago" && cuenta.renglones.length > 0 && (
        <div className="flex flex-col gap-3.5">
          {cuenta.preferido && (
            <p className="text-[12.5px]">
              <Marca tono="plata">El cliente pidió pagar con {NOMBRE_METODO[cuenta.preferido.metodo]}</Marca>
            </p>
          )}
          <div>
            <p className="text-[12px] font-semibold text-dim mb-1.5">¿Cómo paga?</p>
            <Opciones valor={metodo} alElegir={elegirMetodo} opciones={METODOS.map((m) => ({ valor: m, texto: NOMBRE_METODO[m] }))} />
          </div>
          {MONEDAS_DE[metodo].length > 1 && (
            <div>
              <p className="text-[12px] font-semibold text-dim mb-1.5">¿En qué moneda?</p>
              <Opciones valor={moneda} alElegir={setMoneda} opciones={MONEDAS_DE[metodo].map((m) => ({ valor: m, texto: NOMBRE_MONEDA[m] }))} />
            </div>
          )}
          <div>
            <p className="text-[12px] font-semibold text-dim mb-1.5">¿Dividen la cuenta?</p>
            <Opciones
              chico
              valor={partes}
              alElegir={setPartes}
              opciones={[1, 2, 3, 4, 5, 6].map((n) => ({ valor: n, texto: n === 1 ? "No, paga uno" : `Entre ${n}` }))}
            />
            {partes > 1 && <p className="text-[12px] text-faint mt-1">Se anota una parte por vez. Repetí el cobro por cada persona.</p>}
          </div>
          <div>
            <p className="text-[12px] font-semibold text-dim mb-1.5">Monto de este cobro, en {NOMBRE_MONEDA[moneda].toLowerCase()}</p>
            <div className="flex flex-wrap items-center gap-2">
              <Monto
                valor={monto}
                alCambiar={setMonto}
                decimales={moneda !== "ARS"}
                prefijo={moneda === "ARS" ? "$" : moneda === "BRL" ? "R$" : "US$"}
                className="w-44"
                aria-label="Monto"
              />
              {faltaEnMoneda != null && <Boton tamano="chico" onClick={() => { setPartes(1); setMonto(faltaEnMoneda); }}>Todo lo que falta</Boton>}
            </div>
            {moneda !== "ARS" && cuenta.cambio[moneda] && (
              <p className="text-[12px] text-faint mt-1.5">
                Cambio de la casa: 1 {moneda === "BRL" ? "real" : "dólar"} = {pesos(cuenta.cambio[moneda])}
                {monto ? ` · este cobro son ${pesos(monto * (cuenta.cambio[moneda] ?? 0))}` : ""}
              </p>
            )}
          </div>
        </div>
      )}
    </Hoja>
  );
}
