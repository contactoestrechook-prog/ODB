import { cantidadPedible, nombreSucursal } from './propuesta';

// El tablero del Analista ODB (2/10/2026): lo que hay que comprar y lo que está
// parado, POR PROVEEDOR, armado en código a partir de los renglones del motor
// de abastecimiento. El modelo no calcula ninguna cifra: escribe el veredicto y
// una línea por proveedor; la pantalla dibuja esto (PlacaProveedores.tsx).
//
// La plata a comprar usa el MISMO universo y el mismo redondeo que las notas de
// pedido de "Qué comprar": renglones CON alerta, con proveedor y sugerido > 0
// (las notas leen el motor con p_solo_alertas), redondeados con cantidadPedible.
// La placa y las notas tienen que dar lo mismo (revisión del 2/10: sumando los
// sin alerta, Luvik en Saint Thomas daba $240.066 de más).

export const DIAS_SOBRESTOCK = 90; // más que esto de stock (con ventas) es plata que sobra
export const COSTO_MINIMO = 100; // un costo menor es un dato roto (Jack Daniel's a $36,50): no se suma
const DIAS_DATO_VIEJO = 30;

export type DatosTablero = {
  ventasHasta: string | null;
  datoViejo: boolean;
  ritmoFuente: string;
  plazosProvisorios: { provisorios: number; total: number };
};

export type ProveedorCompra = {
  proveedorId: string;
  proveedor: string;
  productos: number;
  urgentes: number;
  plata: number;
  plataUrgente: number;
  porSucursal: { sucursal: string; plata: number }[];
  faltan: string[];
  plazoDias: number;
  plazoProvisorio: boolean;
  aRevisar: number;
  // solo para el modelo: los más urgentes, para que pueda nombrarlos
  top3?: { sku: string; nombre: string; sucursal: string; alerta: string | null; sugerido: number }[];
};

export type ComprasTablero = {
  total: number;
  totalUrgente: number;
  proveedores: ProveedorCompra[];
  sinProveedor: { productos: number; urgentes: number };
};

export type ProveedorParado = {
  proveedorId: string | null;
  proveedor: string;
  quietos: number;
  plataQuieta: number;
  sobran: number;
  plataSobra: number;
  masCaro: { nombre: string; plata: number } | null;
};

export type ParadoTablero = {
  totalQuieto: number;
  totalSobra: number;
  proveedores: ProveedorParado[];
  sinValorizar: number;
};

export type Tablero = { datos: DatosTablero; compras: ComprasTablero; parado: ParadoTablero };

const URGENTE = new Set(['sin_stock', 'no_llega']);
const provisorio = (fuente: unknown) => /sin confirmar|por defecto/i.test(String(fuente ?? ''));
const n = (v: unknown) => (v == null || Number.isNaN(Number(v)) ? 0 : Number(v));

// Costo para valorizar: el último costo de compra; si no hay, el del catálogo.
export function costoDe(f: any, costos: Map<string, number>): number | null {
  const ultimo = f?.ultimo_costo == null ? NaN : Number(f.ultimo_costo);
  if (Number.isFinite(ultimo) && ultimo > 0) return ultimo;
  const cat = costos.get(f?.producto_id);
  return cat != null && cat > 0 ? cat : null;
}

export function armarTablero(filas: any[], costos: Map<string, number> = new Map(), ahora = Date.now()): Tablero {
  // ---- de cuándo son los datos
  let ventasHasta: string | null = null;
  const fuentes = new Map<string, number>();
  const plazoPorProveedor = new Map<string, boolean>();
  for (const f of filas) {
    if (f?.ritmo_hasta && (!ventasHasta || String(f.ritmo_hasta) > ventasHasta)) ventasHasta = String(f.ritmo_hasta).slice(0, 10);
    if (n(f?.ritmo_dia) > 0 && f?.ritmo_fuente) fuentes.set(f.ritmo_fuente, (fuentes.get(f.ritmo_fuente) ?? 0) + 1);
    if (f?.proveedor_id) plazoPorProveedor.set(f.proveedor_id, provisorio(f.plazo_fuente));
  }
  const ritmoFuente = [...fuentes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'sin datos de ventas';
  const datoViejo = !ventasHasta || ahora - new Date(`${ventasHasta}T12:00:00Z`).getTime() > DIAS_DATO_VIEJO * 86400_000;
  const datos: DatosTablero = {
    ventasHasta,
    datoViejo,
    ritmoFuente,
    plazosProvisorios: { provisorios: [...plazoPorProveedor.values()].filter(Boolean).length, total: plazoPorProveedor.size },
  };

  // ---- lo que hay que comprar, por proveedor
  const porProv = new Map<string, ProveedorCompra & { _top: any[]; _suc: Map<string, number> }>();
  const sinProveedor = { productos: 0, urgentes: 0 };
  for (const f of filas) {
    if (!f?.alerta) continue; // lo que no tiene alerta no está en las notas
    const cantidad = cantidadPedible(f?.cantidad_sugerida);
    if (!cantidad) continue;
    const urgente = URGENTE.has(f?.alerta);
    if (!f?.proveedor_id) {
      sinProveedor.productos++;
      if (urgente) sinProveedor.urgentes++;
      continue;
    }
    let p = porProv.get(f.proveedor_id);
    if (!p) {
      p = {
        proveedorId: f.proveedor_id, proveedor: f.proveedor ?? '—', productos: 0, urgentes: 0, plata: 0, plataUrgente: 0,
        porSucursal: [], faltan: Array.isArray(f.proveedor_faltan) ? f.proveedor_faltan : [],
        plazoDias: n(f.plazo_dias) || 7, plazoProvisorio: provisorio(f.plazo_fuente), aRevisar: 0, _top: [], _suc: new Map(),
      };
      porProv.set(f.proveedor_id, p);
    }
    p.productos++;
    if (urgente) p.urgentes++;
    const costo = f?.ultimo_costo == null ? null : Number(f.ultimo_costo);
    if (costo == null || !Number.isFinite(costo) || costo < COSTO_MINIMO) {
      p.aRevisar++;
    } else {
      const plata = costo * cantidad;
      p.plata += plata;
      if (urgente) p.plataUrgente += plata;
      const suc = nombreSucursal(f.sucursal);
      p._suc.set(suc, (p._suc.get(suc) ?? 0) + plata);
    }
    p._top.push(f);
  }
  const proveedores: ProveedorCompra[] = [...porProv.values()]
    .map(({ _top, _suc, ...p }) => ({
      ...p,
      plata: Math.round(p.plata),
      plataUrgente: Math.round(p.plataUrgente),
      porSucursal: [..._suc.entries()].map(([sucursal, plata]) => ({ sucursal, plata: Math.round(plata) })).sort((a, b) => b.plata - a.plata),
      top3: _top
        .sort((a, b) => n(b.urgencia) - n(a.urgencia))
        .slice(0, 3)
        .map((f) => ({ sku: f.sku, nombre: f.nombre, sucursal: nombreSucursal(f.sucursal), alerta: f.alerta ?? null, sugerido: cantidadPedible(f.cantidad_sugerida) })),
    }))
    .sort((a, b) => b.plata - a.plata || b.urgentes - a.urgentes || a.proveedor.localeCompare(b.proveedor));
  const compras: ComprasTablero = {
    total: proveedores.reduce((s, p) => s + p.plata, 0),
    totalUrgente: proveedores.reduce((s, p) => s + p.plataUrgente, 0),
    proveedores,
    sinProveedor,
  };

  // ---- lo que está parado: lo que no se vende y lo que sobra
  const parados = new Map<string, ProveedorParado>();
  let sinValorizar = 0;
  for (const f of filas) {
    // la MISMA clasificación que el estado del Analista (estadoDe): un producto
    // no puede estar a la vez en COMPRAS y en PLATA PARADA, y lo quieto da igual
    // que el capital inmovilizado del informe de las 7
    const estado = estadoDe(f);
    const quieto = estado === 'muerto';
    const sobra = estado === 'sobrestock';
    if (!quieto && !sobra) continue;
    const stock = n(f?.stock);
    const ritmo = n(f?.ritmo_dia);
    const costo = costoDe(f, costos);
    if (costo == null) { sinValorizar++; continue; }
    const unidades = quieto ? stock : Math.max(0, stock - ritmo * DIAS_SOBRESTOCK);
    const plata = unidades * costo;
    const clave = f?.proveedor_id ?? '__sin__';
    let p = parados.get(clave);
    if (!p) {
      p = { proveedorId: f?.proveedor_id ?? null, proveedor: f?.proveedor_id ? (f.proveedor ?? '—') : 'Sin proveedor habitual', quietos: 0, plataQuieta: 0, sobran: 0, plataSobra: 0, masCaro: null };
      parados.set(clave, p);
    }
    if (quieto) { p.quietos++; p.plataQuieta += plata; } else { p.sobran++; p.plataSobra += plata; }
    if (!p.masCaro || plata > p.masCaro.plata) p.masCaro = { nombre: f?.nombre ?? f?.sku ?? '—', plata };
  }
  const listaParado = [...parados.values()]
    .map((p) => ({ ...p, plataQuieta: Math.round(p.plataQuieta), plataSobra: Math.round(p.plataSobra), masCaro: p.masCaro ? { ...p.masCaro, plata: Math.round(p.masCaro.plata) } : null }))
    .sort((a, b) => (b.plataQuieta + b.plataSobra) - (a.plataQuieta + a.plataSobra));
  const parado: ParadoTablero = {
    totalQuieto: listaParado.reduce((s, p) => s + p.plataQuieta, 0),
    totalSobra: listaParado.reduce((s, p) => s + p.plataSobra, 0),
    proveedores: listaParado,
    sinValorizar,
  };

  return { datos, compras, parado };
}

// ---- El renglón del Analista (FilaAnalisis) a partir del motor: misma forma de
// siempre, para no romper el informe diario, Promociones ni Estadísticas.
export type EstadoAnalisis = 'quiebre_inminente' | 'reponer' | 'sobrestock' | 'muerto' | 'ok';

export function estadoDe(f: any): EstadoAnalisis {
  const ritmo = n(f?.ritmo_dia);
  if (URGENTE.has(f?.alerta)) return 'quiebre_inminente';
  if (f?.alerta === 'menos_de_12' || cantidadPedible(f?.cantidad_sugerida) > 0) return 'reponer';
  if (n(f?.stock) > 0 && ritmo === 0) return 'muerto';
  if (ritmo > 0 && f?.cobertura_dias != null && n(f.cobertura_dias) > DIAS_SOBRESTOCK) return 'sobrestock';
  return 'ok';
}
