import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { SUPABASE } from '../supabase.provider';

// ============================================================
// EL CHAT DE LA FACTURA (8/10/2026). Pedido de Leandro: «las dudas que tenga
// Ana, que tengan un chat con IA; si algo está tomando mal la cuenta, que ella
// le pueda escribir ahí, que entienda la lógica y le modifique todo».
//
// La pantalla de carga manda la tabla como está (cada renglón con lo del papel
// y su cuenta), el pie y la conversación. La IA mira la foto original de la
// lectura, entiende lo que le dicen y devuelve cambios concretos: qué renglón,
// qué campo, qué valor y por qué. La pantalla los aplica y deja constancia de
// cada uno (quién, cuándo, antes y después), y la persona los puede deshacer.
//
// Las reglas que Ana le explica sobre un proveedor quedan guardadas
// (proveedor_reglas_lectura) y la IA las recibe en cada factura de ese
// proveedor. Se guardan solo cuando la persona toca «Guardar»: la IA propone.
// ============================================================

export const CAMPOS_RENGLON = ['bultos', 'unidadesPorBulto', 'sueltas', 'precio', 'descuentoPct', 'alicuotaIva', 'importe', 'entraComo', 'unidadesPorVenta', 'noAplicar', 'ingresa'] as const;
export const CAMPOS_PIE = ['neto', 'iva', 'percepcionIva', 'percepcionIibb', 'impuestosInternos', 'otros', 'total'] as const;

const ESQUEMA_CHAT = {
  type: 'object',
  properties: {
    respuesta: { type: 'string', description: 'Lo que le contestás a la persona: castellano rioplatense, corto, sin markdown.' },
    cambios: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          renglon: { type: 'integer', description: 'Número de renglón, empezando en 1, como lo ve la persona' },
          campo: { type: 'string', enum: [...CAMPOS_RENGLON] },
          valor: { type: ['number', 'string', 'boolean', 'null'] },
          motivo: { type: 'string', description: 'Por qué, en pocas palabras (lo que dice el papel o lo que pidió la persona)' },
        },
        required: ['renglon', 'campo', 'valor', 'motivo'],
        additionalProperties: false,
      },
    },
    cambiosPie: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          campo: { type: 'string', enum: [...CAMPOS_PIE] },
          valor: { type: 'number' },
          motivo: { type: 'string' },
        },
        required: ['campo', 'valor', 'motivo'],
        additionalProperties: false,
      },
    },
    reglaProveedor: { type: ['string', 'null'], description: 'Una regla de este proveedor para las próximas facturas, si la persona explicó una. Una oración. Si no, null.' },
  },
  required: ['respuesta', 'cambios', 'cambiosPie', 'reglaProveedor'],
  additionalProperties: false,
};

const INSTRUCCIONES = [
  'Sos el asistente de la pantalla de carga de facturas de compra de O.D.B (un almacén de Canning). Una persona de administración está revisando una factura de proveedor que leyó una IA. Recibís la tabla como está ahora, el pie, los controles, las reglas guardadas de ese proveedor y, si está, la foto o el PDF original.',
  'CÓMO SE CALCULA CADA RENGLÓN: unidades = bultos × unidadesPorBulto + sueltas. Cuenta = unidades × precio × (1 − descuentoPct/100). El renglón está bien leído si la cuenta da el importe impreso. El precio es por unidad. «entraComo» es cómo entra al stock: «unidades» (tal cual), «cajas» cuando el producto del catálogo es la caja de unidadesPorBulto (30 unidades = 3 cajas de 10), o «abiertas» cuando la factura cuenta cajas y el stock va por unidad (6 cajas ×4 = 24 unidades). Solo se puede cambiar si el renglón tiene unidadesPorBulto. «unidadesPorVenta» (10/10/2026, las Rodesias): cuando el producto del catálogo se vende en paquetes de N unidades (la caja trae 36 y se venden de a 3), poné unidadesPorVenta = N: entra al stock en paquetes (2 cajas × 36 = 72 unidades = 24 paquetes) y el costo es el de un paquete (precio por unidad × N). La cuenta del papel no cambia. Explicale a la persona en una línea cómo quedó («entran 24 paquetes de 3 a $X cada uno»). Los renglones de descuento (importe negativo) se aplican a un renglón de mercadería; con «noAplicar» se dejan sin aplicar.',
  'LO QUE NO INGRESÓ: si la persona dice que un producto no llegó o no ingresó, NO le cambies bultos, sueltas ni importe (la factura lo cobra igual y tiene que seguir cuadrando con el pie): mandá «ingresa» = false. El renglón sigue en la factura pero no entra al stock, y su plata no se reparte sobre los demás. «ingresa» = true lo vuelve a incluir.',
  'EL COSTO: cada renglón trae «costoFinalConIva» (lo que la persona ve como costo por unidad) y «comoSeCalcula» (la cuenta: neto por unidad, IVA de la alícuota y percepciones repartidas). Si te preguntan por un costo, explicalo con eso. El costo no se cambia directo: sale del papel y del pie; si está mal, corregí el dato del papel que lo causa. «bonificacionYaEnElPrecio» es una bonificación que la factura informa pero que ya está adentro del precio: no se descuenta otra vez.',
  'EL PIE: neto + iva + percepcionIva + percepcionIibb + impuestosInternos + otros tiene que dar el total, y los importes de los renglones tienen que sumar el neto.',
  'QUÉ HACÉS: si la persona te dice que algo está mal, o te pregunta por qué una cuenta no da, mirá el papel y la tabla y corregí con «cambios» (renglón, campo, valor, motivo) o «cambiosPie». Cambiá SOLO lo que dice el papel o lo que te dijo la persona: nunca inventes un número. Si no se puede saber, preguntale en «respuesta» y no cambies nada. Si te pregunta algo sin pedir un cambio, explicale y no cambies nada.',
  'REGLAS DEL PROVEEDOR: si la persona explica cómo factura este proveedor y sirve para las próximas facturas («en este proveedor el precio es por unidad», «UxB son las unidades por bulto»), proponela en «reglaProveedor», en una oración. La persona decide si la guarda.',
  'LO QUE DECÍS ES LO QUE SE APLICA: la pantalla aplica SOLO lo que mandás en «cambios» y «cambiosPie». Si en la respuesta decís que cambiaste, corregiste, pusiste, sacaste o marcaste algo, ese cambio TIENE que estar en «cambios» o «cambiosPie», con uno de los campos permitidos. Nunca digas que cambiaste algo que no mandaste. Si lo que hace falta no se puede expresar con esos campos, decilo así en la respuesta.',
  'CÓMO CONTESTÁS: castellano rioplatense, de vos, corto (una a tres oraciones), sin markdown ni listas. Decí qué cambiaste y si ahora cierra; si no cambiaste nada, por qué.',
].join('\n\n');

type Mensaje = { rol: 'usuario' | 'ia'; texto: string };

/**
 * Lo que vuelve de la IA, sin nada que la pantalla no pueda aplicar. Lo que se
 * saca NO desaparece en silencio: vuelve en «descartados» y la pantalla lo
 * muestra (22/10/2026: «sugerimos cambios pero no los aplica» — la IA decía
 * «listo» y el cambio se perdía sin aviso).
 */
export function validarRespuestaChat(crudo: any, renglones: number) {
  const respuesta = String(crudo?.respuesta ?? '').trim().slice(0, 1500) || 'Listo.';
  const descartados: { renglon: number | null; campo: string; porque: string }[] = [];
  const cambios = (Array.isArray(crudo?.cambios) ? crudo.cambios : [])
    .filter((c: any) => {
      const n = Number(c?.renglon);
      if (!Number.isInteger(n) || n < 1 || n > renglones) { descartados.push({ renglon: Number.isFinite(n) ? n : null, campo: String(c?.campo ?? ''), porque: 'ese renglón no existe en la factura' }); return false; }
      if (!(CAMPOS_RENGLON as readonly string[]).includes(String(c?.campo))) { descartados.push({ renglon: n, campo: String(c?.campo ?? ''), porque: 'ese dato no se puede cambiar desde el chat' }); return false; }
      return true;
    })
    .map((c: any) => ({ renglon: Number(c.renglon), campo: String(c.campo), valor: c.valor ?? null, motivo: String(c.motivo ?? '').slice(0, 300) }))
    .slice(0, 60);
  const cambiosPie = (Array.isArray(crudo?.cambiosPie) ? crudo.cambiosPie : [])
    .filter((c: any) => (CAMPOS_PIE as readonly string[]).includes(String(c?.campo)) && Number.isFinite(Number(c?.valor)) && Number(c.valor) >= 0)
    .map((c: any) => ({ campo: String(c.campo), valor: Number(c.valor), motivo: String(c.motivo ?? '').slice(0, 300) }))
    .slice(0, 10);
  const regla = typeof crudo?.reglaProveedor === 'string' ? crudo.reglaProveedor.trim().slice(0, 300) : '';
  return { respuesta, cambios, cambiosPie, reglaProveedor: regla.length >= 3 ? regla : null, descartados };
}

/**
 * ¿Lo que contestó la IA se puede aplicar tal como lo dice? Si no, el texto con el
 * que se le pide que lo corrija; null si está bien.
 */
export function motivoParaCorregir(salida: ReturnType<typeof validarRespuestaChat>): string | null {
  if (salida.descartados.length) {
    return `Estos cambios no se pueden aplicar: ${salida.descartados.map((d) => `renglón ${d.renglon ?? '?'} «${d.campo}» (${d.porque})`).join('; ')}.`;
  }
  const dice = /\b(cambi[éeo]|correg[íi]|puse|pas[ée]|sa?qu[ée]|marqu[ée]|ajust[ée]|actualic[ée]|dej[ée]|apliqu[ée]|agregu[ée]|modifiqu[ée])/i.test(salida.respuesta);
  if (dice && !salida.cambios.length && !salida.cambiosPie.length) {
    return 'En la respuesta decís que hiciste un cambio, pero no mandaste ninguno en «cambios» ni en «cambiosPie»: la pantalla no aplicó nada.';
  }
  return null;
}

@Injectable()
export class FacturaChatService {
  private readonly log = new Logger(FacturaChatService.name);
  constructor(@Inject(SUPABASE) private readonly db: SupabaseClient) {}

  // ---- reglas del proveedor ----

  async reglas(proveedorId: string) {
    if (!proveedorId) return [];
    const { data, error } = await this.db
      .from('proveedor_reglas_lectura')
      .select('id, regla, creada_en, creada_por, autor:usuarios!proveedor_reglas_lectura_creada_por_fkey(nombre)')
      .eq('proveedor_id', proveedorId)
      .eq('activa', true)
      .order('creada_en', { ascending: true })
      .limit(30);
    if (error) throw new BadRequestException(error.message);
    return ((data ?? []) as any[]).map((r) => ({ id: r.id, regla: r.regla, creadaEn: r.creada_en, autor: r.autor?.nombre ?? null }));
  }

  async guardarRegla(proveedorId: string, regla: string, usuarioId?: string) {
    const texto = String(regla ?? '').trim();
    if (!proveedorId) throw new BadRequestException('Falta el proveedor');
    if (texto.length < 3 || texto.length > 300) throw new BadRequestException('La regla tiene que tener entre 3 y 300 letras');
    const { data, error } = await this.db
      .from('proveedor_reglas_lectura')
      .insert({ proveedor_id: proveedorId, regla: texto, creada_por: usuarioId ?? null })
      .select('id')
      .single();
    if (error) throw new BadRequestException(error.message);
    return { ok: true, id: (data as any).id };
  }

  async desactivarRegla(id: string, usuarioId?: string) {
    const { error } = await this.db
      .from('proveedor_reglas_lectura')
      .update({ activa: false, desactivada_por: usuarioId ?? null, desactivada_en: new Date().toISOString() })
      .eq('id', id);
    if (error) throw new BadRequestException(error.message);
    return { ok: true };
  }

  // ---- quién cambió qué antes de registrar ----

  async guardarRevision(lecturaId: string, b: { proveedorId?: string; numero?: string; cambios?: unknown[] }, usuarioId?: string) {
    const cambios = Array.isArray(b?.cambios) ? b.cambios.slice(0, 500) : [];
    if (!cambios.length) return { ok: true, guardados: 0 };
    const lectura = /^[0-9a-f-]{36}$/i.test(String(lecturaId)) ? lecturaId : null;
    const { error } = await this.db.from('compras_revisiones').insert({
      lectura_id: lectura,
      proveedor_id: b?.proveedorId || null,
      numero: b?.numero ? String(b.numero).slice(0, 40) : null,
      usuario_id: usuarioId ?? null,
      cambios,
    });
    if (error) throw new BadRequestException(error.message);
    return { ok: true, guardados: cambios.length };
  }

  // ---- el chat ----

  /** El original de la lectura (foto o PDF), para que la IA mire el papel. */
  private async original(lecturaId: string): Promise<{ base64: string; mime: string } | null> {
    if (!/^[0-9a-f-]{36}$/i.test(String(lecturaId))) return null;
    const { data } = await this.db.from('lecturas_comprobante').select('resultado').eq('id', lecturaId).maybeSingle();
    const ruta = (data as any)?.resultado?.archivoUrl as string | undefined;
    if (!ruta) return null;
    const { data: archivo, error } = await this.db.storage.from('comprobantes').download(ruta);
    if (error || !archivo) return null;
    const ext = (ruta.split('.').pop() ?? '').toLowerCase();
    const mime = ext === 'pdf' ? 'application/pdf' : ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
    return { base64: Buffer.from(await archivo.arrayBuffer()).toString('base64'), mime };
  }

  async chat(
    lecturaId: string,
    b: { proveedorId?: string; proveedor?: string; comprobante?: unknown; tabla?: unknown[]; pie?: unknown; controles?: unknown; mensajes?: Mensaje[] },
    usuarioId?: string,
  ) {
    if (!process.env.ANTHROPIC_API_KEY) throw new BadRequestException('Falta la clave de la IA');
    const tabla = Array.isArray(b?.tabla) ? b.tabla : [];
    const mensajes = (Array.isArray(b?.mensajes) ? b.mensajes : [])
      .filter((m) => m && (m.rol === 'usuario' || m.rol === 'ia') && String(m.texto ?? '').trim())
      .slice(-10)
      .map((m) => ({ rol: m.rol, texto: String(m.texto).slice(0, 2000) }));
    if (!tabla.length) throw new BadRequestException('Falta la tabla de la factura');
    if (!mensajes.length || mensajes[mensajes.length - 1].rol !== 'usuario') throw new BadRequestException('Falta tu mensaje');

    const reglas = b?.proveedorId ? await this.reglas(b.proveedorId).catch(() => []) : [];
    const original = await this.original(lecturaId).catch(() => null);
    const datos = [
      `Proveedor: ${b?.proveedor ?? 'sin identificar'}. Comprobante: ${JSON.stringify(b?.comprobante ?? null)}.`,
      reglas.length ? `Reglas guardadas de este proveedor:\n- ${reglas.map((r) => r.regla).join('\n- ')}` : 'Este proveedor todavía no tiene reglas guardadas.',
      `Tabla (JSON): ${JSON.stringify(tabla).slice(0, 60_000)}`,
      `Pie (JSON): ${JSON.stringify(b?.pie ?? null)}`,
      `Controles (JSON): ${JSON.stringify(b?.controles ?? null)}`,
      original ? 'La foto o el PDF original va adjunto.' : 'No hay original adjunto: trabajá con la tabla.',
    ].join('\n\n');

    // la charla: los turnos anteriores en texto; el último lleva el estado actual y el papel
    const turnos: Anthropic.MessageParam[] = [];
    for (const m of mensajes.slice(0, -1)) {
      const role = m.rol === 'usuario' ? 'user' : 'assistant';
      if (!turnos.length && role === 'assistant') continue;
      turnos.push({ role, content: m.texto });
    }
    const ultimo = mensajes[mensajes.length - 1].texto;
    const adjunto: any[] = original
      ? [original.mime === 'application/pdf'
        ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: original.base64 } }
        : { type: 'image', source: { type: 'base64', media_type: original.mime, data: original.base64 } }]
      : [];
    turnos.push({ role: 'user', content: [...adjunto, { type: 'text', text: `${datos}\n\nLO QUE DICE LA PERSONA AHORA: ${ultimo}` }] as any });

    const t0 = Date.now();
    const claude = new Anthropic();
    const pedir = async (msgs: Anthropic.MessageParam[]) => {
      const r: any = await claude.messages
        .stream({
          model: 'claude-sonnet-5-5',
          system: [{ type: 'text', text: INSTRUCCIONES, cache_control: { type: 'ephemeral' } }],
          max_tokens: 16000,
          thinking: { type: 'adaptive' },
          output_config: { format: { type: 'json_schema', schema: ESQUEMA_CHAT as any }, effort: 'medium' as any },
          messages: msgs,
        } as any)
        .finalMessage();
      const bloque = (r.content ?? []).find((x: any) => x.type === 'text');
      let crudo: any = null;
      try { crudo = JSON.parse(bloque?.text ?? ''); } catch { /* abajo */ }
      return { crudo, texto: String(bloque?.text ?? ''), usage: r.usage ?? {} };
    };
    const primera = await pedir(turnos);
    if (!primera.crudo) throw new BadRequestException('La IA no pudo contestar. Probá de nuevo.');
    let salida = validarRespuestaChat(primera.crudo, tabla.length);
    let vueltas = 1;
    // «Resuelve bien en la conversación pero no después en el cambio» (Leandro,
    // 22/10/2026): si la IA dice que cambió algo y eso no viaja como un cambio
    // aplicable, se lo marca y se le pide una vez más, antes de contestarle a la
    // persona. Lo que siga sin poder aplicarse vuelve en «descartados» y se ve.
    const falla = motivoParaCorregir(salida);
    if (falla) {
      const segunda = await pedir([
        ...turnos,
        { role: 'assistant', content: primera.texto },
        { role: 'user', content: `${falla} Devolvé de nuevo la respuesta completa con TODOS los cambios que nombrás en «cambios» o «cambiosPie», usando solo estos campos de renglón: ${CAMPOS_RENGLON.join(', ')}; y del pie: ${CAMPOS_PIE.join(', ')}. Si algo no se puede expresar con esos campos, sacá de la respuesta que lo cambiaste y explicá qué hay que hacer a mano.` },
      ]).catch(() => null);
      if (segunda?.crudo) { salida = validarRespuestaChat(segunda.crudo, tabla.length); vueltas = 2; }
    }
    const u = primera.usage;
    this.log.log(`chat de factura ${lecturaId}: ${((Date.now() - t0) / 1000).toFixed(1)}s · ${salida.cambios.length} cambios · ${salida.descartados.length} descartados · ${vueltas} vuelta(s) · entrada ${u.input_tokens ?? '?'} · salida ${u.output_tokens ?? '?'}${usuarioId ? ` · usuario ${usuarioId}` : ''}`);
    return { ...salida, segundos: Math.round((Date.now() - t0) / 100) / 10 };
  }
}
