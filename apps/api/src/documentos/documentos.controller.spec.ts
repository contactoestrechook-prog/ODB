import { DocumentosController, pasoAprobacion } from './documentos.controller';

// Trazabilidad: el paso "Aprobación" de una orden rechazada. Antes el rechazo
// se guardaba en aprobada_por / aprobada_en, así que la cadena lo mostraba como
// "hecho · Autorizada para enviar al proveedor" con el nombre de quien la
// había rechazado. Y el caso "rechazada" preguntaba por un estado que las OC no
// tienen (al rechazarlas quedan 'cancelada'), así que nunca se daba.

const NOMBRES: Record<string, string> = { 'u-jp': 'Juan Pablo', 'u-mara': 'Mara' };
const nombre = (id?: string | null) => (id ? NOMBRES[id] ?? '—' : null);

describe('pasoAprobacion (trazabilidad de una OC)', () => {
  it('rechazada: estado rechazado, con quién y cuándo, y "Rechazada por X el …"', () => {
    const p = pasoAprobacion(
      { estado: 'cancelada', aprobada_por: null, aprobada_en: null, rechazada_por: 'u-jp', rechazada_en: '2026-10-03T15:00:00Z', rechazo_motivo: 'Precio viejo' },
      nombre,
    );
    expect(p).toEqual({
      paso: 'Aprobación',
      estado: 'rechazado',
      cuando: '2026-10-03T15:00:00Z',
      quien: 'Juan Pablo',
      detalle: 'Rechazada por Juan Pablo el 03/10/2026 · Motivo: Precio viejo',
    });
  });

  it('aprobada: hecho, con la firma real', () => {
    const p = pasoAprobacion({ estado: 'enviada', aprobada_por: 'u-jp', aprobada_en: '2026-10-02T12:00:00Z' }, nombre);
    expect(p).toMatchObject({ estado: 'hecho', quien: 'Juan Pablo', detalle: 'Autorizada para enviar al proveedor' });
  });

  it('sin firmar: falta', () => {
    expect(pasoAprobacion({ estado: 'pendiente_aprobacion' }, nombre)).toMatchObject({ estado: 'falta', quien: null });
  });

  it('cadena completa: la orden rechazada no aparece aprobada', async () => {
    const respuestas: Record<string, any> = {
      ordenes_compra: { id: 'oc-1', numero: 7, estado: 'cancelada', total: 1000, creado_en: '2026-10-01T12:00:00Z', creada_por: 'u-mara', aprobada_por: null, aprobada_en: null, rechazada_por: 'u-jp', rechazada_en: '2026-10-03T15:00:00Z', rechazo_motivo: 'No', proveedor: { razon_social: 'Sur' } },
      usuarios: [{ id: 'u-jp', nombre: 'Juan Pablo' }, { id: 'u-mara', nombre: 'Mara' }],
    };
    const db: any = {
      from: (tabla: string) => {
        const r = { data: respuestas[tabla] ?? [], error: null };
        const q: any = {
          select: () => q, eq: () => q, in: () => q, order: () => q,
          maybeSingle: () => Promise.resolve(r),
          then: (ok: any, mal: any) => Promise.resolve(r).then(ok, mal),
        };
        return q;
      },
    };
    const c = new DocumentosController(db);
    const r = await c.cadena('oc-1');
    const aprobacion = r.pasos.find((p: any) => p.paso === 'Aprobación');
    expect(aprobacion.estado).toBe('rechazado');
    expect(aprobacion.detalle).toBe('Rechazada por Juan Pablo el 03/10/2026 · Motivo: No');
    expect(r.pasos.some((p: any) => p.estado === 'hecho' && p.paso === 'Aprobación')).toBe(false);
  });
});
