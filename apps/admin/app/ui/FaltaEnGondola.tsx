'use client';

import { useEffect, useState } from 'react';
import { Aviso, Boton, Entrada, Modal, unir } from './kit';
import { numero, pesos } from '../lib/formato';

// Falta en la góndola (Leandro, 19/11/2026: «el que arma el pedido tiene que
// poder modificar artículos por falta de stock»). Lo usan el armado
// (ArmadoPantalla) y la ventana de fiambrería (AvisoFiambreria).
//
// «TENGO PARECIDO» (Leandro y Jaqui, 20/11/2026): si no hay, el sistema sugiere
// lo que se parece y hay en la sucursal (misma góndola, con su precio y cuántos
// equivalen: 1 de 200 g → 2 de 100 g). El parecido NO entra al pedido: queda
// para consultarle al cliente por WhatsApp cuando se termina de armar.

/** Lo mínimo del renglón: qué producto, cuánto pide y cuánto ya está en el carro. */
export type RenglonFalta = { productoId: string; nombre: string; cantidad: number; enCarro: number; ubicacion: string | null; porPeso?: boolean };

/** Lo pesado en gramos o kilos (como lo lee fiambrería); lo demás, el número. */
export function cantidadDe(cantidad: number, porPeso?: boolean) {
  if (!porPeso) return numero(cantidad, 2);
  return cantidad < 1 ? `${Math.round(cantidad * 1000)} g` : `${numero(cantidad, 3)} kg`;
}
const redondo = (n: number) => Math.round(n * 1000) / 1000;

export type Reemplazo = {
  id: string; nombre: string; stock: number | null;
  precio?: number | null; porPeso?: boolean; cantidadSugerida?: number | null; yaEnElPedido?: boolean;
};

/** Lo que se parece al que falta (GET /api/salon?recurso=parecidos). */
export async function traerParecidos(pedidoId: string, productoId: string, faltan: number, fiambreria = false): Promise<Reemplazo[]> {
  const q = new URLSearchParams({ recurso: 'parecidos', pedidoId, productoId, faltan: String(faltan), ...(fiambreria ? { fiambreria: '1' } : {}) });
  const r = await fetch(`/api/salon?${q}`, { cache: 'no-store' });
  const d = r.ok ? await r.json().catch(() => []) : [];
  return Array.isArray(d) ? d : [];
}

export function FaltaEnGondola({ item, onCerrar, onListo, buscarParecidos, consultaQuienArma = false, conCliente = false, pedida = null }: {
  item: RenglonFalta;
  onCerrar: () => void;
  onListo: (d: { hay: number; reemplazo: Reemplazo | null; cantidad: number | null; variedades?: string[]; avisar?: boolean }) => Promise<void>;
  /**
   * El armado (no fiambrería): «¿hay de otro sabor?» y «avisarle al cliente»
   * (Leandro, 20/11/2026: «de qué manera se le puede avisar al cliente que no
   * hay ese sabor y cuáles sí»).
   */
  conCliente?: boolean;
  /** Lo que aclaró el cliente de ese renglón («limón»). */
  pedida?: string | null;
  /** Las sugerencias de «Tengo parecido» para lo que falta. */
  buscarParecidos?: (faltan: number) => Promise<Reemplazo[]>;
  /** Fiambrería: el parecido se lo consulta al cliente quien arma el pedido, no ella. */
  consultaQuienArma?: boolean;
}) {
  const entero = Number.isInteger(item.cantidad);
  const [hay, setHay] = useState(numero(item.enCarro, 3).replace(/\./g, ''));
  const [buscar, setBuscar] = useState('');
  const [opciones, setOpciones] = useState<Reemplazo[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [sugeridos, setSugeridos] = useState<Reemplazo[] | null>(null);
  const [verBuscar, setVerBuscar] = useState(false);
  const [reemplazo, setReemplazo] = useState<Reemplazo | null>(null);
  const [cant, setCant] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // las variedades que SÍ hay (lavanda, coco…) y si se le avisa al cliente que no hay
  const [variedades, setVariedades] = useState<string[]>([]);
  const [nuevaVariedad, setNuevaVariedad] = useState('');
  const [avisar, setAvisar] = useState(true);

  const nHay = Number(hay.replace(',', '.'));
  const hayValido = hay !== '' && Number.isFinite(nHay) && nHay >= 0 && nHay < item.cantidad - 1e-9;
  const resto = hayValido ? redondo(item.cantidad - nHay) : item.cantidad;
  const sugerida = reemplazo?.cantidadSugerida && reemplazo.cantidadSugerida > 0 ? reemplazo.cantidadSugerida : resto;
  const nCant = cant === '' ? sugerida : Number(cant.replace(',', '.'));
  const cantValida = !reemplazo || (Number.isFinite(nCant) && nCant > 0 && nCant <= 1000);

  // las sugerencias, según cuánto falta (1 de 200 g → 2 de 100 g)
  useEffect(() => {
    if (!buscarParecidos) { setSugeridos([]); return; }
    let vivo = true;
    const t = setTimeout(async () => {
      try { const d = await buscarParecidos(resto); if (vivo) setSugeridos(d); }
      catch { if (vivo) setSugeridos([]); }
    }, sugeridos === null ? 0 : 400);
    return () => { vivo = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resto, buscarParecidos]);

  // buscar otro (por nombre, SKU o código), con su stock en la sucursal
  useEffect(() => {
    const q = buscar.trim();
    if (q.length < 2 || reemplazo) { setOpciones([]); setBuscando(false); return; }
    let vivo = true;
    setBuscando(true);
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/salon?recurso=stock&q=${encodeURIComponent(q)}`, { cache: 'no-store' });
        const d = r.ok ? await r.json() : [];
        if (!vivo) return;
        setOpciones((Array.isArray(d) ? d : []).filter((x: any) => x.id !== item.productoId).slice(0, 8).map((x: any) => ({
          id: String(x.id),
          nombre: String(x.nombre),
          stock: Array.isArray(x.sucursales) && x.sucursales.length ? x.sucursales.reduce((s: number, y: any) => s + (Number(y.cantidad) || 0), 0) : null,
        })));
      } catch { if (vivo) setOpciones([]); }
      finally { if (vivo) setBuscando(false); }
    }, 300);
    return () => { vivo = false; clearTimeout(t); };
  }, [buscar, reemplazo, item.productoId]);

  // la variedad solo cuando no hay nada de lo que pidió y no se eligió un parecido
  const conVariedades = conCliente && !reemplazo && hayValido && nHay === 0 && variedades.length > 0;
  const avisarAlCliente = conCliente && !reemplazo && hayValido && nHay === 0 && !variedades.length && avisar;
  const sumarVariedad = () => {
    const v = nuevaVariedad.trim();
    if (v && !variedades.some((x) => x.toLowerCase() === v.toLowerCase())) setVariedades((xs) => [...xs, v].slice(0, 8));
    setNuevaVariedad('');
  };

  async function guardar() {
    setGuardando(true);
    setError(null);
    try {
      await onListo({
        hay: nHay, reemplazo, cantidad: reemplazo ? nCant : null,
        ...(conVariedades ? { variedades } : {}), ...(avisarAlCliente ? { avisar: true } : {}),
      });
    }
    catch (e: any) { setError(String(e?.message ?? 'No se pudo cambiar el pedido')); setGuardando(false); }
  }

  const elegir = (o: Reemplazo) => { setReemplazo(o); setCant(''); };
  const textoBoton = reemplazo ? 'Guardar el parecido'
    : conVariedades ? 'Guardar para preguntarle'
      : nHay === 0 ? (avisarAlCliente ? 'Sacar y avisarle' : 'Sacar del pedido') : `Dejar ${cantidadDe(nHay, item.porPeso)}`;
  const fila = (o: Reemplazo, sugerido: boolean) => (
    <li key={o.id}>
      <button type="button" onClick={() => elegir(o)} className="flex w-full items-center gap-2 px-3 py-2.5 text-left active:bg-crema-claro">
        <span className="min-w-0 flex-1">
          <span className="block text-sm text-tinta">{o.nombre}</span>
          {sugerido && (
            <span className="mt-0.5 block text-xs text-tinta/60">
              {o.precio != null && <>{pesos(o.precio)}{o.porPeso ? ' el kg' : ''}</>}
              {o.cantidadSugerida && o.cantidadSugerida !== resto ? ` · ${o.porPeso ? cantidadDe(o.cantidadSugerida, true) : `van ${numero(o.cantidadSugerida, 2)}`} por ${cantidadDe(resto, item.porPeso)}` : ''}
              {o.yaEnElPedido ? ' · ya está en el pedido' : ''}
            </span>
          )}
        </span>
        {o.stock != null && <span className={unir('importe shrink-0 text-xs', o.stock > 0 ? 'text-tinta/60' : 'text-marca')}>{o.stock > 0 ? `hay ${numero(o.stock, 2)}` : 'sin stock'}</span>}
      </button>
    </li>
  );

  return (
    <Modal abierto onCerrar={onCerrar} ancho="chico" titulo={`No hay: ${item.nombre}`}
      descripcion={`Pide ${cantidadDe(item.cantidad, item.porPeso)}${item.ubicacion ? ` · ${item.ubicacion}` : ''}`}
      pie={<>
        <Boton variante="secundario" onClick={onCerrar}>Cancelar</Boton>
        <Boton onClick={guardar} cargando={guardando} disabled={!hayValido || !cantValida}>{textoBoton}</Boton>
      </>}>
      <p className="mb-2 text-sm text-tinta/70">¿Cuánto hay en la góndola? <span className="text-tinta/50">{item.porPeso ? '(en kilos: 0,1 son 100 g · 0 si no hay nada)' : '(0 si no hay nada)'}</span></p>
      <div className="flex items-center gap-3">
        {entero && <Boton variante="secundario" onClick={() => setHay(String(Math.max(0, (Number.isFinite(nHay) ? nHay : 0) - 1)))} aria-label="Uno menos">−</Boton>}
        <Entrada inputMode="decimal" value={hay} onChange={(e) => setHay(e.target.value.replace(/[^\d.,]/g, ''))} aria-label="Cuánto hay en la góndola" className="importe flex-1 text-center text-2xl font-bold" />
        {entero && <Boton variante="secundario" onClick={() => setHay(String(Math.min(item.cantidad - 1, (Number.isFinite(nHay) ? nHay : 0) + 1)))} aria-label="Uno más">+</Boton>}
      </div>
      {!hayValido && hay !== '' && <Aviso tono="atencion" className="mt-3">Tiene que ser menos de {cantidadDe(item.cantidad, item.porPeso)}. Si hay todo, no falta nada.</Aviso>}

      {/* NO HAY ESE SABOR; DE ESE HAY ESTOS (20/11/2026) */}
      {conCliente && !reemplazo && hayValido && nHay === 0 && (
        <div className="mt-5 border-t border-black/[0.06] pt-4">
          <p className="mb-2 text-sm font-semibold text-tinta">
            ¿Hay de otro sabor, fragancia o color?{pedida ? <span className="font-normal text-tinta/60"> (pidió {pedida})</span> : null}
          </p>
          {variedades.length > 0 && (
            <ul className="mb-2 flex flex-wrap gap-2">
              {variedades.map((v) => (
                <li key={v} className="flex items-center gap-1 rounded-full bg-ok-suave px-3 py-1 text-sm font-semibold text-tinta">
                  {v}
                  <button type="button" onClick={() => setVariedades((xs) => xs.filter((x) => x !== v))} aria-label={`Sacar ${v}`} className="grid size-6 place-items-center rounded-full text-tinta/60 hover:bg-black/5">×</button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-center gap-2">
            <Entrada value={nuevaVariedad} onChange={(e) => setNuevaVariedad(e.target.value)} aria-label="Otra variedad que hay"
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); sumarVariedad(); } }} className="flex-1" />
            <Boton tamano="chico" variante="secundario" onClick={sumarVariedad} disabled={!nuevaVariedad.trim()}>Sumar</Boton>
          </div>
          <p className="mt-2 text-xs text-tinta/70">
            {variedades.length
              ? <>Al cliente le llega «{pedida ? `de ${pedida} ` : ''}no hay. De ese tenemos: {variedades.join(', ')}. ¿Cuál querés?» cuando tocás <b className="font-semibold">Consultar al cliente</b>. Lo que elija te aparece acá.</>
              : 'Escribí cada una y tocá Sumar. Si no hay ninguna, dejalo vacío.'}
          </p>
          {!variedades.length && (
            <label className="mt-3 flex items-center gap-2 text-sm text-tinta">
              <input type="checkbox" checked={avisar} onChange={(e) => setAvisar(e.target.checked)} className="size-5 accent-marca" />
              Avisarle al cliente por WhatsApp que no hay
            </label>
          )}
        </div>
      )}

      <div className={unir('mt-5 border-t border-black/[0.06] pt-4', variedades.length > 0 && 'hidden')}>
        <p className="mb-2 text-sm font-semibold text-tinta">¿Tenés algo parecido? <span className="font-normal text-tinta/50">(si no, dejalo vacío)</span></p>
        {reemplazo ? (
          <div className="rounded-xl bg-ok-suave/70 p-3">
            <div className="flex items-start gap-2">
              <p className="min-w-0 flex-1 text-sm font-semibold text-tinta">{reemplazo.nombre}</p>
              <Boton tamano="chico" variante="fantasma" onClick={() => { setReemplazo(null); setCant(''); }}>Cambiar</Boton>
            </div>
            <label className="mt-2 flex items-center gap-2 text-sm text-tinta/70">
              {reemplazo.porPeso ? 'Kilos' : 'Cantidad'}
              <Entrada inputMode="decimal" value={cant === '' ? numero(sugerida, 3).replace(/\./g, '') : cant} onChange={(e) => setCant(e.target.value.replace(/[^\d.,]/g, ''))}
                aria-label={`Cantidad de ${reemplazo.nombre}`} className="importe w-24 text-center font-bold" />
              {reemplazo.precio != null && cantValida && <span className="importe text-tinta/60">{pesos(nCant * reemplazo.precio)}</span>}
            </label>
            {!cantValida && <Aviso tono="atencion" className="mt-2">Poné una cantidad mayor que 0.</Aviso>}
            {reemplazo.porPeso && cantValida && <p className="mt-1 text-xs text-tinta/60">Son {cantidadDe(nCant, true)}.</p>}
            <p className="mt-2 text-xs text-tinta/70">
              {consultaQuienArma
                ? <>No entra al pedido todavía: quien arma el pedido se lo consulta al cliente por WhatsApp.</>
                : <>No entra al pedido todavía: cuando termines, tocá <b className="font-semibold">Consultar al cliente</b> y le llega por WhatsApp para que diga sí o no.</>}
            </p>
          </div>
        ) : (
          <>
            {sugeridos === null && <p className="text-xs text-tinta/50">Buscando parecidos…</p>}
            {sugeridos && sugeridos.length > 0 && (
              <ul className="max-h-60 divide-y divide-black/[0.06] overflow-y-auto rounded-xl border border-black/[0.06]">
                {sugeridos.map((o) => fila(o, true))}
              </ul>
            )}
            {sugeridos && !sugeridos.length && !verBuscar && <p className="text-xs text-tinta/60">No encontré nada parecido con stock en la sucursal.</p>}
            {!verBuscar ? (
              <Boton tamano="chico" variante="fantasma" className="mt-2" onClick={() => setVerBuscar(true)}>Buscar otro producto</Boton>
            ) : (
              <div className="mt-3">
                <Entrada autoFocus value={buscar} onChange={(e) => setBuscar(e.target.value)} aria-label="Buscar el producto que va en su lugar, por nombre o código" />
                {buscando && <p className="mt-2 text-xs text-tinta/50">Buscando…</p>}
                {!buscando && buscar.trim().length >= 2 && !opciones.length && <p className="mt-2 text-xs text-tinta/60">No encontré nada con «{buscar.trim()}».</p>}
                {opciones.length > 0 && (
                  <ul className="mt-2 max-h-56 divide-y divide-black/[0.06] overflow-y-auto rounded-xl border border-black/[0.06]">
                    {opciones.map((o) => fila(o, false))}
                  </ul>
                )}
              </div>
            )}
          </>
        )}
      </div>
      {!reemplazo && <p className="mt-4 text-xs text-tinta/60">El total del pedido se corrige solo. Si el cliente ya pagó, te aviso para que se lo digas a la caja.</p>}
      {error && <Aviso tono="error" className="mt-3">{error}</Aviso>}
    </Modal>
  );
}
