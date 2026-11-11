import { claveNecesidad, contextoDeNecesidad, etiquetaDeNecesidad, explicacionDeNecesidad, necesidadEnUnaLinea, parteDeNecesidad, resumenDeNecesidad } from './necesidad';
import { armarPropuestas } from './propuesta';
import { ordenarPorNecesidad } from './abastecimiento.service';

// NECESIDAD (Leandro, 11/11/2026): «el sistema tiraba azúcar de 50 gramos falta,
// pero no daba el contexto de que había azúcar de 100 o de otra marca». Los
// casos salen de los datos reales de ese día.

let serie = 0;
const fila = (nombre: string, x: any = {}) => {
  serie++;
  return {
    producto_id: `p${serie}`, sku: `S${serie}`, nombre, categoria: 'AZUCAR', sucursal_id: 'st', sucursal: 'Suc Sant Thomas',
    stock: 0, en_camino: 0, ritmo_dia: 0, cobertura_dias: null, proveedor_id: 'pv1', proveedor: 'Ledesma', proveedor_faltan: [],
    plazo_dias: 7, plazo_fuente: 'sin confirmar', alerta: null, cantidad_sugerida: 0, ultimo_costo: 1000, ...x,
  };
};
const de = (ctx: Map<string, any>, f: any) => ctx.get(claveNecesidad(f.producto_id, f.sucursal_id));

describe('el contexto de cada aviso', () => {
  it('falta un azúcar, pero queda otro: no es un hueco, y dice cuál lo cubre', () => {
    const falta = fila('Azucar impalpable Dos Anclas x 300 gr', { alerta: 'sin_stock', ritmo_dia: 0.08 });
    const chango = fila('Azucar Impalpable Chango x 250gr', { stock: 15, ritmo_dia: 0.21, cobertura_dias: 71 });
    const ledesma = fila('Azucar Ledesma Comun x 1 kg', { stock: 71, ritmo_dia: 3.09, cobertura_dias: 23 });
    const nc = de(contextoDeNecesidad([falta, chango, ledesma]), falta);
    expect(nc.nivel).toBe('falta_opcion');
    // gana el que comparte «impalpable», no el que más se vende
    expect(nc.cubre.nombre).toBe('Azucar Impalpable Chango x 250gr');
    expect(nc.conStock).toBe(2);
    expect(etiquetaDeNecesidad(nc, 'sin_stock')).toBe('Hay reemplazo');
    expect(explicacionDeNecesidad(nc)).toBe('Lo cubre: Azucar Impalpable Chango x 250gr (stock 15, alcanza 71 días) y 1 más.');
  });

  it('otra marca del mismo tipo también cuenta: «azúcar de otra marca»', () => {
    const falta = fila('Azucar Arcor comun x 1 kg', { alerta: 'sin_stock', ritmo_dia: 0.24 });
    const ledesma = fila('Azucar Ledesma Light x 500g', { stock: 10, ritmo_dia: 3, cobertura_dias: 3 });
    const nc = de(contextoDeNecesidad([falta, ledesma]), falta);
    expect(nc.nivel).toBe('falta_opcion');
    expect(etiquetaDeNecesidad(nc, 'sin_stock')).toBe('Hay parecidos');
    expect(explicacionDeNecesidad(nc)).toBe('Quedan otros de lo mismo: Azucar Ledesma Light x 500g (stock 10, alcanza 3 días).');
  });

  it('el mismo producto en otro tamaño es el mejor reemplazo', () => {
    const falta = fila('Coca Cola 1.75l', { categoria: 'Gaseosas', alerta: 'no_llega', stock: 3, ritmo_dia: 2, cobertura_dias: 1.5 });
    const zero = fila('Coca Cola Zero x1.75L', { categoria: 'Gaseosas', stock: 400, ritmo_dia: 44, cobertura_dias: 9 });
    const lata = fila('Coca Cola lata 354cc', { categoria: 'Gaseosas', stock: 45, ritmo_dia: 8, cobertura_dias: 5 });
    const nc = de(contextoDeNecesidad([falta, zero, lata]), falta);
    expect(nc.cubre.nombre).toBe('Coca Cola lata 354cc');
    expect(nc.cubre.fuerza).toBe(0);
    expect(explicacionDeNecesidad(nc)).toMatch(/^Está en otro tamaño: Coca Cola lata 354cc/);
  });

  it('si no queda nada de lo mismo con stock, es un hueco', () => {
    const falta = fila('Sandwich de Miga Clasico x4', { categoria: 'Panaderia', alerta: 'sin_stock', ritmo_dia: 1.2 });
    const otro = fila('Sandwich de Miga Especial x4', { categoria: 'Panaderia', stock: 0, ritmo_dia: 0.4 });
    const nc = de(contextoDeNecesidad([falta, otro]), falta);
    expect(nc.nivel).toBe('hueco');
    expect(etiquetaDeNecesidad(nc, 'sin_stock')).toBe('Hueco');
    expect(etiquetaDeNecesidad(nc, 'no_llega')).toBe('Se viene un hueco');
    expect(explicacionDeNecesidad(nc)).toBe('No queda nada de lo mismo con stock en este local.');
  });

  it('compartir solo la primera palabra no alcanza si son de otra categoría: Red Bull no se cubre con Red Point', () => {
    const falta = fila('Red Bull', { categoria: 'Energizantes', alerta: 'no_llega', stock: 20, ritmo_dia: 8.87, cobertura_dias: 2 });
    const cigarrillos = fila('Red Point Box x 20', { categoria: 'TABACO', stock: 38, ritmo_dia: 3.08, cobertura_dias: 12 });
    expect(de(contextoDeNecesidad([falta, cigarrillos]), falta).nivel).toBe('hueco');
  });

  it('con el tipo de varias palabras la categoría no importa: los purés de tomate viven en tres', () => {
    const falta = fila('Pure de tomate Molto x 520gr', { categoria: 'Almacen', alerta: 'sin_stock', ritmo_dia: 0.04 });
    const otro = fila('Pure de Tomates Salsati x520gr', { categoria: 'SALSAS Y ADEREZOS', stock: 27, ritmo_dia: 0.41, cobertura_dias: 66 });
    const nc = de(contextoDeNecesidad([falta, otro]), falta);
    expect(nc.nivel).toBe('falta_opcion');
    expect(nc.cubre.nombre).toBe('Pure de Tomates Salsati x520gr');
  });

  it('el que más se vende de lo suyo es «el principal», aunque queden otros', () => {
    const falta = fila('Hielo Bolsa 5KG', { categoria: 'Varios', alerta: 'no_llega', stock: 53, ritmo_dia: 7.51, cobertura_dias: 7 });
    const grande = fila('Hielo Bolsa 15KG', { categoria: 'Varios', stock: 52, ritmo_dia: 2.24, cobertura_dias: 23 });
    const nc = de(contextoDeNecesidad([falta, grande]), falta);
    expect(nc.nivel).toBe('falta_principal');
    expect(nc.pesoPct).toBe(77);
    expect(etiquetaDeNecesidad(nc, 'no_llega')).toBe('El principal no llega');
    expect(explicacionDeNecesidad(nc)).toBe('Es el 77 % de lo que se vende de lo mismo acá. Queda: Hielo Bolsa 15KG (stock 52, alcanza 23 días).');
  });

  it('en una familia ancha, el principal se mide contra los suyos (queso provoleta) y la marca sola no reemplaza', () => {
    const relleno = Array.from({ length: 30 }, (_, i) => fila(`Queso Variedad${i} Marca${i} x 200g`, { categoria: 'quesos', stock: 5, ritmo_dia: 1, cobertura_dias: 5 }));
    const falta = fila('Queso Provoleta Santa Rosa Parrillera', { categoria: 'quesos', alerta: 'sin_stock', ritmo_dia: 4 });
    const otra = fila('Queso Provoleta La Sorianita', { categoria: 'quesos', stock: 7, ritmo_dia: 1, cobertura_dias: 7 });
    const ctx = contextoDeNecesidad([...relleno, falta, otra]);
    expect(de(ctx, falta).nivel).toBe('falta_principal');
    expect(de(ctx, falta).pesoPct).toBe(80);
    expect(de(ctx, falta).cubre.nombre).toBe('Queso Provoleta La Sorianita');

    // misma marca, otra variedad, familia ancha: queda como «parecidos», no como reemplazo
    const protein = fila('Queso Protein La Serenisima x 500gr', { categoria: 'quesos', alerta: 'sin_stock', ritmo_dia: 0.2 });
    const rallado = fila('Queso Rallado La Serenisima x 175 gr', { categoria: 'quesos', stock: 3, ritmo_dia: 2, cobertura_dias: 1 });
    const nc = de(contextoDeNecesidad([...relleno, protein, rallado]), protein);
    expect(nc.nivel).toBe('falta_opcion');
    expect(nc.cubre.fuerza).toBe(3);
    expect(etiquetaDeNecesidad(nc, 'sin_stock')).toBe('Hay parecidos');
  });

  it('sin stock y sin ventas: no urge, y no se propone traer nada', () => {
    const falta = fila('Azucar Ledesma rubia x 800g', { alerta: 'sin_stock', ritmo_dia: 0 });
    const enElOtro = { ...falta, sucursal_id: 'si', sucursal: 'Suc Santa Ines', alerta: null, stock: 40 };
    const nc = de(contextoDeNecesidad([falta, enElOtro]), falta);
    expect(nc.nivel).toBe('sin_venta');
    expect(nc.traspaso).toBeNull();
    expect(explicacionDeNecesidad(nc)).toBe('No registra ventas en el período: no urge.');
  });

  it('lo que solo bajó de 12 no lleva contexto: queda como estaba', () => {
    const f = fila('Azucar Tikay x 1k', { alerta: 'menos_de_12', stock: 1, ritmo_dia: 0.1 });
    expect(contextoDeNecesidad([f]).size).toBe(0);
  });

  it('un reemplazo de otro local no cuenta: cada local tiene su góndola', () => {
    const falta = fila('Azucar Arcor comun', { alerta: 'sin_stock', ritmo_dia: 0.24 });
    const enElOtro = fila('Azucar Ledesma Comun x 1 kg', { sucursal_id: 'si', sucursal: 'Suc Santa Ines', stock: 71, ritmo_dia: 3 });
    expect(de(contextoDeNecesidad([falta, enElOtro]), falta).nivel).toBe('hueco');
  });
});

describe('pasar entre locales antes de comprar', () => {
  const par = (aca: any, alla: any) => {
    const f = fila('Schneider x473cc', { categoria: 'Cervezas', ...aca });
    const o = { ...f, sucursal_id: 'si', sucursal: 'Suc Santa Ines', alerta: null, ...alla };
    return { f, o };
  };

  it('si al otro local le sobra, dice cuánto traer sin dejarlo corto', () => {
    // acá vende 1 por día y no tiene; allá hay 127 y vende 2 por día (se guarda 14 días = 28)
    const { f, o } = par({ alerta: 'sin_stock', ritmo_dia: 1 }, { stock: 127, ritmo_dia: 2 });
    const nc = de(contextoDeNecesidad([f, o]), f);
    expect(nc.traspaso).toEqual({ desdeId: 'si', desde: 'Santa Inés', sobra: 99, cantidad: 14 });
    expect(necesidadEnUnaLinea(nc, 'sin_stock')).toBe('Hueco. No queda nada de lo mismo con stock en este local. En Santa Inés sobran 99: se pueden traer 14.');
  });

  it('si el otro local también lo necesita, no se le saca', () => {
    const { f, o } = par({ alerta: 'sin_stock', ritmo_dia: 1 }, { stock: 20, ritmo_dia: 2 });
    expect(de(contextoDeNecesidad([f, o]), f).traspaso).toBeNull();
  });

  it('lo que ya viene en camino descuenta lo que hay que traer', () => {
    const { f, o } = par({ alerta: 'no_llega', stock: 2, en_camino: 10, ritmo_dia: 1, cobertura_dias: 2 }, { stock: 100, ritmo_dia: 0 });
    expect(de(contextoDeNecesidad([f, o]), f).traspaso.cantidad).toBe(2);
  });
});

describe('el resumen y el parte de la mañana', () => {
  const hueco = fila('Sandwich de Miga Clasico x4', { categoria: 'Panaderia', alerta: 'sin_stock', ritmo_dia: 2, ultimo_costo: 5000, proveedor_id: 'pvA', proveedor: 'Panificadora' });
  const seViene = fila('Red Bull', { categoria: 'Energizantes', alerta: 'no_llega', stock: 5, ritmo_dia: 8, cobertura_dias: 0.6, proveedor_id: 'pvB', proveedor: 'Luvik' });
  const redBullAlla = { ...seViene, sucursal_id: 'si', sucursal: 'Suc Santa Ines', alerta: null, stock: 200, ritmo_dia: 1 };
  const principal = fila('Hielo Bolsa 5KG', { categoria: 'Varios', alerta: 'sin_stock', ritmo_dia: 7.5, ultimo_costo: 900, proveedor_id: 'pvA', proveedor: 'Panificadora' });
  const hielo15 = fila('Hielo Bolsa 15KG', { categoria: 'Varios', stock: 52, ritmo_dia: 2.2, cobertura_dias: 23 });
  const conReemplazo = fila('Azucar Arcor comun', { alerta: 'sin_stock', ritmo_dia: 0.2 });
  const ledesma = fila('Azucar Ledesma Comun x 1 kg', { stock: 71, ritmo_dia: 3, cobertura_dias: 23 });
  const sinVenta = fila('Azucar Ledesma rubia x 800g', { alerta: 'sin_stock' });
  const filas = [hueco, seViene, redBullAlla, principal, hielo15, conReemplazo, ledesma, sinVenta];
  const r = resumenDeNecesidad(filas);

  it('cuenta por local qué es hueco, qué se viene, qué es principal y qué tiene reemplazo', () => {
    expect(r.porSucursal['Saint Thomas']).toEqual({ huecos: 1, huecosSemanales: 1, seVienen: 1, principales: 1, principalesSemanales: 1, conReemplazo: 1, sinVenta: 1, traspasables: 1 });
    expect(r.porSucursal['Santa Inés']).toBeUndefined();
  });

  it('destaca lo que más venta deja afuera y a quién pedirle primero', () => {
    expect(r.destacados['Saint Thomas']).toEqual(['Sandwich de Miga Clasico x4', 'Hielo Bolsa 5KG']);
    expect(r.proveedores[0]).toEqual({ proveedor: 'Panificadora', huecos: 1, principales: 1 });
    expect(r.traspasos).toEqual([{ desdeId: 'si', desde: 'Santa Inés', haciaId: 'st', hacia: 'Saint Thomas', productos: 1, unidades: 107, ejemplos: [{ producto: 'Red Bull', cantidad: 107 }] }]);
  });

  it('el parte arranca por los huecos y los principales, y dice qué traer del otro local', () => {
    const parte = parteDeNecesidad(r);
    expect(parte.titulo).toBe('Compras: 1 hueco en góndola y 1 producto principal en falta');
    expect(parte.lineas).toEqual([
      'Saint Thomas: 1 huecos, no queda nada de lo mismo (1 de venta semanal); 1 principales en falta (1 de venta semanal); 1 huecos que se vienen; 1 que tienen reemplazo en el local.',
      'Lo que más venta deja afuera en Saint Thomas: Sandwich de Miga Clasico x4, Hielo Bolsa 5KG.',
      'Antes de comprar: 1 se pueden traer de Santa Inés a Saint Thomas.',
      'A quién pedirle primero: Panificadora (2), Luvik (1).',
    ]);
  });

  it('sin avisos urgentes no hay parte nuevo: sale el de siempre', () => {
    expect(parteDeNecesidad(resumenDeNecesidad([ledesma]))).toEqual({ titulo: null, lineas: [] });
  });
});

describe('la nota de pedido con contexto', () => {
  const hueco = fila('Sandwich de Miga Clasico x4', { categoria: 'Panaderia', alerta: 'no_llega', stock: 1, ritmo_dia: 2, cobertura_dias: 0.5, cantidad_sugerida: 30 });
  const conReemplazo = fila('Azucar Arcor comun', { alerta: 'sin_stock', ritmo_dia: 0.2, cobertura_dias: 0, cantidad_sugerida: 6 });
  const ledesma = fila('Azucar Ledesma Comun x 1 kg', { stock: 71, ritmo_dia: 3, cobertura_dias: 23 });
  const sinVenta = fila('Azucar Ledesma rubia x 800g', { alerta: 'sin_stock', cantidad_sugerida: 12 });
  const bajo = fila('Azucar Tikay x 1k', { alerta: 'menos_de_12', stock: 1, ritmo_dia: 0.1, cobertura_dias: 10, cantidad_sugerida: 11 });
  const filas = [sinVenta, conReemplazo, bajo, hueco, ledesma];
  const necesidad = contextoDeNecesidad(filas);

  it('arriba va el hueco; lo que no se vende, al final; nada sale de la nota ni cambia su tilde', () => {
    const [nota] = armarPropuestas(filas, { necesidad });
    expect(nota.items.map((i) => i.nombre)).toEqual(['Sandwich de Miga Clasico x4', 'Azucar Arcor comun', 'Azucar Tikay x 1k', 'Azucar Ledesma rubia x 800g']);
    expect(nota.items.map((i) => i.tildado)).toEqual([true, true, false, true]);
    expect(nota.items[0].necesidad).toMatchObject({ nivel: 'hueco', etiqueta: 'Se viene un hueco' });
    // comparten «comun»: es reemplazo; el otro que queda es el Tikay
    expect(nota.items[1].necesidad?.explicacion).toBe('Lo cubre: Azucar Ledesma Comun x 1 kg (stock 71, alcanza 23 días) y 1 más.');
    expect(nota.items[2].necesidad).toBeUndefined();
    expect(nota.huecos).toBe(1);
    expect(nota.urgentes).toBe(3);
  });

  it('sin contexto, la nota sale exactamente como antes', () => {
    const [nota] = armarPropuestas(filas);
    expect(nota.items.map((i) => i.nombre)).toEqual(['Azucar Arcor comun', 'Azucar Ledesma rubia x 800g', 'Sandwich de Miga Clasico x4', 'Azucar Tikay x 1k']);
    expect(nota.items.every((i) => i.necesidad === undefined)).toBe(true);
    expect(nota.huecos).toBeUndefined();
  });

  it('la lista del agente también arranca por lo que deja la góndola vacía, sin perder el orden del motor', () => {
    expect(ordenarPorNecesidad(filas, necesidad).map((f) => f.nombre)).toEqual([
      'Sandwich de Miga Clasico x4', 'Azucar Arcor comun', 'Azucar Tikay x 1k', 'Azucar Ledesma Comun x 1 kg', 'Azucar Ledesma rubia x 800g',
    ]);
    expect(ordenarPorNecesidad(filas, new Map())).toBe(filas);
  });
});
