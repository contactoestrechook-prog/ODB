// El dato que faltaba confirma el pedido (9/10/2026), con la charla de Leandro
// (Odb Saint Thomas, 16:53–17:03) y los casos que el 3/10 crearon pedidos que
// el cliente no quería.
import { cierraConElDato, nombreDeQuienRetira } from './cierre-con-dato';

const renglones = [
  { nombre: 'Coca Cola Zero x1.75L', renglon: '6 × $4.700 c/u = $28.200' },
  { nombre: 'Chandon Extra Brut', renglon: '2 × $22.700 c/u = $45.400' },
  { nombre: 'Patitas de Pollo Granja del Sol x 400 gr', renglon: '1 × $10.800 c/u = $10.800' },
  { nombre: 'Azucar Ledesma Comun x 1 kg', renglon: '1 × $2.300 c/u = $2.300' },
  { nombre: 'KO agua x 1L', renglon: '4 × $2.000 c/u = $8.000' },
  { nombre: 'Absolut', renglon: '1 × $33.500 c/u = $33.500' },
];
const visto = [
  'Sumo 2 aguas y saco 2 Coca Cola Zero.',
  '• Coca Cola Zero 1,75 L — 6 × $4.700 c/u = $28.200',
  '• Chandon Extra Brut — 2 × $22.700 c/u = $45.400 ($40.860 en efectivo o transferencia)',
  '• Patitas de Pollo Granja del Sol 400 g — 1 × $10.800 c/u = $10.800',
  '• Azúcar Ledesma común 1 kg — 1 × $2.300 c/u = $2.300',
  '• KO agua 1 L — 4 × $2.000 c/u = $8.000',
  '• Absolut — 1 × $33.500 c/u = $33.500',
  '',
  '*Total: $128.200*, o $120.310 en efectivo o transferencia. Es para retirar en la sucursal Saint Thomas. ¿A nombre de quién lo preparo?',
].join('\n');
const base = { ultimoBot: visto, ultimosBot: [visto], cotizacion: { total: 128200, renglones, tipo: 'pickup', nombre: 'Leandro' } };

describe('el dato que faltaba confirma', () => {
  it('17:02 «A nombre de leandro» después de ver la lista con el total → confirma', () => {
    expect(cierraConElDato({ ...base, textoCliente: 'A nombre de leandro' })).toMatchObject({ ok: true });
    expect(cierraConElDato({ ...base, textoCliente: 'Leandro' })).toMatchObject({ ok: true });
    expect(cierraConElDato({ ...base, textoCliente: 'Sí, a nombre de Leandro' })).toMatchObject({ ok: true });
    expect(cierraConElDato({ ...base, textoCliente: 'Para Leandro Alonso.', cotizacion: { ...base.cotizacion, nombre: 'Leandro Alonso' } })).toMatchObject({ ok: true });
  });
  it('lo que pasó el 3/10 no confirma: «Cancelalo», el nombre con otro producto, una pregunta, una espera', () => {
    for (const t of ['Cancelalo', 'Leandro y 2 hielos', 'Leandro, sumame un hielo', 'Leandro, ¿hay estacionamiento?', 'Leandro pero esperá', 'No, a nombre de Ana', 'Leandro, mejor sacá el Absolut']) {
      expect(cierraConElDato({ ...base, textoCliente: t }).ok).toBe(false);
    }
  });
  it('si el cliente no vio esta misma lista (otro total u otro renglón), no confirma', () => {
    expect(cierraConElDato({ ...base, textoCliente: 'Leandro', cotizacion: { ...base.cotizacion, total: 130500 } }).ok).toBe(false);
    expect(cierraConElDato({ ...base, textoCliente: 'Leandro', cotizacion: { ...base.cotizacion, renglones: [...renglones, { nombre: 'Hielo', renglon: '1 × $3.000 c/u = $3.000' }] } }).ok).toBe(false);
  });
  it('si el bot no pidió solo el nombre, no confirma (pidió retiro o envío, ya decía «¿Lo confirmo?», o hizo dos preguntas)', () => {
    expect(cierraConElDato({ ...base, textoCliente: 'Leandro', ultimoBot: visto.replace('¿A nombre de quién lo preparo?', '¿Lo retirás en la sucursal o te lo enviamos?') }).ok).toBe(false);
    expect(cierraConElDato({ ...base, textoCliente: 'Leandro', ultimoBot: visto + ' ¿Lo confirmo?' }).ok).toBe(false);
    expect(cierraConElDato({ ...base, textoCliente: 'Leandro', ultimoBot: visto.replace('¿A nombre de quién lo preparo?', '¿A nombre de quién lo preparo? ¿Pagás en efectivo?') }).ok).toBe(false);
  });
  it('el nombre tiene que ser el que quedó en la cotización', () => {
    expect(cierraConElDato({ ...base, textoCliente: 'Leandro', cotizacion: { ...base.cotizacion, nombre: 'Ana' } }).ok).toBe(false);
  });
  it('envío: la dirección que faltaba, si es la de la cotización', () => {
    const conEnvio = visto.replace('Es para retirar en la sucursal Saint Thomas. ¿A nombre de quién lo preparo?', '¿A qué dirección te lo enviamos, calle y número?');
    const q = { ...base.cotizacion, tipo: 'domicilio', nombre: 'Leandro', direccion: 'Mitre 123, Canning' };
    expect(cierraConElDato({ ...base, ultimoBot: conEnvio, ultimosBot: [conEnvio], textoCliente: 'Mitre 123, Canning', cotizacion: q }).ok).toBe(true);
    expect(cierraConElDato({ ...base, ultimoBot: conEnvio, ultimosBot: [conEnvio], textoCliente: 'Belgrano 450', cotizacion: q }).ok).toBe(false);
  });
});

describe('revisión del 9/10: lo que NO tiene que crear el pedido', () => {
  it('retiro: el nombre entero tiene que ser el de la cotización; dudas, esperas, otro producto o emojis no confirman', () => {
    const juan = { ...base, cotizacion: { ...base.cotizacion, nombre: 'Juan' } };
    for (const t of ['Juan te aviso', 'Juan ahí te aviso', 'Juan dejame ver', 'Juan te confirmo', 'Juan hay estacionamiento', 'Juan tenes sprite', 'Juan y una coca', 'Juan y dos cocas', 'Juan 👍', 'Dejalo', 'Olvidate', 'Nah', 'Nop', 'Tampoco', 'Chau']) {
      expect([t, cierraConElDato({ ...juan, textoCliente: t }).ok]).toEqual([t, false]);
    }
    // el modelo anotó «Leandro» y el cliente escribió otro apellido: en la duda, «¿Lo confirmo?»
    expect(cierraConElDato({ ...base, textoCliente: 'Para Leandro Alonso.' }).ok).toBe(false);
  });
  it('envío: la dirección entera y nada más', () => {
    const conEnvio = visto.replace('Es para retirar en la sucursal Saint Thomas. ¿A nombre de quién lo preparo?', '¿A qué dirección te lo enviamos, calle y número?');
    const q = { ...base.cotizacion, tipo: 'domicilio', nombre: 'Leandro', direccion: 'Mitre 1234, Canning' };
    const env = { ...base, ultimoBot: conEnvio, ultimosBot: [conEnvio], cotizacion: q };
    for (const t of ['Mitre 1234, lo pienso y te aviso', 'Mitre 1234, mañana te confirmo', 'Mitre 1234, nah dejalo', 'Mitre 1234, olvidate', 'Mitre 1234 + 2 cocas', 'Mitre 1234, y una coca', 'Mitre 1234 🤔', 'Mitre 1234, Canning, si podés que llegue antes de las ocho.', 'Mitre 12', 'Mitre 1234 piso 3']) {
      expect([t, cierraConElDato({ ...env, textoCliente: t }).ok]).toEqual([t, false]);
    }
    expect(cierraConElDato({ ...env, textoCliente: 'Mitre 1234' }).ok).toBe(true);
    expect(cierraConElDato({ ...env, textoCliente: 'Sí, Mitre 1234, Canning' }).ok).toBe(true);
  });
  it('mismo precio pero otro producto: no es la lista que vio', () => {
    const otra = { ...base.cotizacion, renglones: renglones.map((r, i) => (i === 0 ? { ...r, nombre: 'Coca Cola Original x1.75L' } : r)) };
    expect(cierraConElDato({ ...base, textoCliente: 'Leandro', cotizacion: otra }).ok).toBe(false);
  });
  it('cuenta solo la ÚLTIMA lista con total: una vieja de antes de un cambio no sirve', () => {
    const nueva = visto.replace('*Total: $128.200*', '*Total: $130.500*').replace('• Absolut — 1 × $33.500 c/u = $33.500', '• Absolut — 1 × $35.800 c/u = $35.800');
    // el cliente vio la de $128.200 hace dos mensajes, pero lo último que vio es la de $130.500
    expect(cierraConElDato({ ...base, textoCliente: 'Leandro', ultimoBot: '¿A nombre de quién lo preparo?', ultimosBot: ['¿A nombre de quién lo preparo?', nueva, visto] }).ok).toBe(false);
    // con la vieja como última lista, sí
    expect(cierraConElDato({ ...base, textoCliente: 'Leandro', ultimoBot: '¿A nombre de quién lo preparo?', ultimosBot: ['¿A nombre de quién lo preparo?', visto, nueva] }).ok).toBe(true);
  });
});

describe('nombreDeQuienRetira', () => {
  it('lee el nombre y nada más', () => {
    expect(nombreDeQuienRetira('A nombre de leandro')).toBe('Leandro');
    expect(nombreDeQuienRetira('lo retira Ana Pérez')).toBe('Ana Pérez');
    expect(nombreDeQuienRetira('Cancelalo')).toBeNull();
    expect(nombreDeQuienRetira('a mi nombre')).toBeNull();
    expect(nombreDeQuienRetira('el sábado')).toBeNull();
  });
});
