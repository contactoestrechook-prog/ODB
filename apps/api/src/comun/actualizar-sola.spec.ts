// EL PANEL SE ACTUALIZA SOLO (27/11/2026). Juan Pablo seguía dos días después sin «Cuenta
// corriente» al entregar (publicada el 25/11 14:53) porque tenía la pestaña abierta desde antes
// y el aviso de versión nueva nunca recargaba. Ver apps/admin/app/lib/actualizar-sola.ts.
import { readFileSync } from 'fs';
import { join } from 'path';
import { esCampoParaEscribir, QUIETO_MS, sePuedeActualizar, type MomentoDelPanel } from '../../../admin/app/lib/actualizar-sola';

const quieto: MomentoDelPanel = { ahora: 1_000_000, ultimaActividad: 1_000_000 - QUIETO_MS, ventanaAbierta: false, escribiendo: false, avisosEnPantalla: 0 };

describe('El panel se actualiza solo cuando no se pierde nada', () => {
  it('con la pantalla quieta 3 minutos y nada abierto, se recarga', () => {
    expect(QUIETO_MS).toBe(3 * 60_000);
    expect(sePuedeActualizar(quieto)).toBe(true);
  });

  it('no se recarga mientras alguien la usa, con una ventana abierta, escribiendo o con un aviso de pedido', () => {
    expect(sePuedeActualizar({ ...quieto, ultimaActividad: quieto.ahora - QUIETO_MS + 1000 })).toBe(false);
    expect(sePuedeActualizar({ ...quieto, ventanaAbierta: true })).toBe(false);
    expect(sePuedeActualizar({ ...quieto, escribiendo: true })).toBe(false);
    expect(sePuedeActualizar({ ...quieto, avisosEnPantalla: 1 })).toBe(false);
  });

  it('escribir es estar en un campo de texto, no en un botón o una tilde', () => {
    expect(esCampoParaEscribir({ tagName: 'INPUT', type: 'text' })).toBe(true);
    expect(esCampoParaEscribir({ tagName: 'input', type: 'search' })).toBe(true);
    expect(esCampoParaEscribir({ tagName: 'INPUT' })).toBe(true);
    expect(esCampoParaEscribir({ tagName: 'TEXTAREA' })).toBe(true);
    expect(esCampoParaEscribir({ tagName: 'SELECT' })).toBe(true);
    expect(esCampoParaEscribir({ tagName: 'DIV', isContentEditable: true })).toBe(true);
    expect(esCampoParaEscribir({ tagName: 'INPUT', type: 'checkbox' })).toBe(false);
    expect(esCampoParaEscribir({ tagName: 'BUTTON' })).toBe(false);
    expect(esCampoParaEscribir({ tagName: 'BODY' })).toBe(false);
    expect(esCampoParaEscribir(null)).toBe(false);
  });

  it('el aviso recarga solo con la regla, y «Ahora no» no frena la actualización', () => {
    const f = readFileSync(join(__dirname, '../../../admin/app/ui/AvisoActualizacion.tsx'), 'utf8');
    const auto = f.slice(f.indexOf('const probar = () =>'), f.indexOf('MIRAR_CADA_MS);'));
    expect(auto).toContain('sePuedeActualizar(');
    expect(auto).toContain('window.location.reload()');
    expect(auto).toContain("dataset.modalAbierto === '1'");
    expect(auto).toContain('.pila-avisos section[aria-label]');
    // la versión nueva se anota ANTES de mirar si dijeron «Ahora no»
    const mirar = f.slice(f.indexOf('const mirar = useCallback'), f.indexOf('}, []);'));
    expect(mirar.indexOf('setHayVersion(true)')).toBeGreaterThan(-1);
    expect(mirar.indexOf('setHayVersion(true)')).toBeLessThan(mirar.indexOf('localStorage.getItem(OMITIDA)'));
  });
});
