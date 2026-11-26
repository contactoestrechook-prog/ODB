// LOS AVISOS SALEN ESTÉ DONDE ESTÉ (26/11/2026). Juan Pablo estaba haciendo una factura, entró
// una consulta por una leche y no la podía ver ni contestar sin salir de la factura: con
// cualquier ventana abierta la pila de avisos se escondía entera (quedaba solo la alarma).
// Leandro: «quiere que la consulta o pedido salga la solapa, esté donde esté en el sistema».
// Esta prueba frena si la pila vuelve a esconderse con una ventana abierta o si los avisos se
// desmontan al achicarse (se cortaría la alarma de la regla con candado).
import { readFileSync } from 'fs';
import { join } from 'path';
import { nombreDeAviso, textoDeSolapa } from '../../../admin/app/lib/pila-avisos';

const ADMIN = join(__dirname, '../../../admin/app');
const leer = (archivo: string) => readFileSync(join(ADMIN, archivo), 'utf8');

describe('Avisos de consultas y pedidos con una ventana abierta', () => {
  it('la pila del layout es PilaAvisos, sin la clase que la esconde con una ventana abierta', () => {
    const layout = leer('layout.tsx');
    const apertura = layout.split('\n').find((l) => l.includes('<PilaAvisos '));
    expect(apertura).toBeDefined();
    expect(apertura).toContain('pila-avisos');
    expect(apertura).not.toContain('flotante-ocultable');
    // la consulta del cliente y el pedido nuevo van adentro
    const adentro = layout.slice(layout.indexOf('<PilaAvisos '), layout.indexOf('</PilaAvisos>'));
    expect(adentro).toContain('<AvisoPreguntaCliente');
    expect(adentro).toContain('<AvisoPedidoNuevo');
    expect(adentro).toContain('<AvisoConsultasArmado');
  });

  it('ninguna regla de estilo esconde la pila con una ventana abierta', () => {
    const css = leer('globals.css');
    const reglas = css.split('}').filter((r) => /\.pila-avisos/.test(r));
    expect(reglas.some((r) => /data-modal-abierto/.test(r))).toBe(false);
  });

  it('achicada, la pila esconde los avisos pero no los desmonta (siguen sonando)', () => {
    const f = leer('ui/PilaAvisos.tsx');
    expect(f).toMatch(/className=\{unir\('flex flex-col gap-2', esconder && 'hidden'\)\}>\s*\{children\}/);
    expect(f).not.toMatch(/esconder\s*\?\s*null|esconder\s*&&\s*children|!esconder\s*&&/);
  });

  it('Esc escribiendo en un aviso no cierra la ventana de abajo', () => {
    expect(leer('ui/kit/Modal.tsx')).toMatch(/closest\('\.pila-avisos'\)\) return;/);
  });

  it('la solapa nombra cada aviso como se entiende', () => {
    expect(nombreDeAviso('Pedido nuevo DOM-151CAD773262')).toBe('Llegó un pedido');
    expect(nombreDeAviso('Pregunta de Carla')).toBe('Pregunta de Carla');
    expect(nombreDeAviso('Pregunta del armado del pedido DOM-1')).toBe('Pregunta del armado del pedido DOM-1');
    expect(textoDeSolapa(['Pregunta de Carla'])).toBe('Pregunta de Carla');
    expect(textoDeSolapa(['Pregunta de Carla', 'Pedido nuevo DOM-1', 'Pedido nuevo DOM-2'])).toBe('Pregunta de Carla y 2 más');
    expect(textoDeSolapa([])).toBe('');
  });
});
