import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import * as XLSX from 'xlsx';
import { SUPABASE } from '../supabase.provider';
import { calcularCosto, compararOfertas, impactoEnPrecio, type OfertaCompra } from './costeo';
import { margenAplicable } from './precio';
import { TONO_ODB } from '../comun/tono-odb';

export type MensajeMesa = {
  rol: 'usuario' | 'asistente';
  texto: string;
  // adjunto: foto de la lista, PDF del proveedor, o la planilla (Excel/CSV)
  imagenBase64?: string;
  mimeType?: string;
  nombreArchivo?: string;
};

const IMAGENES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

// Una planilla del proveedor se convierte a texto tabulado: el modelo la lee
// como una tabla y trabaja sobre las columnas que el comprador le indique.
// Se recorta para no reventar el contexto con listas de miles de renglones.
type PlanillaCargada = { nombre: string; hojas: { hoja: string; filas: any[][] }[] };

// Deja la planilla parseada a mano para que el CÓDIGO la recorra. El modelo no
// tiene que reescribir 400 renglones como JSON — eso era lento por diseño y
// terminaba en "el analista tardó más de lo permitido".
function planillaCargar(base64: string, nombre = 'planilla'): PlanillaCargada {
  const libro = XLSX.read(Buffer.from(base64, 'base64'), { type: 'buffer' });
  const hojas = libro.SheetNames.map((hoja) => ({
    hoja,
    filas: XLSX.utils.sheet_to_json(libro.Sheets[hoja], { header: 1, blankrows: false, defval: '' }) as any[][],
  })).filter((h) => h.filas.length);
  return { nombre, hojas };
}

function planillaATexto(base64: string, nombre = 'planilla'): string {
  const libro = XLSX.read(Buffer.from(base64, 'base64'), { type: 'buffer' });
  const partes: string[] = [];
  let filasTotales = 0;
  // muestra: alcanza para que entienda las columnas y las líneas de producto.
  // El costeo de TODAS las filas lo hace costear_planilla, en código.
  const TOPE_FILAS = 60;
  for (const hoja of libro.SheetNames) {
    const filas: any[][] = XLSX.utils.sheet_to_json(libro.Sheets[hoja], { header: 1, blankrows: false, defval: '' });
    if (!filas.length) continue;
    filasTotales += filas.length;
    const recorte = filas.slice(0, TOPE_FILAS);
    partes.push(
      `## Hoja "${hoja}" (${filas.length} filas${filas.length > TOPE_FILAS ? `, se muestran ${TOPE_FILAS}` : ''})\n` +
        recorte.map((f) => f.map((c) => String(c ?? '').trim()).join(' | ')).join('\n'),
    );
  }
  if (!partes.length) return `[La planilla "${nombre}" no tiene datos legibles]`;
  return (
    `[Planilla "${nombre}" · ${filasTotales} filas en total. Abajo va una MUESTRA para que reconozcas las columnas y las líneas de producto.\n` +
    `Para costearla NO copies los renglones: usá costear_planilla diciendo qué columna es la descripción, cuál el precio, y las reglas de descuento por línea. ` +
    `El sistema recorre las ${filasTotales} filas solo.]\n` +
    partes.join('\n\n')
  );
}

const SYSTEM = `Sos el analista de compras de O.D.B Premium Market, un outlet de bebidas y almacén en Canning. Trabajás con el comprador de la casa mientras negocia con proveedores.

Tu trabajo es sacar el COSTO REAL de cada compra y proponer el precio de venta que corresponde. El precio de lista de un proveedor casi nunca es el costo real: entre medio hay descuentos en cascada, bonificaciones, flete, impuestos internos y el costo del plazo de pago.

## Reglas que no se rompen

1. NUNCA hagas una cuenta vos. Ni una multiplicación, ni un porcentaje, ni una suma. Para todo número usás calcular_costo, calcular_costos_en_tanda o comparar_ofertas. El número que informás es el que devuelve la herramienta, tal cual.
2. Antes de calcular, asegurate de tener los datos. Si falta algo que cambia el resultado (cuántas unidades trae el bulto, si hay flete, si el precio es con o sin IVA, a cuántos días se paga), preguntalo. Una sola pregunta por mensaje, la más importante.
3. Si el comprador te da un precio CON IVA, pedile el neto o aclarale que vas a trabajar sobre el neto: el IVA no es costo, se recupera.
4. Las percepciones tampoco son costo (son pagos a cuenta). Los impuestos internos SÍ.
5. No inventes productos. Para vincular un costo a un producto de la casa, buscalo con buscar_producto y usá el sku que te devuelve.

## Cómo trabajás

Cuando el comprador te describe una oferta (por texto, dictada, en una foto o PDF de la lista, o en una planilla Excel/CSV):
- Si viene una planilla, primero identificá qué columna es el producto, cuál el precio y cuál la unidad. Si el comprador dice "tomá la columna X y sumale 29%", eso es un ajuste de precio de lista (por ejemplo, un aumento del proveedor): pasale a la herramienta el precio de la columna tal cual y el porcentaje en ajusteListaPct (29). NUNCA multipliques vos el 1,29: la herramienta lo hace y te devuelve el precio ajustado en el detalle.
- IMPORTANTE con planillas: cuando el comprador quiere costear VARIOS renglones (por ejemplo "aplicá el 29% a toda la columna Base unit", o los 10/20/50 que te pida), NO llames calcular_costo una vez por renglón. Armá UNA sola llamada a calcular_costos_en_tanda con el array de todos los renglones. Una planilla de 50 productos es UNA llamada, no 50: así no se hace eterno. Usá calcular_costo (en singular) solo cuando es un producto suelto.
- Con una planilla de muchísimos renglones (cientos o miles), no cuestes todo de una: proponé arrancar por los que más interesan (mayor volumen/stock) o pedile al comprador que te diga cuántos y cuáles, y después esos van juntos en calcular_costos_en_tanda.
- Extraé los datos: presentación, precio, descuentos, bonificación, flete, plazo.
- Calculá con la herramienta.
- Mostrá el costo real por unidad y el paso a paso, en criollo. El comprador tiene que poder explicárselo al dueño.
- Si hay más de una oferta del mismo producto, comparalas: es donde más plata se gana, porque a ojo no se comparan.
- Después mostrá qué pasa con el precio de venta: usá impacto_en_precio. Si el precio vigente queda por debajo del costo nuevo, avisalo fuerte y primero.

Cuando los números están cerrados y el comprador quiere aplicarlos, usá crear_propuesta. Eso NO cambia nada todavía: deja la propuesta esperando la aprobación del dueño. Decíselo con esas palabras, para que nadie crea que ya está aplicado.

## Cómo hablás

Directo y claro, sin vueltas. Tratá de usted al comprador. Números redondos en pesos. Nada de markdown pesado: renglones simples. Si algo te huele mal en la oferta (un descuento que no cierra, un flete alto para el volumen, un plazo que no compensa), decilo: para eso estás.

${TONO_ODB}`;

const HERRAMIENTAS: Anthropic.Tool[] = [
  {
    name: 'calcular_costo',
    description:
      'Calcula el costo real por unidad de UNA oferta, con descuentos en cascada, bonificación, flete prorrateado, impuestos internos y el valor del plazo de pago. Devuelve también el paso a paso.',
    input_schema: {
      type: 'object',
      properties: {
        descripcion: { type: 'string', description: 'Nombre de la oferta, ej: "Cepas · Malbec caja x6"' },
        unidadesPorBulto: { type: 'number', description: 'Unidades que trae cada bulto o caja. 1 si se compra suelto.' },
        bultos: { type: 'number', description: 'Cuántos bultos se compran.' },
        precioBulto: { type: 'number', description: 'Precio de lista de UN bulto, SIN IVA.' },
        ajusteListaPct: { type: 'number', description: 'Ajuste sobre la lista antes de descuentos. Si el proveedor "sube 29%" o el comprador dice "sumale 29%", va 29. Si baja, negativo.' },
        descuentosPct: { type: 'array', items: { type: 'number' }, description: 'Descuentos en cascada, en orden. Ej: [10, 5].' },
        bonificacionPaga: { type: 'number', description: 'En "compra 10 lleva 12", va 10.' },
        bonificacionGratis: { type: 'number', description: 'En "compra 10 lleva 12", va 2.' },
        flete: { type: 'number', description: 'Flete TOTAL de la compra, no por bulto.' },
        impuestosInternosPct: { type: 'number' },
        impuestosInternosPorUnidad: { type: 'number' },
        plazoDias: { type: 'number', description: 'Días de plazo de pago. 0 = contado.' },
        tasaMensualPct: { type: 'number', description: 'Tasa mensual para valuar el plazo. Si el comprador no la dice, usá 5.' },
      },
      required: ['unidadesPorBulto', 'bultos', 'precioBulto'],
    },
  },
  {
    name: 'calcular_costos_en_tanda',
    description:
      'Calcula el costo real por unidad de VARIAS ofertas de una sola vez y devuelve el resultado de cada una en el mismo orden. Es la herramienta para planillas: si el comprador quiere costear muchos renglones (toda una columna, o los N que pida), mandá TODOS juntos acá en una sola llamada en vez de llamar calcular_costo renglón por renglón. Cada renglón lleva los mismos campos que calcular_costo.',
    input_schema: {
      type: 'object',
      properties: {
        ofertas: {
          type: 'array',
          description: 'Un renglón por producto a costear. Cada uno con los mismos campos que calcular_costo (descripcion, unidadesPorBulto, bultos, precioBulto, ajusteListaPct, descuentosPct, flete, plazoDias, etc.).',
          items: { type: 'object' },
        },
      },
      required: ['ofertas'],
    },
  },
  {
    name: 'costear_planilla',
    description:
      'Costea TODOS los renglones de la planilla que adjuntó el comprador, de una sola vez. Es LA herramienta para planillas: vos NO copiás los renglones, solo decís qué columna es cuál y qué reglas de descuento aplican por línea de producto; el sistema recorre todas las filas y devuelve el resumen. Usala siempre que haya una planilla adjunta, aunque tenga cientos de filas.',
    input_schema: {
      type: 'object',
      properties: {
        columnaDescripcion: { type: 'string', description: 'Nombre o letra de la columna con el nombre del producto (ej: "Descripcion", "B"). Si no sabés, poné el título tal como aparece en la planilla.' },
        columnaPrecio: { type: 'string', description: 'Nombre o letra de la columna con el precio a usar como base (ej: "base unitario", "C").' },
        columnaUnidades: { type: 'string', description: 'Columna con las unidades por bulto, si existe. Vacío si la planilla es por unidad.' },
        hoja: { type: 'string', description: 'Nombre de la hoja. Vacío = la primera.' },
        filaEncabezado: { type: 'number', description: 'Número de fila (1 = la primera) donde están los títulos de las columnas. Si no lo decís, se busca solo.' },
        reglas: {
          type: 'array',
          description: 'Descuentos por línea de producto. Cada regla se aplica a los renglones cuya descripción contenga alguno de los textos de "lineas". Se evalúan en orden: la primera que coincide manda.',
          items: {
            type: 'object',
            properties: {
              lineas: { type: 'array', items: { type: 'string' }, description: 'Textos que identifican la línea (ej: ["portillo","killka","salentein reserve","espumante"]).' },
              excluye: { type: 'array', items: { type: 'string' }, description: 'Textos que EXCLUYEN un renglón de esta regla (ej: ["cofermentado"]).' },
              descuentosPct: { type: 'array', items: { type: 'number' }, description: 'Descuentos en cascada para esa línea (ej: [45]).' },
            },
            required: ['lineas', 'descuentosPct'],
          },
        },
        descuentoPorDefectoPct: { type: 'array', items: { type: 'number' }, description: 'Descuentos para los renglones que no caen en ninguna regla (ej: [50]).' },
        ajusteListaPct: { type: 'number', description: 'Aumento o baja de lista ANTES de los descuentos (+29 = subió 29%). 0 si no hay.' },
        impuestosPct: { type: 'number', description: 'Impuestos que se SUMAN al final, sobre el neto (ej: 29).' },
        plazoDias: { type: 'number', description: 'Plazo de pago en días. 0 = contado.' },
        tasaMensualPct: { type: 'number', description: 'Tasa mensual para valuar el plazo. 5 si el comprador no la dice.' },
        flete: { type: 'number', description: 'Flete TOTAL de la compra, si lo hay.' },
      },
      required: ['columnaPrecio', 'reglas'],
    },
  },
  {
    name: 'comparar_ofertas',
    description:
      'Compara varias ofertas del MISMO producto y dice cuál conviene de verdad. Usala siempre que haya más de un proveedor o más de una modalidad (contado vs plazo, con o sin bonificación).',
    input_schema: {
      type: 'object',
      properties: {
        ofertas: {
          type: 'array',
          description: 'Cada oferta con los mismos campos que calcular_costo.',
          items: { type: 'object' },
        },
      },
      required: ['ofertas'],
    },
  },
  {
    name: 'buscar_producto',
    description: 'Busca un producto de la casa por nombre o código, con su costo actual y su precio vigente. Usalo para vincular la oferta a un producto real antes de proponer nada.',
    input_schema: {
      type: 'object',
      properties: { q: { type: 'string' } },
      required: ['q'],
    },
  },
  {
    name: 'impacto_en_precio',
    description: 'Dado un costo nuevo y un sku, muestra el precio sugerido por la regla de la casa, cuánto varía el costo y si el precio vigente quedaría por debajo del costo.',
    input_schema: {
      type: 'object',
      properties: {
        sku: { type: 'string' },
        costoNuevo: { type: 'number' },
        margenPct: { type: 'number', description: 'Opcional: si no viene, se usa el margen del rubro.' },
      },
      required: ['sku', 'costoNuevo'],
    },
  },
  {
    name: 'crear_propuesta',
    description:
      'Deja la actualización de costos lista para que la apruebe el DUEÑO. No aplica nada por sí sola. Usala recién cuando los números estén cerrados con el comprador.',
    input_schema: {
      type: 'object',
      properties: {
        titulo: { type: 'string', description: 'Ej: "Cepas · lista de agosto"' },
        proveedor: { type: 'string', description: 'Nombre del proveedor, si se sabe.' },
        notas: { type: 'string', description: 'Lo que el dueño necesita saber para decidir, en dos líneas.' },
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              sku: { type: 'string' },
              costoNuevo: { type: 'number' },
              aplicarPrecio: { type: 'boolean', description: 'true = también mover el precio de venta. Por defecto true.' },
              margenPct: { type: 'number' },
            },
            required: ['sku', 'costoNuevo'],
          },
        },
      },
      required: ['items'],
    },
  },
];

@Injectable()
export class MesaComprasService {
  private readonly log = new Logger('MesaCompras');
  constructor(@Inject(SUPABASE) private readonly db: SupabaseClient) {}

  // ---- herramientas ----

  private ofertaDesdeInput(i: any): OfertaCompra {
    return {
      descripcion: i.descripcion,
      unidadesPorBulto: Number(i.unidadesPorBulto) || 1,
      bultos: Number(i.bultos) || 1,
      precioBulto: Number(i.precioBulto) || 0,
      ajusteListaPct: Number(i.ajusteListaPct) || 0,
      descuentosPct: Array.isArray(i.descuentosPct) ? i.descuentosPct.map(Number) : [],
      bonificacion:
        Number(i.bonificacionPaga) > 0 && Number(i.bonificacionGratis) > 0
          ? { paga: Number(i.bonificacionPaga), gratis: Number(i.bonificacionGratis) }
          : null,
      flete: Number(i.flete) || 0,
      impuestosInternosPct: Number(i.impuestosInternosPct) || 0,
      impuestosInternosPorUnidad: Number(i.impuestosInternosPorUnidad) || 0,
      plazoDias: Number(i.plazoDias) || 0,
      tasaMensualPct: Number(i.tasaMensualPct) || 0,
    };
  }

  async buscarProducto(q: string) {
    const t = String(q ?? '').trim();
    if (t.length < 2) return { items: [] };
    const { data } = await this.db
      .from('productos')
      .select('id, sku, nombre, costo, categoria_id, categorias(margen_sugerido)')
      .or(`nombre.ilike.%${t}%,sku.ilike.%${t}%`)
      .eq('activo', true)
      .limit(8);

    const items = await Promise.all(
      (data ?? []).map(async (p: any) => {
        const { data: precio } = await this.db
          .from('precios')
          .select('precio')
          .eq('producto_id', p.id)
          .order('vigente_desde', { ascending: false })
          .limit(1)
          .maybeSingle();
        return {
          sku: p.sku,
          nombre: p.nombre,
          costoActual: p.costo != null ? Number(p.costo) : null,
          precioVigente: precio?.precio != null ? Number(precio.precio) : null,
          margenDelRubro: p.categorias?.margen_sugerido ?? null,
        };
      }),
    );
    return { items };
  }

  private async datosDeSku(sku: string) {
    const { items } = await this.buscarProducto(sku);
    const p = items.find((x) => x.sku === sku) ?? items[0];
    if (!p) throw new Error(`No encontré el producto ${sku}`);
    return p;
  }

  async impactoDeSku(sku: string, costoNuevo: number, margenPct?: number) {
    const p = await this.datosDeSku(sku);
    const margen = margenAplicable(margenPct ?? null, p.margenDelRubro);
    return {
      sku: p.sku,
      nombre: p.nombre,
      margenUsado: margen,
      ...impactoEnPrecio({
        costoNuevo,
        costoAnterior: p.costoActual,
        precioVigente: p.precioVigente,
        margenPct: margen,
      }),
    };
  }

  async crearPropuesta(input: any, usuarioId?: string) {
    const items = Array.isArray(input.items) ? input.items : [];
    if (!items.length) throw new Error('La propuesta no tiene renglones');

    let proveedorId: string | null = null;
    if (input.proveedor) {
      const { data } = await this.db
        .from('proveedores')
        .select('id')
        .ilike('razon_social', `%${String(input.proveedor).trim()}%`)
        .limit(1)
        .maybeSingle();
      proveedorId = data?.id ?? null;
    }

    const { data: prop, error } = await this.db
      .from('propuestas_costo')
      .insert({
        proveedor_id: proveedorId,
        titulo: input.titulo ?? 'Actualización de costos',
        notas: input.notas ?? null,
        creada_por: usuarioId ?? null,
        razonamiento: input.razonamiento ?? [],
      })
      .select('id')
      .single();
    if (error) throw new Error(error.message);

    const renglones: any[] = [];
    for (const it of items) {
      const p = await this.datosDeSku(String(it.sku));
      const margen = margenAplicable(it.margenPct ?? null, p.margenDelRubro);
      const imp = impactoEnPrecio({
        costoNuevo: Number(it.costoNuevo),
        costoAnterior: p.costoActual,
        precioVigente: p.precioVigente,
        margenPct: margen,
      });
      const { data: prod } = await this.db.from('productos').select('id').eq('sku', p.sku).single();
      renglones.push({
        propuesta_id: prop.id,
        producto_id: prod!.id,
        costo_anterior: p.costoActual,
        costo_nuevo: Number(it.costoNuevo),
        precio_anterior: p.precioVigente,
        precio_sugerido: imp.precioSugerido,
        margen_pct: margen,
        aplicar_precio: it.aplicarPrecio !== false,
        detalle: imp,
      });
    }
    const { error: errItems } = await this.db.from('propuestas_costo_items').insert(renglones);
    if (errItems) throw new Error(errItems.message);

    return {
      propuestaId: prop.id,
      renglones: renglones.length,
      estado: 'pendiente',
      aviso: 'La propuesta quedó PENDIENTE de aprobación del dueño. Todavía no se aplicó ningún cambio.',
    };
  }

  // Costea TODA la planilla en código. El modelo solo dijo qué columna es cuál y
  // qué descuento va por línea; acá se recorren las filas, se aplica la regla que
  // coincide y se llama al mismo cálculo de siempre. 400 filas tardan milisegundos.
  private costearPlanilla(input: any, planilla: PlanillaCargada | null) {
    if (!planilla?.hojas?.length) {
      return { error: 'No hay ninguna planilla adjunta en esta conversación. Pedile al comprador que la vuelva a adjuntar.' };
    }
    const hoja = input.hoja
      ? planilla.hojas.find((h) => h.hoja.toLowerCase().includes(String(input.hoja).toLowerCase())) ?? planilla.hojas[0]
      : planilla.hojas[0];
    const filas = hoja.filas;
    const norm = (v: any) => String(v ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

    // fila de títulos: la que dijo el modelo, o la primera que tenga la columna de precio
    const buscaCol = (titulos: any[], quien: string): number => {
      const q = norm(quien);
      if (!q) return -1;
      // por letra de Excel (A, B, C…)
      if (/^[a-z]{1,2}$/.test(q)) {
        let n = 0;
        for (const c of q) n = n * 26 + (c.charCodeAt(0) - 96);
        return n - 1;
      }
      let i = titulos.findIndex((t) => norm(t) === q);
      if (i < 0) i = titulos.findIndex((t) => norm(t).includes(q) || q.includes(norm(t)) && norm(t).length > 3);
      return i;
    };
    let iEnc = Number(input.filaEncabezado) > 0 ? Number(input.filaEncabezado) - 1 : -1;
    if (iEnc < 0) {
      for (let i = 0; i < Math.min(filas.length, 25); i++) {
        if (buscaCol(filas[i], String(input.columnaPrecio ?? '')) >= 0) { iEnc = i; break; }
      }
    }
    if (iEnc < 0 || !filas[iEnc]) {
      return { error: `No encontré la columna "${input.columnaPrecio}" en la hoja "${hoja.hoja}". Decile al comprador cómo se llama exactamente, o pasá la letra de la columna.` };
    }
    const titulos = filas[iEnc];
    const cPrecio = buscaCol(titulos, String(input.columnaPrecio ?? ''));
    const cDesc = buscaCol(titulos, String(input.columnaDescripcion ?? ''));
    const cUnid = buscaCol(titulos, String(input.columnaUnidades ?? ''));
    if (cPrecio < 0) return { error: `No encontré la columna de precio "${input.columnaPrecio}". Columnas disponibles: ${titulos.map((t: any) => String(t)).filter(Boolean).join(' | ')}` };

    const reglas: any[] = Array.isArray(input.reglas) ? input.reglas : [];
    const porDefecto: number[] = Array.isArray(input.descuentoPorDefectoPct) ? input.descuentoPorDefectoPct.map(Number) : [];
    const impuestosPct = Number(input.impuestosPct) || 0;

    const renglones: any[] = [];
    const saltados: string[] = [];
    for (let i = iEnc + 1; i < filas.length; i++) {
      const f = filas[i];
      if (!f) continue;
      const desc = String(cDesc >= 0 ? f[cDesc] ?? '' : f.find((c: any) => String(c ?? '').trim().length > 3) ?? '').trim();
      const bruto = String(f[cPrecio] ?? '').replace(/\$/g, '').replace(/\s/g, '');
      // "1.234,56" (es-AR) y "1234.56" (plano)
      const precio = Number(/,/.test(bruto) ? bruto.replace(/\./g, '').replace(',', '.') : bruto);
      if (!desc && !(precio > 0)) continue;
      if (!(precio > 0)) { if (desc) saltados.push(desc); continue; }
      const nd = norm(desc);
      const regla = reglas.find((r) => {
        const pega = (r.lineas ?? []).some((l: string) => nd.includes(norm(l)));
        const excluido = (r.excluye ?? []).some((x: string) => nd.includes(norm(x)));
        return pega && !excluido;
      });
      const descuentos = regla ? (regla.descuentosPct ?? []).map(Number) : porDefecto;
      try {
        const c = calcularCosto({
          descripcion: desc || `fila ${i + 1}`,
          unidadesPorBulto: cUnid >= 0 ? Number(f[cUnid]) || 1 : 1,
          bultos: 1,
          precioBulto: precio,
          ajusteListaPct: Number(input.ajusteListaPct) || 0,
          descuentosPct: descuentos,
          impuestosInternosPct: impuestosPct,
          plazoDias: Number(input.plazoDias) || 0,
          tasaMensualPct: Number(input.tasaMensualPct) || 0,
          flete: 0,
        });
        renglones.push({
          descripcion: desc || `fila ${i + 1}`,
          precioLista: precio,
          descuentoAplicado: descuentos.length ? descuentos.join('% + ') + '%' : 'sin descuento',
          linea: regla ? (regla.lineas ?? [])[0] : 'resto',
          costoUnitario: c.costoUnitarioReal,
          costoContado: c.costoUnitarioContado,
        });
      } catch (e) {
        saltados.push(`${desc || 'fila ' + (i + 1)}: ${e instanceof Error ? e.message : 'no se pudo costear'}`);
      }
    }
    const flete = Number(input.flete) || 0;
    if (flete > 0 && renglones.length) {
      const porRenglon = flete / renglones.length;
      for (const r of renglones) if (r.costoUnitario != null) {
        r.costoUnitario = Math.round((r.costoUnitario + porRenglon) * 100) / 100;
        r.costoContado = Math.round((r.costoContado + porRenglon) * 100) / 100;
      }
    }
    // resumen por línea: es lo que el comprador quiere ver, y evita que el modelo
    // tenga que recorrer los 400 renglones para sacar conclusiones
    const porLinea: Record<string, { renglones: number; costoMin: number; costoMax: number; descuento: string }> = {};
    for (const r of renglones) {
      const k = r.linea || 'resto';
      const p = (porLinea[k] ??= { renglones: 0, costoMin: Infinity, costoMax: 0, descuento: r.descuentoAplicado });
      p.renglones++;
      if (r.costoUnitario != null) { p.costoMin = Math.min(p.costoMin, r.costoUnitario); p.costoMax = Math.max(p.costoMax, r.costoUnitario); }
    }
    for (const k of Object.keys(porLinea)) if (!isFinite(porLinea[k].costoMin)) porLinea[k].costoMin = 0;

    return {
      hoja: hoja.hoja,
      resumenPorLinea: porLinea,
      columnas: { descripcion: cDesc >= 0 ? titulos[cDesc] : '(la primera con texto)', precio: titulos[cPrecio], unidades: cUnid >= 0 ? titulos[cUnid] : '(por unidad)' },
      costeados: renglones.length,
      saltados: saltados.length,
      detalleSaltados: saltados.slice(0, 10),
      renglones,
      aclaracion: `Se costearon ${renglones.length} renglones con las reglas dadas. Estos números los calculó el sistema: informalos tal cual. Mostrale al comprador un resumen por línea (cuántos renglones y el rango de costo), no la lista entera, salvo que la pida.`,
    };
  }

  private async ejecutar(nombre: string, input: any, usuarioId?: string, planilla?: PlanillaCargada | null): Promise<unknown> {
    switch (nombre) {
      case 'costear_planilla':
        return this.costearPlanilla(input, planilla ?? null);
      case 'calcular_costo':
        return calcularCosto(this.ofertaDesdeInput(input));
      case 'calcular_costos_en_tanda': {
        const ofertas = Array.isArray(input.ofertas) ? input.ofertas : [];
        // Una sola vuelta del modelo cuesta toda la planilla: cada renglón es
        // matemática pura, y un renglón que venga mal cargado no tira abajo el resto.
        const costos = ofertas.map((o: any, i: number) => {
          try {
            return calcularCosto(this.ofertaDesdeInput(o));
          } catch (e) {
            return { indice: i, descripcion: o?.descripcion ?? `renglón ${i + 1}`, error: e instanceof Error ? e.message : 'no se pudo costear' };
          }
        });
        return { costos, total: costos.length };
      }
      case 'comparar_ofertas':
        return compararOfertas((input.ofertas ?? []).map((o: any) => this.ofertaDesdeInput(o)));
      case 'buscar_producto':
        return this.buscarProducto(String(input.q ?? ''));
      case 'impacto_en_precio':
        return this.impactoDeSku(String(input.sku), Number(input.costoNuevo), input.margenPct);
      case 'crear_propuesta':
        return this.crearPropuesta(input, usuarioId);
      default:
        return { error: `Herramienta desconocida: ${nombre}` };
    }
  }

  // ---- la charla ----

  async charlar(mensajes: MensajeMesa[], usuarioId?: string) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new BadRequestException('Falta ANTHROPIC_API_KEY');
    }
    if (!mensajes?.length || mensajes[mensajes.length - 1].rol !== 'usuario') {
      throw new BadRequestException('El último mensaje tiene que ser del comprador');
    }

    const claude = new Anthropic();
    // la última planilla adjunta queda parseada para costear_planilla
    let planilla: PlanillaCargada | null = null;
    for (const m of mensajes) {
      const nom = m.nombreArchivo ?? '';
      const mim = (m.mimeType ?? '').toLowerCase();
      if (m.imagenBase64 && (/spreadsheet|excel|csv|ms-excel/.test(mim) || /\.(xlsx?|xlsm|csv)$/i.test(nom))) {
        try { planilla = planillaCargar(m.imagenBase64, nom || 'planilla'); } catch { /* el texto igual va al modelo */ }
      }
    }
    const historial: Anthropic.MessageParam[] = mensajes.slice(-16).map((m) => {
      const bloques: Anthropic.ContentBlockParam[] = [];
      if (m.imagenBase64) {
        const mime = (m.mimeType ?? '').toLowerCase();
        const nombre = m.nombreArchivo ?? '';
        const esPlanilla =
          /spreadsheet|excel|csv|ms-excel/.test(mime) || /\.(xlsx?|xlsm|csv)$/i.test(nombre);
        if (IMAGENES.has(mime)) {
          // foto de la lista: el modelo la lee como imagen
          bloques.push({ type: 'image', source: { type: 'base64', media_type: mime as any, data: m.imagenBase64 } });
        } else if (mime === 'application/pdf' || /\.pdf$/i.test(nombre)) {
          bloques.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: m.imagenBase64 } } as any);
        } else if (esPlanilla) {
          // Excel/CSV: se vuelca a texto tabulado, que es lo que el modelo procesa bien
          try {
            bloques.push({ type: 'text', text: planillaATexto(m.imagenBase64, nombre) });
          } catch (e) {
            bloques.push({ type: 'text', text: `[No pude leer la planilla "${nombre}": ${e instanceof Error ? e.message : 'formato no reconocido'}. Pedile al comprador que la reenvíe como .xlsx o .csv.]` });
          }
        } else {
          bloques.push({ type: 'text', text: `[Se adjuntó un archivo "${nombre}" de tipo ${mime || 'desconocido'} que no puedo leer. Aceptás fotos (JPG/PNG), PDF y planillas Excel/CSV.]` });
        }
      }
      if (m.texto?.trim()) bloques.push({ type: 'text', text: m.texto });
      if (!bloques.length) bloques.push({ type: 'text', text: '(sin contenido)' });
      return { role: m.rol === 'usuario' ? 'user' : 'assistant', content: bloques };
    });

    const usados: string[] = [];
    for (let vuelta = 0; vuelta < 8; vuelta++) {
      let res: Anthropic.Message;
      try {
        res = await claude.messages.create({
          model: 'claude-opus-4-8',
          // Con planillas el analista arma tandas grandes (una llamada a
          // calcular_costos_en_tanda con decenas de renglones) y después lista
          // el precio de cada uno: 4k tokens quedaba corto y la respuesta salía
          // vacía. 16k da aire de sobra sin necesidad de streaming.
          max_tokens: 16000,
          thinking: { type: 'adaptive' },
          system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
          tools: HERRAMIENTAS,
          messages: historial,
        });
      } catch (e) {
        // Que un error del modelo (sobrecarga, límite, timeout) no salga como un
        // 500 pelado: la pantalla tiene que poder decirle algo útil al comprador.
        this.log.error(`analista falló: ${e instanceof Error ? e.message : e}`);
        const overloaded =
          e instanceof Anthropic.APIError && (e.status === 429 || e.status === 529 || e.status >= 500);
        throw new BadRequestException(
          overloaded
            ? 'El analista está saturado en este momento. Esperá unos segundos y probá de nuevo.'
            : 'No pude procesar la consulta. Si la planilla es muy grande, pedile menos renglones de una.',
        );
      }

      const pedidos = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
      if (!pedidos.length) {
        const texto = res.content
          .filter((b): b is Anthropic.TextBlock => b.type === 'text')
          .map((b) => b.text)
          .join('\n')
          .trim();
        return {
          // Si el modelo cortó sin texto (por ejemplo, se le fue el presupuesto
          // pensando una tanda enorme), no devolvemos vacío: damos una salida útil.
          respuesta:
            texto ||
            (res.stop_reason === 'max_tokens'
              ? 'Se me hizo muy larga la lista de una. Decime con cuántos renglones arranco (por ejemplo los primeros 30) y te los paso todos juntos.'
              : 'No me salió una respuesta clara. ¿Probamos con menos renglones a la vez?'),
          herramientas: usados,
        };
      }

      historial.push({ role: 'assistant', content: res.content });
      const resultados: Anthropic.ToolResultBlockParam[] = [];
      for (const p of pedidos) {
        usados.push(p.name);
        this.log.log(`herramienta ${p.name}`);
        try {
          const out = await this.ejecutar(p.name, p.input as any, usuarioId, planilla);
          resultados.push({ type: 'tool_result', tool_use_id: p.id, content: JSON.stringify(out) });
        } catch (e) {
          resultados.push({
            type: 'tool_result',
            tool_use_id: p.id,
            content: JSON.stringify({ error: e instanceof Error ? e.message : 'error' }),
            is_error: true,
          });
        }
      }
      historial.push({ role: 'user', content: resultados });
    }
    return { respuesta: 'Se me hizo largo el cálculo. ¿Lo dividimos en partes?', herramientas: usados };
  }

  // ---- bandeja del dueño ----

  async pendientes() {
    const { data } = await this.db
      .from('propuestas_costo')
      .select(
        `id, titulo, notas, estado, creada_en, razonamiento,
         proveedor:proveedores(razon_social),
         autor:usuarios!propuestas_costo_creada_por_fkey(nombre),
         items:propuestas_costo_items(costo_anterior, costo_nuevo, precio_anterior, precio_sugerido,
                                      margen_pct, aplicar_precio, detalle, producto:productos(sku, nombre))`,
      )
      .eq('estado', 'pendiente')
      .order('creada_en', { ascending: false });
    return data ?? [];
  }

  async aprobar(id: string, usuarioId: string) {
    const { data, error } = await this.db.rpc('aprobar_propuesta_costo', {
      p_propuesta: id,
      p_usuario: usuarioId,
    });
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async rechazar(id: string, motivo: string, usuarioId: string) {
    const { error } = await this.db
      .from('propuestas_costo')
      .update({
        estado: 'rechazada',
        decidida_por: usuarioId,
        decidida_en: new Date().toISOString(),
        rechazo_motivo: motivo || 'Sin motivo',
      })
      .eq('id', id)
      .eq('estado', 'pendiente');
    if (error) throw new BadRequestException(error.message);
    return { ok: true };
  }
}
