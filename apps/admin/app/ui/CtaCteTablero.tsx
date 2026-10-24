'use client';

import { useCallback, useEffect, useState } from 'react';
import { Aviso, Boton, Cargando, Chips, Entrada, Kpi, Selector, Vacio } from './kit';
import { pesos } from '../lib/formato';
import { CtaCteResumenes } from './CtaCteResumenes';
import { CtaCteDetalle } from './CtaCteDetalle';
import { CtaCteAlta } from './CtaCteAlta';
import { CtaCteTarjeta, type CuentaTarjeta } from './CtaCteTarjeta';

// Cuentas corrientes: una tarjeta por cuenta (24/10/2026, «es una planilla
// eso»). Arriba la plata en la calle y lo disponible; abajo cada cuenta con lo
// que debe, su límite, lo último que compró y pagó. Cada número lleva a algo.

type Orden = 'deuda' | 'antigua' | 'sin-pagar' | 'limite' | 'compra' | 'nombre';
type Filtro = 'todos' | 'alto' | 'medio' | 'bajo' | 'mas-90' | 'excedidas' | 'sin-limite';

const ORDENES: Record<Orden, (a: CuentaTarjeta, b: CuentaTarjeta) => number> = {
  deuda: (a, b) => b.saldo - a.saldo,
  antigua: (a, b) => (b.deuda?.dias ?? -1) - (a.deuda?.dias ?? -1) || b.saldo - a.saldo,
  'sin-pagar': (a, b) => (b.diasSinPagar ?? 9999) - (a.diasSinPagar ?? 9999) || b.saldo - a.saldo,
  limite: (a, b) => (b.pctConsumido ?? -1) - (a.pctConsumido ?? -1),
  compra: (a, b) => (b.perfil?.total ?? 0) - (a.perfil?.total ?? 0),
  nombre: (a, b) => a.nombre.localeCompare(b.nombre, 'es'),
};

export function CtaCteTablero({ esDueno, tipo = 'cliente' }: { esDueno: boolean; tipo?: 'cliente' | 'sponsor' }) {
  const sponsors = tipo === 'sponsor';
  const [datos, setDatos] = useState<{ kpis: any; cuentas: CuentaTarjeta[] } | null>(null);
  const [error, setError] = useState('');
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [orden, setOrden] = useState<Orden>('deuda');
  // la cuenta abierta en la ficha; version recarga el resumen al cambiar un celular
  const [abierta, setAbierta] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [sumando, setSumando] = useState(false);
  const [busca, setBusca] = useState('');

  const cargar = useCallback(async () => {
    try {
      const r = await fetch(sponsors ? '/api/cta-cte?tipo=sponsor' : '/api/cta-cte');
      if (!r.ok) { setError('No pude cargar las cuentas'); return; }
      setDatos(await r.json());
      setError('');
    } catch { setError('Sin conexión'); }
  }, [sponsors]);
  useEffect(() => { cargar(); }, [cargar]);

  const guardarTope = async (clienteId: string, monto: number) => {
    const r = await fetch('/api/cta-cte', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clienteId, limiteCredito: monto }),
    });
    if (r.ok) cargar();
    else setError('No se pudo guardar el límite');
    return r.ok;
  };

  if (error && !datos) return <Aviso tono="error">{error}</Aviso>;
  if (!datos) return <Cargando bloque />;

  const { kpis } = datos;
  // sin tildes ni mayúsculas: «perez» encuentra «Pérez»; también por teléfono
  const llano = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const cuentas = datos.cuentas
    .filter((c) => {
      if (filtro === 'mas-90') return (c.deuda?.dias ?? 0) >= 90;
      if (filtro === 'excedidas') return c.excedido > 0;
      if (filtro === 'sin-limite') return c.limite <= 0;
      return filtro === 'todos' || c.riesgo === filtro;
    })
    .filter((c) => !busca.trim() || llano(`${c.nombre} ${c.telefono ?? ''}`).includes(llano(busca.trim())))
    .sort(ORDENES[orden]);
  const cuenta = (f: Filtro) => datos.cuentas.filter((c) => (f === 'mas-90' ? (c.deuda?.dias ?? 0) >= 90 : f === 'excedidas' ? c.excedido > 0 : f === 'sin-limite' ? c.limite <= 0 : f === 'todos' || c.riesgo === f)).length;

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-tinta/70">
          {sponsors ? 'Las cuentas de los sponsors del Wine Fest. ' : ''}Tocá una tarjeta para ver la cuenta completa y corregir los datos.
        </p>
        <Boton onClick={() => setSumando(true)}>{sponsors ? 'Sumar sponsor' : 'Sumar cuenta'}</Boton>
      </div>
      <CtaCteAlta
        abierto={sumando}
        tipo={tipo}
        onCerrar={() => setSumando(false)}
        onListo={(id) => { setSumando(false); setAbierta(id); setVersion((v) => v + 1); cargar(); }}
      />
      <CtaCteDetalle clienteId={abierta} esDueno={esDueno} onCerrar={() => setAbierta(null)} onCambio={() => { setVersion((v) => v + 1); cargar(); }} />
      {error && <Aviso tono="error">{error}</Aviso>}

      {/* la foto de toda la cartera */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <Kpi etiqueta="En la calle" valor={pesos(kpis.enLaCalle)} sub={`${kpis.clientesConSaldo} de ${kpis.clientesHabilitados} cuentas deben`} />
        <Kpi etiqueta="Días de deuda promedio" valor={kpis.diasDeudaPromedio != null ? `${kpis.diasDeudaPromedio} días` : '—'} sub={kpis.deuda90 ? `${kpis.deuda90} deben hace +90 días` : 'pesado por lo que debe cada uno'} tono={kpis.diasDeudaPromedio >= 45 ? 'error' : kpis.diasDeudaPromedio >= 20 ? 'atencion' : 'ok'} />
        <Kpi etiqueta="Ticket promedio" valor={pesos(kpis.ticketPromedio)} sub="últimos 6 meses" />
        <Kpi etiqueta="Pagaron (30 días)" valor={pesos(kpis.pagado30)} tono={kpis.pagado30 > 0 ? 'ok' : 'neutro'} />
        <Kpi etiqueta="Riesgo alto" valor={kpis.enRiesgo} tono={kpis.enRiesgo > 0 ? 'error' : 'ok'} />
        <Kpi etiqueta="Disponible para fiar" valor={pesos(kpis.disponibleTotal)} sub={`${kpis.sinTope} cuentas sin límite`} />
      </div>

      {/* buscar, filtrar y ordenar */}
      <div className="flex flex-wrap items-center gap-2">
        <Entrada value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por nombre o teléfono" aria-label="Buscar cuenta" type="search" className="min-w-0 grow basis-56" />
        <Selector value={orden} onChange={(e) => setOrden(e.target.value as Orden)} aria-label="Ordenar las cuentas" className="w-auto">
          <option value="deuda">Más deuda primero</option>
          <option value="antigua">Deuda más vieja primero</option>
          <option value="sin-pagar">Más tiempo sin pagar</option>
          <option value="limite">Más cerca del límite</option>
          <option value="compra">Los que más compran</option>
          <option value="nombre">Por nombre</option>
        </Selector>
      </div>
      <Chips
        etiquetaAccesible="Filtrar las cuentas"
        valor={filtro}
        onCambiar={setFiltro}
        opciones={([
          ['todos', 'Todas'], ['alto', 'Riesgo alto'], ['medio', 'Atención'], ['bajo', 'Al día'], ['mas-90', 'Deben hace +90 días'], ['excedidas', 'Pasadas del límite'], ['sin-limite', 'Sin límite'],
        ] as [Filtro, string][]).map(([valor, etiqueta]) => ({ valor, etiqueta: `${etiqueta} (${cuenta(valor)})` }))}
      />

      {cuentas.length ? (
        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {cuentas.map((c) => (
            <CtaCteTarjeta key={c.id} c={c} esDueno={esDueno} onAbrir={() => setAbierta(c.id)} onTope={(m) => guardarTope(c.id, m)} />
          ))}
        </div>
      ) : (
        <Vacio titulo="No hay cuentas con ese filtro." texto="Probá con otro nombre o sacá el filtro." />
      )}

      {/* el resumen por WhatsApp es uno solo para todas las cuentas: va en la vista de clientes */}
      {!sponsors && <CtaCteResumenes esDueno={esDueno} onAbrirCuenta={setAbierta} version={version} />}
    </div>
  );
}
