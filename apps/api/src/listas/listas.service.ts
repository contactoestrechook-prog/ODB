import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import * as XLSX from 'xlsx';
import { SUPABASE } from '../supabase.provider';

export type ItemExtraido = { codigo: string | null; descripcion: string; precio: number };
// pedido exportado del portal del proveedor: igual que la lista pero con cantidad
export type ItemPedidoExtraido = ItemExtraido & { cantidad: number };

type Match = {
  sku: string;
  nombre: string;
  costoActual: number | null;
  variacionPct: number | null;
  metodo: 'codigo_proveedor' | 'codigo_barras' | 'similitud' | 'alias';
  margenPct: number | null; // remarcación guardada de la última compra (si hay)
} | null;

// Normaliza un texto de renglón para usarlo como alias estable (sin tildes,
// sin puntuación, espacios colapsados). Mismo criterio al guardar y al matchear.
export function normalizarAlias(s: string): string {
  return (s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export type ItemPropuesta = ItemExtraido & { match: Match };
export type ItemPedidoPropuesta = ItemPedidoExtraido & { match: Match };

const INSTRUCCION_EXTRACCION =
  'Esta es una lista de precios de un proveedor/mayorista. Extraé TODOS los renglones de productos con su código (el número junto a "COD." si existe), descripción y precio unitario en pesos. La descripción debe EMPEZAR por la marca cuando esté visible (ej: "Gallo Arroz Parboil 1kg"). Ignorá combos, encabezados, totales, condiciones comerciales, texto legal y decorativo.';

// Comprobante fotografiado (factura A/B/C, remito, ticket): datos completos
// del encabezado, renglones e impuestos — el "cerebro" de la entrada por foto.
const ESQUEMA_COMPROBANTE = {
  type: 'object',
  properties: {
    proveedor: {
      type: 'object',
      properties: {
        nombre: { type: ['string', 'null'], description: 'Razón social del EMISOR del comprobante' },
        cuit: { type: ['string', 'null'], description: 'CUIT del emisor, solo dígitos (ej 30716969718)' },
      },
      required: ['nombre', 'cuit'],
      additionalProperties: false,
    },
    comprobante: {
      type: 'object',
      properties: {
        tipo: { type: 'string', enum: ['factura_a', 'factura_b', 'factura_c', 'remito', 'ticket', 'otro'], description: 'Tipo: factura A discrimina IVA; "No válido como factura" o presupuesto = remito' },
        numero: { type: ['string', 'null'], description: 'Número completo, ej 0005-00039783' },
        fecha: { type: ['string', 'null'], description: 'Fecha de emisión AAAA-MM-DD' },
        condicionVenta: { type: ['string', 'null'], description: 'Contado / Cta Cte / CRE etc.' },
      },
      required: ['tipo', 'numero', 'fecha', 'condicionVenta'],
      additionalProperties: false,
    },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          codigo: { type: ['string', 'null'], description: 'Código del artículo del proveedor' },
          descripcion: { type: 'string' },
          cantidad: { type: 'number' },
          precio: { type: 'number', description: 'Precio unitario tal como figura (neto si la factura discrimina IVA)' },
        },
        required: ['codigo', 'descripcion', 'cantidad', 'precio'],
        additionalProperties: false,
      },
    },
    impuestos: {
      type: 'object',
      properties: {
        neto: { type: ['number', 'null'], description: 'Neto gravado' },
        iva: { type: ['number', 'null'], description: 'IVA total en pesos' },
        alicuotaIva: { type: ['number', 'null'], description: 'Alícuota principal (21, 10.5...)' },
        percepcionIva: { type: ['number', 'null'], description: 'Percepción de IVA (ej RG 5329/3337) en pesos' },
        percepcionIibb: { type: ['number', 'null'], description: 'Percepción de Ingresos Brutos en pesos' },
        otros: { type: ['number', 'null'], description: 'Otros impuestos/tasas en pesos' },
        total: { type: ['number', 'null'], description: 'Total final del comprobante' },
      },
      required: ['neto', 'iva', 'alicuotaIva', 'percepcionIva', 'percepcionIibb', 'otros', 'total'],
      additionalProperties: false,
    },
    notasManuscritas: { type: ['string', 'null'], description: 'Anotaciones a mano relevantes (ej desglose de sabores/cantidades)' },
  },
  required: ['proveedor', 'comprobante', 'items', 'impuestos', 'notasManuscritas'],
  additionalProperties: false,
} as const;

const ESQUEMA_PEDIDO = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          codigo: { type: ['string', 'null'], description: 'Código del artículo según el proveedor, si existe' },
          descripcion: { type: 'string', description: 'Descripción del producto tal como figura' },
          cantidad: { type: 'number', description: 'Cantidad pedida' },
          precio: { type: 'number', description: 'Precio unitario en pesos; 0 si no figura' },
        },
        required: ['codigo', 'descripcion', 'cantidad', 'precio'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
} as const;

const ESQUEMA_EXTRACCION = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          codigo: { type: ['string', 'null'], description: 'Código del artículo según el proveedor, si existe' },
          descripcion: { type: 'string', description: 'Descripción del producto tal como figura' },
          precio: { type: 'number', description: 'Precio unitario sin IVA si está discriminado; el de lista si no' },
        },
        required: ['codigo', 'descripcion', 'precio'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
} as const;

@Injectable()
export class ListasService {
  constructor(@Inject(SUPABASE) private readonly db: SupabaseClient) {}

  async analizar(archivo: Express.Multer.File, proveedorId: string) {
    if (!archivo) throw new BadRequestException('Falta el archivo (campo "archivo")');
    const nombre = archivo.originalname.toLowerCase();

    let items: ItemExtraido[];
    let metodo: string;
    if (nombre.endsWith('.pdf')) {
      items = await this.extraerConIA(archivo, 'pdf');
      metodo = 'ia_pdf';
    } else if (nombre.endsWith('.txt')) {
      // texto extraído de catálogos grandes: se procesa en tandas
      items = await this.extraerTextoConIA(archivo.buffer.toString('utf8'));
      metodo = 'ia_texto';
    } else if (/\.(xlsx|xls|csv)$/.test(nombre)) {
      try {
        items = this.extraerExcelHeuristico(archivo.buffer);
        metodo = 'excel_heuristico';
      } catch (e) {
        // Formato raro: lo resuelve la IA si hay clave configurada
        items = await this.extraerConIA(archivo, 'excel');
        metodo = 'ia_excel';
      }
    } else {
      throw new BadRequestException('Formato no soportado: usar PDF, Excel o CSV');
    }

    const propuesta = await this.matchear(items, proveedorId);
    return {
      metodo,
      total: propuesta.length,
      conMatch: propuesta.filter((i) => i.match).length,
      items: propuesta,
    };
  }

  // Pedido armado en el portal del proveedor (carrito exportado a Excel/CSV):
  // extrae renglones CON CANTIDAD y los matchea contra el catálogo para
  // precargar una orden de compra sin retipear nada.
  async analizarPedido(archivo: Express.Multer.File, proveedorId: string) {
    if (!archivo) throw new BadRequestException('Falta el archivo (campo "archivo")');
    const nombre = archivo.originalname.toLowerCase();

    let items: ItemPedidoExtraido[];
    let metodo: string;
    if (/\.(xlsx|xls|csv)$/.test(nombre)) {
      try {
        items = this.extraerExcelPedidoHeuristico(archivo.buffer);
        metodo = 'excel_heuristico';
      } catch {
        items = await this.extraerPedidoConIA(archivo);
        metodo = 'ia_excel';
      }
    } else if (nombre.endsWith('.pdf')) {
      items = await this.extraerPedidoConIA(archivo, 'pdf');
      metodo = 'ia_pdf';
    } else {
      throw new BadRequestException('Formato no soportado: usar Excel, CSV o PDF');
    }

    const propuesta = await this.matchear(items, proveedorId);
    return {
      metodo,
      total: propuesta.length,
      conMatch: propuesta.filter((i) => i.match).length,
      items: propuesta,
    };
  }

  // FOTO de la factura/remito del proveedor → Claude Vision extrae encabezado,
  // renglones e impuestos; acá se matchea el proveedor (por CUIT) y los productos.
  // Devuelve la propuesta completa para la pantalla de revisión (no escribe nada).
  // acepta un archivo subido (multipart) o un buffer directo (bot de WhatsApp)
  async analizarComprobanteFoto(archivo: { buffer: Buffer; mimetype: string; originalname?: string }) {
    if (!archivo?.buffer) throw new BadRequestException('Falta el archivo');
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new BadRequestException('La lectura por foto necesita ANTHROPIC_API_KEY en apps/api/.env');
    }
    const nombre = (archivo.originalname ?? '').toLowerCase();
    const esPdf = nombre.endsWith('.pdf') || archivo.mimetype === 'application/pdf';
    const mediaType = esPdf ? null : (archivo.mimetype as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif');
    if (!esPdf && !/^image\/(jpeg|png|webp|gif)$/.test(archivo.mimetype)) {
      throw new BadRequestException('Formato no soportado: foto (JPG/PNG) o PDF');
    }

    const claude = new Anthropic();
    const contenido: Anthropic.ContentBlockParam[] = [
      esPdf
        ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: archivo.buffer.toString('base64') } }
        : { type: 'image', source: { type: 'base64', media_type: mediaType!, data: archivo.buffer.toString('base64') } },
      {
        type: 'text',
        text:
          'Este es un comprobante de COMPRA de un almacén (factura de proveedor, remito o ticket, puede ser una foto tomada con el celular). ' +
          'Extraé todos los datos: emisor con CUIT, tipo y número de comprobante, TODOS los renglones (código, descripción, cantidad, precio unitario tal como figura), ' +
          'y el desglose de impuestos del pie (neto gravado, IVA y su alícuota, percepciones de IVA tipo RG 5329/3337, percepciones de IIBB, otros, total final). ' +
          'Si hay anotaciones manuscritas relevantes (desgloses de cantidades, sabores), transcribilas en notasManuscritas. Ignorá el fondo de la foto.',
      },
    ];

    const respuesta = await claude.messages
      .stream({
        model: 'claude-opus-4-8',
        max_tokens: 16000,
        output_config: { format: { type: 'json_schema', schema: ESQUEMA_COMPROBANTE as any } },
        messages: [{ role: 'user', content: contenido }],
      })
      .finalMessage();
    const bloque = respuesta.content.find((b) => b.type === 'text');
    const datos = JSON.parse(bloque && 'text' in bloque ? bloque.text : '{}');

    // proveedor: por CUIT exacto (solo dígitos), sino por similitud de nombre
    const cuit = (datos.proveedor?.cuit ?? '').replace(/\D/g, '');
    let proveedor: any = null;
    if (cuit) {
      const { data } = await this.db.from('proveedores').select('id, razon_social, cuit').eq('activo', true);
      proveedor = (data ?? []).find((p: any) => (p.cuit ?? '').replace(/\D/g, '') === cuit) ?? null;
    }
    if (!proveedor && datos.proveedor?.nombre) {
      const { data } = await this.db
        .from('proveedores')
        .select('id, razon_social, cuit')
        .ilike('razon_social', `%${datos.proveedor.nombre.split(/\s+/)[0]}%`)
        .limit(1)
        .maybeSingle();
      proveedor = data ?? null;
    }

    // productos: mismo matching que listas/pedidos (código prov → EAN → similitud)
    const items: ItemPedidoExtraido[] = (datos.items ?? []).map((i: any) => ({
      codigo: i.codigo ?? null,
      descripcion: i.descripcion,
      cantidad: Number(i.cantidad) || 1,
      precio: Number(i.precio) || 0,
    }));
    const propuesta = proveedor ? await this.matchear(items, proveedor.id) : items.map((i) => ({ ...i, match: null as Match }));

    return {
      proveedor: {
        detectado: datos.proveedor ?? null,
        match: proveedor, // null = hay que darlo de alta o elegirlo a mano
      },
      comprobante: datos.comprobante ?? null,
      impuestos: datos.impuestos ?? null,
      notasManuscritas: datos.notasManuscritas ?? null,
      total: propuesta.length,
      conMatch: propuesta.filter((i) => i.match).length,
      items: propuesta,
    };
  }

  async aplicar(proveedorId: string, items: { sku: string; costo: number }[], usuarioId?: string) {
    const { data, error } = await this.db.rpc('aplicar_lista_proveedor', {
      p_proveedor: proveedorId,
      p_items: items,
      p_usuario: usuarioId ?? null,
    });
    if (error) {
      const msg = error.message.includes('permission denied')
        ? 'El backend no tiene permisos de escritura: falta la SUPABASE_SERVICE_KEY en apps/api/.env'
        : error.message;
      throw new BadRequestException(msg);
    }
    return { aplicados: data };
  }

  // --- Extracción determinística para Excels bien formados ---
  private extraerExcelHeuristico(buffer: Buffer): ItemExtraido[] {
    const wb = XLSX.read(buffer, { type: 'buffer' });
    const hoja = wb.Sheets[wb.SheetNames[0]];
    const filas: any[][] = XLSX.utils.sheet_to_json(hoja, { header: 1, defval: null });

    // Buscar la fila de encabezados: contiene algo tipo precio/costo y descripción
    const esPrecio = (s: string) => /precio|costo|importe|p\.?\s*unit/i.test(s);
    const esDesc = (s: string) => /desc|art[ií]culo|producto|nombre|detalle/i.test(s);
    const esCodigo = (s: string) => /c[oó]d|sku|ref/i.test(s);

    let filaHeader = -1;
    let colPrecio = -1, colDesc = -1, colCodigo = -1;
    for (let i = 0; i < Math.min(filas.length, 20); i++) {
      const celdas = (filas[i] ?? []).map((c) => (c == null ? '' : String(c)));
      const iPrecio = celdas.findIndex(esPrecio);
      const iDesc = celdas.findIndex(esDesc);
      if (iPrecio >= 0 && iDesc >= 0) {
        filaHeader = i;
        colPrecio = iPrecio;
        colDesc = iDesc;
        colCodigo = celdas.findIndex(esCodigo);
        break;
      }
    }
    if (filaHeader < 0) throw new Error('No se detectaron encabezados de lista de precios');

    const limpiarPrecio = (v: any): number | null => {
      if (typeof v === 'number') return v;
      if (v == null) return null;
      const n = parseFloat(String(v).replace(/[$\s.]/g, '').replace(',', '.'));
      return Number.isFinite(n) ? n : null;
    };

    const items: ItemExtraido[] = [];
    for (const fila of filas.slice(filaHeader + 1)) {
      const descripcion = fila?.[colDesc] ? String(fila[colDesc]).trim() : null;
      const precio = limpiarPrecio(fila?.[colPrecio]);
      if (!descripcion || precio == null || precio <= 0) continue;
      items.push({
        codigo: colCodigo >= 0 && fila?.[colCodigo] != null ? String(fila[colCodigo]).trim() : null,
        descripcion,
        precio,
      });
    }
    if (items.length === 0) throw new Error('La hoja no tiene renglones interpretables');
    return items;
  }

  // --- Pedido en Excel: como el heurístico de listas pero exige columna de cantidad ---
  private extraerExcelPedidoHeuristico(buffer: Buffer): ItemPedidoExtraido[] {
    const wb = XLSX.read(buffer, { type: 'buffer' });
    const hoja = wb.Sheets[wb.SheetNames[0]];
    const filas: any[][] = XLSX.utils.sheet_to_json(hoja, { header: 1, defval: null });

    const esPrecio = (s: string) => /precio|costo|importe|p\.?\s*unit/i.test(s);
    const esDesc = (s: string) => /desc|art[ií]culo|producto|nombre|detalle/i.test(s);
    const esCodigo = (s: string) => /c[oó]d|sku|ref|ean/i.test(s);
    const esCantidad = (s: string) => /cant|unid|qty|pedid|bulto/i.test(s);

    let filaHeader = -1;
    let colPrecio = -1, colDesc = -1, colCodigo = -1, colCant = -1;
    for (let i = 0; i < Math.min(filas.length, 20); i++) {
      const celdas = (filas[i] ?? []).map((c) => (c == null ? '' : String(c)));
      const iDesc = celdas.findIndex(esDesc);
      const iCant = celdas.findIndex(esCantidad);
      if (iDesc >= 0 && iCant >= 0) {
        filaHeader = i;
        colDesc = iDesc;
        colCant = iCant;
        colPrecio = celdas.findIndex(esPrecio);
        colCodigo = celdas.findIndex(esCodigo);
        break;
      }
    }
    if (filaHeader < 0) throw new Error('No se detectaron encabezados de pedido (descripción + cantidad)');

    const numero = (v: any): number | null => {
      if (typeof v === 'number') return v;
      if (v == null) return null;
      const n = parseFloat(String(v).replace(/[$\s.]/g, '').replace(',', '.'));
      return Number.isFinite(n) ? n : null;
    };

    const items: ItemPedidoExtraido[] = [];
    for (const fila of filas.slice(filaHeader + 1)) {
      const descripcion = fila?.[colDesc] ? String(fila[colDesc]).trim() : null;
      const cantidad = numero(fila?.[colCant]);
      if (!descripcion || cantidad == null || cantidad <= 0) continue;
      items.push({
        codigo: colCodigo >= 0 && fila?.[colCodigo] != null ? String(fila[colCodigo]).trim() : null,
        descripcion,
        cantidad,
        precio: (colPrecio >= 0 ? numero(fila?.[colPrecio]) : null) ?? 0,
      });
    }
    if (items.length === 0) throw new Error('La hoja no tiene renglones de pedido interpretables');
    return items;
  }

  // --- Pedido con formato libre: extracción con Claude (incluye cantidad) ---
  private async extraerPedidoConIA(archivo: Express.Multer.File, tipo: 'pdf' | 'excel' = 'excel'): Promise<ItemPedidoExtraido[]> {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new BadRequestException(
        'Este archivo necesita el lector con IA: configurar ANTHROPIC_API_KEY en apps/api/.env',
      );
    }
    const claude = new Anthropic();
    const contenido: Anthropic.ContentBlockParam[] = [];
    if (tipo === 'pdf') {
      contenido.push({
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: archivo.buffer.toString('base64') },
      });
    } else {
      const wb = XLSX.read(archivo.buffer, { type: 'buffer' });
      const csv = XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]]);
      contenido.push({ type: 'text', text: `Contenido de la planilla:\n\n${csv.slice(0, 150_000)}` });
    }
    contenido.push({
      type: 'text',
      text: 'Este es un PEDIDO (carrito/orden exportada del portal de un proveedor). Extraé TODOS los renglones con su código (si existe), descripción, CANTIDAD pedida y precio unitario en pesos (0 si no figura). Ignorá encabezados, totales, condiciones y texto decorativo.',
    });

    const respuesta = await claude.messages
      .stream({
        model: 'claude-opus-4-8',
        max_tokens: 64000,
        output_config: { format: { type: 'json_schema', schema: ESQUEMA_PEDIDO as any } },
        messages: [{ role: 'user', content: contenido }],
      })
      .finalMessage();

    const texto = respuesta.content.find((b) => b.type === 'text');
    const datos = JSON.parse(texto && 'text' in texto ? texto.text : '{"items":[]}');
    return datos.items as ItemPedidoExtraido[];
  }

  // --- Extracción con Claude para PDFs y Excels con formato libre ---
  private async extraerConIA(archivo: Express.Multer.File, tipo: 'pdf' | 'excel'): Promise<ItemExtraido[]> {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new BadRequestException(
        'Este archivo necesita el lector con IA: configurar ANTHROPIC_API_KEY en apps/api/.env',
      );
    }
    const claude = new Anthropic();

    const contenido: Anthropic.ContentBlockParam[] = [];
    if (tipo === 'pdf') {
      contenido.push({
        type: 'document',
        source: {
          type: 'base64',
          media_type: 'application/pdf',
          data: archivo.buffer.toString('base64'),
        },
      });
    } else {
      const wb = XLSX.read(archivo.buffer, { type: 'buffer' });
      const csv = XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]]);
      contenido.push({ type: 'text', text: `Contenido de la planilla:\n\n${csv.slice(0, 150_000)}` });
    }
    contenido.push({ type: 'text', text: INSTRUCCION_EXTRACCION });

    // streaming: los catálogos largos generan salidas grandes
    const respuesta = await claude.messages
      .stream({
        model: 'claude-opus-4-8',
        max_tokens: 64000,
        output_config: { format: { type: 'json_schema', schema: ESQUEMA_EXTRACCION as any } },
        messages: [{ role: 'user', content: contenido }],
      })
      .finalMessage();

    const texto = respuesta.content.find((b) => b.type === 'text');
    const datos = JSON.parse(texto && 'text' in texto ? texto.text : '{"items":[]}');
    return datos.items as ItemExtraido[];
  }

  // --- Catálogos grandes en texto: tandas de ~55k caracteres por página ---
  private async extraerTextoConIA(texto: string): Promise<ItemExtraido[]> {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new BadRequestException('Falta la ANTHROPIC_API_KEY en apps/api/.env');
    }
    const claude = new Anthropic();
    const paginas = texto.split(/(?==== PÁGINA )/);
    const tandas: string[] = [];
    let actual = '';
    for (const p of paginas) {
      if (actual.length + p.length > 55_000 && actual) {
        tandas.push(actual);
        actual = '';
      }
      actual += p;
    }
    if (actual.trim()) tandas.push(actual);

    const items: ItemExtraido[] = [];
    for (const [i, tanda] of tandas.entries()) {
      const respuesta = await claude.messages
        .stream({
          // catálogos masivos: extracción mecánica → Haiku (~10× más barato)
          model: 'claude-haiku-4-5',
          max_tokens: 64000,
          output_config: { format: { type: 'json_schema', schema: ESQUEMA_EXTRACCION as any } },
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: `Texto extraído del catálogo (parte ${i + 1} de ${tandas.length}):\n\n${tanda}` },
                { type: 'text', text: INSTRUCCION_EXTRACCION },
              ],
            },
          ],
        })
        .finalMessage();
      const bloque = respuesta.content.find((b) => b.type === 'text');
      const datos = JSON.parse(bloque && 'text' in bloque ? bloque.text : '{"items":[]}');
      items.push(...(datos.items as ItemExtraido[]));
    }
    return items;
  }

  // --- Matching contra el catálogo (genérico: conserva campos extra como cantidad) ---
  private async matchear<T extends ItemExtraido>(items: T[], proveedorId: string): Promise<(T & { match: Match })[]> {
    const { data: catalogoProv } = await this.db
      .from('proveedor_productos')
      .select('codigo_proveedor, alias_descripcion, ultimo_costo, margen_pct, producto:productos(sku, nombre, costo)')
      .eq('proveedor_id', proveedorId);
    const filas = (catalogoProv ?? []) as any[];
    const porCodigoProv = new Map(filas.filter((r) => r.codigo_proveedor).map((r) => [r.codigo_proveedor.toLowerCase(), r]));
    // alias: el texto que leyó la IA en compras anteriores → producto ya vinculado
    const porAlias = new Map(filas.filter((r) => r.alias_descripcion).map((r) => [normalizarAlias(r.alias_descripcion), r]));

    const resultado: (T & { match: Match })[] = [];
    for (const item of items) {
      let match: Match = null;

      const porCodigo = item.codigo ? porCodigoProv.get(item.codigo.toLowerCase()) : null;
      if (porCodigo) {
        match = this.armarMatch(porCodigo.producto, porCodigo.ultimo_costo, item.precio, 'codigo_proveedor', porCodigo.margen_pct);
      } else if (item.codigo && /^\d{8,14}$/.test(item.codigo)) {
        const { data: cb } = await this.db
          .from('codigos_barras')
          .select('producto:productos(sku, nombre, costo)')
          .eq('codigo', item.codigo)
          .maybeSingle();
        if (cb?.producto) match = this.armarMatch(cb.producto, (cb.producto as any).costo, item.precio, 'codigo_barras', null);
      }

      // vínculo aprendido en una compra anterior (mismo texto de renglón)
      if (!match) {
        const alias = porAlias.get(normalizarAlias(item.descripcion));
        if (alias) match = this.armarMatch(alias.producto, alias.ultimo_costo, item.precio, 'alias', alias.margen_pct);
      }

      if (!match) {
        const { data: similar } = await this.db
          .rpc('buscar_producto_similar', { p_texto: item.descripcion })
          .maybeSingle();
        if (similar) {
          const { data: prod } = await this.db
            .from('productos')
            .select('sku, nombre, costo')
            .eq('sku', (similar as any).sku)
            .single();
          // guardián de marca: la primera palabra significativa del renglón
          // del proveedor (la marca) tiene que aparecer en el producto matcheado.
          // Evita cruzar "Knorr Risotto" con "Arroz Gallo Risotto".
          if (prod && this.mismaMarca(item.descripcion, prod.nombre)) {
            match = this.armarMatch(prod, prod.costo, item.precio, 'similitud', null);
          }
        }
      }

      resultado.push({ ...item, match });
    }
    return resultado;
  }

  private mismaMarca(descripcionProveedor: string, nombreProducto: string): boolean {
    const normalizar = (s: string) =>
      s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/gi, '').toLowerCase();
    const palabras = normalizar(descripcionProveedor).split(/\s+/).filter((p) => p.length >= 3);
    if (!palabras.length) return true;
    return normalizar(nombreProducto).includes(palabras[0]);
  }

  private armarMatch(
    producto: any,
    costoActual: number | null,
    precioNuevo: number,
    metodo: 'codigo_proveedor' | 'codigo_barras' | 'similitud' | 'alias',
    margenPct: number | null,
  ): Match {
    const costo = costoActual != null ? Number(costoActual) : null;
    return {
      sku: producto.sku,
      nombre: producto.nombre,
      costoActual: costo,
      variacionPct: costo ? Math.round(((precioNuevo - costo) / costo) * 1000) / 10 : null,
      metodo,
      margenPct: margenPct != null ? Number(margenPct) : null,
    };
  }
}
