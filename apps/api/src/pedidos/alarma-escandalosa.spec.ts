import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import * as alarma from '../../../admin/app/lib/alarma-pedido';

// ============================================================
// CANDADO — LA ALARMA DE LOS PEDIDOS (Leandro, 21/11/2026: «necesito que todos los
// pop-ups de ODB de pedido hagan un ruido escandaloso en todas las máquinas, ok, sin
// excepción, con candado esta regla»).
//
// Si una de estas pruebas falla, NO se publica. No se arregla bajando la prueba: la
// regla la cambia Leandro, no una sesión. Lo que cuida:
//  1. la alarma suena al máximo desde el primer toque y se repite seguido;
//  2. no queda ninguna forma de sonar bajito (sonarAlarma con nivel, nivelDe, esperaDe);
//  3. «Llegó un pedido» suena por todo pedido sin tomar, de cualquier sucursal;
//  4. todo aviso de pedido del panel usa la alarma, y uno nuevo que no la use frena;
//  5. «Llegó un pedido» está en TODAS las máquinas con sesión (sin filtro de rol), con
//     su lista abierta a cualquier rol en la API.
// ============================================================

const ADMIN = join(__dirname, '../../../admin/app');
const API = join(__dirname, '..');
const leer = (archivo: string) => readFileSync(join(ADMIN, archivo), 'utf8');

/** Los avisos de pedido del panel, con cómo suenan. */
const AVISOS_DE_PEDIDO: Record<string, string> = {
  'ui/AvisoPedidoNuevo.tsx': 'Llegó un pedido: sin parar hasta que alguien lo toma, en todas las máquinas',
  'ui/AvisoFiambreria.tsx': 'Pedido con fiambrería: sin parar hasta que fiambrería lo toma',
  'ui/AvisoTeTocaArmar.tsx': 'Te toca armar: sin parar hasta que lo abre',
  'ui/AvisoConsultasArmado.tsx': 'Pregunta del armado / Devolvieron un pedido: sin parar hasta que se atiende',
  'ui/AvisoPreguntaCliente.tsx': 'Pregunta de un cliente: sin parar hasta que se contesta o se cierra',
  'ui/AvisoPedidosSinAviso.tsx': 'El aviso del pedido no salió: sin parar hasta «Ya avisé al local»',
  'ui/salon/Armar.tsx': 'El armado que se abre solo (asignado / te lo sacaron): ráfaga al llegar',
  'ui/ArmadoPantalla.tsx': 'Lo que contesta el cliente o la caja mientras se arma: ráfaga al llegar',
};

/** Lo que vibra, suena o avisa pero NO es un aviso de pedido (con el porqué). */
const NO_SON_AVISOS_DE_PEDIDO: Record<string, string> = {
  'lib/alarma-pedido.ts': 'es la alarma',
  'lib/usar-alarma.ts': 'es cómo se hace sonar la alarma',
  'ui/AvisoSonidoApagado.tsx': 'despierta el audio en todas las máquinas',
  'ui/ComandasEstaPc.tsx': 'el botón «Probar la alarma»',
  'ui/CamaraCodigo.tsx': 'vibra al leer un código de barras',
  'ui/AvisosCelular.tsx': 'la pantalla para activar los avisos en el celular (no es una ventana)',
};

const USA_LA_ALARMA = /\b(useAlarmaHastaQueSeAtienda|useRafagaAlLlegar|sonarRafaga)\(/;
const SONIDO_BAJITO = /\b(sonarAlarma|nivelDe|esperaDe|SUBE_EN_MS)\b/;

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (n === 'node_modules' || n.startsWith('.')) return [];
    if (statSync(p).isDirectory()) return archivos(p);
    return /\.(tsx?|jsx?)$/.test(n) ? [relative(ADMIN, p).split('\\').join('/')] : [];
  });
}

describe('CANDADO · la alarma de los pedidos suena escandalosa', () => {
  it('al máximo desde el primer toque, con compresor, cuatro golpes, y se repite cada 2 segundos como mucho', () => {
    expect(alarma.ALARMA.volumen).toBe(1);
    expect(alarma.ALARMA.empuje).toBeGreaterThanOrEqual(2);
    expect(alarma.ALARMA.golpesPorToque).toBeGreaterThanOrEqual(4);
    expect(alarma.ALARMA.entreToquesMs).toBeLessThanOrEqual(2_000);
    expect(alarma.ALARMA.toquesAlLlegar).toBeGreaterThanOrEqual(4);
    const fuente = leer('lib/alarma-pedido.ts');
    expect(fuente).toMatch(/createDynamicsCompressor\(\)/);
    expect(fuente).toMatch(/gain\.exponentialRampToValueAtTime\(ALARMA\.volumen/);
  });

  it('no queda ninguna forma de sonar bajito ni de crecer de a poco', () => {
    expect((alarma as any).sonarAlarma).toBeUndefined();
    expect((alarma as any).nivelDe).toBeUndefined();
    expect((alarma as any).esperaDe).toBeUndefined();
    expect((alarma as any).SUBE_EN_MS).toBeUndefined();
    expect(typeof alarma.sonarEscandalo).toBe('function');
  });

  it('el sonido sin parar no mira la pantalla, la pestaña ni la sucursal: suena mientras haya algo', () => {
    const f = leer('lib/usar-alarma.ts');
    expect(f).toMatch(/sonarEscandalo\(\);\s*\n\s*reloj = setTimeout\(tocar, ALARMA\.entreToquesMs\)/);
    expect(f).not.toMatch(/visibilityState|usePathname|sucursal|pospuest/i);
  });
});

describe('CANDADO · «Llegó un pedido» suena por todo pedido sin tomar', () => {
  const ahora = Date.parse('2026-11-21T15:00:00Z');
  const hace = (h: number) => new Date(ahora - h * 3600_000).toISOString();
  it('de cualquier sucursal, también los de anoche; no los tomados ni los que ya se arman', () => {
    const lista = [
      { id: 'central', estado: 'recibido', tomado_por: null, creado_en: hace(0.1), sucursal_id: 'st-thomas' },
      { id: 'otra', estado: 'pagado', tomado_por: null, creado_en: hace(0.2), sucursal_id: 'santa-ines' },
      { id: 'anoche', estado: 'recibido', tomado_por: null, creado_en: hace(20), sucursal_id: 'st-thomas' },
      { id: 'tomado', estado: 'recibido', tomado_por: 'u1', creado_en: hace(0.1), sucursal_id: 'st-thomas' },
      { id: 'armando', estado: 'en_preparacion', tomado_por: null, creado_en: hace(0.1), sucursal_id: 'st-thomas' },
      { id: 'viejisimo', estado: 'recibido', tomado_por: null, creado_en: hace(49), sucursal_id: 'st-thomas' },
    ];
    expect(alarma.pedidosQueSuenan(lista, ahora).map((p) => p.id)).toEqual(['central', 'otra', 'anoche']);
  });

  it('la ventana lee la lista abierta a todos y no tiene «Más tarde» ni filtro de sucursal para sonar', () => {
    const f = leer('ui/AvisoPedidoNuevo.tsx');
    expect(f).toContain("fetch('/api/pedidos?vista=sin-tomar'");
    expect(f).toMatch(/pedidosQueSuenan\(/);
    expect(f).toMatch(/useAlarmaHastaQueSeAtienda\(suena\)/);
    expect(f).toMatch(/const suena = visibles\.length > 0 && !esRutaDeAcceso\(ruta\)/);
    expect(f).toMatch(/const visibles = pedidos;/);
    expect(f).not.toMatch(/pospuest|POSPONER|callar/i);
  });

  it('está en TODAS las máquinas con sesión: en el layout, sin condición de rol', () => {
    const layout = leer('layout.tsx');
    const linea = layout.split('\n').find((l) => l.includes('<AvisoPedidoNuevo'));
    expect(linea).toBeDefined();
    expect(linea!.trim().startsWith('{token && <AvisoPedidoNuevo')).toBe(true);
    expect(layout.split('\n').some((l) => l.trim().startsWith('{token && <AvisoSonidoApagado'))).toBe(true);
  });

  it('en la API la lista de sin tomar se abre a cualquier rol (también al que solo arma y a fiambrería)', () => {
    const c = readFileSync(join(API, 'pedidos/pedidos.controller.ts'), 'utf8');
    expect(c).toMatch(/@ParaCualquierRol\(\)\s*\n\s*@Get\('pedidos\/sin-tomar'\)/);
  });
});

describe('CANDADO · todo aviso de pedido usa la alarma escandalosa', () => {
  const todos = archivos(ADMIN);

  it.each(Object.entries(AVISOS_DE_PEDIDO))('%s (%s)', (archivo) => {
    const f = leer(archivo);
    expect(f).toMatch(/from '(\.\.\/)+lib\/usar-alarma'/);
    expect(f).toMatch(USA_LA_ALARMA);
    expect(f).not.toMatch(SONIDO_BAJITO);
  });

  it('un aviso nuevo que suena, vibra o avisa tiene que estar en la lista (si no es de pedido, decir por qué)', () => {
    const conAviso = todos.filter((a) => {
      const f = readFileSync(join(ADMIN, a), 'utf8');
      return /navigator\.vibrate|AudioContext|new Notification\(|lib\/alarma-pedido'|lib\/usar-alarma'/.test(f);
    });
    const sinRevisar = conAviso.filter((a) => !(a in AVISOS_DE_PEDIDO) && !(a in NO_SON_AVISOS_DE_PEDIDO));
    expect(sinRevisar).toEqual([]);
  });

  it('toda ventana «Aviso…» que habla de pedidos está en la lista', () => {
    const avisos = todos.filter((a) => /(^|\/)Aviso[^/]*\.tsx$/.test(a) && /pedido/i.test(readFileSync(join(ADMIN, a), 'utf8')));
    const sinRevisar = avisos.filter((a) => !(a in AVISOS_DE_PEDIDO) && !(a in NO_SON_AVISOS_DE_PEDIDO));
    expect(sinRevisar).toEqual([]);
  });

  it('ningún archivo del panel usa la forma vieja de sonar bajito', () => {
    const conBajito = todos.filter((a) => a !== 'lib/alarma-pedido.ts' && SONIDO_BAJITO.test(readFileSync(join(ADMIN, a), 'utf8')));
    expect(conBajito).toEqual([]);
  });
});
