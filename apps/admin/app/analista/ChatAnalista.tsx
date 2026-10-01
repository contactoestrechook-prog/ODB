'use client';

import { useEffect, useRef, useState } from 'react';
import { BotonMicrofono } from '../ui/BotonMicrofono';
import { Boton, Chip, Entrada, Tarjeta, unir } from '../ui/kit';
import { pesos as pesosFmt } from '../lib/formato';

type Item = { sku: string; cantidad: number };
type Orden = {
  proveedor: string;
  sucursal: string;
  motivo: string;
  items: Item[];
  proveedorId: string;
  sucursalId: string;
};
type Armado = {
  nombre: string;
  ocasion: string;
  descripcion: string;
  items: { sku: string; nombre: string; cantidad: number; precioUnitario: number }[];
  sumaLista: number;
  precioBox: number;
  ahorro: number;
  margenPct: number | null;
};

type Mensaje = { rol: 'usuario' | 'analista'; texto: string; ordenes?: Orden[]; armados?: Armado[] };

const SUGERENCIAS = [
  '¿Qué compro esta semana?',
  'Armame boxes para vender 🎁',
  '¿Dónde tengo plata inmovilizada?',
  '¿Qué costos aumentaron?',
];

const pesos = (n: number) => pesosFmt(n);

export function ChatAnalista() {
  const [mensajes, setMensajes] = useState<Mensaje[]>([
    {
      rol: 'analista',
      texto:
        'Buenas. Soy el Analista ODB: miro el ritmo de venta, el stock de las dos sucursales, los plazos de cada proveedor y los costos. Preguntame qué comprar, qué liquidar o dónde hay plata parada.',
    },
  ]);
  const [texto, setTexto] = useState('');
  const [pensando, setPensando] = useState(false);
  const [creando, setCreando] = useState<string | null>(null);
  const [creadas, setCreadas] = useState<Record<string, string>>({});
  const finRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    finRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [mensajes, pensando]);

  async function pedirArmados() {
    setMensajes((m) => [...m, { rol: 'usuario', texto: 'Armame boxes para vender' }]);
    setPensando(true);
    try {
      const res = await fetch('/api/armados', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const datos = await res.json();
      setMensajes((m) => [
        ...m,
        res.ok
          ? {
              rol: 'analista',
              texto: 'Te propongo estos armados con lo que hay en stock (precios y márgenes ya verificados):',
              armados: datos.armados,
            }
          : { rol: 'analista', texto: `(${datos.message ?? 'No pude armar los boxes'})` },
      ]);
    } catch {
      setMensajes((m) => [...m, { rol: 'analista', texto: '(Sin conexión con la API)' }]);
    }
    setPensando(false);
  }

  async function enviar(textoMensaje: string) {
    const limpio = textoMensaje.trim();
    if (!limpio || pensando) return;
    if (limpio.includes('Armame boxes')) return pedirArmados();
    const nuevos: Mensaje[] = [...mensajes, { rol: 'usuario', texto: limpio }];
    setMensajes(nuevos);
    setTexto('');
    setPensando(true);
    try {
      const res = await fetch('/api/analista', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mensajes: nuevos.map(({ rol, texto }) => ({ rol, texto })),
        }),
      });
      const datos = await res.json();
      setMensajes((m) => [
        ...m,
        res.ok
          ? { rol: 'analista', texto: datos.respuesta, ordenes: datos.ordenes }
          : { rol: 'analista', texto: `(${datos.message ?? 'No pude analizar, probá de nuevo'})` },
      ]);
    } catch {
      setMensajes((m) => [...m, { rol: 'analista', texto: '(Sin conexión con la API)' }]);
    }
    setPensando(false);
  }

  async function crearOc(orden: Orden, clave: string) {
    setCreando(clave);
    try {
      const res = await fetch('/api/oc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proveedorId: orden.proveedorId,
          sucursalId: orden.sucursalId,
          items: orden.items,
        }),
      });
      const datos = await res.json();
      setCreadas((c) => ({
        ...c,
        [clave]: res.ok
          ? 'Borrador creado: queda pendiente de firma en Compras'
          : `Error: ${datos.message}`,
      }));
    } catch {
      setCreadas((c) => ({ ...c, [clave]: 'Error: no se pudo conectar, reintentá' }));
    } finally {
      setCreando(null);
    }
  }

  return (
    <Tarjeta relleno={false} className="flex h-[78dvh] min-h-[26rem] flex-col overflow-hidden">
      <div className="flex items-center gap-3 border-b border-black/[0.06] px-4 py-3 sm:px-5">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-marca text-white" aria-hidden="true">
          <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 20h16M7 16v-5M12 16V6M17 16v-8" />
          </svg>
        </div>
        <div className="min-w-0">
          <p className="font-semibold leading-tight text-tinta">Analista ODB</p>
          <p className="text-xs text-tinta/60">
            Compras, stock y proveedores · números reales de las 2 sucursales
          </p>
        </div>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-4" aria-live="polite">
        {mensajes.map((m, i) => (
          <div key={i} className={'flex flex-col ' + (m.rol === 'usuario' ? 'items-end' : 'items-start')}>
            <div
              className={unir(
                'max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-4 py-2.5 text-sm',
                m.rol === 'usuario' ? 'rounded-br-md bg-tinta text-white' : 'rounded-bl-md bg-crema text-tinta',
              )}
            >
              {m.texto}
            </div>
            {m.armados && (
              <div className="mt-2 grid w-full max-w-[95%] gap-2 sm:grid-cols-2">
                {m.armados.map((a, j) => (
                  <div key={j} className="flex min-w-0 flex-col rounded-xl border border-black/[0.06] bg-white p-3 shadow-tarjeta">
                    <p className="break-words text-sm font-semibold text-tinta">{a.nombre}</p>
                    <p className="text-xs font-medium text-marca-hondo">{a.ocasion}</p>
                    <p className="mt-1 text-xs text-tinta/70">{a.descripcion}</p>
                    <ul className="mt-2 space-y-0.5 text-xs text-tinta/70">
                      {a.items.map((it) => (
                        <li key={it.sku}>
                          {it.cantidad}× {it.nombre}
                        </li>
                      ))}
                    </ul>
                    <div className="mt-auto flex flex-wrap items-baseline justify-between gap-2 pt-2">
                      <div>
                        <p className="importe text-xs text-tinta/60 line-through">{pesos(a.sumaLista)}</p>
                        <p className="importe text-lg font-semibold text-tinta">{pesos(a.precioBox)}</p>
                      </div>
                      <div className="text-right text-xs">
                        <p className="font-medium text-marca-hondo">ahorra <span className="importe">{pesos(a.ahorro)}</span></p>
                        {a.margenPct != null && <p className="text-tinta/60">margen {a.margenPct} %</p>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {m.ordenes?.map((o, j) => {
              const clave = `${i}-${j}`;
              return (
                <div key={clave} className="mt-2 w-full max-w-[85%] rounded-xl border-2 border-marca bg-white p-3">
                  <p className="mb-1 text-xs font-semibold text-marca-hondo">
                    Orden de compra propuesta
                  </p>
                  <p className="break-words text-sm font-medium text-tinta">
                    {o.proveedor} → {o.sucursal}
                  </p>
                  <p className="mb-2 text-xs text-tinta/60">{o.motivo}</p>
                  <p className="break-words text-sm text-tinta/80">
                    {o.items.map((it) => `${it.sku} × ${it.cantidad}`).join(' · ')}
                  </p>
                  {creadas[clave] ? (
                    <p className="mt-2 rounded-xl bg-crema px-3 py-2 text-xs font-medium text-tinta">
                      {creadas[clave]}
                    </p>
                  ) : (
                    <Boton
                      tamano="chico"
                      className="mt-2"
                      onClick={() => crearOc(o, clave)}
                      cargando={creando === clave}
                    >
                      {creando === clave ? 'Creando…' : 'Crear borrador de OC'}
                    </Boton>
                  )}
                </div>
              );
            })}
          </div>
        ))}
        {pensando && (
          <div className="flex justify-start">
            <div className="rounded-2xl rounded-bl-md bg-crema px-4 py-2.5 text-sm text-tinta/60">
              cruzando ventas, stock y proveedores…
            </div>
          </div>
        )}
        <div ref={finRef} />
      </div>

      {mensajes.length <= 1 && (
        <div className="flex flex-wrap gap-2 px-4 pb-3">
          {SUGERENCIAS.map((s) => (
            <Chip key={s} onClick={() => enviar(s)}>
              {s}
            </Chip>
          ))}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          enviar(texto);
        }}
        className="flex items-center gap-2 border-t border-black/[0.06] p-3"
      >
        <Entrada
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Preguntale al analista… o hablá 🎤"
          aria-label="Pregunta para el analista"
          className="min-w-0 flex-1"
        />
        <BotonMicrofono onTexto={setTexto} titulo="Hablarle al analista" />
        <Boton type="submit" disabled={pensando || !texto.trim()} className="shrink-0">
          Enviar
        </Boton>
      </form>
    </Tarjeta>
  );
}
