import { autorDe, codigoDePedido, fechaValida, normalizarArmado, notasDelPedido, precioDistinto, resumenDeCharla, textoDelMensaje, transcripcion } from './charla-a-pedido';

// La charla de Liliana del 14/11/2026, recortada: la cerró una persona desde el
// teléfono y el pedido nunca entró al sistema.
const LILIANA = [
  { role: 'user', content: 'Hola, quiero 30 sidras Victoria' },
  { role: 'assistant', content: 'Te anoto: • 30 × Sidra Victoria (5 cajas de 6) ¿Querés sumar algo?' },
  { role: 'assistant', content: 'siii', de: 'telefono', en: '2026-11-14T11:00:00Z' },
  { role: 'user', content: 'Bueno Haceme la cuenta [metadatos: telefono del chat = 123]' },
  { role: 'user', content: [{ type: 'text', text: 'Perfecto Déjalo Asi' }, { type: 'tool_result', content: 'x' }] },
];

describe('pasar a pedido desde la charla', () => {
  it('saca el texto de cada mensaje sin las marcas internas', () => {
    expect(textoDelMensaje(LILIANA[3])).toBe('Bueno Haceme la cuenta');
    expect(textoDelMensaje(LILIANA[4])).toBe('Perfecto Déjalo Asi');
    expect(textoDelMensaje({ role: 'user', content: '[el cliente mandó este PDF] [adjunto sin leer: https://x.supabase.co/storage/v1/a.pdf?token=1]' })).toBe('[el cliente mandó este PDF] [adjunto]');
    expect(textoDelMensaje({ role: 'user', content: null })).toBe('');
  });

  it('distingue al cliente, a la persona desde el teléfono y al bot', () => {
    expect(LILIANA.map(autorDe)).toEqual(['cliente', 'bot', 'persona', 'cliente', 'cliente']);
  });

  it('arma la transcripción con quién habló, y si no entra se queda con lo último', () => {
    const t = transcripcion(LILIANA as any);
    expect(t.split('\n')).toEqual([
      'Cliente: Hola, quiero 30 sidras Victoria',
      'Casa (bot): Te anoto: • 30 × Sidra Victoria (5 cajas de 6) ¿Querés sumar algo?',
      'Casa (persona): siii',
      'Cliente: Bueno Haceme la cuenta',
      'Cliente: Perfecto Déjalo Asi',
    ]);
    const corta = transcripcion(LILIANA as any, 80, 50);
    expect(corta).toBe('Cliente: Perfecto Déjalo Asi');
  });

  it('resume la charla para la lista', () => {
    const r = resumenDeCharla(LILIANA as any);
    expect(r.ultimo).toEqual({ texto: 'Perfecto Déjalo Asi', de: 'cliente' });
    expect(r.mensajesCliente).toBe(3);
    expect(r.hablaDeProductos).toBe(true);
    expect(r.atendidaPorPersona).toBe(true);
    const saludo = resumenDeCharla([{ role: 'user', content: 'Hola, ¿a qué hora abren?' }, { role: 'assistant', content: 'De 8 a 21.' }]);
    expect(saludo.hablaDeProductos).toBe(false);
    expect(saludo.atendidaPorPersona).toBe(false);
    expect(resumenDeCharla([]).ultimo).toBeNull();
  });

  it('el código del pedido tiene la forma de los del bot', () => {
    expect(codigoDePedido('b29da9d8-af4f-4f14-9fcd-e5c5e734ee63', 'envio')).toBe('DOM-B29DA9D8AF4F');
    expect(codigoDePedido('b29da9d8-af4f-4f14-9fcd-e5c5e734ee63', 'retiro')).toBe('PICKUP-B29DA9D8AF4F');
  });

  it('solo acepta fechas reales', () => {
    expect(fechaValida('2026-11-16')).toBe('2026-11-16');
    expect(fechaValida('2026-02-30')).toBeNull();
    expect(fechaValida('16/11')).toBeNull();
    expect(fechaValida(null)).toBeNull();
  });

  it('limpia lo que devuelve la IA', () => {
    const a = normalizarArmado({
      items: [{ producto: ' Sidra Victoria ', cantidad: 30, precioDicho: 3900 }, { producto: '', cantidad: 2 }, { producto: 'Hielo', cantidad: 0 }, { producto: 'Coca', cantidad: '6', precioDicho: 0 }],
      nombre: 'Liliana', tipo: 'envio', direccion: 'Juana de Arco 7300', entregaFecha: '2026-11-16', franja: 'mañana',
      formaPago: 'Transferencia', recibe: 'Mai', notas: null, dudas: ['El precio: Jackie dijo $3.900', 7],
    });
    expect(a.items).toEqual([{ producto: 'Sidra Victoria', cantidad: 30, precioDicho: 3900 }, { producto: 'Coca', cantidad: 6, precioDicho: null }]);
    expect(a).toMatchObject({ nombre: 'Liliana', tipo: 'envio', entregaFecha: '2026-11-16', formaPago: 'transferencia', recibe: 'Mai', notas: null });
    expect(a.dudas).toEqual(['El precio: Jackie dijo $3.900']);
    expect(normalizarArmado({ tipo: 'moto', formaPago: 'cheque', entregaFecha: 'el lunes' })).toMatchObject({ items: [], tipo: null, formaPago: null, entregaFecha: null });
    expect(normalizarArmado(null).items).toEqual([]);
  });

  it('las notas del pedido dicen quién recibe, lo que no se encontró y el precio de la charla', () => {
    expect(notasDelPedido({
      recibe: 'Mai', notas: 'Dejar en la administración del barrio', sinMatch: ['hielo rolito'],
      preciosDichos: [{ producto: 'Sidra Victoria', dicho: 3900, sistema: 2700 }], sinReserva: true,
    })).toBe('Recibe Mai · Dejar en la administración del barrio · No encontrado en el catálogo: hielo rolito · En la charla se dijo $3.900 por Sidra Victoria (sistema $2.700) · Sin reserva de stock: no alcanzaba al cargarlo');
    expect(notasDelPedido({})).toBe('');
  });

  it('marca el precio distinto solo si se aleja más del 1 %', () => {
    expect(precioDistinto(3900, 2700)).toBe(true);
    expect(precioDistinto(2710, 2700)).toBe(false);
    expect(precioDistinto(null, 2700)).toBe(false);
    expect(precioDistinto(3900, null)).toBe(false);
  });
});

import { origenDelPedido } from '../avisos/aviso-pedido';

describe('el aviso a administración de un pedido pasado desde la charla', () => {
  it('dice que lo cargó una persona en el panel, aunque tenga fila del bot', () => {
    expect(origenDelPedido({ qr_retiro: 'DOM-ABC', canal: 'domicilio', esDelBot: true, origen: 'charla' })).toBe('panel');
    expect(origenDelPedido({ qr_retiro: 'DOM-ABC', canal: 'domicilio', esDelBot: true, origen: 'bot' })).toBe('bot');
  });
});
