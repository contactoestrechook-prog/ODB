import { cookies } from 'next/headers';
import { Pantalla } from '../ui/kit/Pantalla';
import { Aviso, Pestanas } from '../ui/kit';
import { apiFetch } from '../../lib/api';
import { EnviosWorkspace } from '../ui/EnviosWorkspace';
import { RepartoWorkspace } from '../ui/RepartoWorkspace';
import { RepartidoresWorkspace } from '../ui/RepartidoresWorkspace';
import { RepartidorView } from '../ui/RepartidorView';
import { puedeCargarRepartidores, rolDesdeToken } from '../lib/permisos';

export const dynamic = 'force-dynamic';

// UN solo módulo de reparto (Leandro, 21/10/2026: «repartidor, repartidores y
// reparto tiene que ser solo un módulo con submódulos»). Antes eran tres
// entradas del menú; ahora son secciones de esta pantalla. El mismo día entró
// Envíos (antes otra entrada del menú) como la primera: es lo que se despacha
// todos los días.
// «Mis entregas» y no «Entregas en la calle»: muestra solo lo que lleva quien
// está logueado (repartidor/mis-entregas), no todo lo que está afuera; eso
// está en Envíos. Es el mismo nombre que tiene en el menú de caja y depósito.
const VISTAS = [
  { valor: 'envios', etiqueta: 'Envíos', href: '/reparto' },
  { valor: 'rutas', etiqueta: 'Hojas de ruta', href: '/reparto?vista=rutas' },
  { valor: 'repartidores', etiqueta: 'Repartidores', href: '/reparto?vista=repartidores' },
  { valor: 'entregas', etiqueta: 'Mis entregas', href: '/reparto?vista=entregas' },
] as const;
type Vista = (typeof VISTAS)[number]['valor'];

export default async function RepartoPage({ searchParams }: { searchParams: Promise<{ vista?: string; pedido?: string }> }) {
  const { vista: pedida, pedido } = await searchParams;
  const vista: Vista = VISTAS.some((v) => v.valor === pedida) ? (pedida as Vista) : 'envios';
  const rol = rolDesdeToken((await cookies()).get('odb_token')?.value);

  return (
    // El ancho es el mismo en todas las secciones: si cambiara, la fila de
    // pestañas saltaría de lugar al tocar una. Mis entregas se angosta adentro.
    <Pantalla activo="/reparto" ancho="ancho">
      <div className="space-y-4 sm:space-y-6">
        <Pestanas etiquetaAccesible="Secciones de reparto" valor={vista} opciones={VISTAS.map((v) => ({ ...v }))} aLoAncho />
        {vista === 'envios' && <EnviosWorkspace destacar={pedido ?? null} puedeCargarRepartidor={puedeCargarRepartidores(rol)} />}
        {vista === 'rutas' && <HojasDeRuta />}
        {vista === 'repartidores' && <Repartidores />}
        {vista === 'entregas' && <div className="max-w-3xl"><RepartidorView /></div>}
      </div>
    </Pantalla>
  );
}

async function HojasDeRuta() {
  let repartos: any[] = [];
  let choferes: any[] = [];
  let error: string | null = null;
  try {
    const [rl, rc] = await Promise.all([apiFetch('/repartos'), apiFetch('/repartos/choferes')]);
    if (rl.ok) repartos = await rl.json();
    if (rc.ok) choferes = await rc.json();
    if (!rl.ok) throw new Error('La API respondió con error');
  } catch (e) {
    error = e instanceof Error ? e.message : 'Error desconocido';
  }
  if (error) return <Aviso tono="error">No pude consultar la API ({error}).</Aviso>;
  return <RepartoWorkspace repartos={repartos} choferes={choferes} />;
}

async function Repartidores() {
  let repartidores: any[] = [];
  try {
    const r = await apiFetch('/gestion/repartidores');
    if (r.ok) repartidores = await r.json();
  } catch {}
  return <RepartidoresWorkspace inicial={repartidores} />;
}
