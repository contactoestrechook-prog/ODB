'use client';

// CAJA DEL DUEÑO (25/11/2026). Leandro, con la captura del Excel de Juan Pablo:
// «armala lo más parecida a su Excel así sigue la misma línea».
//
// La hoja, como en el Excel:
//  · arriba, los cuadros de ingresos por origen (OTROS, REPARTO, CAJA ST THOMAS…),
//    cada uno con Fecha · Motivo · Monto, bordes de planilla y su Total;
//  · abajo a la izquierda, TOTAL INGRESOS y TOTAL EGRESOS en rojo y el Total en
//    amarillo; debajo, el cuadro de egresos.
// Se anota como en la planilla: el último renglón de cada cuadro está vacío para
// escribir (Enter guarda). Tocando un renglón se corrige o se borra.

import { useCallback, useMemo, useState, type KeyboardEvent } from 'react';
import { Aviso, Boton, Chips, Entrada, useConfirmar, unir } from './kit';

type Cuadro = { id: string; nombre: string; orden: number };
type Movimiento = { id: string; tipo: 'ingreso' | 'egreso'; cuadroId: string | null; fecha: string; motivo: string; monto: number };
export type Hoja = {
  periodo: { desde: string | null; hasta: string | null };
  cuadros: Cuadro[];
  movimientos: Movimiento[];
  porCuadro: Record<string, number>;
  saldoAnterior: number;
  totalIngresos: number;
  totalEgresos: number;
  total: number;
};
type Periodo = 'todo' | 'mes' | 'semana' | 'fechas';

const EGRESOS = '__egresos__';
const RENGLONES_MINIMOS = 5; // como la planilla: el cuadro no se ve vacío aunque tenga un solo renglón
const AMARILLO = 'bg-[#FFFF00]';

/** $ 10.511.300,00, como en el Excel. */
const plata = (n: number) => `$ ${Number(n ?? 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** 6/11/2026, como en el Excel. */
const fechaHoja = (f: string) => {
  const [a, m, d] = f.split('-').map(Number);
  return a && m && d ? `${d}/${m}/${a}` : f;
};

const hoy = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });

/** «10.511.300», «10.511.300,00», «$ 686.000», «4000000», «1500,50» → número. */
export function leerMonto(texto: string): number | null {
  let t = String(texto ?? '').replace(/[$\s]/g, '');
  if (!t) return null;
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

function rangoDe(p: Periodo, desde: string, hasta: string): { desde?: string; hasta?: string } {
  const h = hoy();
  if (p === 'mes') return { desde: `${h.slice(0, 7)}-01` };
  if (p === 'semana') {
    const d = new Date(`${h}T12:00:00Z`);
    const lunes = new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86_400_000);
    return { desde: lunes.toISOString().slice(0, 10) };
  }
  if (p === 'fechas') return { desde: desde || undefined, hasta: hasta || undefined };
  return {};
}

async function pedir(body: Record<string, unknown>) {
  const r = await fetch('/api/caja-dueno', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(Array.isArray(d?.message) ? d.message.join(' ') : d?.message ?? 'No se pudo guardar.');
  return d;
}

export function CajaDueno({ inicial }: { inicial: Hoja }) {
  const [hoja, setHoja] = useState<Hoja>(inicial);
  const [periodo, setPeriodo] = useState<Periodo>('todo');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { confirmar, pedirTexto, dialogo } = useConfirmar();

  const traer = useCallback(async (p: Periodo, d: string, h: string) => {
    const rango = rangoDe(p, d, h);
    const qs = new URLSearchParams(Object.entries(rango).filter(([, v]) => v) as [string, string][]);
    try {
      const r = await fetch(`/api/caja-dueno${qs.size ? `?${qs}` : ''}`, { cache: 'no-store' });
      const datos = await r.json();
      if (!r.ok) throw new Error(datos?.message ?? 'No pude traer la hoja.');
      setHoja(datos);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No pude traer la hoja.');
    }
  }, []);

  const refrescar = useCallback(() => traer(periodo, desde, hasta), [traer, periodo, desde, hasta]);

  // cada acción guarda y vuelve a traer la hoja: los totales salen siempre del servidor
  const hacer = useCallback(async (body: Record<string, unknown>) => {
    try {
      await pedir(body);
      await refrescar();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar.');
      return false;
    }
  }, [refrescar]);

  const delCuadro = useMemo(() => {
    const m = new Map<string, Movimiento[]>();
    for (const mov of hoja.movimientos) {
      const k = mov.tipo === 'egreso' ? EGRESOS : String(mov.cuadroId);
      m.set(k, [...(m.get(k) ?? []), mov]);
    }
    return m;
  }, [hoja.movimientos]);

  const cambiarPeriodo = (p: Periodo) => {
    setPeriodo(p);
    if (p !== 'fechas') void traer(p, desde, hasta);
  };

  const agregarCuadro = async () => {
    const nombre = await pedirTexto({ titulo: 'Nuevo cuadro de ingresos', campo: { etiqueta: 'Nombre del cuadro', obligatorio: true } });
    if (nombre?.trim()) await hacer({ accion: 'cuadro-crear', nombre });
  };

  const renombrar = async (c: Cuadro) => {
    const nombre = await pedirTexto({ titulo: 'Cambiar el nombre del cuadro', campo: { etiqueta: 'Nombre del cuadro', obligatorio: true, valorInicial: c.nombre } });
    if (nombre?.trim() && nombre.trim().toUpperCase() !== c.nombre) await hacer({ accion: 'cuadro-renombrar', id: c.id, nombre });
  };

  const quitar = async (c: Cuadro) => {
    if (!(await confirmar({ titulo: `¿Sacar el cuadro ${c.nombre}?`, texto: 'Está vacío: se saca de la hoja.', variante: 'peligro', textoConfirmar: 'Sacar' }))) return;
    await hacer({ accion: 'cuadro-quitar', id: c.id });
  };

  const borrar = async (m: Movimiento) => {
    if (!(await confirmar({
      titulo: '¿Borrar este renglón?',
      texto: `${fechaHoja(m.fecha)} · ${m.motivo || 'sin motivo'} · ${plata(m.monto)}`,
      variante: 'peligro',
      textoConfirmar: 'Borrar',
    }))) return false;
    return hacer({ accion: 'borrar', id: m.id });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Chips
          etiquetaAccesible="Qué período mirar"
          desplazable
          valor={periodo}
          onCambiar={(v) => cambiarPeriodo(v as Periodo)}
          opciones={[
            { valor: 'todo', etiqueta: 'Toda la hoja' },
            { valor: 'mes', etiqueta: 'Este mes' },
            { valor: 'semana', etiqueta: 'Esta semana' },
            { valor: 'fechas', etiqueta: 'Elegir fechas' },
          ]}
        />
        {periodo === 'fechas' && (
          <div className="flex flex-wrap items-center gap-2">
            <Entrada type="date" aria-label="Desde" value={desde} onChange={(e) => setDesde(e.target.value)} className="w-40" />
            <span className="text-sm text-tinta/60">a</span>
            <Entrada type="date" aria-label="Hasta" value={hasta} onChange={(e) => setHasta(e.target.value)} className="w-40" />
            <Boton tamano="chico" variante="secundario" onClick={() => void traer('fechas', desde, hasta)}>Ver</Boton>
          </div>
        )}
        <Boton variante="secundario" tamano="chico" onClick={() => void agregarCuadro()} className="ml-auto">+ Agregar cuadro</Boton>
      </div>

      {error && <Aviso tono="error">{error}</Aviso>}

      {/* los cuadros de ingresos, como arriba en el Excel */}
      <div className="grid gap-x-10 gap-y-8 md:grid-cols-2 xl:grid-cols-3">
        {hoja.cuadros.map((c) => (
          <CuadroHoja
            key={c.id}
            titulo={c.nombre}
            tipo="ingreso"
            cuadroId={c.id}
            renglones={delCuadro.get(c.id) ?? []}
            total={hoja.porCuadro[c.id] ?? 0}
            hacer={hacer}
            borrar={borrar}
            onTitulo={() => void renombrar(c)}
            onQuitar={(delCuadro.get(c.id) ?? []).length === 0 ? () => void quitar(c) : undefined}
          />
        ))}
      </div>

      {/* los totales y los egresos, como abajo a la izquierda en el Excel */}
      <div className="grid gap-x-10 gap-y-8 md:grid-cols-2 xl:grid-cols-3">
        <div className="space-y-8">
          <table className="w-full text-sm">
            <tbody>
              {hoja.periodo.desde && (
                <tr>
                  <td className="w-[31%] max-sm:w-[8%]" />
                  <td className="whitespace-nowrap px-2 py-1 text-marca">SALDO ANTERIOR</td>
                  <td className="importe px-2 py-1 text-right text-marca">{plata(hoja.saldoAnterior)}</td>
                </tr>
              )}
              <tr>
                <td className="w-[31%] max-sm:w-[8%]" />
                <td className="whitespace-nowrap px-2 py-1 text-marca">TOTAL INGRESOS</td>
                <td className="importe px-2 py-1 text-right text-marca">{plata(hoja.totalIngresos)}</td>
              </tr>
              <tr>
                <td />
                <td className="whitespace-nowrap px-2 py-1 text-marca">TOTAL EGRESOS</td>
                <td className="importe px-2 py-1 text-right text-marca">{plata(hoja.totalEgresos)}</td>
              </tr>
              <tr><td colSpan={3} className="h-4" /></tr>
              <tr>
                <td />
                <td className={unir(AMARILLO, 'border border-black/40 px-2 py-1 font-semibold text-marca')}>Total</td>
                <td className={unir(AMARILLO, 'importe border border-black/40 px-2 py-1 text-right font-semibold text-marca')}>{plata(hoja.total)}</td>
              </tr>
            </tbody>
          </table>

          <CuadroHoja
            titulo="EGRESOS"
            tipo="egreso"
            cuadroId={null}
            renglones={delCuadro.get(EGRESOS) ?? []}
            total={hoja.totalEgresos}
            hacer={hacer}
            borrar={borrar}
          />
        </div>
      </div>

      {dialogo}
    </div>
  );
}

/* ---------- un cuadro de la hoja: título, Fecha · Motivo · Monto, renglón para anotar y Total ---------- */

function CuadroHoja({ titulo, tipo, cuadroId, renglones, total, hacer, borrar, onTitulo, onQuitar }: {
  titulo: string;
  tipo: 'ingreso' | 'egreso';
  cuadroId: string | null;
  renglones: Movimiento[];
  total: number;
  hacer: (body: Record<string, unknown>) => Promise<boolean>;
  borrar: (m: Movimiento) => Promise<boolean>;
  onTitulo?: () => void;
  onQuitar?: () => void;
}) {
  const [editando, setEditando] = useState<string | null>(null);
  const relleno = Math.max(0, RENGLONES_MINIMOS - renglones.length - 1);
  const celda = 'border border-black/25 px-2 py-1';

  return (
    <section aria-label={`Cuadro ${titulo}`} className="min-w-0">
      <div className="mb-1 flex items-center justify-center gap-2">
        {onTitulo ? (
          <button type="button" onClick={onTitulo} className="text-sm tracking-wide text-tinta hover:underline" title="Cambiar el nombre">
            {titulo}
          </button>
        ) : (
          <h3 className="text-sm tracking-wide text-tinta">{titulo}</h3>
        )}
        {onQuitar && (
          <button type="button" onClick={onQuitar} className="text-xs text-tinta/50 hover:text-marca" aria-label={`Sacar el cuadro ${titulo}`}>
            Sacar
          </button>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[20rem] table-fixed border-2 border-tinta bg-white text-sm">
          <colgroup>
            <col className="w-[31%]" />
            <col className="w-[35%]" />
            <col className="w-[34%]" />
          </colgroup>
          <thead>
            <tr>
              <th className={unir(celda, 'font-normal')}>Fecha</th>
              <th className={unir(celda, 'font-normal')}>Motivo</th>
              <th className={unir(celda, 'font-normal')}>Monto</th>
            </tr>
          </thead>
          <tbody>
            {renglones.map((m) =>
              editando === m.id ? (
                <RenglonEditable
                  key={m.id}
                  inicial={m}
                  guardar={async (datos) => {
                    const ok = await hacer({ accion: 'editar', id: m.id, ...datos });
                    if (ok) setEditando(null);
                    return ok;
                  }}
                  cancelar={() => setEditando(null)}
                  borrar={async () => { if (await borrar(m)) setEditando(null); }}
                />
              ) : (
                <tr key={m.id} onClick={() => setEditando(m.id)} className="cursor-pointer hover:bg-crema-claro" title="Tocá para corregir o borrar">
                  <td className={celda}>{fechaHoja(m.fecha)}</td>
                  <td className={unir(celda, 'truncate')}>{m.motivo}</td>
                  <td className={unir(celda, 'importe text-right')}>{plata(m.monto)}</td>
                </tr>
              ),
            )}
            <RenglonEditable
              key={`nuevo-${renglones.length}`}
              nuevo
              guardar={(datos) => hacer({ accion: 'crear', tipo, cuadroId, ...datos })}
            />
            {Array.from({ length: relleno }, (_, i) => (
              <tr key={`vacio-${i}`} aria-hidden>
                <td className={unir(celda, 'h-8')} />
                <td className={celda} />
                <td className={celda} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <table className="mt-6 w-full table-fixed text-sm">
        <colgroup>
          <col className="w-[31%]" />
          <col className="w-[35%]" />
          <col className="w-[34%]" />
        </colgroup>
        <tbody>
          <tr>
            <td />
            <td className="border border-tinta bg-white px-2 py-1">Total</td>
            <td className="importe border border-tinta bg-white px-2 py-1 text-right">{plata(total)}</td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}

/* ---------- el renglón que se escribe: el vacío del final o uno que se corrige ---------- */

function RenglonEditable({ inicial, nuevo, guardar, cancelar, borrar }: {
  inicial?: Movimiento;
  nuevo?: boolean;
  guardar: (datos: { fecha: string; motivo: string; monto: number }) => Promise<boolean>;
  cancelar?: () => void;
  borrar?: () => void;
}) {
  const [fecha, setFecha] = useState(inicial?.fecha ?? hoy());
  const [motivo, setMotivo] = useState(inicial?.motivo ?? '');
  const [monto, setMonto] = useState(inicial ? String(inicial.monto).replace('.', ',') : '');
  const [guardando, setGuardando] = useState(false);
  const valor = leerMonto(monto);
  const listo = !!fecha && valor !== null && !guardando;
  const campo = 'h-8 w-full min-w-0 bg-transparent px-2 text-sm outline-none focus:bg-marca-suave';
  // en el celular, sin el ícono del calendario (tocando el campo se abre igual): así entra la fecha entera
  const campoFecha = unir(campo, 'px-1 text-[13px] max-sm:[&::-webkit-calendar-picker-indicator]:hidden', nuevo && 'text-tinta/55');
  const celda = 'border border-black/25 p-0';

  const enviar = async () => {
    if (!listo || valor === null) return;
    setGuardando(true);
    const ok = await guardar({ fecha, motivo, monto: valor });
    setGuardando(false);
    if (ok && nuevo) { setMotivo(''); setMonto(''); }
  };
  const teclas = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); void enviar(); }
    if (e.key === 'Escape' && cancelar) cancelar();
  };

  return (
    <>
      <tr className={nuevo ? undefined : 'bg-marca-suave/40'}>
        <td className={celda}>
          <input type="date" aria-label="Fecha" value={fecha} onChange={(e) => setFecha(e.target.value)} onKeyDown={teclas} className={campoFecha} />
        </td>
        <td className={celda}>
          <input aria-label="Motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} onKeyDown={teclas} maxLength={200} className={campo} autoFocus={!nuevo} />
        </td>
        <td className={celda}>
          <input aria-label="Monto" inputMode="decimal" value={monto} onChange={(e) => setMonto(e.target.value)} onKeyDown={teclas} className={unir(campo, 'importe text-right')} />
        </td>
      </tr>
      {(!nuevo || monto.trim() !== '') && (
        <tr>
          <td colSpan={3} className="border border-black/25 bg-crema-claro px-2 py-1.5">
            <div className="flex flex-wrap items-center justify-end gap-2">
              {monto.trim() !== '' && valor === null && <span className="mr-auto text-xs text-marca">El monto no se entiende.</span>}
              {borrar && <Boton variante="fantasma" tamano="chico" onClick={borrar} className="mr-auto text-marca">Borrar</Boton>}
              {cancelar && <Boton variante="fantasma" tamano="chico" onClick={cancelar}>Cancelar</Boton>}
              <Boton variante="ok" tamano="chico" onClick={() => void enviar()} disabled={!listo}>
                {guardando ? 'Guardando…' : nuevo ? 'Anotar' : 'Guardar'}
              </Boton>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
