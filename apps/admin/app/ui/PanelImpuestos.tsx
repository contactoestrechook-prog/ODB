'use client';
// Impuestos de la factura de compra: el pie leído, si cierra con el total, y
// los arreglos de un click (sacar ✕, agregar por %, "lo que falta", ↺ deshacer).
// La lógica está en app/lib/pie-factura.ts, con tests.
import { useState } from 'react';
import { diagnosticarPie, faltantesHabituales, montoPorPct, sumaPie, NOMBRE_CAMPO, type CampoPie, type Habituales } from '../lib/pie-factura';
import { Boton, CLASES_ENTRADA, FOCO, IconoAtencion, IconoCerrar, IconoInfo, IconoOk, unir } from './kit';
import { pesos } from '../lib/formato';

// ícono chico en línea con el texto (en lugar de ⚠ ✓ 💡)
const ICONO_LINEA = 'mr-1 inline size-4 shrink-0 align-[-3px]';
// chip de un toque: 36 px (44 de zona táctil en el celular)
const CHIP = 'relative inline-flex min-h-9 items-center rounded-full border px-3 text-xs transition-colors before:absolute before:inset-x-0 before:-inset-y-1 sm:min-h-8 sm:before:hidden';
const numImp = (v: any) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

export function PanelImpuestos({ fotoImp, setFotoImp, habituales, sumaRenglones }: {
  fotoImp: any;
  setFotoImp: (f: (x: any) => any) => void;
  habituales: Habituales;
  /** suma de cantidad × precio de los renglones de mercadería (para compararla con el neto) */
  sumaRenglones: number;
}) {
  const [impDeshacer, setImpDeshacer] = useState<any[]>([]);
  const [impAMano, setImpAMano] = useState(false);
  // "+ monto": el campo que se está cargando en pesos, en línea
  const [cargando, setCargando] = useState<string | null>(null);
  const netoDoc = fotoImp?.neto != null && fotoImp.neto !== '' ? numImp(fotoImp.neto) : null;
  const totalDoc = fotoImp?.total != null && fotoImp.total !== '' ? numImp(fotoImp.total) : null;
  const descuentoGlobalDoc = Math.abs(numImp(fotoImp?.descuentoGlobal));

  const pie = {
    neto: fotoImp?.neto ?? null, iva: fotoImp?.iva ?? null, percepcionIva: fotoImp?.percepcionIva ?? null,
    percepcionIibb: fotoImp?.percepcionIibb ?? null, impuestosInternos: fotoImp?.impuestosInternos ?? null,
    otros: fotoImp?.otros ?? null, descuentoGlobal: fotoImp?.descuentoGlobal ?? null, total: fotoImp?.total ?? null,
  };
  
  const diag = diagnosticarPie(pie, habituales);
  const avisos = diag.cierra ? faltantesHabituales(pie, habituales) : [];
  const fijar = (campo: string, monto: number | null) => {
    setImpDeshacer((h) => [...h.slice(-19), { ...fotoImp }]);
    setFotoImp((x: any) => ({ ...x, [campo]: monto }));
  };
  const pctTxt = (v: number) => `${(Math.round(v * 100) / 100).toString().replace('.', ',')}%`;
  const deNeto = (v: number) => (netoDoc && netoDoc > 0 ? pctTxt(v / netoDoc * 100) : '');
  const campos: [CampoPie, number[]][] = [
    ['iva', [21, 10.5, 27]],
    ['percepcionIva', [1, 1.5, 3, 5]],
    ['percepcionIibb', [1.5, 2, 3, 3.5, 5]],
    ['impuestosInternos', []],
    ['otros', []],
  ];
  const faltaPlata = diag.diferencia != null && diag.diferencia < 0 ? -diag.diferencia : 0;
  const sumaEsperada = (netoDoc ?? 0) + descuentoGlobalDoc;
  const renglonesDif = netoDoc != null && netoDoc > 0 && sumaRenglones > 0 ? sumaRenglones - sumaEsperada : null;
  return (
    <div className={'min-w-0 rounded-2xl border-2 bg-white p-3 text-xs sm:p-4 ' + (diag.cierra ? 'border-ok/40' : 'border-marca')}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-tinta">Impuestos de la factura</p>
        <span className="flex flex-wrap items-center gap-1">
          {impDeshacer.length > 0 && (
            <button type="button" onClick={() => { setFotoImp(() => impDeshacer[impDeshacer.length - 1]); setImpDeshacer((h) => h.slice(0, -1)); }}
              className={unir('inline-flex min-h-9 items-center rounded-full px-2 text-xs font-semibold text-tinta/70 underline hover:text-marca-hondo', FOCO)}>Deshacer</button>
          )}
          <button type="button" onClick={() => setImpAMano((v) => !v)} className={unir('inline-flex min-h-9 items-center rounded-full px-2 text-xs text-tinta/70 underline hover:text-marca-hondo', FOCO)}>
            {impAMano ? 'Ocultar montos' : 'Editar montos a mano'}
          </button>
        </span>
      </div>

      {/* el control que importa: neto + impuestos = total */}
      {diag.diferencia == null ? (
        <p className="mt-1 font-semibold text-marca-hondo"><IconoAtencion className={ICONO_LINEA} />Falta el neto o el total del pie: cargalos en “Editar montos a mano”.</p>
      ) : diag.cierra ? (
        <p className="mt-1 text-ok"><IconoOk className={ICONO_LINEA} /><b>Cierra:</b> neto {pesos(netoDoc ?? 0)} + impuestos {deNeto(sumaPie(pie) - (netoDoc ?? 0))} = total {pesos(totalDoc ?? 0)}, igual que el papel.</p>
      ) : (
        <p className="mt-1 font-semibold text-marca-hondo">
          <IconoAtencion className={ICONO_LINEA} />No cierra con el total del papel: {diag.diferencia < 0 ? `faltan ${pesos(-diag.diferencia)}` : `sobran ${pesos(diag.diferencia)}`} ({deNeto(Math.abs(diag.diferencia))} del neto).
        </p>
      )}

      {/* arreglos exactos, un click */}
      {diag.arreglos.length > 0 && (
        <div className="mt-2 flex flex-col gap-1.5">
          {diag.arreglos.map((a, k) => (
            <p key={k} className="flex flex-wrap items-center gap-2 text-tinta">
              <Boton tamano="chico" variante={k === 0 ? 'primario' : 'secundario'} onClick={() => fijar(a.campo, a.monto === 0 ? null : a.monto)}>
                {a.accion === 'quitar' ? `Quitar ${NOMBRE_CAMPO[a.campo]}` : `${a.accion === 'agregar' ? 'Agregar' : 'Corregir'} ${NOMBRE_CAMPO[a.campo]} ${pesos(a.monto)}${a.pct ? ` (${pctTxt(a.pct)})` : ''}`}
              </Boton>
              <span className="text-tinta/70">{a.motivo}</span>
            </p>
          ))}
        </div>
      )}
      {avisos.map((a) => (
        <p key={a.campo} className="mt-1 text-atencion">
          <IconoInfo className={ICONO_LINEA} />Este proveedor suele cobrar <b>{NOMBRE_CAMPO[a.campo]} {pctTxt(a.pct)}</b> y esta factura no la trae. Si el papel la tiene, agregala abajo con un click.
        </p>
      ))}

      {/* cada impuesto: pastilla con ✕ si está, botones de % si no */}
      <div className="mt-2 flex flex-col gap-1.5">
        {campos.map(([campo, pcts]) => {
          const v = numImp(fotoImp?.[campo]);
          const habitual = habituales && campo !== 'iva' && campo !== 'otros' ? Number((habituales as any)[campo] ?? 0) : 0;
          const opciones = [...new Set([...(habitual >= 0.5 ? [habitual] : []), ...pcts])];
          return (
            <div key={campo} className="flex flex-wrap items-center gap-1.5">
              <span className="w-32 shrink-0 text-tinta/70">{NOMBRE_CAMPO[campo]}</span>
              {v > 0 ? (
                <span className="inline-flex min-h-8 items-center gap-1.5 rounded-full bg-tinta py-0.5 pl-3 pr-1 text-crema">
                  <b className="importe">{pesos(v)}</b>{netoDoc ? <span className="text-crema/70">{deNeto(v)}</span> : null}
                  <button type="button" title={`Sacar ${NOMBRE_CAMPO[campo]}`} aria-label={`Sacar ${NOMBRE_CAMPO[campo]}`} onClick={() => fijar(campo, null)}
                    className="relative grid size-6 place-items-center rounded-full bg-white/15 transition-colors before:absolute before:-inset-2.5 hover:bg-marca focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"><IconoCerrar className="size-3.5" /></button>
                </span>
              ) : (
                <>
                  {netoDoc != null && netoDoc > 0 && opciones.map((p) => (
                    <button key={p} type="button" onClick={() => fijar(campo, montoPorPct(netoDoc, p))}
                      className={unir(CHIP, FOCO, 'hover:border-marca hover:text-marca-hondo', p === habitual ? 'border-atencion bg-atencion-suave font-semibold text-atencion' : 'border-black/15 bg-white text-tinta/70')}>
                      + {pctTxt(p)}{p === habitual ? ' (habitual)' : ''}
                    </button>
                  ))}
                  {cargando === campo ? (
                    <input
                      autoFocus type="number" placeholder="$ monto" aria-label={`${NOMBRE_CAMPO[campo]} en pesos`}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') setCargando(null);
                        if (e.key !== 'Enter') return;
                        const v = Number((e.target as HTMLInputElement).value.replace(',', '.'));
                        if (v > 0) fijar(campo, Math.round(v * 100) / 100);
                        setCargando(null);
                      }}
                      onBlur={() => setCargando(null)}
                      className="min-h-9 w-28 rounded-full border border-tinta bg-white px-3 text-right text-xs text-tinta outline-none focus:ring-4 focus:ring-marca/15 sm:min-h-8"
                    />
                  ) : (
                    <button type="button" onClick={() => setCargando(campo)}
                      className={unir(CHIP, FOCO, 'border-black/15 bg-white text-tinta/70 hover:border-marca hover:text-marca-hondo')}>
                      + monto
                    </button>
                  )}
                  {faltaPlata > 0 && (
                    <button type="button" onClick={() => fijar(campo, Math.round(faltaPlata * 100) / 100)}
                      className={unir(CHIP, FOCO, 'border-dashed border-marca bg-white text-marca-hondo hover:bg-marca-suave')}>
                      + lo que falta {pesos(faltaPlata)}
                    </button>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>

      {/* los renglones contra el neto: si no dan, el costo de TODOS queda mal */}
      {renglonesDif != null && Math.abs(renglonesDif) > Math.max(1, sumaEsperada * 0.005) && (
        <p className="mt-2 rounded-xl bg-atencion-suave px-3 py-2 text-atencion">
          <IconoAtencion className={ICONO_LINEA} />Los renglones suman {pesos(sumaRenglones)} y el neto del papel es {pesos(netoDoc ?? 0)}
          {renglonesDif < 0 ? ` (faltan ${pesos(-renglonesDif)}: hay renglones que no se leyeron, o una hoja que no se subió)` : ` (sobran ${pesos(renglonesDif)}: algún renglón se leyó con el IVA adentro o con la cantidad mal)`}.
          {' '}Revisá los renglones contra el papel: los impuestos están bien, pero el costo de cada producto sale de esta suma.
        </p>
      )}

      {impAMano && (
        <div className="mt-2 grid grid-cols-2 gap-2 border-t border-black/[0.06] pt-2 sm:grid-cols-4">
          {[['neto', 'Neto'], ['iva', 'IVA $'], ['percepcionIva', 'Perc. IVA'], ['percepcionIibb', 'Perc. IIBB'], ['impuestosInternos', 'Imp. internos'], ['descuentoGlobal', 'Desc. del pie'], ['otros', 'Otros'], ['total', 'TOTAL']].map(([k, l]) => (
            <label key={k} className="flex min-w-0 flex-col gap-1">
              <span className="font-medium text-tinta/70">{l}</span>
              <input type="number" value={fotoImp?.[k] ?? ''} onChange={(e) => setFotoImp((x: any) => ({ ...x, [k]: e.target.value === '' ? null : Number(e.target.value) }))} className={unir(CLASES_ENTRADA, 'importe text-right')} />
            </label>
          ))}
        </div>
      )}
      <p className="mt-2 text-xs text-tinta/60">
        Se leen solos del pie del papel. Los impuestos internos <b>siempre</b> son costo; las percepciones (IVA e IIBB) son pago a cuenta y van al costo si está tildado “Percepciones al costo”.
      </p>
    </div>
  );
}
