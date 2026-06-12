'use client';

import { useState } from 'react';

const pesos = (n: number) => '$' + Math.round(Number(n)).toLocaleString('es-AR');

export function ControlSalida() {
  const [codigo, setCodigo] = useState('');
  const [datos, setDatos] = useState<any>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function buscar(e: React.FormEvent) {
    e.preventDefault();
    if (!codigo.trim() || ocupado) return;
    setOcupado(true);
    setMensaje(null);
    setDatos(null);
    const res = await fetch(`/api/salida?codigo=${encodeURIComponent(codigo.trim())}`);
    const d = await res.json();
    if (res.ok) setDatos(d);
    else setMensaje(d.message ?? 'Código inexistente');
    setOcupado(false);
  }

  async function validar() {
    setOcupado(true);
    const res = await fetch('/api/salida', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ codigo: datos.codigo }),
    });
    const d = await res.json();
    setMensaje(res.ok ? '✓ Salida validada: que tenga buen día' : d.message);
    if (res.ok) {
      setDatos(null);
      setCodigo('');
    }
    setOcupado(false);
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-white p-5">
        <h1 className="font-medium text-black mb-1">Control de salida · Comprá Fácil</h1>
        <p className="text-xs text-black/50 mb-4">
          El cliente muestra su código al salir: verificá que lo que lleva coincida con lo pagado.
        </p>
        <form onSubmit={buscar} className="flex gap-2">
          <input
            value={codigo}
            onChange={(e) => setCodigo(e.target.value.toUpperCase())}
            placeholder="CF-XXXXXX"
            className="flex-1 rounded-full border-2 border-[#B82D25] px-5 py-3 text-lg font-mono tracking-widest text-black outline-none"
          />
          <button
            type="submit"
            disabled={ocupado}
            className="rounded-full bg-black px-6 text-sm font-medium text-white disabled:opacity-50"
          >
            Buscar
          </button>
        </form>
      </div>

      {mensaje && (
        <p
          className={
            'rounded-xl px-4 py-3 text-sm font-medium ' +
            (mensaje.startsWith('✓')
              ? 'bg-white text-black'
              : 'bg-[#B82D25] text-white')
          }
        >
          {mensaje}
        </p>
      )}

      {datos && (
        <div className="rounded-xl bg-white p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="font-mono text-lg font-medium text-black tracking-widest">{datos.codigo}</span>
            {datos.yaValidada ? (
              <span className="rounded-full bg-[#B82D25] px-3 py-1 text-xs font-medium text-white">
                ⚠ YA VALIDADA — posible doble salida
              </span>
            ) : (
              <span className="rounded-full bg-[#F0EBE2] px-3 py-1 text-xs font-medium text-black">
                pendiente de salida
              </span>
            )}
          </div>
          <ul className="text-sm text-black space-y-1 mb-3">
            {datos.venta.items.map((i: any, j: number) => (
              <li key={j}>
                {Math.round(Number(i.cantidad))}× {i.producto?.nombre}
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between border-t border-black/10 pt-3">
            <div>
              <p className="text-lg font-medium text-black">{pesos(datos.venta.total)}</p>
              <p className="text-xs text-black/50">
                DNI {datos.venta.cliente?.dni} · {datos.venta.cliente?.verificado ? 'identidad verificada ✓' : 'SIN verificar'}
              </p>
            </div>
            {!datos.yaValidada && (
              <button
                onClick={validar}
                disabled={ocupado}
                className="rounded-full bg-[#B82D25] px-6 py-3 text-sm font-medium text-white hover:bg-[#932A1F] disabled:opacity-50"
              >
                Validar salida
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
