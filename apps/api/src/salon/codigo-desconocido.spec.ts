import { BadRequestException } from '@nestjs/common';
import { SalonService } from './salon.service';

// UN CÓDIGO QUE EL SISTEMA NO CONOCE (Leandro, 20/11/2026: «estoy escaneando el
// código del Saphirus sabor bebé y me dice que el código no está en el sistema»).
// El Saphirus Textil VARIOS tiene cargado un solo código y cada fragancia trae el
// suyo: quien arma dice cuál del pedido es y el código queda aprendido.

const SAPH = 'p-saph';
function armar(codigos: Record<string, { producto_id: string; nombre: string }> = {}) {
  const escrituras: { tabla: string; op: string; fila: any }[] = [];
  const from = (tabla: string) => {
    let filtro: Record<string, any> = {};
    let op = 'select';
    let fila: any = null;
    const q: any = {
      select: () => q,
      eq: (c: string, v: any) => { filtro[c] = v; return q; },
      insert: (f: any) => { op = 'insert'; fila = f; escrituras.push({ tabla, op, fila: f }); return q; },
      maybeSingle: async () => {
        if (tabla === 'pedidos') return { data: { id: 'P1', estado: 'en_preparacion', asignado_a: 'u-melina', items: [{ producto_id: SAPH, cantidad: 1 }] }, error: null };
        if (tabla === 'codigos_barras') { const c = codigos[filtro.codigo]; return { data: c ? { producto_id: c.producto_id, producto: { nombre: c.nombre } } : null, error: null }; }
        if (tabla === 'productos') return { data: filtro.id === SAPH ? { nombre: 'Aromatizante Saphirus Textil VARIOS', sku: 'L7454' } : null, error: null };
        return { data: null, error: null };
      },
      single: async () => ({ data: { id: 77, creado_en: '2026-11-20T17:00:00Z' }, error: null }),
      then: (ok: any, mal: any) => Promise.resolve({ data: null, error: null }).then(ok, mal),
    };
    void op; void fila;
    return q;
  };
  const s = new SalonService({ from } as any, {} as any, {} as any, {} as any);
  return { s, escrituras };
}
const MELINA = { sub: 'u-melina', rol: 'op_salon', roles: ['op_salon'] };

describe('un código que el sistema no conoce, al armar', () => {
  it('escaneado solo: avisa que no lo conoce y devuelve el código leído (la pantalla pregunta cuál es)', async () => {
    const { s } = armar();
    const e = await s.sumarAlCarro('P1', { codigo: ' 7798184680219 ' }, MELINA).catch((x) => x);
    expect(e).toBeInstanceOf(BadRequestException);
    expect(e.getResponse()).toMatchObject({ codigo: 'CODIGO_DESCONOCIDO', message: 'Ese código no está en el sistema', leido: '7798184680219' });
  });

  it('dice cuál del pedido es: el código queda aprendido, va al carro por código y queda en el historial', async () => {
    const { s, escrituras } = armar();
    const r = await s.sumarAlCarro('P1', { codigo: '7798184680219', productoId: SAPH, cantidad: 1, aprender: true }, MELINA);
    expect(r).toMatchObject({ ok: true, productoId: SAPH, cantidad: 1 });
    expect(escrituras.find((w) => w.tabla === 'codigos_barras')?.fila).toEqual({ codigo: '7798184680219', producto_id: SAPH });
    expect(escrituras.find((w) => w.tabla === 'pedidos_carro')?.fila).toMatchObject({ producto_id: SAPH, por_codigo: true, usuario_id: 'u-melina' });
    expect(escrituras.find((w) => w.tabla === 'pedidos_historial')?.fila).toMatchObject({ evento: 'codigo', detalle: { codigo: '7798184680219', producto: 'Aromatizante Saphirus Textil VARIOS', aprendido: true } });
  });

  it('nunca le saca el código a otro producto, ni aprende uno mal leído o de un producto que no es del pedido', async () => {
    const { s, escrituras } = armar({ '7791293049458': { producto_id: 'p-rexona', nombre: 'Antitranspirante Rexona Masculino antibacterial x 90g' } });
    await expect(s.sumarAlCarro('P1', { codigo: '7791293049458', productoId: SAPH, aprender: true }, MELINA)).rejects.toThrow('Ese código ya es de Antitranspirante Rexona Masculino antibacterial x 90g: no es este');
    await expect(s.sumarAlCarro('P1', { codigo: '12', productoId: SAPH, aprender: true }, MELINA)).rejects.toThrow('Ese código no se leyó bien');
    await expect(s.sumarAlCarro('P1', { codigo: '7798184680219', productoId: 'p-otro', aprender: true }, MELINA)).rejects.toThrow('Ese producto no está en el pedido');
    expect(escrituras.filter((w) => w.tabla === 'codigos_barras')).toHaveLength(0);
  });

  it('solo quien tiene el pedido (o quien ve todo el armado)', async () => {
    const { s } = armar();
    await expect(s.sumarAlCarro('P1', { codigo: '7798184680219', productoId: SAPH, aprender: true }, { sub: 'u-luka', rol: 'deposito', roles: ['deposito'] })).rejects.toThrow('Ese pedido no te lo asignaron a vos');
  });
});
