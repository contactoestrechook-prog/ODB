import { Pantalla } from '../ui/kit/Pantalla';
import { Aviso, Pestanas } from '../ui/kit';
import { apiFetch } from '../../lib/api';
import { RepartoWorkspace } from '../ui/RepartoWorkspace';
import { RepartidoresWorkspace } from '../ui/RepartidoresWorkspace';
import { RepartidorView } from '../ui/RepartidorView';

export const dynamic = 'force-dynamic';

// UN solo módulo de reparto (Leandro, 21/10/2026: «repartidor, repartidores y
// reparto tiene que ser solo un módulo con submódulos»). Antes eran tres
// entradas del menú; ahora son tres secciones de esta pantalla.
const VISTAS = [
  { valor: 'rutas', etiqueta: 'Hojas de ruta', href: '/reparto' },
  { valor: 'repartidores', etiqueta: 'Repartidores', href: '/reparto?vista=repartidores' },
  { valor: 'entregas', etiqueta: 'Entregas en la calle', href: '/reparto?vista=entregas' },
] as const;
type Vista = (typeof VISTAS)[number]['valor'];

export default async function RepartoPage({ searchParams }: { searchParams: Promise<{ vista?: string }> }) {
  const { vista: pedida } = await searchParams;
  const vista: Vista = VISTAS.some((v) => v.valor === pedida) ? (pedida as Vista) : 'rutas';

  return (
    <Pantalla activo="/reparto" ancho={vista === 'entregas' ? 'normal' : 'ancho'}>
      <div className="space-y-4 sm:space-y-6">
        <Pestanas etiquetaAccesible="Secciones de reparto" valor={vista} opciones={VISTAS.map((v) => ({ ...v }))} aLoAncho />
        {vista === 'rutas' && <HojasDeRuta />}
        {vista === 'repartidores' && <Repartidores />}
        {vista === 'entregas' && <RepartidorView />}
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
