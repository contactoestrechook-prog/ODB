"use client";

import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { NOMBRE_METODO, NOMBRE_MONEDA, haceCuanto, hora, pesos, plata, type Metodo, type Moneda } from "../lib/formato";
import { Accion, Boton, Caja, Cargando, DeDondeSale, ErrorCarga, Fila, Marca, Monto, Seccion, Titulo, Vacio, useDatos } from "../ui";
import { CobrarHoja, type Cuenta } from "../CobrarHoja";

type Abierta = Cuenta & { mesaNumero: number | null; sector: string | null; mozoNombre: string | null; minutos: number; pidioCuentaHaceMin: number | null };
type Cobrado = {
  fecha: string;
  totalArs: number;
  cobros: number;
  porMedio: { metodo: Metodo; moneda: Moneda; cobros: number; monto: number; montoArs: number }[];
  ultimos: { id: string; mesaNumero: number | null; metodo: Metodo; moneda: Moneda; monto: number; montoArs: number; creadoEn: string; cargadoPor: string | null }[];
};
type Cambio = { BRL: number | null; USD: number | null; actualizadoEn: string | null; pixModo: "terminal" | "api" };

export default function CajaPage() {
  const abiertas = useDatos<Abierta[]>(() => api("/admin/caja/abiertas"), 8000);
  const cobrado = useDatos<Cobrado>(() => api("/admin/caja/cobrado"), 15000);
  const cambio = useDatos<Cambio>(() => api("/monedas"));
  const [cobrando, setCobrando] = useState<{ mesaId: string; numero: number | null } | null>(null);
  const [verTodos, setVerTodos] = useState(false);

  // /caja?mesa=<id> abre directo la hoja de cobro (así llegan el mozo y el piso)
  useEffect(() => {
    const mesa = new URLSearchParams(window.location.search).get("mesa");
    const numero = new URLSearchParams(window.location.search).get("n");
    if (mesa) setCobrando({ mesaId: mesa, numero: numero ? Number(numero) : null });
  }, []);

  function recargar() {
    abiertas.recargar();
    cobrado.recargar();
  }

  const lista = abiertas.datos ?? [];
  const pidieron = lista.filter((a) => a.estado === "pidio_cuenta");
  const resto = lista.filter((a) => a.estado !== "pidio_cuenta");

  return (
    <div>
      <Titulo bajada="Cobrá cada mesa en pesos, reales o dólares. Lo cobrado queda separado por medio de pago para cerrar el día.">
        Caja
      </Titulo>

      <CambioDeLaCasa cambio={cambio.datos} alGuardar={() => { cambio.recargar(); abiertas.recargar(); }} />

      <Seccion
        titulo={`Mesas por cobrar${lista.length ? ` · ${lista.length}` : ""}`}
        bajada="Primero las que ya pidieron la cuenta. Tocá «Cobrar» para ver el detalle y anotar el pago."
        acciones={<Boton tamano="chico" onClick={recargar}>Actualizar</Boton>}
      >
        {abiertas.error && <ErrorCarga error={abiertas.error} reintentar={abiertas.recargar} />}
        {!abiertas.datos && !abiertas.error && <Cargando />}
        {abiertas.datos && lista.length === 0 && <Vacio>No hay mesas con consumo cargado.</Vacio>}
        {lista.length > 0 && (
          <Caja>
            {[...pidieron, ...resto].map((a) => (
              <div key={a.cicloId} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2 border-b border-line last:border-b-0">
                <div className="w-[74px] flex-none">
                  <p className="font-bold text-[14px] leading-tight">Mesa {a.mesaNumero}</p>
                  <p className="text-faint text-[11.5px] leading-tight">{a.sector ?? ""}</p>
                </div>
                <div className="flex-1 min-w-[150px]">
                  <p className="flex flex-wrap items-center gap-1.5 text-[12.5px]">
                    {a.estado === "pidio_cuenta" ? (
                      <Marca tono={(a.pidioCuentaHaceMin ?? 0) >= 8 ? "mal" : "ojo"}>Pidió la cuenta hace {a.pidioCuentaHaceMin ?? 0} min</Marca>
                    ) : (
                      <Marca>Todavía comiendo · {a.minutos} min</Marca>
                    )}
                    {a.preferido && <Marca tono="plata">Quiere pagar con {NOMBRE_METODO[a.preferido.metodo]}</Marca>}
                    {a.pagado > 0 && <Marca tono="bien">Ya pagó {pesos(a.pagado)}</Marca>}
                  </p>
                  <p className="text-faint text-[11.5px] mt-0.5">{a.mozoNombre ?? "Sin mozo"}{a.cubiertos ? ` · ${a.cubiertos} personas` : ""}</p>
                </div>
                <div className="text-right">
                  <p className="num font-bold text-[14px] leading-tight">{pesos(a.saldo)}</p>
                  <p className="num text-faint text-[11.5px] leading-tight">{plata(a.saldoEn.BRL, "BRL")} · {plata(a.saldoEn.USD, "USD")}</p>
                </div>
                <Boton variante="principal" onClick={() => setCobrando({ mesaId: a.mesaId, numero: a.mesaNumero })}>Cobrar</Boton>
              </div>
            ))}
          </Caja>
        )}
      </Seccion>

      <Seccion titulo="Cobrado hoy" bajada="Lo que tiene que haber al cerrar: en el cajón, en la terminal y en la cuenta.">
        {cobrado.error && <ErrorCarga error={cobrado.error} reintentar={cobrado.recargar} />}
        {!cobrado.datos && !cobrado.error && <Cargando />}
        {cobrado.datos && (
          <>
            <Caja className="px-3">
              {cobrado.datos.porMedio.length === 0 && <Vacio>Todavía no se cobró nada hoy.</Vacio>}
              {cobrado.datos.porMedio.map((g) => (
                <Fila
                  key={`${g.metodo}${g.moneda}`}
                  que={<>{NOMBRE_METODO[g.metodo]} · {NOMBRE_MONEDA[g.moneda].toLowerCase()}</>}
                  nota={`${g.cobros} ${g.cobros === 1 ? "cobro" : "cobros"}${g.moneda !== "ARS" ? ` · entraron ${plata(g.monto, g.moneda)}` : ""}`}
                  cuanto={pesos(g.montoArs)}
                />
              ))}
              {cobrado.datos.porMedio.length > 0 && <Fila fuerte que="Total del día, en pesos" cuanto={pesos(cobrado.datos.totalArs)} />}
            </Caja>
            <DeDondeSale>
              Cada cobro se guarda en la moneda en que entró y se pasa a pesos con el cambio de la casa de ese momento. Los reales y
              dólares en efectivo hay que contarlos aparte: el renglón dice cuántos entraron.
            </DeDondeSale>

            {cobrado.datos.ultimos.length > 0 && (
              <div className="mt-4">
                <p className="text-[11px] font-bold uppercase tracking-wide text-faint mb-1">Últimos cobros</p>
                <Caja className="px-3">
                  {(verTodos ? cobrado.datos.ultimos : cobrado.datos.ultimos.slice(0, 6)).map((p) => (
                    <div key={p.id} className="flex items-center justify-between gap-2 py-1.5 border-b border-line last:border-b-0 text-[13px]">
                      <span className="text-dim min-w-0 truncate">
                        <span className="num">{hora(p.creadoEn)}</span> · Mesa {p.mesaNumero ?? "—"} · {NOMBRE_METODO[p.metodo]}
                        {p.moneda !== "ARS" && <span className="text-faint"> · {plata(p.monto, p.moneda)}</span>}
                      </span>
                      <span className="flex items-center gap-2 flex-none">
                        <span className="num font-medium">{pesos(p.montoArs)}</span>
                        <Accion
                          tamano="chico" variante="suave" confirmar="¿Anular? Tocá de nuevo" haciendo="Anulando…"
                          hacer={async () => { await api(`/admin/pagos/${p.id}/anular`, { method: "POST" }); recargar(); }}
                        >
                          Anular
                        </Accion>
                      </span>
                    </div>
                  ))}
                </Caja>
                {cobrado.datos.ultimos.length > 6 && (
                  <Boton tamano="chico" variante="suave" className="mt-1.5" onClick={() => setVerTodos(!verTodos)}>
                    {verTodos ? "Ver menos" : `Ver los ${cobrado.datos.ultimos.length}`}
                  </Boton>
                )}
              </div>
            )}
          </>
        )}
      </Seccion>

      {cobrando && (
        <CobrarHoja
          mesaId={cobrando.mesaId}
          mesaNumero={cobrando.numero ?? lista.find((a) => a.mesaId === cobrando.mesaId)?.mesaNumero ?? null}
          cerrar={() => { setCobrando(null); recargar(); }}
          alCambiar={recargar}
        />
      )}
    </div>
  );
}

// El cambio de la casa: cuántos pesos vale un real y un dólar. Lo usan la
// carta del cliente, la cuenta en la mesa y cada cobro.
function CambioDeLaCasa({ cambio, alGuardar }: { cambio: Cambio | null; alGuardar: () => void }) {
  const [editando, setEditando] = useState(false);
  const [brl, setBrl] = useState<number | null>(null);
  const [usd, setUsd] = useState<number | null>(null);

  function abrir() {
    setBrl(cambio?.BRL ?? null);
    setUsd(cambio?.USD ?? null);
    setEditando(true);
  }
  async function guardar() {
    if (!brl || !usd) throw new Error("Poné los dos valores");
    await api("/admin/configuracion", { method: "PUT", body: JSON.stringify({ cambioBrl: brl, cambioUsd: usd }) });
    setEditando(false);
    alGuardar();
  }

  const viejo = cambio?.actualizadoEn ? Date.now() - new Date(cambio.actualizadoEn).getTime() > 20 * 3_600_000 : true;
  const falta = cambio && (!cambio.BRL || !cambio.USD);

  return (
    <Seccion titulo="Cambio de la casa" bajada="Lo que vale hoy un real y un dólar en este restaurante. Se carga una vez al abrir.">
      <Caja className="px-3 py-2.5">
        {!cambio ? (
          <Cargando />
        ) : editando ? (
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-[12px] font-semibold text-dim">1 real, en pesos</span>
              <Monto valor={brl} alCambiar={setBrl} decimales className="w-36" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[12px] font-semibold text-dim">1 dólar, en pesos</span>
              <Monto valor={usd} alCambiar={setUsd} decimales className="w-36" />
            </label>
            <Accion hacer={guardar} variante="principal" haciendo="Guardando…" listo="Guardado">Guardar el cambio</Accion>
            <Boton variante="suave" onClick={() => setEditando(false)}>Cancelar</Boton>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 text-[13.5px]">
              <span><span className="text-dim">1 real = </span><b className="num">{cambio.BRL ? pesos(cambio.BRL) : "sin cargar"}</b></span>
              <span><span className="text-dim">1 dólar = </span><b className="num">{cambio.USD ? pesos(cambio.USD) : "sin cargar"}</b></span>
              {falta ? <Marca tono="mal">Falta cargarlo</Marca> : viejo ? <Marca tono="ojo">Cargado {haceCuanto(cambio.actualizadoEn)}: revisalo</Marca> : <span className="text-faint text-[12px]">Cargado {haceCuanto(cambio.actualizadoEn)}</span>}
            </div>
            <Boton onClick={abrir}>Cambiar</Boton>
          </div>
        )}
      </Caja>
      <p className="text-[12px] text-faint mt-1.5">
        Pix: {cambio?.pixModo === "api" ? "con QR propio por mesa." : "se cobra en la terminal y se anota acá."}
      </p>
    </Seccion>
  );
}
