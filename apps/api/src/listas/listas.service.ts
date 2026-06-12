import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import * as XLSX from 'xlsx';
import { SUPABASE } from '../supabase.provider';

export type ItemExtraido = { codigo: string | null; descripcion: string; precio: number };

export type ItemPropuesta = ItemExtraido & {
  match: {
    sku: string;
    nombre: string;
    costoActual: number | null;
    variacionPct: number | null;
    metodo: 'codigo_proveedor' | 'codigo_barras' | 'similitud';
  } | null;
};

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
    contenido.push({
      type: 'text',
      text: 'Esta es una lista de precios de un proveedor de bebidas. Extraé todos los renglones de productos con su código (si existe), descripción y precio unitario. Ignorá encabezados, totales, condiciones comerciales y texto decorativo.',
    });

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

  // --- Matching contra el catálogo ---
  private async matchear(items: ItemExtraido[], proveedorId: string): Promise<ItemPropuesta[]> {
    const { data: catalogoProv } = await this.db
      .from('proveedor_productos')
      .select('codigo_proveedor, ultimo_costo, producto:productos(sku, nombre, costo)')
      .eq('proveedor_id', proveedorId);
    const porCodigoProv = new Map(
      ((catalogoProv ?? []) as any[])
        .filter((r) => r.codigo_proveedor)
        .map((r) => [r.codigo_proveedor.toLowerCase(), r]),
    );

    const resultado: ItemPropuesta[] = [];
    for (const item of items) {
      let match: ItemPropuesta['match'] = null;

      const porCodigo = item.codigo ? porCodigoProv.get(item.codigo.toLowerCase()) : null;
      if (porCodigo) {
        match = this.armarMatch(porCodigo.producto, porCodigo.ultimo_costo, item.precio, 'codigo_proveedor');
      } else if (item.codigo && /^\d{8,14}$/.test(item.codigo)) {
        const { data: cb } = await this.db
          .from('codigos_barras')
          .select('producto:productos(sku, nombre, costo)')
          .eq('codigo', item.codigo)
          .maybeSingle();
        if (cb?.producto) match = this.armarMatch(cb.producto, (cb.producto as any).costo, item.precio, 'codigo_barras');
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
            match = this.armarMatch(prod, prod.costo, item.precio, 'similitud');
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
    metodo: 'codigo_proveedor' | 'codigo_barras' | 'similitud',
  ): ItemPropuesta['match'] {
    const costo = costoActual != null ? Number(costoActual) : null;
    return {
      sku: producto.sku,
      nombre: producto.nombre,
      costoActual: costo,
      variacionPct: costo ? Math.round(((precioNuevo - costo) / costo) * 1000) / 10 : null,
      metodo,
    };
  }
}
