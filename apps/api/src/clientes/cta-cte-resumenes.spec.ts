import { CtaCteResumenesService, Config } from './cta-cte-resumenes.service';

// Base de mentira: cada tabla devuelve sus filas, sin importar los filtros
// (los filtros los hace Supabase; acá se prueba el armado del mensaje).
function baseCon(tablas: Record<string, any>) {
  return {
    from: (t: string) => {
      const q: any = {};
      for (const m of ['select', 'eq', 'gt', 'gte', 'in', 'order', 'limit']) q[m] = () => q;
      q.maybeSingle = async () => ({ data: Array.isArray(tablas[t]) ? tablas[t][0] ?? null : tablas[t] ?? null, error: null });
      q.then = (ok: any) => ok({ data: tablas[t] ?? [], error: null });
      return q;
    },
  } as any;
}

const cfg: Config = {
  activo: false, dias: [1, 16], hora: 10, piso: 0,
  plantilla: 'Hola {nombre} 👋\n\nTu saldo es *{saldo}*.\n{movimientos}\nAlias *{alias}* ({titular}).',
};

describe('resumen de cuenta corriente por WhatsApp', () => {
  const hace3 = new Date(Date.now() - 3 * 86400_000).toISOString();
  const hace40 = new Date(Date.now() - 40 * 86400_000).toISOString();

  const db = baseCon({
    clientes: [
      { id: 'a', nombre: 'JUAN PEREZ', razon_social: null, telefono: '11 2281-2200', saldo_cta_cte: 152340.4 },
      { id: 'b', nombre: 'Bodega', razon_social: 'Distribuidora Sur SRL', telefono: '15 4444 5555', saldo_cta_cte: 9000 },
    ],
    lineas_whatsapp: [{ alias_pago: 'odb.vinos', titular_pago: 'ODB SRL' }],
    cta_cte_resumenes: [],
    cuenta_corriente: [
      { cliente_id: 'a', debe: 50000, haber: 0, creado_en: hace3 },
      { cliente_id: 'a', debe: 0, haber: 20000, creado_en: hace3 },
      { cliente_id: 'a', debe: 99999, haber: 0, creado_en: hace40 }, // antes de los 15 días: no cuenta
    ],
  });
  const s = new CtaCteResumenesService(db);

  it('arma el mensaje con nombre, saldo, movimientos y alias', async () => {
    const [juan] = await s.candidatos(cfg);
    expect(juan.destino).toBe('5491122812200');
    expect(juan.estado).toBe('pendiente');
    expect(juan.texto).toContain('Hola Juan 👋');
    expect(juan.texto).toContain('*$152.340*');
    expect(juan.texto).toContain('compras por $50.000 y pagos por $20.000');
    expect(juan.texto).not.toContain('99.999');
    expect(juan.texto).toContain('Alias *odb.vinos* (ODB SRL)');
  });

  it('una razón social va entera, sin movimientos no deja renglones vacíos, y un «15» sin área no se manda', async () => {
    const [, sur] = await s.candidatos(cfg);
    expect(sur.texto).toContain('Hola Distribuidora Sur SRL');
    expect(sur.texto).not.toMatch(/\n{3,}/);
    expect(sur.destino).toBeNull();
    expect(sur.estado).toBe('sin_telefono');
  });

  it('la próxima fecha cae en el 1 o el 16', () => {
    const p = s.proxima(cfg);
    expect(p).toMatch(/^\d{4}-\d{2}-(01|16)$/);
  });

  it('la ficha valida los datos antes de guardar', async () => {
    const update = jest.fn(() => ({ eq: async () => ({ error: null }) }));
    const s2 = new CtaCteResumenesService({ from: () => ({ update }) } as any);
    await expect(s2.cambiarCliente('a', { telefono: '15 4444 5555' })).rejects.toThrow('Ese celular no sirve');
    await expect(s2.cambiarCliente('a', { cuit: '20-123' })).rejects.toThrow('El CUIT tiene 11 números');
    await expect(s2.cambiarCliente('a', { nombre: '  ' })).rejects.toThrow('El nombre no puede quedar vacío');
    await s2.cambiarCliente('a', { telefono: '011 15 2281-2200', cuit: '20-12345678-9', email: '' , limite: 300000 });
    expect(update).toHaveBeenCalledWith({ telefono: '011 15 2281-2200', cuit: '20123456789', email: null, limite_credito: 300000 });
  });

  it('no deja cerrar una cuenta que debe', async () => {
    await expect(s.cambiarCliente('a', { habilitada: false })).rejects.toThrow('No se puede cerrar una cuenta que todavía debe');
  });

  it('sumar una cuenta nueva crea el cliente y abre la cuenta con su saldo inicial', async () => {
    const insert = jest.fn(() => ({ select: () => ({ single: async () => ({ data: { id: 'nuevo' }, error: null }) }) }));
    const rpc = jest.fn(async () => ({ data: 50000, error: null }));
    const s3 = new CtaCteResumenesService({ from: () => ({ insert }), rpc } as any);
    await expect(s3.abrirCuenta({ datos: { nombre: '' } })).rejects.toThrow('Falta el nombre');
    const r = await s3.abrirCuenta({ datos: { nombre: 'Ana Gómez', telefono: '11 5555-1234' }, tope: 200000, saldoInicial: 50000 });
    expect(insert).toHaveBeenCalledWith({ nombre: 'Ana Gómez', telefono: '11 5555-1234' });
    expect(rpc).toHaveBeenCalledWith('cta_cte_abrir', { p_cliente: 'nuevo', p_tope: 200000, p_saldo_inicial: 50000, p_nota: null });
    expect(r).toEqual({ clienteId: 'nuevo', saldo: 50000 });
  });

  it('se pueden cambiar todos los datos de la cuenta, con controles', async () => {
    const update = jest.fn(() => ({ eq: async () => ({ error: null }) }));
    const actual = { maybeSingle: async () => ({ data: { cuit: null, condicion_iva: 'consumidor_final' } }) };
    const db: any = { from: () => ({ update, select: () => ({ eq: () => actual }) }) };
    const s4 = new CtaCteResumenesService(db);
    await expect(s4.cambiarCliente('a', { dni: '123' })).rejects.toThrow('El DNI tiene 7 u 8 números');
    await expect(s4.cambiarCliente('a', { sucursal: 'xx' })).rejects.toThrow('Sucursal desconocida');
    await expect(s4.cambiarCliente('a', { condicionIva: 'responsable_inscripto' })).rejects.toThrow('necesita CUIT');
    await s4.cambiarCliente('a', { dni: '30.123.456', barrio: ' St Thomas ', sucursal: 'st', condicionIva: 'monotributo', fechaNacimiento: '1980-05-20', domicilio: 'Lote 12' });
    expect(update).toHaveBeenCalledWith({ dni: '30123456', barrio: 'St Thomas', sucursal: 'st', condicion_iva: 'monotributo', fecha_nacimiento: '1980-05-20', domicilio: 'Lote 12' });
  });

  it('el ajuste de saldo pide monto y motivo, y va por cta_cte_ajustar', async () => {
    const rpc = jest.fn(async () => ({ data: 90000, error: null }));
    const s5 = new CtaCteResumenesService({ rpc } as any);
    await expect(s5.ajustarSaldo('a', 0, 'error de carga')).rejects.toThrow('distinto de cero');
    await expect(s5.ajustarSaldo('a', -10000, '')).rejects.toThrow('Escribí el motivo');
    expect(await s5.ajustarSaldo('a', -10000, 'factura cargada dos veces')).toEqual({ saldo: 90000 });
    expect(rpc).toHaveBeenCalledWith('cta_cte_ajustar', { p_cliente: 'a', p_monto: -10000, p_motivo: 'factura cargada dos veces' });
  });
});
