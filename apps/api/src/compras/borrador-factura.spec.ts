// La factura a medio cargar se guarda sola (3/11/2026). Leandro: «no tomó los
// cambios viejos; cuando modificamos algo hay que hacer todo otra vez». La regla
// vive en el panel (apps/admin/app/lib/borrador-factura.ts); se prueba acá.
import { aplicarBorrador, borradorDe, borradorVacio } from '../../../admin/app/lib/borrador-factura';
import { ListasService } from '../listas/listas.service';

const leido = [
  { descripcion: 'QUESO LS RALLADO BOLSA 130GR', cantidad: 18, precio: 4082, sku: '', incluir: false, interpretado: { decision: 'cantidad_corregida' } },
  { descripcion: 'PREP.VEG.BEB. LS B\\ALMENDRA S\\A SQ 1L', cantidad: 24, precio: 2685, sku: 'A1', incluir: true, alicuotaElegida: null },
];
const pie = { neto: 2370618.7, iva: 497829.92, impuestosInternos: 7148.01 };

describe('qué se guarda: solo lo que cambió la persona', () => {
  it('el vínculo, el IVA elegido y el pie; no lo que no tocó', () => {
    const actual = [
      { ...leido[0], sku: 'Q130', nombre: 'Queso Rallado La Serenisima x 130 gr', incluir: true },
      { ...leido[1], alicuotaElegida: 21, llevaInternos: true },
    ];
    const b = borradorDe(leido, actual, pie, { ...pie, impuestosInternos: 7148.02 }, [{ campo: 'x' }]);
    expect(b.renglones).toEqual([
      { renglon: 0, descripcion: 'QUESO LS RALLADO BOLSA 130GR', campos: { sku: 'Q130', nombre: 'Queso Rallado La Serenisima x 130 gr', incluir: true } },
      { renglon: 1, descripcion: 'PREP.VEG.BEB. LS B\\ALMENDRA S\\A SQ 1L', campos: { alicuotaElegida: 21, llevaInternos: true } },
    ]);
    expect(b.pie).toEqual({ impuestosInternos: 7148.02 });
    expect(b.cambios).toEqual([{ campo: 'x' }]);
    expect(borradorVacio(borradorDe(leido, leido, pie, pie))).toBe(true);
  });
});

describe('al abrir: la lectura de HOY y encima lo que cambió la persona', () => {
  it('si el sistema mejoró (20 en vez de 18), se nota; lo de la persona se mantiene', () => {
    const guardado = borradorDe(leido, [{ ...leido[0], sku: 'Q130', incluir: true }, leido[1]], pie, pie);
    // la misma factura leída con las reglas de hoy: el queso ya viene en 20 con 10 %
    const hoy = [{ ...leido[0], cantidad: 20, bonificacionPct: 10 }, leido[1]];
    const r = aplicarBorrador(hoy, pie, guardado);
    expect(r.filas[0]).toMatchObject({ cantidad: 20, bonificacionPct: 10, sku: 'Q130', incluir: true });
    expect(r.aplicados).toBe(1);
    expect(r.descartados).toBe(0);
  });

  it('lo que tocó la persona gana aunque el sistema diga otra cosa', () => {
    const guardado = borradorDe(leido, [{ ...leido[0], cantidad: 19 }, leido[1]], pie, pie);
    const r = aplicarBorrador([{ ...leido[0], cantidad: 20 }, leido[1]], pie, guardado);
    expect(r.filas[0].cantidad).toBe(19);
  });

  it('si el renglón ya no es el mismo (se volvió a leer distinta), el cambio no cae en otro producto', () => {
    const guardado = borradorDe(leido, [{ ...leido[0], sku: 'Q130' }, leido[1]], pie, pie);
    const otra = [{ ...leido[1] }, { ...leido[0] }];
    const r = aplicarBorrador(otra, pie, guardado);
    expect(r.filas[0].sku).toBe('A1');
    expect(r.descartados).toBe(1);
  });

  it('el pie guardado va encima del leído', () => {
    const r = aplicarBorrador(leido, pie, { renglones: [], pie: { percepcionIibb: 118888.34 }, cambios: [] });
    expect(r.pie).toEqual({ ...pie, percepcionIibb: 118888.34 });
  });
});

describe('en la API', () => {
  const db = () => {
    const ops: any[] = [];
    const q: any = { update: (v: any) => { ops.push(v); return q; }, eq: async () => ({ error: null }) };
    return { ops, db: { from: () => q } as any };
  };

  it('guarda lo que llega, con quién y cuándo', async () => {
    const { ops, db: base } = db();
    const r = await new ListasService(base).guardarBorrador('l1', { renglones: [{ renglon: 0, descripcion: 'X', campos: { sku: 'Q' } }], pie: {}, cambios: [], form: { proveedorId: 'p1' } }, 'u-ana');
    expect(r).toEqual({ ok: true, guardado: true });
    expect(ops[0]).toMatchObject({ borrador: { renglones: [{ renglon: 0 }], form: { proveedorId: 'p1' } }, borrador_por: 'u-ana' });
    expect(typeof ops[0].borrador_en).toBe('string');
  });

  it('vacío o «empezar de cero»: se borra lo guardado', async () => {
    const { ops, db: base } = db();
    await new ListasService(base).guardarBorrador('l1', null, 'u-ana');
    await new ListasService(base).guardarBorrador('l1', { renglones: [], pie: {}, cambios: [], form: {} }, 'u-ana');
    expect(ops).toEqual([{ borrador: null, borrador_en: null, borrador_por: null }, { borrador: null, borrador_en: null, borrador_por: null }]);
  });
});
