import { historicoEnVentana } from './historico-ventana';

describe('historicoEnVentana', () => {
  const periodo = { desde: '2026-09-21', hasta: '2026-10-20', unidades: 300 };

  it('antes del cambio el período entero está en la ventana', () => {
    expect(historicoEnVentana(periodo, { desde: '2026-09-21', hasta: '2026-10-21' })).toBe(300);
  });

  it('después del cambio solo cuentan los días que ODB no cubre (no se suma dos veces)', () => {
    // 15/11: ventana 16/10–15/11; del período quedan 5 días (16 al 20/10)
    expect(historicoEnVentana(periodo, { desde: '2026-10-16', hasta: '2026-11-15' })).toBe(50);
    // ritmo: 250 u de ODB (22/10–15/11) + 50 del histórico = 300 en 30 días = 10 por día, no 18,3
    expect((250 + historicoEnVentana(periodo, { desde: '2026-10-16', hasta: '2026-11-15' })) / 30).toBe(10);
  });

  it('fuera de la ventana no suma', () => {
    expect(historicoEnVentana({ desde: '2026-07-01', hasta: '2026-07-21', unidades: 80 }, { desde: '2026-09-21', hasta: '2026-10-21' })).toBe(0);
  });
});
