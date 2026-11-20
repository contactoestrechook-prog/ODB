'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { numero } from '../../lib/formato';
import { codigoDe, entregaDe, haceCuanto, type PedidoCola } from '../../lib/pedidos';
import { ArmadoPantalla } from '../ArmadoPantalla';
import { AsignarArmado } from '../AsignarArmado';
import { Aviso, Boton, Chips, FOCO, FOCO_ADENTRO, Modal, ROTULO, Tarjeta, unir } from '../kit';
import { Recorrido } from './Recorrido';
import {
  api, avance, iniciales, MIN_ARRANQUE_TARDE, nombrePropio, reloj, sucursalCorta, useAhora, type PedidoArmar, type Sucursal,
} from './comun';

// ARMAR PEDIDOS (rediseño del 17/11/2026; Leandro: «pantalla digna, hoy es una
// poronga»). Para el que manda en el salón (dueño, gerente, caja, depósito) es
// la sala de control: qué espera a alguien que lo arme, quién está armando qué
// y por dónde va, qué quedó en la mesa de retiro y cómo viene cada uno. Para el
// op salón, en el celular, son sus pedidos y nada más.
//
// Colores de etapa, los mismos que en Pedidos: rojo = espera armador,
// ciruela = se está armando, verde = en la mesa de retiro.

type Preparador = { id: string; nombre: string; rol: string; area?: 'salon' | 'fiambreria' | 'deposito'; sucursal_id?: string | null };
// el área con que arma (19/11/2026: fiambrería y quien es de caja y también arma)
const AREA = { salon: 'Salón', fiambreria: 'Fiambrería', deposito: 'Depósito' } as const;
const areaDe = (g: Preparador) => AREA[g.area ?? (g.rol === 'op_salon' ? 'salon' : g.rol === 'fiambreria' ? 'fiambreria' : 'deposito')];
type Tiempo = { usuarioId: string; nombre: string; pedidos: number; minTotal: number | null; minArranque: number | null; segPorProducto: number | null; productos: number };

const ABIERTOS = ['recibido', 'pagado', 'en_preparacion'];

export function Armar({ verTodos, miId = null, sucursales, onCuenta, irAStock }: {
  verTodos: boolean;
  miId?: string | null;
  sucursales: Sucursal[];
  onCuenta: (n: number) => void;
  irAStock: () => void;
}) {
  const [pedidos, setPedidos] = useState<PedidoArmar[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [abierto, setAbierto] = useState<string | null>(null);
  // los que cerró a mano no se le vuelven a abrir solos
  const cerrados = useRef(new Set<string>());
  const [finalizado, setFinalizado] = useState<string | null>(null);
  // terminado el pedido, la pantalla vuelve a quedar libre (Leandro, 20/11/2026:
  // «que le salga de su pantalla, que le quede libre de vuelta, que no le quede cargada»)
  useEffect(() => {
    if (!finalizado) return;
    const t = setTimeout(() => setFinalizado(null), 12_000);
    return () => clearTimeout(t);
  }, [finalizado]);
  // LOS QUE LE SACARON (20/11/2026: «lo cambié pero a él no le llegó una alerta
  // de que ese pedido fue reasignado; le quedaron los dos pedidos para armar»).
  // Un pedido suyo que desaparece sin que lo haya terminado él: se lo pasaron a
  // otra persona o se canceló. Antes se iba sin decir nada (y si lo tenía
  // abierto, se le cerraba la pantalla de golpe).
  const propiosAntes = useRef<Map<string, string> | null>(null);
  const terminados = useRef(new Set<string>());
  const [sacados, setSacados] = useState<string[]>([]);
  const ahora = useAhora();

  const cargar = useCallback(async () => {
    try {
      const d = await api<PedidoArmar[]>('GET', { recurso: 'pedidos', ...(verTodos ? { todos: '1' } : {}) });
      setPedidos(d);
      if (!verTodos) onCuenta(d.length);
      // apenas le asignan un pedido, se le abre a pantalla completa. Al op salón,
      // todos los suyos; al que ve la sala de control (depósito, caja, dueños),
      // los que están a SU nombre (19/11/2026: a Pablo Avalos, de depósito, le
      // asignaron uno y no lo veía: quedaba abajo de los que esperan armador)
      const propios = verTodos ? d.filter((p) => !!miId && p.asignadoA === miId) : d;
      const antes = propiosAntes.current;
      if (antes) {
        const ids = new Set(propios.map((p) => p.id));
        const idos = [...antes].filter(([id]) => !ids.has(id) && !terminados.current.has(id)).map(([, codigo]) => codigo);
        if (idos.length) {
          setSacados((s) => [...new Set([...s, ...idos])]);
          try { navigator.vibrate?.([300, 100, 300]); } catch { /* sin vibración */ }
        }
      }
      propiosAntes.current = new Map(propios.map((p) => [p.id, p.codigo]));
      setAbierto((ya) => {
        if (ya && d.some((p) => p.id === ya)) return ya;
        const nuevo = propios.find((p) => !cerrados.current.has(p.id));
        if (nuevo) { try { navigator.vibrate?.([200, 100, 200]); } catch { /* sin vibración */ } }
        return nuevo?.id ?? null;
      });
      setError(null);
    } catch (e: any) { setError(e.message); }
  }, [verTodos, miId, onCuenta]);

  useEffect(() => { cargar(); const t = setInterval(cargar, 8000); return () => clearInterval(t); }, [cargar]);

  const actual = pedidos?.find((p) => p.id === abierto) ?? null;
  const mios = verTodos && miId ? (pedidos ?? []).filter((p) => p.asignadoA === miId) : [];
  const pantalla = actual && (
    <ArmadoPantalla
      p={actual}
      ahora={ahora}
      onVolver={() => { cerrados.current.add(actual.id); setAbierto(null); }}
      onTerminado={(texto) => { cerrados.current.add(actual.id); terminados.current.add(actual.id); setAbierto(null); setFinalizado(texto); }}
      onCambio={cargar}
      enviar={(cuerpo) => api('POST', cuerpo)}
    />
  );
  const avisoSacados = sacados.length > 0 && (
    <Aviso tono="atencion" titulo={sacados.length === 1 ? `Ya no armás el ${sacados[0]}` : `Ya no armás ${sacados.length} pedidos: ${sacados.join(', ')}`}
      accion={<Boton tamano="chico" variante="secundario" onClick={() => setSacados([])}>Entendido</Boton>}>
      Se lo pasaron a otra persona o se canceló: no lo armes. Si ya juntaste algo, devolvelo a la góndola o dáselo a quien lo arma ahora.
    </Aviso>
  );

  if (!verTodos) {
    return (
      <div className="space-y-3">
        {pantalla}
        {avisoSacados}
        {finalizado && <Aviso tono="ok" titulo="¡Listo!">{finalizado}</Aviso>}
        {error && <Aviso tono="error">{error}</Aviso>}
        {pedidos === null && !error && <p className="text-sm text-tinta/60">Buscando tus pedidos…</p>}
        {pedidos?.length === 0 && (
          <Tarjeta className="space-y-4">
            <div>
              <p className="text-base font-bold text-tinta">No tenés pedidos para armar</p>
              <p className="mt-1 text-sm text-tinta/70">Cuando la caja te asigne uno, se abre solo y el celular vibra.</p>
            </div>
            <div className="border-t border-black/[0.06] pt-4">
              <p className="text-sm text-tinta">Mientras tanto, cargá dónde está cada producto: así la lista de armado sale en el orden en que caminás el salón.</p>
              <Boton tamano="chico" variante="secundario" onClick={irAStock} className="mt-3">Cargar lugares</Boton>
            </div>
          </Tarjeta>
        )}
        {pedidos?.map((p) => (
          <PedidoEnArmado key={p.id} p={p} ahora={ahora} propio onVer={() => { cerrados.current.delete(p.id); setAbierto(p.id); }} />
        ))}
      </div>
    );
  }

  return (
    <>
      {pantalla}
      {avisoSacados}
      {/* lo que tiene a su nombre va primero, antes que la sala de control */}
      {mios.length > 0 && (
        <Seccion id="salon-mios" color="dato-3" titulo={mios.length === 1 ? 'Te toca armar este pedido' : 'Te toca armar estos pedidos'} cuenta={mios.length}
          bajada="Te lo asignaron a vos. Tocalo para abrirlo y empezar a cargar el carro.">
          {mios.map((p) => (
            <PedidoEnArmado key={p.id} p={p} ahora={ahora} propio onVer={() => { cerrados.current.delete(p.id); setAbierto(p.id); }} />
          ))}
        </Seccion>
      )}
      <SalaDeControl pedidos={pedidos} error={error} ahora={ahora} sucursales={sucursales} onCuenta={onCuenta} recargar={cargar}
        onVer={(id) => { cerrados.current.delete(id); setAbierto(id); }} finalizado={finalizado} irAStock={irAStock} />
    </>
  );
}

// ───────────────────────── la sala de control ─────────────────────────

function SalaDeControl({ pedidos, error, ahora, sucursales, onCuenta, recargar, onVer, finalizado, irAStock }: {
  pedidos: PedidoArmar[] | null; error: string | null; ahora: number; sucursales: Sucursal[];
  onCuenta: (n: number) => void; recargar: () => void; onVer: (id: string) => void; finalizado: string | null; irAStock: () => void;
}) {
  const [cola, setCola] = useState<PedidoCola[] | null>(null);
  const [gente, setGente] = useState<Preparador[] | null>(null);
  const [tiempos, setTiempos] = useState<Tiempo[] | null>(null);
  const [suc, setSuc] = useState('todas');
  const [asignando, setAsignando] = useState<PedidoCola | PedidoArmar | null>(null);

  const cargarCola = useCallback(async () => {
    const r = await fetch('/api/pedidos', { cache: 'no-store' }).catch(() => null);
    if (r?.ok) { const d = await r.json().catch(() => null); if (Array.isArray(d)) setCola(d); } else setCola((c) => c ?? []);
  }, []);
  useEffect(() => { cargarCola(); const t = setInterval(cargarCola, 8000); return () => clearInterval(t); }, [cargarCola]);
  useEffect(() => {
    const traerGente = () => api<Preparador[]>('GET', { recurso: 'preparadores' }).then(setGente).catch(() => setGente((g) => g ?? []));
    traerGente();
    // los tiempos son de dueños y gerentes: a los demás la API no se los da
    api<Tiempo[]>('GET', { recurso: 'tiempos', dias: '7' }).then(setTiempos).catch(() => setTiempos([]));
    const t = setInterval(traerGente, 60_000);
    return () => clearInterval(t);
  }, []);

  const nombreSuc = useMemo(() => new Map(sucursales.map((s) => [s.id, s.nombre])), [sucursales]);
  const deLaSucursal = useCallback((id: string | null | undefined, nombre?: string | null) => {
    if (suc === 'todas') return true;
    if (id) return id === suc;
    return !!nombre && nombre === nombreSuc.get(suc);
  }, [suc, nombreSuc]);

  const armando = (pedidos ?? []).filter((p) => deLaSucursal(p.sucursalId, p.sucursal));
  const esperan = (cola ?? [])
    .filter((p) => ABIERTOS.includes(p.estado) && !p.asignado_a && deLaSucursal(p.sucursal_id))
    .sort((a, b) => String(a.creado_en).localeCompare(String(b.creado_en)));
  const mesa = (cola ?? []).filter((p) => p.estado === 'listo' && deLaSucursal(p.sucursal_id));
  const genteSuc = (gente ?? []).filter((g) => suc === 'todas' || !g.sucursal_id || g.sucursal_id === suc);

  useEffect(() => { onCuenta(esperan.length + armando.length); }, [esperan.length, armando.length, onCuenta]);

  // cómo viene el armado: promedio de todos, pesado por pedidos
  const resumen = useMemo(() => {
    const t = (tiempos ?? []).filter((x) => x.minTotal != null);
    const n = t.reduce((a, x) => a + x.pedidos, 0);
    if (!n) return null;
    const total = t.reduce((a, x) => a + (x.minTotal ?? 0) * x.pedidos, 0) / n;
    const conArr = t.filter((x) => x.minArranque != null);
    const nArr = conArr.reduce((a, x) => a + x.pedidos, 0);
    const arranque = nArr ? conArr.reduce((a, x) => a + (x.minArranque ?? 0) * x.pedidos, 0) / nArr : null;
    return { pedidos: n, total, arranque };
  }, [tiempos]);

  const masViejo = esperan[0];
  const armadores = new Set(armando.map((p) => p.asignadoA ?? p.asignadoNombre)).size;
  const ir = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <div className="space-y-5">
      {sucursales.length > 1 && (
        <Chips etiquetaAccesible="Sucursal" valor={suc} onCambiar={setSuc} desplazable
          opciones={[{ valor: 'todas', etiqueta: 'Las dos sucursales' }, ...sucursales.map((s) => ({ valor: s.id, etiqueta: sucursalCorta(s.nombre) }))]} />
      )}

      {/* AHORA EN EL SALÓN: una sola línea de datos; cada número lleva a su lista */}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-black/[0.06] bg-black/[0.06] shadow-tarjeta lg:grid-cols-4">
        <Cifra color="marca" rotulo="Esperan quién lo arme" valor={cola ? esperan.length : null} onClick={() => ir('salon-esperan')}
          linea={masViejo ? `El más viejo entró ${haceCuanto(masViejo.creado_en, ahora)}` : 'Todo tiene quién lo arme'} />
        <Cifra color="dato-3" rotulo="Se están armando" valor={pedidos ? armando.length : null} onClick={() => ir('salon-armando')}
          linea={armando.length ? `${armadores} ${armadores === 1 ? 'persona armando' : 'personas armando'}` : 'Nadie armando ahora'} />
        <Cifra color="ok" rotulo="En la mesa de retiro" valor={cola ? mesa.length : null} onClick={() => ir('salon-mesa')}
          linea={mesa.length ? 'Listos para entregar o despachar' : 'La mesa está vacía'} />
        <Cifra color="tinta" rotulo="Armado · últimos 7 días" onClick={() => ir('salon-gente')}
          valor={resumen ? Math.round(resumen.total) : tiempos ? null : undefined} sufijo="min"
          linea={resumen ? `${numero(resumen.pedidos)} pedidos${resumen.arranque != null ? ` · arrancan en ${numero(resumen.arranque, 1)} min` : ''}` : tiempos ? 'Todavía nadie terminó uno con el celular' : ''} />
      </div>

      {finalizado && <Aviso tono="ok" titulo="¡Listo!">{finalizado}</Aviso>}
      {error && <Aviso tono="error">{error}</Aviso>}

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-5">
          <Seccion id="salon-esperan" color="marca" titulo="Esperan quién lo arme" cuenta={esperan.length}
            bajada="Se le asigna a alguien del salón: le llega al celular y por WhatsApp, y empieza a correr el reloj.">
            {cola === null ? <Fila><span className="text-sm text-tinta/60">Buscando…</span></Fila>
              : esperan.length === 0 ? <Fila><span className="text-sm text-tinta/70">Todos los pedidos abiertos tienen quién los arme.</span></Fila>
                : esperan.map((p) => <PedidoEsperando key={p.id} p={p} ahora={ahora} onAsignar={() => setAsignando(p)} />)}
          </Seccion>

          <Seccion id="salon-armando" color="dato-3" titulo="Se están armando" cuenta={armando.length}
            bajada={armando.some((p) => p.items.some((i) => i.ubicacion)) ? 'Cada punto es un producto, en el orden en que se camina el salón.' : 'Cada punto es un producto. Con los lugares cargados, salen en el orden en que se camina el salón.'}>
            {pedidos === null ? <Fila><span className="text-sm text-tinta/60">Buscando…</span></Fila>
              : armando.length === 0 ? (
                <Fila><span className="text-sm text-tinta/70">Nadie está armando ahora.{esperan.length ? ' Asigná uno de los que esperan.' : ''}</span></Fila>
              ) : armando.map((p) => (
                <PedidoEnArmado key={p.id} p={p} ahora={ahora} onVer={() => onVer(p.id)} onCambiar={() => setAsignando(p)} />
              ))}
          </Seccion>
        </div>

        <aside className="min-w-0 space-y-5">
          <Seccion id="salon-gente" color="tinta" titulo="La gente del salón" cuenta={genteSuc.length}
            bajada={tiempos?.length ? 'Lo de cada uno es de los últimos 7 días.' : undefined}>
            {gente === null ? <Fila><span className="text-sm text-tinta/60">Buscando…</span></Fila>
              : genteSuc.length === 0 ? <Fila><span className="text-sm text-tinta/70">No hay nadie de salón ni de depósito cargado. Se dan de alta en Equipo › Usuarios.</span></Fila>
                : <Gente gente={genteSuc} armando={pedidos ?? []} tiempos={tiempos ?? []} ahora={ahora} nombreSuc={nombreSuc} onVer={onVer} />}
          </Seccion>

          <Seccion id="salon-mesa" color="ok" titulo="En la mesa de retiro" cuenta={mesa.length}>
            {cola === null ? <Fila><span className="text-sm text-tinta/60">Buscando…</span></Fila>
              : mesa.length === 0 ? <Fila><span className="text-sm text-tinta/70">No hay nada esperando en la mesa.</span></Fila>
                : mesa.map((p) => (
                  <a key={p.id} href={`/pedidos?pedido=${p.id}`} className={unir('block px-4 py-3 transition-colors hover:bg-crema-claro', FOCO)}>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="importe min-w-0 truncate text-sm font-semibold text-tinta">{codigoDe(p)}</span>
                      <span className="shrink-0 text-xs text-tinta/60">{entregaCorta(p)}</span>
                    </div>
                    <p className="truncate text-sm text-tinta/70">{p.clienteNombre || 'Cliente sin nombre'}</p>
                    {p.asignadoNombre && (
                      <p className="mt-0.5 text-xs text-ok">Lo armó {nombrePropio(p.asignadoNombre)}{p.minutosArmado != null ? ` en ${numero(p.minutosArmado)} min` : ''}</p>
                    )}
                  </a>
                ))}
          </Seccion>

          {!(pedidos ?? []).some((p) => p.items.some((i) => i.ubicacion)) && <button type="button" onClick={irAStock} className={unir('block w-full rounded-2xl border border-dashed border-black/15 px-4 py-3 text-left text-sm text-tinta/70 transition-colors hover:border-black/25 hover:bg-white', FOCO)}>
            <span className="font-semibold text-tinta">¿Dónde está cada producto?</span> Con el lugar cargado, el que arma camina el salón en orden. Cargalo en Stock y ubicación →
          </button>}
        </aside>
      </div>

      {asignando && (
        <Modal abierto ancho="chico" onCerrar={() => setAsignando(null)}
          titulo={`¿Quién arma ${'qr_retiro' in asignando ? codigoDe(asignando) : asignando.codigo}?`}
          descripcion="Le aparece en el celular, le llega por WhatsApp y empieza a correr el reloj."
          pie={<Boton variante="secundario" onClick={() => setAsignando(null)}>Listo</Boton>}>
          <AsignarArmado
            key={asignando.id}
            p={'qr_retiro' in asignando ? asignando : { id: asignando.id, canal: asignando.canal, estado: asignando.estado, total: 0, qr_retiro: asignando.codigo, creado_en: asignando.asignadoEn, asignado_a: asignando.asignadoA ?? null, asignadoNombre: asignando.asignadoNombre }}
            onAsignado={() => { recargar(); cargarCola(); }}
          />
        </Modal>
      )}
    </div>
  );
}

const entregaCorta = (p: PedidoCola) => (p.canal === 'domicilio' ? 'Envío' : 'Retira');

// ───────────────────────── piezas ─────────────────────────

const COLOR = {
  marca: { texto: 'text-marca', fondo: 'bg-marca' },
  'dato-3': { texto: 'text-dato-3', fondo: 'bg-dato-3' },
  ok: { texto: 'text-ok', fondo: 'bg-ok' },
  tinta: { texto: 'text-tinta', fondo: 'bg-tinta' },
} as const;
type Color = keyof typeof COLOR;

function Cifra({ color, rotulo, valor, sufijo, linea, onClick }: {
  color: Color; rotulo: string; valor: number | null | undefined; sufijo?: string; linea: string; onClick: () => void;
}) {
  const cero = valor === 0 || valor === null;
  return (
    <button type="button" onClick={onClick}
      className={unir('relative min-w-0 bg-white px-4 pb-4 pt-5 text-left transition-colors hover:bg-crema-claro sm:px-5', FOCO_ADENTRO)}>
      <span aria-hidden="true" className={unir('absolute inset-x-0 top-0 h-1', COLOR[color].fondo, cero && 'opacity-30')} />
      <span className={unir(ROTULO, 'block min-h-8 lg:min-h-0')}>{rotulo}</span>
      <span className={unir('importe mt-1.5 flex items-baseline gap-1 text-3xl font-bold leading-none tracking-tight', cero ? 'text-tinta/40' : COLOR[color].texto)}>
        {valor === undefined ? '' : valor === null ? '—' : numero(valor)}
        {sufijo && valor != null && <span className="text-base font-semibold">{sufijo}</span>}
      </span>
      <span className="mt-2 line-clamp-2 block min-h-8 text-xs text-tinta/70 lg:line-clamp-1 lg:min-h-0">{linea || ' '}</span>
    </button>
  );
}

function Seccion({ id, color, titulo, cuenta, bajada, children }: { id: string; color: Color; titulo: string; cuenta: number; bajada?: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24">
      <div className="mb-2 flex items-center gap-2.5 px-1">
        <span aria-hidden="true" className={unir('h-4 w-1 rounded-full', COLOR[color].fondo)} />
        <h2 className="text-base font-bold text-tinta">{titulo}</h2>
        <span className={unir('importe rounded-full px-2 text-xs font-semibold leading-5', cuenta ? `${COLOR[color].fondo} text-white` : 'bg-crema-hondo text-tinta/60')}>{cuenta}</span>
      </div>
      {bajada && <p className="mb-2 px-1 text-xs text-tinta/60">{bajada}</p>}
      <Tarjeta relleno={false} className="divide-y divide-black/[0.06]">{children}</Tarjeta>
    </section>
  );
}

const Fila = ({ children }: { children: ReactNode }) => <div className="px-4 py-4">{children}</div>;

/** Un pedido que se está armando: quién, hace cuánto y el recorrido. */
function PedidoEnArmado({ p, ahora, onVer, onCambiar, propio = false }: { p: PedidoArmar; ahora: number; onVer: () => void; onCambiar?: () => void; propio?: boolean }) {
  const a = avance(p);
  const arranco = !!p.primeraCarga;
  const tarde = !arranco && (ahora - new Date(p.asignadoEn).getTime()) / 60000 >= MIN_ARRANQUE_TARDE;
  const contenido = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="importe truncate text-sm font-semibold text-tinta">{p.codigo}</p>
          <p className="truncate text-sm text-tinta/70">{p.cliente ?? 'Cliente sin nombre'}{p.canal === 'domicilio' ? ' · envío' : ' · retira'}{!propio && p.sucursal ? ` · ${sucursalCorta(p.sucursal)}` : ''}</p>
          {!propio && p.asignadoNombre && (
            <p className="mt-1.5 flex items-center gap-2 text-sm text-tinta">
              <span aria-hidden="true" className="flex size-6 shrink-0 items-center justify-center rounded-full bg-dato-3 text-xs font-semibold text-white">{iniciales(p.asignadoNombre)}</span>
              <span className="min-w-0 truncate">Arma <b className="font-semibold">{nombrePropio(p.asignadoNombre)}</b></span>
            </p>
          )}
        </div>
        <div className="shrink-0 text-right">
          <p className={unir('importe text-2xl font-bold leading-none', tarde ? 'text-marca' : 'text-dato-3')}>{reloj(p.asignadoEn, ahora)}</p>
          <p className={unir('mt-1 text-xs', tarde ? 'font-semibold text-marca-hondo' : 'text-tinta/60')}>{arranco ? 'armando' : tarde ? 'no arrancó' : 'por arrancar'}</p>
        </div>
      </div>
      <div className="mt-4"><Recorrido items={p.items} /></div>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 text-sm">
          {a.siguiente ? (
            <p className="truncate text-tinta"><span className="text-tinta/60">Sigue:</span> {numero(Math.max(0, a.siguiente.cantidad - a.siguiente.enCarro), 2)} × {a.siguiente.nombre}{a.siguiente.ubicacion ? <span className="font-semibold text-dato-3"> · {a.siguiente.ubicacion}</span> : ''}</p>
          ) : <p className="font-semibold text-ok">Todo en el carro: falta tocar «Terminé»</p>}
          <p className="text-xs text-tinta/60">{a.completos} de {a.productos} productos · {numero(a.cargadas, 2)} de {numero(a.unidades, 2)} unidades</p>
        </div>
        {!propio && (
          <div className="flex shrink-0 gap-2">
            {onCambiar && <Boton tamano="chico" variante="fantasma" onClick={onCambiar}>Cambiar quién arma</Boton>}
            <Boton tamano="chico" variante="secundario" onClick={onVer}>Ver el armado</Boton>
          </div>
        )}
      </div>
    </>
  );
  if (propio) {
    return (
      <button type="button" onClick={onVer} className={unir('block w-full text-left', FOCO)}>
        <Tarjeta className="transition-shadow hover:shadow-flotante">
          {contenido}
          <span className="mt-4 flex min-h-11 w-full items-center justify-center rounded-full bg-marca text-sm font-semibold text-white">{arranco ? 'Seguir armando' : 'Empezar a armar'}</span>
        </Tarjeta>
      </button>
    );
  }
  return <div className="px-4 py-4 sm:px-5">{contenido}</div>;
}

function PedidoEsperando({ p, ahora, onAsignar }: { p: PedidoCola; ahora: number; onAsignar: () => void }) {
  const min = (ahora - new Date(p.creado_en).getTime()) / 60000;
  const items = p.items ?? [];
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-5">
      <div className="min-w-0 flex-1 basis-64">
        <div className="flex items-baseline gap-2">
          <a href={`/pedidos?pedido=${p.id}`} className={unir('importe truncate text-sm font-semibold text-tinta underline-offset-2 hover:underline', FOCO)}>{codigoDe(p)}</a>
        </div>
        <p className="truncate text-sm text-tinta/70">{p.clienteNombre || 'Cliente sin nombre'} · {entregaDe(p)}</p>
      </div>
      <span className="w-24 shrink-0 text-sm text-tinta/70">{items.length} {items.length === 1 ? 'producto' : 'productos'}</span>
      <span className={unir('w-36 shrink-0 whitespace-nowrap text-sm', min >= 15 ? 'font-semibold text-marca-hondo' : 'text-tinta/70')}>entró {haceCuanto(p.creado_en, ahora)}</span>
      <Boton tamano="chico" onClick={onAsignar}>Asignar</Boton>
    </div>
  );
}

function Gente({ gente, armando, tiempos, ahora, nombreSuc, onVer }: {
  gente: Preparador[]; armando: PedidoArmar[]; tiempos: Tiempo[]; ahora: number; nombreSuc: Map<string, string>; onVer: (id: string) => void;
}) {
  const filas = gente.map((g) => ({
    g,
    pedido: armando.find((p) => p.asignadoA === g.id) ?? null,
    t: tiempos.find((t) => t.usuarioId === g.id) ?? null,
  }));
  const variasSucursales = new Set(gente.map((g) => g.sucursal_id ?? '')).size > 1;
  filas.sort((a, b) => Number(!!b.pedido) - Number(!!a.pedido) || (b.t?.pedidos ?? 0) - (a.t?.pedidos ?? 0) || nombrePropio(a.g.nombre).localeCompare(nombrePropio(b.g.nombre), 'es'));
  return (
    <>
      {filas.map(({ g, pedido, t }) => (
        <div key={g.id} className="flex items-center gap-3 px-4 py-2.5">
          <span aria-hidden="true" className={unir('flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold', pedido ? 'bg-dato-3 text-white' : 'bg-crema-hondo text-tinta/70')}>{iniciales(g.nombre)}</span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-tinta">{nombrePropio(g.nombre)}</p>
            <p className="truncate text-xs text-tinta/60">
              {areaDe(g)}{variasSucursales && g.sucursal_id ? ` · ${sucursalCorta(nombreSuc.get(g.sucursal_id))}` : ''}
              {t ? ` · ${numero(t.pedidos)} ${t.pedidos === 1 ? 'pedido' : 'pedidos'}` : ''}
            </p>
          </div>
          {pedido ? (
            <button type="button" onClick={() => onVer(pedido.id)} className={unir('shrink-0 rounded-full bg-dato-3/10 px-2.5 py-1 text-right text-xs font-semibold text-dato-3 hover:bg-dato-3/15', FOCO)}>
              <span className="importe">{reloj(pedido.asignadoEn, ahora)}</span> armando
            </button>
          ) : (
            <span className="shrink-0 text-right">
              <span className="block text-xs text-tinta/60">Libre</span>
              {t?.minTotal != null && <span className="importe block text-xs font-semibold text-tinta">{numero(t.minTotal, 1)} min c/u</span>}
            </span>
          )}
        </div>
      ))}
    </>
  );
}

