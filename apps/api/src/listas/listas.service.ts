import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import * as XLSX from 'xlsx';
import { SUPABASE } from '../supabase.provider';
import { unidadesPorBulto, esRenglonDeDescuento } from '../compras/bultos';

export type ItemExtraido = { codigo: string | null; descripcion: string; precio: number };
// pedido exportado del portal del proveedor: igual que la lista pero con cantidad
export type ItemPedidoExtraido = ItemExtraido & { cantidad: number };

type Match = {
  sku: string;
  nombre: string;
  costoActual: number | null;
  variacionPct: number | null;
  metodo: 'codigo_proveedor' | 'codigo_barras' | 'similitud' | 'alias' | 'ia';
  margenPct: number | null; // remarcación guardada de la última compra (si hay)
  sugerido?: boolean; // propuesto por la IA: el operador tiene que confirmar ("¿es este?")
  motivo?: string; // por qué la IA cree que es ese producto
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
          cantidad: { type: 'number', description: 'La cantidad tal cual figura en la columna CANT. Si el renglón se factura por bulto/caja/pack, esta es la cantidad de BULTOS, no de unidades sueltas.' },
          precio: { type: 'number', description: 'Importe unitario de la columna PRE.UNIT tal cual impreso. NO uses PRE.VTA.PUBLICO (PVP) ni la columna IMPORTE. La relación con neto/IVA/total se resuelve en el pie; NO asumas que es neto+21% (en cigarrillos el precio ya trae impuestos internos y percepción IIBB embebidos). Si el renglón se factura por bulto, este es el precio DEL BULTO.' },
          esDescuento: {
            type: 'boolean',
            description: 'true si el renglón NO es mercadería sino una REBAJA sobre otro renglón: descripción tipo "Desc. 42.86% - MANOS NEGRAS Malbec CJ x6", "Descuento", "Bonificación s/ item 4", y casi siempre con importe NEGATIVO. Estos renglones no entran al stock: son plata que se resta del renglón que nombran. Un renglón de mercadería con precio 0 NO es descuento, es mercadería sin cargo.',
          },
          bonificacionPct: {
            type: ['number', 'null'],
            description: 'Porcentaje de la columna BONIF / BONIFICACIÓN / % BON / DTO de ESE renglón, si existe. 100 = renglón sin cargo (mercadería bonificada). Poné null si el comprobante no tiene esa columna o el renglón no tiene bonificación. NO confundas con el descuento general del pie.',
          },
          unidadesPorBulto: {
            type: ['number', 'null'],
            description: 'Cuántas unidades sueltas trae cada bulto de ESTE renglón, si la descripción o la columna de unidad lo dicen: "CORONA 355 X 24B" → 24; "PACK X 6" → 6; "CAJA X 12" → 12; "CJ x 6" → 6; "x24u" → 24. Si el renglón se vende por unidad suelta, o no hay forma de saberlo, poné null. NO lo deduzcas del tamaño del envase (355cc no es 355 unidades) ni lo inventes.',
          },
        },
        required: ['codigo', 'descripcion', 'cantidad', 'precio', 'unidadesPorBulto'],
        additionalProperties: false,
      },
    },
    // Transcripción CRUDA del pie, antes de mapear (defensa contra permutación).
    pieLiteral: {
      type: 'array',
      description: 'Transcripción CRUDA del pie, etiqueta por etiqueta, en el orden del papel, SIN interpretar. Marcá eco=true si una etiqueta repite el MISMO valor que otra ya listada (ej IMPUESTOS = SUB TOTAL).',
      items: {
        type: 'object',
        properties: {
          etiqueta: { type: 'string' },
          valor: { type: 'number' },
          eco: { type: 'boolean' },
        },
        required: ['etiqueta', 'valor', 'eco'],
        additionalProperties: false,
      },
    },
    impuestos: {
      type: 'object',
      properties: {
        neto: { type: ['number', 'null'], description: 'Renglón rotulado SUB TOTAL / NETO / NETO GRAVADO / GRAVADO / IMPORTE NETO. Base del IVA. NO incluye IVA ni percepciones. En cigarrillos/bebidas puede NO coincidir con la suma de renglones (los internos van embebidos en el precio).' },
        iva: { type: ['number', 'null'], description: 'Renglón IVA discriminado en pesos (I.V.A / IVA INSC. / IVA 21% / IVA 10,5%). Es el crédito fiscal. Tomá el número IMPRESO, NO lo recalcules como 21% del neto. NUNCA una línea PER./PERCEPCIÓN.' },
        alicuotaIva: { type: 'number', description: 'Solo el % que acompaña a la línea de IVA (21 / 10.5 / 27), o 0 si no figura. Informativo; el costo NO depende de este número.' },
        percepcionIva: { type: ['number', 'null'], description: 'Renglón PER. DE IVA / PERCEP IVA / RG 5329 / RG 3337. Pago a cuenta de IVA (crédito, no costo).' },
        percepcionIibb: { type: ['number', 'null'], description: 'Renglón PER. DE IIBB / PERCEP ING BRUTOS / IIBB / ARBA / AGIP / DGR / SIRCREB. Pago a cuenta de IIBB (crédito, no costo). En cigarrillos suele ser el renglón MÁS GRANDE del pie después del total.' },
        impuestosInternos: { type: ['number', 'null'], description: 'Renglón propio IMP. INTERNOS / IMPUESTO INTERNO / IMPUESTO ADICIONAL DE EMERGENCIA (tabaco). Es COSTO no recuperable. Solo cuando aparece como línea rotulada; si está embebido en el precio (sin línea) va DENTRO de neto y este campo = 0/null.' },
        otros: { type: ['number', 'null'], description: 'Otros tributos con etiqueta e importe propios que no sean ninguno de los anteriores (sellos, tasas municipales) + el redondeo/DESCUENTO si hace falta para cerrar. NUNCA meter acá el SUB TOTAL, el IVA ni las percepciones.' },
        total: { type: ['number', 'null'], description: 'Renglón TOTAL / TOTAL CBTE / TOTAL A PAGAR / IMPORTE TOTAL. Ancla de la autoverificación (suele venir también en letras).' },
      },
      required: ['neto', 'iva', 'alicuotaIva', 'percepcionIva', 'percepcionIibb', 'impuestosInternos', 'otros', 'total'],
      additionalProperties: false,
    },
    // La etiqueta LITERAL que se usó para cada campo del pie (verificación por texto).
    // Strings no-nullables (usá '' si no hay etiqueta) para no pasar el límite de
    // campos con unión del structured output.
    etiquetas: {
      type: 'object',
      properties: {
        neto: { type: 'string', description: 'Etiqueta literal del neto, o "" si no hay' },
        iva: { type: 'string', description: 'Etiqueta literal del IVA, o ""' },
        percepcionIva: { type: 'string', description: 'Etiqueta literal de la percepción de IVA, o ""' },
        percepcionIibb: { type: 'string', description: 'Etiqueta literal de la percepción de IIBB, o ""' },
        impuestosInternos: { type: 'string', description: 'Etiqueta literal de impuestos internos, o ""' },
        otros: { type: 'string', description: 'Etiqueta literal de otros, o ""' },
        total: { type: 'string', description: 'Etiqueta literal del total, o ""' },
      },
      required: ['neto', 'iva', 'percepcionIva', 'percepcionIibb', 'impuestosInternos', 'otros', 'total'],
      additionalProperties: false,
    },
    notasManuscritas: { type: ['string', 'null'], description: 'Anotaciones a mano relevantes (ej desglose de sabores/cantidades)' },
    dudas: {
      type: 'array',
      description:
        'Preguntas para el operador sobre TODO lo que no puedas leer con total seguridad: un número borroso, una cantidad ambigua, letra manuscrita, un código cortado, un total que no cierra con los renglones. NO adivines esos datos: preguntá. Si está todo claro, devolvé un arreglo vacío.',
      items: {
        type: 'object',
        properties: {
          pregunta: { type: 'string', description: 'La pregunta concreta en español para que la persona la responda mirando el papel (ej "¿La cantidad del renglón 3 dice 12 o 72?")' },
          referencia: { type: ['string', 'null'], description: 'A qué se refiere: renglón y producto, o el dato del pie (ej "renglón 3: Fernet 750" / "percepción IIBB")' },
        },
        required: ['pregunta', 'referencia'],
        additionalProperties: false,
      },
    },
  },
  required: ['proveedor', 'comprobante', 'items', 'pieLiteral', 'impuestos', 'etiquetas', 'notasManuscritas', 'dudas'],
  additionalProperties: false,
} as const;

// La IA elige, para cada renglón sin match, cuál de los candidatos del catálogo
// es el mismo producto (o null si ninguno lo es claramente).
const ESQUEMA_SUGERENCIAS = {
  type: 'object',
  properties: {
    elecciones: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          indice: { type: 'number', description: 'Índice del renglón tal como se lo pasé' },
          sku: { type: ['string', 'null'], description: 'SKU del candidato que es el MISMO producto, o null si ninguno lo es con seguridad' },
          motivo: { type: 'string', description: 'En pocas palabras por qué, para que la persona confirme' },
        },
        required: ['indice', 'sku', 'motivo'],
        additionalProperties: false,
      },
    },
  },
  required: ['elecciones'],
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
  private readonly log = new Logger(ListasService.name);

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
  async analizarComprobanteFoto(archivo: { buffer: Buffer; mimetype: string; originalname?: string }, aclaraciones?: string) {
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
    // Límite de la IA: 32 MB por PDF. Si se pasa, avisamos claro en vez de un 500.
    if (esPdf && archivo.buffer.length > 32 * 1024 * 1024) {
      throw new BadRequestException('El PDF es muy pesado (máx. 32MB). Mandalo comprimido o sacale una foto.');
    }

    // Guardamos el comprobante original en el bucket privado: cuando se registre
    // la factura queda vinculado y se puede volver a ver siempre. Best-effort.
    let archivoUrl: string | null = null;
    try {
      const ext = esPdf ? 'pdf' : (archivo.mimetype.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
      const ruta = `facturas/${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}.${ext}`;
      const { error: errSubida } = await this.db.storage
        .from('comprobantes')
        .upload(ruta, archivo.buffer, { contentType: esPdf ? 'application/pdf' : archivo.mimetype });
      if (!errSubida) archivoUrl = ruta;
    } catch {
      /* sin adjunto no se frena la lectura */
    }

    const claude = new Anthropic();
    const contenido: Anthropic.ContentBlockParam[] = [
      esPdf
        ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: archivo.buffer.toString('base64') } }
        : { type: 'image', source: { type: 'base64', media_type: mediaType!, data: archivo.buffer.toString('base64') } },
      {
        type: 'text',
        text:
          'Este es un comprobante de COMPRA argentino de un almacén (factura A/B/C, remito o ticket; puede ser una foto de celular). El pie de impuestos puede estar denso o desalineado (típico en cigarrillos, bebidas y otros regímenes especiales). Seguí estos pasos EN ORDEN.\n\n' +
          'PASO 1 — Encabezado y renglones. Extraé emisor + CUIT, tipo/número/fecha/condición de venta y TODOS los renglones: código, descripción (que EMPIECE por la marca cuando se vea), cantidad y precio unitario de la columna PRE.UNIT tal cual figura. NO uses PRE.VTA.PUBLICO ni la columna IMPORTE.\n\n' +
          'PASO 1 QUATER — Renglones de descuento. Muchas facturas traen, JUSTO DEBAJO del renglón de mercadería, otro renglón que es una rebaja sobre ese: "Desc. 42.86% - MANOS NEGRAS Malbec CJ x6", con importe NEGATIVO. Marcá esos con esDescuento=true y copiá el importe como viene, en negativo. NO son mercadería y NO entran al stock. Repetí la descripción completa tal cual, incluyendo el nombre del producto que descuentan, porque es lo único que permite saber a qué renglón se aplica. Un renglón de mercadería con precio 0,00 NO es un descuento: es mercadería sin cargo (bonificada).\n\n' +
          'PASO 1 TER — Bonificaciones. Es MUY común que el mismo producto aparezca DOS veces: un renglón con cargo y otro sin cargo (bonificado). Si hay columna BONIF / % BON / DTO, copiá su valor en bonificacionPct del renglón; 100 significa que ese renglón no se paga. El precio de lista suele estar impreso igual en los dos renglones, así que sin la bonificación es imposible distinguirlos: no la omitas.\n\n' +
          'PASO 1 BIS — Bultos. Muchos renglones se facturan POR BULTO (caja, pack, display) y no por unidad suelta. Es la diferencia entre cargar 84 cajones y cargar 2.016 botellas. Si la descripción o alguna columna dice cuántas unidades trae el bulto —"CORONA 355 X 24B" son 24, "PACK X 6" son 6, "CAJA X 12" son 12, "CJ x 6" son 6, "CJx12" son 12, "BOX X 6" son 6— ponelo en unidadesPorBulto de ESE renglón. Si el renglón es por unidad suelta, o no se puede saber, poné null y NO lo adivines: el tamaño del envase (355cc, 750cc, 1,5L) NUNCA es la cantidad de unidades del bulto.\n\n' +
          'PASO 2 — Transcribí el PIE literal en pieLiteral, ANTES de mapear nada. Leé el pie y listá CADA etiqueta con el número que tiene al lado, exactamente como aparece, sin reordenar y sin interpretar. Ej: "SUB TOTAL = 758055.34", "I.V.A INSC. = 48158.83", "PER. DE IVA = 43075.45", "PER. DE IIBB = 205121.18", "DESCUENTO = -0.58", "TOTAL = 1054410.80". Si una etiqueta repite el MISMO valor que otra ya listada (ej "IMPUESTOS" con el mismo número que "SUB TOTAL"), transcribila igual y marcala eco=true.\n\n' +
          'PASO 3 — Mapeá cada etiqueta a su campo por el SIGNIFICADO del texto en español, NUNCA por su posición ni por el orden. Guardá en "etiquetas" la etiqueta literal que usaste para cada campo.\n' +
          '  neto ← SUB TOTAL / NETO / NETO GRAVADO / GRAVADO\n' +
          '  iva ← I.V.A / IVA INSC. / IVA 21% (el IVA discriminado, crédito fiscal)\n' +
          '  alicuotaIva ← el % que acompaña al IVA (21 / 10.5 / 27)\n' +
          '  percepcionIva ← PER. DE IVA / PERCEP IVA / RG 5329 / RG 3337\n' +
          '  percepcionIibb ← PER. DE IIBB / PERCEP ING BRUTOS / IIBB / ARBA / AGIP / SIRCREB\n' +
          '  impuestosInternos ← IMP. INTERNOS / IMPUESTO INTERNO / IMPUESTO ADICIONAL DE EMERGENCIA, SOLO si es una línea propia rotulada\n' +
          '  otros ← cualquier OTRO tributo con etiqueta e importe propios (sellos, tasas) + redondeo/DESCUENTO si hace falta para cerrar\n' +
          '  total ← TOTAL / TOTAL CBTE / TOTAL A PAGAR\n' +
          'REGLAS DURAS: "PER."/"PERCEPCIÓN" es SIEMPRE percepción, JAMÁS el IVA discriminado. Una etiqueta = un solo campo. Una etiqueta con eco=true (mismo valor que otra ya mapeada) NO se vuelve a sumar en ningún campo.\n\n' +
          'PASO 4 — AUTOVERIFICACIÓN OBLIGATORIA. Calculá S = neto + iva + percepcionIva + percepcionIibb + impuestosInternos + otros y compará con total. Si |S − total| ≤ max(1, 0,5% de total): cierra, OK. Si NO cierra: NO inventes. Reasigná los valores de pieLiteral hasta encontrar el mapeo que hace cerrar la identidad (el error más común es cruzar PER. DE IVA con el IVA discriminado, o meter el SUB TOTAL en otros). El TOTAL es tu ancla; leelo con cuidado (viene también en letras). Si tras reintentar sigue sin cerrar, dejá tu mejor lectura y AGREGÁ una duda indicando qué etiqueta del pie no pudiste asignar con seguridad.\n\n' +
          'PASO 5 — Renglones vs neto (régimen especial). En cigarrillos, bebidas con impuestos internos y similares, la suma de (cantidad × PRE.UNIT) NO tiene por qué coincidir con el neto, y el IVA NO es el 21% del neto (puede ser mucho menor): el precio unitario ya trae impuestos internos y percepción IIBB embebidos. Para estos comprobantes NO fuerces suma(renglones) = neto y NO uses ese descuadre para "corregir" el pie ni para dudar. Preguntá por el descuadre de renglones SOLO si el comprobante claramente NO es de régimen especial (verdulería, limpieza) y la diferencia es grande.\n\n' +
          'PASO 6 — Dudas. Preguntá por cualquier número borroso, tapado o ambiguo, y por letra manuscrita. Si la identidad del PASO 4 no cerró, es OBLIGATORIO dejar una duda. Si hay anotaciones manuscritas relevantes, transcribilas en notasManuscritas. Es mejor preguntar que cargar un número equivocado.' +
          (aclaraciones && aclaraciones.trim()
            ? '\n\nEl operador ya revisó una primera lectura y te aclara lo siguiente (tenelo en cuenta y NO vuelvas a preguntar por esto): ' + aclaraciones.trim()
            : ''),
      },
    ];

    // Un tropiezo del lector (saturación, un corte) NO puede costarle a nadie
    // volver a sacar la foto: se reintenta una vez sola antes de darse por
    // vencido. Y el error REAL queda en el log: hasta ahora se lo tragaba el
    // catch, así que cuando alguien avisaba "no me lee el remito" no había con
    // qué diagnosticarlo.
    let datos: any;
    let ultimoError: any = null;
    for (let intento = 1; intento <= 2; intento++) {
      try {
        const respuesta = await claude.messages
          .stream({
            model: 'claude-sonnet-5',
            max_tokens: 16000,
            output_config: { format: { type: 'json_schema', schema: ESQUEMA_COMPROBANTE as any } },
            messages: [{ role: 'user', content: contenido }],
          })
          .finalMessage();
        const bloque = respuesta.content.find((b) => b.type === 'text');
        datos = JSON.parse(bloque && 'text' in bloque ? bloque.text : '{}');
        ultimoError = null;
        break;
      } catch (e: any) {
        ultimoError = e;
        const estado = e?.status ?? e?.statusCode;
        this.log.error(
          `lectura de comprobante falló (intento ${intento}/2) · estado=${estado ?? '?'} · tipo=${e?.error?.error?.type ?? e?.name ?? '?'} · ${String(e?.message ?? e).slice(0, 300)}`,
        );
        // 429/5xx y cortes de red son pasajeros: vale la pena insistir. Un
        // archivo que la API rechaza (imagen inválida, formato) no mejora
        // reintentando.
        const pasajero = estado === 429 || (typeof estado === 'number' && estado >= 500) || /timeout|socket|network|ECONNRESET|overloaded/i.test(String(e?.message ?? ''));
        if (!pasajero || intento === 2) break;
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
    if (ultimoError) {
      const msg = String(ultimoError?.message ?? ultimoError);
      const estado = ultimoError?.status ?? ultimoError?.statusCode;
      if (/image|too large|dimensions|media_type|invalid.*base64/i.test(msg)) {
        throw new BadRequestException('No pude leer la imagen: probá con una foto más nítida o el PDF de la factura.');
      }
      if (estado === 429 || /overloaded/i.test(msg)) {
        throw new BadRequestException('El lector está saturado en este momento. Esperá un minuto y volvé a subir la misma foto.');
      }
      throw new BadRequestException('La IA no pudo leer el comprobante, probá de nuevo en un momento.');
    }

    // Validación del pie: anti-permutación (por etiqueta), identidad y régimen
    // especial. Agrega dudas si algo no cierra; nunca rechaza el comprobante.
    const regimenEspecial = this.validarPie(datos);

    // proveedor: por CUIT exacto (solo dígitos), sino por similitud de nombre
    const cuit = (datos.proveedor?.cuit ?? '').replace(/\D/g, '');
    let proveedor: any = null;
    if (cuit) {
      const { data } = await this.db.from('proveedores').select('id, razon_social, cuit').eq('activo', true);
      proveedor = (data ?? []).find((p: any) => (p.cuit ?? '').replace(/\D/g, '') === cuit) ?? null;
    }
    if (!proveedor && datos.proveedor?.nombre) {
      // Buscamos por la primera palabra DISTINTIVA (no "Distribuidora", "Comercial",
      // "SRL"…): usar la genérica matcheaba proveedores equivocados.
      const GENERICAS = new Set(['distribuidora', 'distribuidor', 'comercial', 'mayorista', 'sociedad', 'srl', 'sa', 'sas', 'saci', 'saci', 'industrias', 'industria', 'import', 'export', 'importadora', 'grupo', 'the']);
      const token = datos.proveedor.nombre
        .split(/\s+/)
        .map((w: string) => w.toLowerCase().replace(/[^a-z0-9]/gi, ''))
        .find((w: string) => w.length >= 4 && !GENERICAS.has(w));
      if (token) {
        const { data } = await this.db
          .from('proveedores')
          .select('id, razon_social, cuit')
          .ilike('razon_social', `%${token}%`)
          .limit(1)
          .maybeSingle();
        proveedor = data ?? null;
      }
    }

    // productos: mismo matching que listas/pedidos (código prov → EAN → similitud)
    // El bulto y el descuento se resuelven en CÓDIGO, sobre la descripción, no
    // por lo que haya visto el modelo. Cada proveedor escribe la caja a su
    // manera y una lista de casos en el prompt se rompe con el próximo que
    // aparezca; acá se reconoce la FORMA y queda cubierto con tests. Lo que
    // haya leído el modelo se conserva solo cuando el parser no encuentra nada.
    const items: ItemPedidoExtraido[] = (datos.items ?? []).map((i: any) => {
      const delTexto = unidadesPorBulto(String(i.descripcion ?? ''));
      const delModelo = Number(i.unidadesPorBulto) > 1 ? Math.round(Number(i.unidadesPorBulto)) : null;
      if (delTexto && delModelo && delTexto !== delModelo) {
        this.log.warn(`bulto discordante en "${String(i.descripcion ?? '').slice(0, 60)}": texto=${delTexto} modelo=${delModelo} · gana el texto`);
      }
      return {
        codigo: i.codigo ?? null,
        descripcion: i.descripcion,
        cantidad: Number(i.cantidad) || 1,
        precio: Number(i.precio) || 0,
        unidadesPorBulto: delTexto ?? delModelo ?? null,
        bonificacionPct: Number(i.bonificacionPct) > 0 ? Number(i.bonificacionPct) : null,
        esDescuento: esRenglonDeDescuento({ descripcion: i.descripcion, precio: Number(i.precio) || 0 }) || !!i.esDescuento,
      } as any;
    });
    const propuesta = proveedor ? await this.matchear(items, proveedor.id) : items.map((i) => ({ ...i, match: null as Match }));

    // Los que no matchearon en firme: la IA razona sobre candidatos del catálogo y
    // sugiere el más probable para que el operador confirme ("¿es este?").
    const sinMatch = propuesta.filter((i) => !i.match);
    if (sinMatch.length) {
      const sugeridos = await this.sugerirMatchConIA(sinMatch.map((i) => ({ descripcion: i.descripcion, precio: i.precio })));
      for (const i of propuesta) {
        if (i.match) continue;
        const s = sugeridos.get(i.descripcion);
        if (s) {
          i.match = {
            sku: s.sku,
            nombre: s.nombre,
            costoActual: s.costo,
            variacionPct: s.costo ? Math.round(((i.precio - s.costo) / s.costo) * 1000) / 10 : null,
            metodo: 'ia',
            margenPct: null,
            sugerido: true,
            motivo: s.motivo,
          };
        }
      }
    }

    return {
      proveedor: {
        detectado: datos.proveedor ?? null,
        match: proveedor, // null = hay que darlo de alta o elegirlo a mano
      },
      comprobante: datos.comprobante ?? null,
      impuestos: datos.impuestos ?? null,
      archivoUrl, // ruta del original en el bucket: viaja con la factura al registrarla
      regimenEspecial, // true = IVA efectivo fuera de banda (cigarrillos/bebidas): el front no auto-suma IVA
      notasManuscritas: datos.notasManuscritas ?? null,
      dudas: Array.isArray(datos.dudas) ? datos.dudas : [],
      total: propuesta.length,
      conMatch: propuesta.filter((i) => i.match && !i.match.sugerido).length,
      sugeridos: propuesta.filter((i) => i.match?.sugerido).length,
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
      let avisoMedida: string | undefined;
      if (!match) {
        const alias = porAlias.get(normalizarAlias(item.descripcion));
        if (alias) {
          const medida = this.mismaMedida(item.descripcion, alias.producto?.nombre ?? '');
          if (medida.igual) match = this.armarMatch(alias.producto, alias.ultimo_costo, item.precio, 'alias', alias.margen_pct);
          else avisoMedida = medida.aviso;
        }
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
            const medida = this.mismaMedida(item.descripcion, prod.nombre);
            if (medida.igual) match = this.armarMatch(prod, prod.costo, item.precio, 'similitud', null);
            else avisoMedida = medida.aviso;
          }
        }
      }

      resultado.push({ ...item, match, avisoMedida });
    }
    return resultado;
  }

  // Valida el pie de impuestos: mapeo por ETIQUETA (defensa real contra permutación),
  // identidad neto+iva+percepciones+internos+otros = total, regla de eco, y detección
  // de régimen especial por alícuota efectiva. Muta datos.impuestos/datos.dudas.
  // Devuelve true si el comprobante es de régimen especial (IVA fuera de banda).
  private validarPie(datos: any): boolean {
    const imp = datos?.impuestos;
    if (!imp) return false;
    const etq = datos?.etiquetas ?? {};
    const dudas: any[] = Array.isArray(datos.dudas) ? datos.dudas : (datos.dudas = []);
    const norm = (s: any) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const num = (v: any) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
    const dudar = (pregunta: string) => { if (!dudas.some((d) => d.pregunta === pregunta)) dudas.push({ pregunta, referencia: 'pie de impuestos' }); };

    // regla eco: una etiqueta que repite el valor de otra ya listada no se suma dos
    // veces; si su valor quedó en "otros", se descuenta.
    for (const it of (Array.isArray(datos.pieLiteral) ? datos.pieLiteral : [])) {
      if (it?.eco && imp.otros != null && Math.abs(num(imp.otros) - num(it.valor)) < 0.5) imp.otros = 0;
    }

    // anti-permutación por etiqueta (chequeo primario)
    const etIva = norm(etq.iva);
    const etNeto = norm(etq.neto);
    const etPIva = norm(etq.percepcionIva);
    const etPIibb = norm(etq.percepcionIibb);
    if (imp.iva != null && /per|percep/.test(etIva)) dudar('El IVA quedó tomado de una línea de percepción; verificá el IVA discriminado del pie.');
    if (imp.neto != null && etNeto && /(per|percep|total)/.test(etNeto) && !/(sub|neto|gravado)/.test(etNeto)) dudar('El neto gravado quedó tomado de una línea que no dice SUB TOTAL / NETO; verificalo.');
    if (num(imp.percepcionIva) !== 0 && etPIva && !/(per|percep|rg)/.test(etPIva)) dudar('Revisá la percepción de IVA: la etiqueta leída no parece de percepción.');
    if (num(imp.percepcionIibb) !== 0 && etPIibb && !/(per|percep|iibb|ing|brut|arba|agip|sircreb|dgr)/.test(etPIibb)) dudar('Revisá la percepción de IIBB: la etiqueta leída no parece de percepción.');

    // identidad (chequeo secundario): componentes = total
    const total = imp.total != null ? num(imp.total) : null;
    if (total && total > 0) {
      const S = num(imp.neto) + num(imp.iva) + num(imp.percepcionIva) + num(imp.percepcionIibb) + num(imp.impuestosInternos) + num(imp.otros);
      if (Math.abs(S - total) > Math.max(1, total * 0.005)) {
        dudar('La suma del pie (neto + IVA + percepciones + internos + otros) no cierra con el total; revisá los importes.');
      }
    }

    // régimen especial: alícuota efectiva de IVA fuera de las bandas usuales
    const neto = num(imp.neto);
    const alicEf = neto > 0 && imp.iva != null ? num(imp.iva) / neto : null;
    const enBanda = alicEf != null && ((alicEf >= 0.095 && alicEf <= 0.115) || (alicEf >= 0.18 && alicEf <= 0.23) || (alicEf >= 0.26 && alicEf <= 0.28));
    return alicEf != null && !enBanda;
  }

  // Para los renglones que NO matchearon por código/alias/similitud: la IA razona
  // sobre una lista de candidatos del catálogo (traídos por similitud de texto) y
  // sugiere el más probable, para que el operador confirme ("¿es este?"). Devuelve
  // un mapa descripción→sugerencia. Best-effort: si algo falla, no sugiere nada.
  private async sugerirMatchConIA(
    descripciones: { descripcion: string; precio: number }[],
  ): Promise<Map<string, { sku: string; nombre: string; costo: number | null; motivo: string }>> {
    const salida = new Map<string, { sku: string; nombre: string; costo: number | null; motivo: string }>();
    if (!descripciones.length || !process.env.ANTHROPIC_API_KEY) return salida;
    try {
      // renglones con el mismo texto piden lo mismo: deduplicamos para no gastar
      // llamadas al RPC/IA de más (el mapa de salida se llavea por descripción).
      const unicas = [...new Set(descripciones.map((d) => d.descripcion))];
      // candidatos por renglón (trigram, hasta 12 cada uno)
      const conCandidatos = await Promise.all(
        unicas.map(async (descripcion) => {
          const { data } = await this.db.rpc('buscar_productos_similares', { p_texto: descripcion, p_limite: 12 });
          return { descripcion, candidatos: (data ?? []) as any[] };
        }),
      );
      const utiles = conCandidatos.filter((c) => c.candidatos.length > 0);
      if (!utiles.length) return salida;

      const payload = utiles.map((c, i) => ({
        indice: i,
        renglon: c.descripcion,
        candidatos: c.candidatos.map((p) => ({ sku: p.sku, nombre: p.nombre })),
      }));

      const claude = new Anthropic();
      const respuesta = await claude.messages
        .stream({
          model: 'claude-sonnet-5',
          max_tokens: 12000, // comprobante largo con muchos renglones sin match: que no se trunque el JSON
          output_config: { format: { type: 'json_schema', schema: ESQUEMA_SUGERENCIAS as any } },
          messages: [{ role: 'user', content: [{ type: 'text', text:
            'Sos el encargado de compras de un almacén argentino. Para cada renglón de una factura de proveedor te doy una lista de productos CANDIDATOS del catálogo. ' +
            'Elegí el sku del candidato que sea EXACTAMENTE el mismo producto del renglón (misma marca, variedad y tamaño/gramaje). ' +
            'Si ninguno es claramente el mismo, devolvé sku null: es peor vincular mal que dejarlo sin vincular, no fuerces. ' +
            'En "motivo" explicá en pocas palabras por qué, para que la persona lo confirme.\n\nRenglones y candidatos:\n' +
            JSON.stringify(payload) }] }],
        })
        .finalMessage();
      const bloque = respuesta.content.find((b) => b.type === 'text');
      const elecciones = JSON.parse(bloque && 'text' in bloque ? bloque.text : '{"elecciones":[]}').elecciones ?? [];

      for (const e of elecciones) {
        const grupo = utiles[e?.indice];
        if (e?.sku && grupo) {
          const cand = grupo.candidatos.find((p) => p.sku === e.sku);
          if (cand) salida.set(grupo.descripcion, { sku: cand.sku, nombre: cand.nombre, costo: cand.costo != null ? Number(cand.costo) : null, motivo: e.motivo ?? '' });
        }
      }
    } catch {
      /* best-effort: sin sugerencias de IA, el operador vincula a mano */
    }
    return salida;
  }

  // Medida del renglón: "200 GRS", "x185gr", "1,5 lt", "750cc". Se normaliza a
  // gramos o a mililitros para poder comparar.
  private medidaDe(texto: string): { valor: number; tipo: 'peso' | 'volumen' } | null {
    const t = String(texto ?? '').toLowerCase().replace(/,(\d)/g, '.$1');
    const re = /(\d+(?:\.\d+)?)\s*(kgs?|kilos?|grs?|gr|g|mls?|ml|cm3|cc|lts?|lt|litros?|l)(?![a-z0-9])/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(t))) {
      const valor = Number(m[1]);
      const unidad = m[2];
      if (!Number.isFinite(valor) || valor <= 0) continue;
      if (/^(kgs?|kilos?)$/.test(unidad)) return { valor: valor * 1000, tipo: 'peso' };
      if (/^(grs?|gr|g)$/.test(unidad)) return { valor, tipo: 'peso' };
      if (/^(lts?|lt|litros?|l)$/.test(unidad)) return { valor: valor * 1000, tipo: 'volumen' };
      return { valor, tipo: 'volumen' }; // ml, cc, cm3
    }
    return null;
  }

  // Guardián de MEDIDA. "MORRON LA BANDA 200 GRS" NO es "Morrones La Banda lata
  // x185gr": es otro artículo, con otro costo y otro precio. Vincularlos le carga
  // la mercadería y le recalcula el precio al producto equivocado, y el stock
  // real del que entró queda en cero. La medida es un dato duro, así que se
  // compara en código y no queda librado al parecido de los textos.
  //
  // Si alguno de los dos no declara medida, no se rechaza: no hay con qué
  // comparar y frenar todo sería peor.
  private mismaMedida(descripcionProveedor: string, nombreProducto: string): { igual: boolean; aviso?: string } {
    const a = this.medidaDe(descripcionProveedor);
    const b = this.medidaDe(nombreProducto);
    if (!a || !b || a.tipo !== b.tipo) return { igual: true };
    const dif = Math.abs(a.valor - b.valor) / Math.max(a.valor, b.valor);
    if (dif <= 0.02) return { igual: true }; // 2%: redondeos de etiqueta
    const unidad = a.tipo === 'peso' ? 'g' : 'ml';
    return {
      igual: false,
      aviso: `el papel dice ${a.valor}${unidad} y el producto del sistema es de ${b.valor}${unidad}`,
    };
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
