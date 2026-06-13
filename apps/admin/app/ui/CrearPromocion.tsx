'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Opcion = { id: string; nombre: string };
type Segmento = {
  segmento: string;
  etiqueta: string;
  clientes: number;
  ticketPromedio: number | null;
  ventasIdentificadas: number;
};

const pesos = (n: number | null) => (n == null ? '—' : '$' + Math.round(n).toLocaleString('es-AR'));

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

  const input = 'w-full rounded-lg border border-black/15 px-3 py-2.5 text-sm text-black focus:border-[#B82D25] focus:outline-none';

  return (
    <>
      <button
        onClick={() => setAbierto(true)}
        className="rounded-full bg-[#B82D25] text-white text-sm font-medium px-5 py-2.5 hover:bg-[#932A1F] shadow-sm whitespace-nowrap"
      >
        + Nueva promoción
      </button>

      {abierto && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-[2px] flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl w-full max-w-lg p-6 space-y-3 shadow-2xl max-h-[92vh] overflow-y-auto">
            <div>
              <h2 className="font-semibold text-black text-lg">Nueva promoción</h2>
              <p className="text-xs text-black/45 mt-0.5">
                Apuntá a un segmento de clientes; el precio con descuento se aplica solo a ellos.
              </p>
            </div>

            <input
              value={form.nombre}
              onChange={(e) => campo('nombre', e.target.value)}
              placeholder="Nombre (ej: Semana del cliente frecuente)"
              className={input}
              autoFocus
            />

            {/* segmento objetivo con ticket promedio */}
            <div>
              <label className="text-xs text-black/50">¿A qué segmento de clientes?</label>
              <select value={form.segmento} onChange={(e) => campo('segmento', e.target.value)} className={input + ' mt-1 bg-white'}>
                <option value="">Todos los clientes</option>
                {segmentos.map((s) => (
                  <option key={s.segmento} value={s.segmento}>
                    {s.etiqueta} · {s.clientes} clientes · ticket {pesos(s.ticketPromedio)}
                  </option>
                ))}
              </select>
            </div>

            {/* recomendación según ticket */}
            <div className="rounded-xl bg-[#F0EBE2]/70 p-3">
              <p className="text-xs text-black/70 leading-relaxed">💡 {sug.texto}</p>
              <button onClick={aplicarSugerencia} className="mt-2 text-xs font-medium text-[#B82D25] hover:underline">
                Aplicar sugerencia ({sug.tipo === 'porcentaje' ? `${sug.valor}% off` : sug.valor})
              </button>
            </div>

            {/* alcance */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-black/50">Alcance</label>
                <select value={form.alcance} onChange={(e) => campo('alcance', e.target.value)} className={input + ' mt-1 bg-white'}>
                  <option value="global">Toda la tienda</option>
                  <option value="categoria">Una categoría</option>
                  <option value="marca">Una marca</option>
                  <option value="producto">Un producto</option>
                </select>
              </div>
              <div>
                {form.alcance === 'categoria' && (
                  <>
                    <label className="text-xs text-black/50">Categoría</label>
                    <select value={form.categoriaId} onChange={(e) => campo('categoriaId', e.target.value)} className={input + ' mt-1 bg-white'}>
                      <option value="">Elegí…</option>
                      {categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                    </select>
                  </>
                )}
                {form.alcance === 'marca' && (
                  <>
                    <label className="text-xs text-black/50">Marca</label>
                    <select value={form.marcaId} onChange={(e) => campo('marcaId', e.target.value)} className={input + ' mt-1 bg-white'}>
                      <option value="">Elegí…</option>
                      {marcas.map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}
                    </select>
                  </>
                )}
                {form.alcance === 'producto' && (
                  <>
                    <label className="text-xs text-black/50">SKU del producto</label>
                    <input value={form.sku} onChange={(e) => campo('sku', e.target.value)} placeholder="SKU" className={input + ' mt-1'} />
                  </>
                )}
              </div>
            </div>

            {/* beneficio */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-black/50">Tipo de beneficio</label>
                <select value={form.tipo} onChange={(e) => campo('tipo', e.target.value)} className={input + ' mt-1 bg-white'}>
                  <option value="porcentaje">% de descuento</option>
                  <option value="monto_fijo">$ menos</option>
                  <option value="precio_fijo">Precio fijo $</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-black/50">{form.tipo === 'porcentaje' ? 'Porcentaje' : 'Monto'}</label>
                <input value={form.valor} onChange={(e) => campo('valor', e.target.value)} type="number" className={input + ' mt-1'} />
              </div>
            </div>

            {/* vigencia */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-black/50">Desde</label>
                <input value={form.desde} onChange={(e) => campo('desde', e.target.value)} type="date" className={input + ' mt-1'} />
              </div>
              <div>
                <label className="text-xs text-black/50">Hasta</label>
                <input value={form.hasta} onChange={(e) => campo('hasta', e.target.value)} type="date" className={input + ' mt-1'} />
              </div>
            </div>

            {/* extras */}
            <div className="rounded-xl bg-[#F0EBE2]/40 p-3 space-y-2">
              <label className="flex items-center gap-2 text-xs text-black">
                <input type="checkbox" checked={form.soloComunidad} onChange={(e) => campo('soloComunidad', e.target.checked)} className="accent-[#B82D25]" />
                🔒 Solo para la Comunidad ODB (clientes con identidad verificada)
              </label>
              <label className="flex items-center gap-2 text-xs text-black">
                <input type="checkbox" checked={form.combinable} onChange={(e) => campo('combinable', e.target.checked)} className="accent-[#B82D25]" />
                Combinable con otras promociones
              </label>
              <div className="flex items-center gap-2 text-xs text-black">
                <span>Solo pagando con</span>
                <select value={form.medioPago} onChange={(e) => campo('medioPago', e.target.value)} className="rounded-lg border border-black/15 px-2 py-1 text-xs bg-white">
                  <option value="">cualquier medio</option>
                  <option value="efectivo">efectivo</option>
                  <option value="tarjeta">tarjeta</option>
                  <option value="mercadopago">Mercado Pago</option>
                </select>
              </div>
            </div>

            {/* difusión */}
            <div className="rounded-xl border border-black/10 p-3 space-y-2">
              <div className="flex gap-4 text-xs">
                <label className="flex items-center gap-1.5 text-black">
                  <input type="radio" checked={!conPauta} onChange={() => setConPauta(false)} className="accent-[#B82D25]" />
                  Sin pauta (solo en la app/local)
                </label>
                <label className="flex items-center gap-1.5 text-black">
                  <input type="radio" checked={conPauta} onChange={() => setConPauta(true)} className="accent-[#B82D25]" />
                  📣 Con pauta publicitaria
                </label>
              </div>

              {conPauta && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-xs text-black">
                    <span>Red:</span>
                    <select value={red} onChange={(e) => setRed(e.target.value)} className="rounded-lg border border-black/15 px-2 py-1 text-xs bg-white">
                      <option>Instagram/Facebook (Meta)</option>
                      <option>WhatsApp</option>
                      <option>Cartelería en el local</option>
                    </select>
                    <button onClick={generarAnuncio} disabled={generando} className="ml-auto rounded-full bg-black text-white text-xs font-medium px-3 py-1.5 hover:bg-black/80 disabled:opacity-50">
                      {generando ? 'Redactando…' : '✨ Generar aviso'}
                    </button>
                  </div>

                  {anuncio && (
                    <div className="rounded-lg bg-[#F0EBE2]/70 p-3 space-y-1.5">
                      <p className="font-semibold text-black text-sm">{anuncio.titular}</p>
                      <p className="text-xs text-black/70 whitespace-pre-line">{anuncio.cuerpo}</p>
                      <p className="text-xs text-[#932A1F] font-medium">{anuncio.cta}</p>
                      <p className="text-[11px] text-sky-700">{(anuncio.hashtags ?? []).join(' ')}</p>
                      {anuncio.publicoMeta && (
                        <p className="text-[11px] text-black/50 border-t border-black/10 pt-1.5">
                          <strong>Público sugerido (Meta):</strong> {anuncio.publicoMeta}
                        </p>
                      )}
                      <div className="flex gap-2 pt-1">
                        <button onClick={copiarAviso} className="text-xs font-medium text-black/60 hover:text-black">Copiar texto</button>
                        {red.includes('Meta') && (
                          <a href="https://business.facebook.com/adsmanager/" target="_blank" rel="noreferrer" className="text-xs font-medium text-[#B82D25] hover:underline">
                            Abrir Meta Ads Manager →
                          </a>
                        )}
                      </div>
                      <p className="text-[10px] text-black/35">
                        La publicación automática en Meta requiere conectar la cuenta de Meta Business (trámite pendiente). Por ahora: copiá el aviso y subilo desde el administrador de anuncios.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>

            {error && <p className="text-xs text-[#B82D25] font-medium">{error}</p>}

            <div className="flex justify-end gap-3 pt-1">
              <button onClick={() => setAbierto(false)} className="text-sm text-black/60 px-4 py-2 hover:text-black">Cancelar</button>
              <button onClick={guardar} disabled={cargando} className="rounded-full bg-[#B82D25] text-white text-sm font-medium px-6 py-2.5 hover:bg-[#932A1F] disabled:opacity-50">
                {cargando ? 'Creando…' : 'Crear promoción'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
