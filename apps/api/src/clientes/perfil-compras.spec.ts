import { resumirPerfil } from './perfil-compras';

describe('perfil de compra del cliente', () => {
  // St Thomas 470 (Salvador), 6 meses del Crack: el sábado es el día fuerte
  const fila = {
    tickets: 135, total: 18282180, ticket_promedio: 135424, cada_dias: 1.4, primera: '2026-04-24', ultima: '2026-10-23',
    por_dia: { 0: 20, 1: 14, 2: 14, 3: 15, 4: 18, 5: 13, 6: 41 },
    por_mes: [{ mes: '2026-09', tickets: 20, total: 3000000 }],
    medios: { 'CTA. CTE.': 135 },
    productos: [1, 2, 3, 4].map((i) => ({ codigo: String(i), nombre: `P${i}`, unidades: i, total: 100 * i, veces: i })),
  };

  it('arma los días de domingo a sábado y nombra los fuertes', () => {
    const p = resumirPerfil(fila, 3);
    expect(p.porDia).toEqual([20, 14, 14, 15, 18, 13, 41]);
    expect(p.diasFuertes).toEqual(['sábado']);
    expect(p.ticketPromedio).toBe(135424);
    expect(p.productos).toHaveLength(3);
    expect(p.medios).toEqual([{ medio: 'CTA. CTE.', tickets: 135 }]);
  });

  it('dos días parejos son los dos fuertes; sin compras, ninguno', () => {
    expect(resumirPerfil({ ...fila, por_dia: { 2: 31, 3: 31, 4: 26, 1: 6 } }).diasFuertes).toEqual(['martes', 'miércoles', 'jueves']);
    expect(resumirPerfil({ ...fila, por_dia: {} }).diasFuertes).toEqual([]);
  });
});
