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
});
