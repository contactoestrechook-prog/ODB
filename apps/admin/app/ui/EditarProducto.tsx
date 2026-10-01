'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Aviso, Boton, Campo, Entrada, Modal } from './kit';

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
    plu: producto.plu ?? '',
    vendidoPorPeso: !!producto.vendidoPorPeso,
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
      if ((form.plu ?? '') !== (producto.plu ?? '')) cambios.plu = form.plu || null;
      if (form.vendidoPorPeso !== !!producto.vendidoPorPeso) cambios.vendidoPorPeso = form.vendidoPorPeso;
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

  const CASILLA = 'flex min-h-11 items-center gap-2 text-sm text-tinta';
  const CHECK = 'size-5 shrink-0 accent-marca';

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Boton tamano="chico" onClick={() => setAbierto(true)}>
          Editar producto
        </Boton>
        <Boton variante="secundario" tamano="chico" onClick={alternarActivo}>
          {producto.activo ? 'Pausar venta' : 'Reactivar'}
        </Boton>
      </div>

      <Modal
        abierto={abierto}
        onCerrar={() => setAbierto(false)}
        titulo={`Editar ${producto.sku}`}
        descripcion="El cambio de precio crea una vigencia nueva: el historial se conserva."
        cerrarAlTocarAfuera={false}
        pie={
          <>
            <Boton variante="secundario" onClick={() => setAbierto(false)}>
              Cancelar
            </Boton>
            <Boton onClick={guardar} disabled={cargando}>
              {cargando ? 'Guardando…' : 'Guardar cambios'}
            </Boton>
          </>
        }
      >
        <div className="space-y-3 text-left">
          <Campo etiqueta="Nombre">
            <Entrada value={form.nombre} onChange={(e) => campo('nombre', e.target.value)} />
          </Campo>
          <div className="grid grid-cols-2 gap-3">
            <Campo etiqueta="Rubro">
              <Entrada
                value={form.rubro}
                onChange={(e) => campo('rubro', e.target.value)}
                placeholder="Rubro"
                list="rubros-edicion"
              />
            </Campo>
            <datalist id="rubros-edicion">
              {rubros.map((r) => (
                <option key={r.id} value={r.nombre} />
              ))}
            </datalist>
            <Campo etiqueta="Marca">
              <Entrada
                value={form.marca}
                onChange={(e) => campo('marca', e.target.value)}
                placeholder="Marca"
                list="marcas-edicion"
              />
            </Campo>
            <datalist id="marcas-edicion">
              {marcas.map((m) => (
                <option key={m.id} value={m.nombre} />
              ))}
            </datalist>
          </div>

          <div className="space-y-2 rounded-xl bg-crema-claro p-3">
            <div className="grid grid-cols-2 gap-3">
              <Campo etiqueta="Costo de compra">
                <Entrada value={form.costo} onChange={(e) => campo('costo', e.target.value)} type="number" prefijo="$" />
              </Campo>
              <Campo etiqueta="Precio de venta">
                <Entrada value={form.precio} onChange={(e) => campo('precio', e.target.value)} type="number" prefijo="$" />
              </Campo>
            </div>
            {margen != null && (
              <p className={`text-sm font-medium ${margen < 10 ? 'text-marca-hondo' : 'text-ok'}`}>
                Margen: {margen} %
              </p>
            )}
          </div>

          <Campo etiqueta="Código de barras">
            <Entrada
              value={form.codigoBarras}
              onChange={(e) => campo('codigoBarras', e.target.value)}
              placeholder="Agregar código de barras"
              inputMode="numeric"
              className="font-mono"
            />
          </Campo>
          <div className="flex flex-wrap gap-x-5 gap-y-1">
            <label className={CASILLA}>
              <input
                type="checkbox"
                checked={form.esAlcohol}
                onChange={(e) => campo('esAlcohol', e.target.checked)}
                className={CHECK}
              />
              +18
            </label>
            <label className={CASILLA} title="La balanza manda gramos y el precio es por kilo">
              <input type="checkbox" checked={!!form.vendidoPorPeso} onChange={(e) => campo('vendidoPorPeso', e.target.checked)} className={CHECK} />
              Se vende por peso (balanza)
            </label>
            <label className={CASILLA}>
              PLU balanza
              <span className="w-28">
                <Entrada value={form.plu ?? ''} onChange={(e) => campo('plu', e.target.value.replace(/\D/g, ''))} placeholder="ej: 3931" inputMode="numeric" />
              </span>
            </label>
          </div>

          {error && <Aviso tono="error">{error}</Aviso>}
        </div>
      </Modal>
    </>
  );
}
