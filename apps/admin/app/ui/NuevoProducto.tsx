'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Opcion = { id: string; nombre: string };

const FORM_VACIO = {
  nombre: '',
  rubro: '',
  marca: '',
  codigoBarras: '',
  esAlcohol: false,
  costo: '',
  precio: '',
  stock1: '',
  stock2: '',
};

export function NuevoProducto({
  rubros,
  marcas,
  sucursales,
}: {
  rubros: Opcion[];
  marcas: Opcion[];
  sucursales: Opcion[];
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [form, setForm] = useState<any>(FORM_VACIO);
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(false);

  const campo = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  const margen =
    Number(form.costo) > 0 && Number(form.precio) > 0
      ? Math.round(((Number(form.precio) - Number(form.costo)) / Number(form.costo)) * 100)
      : null;

  const guardar = async () => {
    setCargando(true);
    setError('');
    try {
      const stockInicial = [
        { sucursalId: sucursales[0]?.id, cantidad: Number(form.stock1) || 0 },
        { sucursalId: sucursales[1]?.id, cantidad: Number(form.stock2) || 0 },
      ].filter((s) => s.sucursalId && s.cantidad > 0);

      const res = await fetch('/api/producto', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nombre: form.nombre,
          rubro: form.rubro || undefined,
          marca: form.marca || undefined,
          codigoBarras: form.codigoBarras || undefined,
          esAlcohol: form.esAlcohol,
          costo: Number(form.costo) > 0 ? Number(form.costo) : undefined,
          precio: Number(form.precio) > 0 ? Number(form.precio) : undefined,
          stockInicial,
        }),
      });
      const datos = await res.json();
      if (!res.ok) {
        setError(datos.message ?? 'No se pudo crear el producto');
        return;
      }
      setAbierto(false);
      setForm(FORM_VACIO);
      router.push(`/productos/${datos.sku}`);
    } finally {
      setCargando(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setAbierto(true)}
        className="rounded-full bg-[#B82D25] text-white text-sm font-medium px-5 py-2.5 hover:bg-[#932A1F] shadow-sm whitespace-nowrap"
      >
        + Nuevo producto
      </button>

      {abierto && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-[2px] flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl w-full max-w-lg p-6 space-y-3 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div>
              <h2 className="font-semibold text-black text-lg">Nuevo producto</h2>
              <p className="text-xs text-black/45 mt-0.5">
                El SKU se asigna solo. Rubro y marca nuevos se crean automáticamente.
              </p>
            </div>

            <input
              value={form.nombre}
              onChange={(e) => campo('nombre', e.target.value)}
              placeholder="Nombre (ej: Malbec Reserva Catena x750cc)"
              className="w-full rounded-lg border border-black/15 px-3 py-2.5 text-sm text-black focus:border-[#B82D25] focus:outline-none"
              autoFocus
            />
            <div className="grid grid-cols-2 gap-3">
              <input
                value={form.rubro}
                onChange={(e) => campo('rubro', e.target.value)}
                placeholder="Rubro"
                list="rubros-existentes"
                className="rounded-lg border border-black/15 px-3 py-2.5 text-sm text-black focus:border-[#B82D25] focus:outline-none"
              />
              <datalist id="rubros-existentes">
                {rubros.map((r) => (
                  <option key={r.id} value={r.nombre} />
                ))}
              </datalist>
              <input
                value={form.marca}
                onChange={(e) => campo('marca', e.target.value)}
                placeholder="Marca (opcional)"
                list="marcas-existentes"
                className="rounded-lg border border-black/15 px-3 py-2.5 text-sm text-black focus:border-[#B82D25] focus:outline-none"
              />
              <datalist id="marcas-existentes">
                {marcas.map((m) => (
                  <option key={m.id} value={m.nombre} />
                ))}
              </datalist>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <input
                value={form.codigoBarras}
                onChange={(e) => campo('codigoBarras', e.target.value)}
                placeholder="Código de barras (opcional)"
                inputMode="numeric"
                className="rounded-lg border border-black/15 px-3 py-2.5 text-sm text-black focus:border-[#B82D25] focus:outline-none"
              />
              <label className="flex items-center gap-2 text-sm text-black px-1">
                <input
                  type="checkbox"
                  checked={form.esAlcohol}
                  onChange={(e) => campo('esAlcohol', e.target.checked)}
                  className="accent-[#B82D25] w-4 h-4"
                />
                Bebida alcohólica (+18)
              </label>
            </div>

            <div className="rounded-xl bg-[#F0EBE2]/60 p-3 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-black/50">Costo de compra</label>
                  <input
                    value={form.costo}
                    onChange={(e) => campo('costo', e.target.value)}
                    placeholder="$"
                    type="number"
                    className="w-full mt-1 rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-black focus:border-[#B82D25] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-xs text-black/50">Precio de venta</label>
                  <input
                    value={form.precio}
                    onChange={(e) => campo('precio', e.target.value)}
                    placeholder="$"
                    type="number"
                    className="w-full mt-1 rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-black focus:border-[#B82D25] focus:outline-none"
                  />
                </div>
              </div>
              {margen != null && (
                <p className={`text-xs font-medium ${margen < 10 ? 'text-[#B82D25]' : 'text-emerald-700'}`}>
                  Margen: {margen} %
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              {sucursales.slice(0, 2).map((s, i) => (
                <div key={s.id}>
                  <label className="text-xs text-black/50">Stock inicial · {s.nombre}</label>
                  <input
                    value={i === 0 ? form.stock1 : form.stock2}
                    onChange={(e) => campo(i === 0 ? 'stock1' : 'stock2', e.target.value)}
                    placeholder="0"
                    type="number"
                    className="w-full mt-1 rounded-lg border border-black/15 px-3 py-2 text-sm text-black focus:border-[#B82D25] focus:outline-none"
                  />
                </div>
              ))}
            </div>

            {error && <p className="text-xs text-[#B82D25] font-medium">{error}</p>}

            <div className="flex justify-end gap-3 pt-1">
              <button
                onClick={() => setAbierto(false)}
                className="text-sm text-black/60 px-4 py-2 hover:text-black"
              >
                Cancelar
              </button>
              <button
                onClick={guardar}
                disabled={cargando || !form.nombre.trim()}
                className="rounded-full bg-[#B82D25] text-white text-sm font-medium px-6 py-2.5 hover:bg-[#932A1F] disabled:opacity-50"
              >
                {cargando ? 'Creando…' : 'Crear producto'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
