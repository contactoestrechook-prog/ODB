'use client';

import { useState } from 'react';
import { Aviso, Boton, Etiqueta, IconoAtencion, Monto, PlacaRoja, Tarjeta } from '../ui/kit';

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
      <Tarjeta>
        <p className="mb-4 text-sm text-tinta/70">
          El cliente muestra su código al salir: verificá que lo que lleva coincida con lo pagado.
        </p>
        <form onSubmit={buscar} className="flex gap-2">
          <input
            value={codigo}
            onChange={(e) => setCodigo(e.target.value.toUpperCase())}
            placeholder="CF-XXXXXX"
            aria-label="Código de salida"
            className="min-h-12 min-w-0 flex-1 rounded-full border-2 border-marca bg-white px-5 py-2.5 font-mono text-lg tracking-widest text-tinta outline-none placeholder:text-tinta/40 focus:ring-4 focus:ring-marca/15"
          />
          <Boton type="submit" disabled={ocupado} className="shrink-0">
            Buscar
          </Boton>
        </form>
      </Tarjeta>

      {mensaje && (
        <Aviso tono={mensaje.startsWith('✓') ? 'ok' : 'error'}>
          {mensaje.replace(/^✓\s*/, '')}
        </Aviso>
      )}

      {datos && (
        // Lo que lleva, como Placa roja RESUMEN (2/10/2026): el mismo paquete
        // gráfico de los pedidos. El código va en la franja roja; el estado
        // ("YA VALIDADA") en el recuadro, justo arriba de donde estaría "Validar
        // salida": en la franja, a 375 px, la etiqueta no entra entera y se cortaría con "…".
        <PlacaRoja
          titulo="RESUMEN"
          sub={<span className="break-all font-mono font-semibold tracking-widest text-white">{datos.codigo}</span>}
          renglones={(datos.venta.items ?? []).map((i: any, j: number) => ({
            clave: String(j),
            // la cantidad tal cual (hasta 2 decimales): antes se redondeaba y 0,5 kg se leía "1×"
            cantidad: Number.isFinite(Number(i.cantidad)) ? Number(i.cantidad) : 0,
            nombre: i.producto?.nombre ?? '—',
          }))}
          total={{ etiqueta: 'Total', valor: <Monto valor={datos.venta.total} /> }}
          recuadro={
            <div className="space-y-1.5">
              {datos.yaValidada ? (
                <Etiqueta tono="error">
                  <IconoAtencion className="-mt-0.5 mr-1 inline size-3.5" />
                  YA VALIDADA — posible doble salida
                </Etiqueta>
              ) : (
                <Etiqueta tono="neutro">
                  pendiente de salida
                </Etiqueta>
              )}
              <p className="break-words text-xs text-tinta/60">
                DNI {datos.venta.cliente?.dni} · {datos.venta.cliente?.verificado ? 'identidad verificada ✓' : 'SIN verificar'}
              </p>
            </div>
          }
          acciones={
            !datos.yaValidada ? (
              <Boton
                onClick={validar}
                disabled={ocupado}
                className="w-full sm:w-auto"
              >
                Validar salida
              </Boton>
            ) : undefined
          }
        />
      )}
    </div>
  );
}
