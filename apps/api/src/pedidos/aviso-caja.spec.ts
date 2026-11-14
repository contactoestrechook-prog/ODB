import { esDeMiSucursal, lecturaDeLaCola } from '../../../admin/app/lib/aviso-caja';

// La ventana «Llegó un pedido» de las cajas (13/11/2026): cada caja, lo de su
// sucursal; y una sesión vencida se avisa en vez de apagar la ventana.
describe('aviso de pedido nuevo en las cajas', () => {
  const CENTRAL = 'suc-central';
  const OTRA = 'suc-otra';

  it('la caja de la central ve los pedidos de la central', () => {
    expect(esDeMiSucursal({ sucursal_id: CENTRAL }, CENTRAL)).toBe(true);
  });

  it('la caja de la otra sucursal no ve (ni suena por) los de la central', () => {
    expect(esDeMiSucursal({ sucursal_id: CENTRAL }, OTRA)).toBe(false);
  });

  it('quien no tiene sucursal (dueños, cajera que rota) los ve todos', () => {
    expect(esDeMiSucursal({ sucursal_id: CENTRAL }, null)).toBe(true);
    expect(esDeMiSucursal({ sucursal_id: OTRA }, undefined)).toBe(true);
  });

  it('un pedido sin sucursal le llega a todos', () => {
    expect(esDeMiSucursal({ sucursal_id: null }, OTRA)).toBe(true);
    expect(esDeMiSucursal({}, CENTRAL)).toBe(true);
  });

  it('sin sesión avisa y sigue; sin permiso se apaga; lo demás reintenta', () => {
    expect(lecturaDeLaCola(200)).toBe('ok');
    expect(lecturaDeLaCola(401)).toBe('sin_sesion');
    expect(lecturaDeLaCola(403)).toBe('sin_permiso');
    expect(lecturaDeLaCola(500)).toBe('reintentar');
    expect(lecturaDeLaCola(502)).toBe('reintentar');
  });
});
