// Plan de conteo por rubro (24/10/2026): la planilla de la pared de ODB (rubros
// por semanas del mes, «Ale 21/7») pasada al sistema. Acá las cuentas puras:
// qué semanas tiene un mes y cómo se reparten los rubros pendientes.

const DIA = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** El lunes de la semana de una fecha AAAA-MM-DD. */
export function lunesDe(fecha: string): string {
  const d = new Date(`${fecha}T12:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // 0 = lunes
  return iso(new Date(d.getTime() - dow * DIA));
}

/**
 * Las semanas (lunes) que tocan un mes AAAA-MM: de la que contiene el día 1 a la
 * que contiene el último día. Como la planilla: «1 Semana», «2 Semana»…
 */
export function semanasDelMes(mes: string): string[] {
  if (!/^\d{4}-\d{2}$/.test(mes)) throw new Error('Mes inválido');
  const [a, m] = mes.split('-').map(Number);
  const primero = `${mes}-01`;
  const ultimo = iso(new Date(Date.UTC(a, m, 0, 12)));
  const out: string[] = [];
  for (let l = lunesDe(primero); l <= ultimo; l = iso(new Date(new Date(`${l}T12:00:00Z`).getTime() + 7 * DIA))) out.push(l);
  return out;
}

export type RubroARepartir = { id: string; productos: number; diasSinContar: number | null };

/**
 * Reparte rubros entre semanas y personas, parejo por cantidad de productos.
 * Primero los que nunca se contaron y los de más días sin contar; cada rubro va
 * a la semana con menos productos asignados y, dentro de ella, a la persona con
 * menos carga.
 */
export function repartir(rubros: RubroARepartir[], semanas: string[], personas: string[]) {
  if (!semanas.length || !personas.length) return [];
  const orden = [...rubros].sort((a, b) =>
    (b.diasSinContar ?? 9999) - (a.diasSinContar ?? 9999) || b.productos - a.productos);
  const cargaSemana = new Map(semanas.map((s) => [s, 0]));
  const cargaPersona = new Map(semanas.flatMap((s) => personas.map((p) => [`${s}|${p}`, 0] as [string, number])));
  const out: { categoriaId: string; semana: string; persona: string }[] = [];
  for (const r of orden) {
    const semana = semanas.reduce((m, s) => (cargaSemana.get(s)! < cargaSemana.get(m)! ? s : m), semanas[0]);
    const persona = personas.reduce((m, p) => (cargaPersona.get(`${semana}|${p}`)! < cargaPersona.get(`${semana}|${m}`)! ? p : m), personas[0]);
    const peso = Math.max(1, r.productos);
    cargaSemana.set(semana, cargaSemana.get(semana)! + peso);
    cargaPersona.set(`${semana}|${persona}`, cargaPersona.get(`${semana}|${persona}`)! + peso);
    out.push({ categoriaId: r.id, semana, persona });
  }
  return out;
}

/** Un nombre de persona prolijo: «ale» → «Ale». */
export function nombrePersona(n: unknown): string {
  const t = String(n ?? '').trim().replace(/\s+/g, ' ').slice(0, 40);
  return t ? t.charAt(0).toLocaleUpperCase('es') + t.slice(1) : '';
}
