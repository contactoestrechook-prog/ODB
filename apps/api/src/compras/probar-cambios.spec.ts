// El chat ve lo que hace (18/11/2026). Las dos fallas de ese día, tal como eran:
// el servidor ahora las ve ANTES de contestar, con la misma cuenta que la pantalla.
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { aplicarCambiosIA, papelDeLectura } from './panel/tabla-factura';
import { FacturaChatService } from './factura-chat.service';
import { fraseSinAplicar, observacionDeLaPrueba, probarCambios, tablaDespues } from './probar-cambios';

let mockRespuestas: any[] = [];
let mockPedidos: any[] = [];
jest.mock('@anthropic-ai/sdk', () => ({ __esModule: true, default: class {
  messages = { stream: (request: any) => {
    mockPedidos.push(request);
    const r = mockRespuestas[Math.min(mockPedidos.length, mockRespuestas.length) - 1];
    return { finalMessage: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(r) }], usage: {} }) };
  } };
} }));

const fila = (descripcion: string, cantidad: number, precio: number, extra: Record<string, unknown> = {}) => {
  const leido: any = { descripcion, cantidad, precio, importe: Math.round(cantidad * precio * 100) / 100, sku: 'S1', nombre: descripcion, incluir: true, alicuotaIva: 21, ...extra };
  return { ...leido, papel: papelDeLectura(leido), _esDescuento: false, _conDescuentoEncima: false };
};
const aromas = () => [fila('SAPHIRUS TEXTIL COCO X 2', 2, 3525), fila('SAPHIRUS TEXTIL UVA X 2', 2, 3525), fila('SAPHIRUS TEXTIL BEBE X 2', 2, 3525)];
const rackPorPeso = () => aplicarCambiosIA([{ ...fila('RACK DE OJO PORCIONADO', 1, 38495, { kg: 4.52 }), importe: 173997.4, papel: papelDeLectura({ cantidad: 1, precio: 38495, importe: 173997.4 }) }], [{ renglon: 1, campo: 'kilos', valor: 4.52 }], () => false).items;

describe('la copia de la cuenta de la factura', () => {
  it('es igual a la de la pantalla (si falla: scripts/copiar-cuenta-factura.sh)', () => {
    expect(() => execFileSync('sh', [join(__dirname, '../../../../scripts/copiar-cuenta-factura.sh'), '--comprobar'], { stdio: 'pipe' })).not.toThrow();
  });
});

describe('probarCambios: lo que va a pasar en la pantalla, visto desde el servidor', () => {
  it('lo que se puede aplicar pasa entero y no hay nada que observar', () => {
    const p = probarCambios(rackPorPeso(), [{ renglon: 1, campo: 'recibidas', valor: 3.475, motivo: 'mal estado' }]);
    expect(p.rechazados).toHaveLength(0);
    expect(p.rotos).toHaveLength(0);
    expect(p.aceptados).toHaveLength(1);
    expect(p.filas[0].recibidoAMano).toBe(3.475);
    expect(observacionDeLaPrueba(p, [])).toBeNull();
  });
  it('lo rechazado vuelve con el motivo, y lo demás se aplica igual', () => {
    const p = probarCambios(rackPorPeso(), [{ renglon: 1, campo: 'recibidas', valor: 9 }, { renglon: 1, campo: 'costoFinal', valor: 50000 }, { renglon: 7, campo: 'precio', valor: 1 }]);
    expect(p.rechazados).toEqual([
      { renglon: 1, campo: 'recibidas', porque: 'no pueden entrar más kg (9) que las facturadas (4,52)' },
      { renglon: 7, campo: 'precio', porque: 'ese renglón no existe' },
    ]);
    expect(p.aceptados).toEqual([{ renglon: 1, campo: 'costoFinal', valor: 50000 }]);
    expect(p.filas[0].costoManual).toBe(50000);
    const texto = observacionDeLaPrueba(p, tablaDespues(p.filas, [])) as string;
    expect(texto).toContain('Se aplicaron 1.');
    expect(texto).toContain('- Renglón 1 «recibidas»: no pueden entrar más kg (9) que las facturadas (4,52)');
    expect(texto).toContain('Nunca digas «listo» ni «ahora sí»');
  });
  // Distribuidora City, 18/11 11:26: el chat «juntó» los Saphirus dejando los demás en cero.
  it('dejar renglones en cero para simular que se juntaron: se aplica, pero se ve que quedaron trabando el registro', () => {
    const p = probarCambios(aromas(), [
      { renglon: 1, campo: 'sueltas', valor: 6 }, { renglon: 1, campo: 'importe', valor: 21150 },
      { renglon: 2, campo: 'sueltas', valor: 0 }, { renglon: 3, campo: 'sueltas', valor: 0 },
    ]);
    expect(p.rechazados).toHaveLength(0);
    expect(p.rotos).toEqual([2, 3]);
    expect(observacionDeLaPrueba(p, [])).toContain('los renglones 2, 3 dejaron de dar su importe');
  });
  it('juntarlos de verdad no traba nada', () => {
    const p = probarCambios(aromas(), [{ renglon: 2, campo: 'juntarEn', valor: 1 }, { renglon: 3, campo: 'juntarEn', valor: 1 }]);
    expect(p.rechazados).toHaveLength(0);
    expect(p.rotos).toHaveLength(0);
    expect(p.filas[0]).toMatchObject({ cantidad: 6, importe: 21150 });
    expect((tablaDespues(p.filas, []) as any[])[1]).toMatchObject({ juntadoEnElRenglon: 1 });
  });
  it('un renglón con un descuento encima no se junta; el producto lo resuelve la pantalla y pasa sin probar', () => {
    const filas = aromas();
    filas[1]._conDescuentoEncima = true;
    const p = probarCambios(filas, [{ renglon: 2, campo: 'juntarEn', valor: 1 }, { renglon: 3, campo: 'producto', valor: 'Saphirus Textil' }]);
    expect(p.rechazados).toEqual([{ renglon: 2, campo: 'juntarEn', porque: 'tiene un descuento aplicado en otro renglón de la factura' }]);
    expect(p.aceptados).toEqual([{ renglon: 3, campo: 'producto', valor: 'Saphirus Textil' }]);
  });
  it('un renglón que ya no cerraba no cuenta como roto por estos cambios', () => {
    const filas = [fila('GALLETITAS X 12', 2, 1000, { importe: 30000 })];
    filas[0].papel = { ...filas[0].papel, importe: 30000 };
    expect(probarCambios(filas, [{ renglon: 1, campo: 'costoFinal', valor: 900 }]).rotos).toHaveLength(0);
  });
});

describe('el chat prueba sus cambios antes de contestar', () => {
  const base: any = { from: () => { const b: any = new Proxy({}, { get: (_t, k) => (k === 'then' ? (ok: any, err: any) => Promise.resolve({ data: [], error: null }).then(ok, err) : k === 'single' || k === 'maybeSingle' ? async () => ({ data: null, error: null }) : () => b) }); return b; }, storage: { from: () => ({ download: async () => ({ data: null, error: { message: 'no' } }) }) } };
  const chat = () => new FacturaChatService(base, {} as any);
  const respuesta = (texto: string, cambios: any[]) => ({ respuesta: texto, cambios, cambiosPie: [], reglaProveedor: null, reglaReemplaza: null, leerOtrosComprobantes: false, renglonesNuevos: [] });
  const pedir = (filas: any[], texto: string) => chat().chat('prueba', { tabla: tablaDespues(filas, []), filas, pie: null, controles: null, mensajes: [{ rol: 'usuario', texto }] });
  const ultimoPedido = () => String((mockPedidos[mockPedidos.length - 1].messages.slice(-1)[0] as any).content);
  beforeEach(() => { mockPedidos = []; process.env.ANTHROPIC_API_KEY = 'prueba'; });

  it('si todo entra, contesta en una sola vuelta', async () => {
    mockRespuestas = [respuesta('Listo: entran 3,475 kg.', [{ renglon: 1, campo: 'recibidas', valor: 3.475, motivo: 'mal estado' }])];
    const r: any = await pedir(rackPorPeso(), 'del rack entraron 3.475 kg');
    expect(mockPedidos).toHaveLength(1);
    expect(r).toMatchObject({ respuesta: 'Listo: entran 3,475 kg.', probado: true, descartados: [] });
    expect(r.cambios).toHaveLength(1);
  });

  // Conallison, 18/11 12:15: «Listo» con el cambio rechazado. Ahora lo ve y corrige antes de contestar.
  it('si la pantalla rechazaría el cambio, el chat lo ve con el motivo, corrige y recién ahí contesta', async () => {
    mockRespuestas = [
      respuesta('Listo, marqué 9 kg recibidos.', [{ renglon: 1, campo: 'recibidas', valor: 9, motivo: '' }]),
      respuesta('Entran 3,475 kg de los 4,52 facturados; la factura espera la nota de crédito por el resto.', [{ renglon: 1, campo: 'recibidas', valor: 3.475, motivo: 'corregido' }]),
    ];
    const r: any = await pedir(rackPorPeso(), 'del rack entraron 3.475 kg');
    expect(mockPedidos).toHaveLength(2);
    expect(ultimoPedido()).toContain('LA PANTALLA PROBÓ TUS CAMBIOS');
    expect(ultimoPedido()).toContain('no pueden entrar más kg (9) que las facturadas (4,52)');
    expect(r.respuesta).toContain('Entran 3,475 kg');
    expect(r.cambios).toEqual([{ renglon: 1, campo: 'recibidas', valor: 3.475, motivo: 'corregido' }]);
    expect(r.descartados).toHaveLength(0);
  });

  it('si no hay forma, no repite lo que la IA creyó haber hecho: lo dice el servidor, con el motivo', async () => {
    mockRespuestas = [respuesta('Listo, quedó en 9 kg. Ahora sí.', [{ renglon: 1, campo: 'recibidas', valor: 9, motivo: '' }])];
    const r: any = await pedir(rackPorPeso(), 'entraron 9 kg');
    expect(mockPedidos).toHaveLength(3); // la primera y dos intentos más
    expect(r.respuesta).toBe(fraseSinAplicar(0));
    expect(r.respuesta).not.toContain('Ahora sí');
    expect(r.cambios).toHaveLength(0);
    expect(r.descartados).toEqual([{ renglon: 1, campo: 'recibidas', porque: 'no pueden entrar más kg (9) que las facturadas (4,52)' }]);
  });

  // Distribuidora City, 18/11 11:26.
  it('si sus cambios dejan renglones trabando el registro, lo ve y lo arregla en la misma respuesta', async () => {
    mockRespuestas = [
      respuesta('Junté los Textil en el 1.', [{ renglon: 1, campo: 'sueltas', valor: 6, motivo: '' }, { renglon: 1, campo: 'importe', valor: 21150, motivo: '' }, { renglon: 2, campo: 'sueltas', valor: 0, motivo: '' }, { renglon: 3, campo: 'sueltas', valor: 0, motivo: '' }]),
      respuesta('Volví los renglones 2 y 3 a como estaban: así no traban el registro.', [{ renglon: 2, campo: 'sueltas', valor: 2, motivo: '' }, { renglon: 3, campo: 'sueltas', valor: 2, motivo: '' }, { renglon: 1, campo: 'sueltas', valor: 2, motivo: '' }, { renglon: 1, campo: 'importe', valor: 7050, motivo: '' }]),
    ];
    const r: any = await pedir(aromas(), 'los saphirus en un solo renglón');
    expect(mockPedidos).toHaveLength(2);
    expect(ultimoPedido()).toContain('los renglones 2, 3 dejaron de dar su importe');
    expect(r.respuesta).toContain('Volví los renglones 2 y 3');
    // a la pantalla viajan los cambios de las dos vueltas, en orden: el resultado final cierra
    const final = aplicarCambiosIA(aromas(), r.cambios, () => false);
    expect(final.descartados).toHaveLength(0);
    expect(final.items.every((f: any) => f.cantidad === 2 && f.importe === 7050)).toBe(true);
  });

  it('una pantalla vieja, que no manda sus filas, sigue como antes', async () => {
    mockRespuestas = [respuesta('Listo.', [{ renglon: 1, campo: 'recibidas', valor: 9, motivo: '' }])];
    const r: any = await chat().chat('prueba', { tabla: tablaDespues(rackPorPeso(), []), mensajes: [{ rol: 'usuario', texto: 'x' }] });
    expect(mockPedidos).toHaveLength(1);
    expect(r.probado).toBe(false);
    expect(r.cambios).toHaveLength(1);
  });
});
