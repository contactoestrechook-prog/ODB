import { fechaCorta, leyendaRechazo } from './rechazo';
import { textosOrdenPago, ordenDePagoPDF, type DatosOrdenPago } from './documentos';

// Un rechazo se cuenta con su autor, su fecha y su motivo. Antes el rechazo
// vivía en aprobada_por / aprobada_en: la trazabilidad mostraba la orden como
// aprobada y el PDF de la OP decía "Autorizada por" quien la había rechazado.

describe('leyendaRechazo', () => {
  it('nombre, fecha en hora de Buenos Aires y motivo', () => {
    // 01:30 UTC del 4/10 = 22:30 del 3/10 en Buenos Aires: el día es el 3
    expect(leyendaRechazo('Juan Pablo', '2026-10-04T01:30:00Z', 'El precio no es el pactado'))
      .toBe('Rechazada por Juan Pablo el 03/10/2026 · Motivo: El precio no es el pactado');
  });

  it('sin motivo, sin nombre o sin fecha no deja huecos raros', () => {
    expect(leyendaRechazo('Ana', '2026-10-03T15:00:00Z')).toBe('Rechazada por Ana el 03/10/2026');
    expect(leyendaRechazo(null, '2026-10-03T15:00:00Z', '  ')).toBe('Rechazada el 03/10/2026');
    expect(leyendaRechazo('Ana', null, 'duplicada')).toBe('Rechazada por Ana · Motivo: duplicada');
  });

  it('una fecha inválida no rompe', () => {
    expect(fechaCorta('no es fecha')).toBeNull();
    expect(fechaCorta(undefined)).toBeNull();
  });
});

describe('orden de pago en papel: estado y firma', () => {
  const base: DatosOrdenPago = {
    folio: 'OP-2026-00012',
    numeroInterno: 12,
    proveedor: 'Distribuidora del Sur',
    facturas: [{ numero: 'A-0001-00000123', total: 1000, imputado: 1000 }],
    total: 1000,
    pedidaPor: 'Mara',
  };

  it('rechazada: dice quién la rechazó, cuándo y por qué — nunca "Autorizada por"', () => {
    const t = textosOrdenPago({
      ...base,
      estado: 'rechazada',
      // aunque un dato viejo traiga algo en la firma, manda el rechazo
      aprobadaPor: 'Juan Pablo',
      rechazadaPor: 'Juan Pablo',
      rechazadaEn: '2026-10-03T15:00:00Z',
      rechazoMotivo: 'Factura duplicada',
    });
    expect(t.rechazada).toBe(true);
    expect(t.estado).toBe('rechazada');
    expect(t.firma).toBe('Rechazada por Juan Pablo el 03/10/2026 · Motivo: Factura duplicada');
    expect(t.firma).not.toMatch(/Autorizada/);
    expect(t.nota).toMatch(/no habilita ningún pago/);
  });

  it('pendiente: no dice "autorizada" si nadie la firmó', () => {
    const t = textosOrdenPago({ ...base, estado: 'pendiente_aprobacion', aprobadaPor: null });
    expect(t.estado).toBe('pendiente de autorización');
    expect(t.firma).toBe('Autorizada por: SIN AUTORIZAR');
  });

  it('aprobada y pagada', () => {
    expect(textosOrdenPago({ ...base, estado: 'aprobada', aprobadaPor: 'Juan Pablo' }))
      .toMatchObject({ estado: 'autorizada, sin pagar', firma: 'Autorizada por: Juan Pablo', rechazada: false });
    expect(textosOrdenPago({ ...base, estado: 'pagada', aprobadaPor: 'Juan Pablo', pagadaEn: '2026-10-05T15:00:00Z' }).estado)
      .toMatch(/^pagada /);
  });

  it('el PDF de una OP rechazada sale igual (no revienta por los datos nuevos)', async () => {
    const pdf = await ordenDePagoPDF({ ...base, estado: 'rechazada', rechazadaPor: 'Juan Pablo', rechazadaEn: '2026-10-03T15:00:00Z', rechazoMotivo: 'No va' });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  });
});
