'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Aviso, Boton, Campo, Entrada, Modal, Selector, clasesBoton } from './kit';
import { pesos } from '../lib/formato';

type Opcion = { id: string; nombre: string };
type Segmento = {
  segmento: string;
  etiqueta: string;
  clientes: number;
  ticketPromedio: number | null;
  ventasIdentificadas: number;
};

const hoy = () => new Date().toISOString().slice(0, 10);
const enDias = (d: number) => new Date(Date.now() + d * 86400_000).toISOString().slice(0, 10);

// Recomendación según el ticket promedio del segmento vs el general
function sugerencia(seg: Segmento | undefined, general: number) {
  if (!seg || seg.segmento === '') {
    return { texto: 'Promoción general para toda la clientela.', tipo: 'porcentaje', valor: 10 };
  }
  const t = seg.ticketPromedio;
  if (t == null) {
    return {
      texto: `Todavía no hay ticket promedio medido para ${seg.etiqueta}. Arrancá con un % moderado y ajustá cuando haya datos.`,
      tipo: 'porcentaje',
      valor: 10,
    };
  }
  if (t >= general * 1.2) {
    return {
      texto: `${seg.etiqueta} gastan ${pesos(t)} por compra, muy por encima del promedio (${pesos(general)}). Conviene una promo de fidelización exclusiva (beneficio premium, no liquidación) para sostener su frecuencia.`,
      tipo: 'porcentaje',
      valor: 8,
      soloComunidad: true,
    };
  }
  if (t <= general * 0.8) {
    return {
      texto: `${seg.etiqueta} tienen un ticket de ${pesos(t)}, por debajo del promedio (${pesos(general)}). Una promo más agresiva (mayor % o 2da unidad) los empuja a subir el ticket.`,
      tipo: 'porcentaje',
      valor: 20,
    };
  }
  return {
    texto: `${seg.etiqueta} están en la media (${pesos(t)} vs ${pesos(general)}). Un descuento parejo mantiene el ritmo.`,
    tipo: 'porcentaje',
    valor: 12,
  };
}

export function CrearPromocion({
  categorias,
  marcas,
  segmentos,
  ticketGeneral,
}: {
  categorias: Opcion[];
  marcas: Opcion[];
  segmentos: Segmento[];
  ticketGeneral: number;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [form, setForm] = useState<any>({
    nombre: '',
    segmento: '',
    alcance: 'global',
    categoriaId: '',
    marcaId: '',
    sku: '',
    tipo: 'porcentaje',
    valor: 10,
    desde: hoy(),
    hasta: enDias(14),
    combinable: false,
    soloComunidad: false,
    medioPago: '',
  });
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(false);

  // difusión / pauta publicitaria
  const [conPauta, setConPauta] = useState(false);
  const [red, setRed] = useState('Instagram/Facebook (Meta)');
  const [anuncio, setAnuncio] = useState<any>(null);
  const [generando, setGenerando] = useState(false);

  const campo = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  const generarAnuncio = async () => {
    setGenerando(true);
    try {
      const res = await fetch('/api/promos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accion: 'anuncio',
          nombre: form.nombre || `Promo ${segSel?.etiqueta ?? 'general'}`,
          descripcion: `${form.tipo === 'porcentaje' ? form.valor + '% off' : form.tipo === 'monto_fijo' ? '$' + form.valor + ' menos' : 'a $' + form.valor}`,
          segmento: segSel?.etiqueta,
          red,
        }),
      });
      if (res.ok) setAnuncio(await res.json());
    } finally {
      setGenerando(false);
    }
  };

  const copiarAviso = () => {
    if (!anuncio) return;
    const txt = `${anuncio.titular}\n\n${anuncio.cuerpo}\n\n${anuncio.cta}\n\n${(anuncio.hashtags ?? []).join(' ')}`;
    navigator.clipboard?.writeText(txt);
  };

  const segSel = segmentos.find((s) => s.segmento === form.segmento);
  const sug = sugerencia(form.segmento ? segSel : undefined, ticketGeneral);

  const aplicarSugerencia = () => {
    setForm((f: any) => ({
      ...f,
      tipo: sug.tipo,
      valor: sug.valor,
      soloComunidad: (sug as any).soloComunidad ?? f.soloComunidad,
    }));
  };

  const guardar = async () => {
    setCargando(true);
    setError('');
    try {
      const res = await fetch('/api/descuento', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nombre: form.nombre || `Promo ${segSel?.etiqueta ?? 'general'}`,
          alcance: form.alcance,
          tipo: form.tipo,
          valor: Number(form.valor),
          desde: new Date(form.desde).toISOString(),
          hasta: new Date(form.hasta + 'T23:59:59').toISOString(),
          categoriaId: form.alcance === 'categoria' ? form.categoriaId : undefined,
          marcaId: form.alcance === 'marca' ? form.marcaId : undefined,
          sku: form.alcance === 'producto' ? form.sku : undefined,
          segmento: form.segmento || undefined,
          medioPago: form.medioPago || undefined,
          combinable: form.combinable,
          soloComunidad: form.soloComunidad,
        }),
      });
      if (!res.ok) {
        setError((await res.json()).message ?? 'No se pudo crear');
        return;
      }
      setAbierto(false);
      router.refresh();
    } finally {
      setCargando(false);
    }
  };

  const CASILLA = 'flex min-h-11 items-center gap-2 text-sm text-tinta';
  const CHECK = 'size-5 shrink-0 accent-marca';

  return (
    <>
      <Boton onClick={() => setAbierto(true)} className="w-full shrink-0 sm:w-auto">
        + Nueva promoción
      </Boton>

      <Modal
        abierto={abierto}
        onCerrar={() => setAbierto(false)}
        titulo="Nueva promoción"
        descripcion="Apuntá a un segmento de clientes; el precio con descuento se aplica solo a ellos."
        cerrarAlTocarAfuera={false}
        pie={
          <>
            <Boton variante="secundario" onClick={() => setAbierto(false)}>Cancelar</Boton>
            <Boton onClick={guardar} disabled={cargando}>
              {cargando ? 'Creando…' : 'Crear promoción'}
            </Boton>
          </>
        }
      >
        <div className="space-y-3">
          <Campo etiqueta="Nombre">
            <Entrada
              value={form.nombre}
              onChange={(e) => campo('nombre', e.target.value)}
              placeholder="Ej: Semana del cliente frecuente"
              autoFocus
            />
          </Campo>

          {/* segmento objetivo con ticket promedio */}
          <Campo etiqueta="¿A qué segmento de clientes?">
            <Selector value={form.segmento} onChange={(e) => campo('segmento', e.target.value)}>
              <option value="">Todos los clientes</option>
              {segmentos.map((s) => (
                <option key={s.segmento} value={s.segmento}>
                  {s.etiqueta} · {s.clientes} clientes · ticket {pesos(s.ticketPromedio)}
                </option>
              ))}
            </Selector>
          </Campo>

          {/* recomendación según ticket */}
          <div className="rounded-xl bg-crema-claro p-3">
            <p className="text-sm leading-relaxed text-tinta/70">{sug.texto}</p>
            <Boton variante="secundario" tamano="chico" onClick={aplicarSugerencia} className="mt-2">
              Aplicar sugerencia ({sug.tipo === 'porcentaje' ? `${sug.valor}% off` : sug.valor})
            </Boton>
          </div>

          {/* alcance */}
          <div className="grid grid-cols-2 gap-3">
            <Campo etiqueta="Alcance">
              <Selector value={form.alcance} onChange={(e) => campo('alcance', e.target.value)}>
                <option value="global">Toda la tienda</option>
                <option value="categoria">Una categoría</option>
                <option value="marca">Una marca</option>
                <option value="producto">Un producto</option>
              </Selector>
            </Campo>
            <div className="min-w-0">
              {form.alcance === 'categoria' && (
                <Campo etiqueta="Categoría">
                  <Selector value={form.categoriaId} onChange={(e) => campo('categoriaId', e.target.value)}>
                    <option value="">Elegí…</option>
                    {categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                  </Selector>
                </Campo>
              )}
              {form.alcance === 'marca' && (
                <Campo etiqueta="Marca">
                  <Selector value={form.marcaId} onChange={(e) => campo('marcaId', e.target.value)}>
                    <option value="">Elegí…</option>
                    {marcas.map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}
                  </Selector>
                </Campo>
              )}
              {form.alcance === 'producto' && (
                <Campo etiqueta="SKU del producto">
                  <Entrada value={form.sku} onChange={(e) => campo('sku', e.target.value)} placeholder="SKU" />
                </Campo>
              )}
            </div>
          </div>

          {/* beneficio */}
          <div className="grid grid-cols-2 gap-3">
            <Campo etiqueta="Tipo de beneficio">
              <Selector value={form.tipo} onChange={(e) => campo('tipo', e.target.value)}>
                <option value="porcentaje">% de descuento</option>
                <option value="monto_fijo">$ menos</option>
                <option value="precio_fijo">Precio fijo $</option>
              </Selector>
            </Campo>
            <Campo etiqueta={form.tipo === 'porcentaje' ? 'Porcentaje' : 'Monto'}>
              <Entrada value={form.valor} onChange={(e) => campo('valor', e.target.value)} type="number" />
            </Campo>
          </div>

          {/* vigencia */}
          <div className="grid grid-cols-2 gap-3">
            <Campo etiqueta="Desde">
              <Entrada value={form.desde} onChange={(e) => campo('desde', e.target.value)} type="date" />
            </Campo>
            <Campo etiqueta="Hasta">
              <Entrada value={form.hasta} onChange={(e) => campo('hasta', e.target.value)} type="date" />
            </Campo>
          </div>

          {/* extras */}
          <div className="rounded-xl bg-crema-claro px-3 py-2">
            <label className={CASILLA}>
              <input type="checkbox" checked={form.soloComunidad} onChange={(e) => campo('soloComunidad', e.target.checked)} className={CHECK} />
              Solo para la Comunidad ODB (clientes con identidad verificada)
            </label>
            <label className={CASILLA}>
              <input type="checkbox" checked={form.combinable} onChange={(e) => campo('combinable', e.target.checked)} className={CHECK} />
              Combinable con otras promociones
            </label>
            <label className="flex flex-wrap items-center gap-x-2 gap-y-1 py-1 text-sm text-tinta">
              <span>Solo pagando con</span>
              <Selector value={form.medioPago} onChange={(e) => campo('medioPago', e.target.value)} className="min-w-0 flex-1 basis-40">
                <option value="">cualquier medio</option>
                <option value="efectivo">efectivo</option>
                <option value="tarjeta">tarjeta</option>
                <option value="mercadopago">Mercado Pago</option>
              </Selector>
            </label>
          </div>

          {/* difusión */}
          <div className="space-y-2 rounded-xl border border-black/[0.06] p-3">
            <div className="flex flex-wrap gap-x-4">
              <label className={CASILLA}>
                <input type="radio" checked={!conPauta} onChange={() => setConPauta(false)} className={CHECK} />
                Sin pauta (solo en la app/local)
              </label>
              <label className={CASILLA}>
                <input type="radio" checked={conPauta} onChange={() => setConPauta(true)} className={CHECK} />
                Con pauta publicitaria
              </label>
            </div>

            {conPauta && (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2 text-sm text-tinta">
                  <label className="flex min-w-0 flex-1 basis-48 items-center gap-2">
                    <span>Red:</span>
                    <Selector value={red} onChange={(e) => setRed(e.target.value)} className="min-w-0 flex-1">
                      <option>Instagram/Facebook (Meta)</option>
                      <option>WhatsApp</option>
                      <option>Cartelería en el local</option>
                    </Selector>
                  </label>
                  <Boton variante="secundario" tamano="chico" onClick={generarAnuncio} disabled={generando} className="ml-auto">
                    {generando ? 'Redactando…' : 'Generar aviso'}
                  </Boton>
                </div>

                {anuncio && (
                  <div className="space-y-1.5 rounded-xl bg-crema-claro p-3">
                    <p className="text-sm font-semibold text-tinta">{anuncio.titular}</p>
                    <p className="whitespace-pre-line break-words text-sm text-tinta/70">{anuncio.cuerpo}</p>
                    <p className="text-sm font-semibold text-marca-hondo">{anuncio.cta}</p>
                    <p className="break-words text-xs text-info">{(anuncio.hashtags ?? []).join(' ')}</p>
                    {anuncio.publicoMeta && (
                      <p className="border-t border-black/[0.06] pt-1.5 text-xs text-tinta/60">
                        <strong>Público sugerido (Meta):</strong> {anuncio.publicoMeta}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-2 pt-1">
                      <Boton variante="secundario" tamano="chico" onClick={copiarAviso}>Copiar texto</Boton>
                      {red.includes('Meta') && (
                        <a
                          href="https://business.facebook.com/adsmanager/"
                          target="_blank"
                          rel="noreferrer"
                          className={clasesBoton({ variante: 'fantasma', tamano: 'chico' })}
                        >
                          Abrir Meta Ads Manager →
                        </a>
                      )}
                    </div>
                    <p className="text-xs text-tinta/60">
                      La publicación automática en Meta requiere conectar la cuenta de Meta Business (trámite pendiente). Por ahora: copiá el aviso y subilo desde el administrador de anuncios.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>

          {error && <Aviso tono="error">{error}</Aviso>}
        </div>
      </Modal>
    </>
  );
}
