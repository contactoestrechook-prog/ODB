'use client';

import { useEffect, useRef, useState } from 'react';

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

const pesos = (n: number) => '$' + Math.round(n).toLocaleString('es-AR');

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
    setCreando(null);
  }

  return (
    <div className="rounded-2xl bg-white overflow-hidden flex flex-col" style={{ height: '78vh' }}>
      <div className="bg-black px-5 py-4 flex items-center gap-3">
        <div className="h-10 w-10 rounded-full bg-[#B82D25] flex items-center justify-center text-white text-lg">
          📊
        </div>
        <div>
          <p className="text-white font-medium leading-tight">Analista ODB</p>
          <p className="text-[#F0EBE2]/60 text-xs">
            Compras, stock y proveedores · números reales de las 2 sucursales
          </p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {mensajes.map((m, i) => (
          <div key={i} className={'flex flex-col ' + (m.rol === 'usuario' ? 'items-end' : 'items-start')}>
            <div
              className={
                'max-w-[85%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap ' +
                (m.rol === 'usuario'
                  ? 'bg-black text-white rounded-br-md'
                  : 'bg-[#F0EBE2] text-black rounded-bl-md')
              }
            >
              {m.texto}
            </div>
            {m.armados && (
              <div className="mt-2 grid sm:grid-cols-2 gap-2 max-w-[95%]">
                {m.armados.map((a, j) => (
                  <div key={j} className="rounded-xl border border-black/10 bg-white p-3 flex flex-col">
                    <p className="text-sm font-medium text-black">🎁 {a.nombre}</p>
                    <p className="text-xs text-[#932A1F] font-medium">{a.ocasion}</p>
                    <p className="text-xs text-black/60 mt-1">{a.descripcion}</p>
                    <ul className="mt-2 text-xs text-black/70 space-y-0.5">
                      {a.items.map((it) => (
                        <li key={it.sku}>
                          {it.cantidad}× {it.nombre}
                        </li>
                      ))}
                    </ul>
                    <div className="mt-auto pt-2 flex items-baseline justify-between">
                      <div>
                        <p className="text-xs text-black/40 line-through">{pesos(a.sumaLista)}</p>
                        <p className="text-lg font-medium text-black">{pesos(a.precioBox)}</p>
                      </div>
                      <div className="text-right text-xs">
                        <p className="text-[#932A1F] font-medium">ahorra {pesos(a.ahorro)}</p>
                        {a.margenPct != null && <p className="text-black/40">margen {a.margenPct} %</p>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {m.ordenes?.map((o, j) => {
              const clave = `${i}-${j}`;
              return (
                <div key={clave} className="mt-2 max-w-[85%] w-full rounded-xl border-2 border-[#B82D25] bg-white p-3">
                  <p className="text-xs font-medium text-[#932A1F] mb-1">
                    Orden de compra propuesta
                  </p>
                  <p className="text-sm text-black font-medium">
                    {o.proveedor} → {o.sucursal}
                  </p>
                  <p className="text-xs text-black/50 mb-2">{o.motivo}</p>
                  <p className="text-sm text-black/80">
                    {o.items.map((it) => `${it.sku} × ${it.cantidad}`).join(' · ')}
                  </p>
                  {creadas[clave] ? (
                    <p className="mt-2 text-xs font-medium text-black bg-[#F0EBE2] rounded-lg px-3 py-2">
                      {creadas[clave]}
                    </p>
                  ) : (
                    <button
                      onClick={() => crearOc(o, clave)}
                      disabled={creando === clave}
                      className="mt-2 rounded-full bg-[#B82D25] px-4 py-1.5 text-xs font-medium text-white hover:bg-[#932A1F] disabled:opacity-50"
                    >
                      {creando === clave ? 'Creando…' : 'Crear borrador de OC'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        ))}
        {pensando && (
          <div className="flex justify-start">
            <div className="rounded-2xl rounded-bl-md bg-[#F0EBE2] px-4 py-2.5 text-sm text-black/50">
              cruzando ventas, stock y proveedores…
            </div>
          </div>
        )}
        <div ref={finRef} />
      </div>

      {mensajes.length <= 1 && (
        <div className="px-4 pb-2 flex flex-wrap gap-2">
          {SUGERENCIAS.map((s) => (
            <button
              key={s}
              onClick={() => enviar(s)}
              className="rounded-full border border-black px-3 py-1.5 text-xs text-black hover:bg-black hover:text-white"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          enviar(texto);
        }}
        className="border-t border-black/10 p-3 flex gap-2"
      >
        <input
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Preguntale al analista…"
          className="flex-1 rounded-full border border-black/15 px-4 py-2.5 text-sm text-black outline-none focus:border-[#B82D25]"
        />
        <button
          type="submit"
          disabled={pensando || !texto.trim()}
          className="rounded-full bg-black px-6 text-sm font-medium text-white disabled:opacity-40"
        >
          Enviar
        </button>
      </form>
    </div>
  );
}
