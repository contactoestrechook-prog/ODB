'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Aviso, Boton, BotonLink, Cargando, Chip, Entrada, Etiqueta, Kpi, Pestanas, TablaResponsiva, Tarjeta, TarjetaCabecera, TarjetaCuerpo, unir, useConfirmar } from './kit';
import { fechaHora, hora, numero, pesos } from '../lib/formato';
import { filtrarPorBusqueda } from '../lib/busqueda';
import { ESTADO_ARQUEO, textoAlcance } from './ArqueoLista';

// Revisión de un arqueo (gerencia, 24/10/2026): avance en vivo, diferencias
// valorizadas a costo, reconteos, lo que no se contó, lo que el sistema no
// reconoció y quién contó qué. Al final se aplica en un paso con PIN y queda el
// informe para imprimir.

type Item = {
  productoId: string; sku: string; nombre: string; categoria: string | null; contado: number; sistema: number; diferencia: number;
  costo: number | null; valor: number | null; ubicaciones: string; registros: number; contadores: number; recontado: boolean;
  enAlcance: boolean; reconteoPedido: boolean; contadoEn: string; superaUmbral: boolean;
};
type Revision = {
  id: string; nombre: string; estado: string; alcance: any; ciego: boolean; sucursal: string; umbralUnidades: number; umbralPesos: number;
  creadoEn: string; enRevisionEn: string | null; aplicadoEn: string | null; resumen: any;
  totales: { contados: number; esperados: number; sinContar: number; sinDiferencia: number; exactitudPct: number | null; valorSobrante: number; valorFaltante: number; valorSinContar: number; reconteosPendientes: number };
  items: Item[];
  sinContar: { productoId: string; sku: string; nombre: string; categoria: string | null; sistema: number; valor: number | null }[];
  noEncontrados: { id: string; codigo: string; descripcion: string | null; cantidad: number | null; ubicacion: string | null; quien: string | null; creadoEn: string }[];
  personas: { nombre: string; lecturas: number; productos: number; desde: string; hasta: string }[];
};

const cant = (n: number) => numero(n, Number.isInteger(n) ? 0 : 3);

export function ArqueoRevision({ id, puedeAplicarSolo }: { id: string; puedeAplicarSolo: boolean }) {
  const [r, setR] = useState<Revision | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [vista, setVista] = useState<'diferencias' | 'sin-contar' | 'no-encontrados' | 'equipo'>('diferencias');
  const [soloDif, setSoloDif] = useState(true);
  const [busca, setBusca] = useState('');
  const [trabajando, setTrabajando] = useState(false);
  const [sinContarModo, setSinContarModo] = useState<'dejar' | 'cero'>('dejar');
  const [pin, setPin] = useState('');
  const { confirmar, dialogo } = useConfirmar();

  const cargar = useCallback(async () => {
    try {
      const res = await fetch(`/api/arqueo?ruta=${id}/revision`);
      const j = await res.json();
      if (!res.ok) throw new Error(j?.message ?? 'No pude traer el arqueo');
      setR(j); setError(null);
    } catch (e: any) { setError(e.message); }
  }, [id]);
  // en vivo mientras se cuenta
  useEffect(() => {
    cargar();
    const t = setInterval(() => { if (r?.estado === 'abierto' || r?.estado === 'en_revision') cargar(); }, 15000);
    return () => clearInterval(t);
  }, [cargar, r?.estado]);

  async function accion(ruta: string, cuerpo: any = {}) {
    setTrabajando(true); setError(null);
    try {
      const res = await fetch('/api/arqueo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ruta: `${id}/${ruta}`, ...cuerpo }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.message ?? 'No se pudo');
      await cargar();
      return j;
    } catch (e: any) { setError(e.message); return null; } finally { setTrabajando(false); }
  }

  async function aplicar() {
    if (!r) return;
    const ajustes = r.items.filter((i) => i.diferencia !== 0).length;
    const extra = sinContarModo === 'cero' && r.totales.sinContar ? ` y se ponen en cero ${r.totales.sinContar} productos que no se contaron (${pesos(r.totales.valorSinContar)})` : '';
    if (!(await confirmar({ titulo: '¿Aplicar el arqueo?', texto: `Se ajustan ${ajustes} productos${extra}. Queda registrado y no se puede deshacer desde acá.`, textoConfirmar: 'Aplicar', variante: 'peligro' }))) return;
    let autorizacionToken: string | undefined;
    if (!puedeAplicarSolo) {
      if (!pin.trim()) { setError('Hace falta el PIN de un supervisor'); return; }
      const ra = await fetch('/api/caja', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'autorizar', pin }) });
      const da = await ra.json().catch(() => ({}));
      if (!ra.ok) { setError(da?.message ?? 'PIN incorrecto'); return; }
      autorizacionToken = da.token;
    }
    const res = await accion('aplicar', { sinContar: sinContarModo, autorizacionToken });
    if (res) setPin('');
  }

  const items = useMemo(() => {
    const base = (r?.items ?? []).filter((i) => !soloDif || i.diferencia !== 0 || i.reconteoPedido);
    return filtrarPorBusqueda(base, busca, (i) => `${i.nombre} ${i.sku} ${i.categoria ?? ''}`);
  }, [r, soloDif, busca]);

  if (error && !r) return <Aviso tono="error" titulo="No pude abrir el arqueo">{error}</Aviso>;
  if (!r) return <Cargando />;
  const t = r.totales;
  const abierto = r.estado === 'abierto' || r.estado === 'en_revision';
  const avancePct = t.esperados ? Math.min(100, Math.round((100 * r.items.filter((i) => i.enAlcance).length) / t.esperados)) : null;

  return (
    <div className="space-y-4 print:space-y-2">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="break-words text-xl font-semibold text-tinta">{r.nombre}</p>
          <p className="text-sm text-tinta/70">{r.sucursal} · {textoAlcance(r.alcance)}{r.ciego ? ' · conteo ciego' : ''} · armado {fechaHora(r.creadoEn)}</p>
          {r.aplicadoEn && <p className="text-sm text-tinta/70">Aplicado {fechaHora(r.aplicadoEn)}</p>}
        </div>
        <Etiqueta tono={ESTADO_ARQUEO[r.estado]?.tono ?? 'neutro'}>{ESTADO_ARQUEO[r.estado]?.texto ?? r.estado}</Etiqueta>
      </div>
      {error && <Aviso tono="error">{error}</Aviso>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi etiqueta="Contados" valor={numero(t.contados)} sub={avancePct != null ? `${avancePct}% de los ${numero(t.esperados)} con stock en el sistema` : undefined} />
        <Kpi etiqueta="Exactitud" valor={t.exactitudPct != null ? `${t.exactitudPct}%` : '—'} sub={`${numero(t.sinDiferencia)} sin diferencia`} tono={t.exactitudPct != null && t.exactitudPct >= 95 ? 'ok' : t.exactitudPct != null && t.exactitudPct < 85 ? 'error' : 'neutro'} />
        <Kpi etiqueta="Faltante" valor={pesos(t.valorFaltante)} sub="a costo" tono={t.valorFaltante > 0 ? 'error' : 'neutro'} />
        <Kpi etiqueta="Sobrante" valor={pesos(t.valorSobrante)} sub="a costo" tono={t.valorSobrante > 0 ? 'info' : 'neutro'} />
      </div>

      {abierto && (
        <Tarjeta className="print:hidden">
          {r.estado === 'abierto' ? (
            <div className="space-y-2">
              <p className="text-sm text-tinta">
                El equipo está contando{r.personas.length ? `: ${r.personas.map((p) => p.nombre).join(', ')}` : ''}. Esta pantalla se actualiza sola.
                Cuando terminen, cerrá el conteo: lo que dé una diferencia de {r.umbralUnidades} u. o {pesos(r.umbralPesos)} se manda a recontar.
              </p>
              <div className="flex flex-wrap gap-2">
                <Boton onClick={() => accion('a-revision')} disabled={trabajando || !t.contados}>Cerrar conteo y revisar</Boton>
                <BotonLink href={`/arqueo/${id}/contar`} variante="secundario">Contar yo también</BotonLink>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {t.reconteosPendientes > 0 ? (
                <Aviso tono="atencion" titulo={`${t.reconteosPendientes} para recontar`}>
                  El equipo los ve en la pestaña «Recontar» del celular. Si alguno no hace falta, sacalo de la lista con «No recontar».
                </Aviso>
              ) : <Aviso tono="ok">No hay reconteos pendientes. Revisá las diferencias y aplicá.</Aviso>}
              <div>
                <p className="mb-1 text-sm font-semibold text-tinta">Lo que el sistema dice que hay y nadie contó ({numero(t.sinContar)}, {pesos(t.valorSinContar)} a costo)</p>
                <div className="flex flex-wrap gap-2">
                  <Chip activo={sinContarModo === 'dejar'} onClick={() => setSinContarModo('dejar')}>Dejarlo como está</Chip>
                  <Chip activo={sinContarModo === 'cero'} onClick={() => setSinContarModo('cero')}>Ponerlo en cero</Chip>
                </div>
                <p className="mt-1 text-xs text-tinta/60">«Dejarlo» es lo seguro en un arqueo parcial. «En cero» solo si se recorrió todo y de verdad no está.</p>
              </div>
              {!puedeAplicarSolo && (
                <Entrada type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)} placeholder="PIN del supervisor" aria-label="PIN del supervisor" />
              )}
              <div className="flex flex-wrap gap-2">
                <Boton onClick={aplicar} disabled={trabajando || t.reconteosPendientes > 0}>Aplicar el arqueo</Boton>
                <Boton variante="secundario" onClick={() => accion('reabrir')} disabled={trabajando}>Reabrir para seguir contando</Boton>
                <Boton variante="peligro" onClick={async () => { if (await confirmar({ titulo: '¿Descartar el arqueo?', texto: 'No se ajusta nada. Las lecturas quedan guardadas.', variante: 'peligro', textoConfirmar: 'Descartar' })) accion('descartar'); }} disabled={trabajando}>Descartar</Boton>
              </div>
            </div>
          )}
        </Tarjeta>
      )}

      {r.estado === 'aplicado' && r.resumen && (
        <Tarjeta>
          <TarjetaCabecera titulo="Resultado" accion={<Boton variante="secundario" tamano="chico" onClick={() => window.print()} className="print:hidden">Imprimir informe</Boton>} />
          <TarjetaCuerpo className="text-sm text-tinta">
            Se contaron {numero(r.resumen.productos_contados)} productos; {numero(r.resumen.sin_diferencia)} sin diferencia ({r.resumen.exactitud_pct ?? '—'}% de exactitud).
            Se ajustaron {numero(r.resumen.ajustados)}: faltaron {cant(Number(r.resumen.unidades_faltantes))} u. ({pesos(r.resumen.valor_faltante)}) y sobraron {cant(Number(r.resumen.unidades_sobrantes))} u. ({pesos(r.resumen.valor_sobrante)}).
            {r.resumen.no_contados_en_cero ? ` Se pusieron en cero ${r.resumen.no_contados_en_cero} productos que no se encontraron.` : ' Lo que no se contó quedó como estaba.'}
          </TarjetaCuerpo>
        </Tarjeta>
      )}

      <Pestanas valor={vista} onCambiar={setVista} opciones={[
        { valor: 'diferencias', etiqueta: 'Contado', cuenta: r.items.length },
        { valor: 'sin-contar', etiqueta: 'Sin contar', cuenta: t.sinContar },
        { valor: 'no-encontrados', etiqueta: 'No reconocidos', cuenta: r.noEncontrados.length || undefined },
        { valor: 'equipo', etiqueta: 'Equipo', cuenta: r.personas.length },
      ]} />

      {vista === 'diferencias' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3 print:hidden">
            <div className="min-w-0 flex-1"><Entrada value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar producto o rubro" aria-label="Buscar" /></div>
            <label className="flex items-center gap-2 text-sm text-tinta/70">
              <input type="checkbox" checked={soloDif} onChange={(e) => setSoloDif(e.target.checked)} className="size-4 accent-marca" /> Solo con diferencia
            </label>
          </div>
          <TablaResponsiva<Item>
            filas={items.slice(0, 400)} claveFila={(i) => i.productoId}
            vacio={<p className="p-4 text-sm text-tinta/60">{r.items.length ? 'Todo lo contado coincide con el sistema.' : 'Todavía no se contó nada.'}</p>}
            columnas={[
              { clave: 'p', titulo: 'Producto', principal: true, celda: (i) => (
                <div className="min-w-0">
                  <p className="break-words font-medium text-tinta">{i.nombre}</p>
                  <p className="text-xs text-tinta/60">{i.sku}{i.categoria ? ` · ${i.categoria}` : ''} · {i.ubicaciones}{!i.enAlcance ? ' · fuera del alcance' : ''}</p>
                  {i.reconteoPedido && <p className={unir('text-xs font-semibold', i.recontado ? 'text-ok' : 'text-atencion')}>{i.recontado ? 'Recontado' : 'A recontar'}</p>}
                </div>
              ) },
              { clave: 'c', titulo: 'Contado', importe: true, celda: (i) => cant(i.contado) },
              { clave: 's', titulo: 'Sistema', importe: true, celda: (i) => cant(i.sistema) },
              { clave: 'd', titulo: 'Diferencia', importe: true, celda: (i) => <span className={unir('font-semibold', i.diferencia < 0 ? 'text-marca-hondo' : i.diferencia > 0 ? 'text-info' : 'text-tinta/60')}>{i.diferencia > 0 ? '+' : ''}{cant(i.diferencia)}</span> },
              { clave: 'v', titulo: 'A costo', importe: true, celda: (i) => i.valor != null ? <span className={i.valor < 0 ? 'text-marca-hondo' : ''}>{pesos(i.valor)}</span> : <span className="text-tinta/60">sin costo</span> },
              ...(abierto ? [{ clave: 'a', titulo: '', acciones: true, celda: (i: Item) => i.reconteoPedido
                ? <Boton variante="fantasma" tamano="chico" disabled={trabajando} onClick={() => accion('reconteo', { sku: i.sku, pedir: false })}>No recontar</Boton>
                : i.diferencia !== 0 ? <Boton variante="fantasma" tamano="chico" disabled={trabajando} onClick={() => accion('reconteo', { sku: i.sku, pedir: true })}>Pedir reconteo</Boton> : null }] : []),
            ]}
          />
          {items.length > 400 && <p className="text-xs text-tinta/60">Se muestran 400 de {items.length}: buscá para encontrar el resto.</p>}
        </div>
      )}

      {vista === 'sin-contar' && (
        <TablaResponsiva
          filas={r.sinContar} claveFila={(i) => i.productoId}
          vacio={<p className="p-4 text-sm text-tinta/60">Se contó todo lo que el sistema dice que hay.</p>}
          columnas={[
            { clave: 'p', titulo: 'Producto', principal: true, celda: (i) => <div className="min-w-0"><p className="break-words text-tinta">{i.nombre}</p><p className="text-xs text-tinta/60">{i.sku}{i.categoria ? ` · ${i.categoria}` : ''}</p></div> },
            { clave: 's', titulo: 'Sistema', importe: true, celda: (i) => cant(i.sistema) },
            { clave: 'v', titulo: 'A costo', importe: true, celda: (i) => i.valor != null ? pesos(i.valor) : '—' },
          ]}
          pie={t.sinContar > r.sinContar.length ? <p className="p-3 text-xs text-tinta/60">Se muestran los {r.sinContar.length} de más valor de {numero(t.sinContar)}.</p> : undefined}
        />
      )}

      {vista === 'no-encontrados' && (
        r.noEncontrados.length === 0 ? <p className="text-sm text-tinta/60">El equipo no anotó productos desconocidos.</p> : (
          <div className="space-y-2">
            <p className="text-sm text-tinta/70">Productos que el sistema no reconoció al escanear. Vinculá el código desde Productos (o la caja) y pedí que los vuelvan a contar.</p>
            {r.noEncontrados.map((n) => (
              <Tarjeta key={n.id}>
                <p className="break-words font-semibold text-tinta">{n.descripcion || 'Sin descripción'}</p>
                <p className="text-xs text-tinta/60">Código {n.codigo}{n.cantidad != null ? ` · ${n.cantidad} u.` : ''}{n.ubicacion ? ` · ${n.ubicacion}` : ''}{n.quien ? ` · ${n.quien}` : ''} · {hora(n.creadoEn)}</p>
              </Tarjeta>
            ))}
          </div>
        )
      )}

      {vista === 'equipo' && (
        <TablaResponsiva
          filas={r.personas} claveFila={(p) => p.nombre}
          vacio={<p className="p-4 text-sm text-tinta/60">Nadie contó todavía.</p>}
          columnas={[
            { clave: 'n', titulo: 'Quién', principal: true, celda: (p) => p.nombre },
            { clave: 'l', titulo: 'Lecturas', importe: true, celda: (p) => numero(p.lecturas) },
            { clave: 'p', titulo: 'Productos', importe: true, celda: (p) => numero(p.productos) },
            { clave: 'h', titulo: 'Horario', celda: (p) => `${hora(p.desde)} a ${hora(p.hasta)}` },
          ]}
        />
      )}
      {dialogo}
      <div className="print:hidden"><BotonLink href="/arqueo" variante="fantasma" tamano="chico">← Volver a los arqueos</BotonLink></div>
    </div>
  );
}
