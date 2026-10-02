import { generarPresupuesto, type DatosPresupuesto } from './presupuesto';

const hojas = (pdf: Buffer) => (pdf.toString('latin1').match(/\/Type \/Page\b(?!s)/g) ?? []).length;

const presupuesto = (n: number): DatosPresupuesto => ({
  folio: 'PRESU-1A2B3C4D',
  fecha: '2 de octubre de 2026',
  cliente: { nombre: 'Catalina Fernández de la Torre', dni: '30123456' },
  evento: { nombre: 'Casamiento de Catalina y Martín en la quinta de Canning', tipo: 'casamiento', fecha: '2026-12-12T20:00:00Z', invitados: 180 },
  items: Array.from({ length: n }, (_, i) => ({
    descripcion: i % 3 ? `Fernet Branca 750 cc (${i + 1})` : 'Vino Rutini Cabernet Malbec edición especial de bodega reserva 750 cc',
    cantidad: i + 1,
    precio_unitario: 1234567,
  })),
});

describe('presupuesto de eventos (diseño Placa roja)', () => {
  it('pocos renglones: una hoja, en Inter', async () => {
    const pdf = await generarPresupuesto(presupuesto(3));
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(hojas(pdf)).toBe(1);
    expect(pdf.toString('latin1')).toMatch(/Inter-ExtraBold/);
  });

  it('30 renglones: sigue en otra hoja', async () => {
    expect(hojas(await generarPresupuesto(presupuesto(30)))).toBeGreaterThanOrEqual(2);
  });

  it('sin cliente ni ítems también sale', async () => {
    const pdf = await generarPresupuesto({ ...presupuesto(0), cliente: null });
    expect(hojas(pdf)).toBe(1);
  });
});
