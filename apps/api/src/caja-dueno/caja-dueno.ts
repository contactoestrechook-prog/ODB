// CAJA DEL DUEÑO (25/11/2026): las cuentas, sin base. Ver caja-dueno.service.ts.
//
// Igual que el Excel de Juan Pablo: cada cuadro de ingresos suma lo suyo; TOTAL
// INGRESOS es la suma de los cuadros; TOTAL EGRESOS, la del cuadro de egresos; y el
// Total es lo que queda. Mirando un período (semana, mes, fechas), lo de antes entra
// como saldo anterior, así el Total de hoy es el mismo que el del Excel completo.

export const PERMISO_CAJA_DUENO = 'caja_dueno';

export type TipoMovimiento = 'ingreso' | 'egreso';

export type Movimiento = {
  id: string;
  tipo: TipoMovimiento;
  cuadroId: string | null;
  fecha: string; // AAAA-MM-DD
  motivo: string;
  monto: number;
};

export type Cuadro = { id: string; nombre: string; orden: number };

const centavos = (n: number) => Math.round(n * 100);
const pesos = (c: number) => c / 100;

function fechaValida(v: unknown): string | null {
  const f = String(v ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f)) return null;
  const d = new Date(`${f}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === f ? f : null;
}

function motivoValido(v: unknown): string | null {
  const m = String(v ?? '').trim().replace(/\s+/g, ' ');
  return m.length > 200 ? null : m;
}

function montoValido(v: unknown): number | null {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0 || n >= 1e12) return null;
  return pesos(centavos(n));
}

export type MovimientoNuevo = { tipo: TipoMovimiento; cuadroId: string | null; fecha: string; motivo: string; monto: number };

/** Un renglón nuevo, revisado: si entra, en qué cuadro; fecha real; monto mayor a cero. */
export function movimientoNuevo(dto: any): MovimientoNuevo | string {
  const tipo = dto?.tipo;
  if (tipo !== 'ingreso' && tipo !== 'egreso') return 'Elegí si entra o sale.';
  const cuadroId = tipo === 'ingreso' ? String(dto?.cuadroId ?? '').trim() || null : null;
  if (tipo === 'ingreso' && !cuadroId) return 'Elegí en qué cuadro entra.';
  const fecha = fechaValida(dto?.fecha);
  if (!fecha) return 'Poné la fecha.';
  const motivo = motivoValido(dto?.motivo);
  if (motivo === null) return 'El motivo es muy largo (hasta 200 letras).';
  const monto = montoValido(dto?.monto);
  if (monto === null) return 'Poné el monto (mayor a cero).';
  return { tipo, cuadroId, fecha, motivo, monto };
}

/** Lo que se corrige de un renglón: solo lo que vino (fecha, motivo, monto o cuadro). */
export function cambiosMovimiento(dto: any): Partial<Pick<MovimientoNuevo, 'cuadroId' | 'fecha' | 'motivo' | 'monto'>> | string {
  const out: Partial<Pick<MovimientoNuevo, 'cuadroId' | 'fecha' | 'motivo' | 'monto'>> = {};
  if (dto?.fecha !== undefined) {
    const f = fechaValida(dto.fecha);
    if (!f) return 'Poné la fecha.';
    out.fecha = f;
  }
  if (dto?.motivo !== undefined) {
    const m = motivoValido(dto.motivo);
    if (m === null) return 'El motivo es muy largo (hasta 200 letras).';
    out.motivo = m;
  }
  if (dto?.monto !== undefined) {
    const n = montoValido(dto.monto);
    if (n === null) return 'Poné el monto (mayor a cero).';
    out.monto = n;
  }
  if (dto?.cuadroId !== undefined) {
    const c = String(dto.cuadroId ?? '').trim();
    if (!c) return 'Elegí en qué cuadro entra.';
    out.cuadroId = c;
  }
  if (!Object.keys(out).length) return 'No hay nada para cambiar.';
  return out;
}

/** Del período elegido: desde y hasta (incluidos), o todo. */
export function periodoValido(q: { desde?: string; hasta?: string }): { desde: string | null; hasta: string | null } | string {
  const ok = (f?: string) => !f || /^\d{4}-\d{2}-\d{2}$/.test(f);
  if (!ok(q.desde) || !ok(q.hasta)) return 'Fechas inválidas.';
  const desde = q.desde || null;
  const hasta = q.hasta || null;
  if (desde && hasta && desde > hasta) return 'La fecha de inicio es posterior a la de fin.';
  return { desde, hasta };
}

/** Los totales de la hoja, en centavos para que los centavos no se pierdan al sumar. */
export function totalesCaja(cuadros: Cuadro[], movimientos: Movimiento[], saldoAnterior = 0) {
  const porCuadro: Record<string, number> = {};
  for (const c of cuadros) porCuadro[c.id] = 0;
  let ingresos = 0;
  let egresos = 0;
  for (const m of movimientos) {
    const c = centavos(m.monto);
    if (m.tipo === 'ingreso') {
      ingresos += c;
      if (m.cuadroId) porCuadro[m.cuadroId] = (porCuadro[m.cuadroId] ?? 0) + c;
    } else {
      egresos += c;
    }
  }
  const anterior = centavos(saldoAnterior);
  return {
    porCuadro: Object.fromEntries(Object.entries(porCuadro).map(([k, v]) => [k, pesos(v)])),
    saldoAnterior: pesos(anterior),
    totalIngresos: pesos(ingresos),
    totalEgresos: pesos(egresos),
    total: pesos(anterior + ingresos - egresos),
  };
}

/** En el orden de la hoja: por fecha y, el mismo día, en el orden en que se cargó. */
export function enOrden<T extends { fecha: string; creadoEn?: string | null }>(lista: T[]): T[] {
  return [...lista].sort((a, b) => a.fecha.localeCompare(b.fecha) || String(a.creadoEn ?? '').localeCompare(String(b.creadoEn ?? '')));
}
