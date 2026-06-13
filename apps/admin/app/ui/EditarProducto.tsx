'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Opcion = { id: string; nombre: string };

export function EditarProducto({
  producto,
  rubros,
  marcas,
}: {
  producto: any;
  rubros: Opcion[];
  marcas: Opcion[];
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [form, setForm] = useState({
    nombre: producto.nombre ?? '',
    rubro: producto.categoria ?? '',
    marca: producto.marca ?? '',
    costo: producto.costo ?? '',
    precio: producto.precio ?? '',
    codigoBarras: '',
    esAlcohol: !!producto.esAlcohol,
  });
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(false);

  const campo = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));

  const margen =
    Number(form.costo) > 0 && Number(form.precio) > 0
      ? Math.round(((Number(form.precio) - Number(form.costo)) / Number(form.costo)) * 100)
      : null;

  const guardar = async () => {
    setCargando(true);
    setError('');
    try {
      const cambios: any = { id: producto.id };
      if (form.nombre !== producto.nombre) cambios.nombre = form.nombre;
      if (form.rubro !== (producto.categoria ?? '')) cambios.rubro = form.rubro;
      if (form.marca !== (producto.marca ?? '')) cambios.marca = form.marca || null;
      if (form.esAlcohol !== !!producto.esAlcohol) cambios.esAlcohol = form.esAlcohol;
      if (Number(form.costo) > 0 && Number(form.costo) !== producto.costo) cambios.costo = Number(form.costo);
      if (Number(form.precio) > 0 && Number(form.precio) !== producto.precio) cambios.precio = Number(form.precio);
      if (form.codigoBarras.trim()) cambios.codigoBarras = form.codigoBarras.trim();

      const res = await fetch('/api/producto', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cambios),
      });
      if (!res.ok) {
        setError((await res.json()).message ?? 'No se pudo guardar');
        return;
      }
      setAbierto(false);
      router.refresh();
    } finally {
      setCargando(false);
    }
  };

  const alternarActivo = async () => {
    await fetch('/api/producto', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: producto.id, activo: !producto.activo }),
    });
    router.refresh();
  };

  return (
    <>
      <div className="flex gap-2">
        <button
          onClick={() => setAbierto(true)}
          className="rounded-full bg-[#B82D25] text-white text-xs font-medium px-4 py-2 hover:bg-[#932A1F]"
        >
          Editar producto
        </button>
        <button
          onClick={alternarActivo}
          className={`rounded-full text-xs font-medium px-4 py-2 ${
            producto.activo
              ? 'bg-black/5 text-black/60 hover:bg-black/10'
              : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
          }`}
        >
          {producto.activo ? 'Pausar venta' : 'Reactivar'}
        </button>
      </div>

      {abierto && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-[2px] flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl w-full max-w-lg p-6 space-y-3 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div>
              <h2 className="font-semibold text-black text-lg">Editar {producto.sku}</h2>
              <p className="text-xs text-black/45 mt-0.5">
                El cambio de precio crea una vigencia nueva: el historial se conserva.
              </p>
            </div>

            <input
              value={form.nombre}
              onChange={(e) => campo('nombre', e.target.value)}
              className="w-full rounded-lg border border-black/15 px-3 py-2.5 text-sm text-black focus:border-[#B82D25] focus:outline-none"
            />
            <div className="grid grid-cols-2 gap-3">
              <input
                value={form.rubro}
                onChange={(e) => campo('rubro', e.target.value)}
                placeholder="Rubro"
                list="rubros-edicion"
                className="rounded-lg border border-black/15 px-3 py-2.5 text-sm text-black focus:border-[#B82D25] focus:outline-none"
              />
              <datalist id="rubros-edicion">
                {rubros.map((r) => (
                  <option key={r.id} value={r.nombre} />
                ))}
              </datalist>
              <input
                value={form.marca}
                onChange={(e) => campo('marca', e.target.value)}
                placeholder="Marca"
                list="marcas-edicion"
                className="rounded-lg border border-black/15 px-3 py-2.5 text-sm text-black focus:border-[#B82D25] focus:outline-none"
              />
              <datalist id="marcas-edicion">
                {marcas.map((m) => (
                  <option key={m.id} value={m.nombre} />
                ))}
              </datalist>
            </div>

            <div className="rounded-xl bg-[#F0EBE2]/60 p-3 space-y-2">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-black/50">Costo de compra</label>
                  <input
                    value={form.costo}
                    onChange={(e) => campo('costo', e.target.value)}
                    type="number"
                    className="w-full mt-1 rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-black focus:border-[#B82D25] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-xs text-black/50">Precio de venta</label>
                  <input
                    value={form.precio}
                    onChange={(e) => campo('precio', e.target.value)}
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

            <div className="grid grid-cols-2 gap-3 items-center">
              <input
                value={form.codigoBarras}
                onChange={(e) => campo('codigoBarras', e.target.value)}
                placeholder="Agregar código de barras"
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
                +18
              </label>
            </div>

            {error && <p className="text-xs text-[#B82D25] font-medium">{error}</p>}

            <div className="flex justify-end gap-3 pt-1">
              <button onClick={() => setAbierto(false)} className="text-sm text-black/60 px-4 py-2 hover:text-black">
                Cancelar
              </button>
              <button
                onClick={guardar}
                disabled={cargando}
                className="rounded-full bg-[#B82D25] text-white text-sm font-medium px-6 py-2.5 hover:bg-[#932A1F] disabled:opacity-50"
              >
                {cargando ? 'Guardando…' : 'Guardar cambios'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
