import { CtaCteResumenesService } from './cta-cte-resumenes.service';

// «El usuario dueño… en caso de que las quiera dar de baja, las puede dar de baja o no;
// si no, habilitáselo» (Leandro, 25/11/2026). Un dueño da de baja aunque la cuenta deba
// (la deuda sigue); gerencia, solo sin deuda. Queda en la auditoría.

function base(saldo: number) {
  const updates: any[] = [];
  const auditoria: any[] = [];
  const db: any = {
    from: (tabla: string) => {
      const q: any = {
        select: () => q,
        eq: () => q,
        maybeSingle: async () => ({ data: { saldo_cta_cte: saldo }, error: null }),
        update: (fila: any) => { updates.push({ tabla, fila }); return { eq: async () => ({ error: null }) }; },
        insert: (fila: any) => { if (tabla === 'auditoria') auditoria.push(fila); return Promise.resolve({ error: null }); },
      };
      return q;
    },
  };
  return { s: new CtaCteResumenesService(db), updates, auditoria };
}

const DUENO = { sub: 'U-JP', rol: 'dueno', roles: ['dueno'] };
const GERENTE = { sub: 'U-G', rol: 'gerente', roles: ['gerente'] };

describe('dar de baja una cuenta corriente', () => {
  it('un dueño la da de baja aunque deba: la deuda queda y se anota en la auditoría', async () => {
    const { s, updates, auditoria } = base(250000);
    await expect(s.cambiarCliente('C1', { habilitada: false }, DUENO)).resolves.toEqual({ ok: true });
    expect(updates).toEqual([{ tabla: 'clientes', fila: { cta_cte_habilitada: false } }]);
    expect(auditoria).toEqual([expect.objectContaining({ usuario_id: 'U-JP', accion: 'cta_cte_baja', entidad_id: 'C1', datos_despues: { habilitada: false, deuda: 250000 } })]);
  });

  it('gerencia no da de baja una cuenta que debe', async () => {
    const { s, updates } = base(250000);
    await expect(s.cambiarCliente('C1', { habilitada: false }, GERENTE)).rejects.toThrow('la da de baja un dueño');
    expect(updates).toEqual([]);
  });

  it('sin deuda, gerencia o dueño la dan de baja', async () => {
    for (const u of [GERENTE, DUENO]) {
      const { s, updates } = base(0);
      await expect(s.cambiarCliente('C1', { habilitada: false }, u)).resolves.toEqual({ ok: true });
      expect(updates).toHaveLength(1);
    }
  });

  it('volver a abrirla queda anotado', async () => {
    const { s, auditoria } = base(250000);
    await s.cambiarCliente('C1', { habilitada: true }, DUENO);
    expect(auditoria[0]).toMatchObject({ accion: 'cta_cte_reabrir', datos_despues: { habilitada: true, deuda: 0 } });
  });
});
