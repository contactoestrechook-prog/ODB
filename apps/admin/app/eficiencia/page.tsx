import { apiFetch } from '../../lib/api';
import { Aviso, Etiqueta, TablaResponsiva, Tarjeta, TarjetaCabecera, Vacio, unir } from '../ui/kit';
import { Pantalla } from '../ui/kit/Pantalla';
import { pesos } from '../lib/formato';

export const dynamic = 'force-dynamic';

function Barra({ valor, max, invertido }: { valor: number; max: number; invertido?: boolean }) {
  // invertido=true: menos es mejor (verde para los más bajos)
  const pct = max > 0 ? Math.max((valor / max) * 100, 3) : 0;
  return (
    <div className="mt-1 h-1.5 rounded-full bg-crema">
      <div className={unir('h-1.5 rounded-full', invertido ? 'bg-ok' : 'bg-marca')} style={{ width: `${pct}%` }} />
    </div>
  );
}

// El primero de cada ranking (antes un trofeo)
function Empleado({ nombre, primero, detalle }: { nombre: string; primero: boolean; detalle: string }) {
  return (
    <>
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-medium">
        <span className="min-w-0 break-words">{nombre}</span>
        {primero && <Etiqueta tono="ok">1°</Etiqueta>}
      </p>
      <p className="text-xs font-normal text-tinta/60">{detalle}</p>
    </>
  );
}

export default async function Eficiencia() {
  const [rc, rp] = await Promise.all([
    apiFetch('/eficiencia/cajeros'),
    apiFetch('/eficiencia/preparadores'),
  ]);
  const cajeros: any[] = rc.ok ? await rc.json() : [];
  const preparadores: any[] = rp.ok ? await rp.json() : [];

  const maxTph = Math.max(...cajeros.map((c) => Number(c.tickets_hora) || 0), 1);
  const maxPrep = Math.max(...preparadores.map((p) => Number(p.prep_min) || 0), 1);

  return (
    <Pantalla activo="/eficiencia">
      <Aviso tono="neutro" titulo="Ley ODB: todo medido, cada empleado cuantificado">
        El sistema cronometra cada operación y la atribuye a quien la hizo: el cajero por cada cliente, el repositor por cada pedido. Las métricas se llenan a medida que se opera.
      </Aviso>

      {/* CAJEROS */}
      <Tarjeta relleno={false} className="overflow-hidden">
        <TarjetaCabecera titulo="Cajeros · velocidad de atención" />
        <TablaResponsiva
          sinMarco
          etiqueta="Cajeros: velocidad de atención"
          filas={cajeros}
          claveFila="usuario"
          vacio={<Vacio className="m-4" titulo="Sin sesiones de caja medidas todavía." />}
          columnas={[
            {
              clave: 'empleado',
              titulo: 'Empleado',
              principal: true,
              celda: (c, i) => <Empleado nombre={c.usuario} primero={i === 0} detalle={`${c.rol} · ${c.sesiones} sesión(es)`} />,
            },
            { clave: 'tickets', titulo: 'Tickets', importe: true, celda: (c) => c.tickets },
            { clave: 'minCliente', titulo: 'Min/cliente', importe: true, claseCelda: 'font-medium', celda: (c) => `${c.min_por_ticket ?? '—'}′` },
            {
              clave: 'porHora',
              titulo: 'Clientes/hora',
              ancho: 'w-40',
              celda: (c) => (
                <div className="min-w-24">
                  <span className="text-xs">{c.tickets_hora ?? '—'}/h</span>
                  <Barra valor={Number(c.tickets_hora) || 0} max={maxTph} />
                </div>
              ),
            },
            { clave: 'facturado', titulo: 'Facturado', importe: true, claseCelda: 'text-tinta/70', celda: (c) => pesos(Number(c.monto) || 0) },
          ]}
        />
      </Tarjeta>

      {/* PREPARADORES */}
      <Tarjeta relleno={false} className="overflow-hidden">
        <TarjetaCabecera titulo="Preparación de pedidos · tiempo de armado" />
        <TablaResponsiva
          sinMarco
          etiqueta="Preparación de pedidos: tiempo de armado"
          filas={[...preparadores].sort((a, b) => Number(a.prep_min) - Number(b.prep_min))}
          claveFila="usuario"
          vacio={<Vacio className="m-4" titulo="Sin pedidos preparados medidos todavía." />}
          columnas={[
            {
              clave: 'empleado',
              titulo: 'Empleado',
              principal: true,
              celda: (p, i) => <Empleado nombre={p.usuario} primero={i === 0} detalle={p.rol} />,
            },
            { clave: 'pedidos', titulo: 'Pedidos', importe: true, celda: (p) => p.pedidos },
            {
              clave: 'armado',
              titulo: 'Tiempo de armado',
              ancho: 'w-48',
              celda: (p) => (
                <div className="min-w-24">
                  <span className="text-xs font-medium">{p.prep_min ?? '—'} min/pedido</span>
                  <Barra valor={Number(p.prep_min) || 0} max={maxPrep} invertido />
                </div>
              ),
            },
            { clave: 'entrega', titulo: 'Entrega', importe: true, claseCelda: 'text-tinta/70', celda: (p) => `${p.entrega_min ?? '—'} min` },
          ]}
        />
      </Tarjeta>
    </Pantalla>
  );
}
