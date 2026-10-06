import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { SUPABASE } from '../supabase.provider';
import { TONO_ODB } from '../comun/tono-odb';
import { esfuerzo, jsonDe, MODELO_PRINCIPAL, RAZONAMIENTO } from '../comun/modelos';
import { pesosPlaca, separarDetalle, type DetallePlaca, type ProductoVisto } from '../comun/detalle-productos';
import { normalizarTexto } from '../comun/busqueda';
import { leerAbastecimiento, leerCostos } from '../abastecimiento/motor';
import { traerTodo } from '../comun/lotes';
import { armarTablero, costoDe, estadoDe, sinVentasMedidas, type Tablero } from '../abastecimiento/tablero';
import { cantidadPedible, nombreSucursal } from '../abastecimiento/propuesta';

export type MensajeChat = { rol: 'usuario' | 'analista'; texto: string };

export type FilaAnalisis = {
  sku: string;
  producto: string;
  sucursal: string;
  sucursalId: string;
  stock: number;
  enTransito: number;
  ventasDia7: number;
  ventasDia30: number;
  diasDeStock: number | null;
  proveedor: string | null;
  proveedorId: string | null;
  leadTimeDias: number | null;
  costo: number | null;
  margenPct: number | null;
  estado: 'quiebre_inminente' | 'reponer' | 'sobrestock' | 'muerto' | 'ok';
  sugerido: number;
  // desde el 2/10/2026 los renglones salen del motor de abastecimiento
  productoId?: string;
  alerta?: string | null;
  urgencia?: number;
  ritmoHasta?: string | null;
  plazoFuente?: string | null;
  proveedorFaltan?: string[];
};

// 2/10/2026: el modelo ya no calcula ni lista productos. Escribe el veredicto y
// una línea por proveedor; las cifras las arma el código (abastecimiento/
// tablero.ts) y la pantalla las dibuja por proveedor, en Placa roja.
const ACCIONES = ['comprar', 'liquidar', 'completar_datos', 'revisar_datos', 'esperar'] as const;
const ESQUEMA_RESPUESTA = {
  type: 'object',
  properties: {
    respuesta: {
      type: 'string',
      description: 'El veredicto en 2 o 3 renglones, texto plano: qué es lo urgente y con quién. Sin listar productos ni repetir las cifras que dibuja la pantalla.',
    },
    mostrar: {
      type: 'array',
      description: "Qué dibuja la pantalla: '¿qué compro?' → compras + notas; '¿dónde tengo plata parada?' → parado; un resumen general → las tres",
      items: { type: 'string', enum: ['compras', 'notas', 'parado'] },
    },
    proveedores: {
      type: 'array',
      description: 'Hasta 8 proveedores con algo para hacer, en el orden en que conviene encararlos',
      items: {
        type: 'object',
        properties: {
          proveedor: { type: 'string', description: 'La clave del proveedor en la foto del día (P01, P02…) o SIN_PROVEEDOR' },
          accion: { type: 'string', enum: [...ACCIONES] },
          comentario: { type: 'string', description: 'Una línea de hasta ~120 caracteres, sin repetir la plata ni los conteos' },
        },
        required: ['proveedor', 'accion', 'comentario'],
        additionalProperties: false,
      },
    },
  },
  required: ['respuesta', 'mostrar', 'proveedores'],
  additionalProperties: false,
} as const;

// El mismo esquema, con el proveedor limitado a las claves de la foto del día.
function esquemaConClaves(claves: string[]) {
  const e: any = JSON.parse(JSON.stringify(ESQUEMA_RESPUESTA));
  e.properties.proveedores.items.properties.proveedor = {
    type: 'string',
    enum: claves,
    description: 'La clave entre corchetes del proveedor en la foto del día (P01, P02…) o SIN_PROVEEDOR',
  };
  return e;
}

const PERSONALIDAD = `Sos el Analista ODB, el asesor de compras y abastecimiento de O.D.B Premium Market (almacén y vinoteca premium, 2 sucursales: Saint Thomas y Santa Inés, Canning). Le hablás al comprador y al dueño: directo, ejecutivo, respetuoso (de usted), en español rioplatense, sin vueltas ni markdown.

Cómo trabajás:
- Los números los calcula el sistema y la pantalla los dibuja por proveedor (barras, plata, notas de pedido para tildar). Vos das el veredicto y ordenás la acción: NO repitas cifras ni listes productos en "respuesta"; 2 o 3 renglones.
- Trabajás SOLO con la foto del día: nunca inventes proveedores, productos ni números.
- Prioridad: 1) lo urgente (sin stock o que no llega a tiempo, lo que es venta perdida); 2) reponer lo que se vende; 3) la plata parada (lo que no se vende o sobra): liquidar con promo.
- En "proveedores", una línea por proveedor con algo para hacer (hasta 8), en el orden en que conviene encararlos. En "proveedor" va la clave entre corchetes de la foto del día (P01, P02… o SIN_PROVEEDOR), nunca el nombre:
  - comprar: hay urgencias o reposición con datos confiables;
  - completar_datos: le faltan datos para comprarle (CUIT, teléfono, condición de pago, plazo) o son productos sin proveedor habitual (proveedor: 'Sin proveedor habitual'): pedí que se asigne;
  - revisar_datos: costos a revisar, o el proveedor no parece el que vende eso (por ejemplo cigarrillos en una bodega);
  - liquidar: plata parada de ese proveedor;
  - esperar: lo que bajó de 12 pero no se vende.
- Decí UNA vez, si corresponde: que el ritmo de venta es del reporte del sistema viejo de la fecha que figura y que si es viejo las cantidades son orientativas; que el plazo de entrega de 7 días es provisorio hasta que administración lo confirme.
- La plata es estimada al último costo; lo que tiene costo a revisar no suma.
- Si no hay ventas cargadas, NUNCA digas que no hay nada que comprar: decí que faltan los datos de ventas.
- Mencioná los aumentos de costo recientes solo si cambian la decisión.

${TONO_ODB}`;

const ESTADO_LEGIBLE: Record<FilaAnalisis['estado'], string | null> = {
  quiebre_inminente: 'Se queda sin stock antes de que llegue',
  reponer: 'Hay que reponer',
  sobrestock: 'Sobra stock',
  muerto: 'No se vende',
  ok: null,
};

// Placa roja de los productos que detalló el analista: en el círculo, lo
// sugerido para comprar; abajo, stock, ritmo y cobertura de cada sucursal; en
// rojo, el estado; a la derecha, el costo.
export function placaDelAnalista(productos: ProductoVisto[], todos: ProductoVisto[]): DetallePlaca {
  const dec = (n: unknown) => Number(n ?? 0).toLocaleString('es-AR', { maximumFractionDigits: 1 });
  const renglones = productos.map((p) => {
    const filas = todos.filter((v) => v.sku === p.sku).map((v) => v.fila as unknown as FilaAnalisis);
    const varias = new Set(filas.map((f) => f.sucursal)).size > 1;
    const sugerido = filas.reduce((s, f) => s + (Number(f.sugerido) || 0), 0);
    const detalle = filas
      .map((f) => `${varias ? `${nombreSucursal(f.sucursal)}: ` : ''}${dec(f.stock)} en stock · vende ${dec(f.ventasDia30)} por día${f.diasDeStock != null ? ` · alcanza ${dec(f.diasDeStock)} días` : ''}`)
      .join(' — ');
    const estados = [...new Set(filas.map((f) => ESTADO_LEGIBLE[f.estado]).filter(Boolean))];
    return {
      clave: p.sku,
      cantidad: sugerido > 0 ? sugerido : null,
      nombre: p.nombre,
      detalle,
      destacado: estados.length ? estados.join(' · ') : undefined,
      importe: pesosPlaca(filas.find((f) => f.costo != null)?.costo),
    };
  });
  return {
    titulo: 'PRODUCTOS',
    sub: `${renglones.length} productos`,
    renglones,
    pie: 'En el círculo, lo sugerido para comprar. A la derecha, el costo por unidad.',
  };
}

@Injectable()
export class AnalistaService {
  constructor(@Inject(SUPABASE) private readonly db: SupabaseClient) {}

  // 2/10/2026: los renglones salen del motor de abastecimiento (la misma fuente
  // que "Qué comprar" y el agente de compras), con la forma de siempre para el
  // informe de las 7, Promociones y Estadísticas. Antes el ritmo salía solo de
  // las ventas de la caja de ODB de 30 días (casi vacías) y todo daba "sin
  // rotación": el Analista decía "no hay nada que comprar".
  async metricas(): Promise<FilaAnalisis[]> {
    const [filas, costos] = await Promise.all([leerAbastecimiento(this.db), leerCostos(this.db)]);
    // precios para el margen (Promociones filtra por margen >= 25%): solo los
    // productos que aparecen, de a 500 ids (la URL del RPC tiene límite)
    const ids = [...new Set(filas.map((f) => f.producto_id).filter(Boolean))];
    const precioPor = new Map<string, any>();
    const tandas: string[][] = [];
    for (let i = 0; i < ids.length; i += 500) tandas.push(ids.slice(i, i + 500));
    const respuestas = await Promise.all(tandas.map((t) => this.db.rpc('catalogo_precios', { p_ids: t })));
    for (const { data } of respuestas) for (const r of (data ?? []) as any[]) precioPor.set(r.producto_id, r);

    const salida = filas.map((f) => this.aFila(f, costos, precioPor));
    const orden = { quiebre_inminente: 0, reponer: 1, sobrestock: 2, muerto: 3, ok: 4 };
    const capital = (x: FilaAnalisis) => x.stock * Number(x.costo ?? 0);
    salida.sort((a, b) =>
      orden[a.estado] - orden[b.estado]
      || (a.estado === 'quiebre_inminente' || a.estado === 'reponer' ? (b.urgencia ?? 0) - (a.urgencia ?? 0) : capital(b) - capital(a)));
    return salida;
  }

  // Un renglón del motor como FilaAnalisis (la forma que leen el informe,
  // Promociones, Estadísticas y la placa del Analista).
  private aFila(f: any, costos: Map<string, number>, precioPor?: Map<string, any>): FilaAnalisis {
    const r2 = (v: any) => Math.round(Number(v ?? 0) * 100) / 100;
    const costoCatalogo = costos.get(f.producto_id) ?? null;
    const pr = precioPor?.get(f.producto_id);
    return {
      sku: f.sku,
      producto: f.nombre,
      sucursal: f.sucursal, // crudo ("Suc Sant Thomas"): hay consumidores que comparan por nombre
      sucursalId: f.sucursal_id,
      stock: r2(f.stock),
      enTransito: Math.round(Number(f.en_camino ?? 0)),
      ventasDia7: 0, // el motor no lo trae y nadie lo usa
      ventasDia30: r2(f.ritmo_dia),
      diasDeStock: f.cobertura_dias == null ? null : Number(f.cobertura_dias),
      proveedor: f.proveedor ?? null,
      proveedorId: f.proveedor_id ?? null,
      leadTimeDias: f.plazo_dias == null ? null : Number(f.plazo_dias),
      costo: costoDe(f, costos),
      margenPct: pr && costoCatalogo
        ? Math.round(((Number(pr.precio_final) - costoCatalogo) / costoCatalogo) * 1000) / 10
        : null,
      estado: estadoDe(f),
      sugerido: cantidadPedible(f.cantidad_sugerida),
      productoId: f.producto_id,
      alerta: f.alerta ?? null,
      urgencia: Number(f.urgencia ?? 0),
      ritmoHasta: f.ritmo_hasta ?? null,
      plazoFuente: f.plazo_fuente ?? null,
      proveedorFaltan: Array.isArray(f.proveedor_faltan) ? f.proveedor_faltan : [],
    };
  }

  // Lo que hay que comprar y lo que está parado, por proveedor (abastecimiento/
  // tablero.ts). Lo usan la charla y el informe de las 7.
  async tablero(): Promise<Tablero> {
    const [filas, costos] = await Promise.all([leerAbastecimiento(this.db), leerCostos(this.db)]);
    return armarTablero(filas, costos);
  }

  async charlar(mensajes: MensajeChat[]) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new BadRequestException('Falta la ANTHROPIC_API_KEY en apps/api/.env');
    }
    if (!mensajes?.length || mensajes[mensajes.length - 1].rol !== 'usuario') {
      throw new BadRequestException('El último mensaje debe ser del usuario');
    }

    const [tablero, aumentos, filas, costos] = await Promise.all([
      this.tablero(), this.aumentosRecientes(), leerAbastecimiento(this.db), leerCostos(this.db),
    ]);
    const { datos, compras, parado } = tablero;
    const hayVentas = filas.some((f) => Number(f.ritmo_dia) > 0);
    const plata = (v: number) => `$${Math.round(v).toLocaleString('es-AR')}`;
    const fecha = (v: string | null) => (v ? new Date(`${v}T12:00:00`).toLocaleDateString('es-AR') : '—');

    // ---- la foto del día, armada por código (unas 100 líneas: nada de miles de filas)
    // Cada proveedor va con una clave corta (P01, P02…) y el modelo responde con
    // la clave: hay razones sociales repetidas (dos "CLAUDIO RAMA") y el modelo
    // las acorta ("Luvik" por "Luvik Mayorista"). Revisión del 2/10/2026.
    const claves = new Map<string, { id: string | null; nombre: string }>();
    const claveDe = new Map<string, string>();
    const asignar = (id: string, nombre: string) => {
      if (claveDe.has(id)) return claveDe.get(id)!;
      const k = `P${String(claves.size + 1).padStart(2, '0')}`;
      claves.set(k, { id, nombre });
      claveDe.set(id, k);
      return k;
    };
    for (const p of compras.proveedores) asignar(p.proveedorId, p.proveedor);
    for (const p of parado.proveedores) if (p.proveedorId) asignar(p.proveedorId, p.proveedor);
    claves.set('SIN_PROVEEDOR', { id: null, nombre: 'Sin proveedor habitual' });

    const lineas: string[] = [];
    lineas.push(`DATOS: ritmo de venta: ${datos.ritmoFuente}; ventas hasta ${fecha(datos.ventasHasta)}${datos.datoViejo ? ' (DATO VIEJO: cantidades orientativas)' : ''}${hayVentas ? '' : ' — NO HAY VENTAS CARGADAS'}; plazo de entrega provisorio (7 días por defecto) en ${datos.plazosProvisorios.provisorios} de ${datos.plazosProvisorios.total} proveedores.`);
    lineas.push(`COMPRAS SUGERIDAS (estimadas al último costo): total ${plata(compras.total)}, urgente ${plata(compras.totalUrgente)}, ${compras.proveedores.length} proveedores.`);
    for (const p of compras.proveedores) {
      const top = (p.top3 ?? []).map((t) => `${t.nombre} (${t.sucursal}${t.alerta ? `, ${t.alerta}` : ''}, sugerido ${t.sugerido})`).join('; ');
      lineas.push(`- [${claveDe.get(p.proveedorId)}] ${p.proveedor}: ${p.productos} productos (${p.urgentes} urgentes) · ${plata(p.plata)} (${plata(p.plataUrgente)} urgente) · ${p.porSucursal.map((x) => `${x.sucursal} ${plata(x.plata)}`).join(', ') || 'sin costos'} · plazo ${p.plazoDias} días${p.plazoProvisorio ? ' (provisorio)' : ''}${p.aRevisar ? ` · ${p.aRevisar} costos a revisar` : ''}${p.faltan.length ? ` · le falta: ${p.faltan.join(', ')}` : ''}${top ? ` · más urgentes: ${top}` : ''}`);
    }
    lineas.push(`- [SIN_PROVEEDOR] Sin proveedor habitual: ${compras.sinProveedor.productos} productos para reponer (${compras.sinProveedor.urgentes} urgentes), sin costo: no suman a la plata.`);
    lineas.push(`PLATA PARADA: no se vende ${plata(parado.totalQuieto)}, sobra (más de 90 días de stock) ${plata(parado.totalSobra)}; ${parado.sinValorizar} productos parados sin costo (no se pueden valorizar).`);
    for (const p of parado.proveedores.slice(0, 8)) {
      lineas.push(`- [${p.proveedorId ? claveDe.get(p.proveedorId) : 'SIN_PROVEEDOR'}] ${p.proveedor}: ${p.quietos} sin ventas (${plata(p.plataQuieta)}), ${p.sobran} sobran (${plata(p.plataSobra)})${p.masCaro ? ` · el más caro: ${p.masCaro.nombre} ${plata(p.masCaro.plata)}` : ''}`);
    }
    // detalle: los urgentes con proveedor y los sin proveedor que más venden,
    // por si el comprador pregunta por un producto
    const detalle = [
      ...filas.filter((f) => f.proveedor_id && (f.alerta === 'sin_stock' || f.alerta === 'no_llega')).sort((a, b) => Number(b.urgencia ?? 0) - Number(a.urgencia ?? 0)).slice(0, 20),
      ...filas.filter((f) => !f.proveedor_id && f.alerta && cantidadPedible(f.cantidad_sugerida) > 0).sort((a, b) => Number(b.ritmo_dia ?? 0) - Number(a.ritmo_dia ?? 0)).slice(0, 8),
      // lo parado de más plata de los primeros proveedores de PLATA PARADA
      ...parado.proveedores.slice(0, 6).flatMap((p) => {
        const valor = (f: any) => Number(f.stock ?? 0) * Number(costoDe(f, costos) ?? 0);
        return filas
          .filter((f) => (f.proveedor_id ?? null) === p.proveedorId && ['muerto', 'sobrestock'].includes(estadoDe(f)))
          .sort((a, b) => valor(b) - valor(a))
          .slice(0, 3);
      }),
    ];
    const nuevos = filas.filter((f) => Number(f.stock) > 0 && Number(f.ritmo_dia) === 0 && sinVentasMedidas(f)).length;
    if (nuevos) lineas.push(`(${nuevos} productos con stock entraron después del último reporte de ventas: no se sabe todavía si se venden; NO están en plata parada y no se recomienda liquidarlos)`);
    lineas.push('DETALLE (los más urgentes):');
    for (const f of detalle) {
      const costo = costoDe(f, costos);
      lineas.push(`${f.sku} · ${f.nombre} · ${nombreSucursal(f.sucursal)} · stock ${Number(f.stock)} · vende ${Number(f.ritmo_dia)}/día · alcanza ${f.cobertura_dias ?? '—'} días · ${f.proveedor ?? 'sin proveedor'} · ${f.alerta ?? estadoDe(f)} · sugerido ${cantidadPedible(f.cantidad_sugerida)}${costo ? ` · costo ${plata(costo)}` : ''}`);
    }

    const claude = new Anthropic();
    const pedido: any = {
      // Opus 5.5 desde el 6/10/2026 (comun/modelos.ts): era Opus 4.8, 20 % más caro por token
      model: MODELO_PRINCIPAL,
      max_tokens: 16000,
      thinking: RAZONAMIENTO,
      // lo fijo va primero y con caché; la foto del día cambia en cada consulta
      system: [
        { type: 'text', text: PERSONALIDAD, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: `Foto del día (${new Date().toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}):\n${lineas.join('\n')}\n\nAumentos de costo en los últimos 45 días:\n${aumentos}` },
      ],
      // esfuerzo medio: piensa lo necesario sin comerse el lugar del JSON
      // (ANALISTA_ESFUERZO lo cambia sin tocar código, 6/10/2026)
      output_config: { effort: esfuerzo('ANALISTA_ESFUERZO'), format: { type: 'json_schema', schema: esquemaConClaves([...claves.keys()]) as any } },
      // Anthropic rechaza un turno vacío (un veredicto que quedó en blanco)
      messages: mensajes.slice(-10).map((m) => ({
        role: m.rol === 'usuario' ? ('user' as const) : ('assistant' as const),
        content: String(m.texto ?? '').trim() || '(sin texto)',
      })),
    };
    let respuesta: any;
    try {
      respuesta = await claude.messages.create(pedido);
    } catch (e: any) {
      // 6/10/2026: el reintento SIN razonamiento se sacó. Iba contra la regla del
      // 9/9 (razonamiento siempre encendido) y en Opus 5.5 apagarlo es otro 400.
      // Un 400 acá es un error del pedido: el dueño no se queda sin nada, las
      // cifras del día salen igual con el veredicto de respaldo de abajo.
      if (e?.status !== 400) throw e;
      console.warn(`Analista ODB: la API rechazó el pedido (${e?.message ?? e}); salen las cifras con el veredicto de respaldo`);
      respuesta = { stop_reason: 'error', content: [] };
    }

    const bloque = respuesta.content.find((b) => b.type === 'text');
    let salida: any = {};
    let leido = false;
    if (respuesta.stop_reason !== 'max_tokens' && respuesta.stop_reason !== 'refusal') {
      try { salida = JSON.parse(bloque && 'text' in bloque ? bloque.text : ''); leido = true; } catch { salida = {}; }
    }
    // si el modelo se cortó o no devolvió el JSON, las cifras igual se muestran
    // con un veredicto de respaldo (antes quedaba una burbuja vacía)
    let veredicto = leido ? String(salida.respuesta ?? '').trim() : '';
    if (!leido) console.warn(`Analista ODB: respuesta sin leer (stop_reason ${respuesta.stop_reason})`);
    if (!veredicto) veredicto = 'No llegué a escribir el análisis esta vez. Abajo están las cifras del día por proveedor; si querés, preguntame de nuevo.';
    // sin ventas no se puede decir que no hay nada que comprar: faltan datos
    if (!hayVentas) {
      veredicto = `No tengo ventas cargadas para calcular el ritmo: falta el reporte de ventas del sistema viejo. ${veredicto.replace(/[^.]*nada que comprar[^.]*\.?/gi, '').trim()}`.trim();
    }
    const mostrar = [...new Set((Array.isArray(salida.mostrar) ? salida.mostrar : []).filter((m: any) => ['compras', 'notas', 'parado'].includes(m)))];
    if (!mostrar.length) mostrar.push('compras', 'notas');

    // cada proveedor que nombró el modelo, resuelto contra el tablero (por
    // nombre normalizado: "Luvik" = "LUVIK S.A."); lo que no existe se descarta
    const candidatos = [
      ...compras.proveedores.map((p) => ({ id: p.proveedorId as string | null, nombre: p.proveedor })),
      ...parado.proveedores.filter((p) => p.proveedorId).map((p) => ({ id: p.proveedorId, nombre: p.proveedor })),
    ];
    const resolver = (nombre: string): { id: string | null; nombre: string } | null => {
      const porClave = claves.get(String(nombre ?? '').trim().toUpperCase());
      if (porClave) return porClave;
      const k = normalizarTexto(nombre);
      if (!k) return null;
      if (k.includes('sin proveedor')) return { id: null, nombre: 'Sin proveedor habitual' };
      return candidatos.find((c) => normalizarTexto(c.nombre) === k)
        ?? candidatos.find((c) => normalizarTexto(c.nombre).includes(k) || k.includes(normalizarTexto(c.nombre)))
        ?? null;
    };
    const vistosIds = new Set<string>();
    const comentarios = (Array.isArray(salida.proveedores) ? salida.proveedores : [])
      .map((c: any) => {
        const r = resolver(String(c?.proveedor ?? ''));
        if (!r || !ACCIONES.includes(c?.accion)) return null;
        const clave = `${r.id ?? 'sin'}:${c.accion}`;
        if (vistosIds.has(clave)) return null;
        vistosIds.add(clave);
        return { proveedorId: r.id, proveedor: r.nombre, accion: c.accion, comentario: String(c?.comentario ?? '').trim().slice(0, 200) };
      })
      .filter(Boolean)
      .slice(0, 8) as { proveedorId: string | null; proveedor: string; accion: string; comentario: string }[];

    // las notas de pedido arrancan en la sucursal con más plata a comprar y con
    // los proveedores que el modelo marcó para comprar (si no marcó, los 3 más urgentes)
    const porSucursal = new Map<string, number>();
    for (const p of compras.proveedores) for (const x of p.porSucursal) porSucursal.set(x.sucursal, (porSucursal.get(x.sucursal) ?? 0) + x.plata);
    const sucursalNotas = [...porSucursal.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    const marcados = comentarios.filter((c) => c.accion === 'comprar' && c.proveedorId).map((c) => c.proveedorId as string);
    const notas = compras.proveedores.length
      ? {
          sucursal: (sucursalNotas === 'Santa Inés' ? 'Santa Inés' : 'Saint Thomas') as 'Saint Thomas' | 'Santa Inés',
          proveedorIds: marcados.length ? marcados : [...compras.proveedores].sort((a, b) => b.plataUrgente - a.plataUrgente).slice(0, 3).map((p) => p.proveedorId),
        }
      : null;

    // si el texto igual nombra productos del detalle, van como Placa roja
    const vistos: ProductoVisto[] = detalle.map((f) => ({ sku: f.sku, nombre: f.nombre, fila: this.aFila(f, costos) as any }));
    const { respuesta: texto, detalle: placa } = separarDetalle(veredicto, vistos, (ps) => placaDelAnalista(ps, vistos));

    return {
      respuesta: texto,
      detalle: placa,
      mostrar,
      tablero: {
        datos,
        // top3 es solo para el modelo
        compras: { ...compras, proveedores: compras.proveedores.map(({ top3, ...p }) => p) },
        parado,
      },
      comentarios,
      notas,
    };
  }

  // Propone boxes/armados combinando bebidas y fiambrería, con contexto comercial
  async armados(contexto?: string) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new BadRequestException('Falta la ANTHROPIC_API_KEY en apps/api/.env');
    }
    const { data: prods } = await this.db
      .from('productos')
      .select('id, sku, nombre, costo, categoria:categorias!inner(nombre), stock(cantidad)')
      .eq('activo', true);
    const conStock = (prods ?? []).filter(
      (p: any) => (p.stock ?? []).reduce((s: number, r: any) => s + Number(r.cantidad), 0) > 0,
    );
    const { data: precios } = await this.db.rpc('catalogo_precios', {
      p_ids: conStock.map((p: any) => p.id),
    });
    const precioPor = new Map<string, number>((precios ?? []).map((r: any) => [r.producto_id, Number(r.precio_final)]));

    const catalogo = conStock
      .map((p: any) => `${p.sku} · ${p.nombre} · ${p.categoria.nombre} · $${Math.round(precioPor.get(p.id) ?? 0)}`)
      .join('\n');

    const hoy = new Date().toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' });
    const esquema = {
      type: 'object',
      properties: {
        armados: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              nombre: { type: 'string', description: 'Nombre marketinero del box' },
              ocasion: { type: 'string', description: 'Para qué momento/fecha se vende' },
              descripcion: { type: 'string', description: 'Una o dos líneas vendedoras, texto plano' },
              items: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: { sku: { type: 'string' }, cantidad: { type: 'number' } },
                  required: ['sku', 'cantidad'],
                  additionalProperties: false,
                },
              },
              precioSugerido: { type: 'number', description: 'Precio del box (menor a la suma de los componentes)' },
            },
            required: ['nombre', 'ocasion', 'descripcion', 'items', 'precioSugerido'],
            additionalProperties: false,
          },
        },
      },
      required: ['armados'],
      additionalProperties: false,
    };

    const claude = new Anthropic();
    const respuesta = await claude.messages.create({
      // Opus 5.5 desde el 6/10/2026 (comun/modelos.ts). Iba sin razonamiento (en
      // 4.8, omitirlo lo apaga: contra la regla del 9/9) y con 4000 de tope; en 5.5
      // el razonamiento sale del mismo presupuesto y se corta: 16000.
      model: MODELO_PRINCIPAL,
      max_tokens: 16000,
      thinking: RAZONAMIENTO,
      system: [
        {
          type: 'text',
          text: `Sos el armador de combos de O.D.B Premium Market (outlet de bebidas con fiambrería, Argentina). Hoy es ${hoy} — tené en cuenta el calendario comercial argentino (Día del Padre tercer domingo de junio, invierno, mundial si aplica, fiestas, etc.).

Armá 3 o 4 boxes vendibles combinando SOLO productos del catálogo de abajo (SKU exactos). Reglas:
- Mezclá categorías con criterio (vino tinto + fiambres y quesos = picada; espumante + dulce; cerveza + snacks; whisky solo premium).
- Precio sugerido del box: entre 10 % y 15 % menos que la suma de los componentes (el ahorro tiene que ser real pero rentable).
- Nombres cortos y argentinos, sin cursilería ni familiaridad. Descripción de texto plano, sin emojis ni exclamaciones.
- Apuntá a tickets distintos: uno económico, uno medio, uno premium.`,
          cache_control: { type: 'ephemeral' },
        },
        { type: 'text', text: `Catálogo con stock:\n${catalogo}` },
      ],
      output_config: { effort: esfuerzo('ANALISTA_ESFUERZO'), format: { type: 'json_schema', schema: esquema as any } },
      messages: [
        {
          role: 'user',
          content: contexto?.trim()
            ? `Armá boxes para este contexto: ${contexto.trim()}`
            : 'Armá los boxes de esta semana.',
        },
      ],
    });

    // un rechazo o un corte por el tope dan un error claro, no un JSON.parse roto (6/10/2026)
    const datos = jsonDe<any>(respuesta, 'El armador de combos');

    // Recalculo los números reales (la IA propone, los precios los valida el sistema)
    const skuPor = new Map(conStock.map((p: any) => [p.sku, p]));
    const armados = (datos.armados ?? [])
      .map((a: any) => {
        const detalle = (a.items ?? [])
          .map((i: any) => {
            const p = skuPor.get(i.sku);
            if (!p) return null;
            return {
              sku: i.sku,
              nombre: p.nombre,
              cantidad: Number(i.cantidad),
              precioUnitario: Math.round(precioPor.get(p.id) ?? 0),
              costoUnitario: Number(p.costo ?? 0),
            };
          })
          .filter(Boolean);
        if (!detalle.length) return null;
        const sumaLista = detalle.reduce((s: number, i: any) => s + i.precioUnitario * i.cantidad, 0);
        const costoTotal = detalle.reduce((s: number, i: any) => s + i.costoUnitario * i.cantidad, 0);
        // el precio del box queda acotado a la banda 85-92% de la suma
        const precio = Math.round(
          Math.min(Math.max(Number(a.precioSugerido), sumaLista * 0.85), sumaLista * 0.92) / 10,
        ) * 10;
        return {
          nombre: a.nombre,
          ocasion: a.ocasion,
          descripcion: a.descripcion,
          items: detalle,
          sumaLista: Math.round(sumaLista),
          precioBox: precio,
          ahorro: Math.round(sumaLista - precio),
          margenPct: costoTotal > 0 ? Math.round(((precio - costoTotal) / costoTotal) * 100) : null,
        };
      })
      .filter(Boolean);

    return { armados };
  }

  // Solo los AUMENTOS reales de los últimos 45 días: costo mayor al registro
  // anterior del mismo producto y proveedor, ordenados por porcentaje (hasta 15).
  // Revisión del 2/10/2026: cargar una lista de precios registra una fila por
  // producto aunque el costo no cambie, y todas viajaban como "costo nuevo".
  private async aumentosRecientes(): Promise<string> {
    const hace45 = new Date(Date.now() - 45 * 86400_000).toISOString();
    const hace120 = new Date(Date.now() - 120 * 86400_000).toISOString();
    // PostgREST corta en 1.000 filas: de a páginas y con orden estable (revisión
    // del 2/10: con .limit llegaban las 1.000 más viejas y ningún aumento reciente)
    const data = await traerTodo<any>((desde, hasta) =>
      this.db
        .from('costos_historial')
        .select('id, costo, creado_en, producto_id, proveedor_id, producto:productos(sku, nombre), proveedor:proveedores(razon_social)')
        .gte('creado_en', hace120)
        .order('creado_en', { ascending: true })
        .order('id', { ascending: true })
        .range(desde, hasta) as any);
    if (!data.length) return '(sin cambios de costo registrados)';

    const previo = new Map<string, number>();
    const aumentos: { pct: number; linea: string }[] = [];
    for (const r of data as any[]) {
      const clave = `${r.producto_id}|${r.proveedor_id ?? ''}`;
      const costo = Number(r.costo);
      const antes = previo.get(clave);
      previo.set(clave, costo);
      if (antes == null || !(antes > 0) || !(costo > antes) || r.creado_en < hace45) continue;
      const pct = Math.round(((costo - antes) / antes) * 1000) / 10;
      aumentos.push({
        pct,
        linea: `${r.producto?.sku ?? '?'} ${r.producto?.nombre ?? ''}: +${pct}% ($${Math.round(antes)} → $${Math.round(costo)}, ${String(r.creado_en).slice(0, 10)}, ${r.proveedor?.razon_social ?? '?'})`,
      });
    }
    if (!aumentos.length) return '(sin aumentos de costo en los últimos 45 días)';
    return aumentos.sort((a, b) => b.pct - a.pct).slice(0, 15).map((a) => a.linea).join('\n');
  }
}
