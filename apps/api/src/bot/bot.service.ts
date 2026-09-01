import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { emprolijarListado, nombreLimpio, saludoSegunHora, saludarConBienvenida, niegaPercepcion, respetuosoSinConfianza } from './prolijo';
import { oggCompleto } from './ogg';
import { SupabaseClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { Cron } from '@nestjs/schedule';
import { SUPABASE } from '../supabase.provider';
import { PedidosService } from '../pedidos/pedidos.service';
import { CatalogoService } from '../catalogo/catalogo.service';
import { ListasService } from '../listas/listas.service';
import { MercadoPagoService } from '../mercadopago/mercadopago.service';
import {
  HERRAMIENTAS_PEDIDOS,
  HERRAMIENTAS_PROVEEDORES,
  MAX_HISTORIAL,
  MAX_VUELTAS,
  MODELO_BOT,
  SYSTEM_PEDIDOS,
  SYSTEM_PROVEEDORES,
} from './agente-bot';

// solo dígitos; compara por los últimos 10 (ignora prefijos país/0/15)
const soloDigitos = (t: string) => (t ?? '').replace(/\D/g, '');
const cola10 = (t: string) => soloDigitos(t).slice(-10);

// límites operativos (se leen en runtime para poder ajustarlos por env sin recompilar)
// - mensajes por teléfono por hora: control de abuso y de costo de Opus
// - topes del pedido por WhatsApp: evita "reservas" de stock maliciosas
const mensajesHora = () => Number(process.env.ODB_BOT_MENSAJES_HORA ?? 30);
// Cuánto dura "la charla en curso". Pasado esto, un saludo abre una charla
// nueva y se contesta como corresponde.
const VENTANA_CHARLA_VIVA = 40 * 60_000;
const maxRenglonesBot = () => Number(process.env.ODB_BOT_MAX_RENGLONES ?? 15);
const maxUnidadesBot = () => Number(process.env.ODB_BOT_MAX_UNIDADES ?? 60);

// 5491122812200 → "11 2281-2200"
function bonitoTelefono(t: string): string {
  const d = String(t ?? '').replace(/\D/g, '');
  if (d.length === 13 && d.startsWith('549')) return `${d.slice(3, 5)} ${d.slice(5, 9)}-${d.slice(9)}`;
  return d ? `+${d}` : '';
}
import { cartelPrecios } from '../comun/cartel-precios';

@Injectable()
export class BotService {
  private readonly claude = new Anthropic();
  private readonly log = new Logger(BotService.name);
  // serializa los mensajes de un mismo teléfono (WhatsApp manda ráfagas y si
  // corren en paralelo se pisan la memoria de conversación entre sí)
  private readonly colas = new Map<string, Promise<unknown>>();
  // ventana deslizante de llegadas por teléfono para el límite horario
  private readonly llegadas = new Map<string, number[]>();
  constructor(
    @Inject(SUPABASE) private readonly db: SupabaseClient,
    private readonly pedidos: PedidosService,
    private readonly catalogo: CatalogoService,
    private readonly listas: ListasService,
    private readonly mercadopago: MercadoPagoService,
  ) {}

  // --- El agente conversacional (cerebro de las dos líneas) ---
  //
  // n8n solo transporta: WhatsApp → POST /bot/charla → respuesta → WhatsApp.
  // Acá corre Opus con razonamiento adaptativo y el loop de herramientas,
  // con memoria por (línea, teléfono) persistida en bot_conversaciones.
  async charla(dto: {
    linea?: 'pedidos' | 'proveedores';
    /** número del negocio al que llegó el mensaje (E.164). Resuelve la línea solo. */
    numeroLinea?: string;
    telefono: string;
    mensaje?: string;
    mensajeId?: string;
    archivoBase64?: string;
    mimeType?: string;
    archivoUrl?: string; // copia pública del archivo (comprobantes): va al aviso interno
    vistaPreviaDeVideo?: boolean; // el adjunto es el primer cuadro de un video, no una foto
  }) {
    // Patrón MetoGroup: el puente manda el número al que LLEGÓ el mensaje y el
    // sistema resuelve la línea. Así un mismo flujo de n8n sirve para cualquier
    // número sin tener la lógica del negocio adentro.
    let linea: 'pedidos' | 'proveedores' = dto.linea === 'proveedores' ? 'proveedores' : 'pedidos';
    if (dto.numeroLinea) {
      const { data: resuelta } = await this.db.rpc('linea_de_numero', { p_numero: String(dto.numeroLinea) });
      if (resuelta === 'proveedores' || resuelta === 'pedidos') linea = resuelta;
      else this.log.warn(`Número de línea desconocido: ${dto.numeroLinea} (se usa ${linea})`);
    }
    const telefono = (dto.telefono ?? '').replace(/\D/g, '');
    if (!telefono) throw new BadRequestException('Falta el teléfono');
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new BadRequestException('El bot necesita ANTHROPIC_API_KEY en apps/api/.env');
    }

    // límite por teléfono/hora: si se pasa, respuesta fija SIN gastar Opus
    if (this.superaLimite(telefono)) {
      return {
        respuesta:
          'Recibimos muchos mensajes tuyos en la última hora. Tomo tu consulta y doy aviso al sector correspondiente. Gracias por la paciencia.',
      };
    }

    // cola por conversación: el siguiente mensaje espera a que termine el anterior
    const clave = `${linea}:${telefono}`;
    const anterior = this.colas.get(clave) ?? Promise.resolve();
    const actual = anterior
      .catch(() => undefined)
      .then(() => this.charlaInterna(linea, telefono, dto));
    this.colas.set(clave, actual);
    try {
      return await actual;
    } catch (e: any) {
      // El modelo no respondió (sin crédito en Anthropic, sobrecarga, caída de red).
      // Antes esto era un 500 y el cliente quedaba en silencio sin que nadie se
      // enterara. Ahora: alerta al equipo (una por línea cada 10 min), el mensaje
      // queda guardado en el hilo para que lo vea quien atiende, y el cliente
      // recibe UN acuse honesto (no uno por mensaje).
      const msg = String(e?.message ?? e ?? '');
      const esFallaDelModelo = e?.status != null || /credit balance|overloaded|rate limit|ECONNRESET|ETIMEDOUT|fetch failed|529|anthropic/i.test(msg);
      if (!esFallaDelModelo) throw e;
      this.log.error(`bot sin poder responder a ${linea}/${telefono}: ${msg.slice(0, 200)}`);
      const texto = String(dto.mensaje ?? (dto.archivoBase64 ? '[archivo]' : '')).trim();
      let respuesta: string | null = null;
      try {
        const hace10 = new Date(Date.now() - 10 * 60_000).toISOString();
        const { data: prev } = await this.db.from('alertas_internas').select('id').eq('tipo', 'bot_caido').gte('creada_en', hace10).limit(1).maybeSingle();
        if (!prev) {
          const { data: cfg } = await this.db.from('lineas_whatsapp').select('avisar_proveedores_a').eq('linea', linea).eq('activa', true).limit(1).maybeSingle();
          await this.db.from('alertas_internas').insert({
            para_usuario: cfg?.avisar_proveedores_a ?? null,
            tipo: 'bot_caido',
            titulo: 'El bot de WhatsApp no puede responder',
            detalle: `${/credit balance/i.test(msg) ? 'Se acabó el crédito de Anthropic (recargar en console.anthropic.com). ' : ''}Error: ${msg.slice(0, 160)}. Mientras tanto hay que atender los chats a mano desde RESPONDE. Último: +${telefono}: "${texto.slice(0, 120)}"`,
            referencia: { linea, telefono, error: msg.slice(0, 200) },
          });
        }
        const { data: conv } = await this.db.from('bot_conversaciones').select('mensajes, acuse_caida_en').eq('linea', linea).eq('telefono', telefono).maybeSingle();
        const hist: any[] = Array.isArray(conv?.mensajes) ? conv!.mensajes : [];
        const acusoHace = conv?.acuse_caida_en ? Date.now() - new Date(conv.acuse_caida_en).getTime() : Infinity;
        if (acusoHace > 30 * 60_000) respuesta = 'Recibí tu mensaje. En este momento no lo puedo procesar automáticamente: tomo tu consulta y doy aviso al sector correspondiente.';
        await this.db.from('bot_conversaciones').upsert({
          linea, telefono,
          mensajes: [...hist, ...(texto ? [{ role: 'user', content: texto }] : []), ...(respuesta ? [{ role: 'assistant', content: respuesta }] : [])].slice(-40),
          actualizado_en: new Date().toISOString(),
          ...(respuesta ? { acuse_caida_en: new Date().toISOString() } : {}),
        }, { onConflict: 'linea,telefono' });
      } catch (e2: any) {
        this.log.warn(`no pude registrar la caída del bot: ${e2?.message ?? e2}`);
      }
      return { respuesta, caido: true, motivo: 'el modelo no respondió' } as any;
    } finally {
      if (this.colas.get(clave) === actual) this.colas.delete(clave);
    }
  }

  // Los teléfonos del equipo (dueños, backoffice) no se atienden: si alguien de
  // la casa escribe por la línea, es para Jaqueline, no para el bot.
  private equipoCache: { hasta: number; tels: Set<string> } | null = null;
  // ¿Es alguien de la casa? El bot no les contesta: en su momento le explicó a
  // un empleado que "no cuenta con la función de desactivarse".
  //
  // Esto se resolvía comparando el número contra los teléfonos de usuarios,
  // pero WhatsApp dejó de mandar el número: ahora llega un @lid, que no es un
  // teléfono. De 222 charlas de los últimos diez días, 217 llegaron así. O sea
  // que el filtro dejó de reconocer a nadie. Tres formas de saberlo, en orden:
  //   1. la marca manual `es_equipo` (la que nunca falla),
  //   2. el teléfono real que ya se aprendió para ese @lid,
  //   3. el identificador, por si todavía llega como número.
  private async esNumeroDelEquipo(identidad: string, telefonoReal?: string): Promise<boolean> {
    const { data: contacto } = await this.db
      .from('bot_contactos').select('es_equipo, telefono_real').eq('telefono', identidad).maybeSingle();
    if ((contacto as any)?.es_equipo) return true;

    if (!this.equipoCache || this.equipoCache.hasta < Date.now()) {
      const { data } = await this.db.from('usuarios').select('telefono').eq('activo', true);
      const tels = new Set<string>();
      for (const u of (data ?? []) as any[]) {
        const d = String(u.telefono ?? '').replace(/\D/g, '');
        if (d.length >= 8) tels.add(d.slice(-10));
      }
      this.equipoCache = { hasta: Date.now() + 10 * 60_000, tels };
    }
    // Un móvil argentino en E.164 tiene 13 dígitos (54 9 11 XXXX XXXX); un @lid
    // tiene más. Sin ese tope, los últimos 10 dígitos de un @lid podrían
    // coincidir con el teléfono de alguien de la casa y callar a un cliente.
    const candidatos = [telefonoReal, (contacto as any)?.telefono_real, identidad]
      .map((t) => String(t ?? '').replace(/\D/g, ''))
      .filter((d) => d.length >= 10 && d.length <= 13)
      .map((d) => d.slice(-10));
    return candidatos.some((d) => this.equipoCache!.tels.has(d));
  }

  // El teléfono marcable, cuando la carga del mensaje lo trae. Según la versión
  // del motor viaja en un campo u otro, así que se prueban todos y se registra
  // cuál sirvió: es el dato que permite volver a reconocer a la gente de la casa.
  private telefonoDeLaCarga(p: any): { numero: string; campo: string } | null {
    const candidatos: [string, any][] = [
      ['_data.key.remoteJidAlt', p?._data?.key?.remoteJidAlt],
      ['_data.key.participantAlt', p?._data?.key?.participantAlt],
      ['_data.senderPn', p?._data?.senderPn],
      ['_data.participantPn', p?._data?.participantPn],
      ['_data.remoteJidAlt', p?._data?.remoteJidAlt],
      ['participant', p?.participant],
      ['author', p?.author],
    ];
    for (const [campo, valor] of candidatos) {
      const d = String(valor ?? '').split('@')[0].replace(/\D/g, '');
      // un teléfono argentino con característica entra en 10-13 dígitos; un @lid
      // es mucho más largo y no debe confundirse con un número
      if (d.length >= 10 && d.length <= 13) return { numero: d, campo };
    }
    return null;
  }

  // Marcar (o desmarcar) una charla como "es alguien de la casa". Con el @lid
  // no siempre se puede deducir del número, así que tiene que poder decirse a
  // mano desde el panel, una vez, y quedar para siempre.
  async marcarEquipo(telefono: string, esEquipo: boolean, usuarioId?: string) {
    const clave = String(telefono ?? '').replace(/\D/g, '');
    if (!clave) throw new BadRequestException('Falta el teléfono');
    const { error } = await this.db.from('bot_contactos').upsert(
      { telefono: clave, es_equipo: esEquipo, actualizado_en: new Date().toISOString() },
      { onConflict: 'telefono' },
    );
    if (error) throw new BadRequestException(error.message);
    await this.db.from('auditoria').insert({
      usuario_id: usuarioId ?? null,
      accion: esEquipo ? 'contacto_marcado_equipo' : 'contacto_desmarcado_equipo',
      entidad: 'bot_contactos',
      entidad_id: clave,
    }).then(() => null, () => null);
    this.log.log(`${clave} ${esEquipo ? 'marcado' : 'desmarcado'} como gente de la casa`);
    return { ok: true, telefono: clave, esEquipo };
  }

  private superaLimite(telefono: string): boolean {
    const ahora = Date.now();
    const ventana = (this.llegadas.get(telefono) ?? []).filter((t) => ahora - t < 3_600_000);
    ventana.push(ahora);
    this.llegadas.set(telefono, ventana);
    // higiene: que el mapa no crezca sin límite
    if (this.llegadas.size > 5000) {
      for (const [k, v] of this.llegadas) {
        if (!v.some((t) => ahora - t < 3_600_000)) this.llegadas.delete(k);
      }
    }
    return ventana.length > mensajesHora();
  }

  private async charlaInterna(
    linea: 'pedidos' | 'proveedores',
    telefono: string,
    dto: { mensaje?: string; mensajeId?: string; archivoBase64?: string; mimeType?: string; archivoUrl?: string; vistaPreviaDeVideo?: boolean },
  ) {
    // idempotencia: si Meta/n8n reintentan el mismo mensaje, devolver la misma
    // respuesta sin volver a procesar (clave = id del mensaje de WhatsApp)
    const mensajeId = dto.mensajeId?.trim() || null;
    if (mensajeId) {
      const { data: previo } = await this.db
        .from('bot_mensajes')
        .select('respuesta')
        .eq('linea', linea)
        .eq('mensaje_id', mensajeId)
        .maybeSingle();
      if (previo?.respuesta) return { respuesta: previo.respuesta };
    }

    // 1) armar el texto del turno del usuario. Si vino un adjunto (factura),
    //    se procesa ACÁ (nunca pasa base64 por el modelo) y se inyecta el resultado.
    let texto = (dto.mensaje ?? '').trim();
    let imagenDelTurno: { base64: string; mime: string } | null = null;
    let documentoDelTurno: { base64: string } | null = null;
    if (dto.archivoBase64) {
      if (linea === 'proveedores') {
        try {
          const r = await this.recibirFactura({ telefono, archivoBase64: dto.archivoBase64, mimeType: dto.mimeType ?? 'image/jpeg' });
          texto += `\n[El proveedor envió un comprobante. El sistema lo procesó y quedó en la cola de revisión: proveedor "${r.proveedor}"${r.proveedorEnSistema ? '' : ' (NO reconocido en el sistema)'}, comprobante ${r.comprobante ?? 'sin número'}, total $${r.total ?? '?'}, ${r.renglones} renglones (${r.conMatch} matcheados).]`;
        } catch (e) {
          texto += `\n[El proveedor envió un archivo pero el sistema no pudo procesarlo: ${e instanceof Error ? e.message : 'error'}. Pedile que reenvíe la foto más nítida o el PDF.]`;
        }
      } else if (/^image\//.test(dto.mimeType ?? '')) {
        // el cliente manda una foto (un producto, una lista, una etiqueta): el
        // modelo la MIRA. Antes le contestábamos "no puedo ver fotos", que para
        // un negocio es vergonzoso.
        imagenDelTurno = { base64: dto.archivoBase64, mime: (dto.mimeType ?? 'image/jpeg').split(';')[0] };
        if (!texto) texto = dto.vistaPreviaDeVideo ? '[el cliente mandó un video]' : '[el cliente mandó esta foto]';
      } else if (/^application\/pdf/.test(dto.mimeType ?? '') && dto.archivoBase64.length < 20_000_000) {
        // un PDF (lista, catálogo, comprobante) el modelo lo LEE como documento;
        // el tope evita mandar al modelo un archivo gigante que no va a entrar
        documentoDelTurno = { base64: dto.archivoBase64 };
        if (!texto) texto = '[el cliente mandó este PDF]';
      } else {
        texto += '\n[El cliente envió un archivo que no es una imagen. Decile que tomás lo que mandó y que das aviso al sector correspondiente, sin prometer plazos ni quién responde.]';
      }
    }
    if (!texto) throw new BadRequestException('Mensaje vacío');

    // Si este turno trae un archivo, su rastro queda en la memoria PASE LO QUE
    // PASE: con el bot apagado o la charla derivada, el link viaja en el
    // historial y un turno futuro lo baja y lo lee. Sin esto pasó lo del
    // 2026-09-01: un proveedor mandó su catálogo en PDF con el bot apagado y,
    // al retomar, el bot le preguntó "¿de qué empresa me escribís?" con la
    // respuesta guardada en un documento que ya nadie miró.
    const marcaAdjunto = dto.archivoUrl && (imagenDelTurno || documentoDelTurno)
      ? ` [adjunto sin leer: ${dto.archivoUrl}]`
      : '';

    // 2) memoria de conversación (solo texto plano user/assistant, sin bloques internos)
    const { data: conv } = await this.db
      .from('bot_conversaciones')
      .select('mensajes, bot_activo, derivada_motivo, derivacion_vence_en, atendida_por, acuse_derivacion_en, actualizado_en')
      .eq('linea', linea)
      .eq('telefono', telefono)
      .maybeSingle();

    // Interruptor GENERAL de la línea (emergencia): si el bot está apagado para
    // toda la línea, se guarda el mensaje y no se contesta nada.
    const { data: lineaCfg } = await this.db
      .from('lineas_whatsapp')
      .select('bot_activo')
      .eq('linea', linea)
      .eq('activa', true)
      .limit(1)
      .maybeSingle();
    // Banco de pruebas: los números 549110000000x están reservados para
    // auditar el cerebro con la línea APAGADA. Nunca son clientes reales, esta
    // ruta no envía WhatsApp, y sin esto la única forma de auditar era prender
    // el bot para todo el mundo.
    const esBancoDePruebas = /^54911000000\d{1,3}$/.test(telefono);
    const botApagadoGlobal = lineaCfg?.bot_activo === false && !esBancoDePruebas;

    // La conversación está derivada a una persona: el mensaje se guarda en el
    // hilo (para que el que atiende lo vea) pero el bot NO contesta, así no le
    // pisa la respuesta al humano.
    if (botApagadoGlobal || (conv && conv.bot_activo === false)) {
      const hist: { role: 'user' | 'assistant'; content: string }[] = Array.isArray(conv?.mensajes) ? conv!.mensajes : [];
      const ahora = new Date();

      // Derivada a una persona pero nadie la tomó a tiempo: el bot vuelve solo.
      // Dejar a un cliente en silencio indefinido es peor que cualquier respuesta.
      const vence = conv?.derivacion_vence_en ? new Date(conv.derivacion_vence_en) : null;
      const nadieLaTomo = !botApagadoGlobal && vence && vence < ahora && !conv?.atendida_por;
      if (nadieLaTomo) {
        await this.db.from('bot_conversaciones').update({ bot_activo: true, resuelta_en: ahora.toISOString(), derivada_motivo: (conv?.derivada_motivo ?? '') + ' · retomada por el bot (nadie la tomó a tiempo)' })
          .eq('linea', linea).eq('telefono', telefono);
        // sigue de largo: se procesa como una charla normal, con el contexto de que hubo derivación
        texto = `${texto}\n[nota interna: esta persona había sido derivada a una persona del equipo y nadie la atendió a tiempo; retomás vos con cuidado, sin prometer plazos]`;
      } else {
        // Se guarda el mensaje para quien atiende y se contesta en modo ACOTADO:
        // TODO pasa por el modelo con los datos duros inyectados (identidad, pagos,
        // horarios de hoy). Antes había plantillas por regex y pisaban al modelo:
        // "botellas" disparaba la de identidad (/bot/ sin \b), la de horarios
        // contestaba "abierto ahora" a "¿a qué hora abren mañana?", y esas ramas
        // no dejaban nota para la persona que atiende. Ahora: una sola vía.
        const yaAcuso = !!conv?.acuse_derivacion_en;
        const preguntaIdentidad = /\b(bot|robot|ia|inteligencia artificial|persona real|humano|con qui[eé]n hablo|qui[eé]n sos|me le[eé]s|hay alguien|sos una persona)\b/i.test(texto);
        let respuesta: string | null = null;
        if (botApagadoGlobal) {
          respuesta = null; // línea apagada por el dueño: silencio total, es intencional
        } else {
          let datosHoy = '';
          try {
            const est: any = await this.estadoAtencion();
            const sucs = (est?.sucursales ?? []).map((x: any) => `${String(x.nombre).replace(/^Suc /, '')} (${x.direccion}): ${x.horario}${x.abierta_ahora ? ', abierta ahora' : ', cerrada ahora'}`).join('; ');
            datosHoy = `Hoy es ${est?.dia_semana ?? ''} ${est?.ahora ?? ''} (hora de Buenos Aires). Locales: ${sucs}. Reparto: ${est?.reparto?.motivo ?? ''}; los domingos no hay reparto. ${est?.retiro ?? ''}`;
          } catch { /* sin datos: el modelo no los inventa */ }
          // lo que YA quedó registrado para la persona del local: el bot lo dice
          // ("su propuesta ya está anotada: las 2 botellas hoy sin cargo") en vez de
          // repetir "se lo traslado" cada vez
          let yaRegistrado = '';
          try {
            const { data: notas } = await this.db.from('bot_notas_equipo').select('nota').eq('telefono', telefono).order('creada_en', { ascending: false }).limit(4);
            yaRegistrado = ((notas ?? []) as any[]).map((n) => String(n.nota).replace(/^\[en derivación\]\s*/, '')).filter(Boolean).join(' | ');
          } catch { /* sin notas */ }
          try {
            const prev = hist.slice(-8).map((m) => `${m.role === 'user' ? 'CLIENTE' : 'BOT'}: ${m.content}`).join('\n');
            const r = await this.claude.messages.create({
              model: MODELO_BOT, max_tokens: 450,
              system: `Sos el asistente automático de O.D.B Premium Market (Canning). Esta conversación YA está avisada al sector correspondiente${conv?.derivada_motivo ? ` (motivo de la derivación: ${conv.derivada_motivo})` : ''}; vos solo acusás recibo y contestás datos duros. Tratás de usted, sobrio, respetuoso, sin emojis, sin apodos, sin exclamaciones.
DATOS DUROS que sí podés afirmar: ${datosHoy || 'horarios no disponibles ahora: no los inventes'}. Pagos, transferencias, devoluciones y facturas: administración ya fue avisada por adentro y le responde por este mismo chat. NUNCA le des otro número de teléfono ni le digas que escriba a otro lado.
${yaRegistrado ? `YA REGISTRADO para la persona del local (no hace falta volver a "trasladarlo"; podés decirle al cliente que eso ya está asentado, reformulándolo): ${yaRegistrado}\n` : ''}REGLAS: máximo 3 líneas. (0) La cortesía se devuelve como una persona que atiende el teléfono: a "¿cómo andás?" / "¿todo bien?" → "Buen día, ¿cómo va? Todo bien por acá, gracias." y seguís — JAMÁS expliques que no podés responder eso ni que sos un asistente sin que te lo pregunten. (1) Primera línea = respuesta concreta a LO ÚLTIMO que escribió: si pregunta EXPLÍCITAMENTE si sos un bot/persona → "Soy Emilia, la asistente de O.D.B."; si propone algo (reposición, descuento, horario de entrega) → reformulá su propuesta con sus palabras ("su propuesta queda clara: las dos botellas hoy sin cargo") y decí que la evalúa la persona del local, sin confirmarla vos; si pregunta horario/dirección → contestá con los datos duros (si pregunta por MAÑANA, dá el horario habitual, no "abierto ahora"); si es un reclamo → una disculpa breve y sobria ("lamento el inconveniente") la primera vez, y contenelo sin prometer plazos, reintegros ni reposiciones. (2) "Una persona del local le responde por acá" se dice UNA sola vez en toda la derivación (mirá el historial): si ya lo dijiste, no lo repitas; decí algo nuevo o más corto. NO repitas textualmente ninguna oración que ya hayas dicho. NO digas "queda anotado", "en breve", "ya lo estamos viendo", "se lo traslado" (si ya está registrado, está registrado). Si el tema es de plata, administración ya fue avisada: decí que le confirman por acá y no des plazos ni números. No inventes nombres de personas ni datos que no estén acá.`,
              messages: [{ role: 'user', content: `HISTORIAL RECIENTE:\n${prev}\n\nÚLTIMO MENSAJE DEL CLIENTE: ${texto}` }],
            });
            respuesta = r.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('\n').trim() || null;
            // si el modelo repite lo mismo que el acuse anterior, no se manda
            const ultimoBot = [...hist].reverse().find((m) => m.role === 'assistant')?.content ?? '';
            if (respuesta && ultimoBot && respuesta.toLowerCase().replace(/\s+/g, ' ') === ultimoBot.toLowerCase().replace(/\s+/g, ' ')) respuesta = null;
          } catch {
            respuesta = yaAcuso ? null : 'Tomo tu mensaje y doy aviso al sector correspondiente.';
          }
          // TODO lo que dice el cliente en derivación queda como nota para quien atiende
          await this.db.from('bot_notas_equipo').insert({ linea, telefono, nota: `[en derivación] ${texto.slice(0, 300)}` }).then(() => null, () => null);
        }
        await this.db.from('bot_conversaciones').upsert(
          {
            linea,
            telefono,
            mensajes: [...hist, { role: 'user', content: texto + marcaAdjunto }, ...(respuesta ? [{ role: 'assistant', content: respuesta }] : [])].slice(-40),
            actualizado_en: ahora.toISOString(),
            ...(respuesta && !yaAcuso && !preguntaIdentidad ? { acuse_derivacion_en: ahora.toISOString() } : {}),
          },
          { onConflict: 'linea,telefono' },
        );
        return { respuesta, derivada: true, motivo: botApagadoGlobal ? 'bot apagado en toda la línea' : 'conversación en manos de una persona' };
      }
    }
    const historial: { role: 'user' | 'assistant'; content: string }[] = Array.isArray(conv?.mensajes) ? conv!.mensajes : [];

    // ---- LO QUE NO SE CONTESTA ----
    // Hoy (2026-08-21) el bot respondió "Perfecto." a "Perfecto", "Bien." a
    // "Bárbaro", "¿En qué puedo ayudarlo?" a un "Hola!!!" en medio de una charla,
    // y le explicó a alguien del equipo que "no cuenta con la función de
    // desactivarse". Un cierre no pide respuesta; un número del equipo no se
    // atiende. El mensaje queda igual en el hilo y en RESPONDE, solo que nadie
    // contesta.
    const callar = async (motivo: string) => {
      this.log.log(`silencio (${motivo}) para ${telefono}: "${texto.slice(0, 60)}"`);
      await this.db.from('bot_conversaciones').upsert({
        linea, telefono,
        mensajes: [...historial, { role: 'user', content: texto + marcaAdjunto }].slice(-MAX_HISTORIAL),
        actualizado_en: new Date().toISOString(),
      }, { onConflict: 'linea,telefono' }).then(() => null, () => null);
      return { respuesta: null, silencio: true, motivo } as any;
    };

    if (await this.esNumeroDelEquipo(telefono)) return callar('número del equipo');

    const ultimoMsgBot = [...historial].reverse().find((m) => m.role === 'assistant')?.content ?? '';
    const botDejoPregunta = /\?\s*$/.test(String(ultimoMsgBot).trim()) || /¿[^?]*\?/.test(String(ultimoMsgBot).slice(-160));
    const RE_CIERRE = /^(?:(?:dale|ok+|okey|oka|okis|listo|perfecto|b[aá]rbaro|genial|joya|buen[ií]simo|bueno|gracias+|muchas gracias|mil gracias|de nada|a vos|saludos|hablamos|nos vemos|un abrazo|abrazo|chau|ciao|hablamos despu[eé]s|despu[eé]s|(?:ja|je|ji){2,}|holis|bien)\b[\s!.,]*)+$|^[\s👍🙏🫶👌🏻🏼❤️🙂😊😂🤣✨🔥]+$/i;
    const RE_SI_NO = /^(s[ií]+|sisi|si si|no|nop|dale|ok|listo|bueno)\b[\s!.]*$/i;
    if (RE_CIERRE.test(texto.trim())) {
      // "sí" / "dale" / "ok" CONTESTAN una pregunta del bot: esos pasan. Los demás
      // cierres, y cualquier cierre sin pregunta pendiente, no se responden.
      if (!(botDejoPregunta && RE_SI_NO.test(texto.trim()))) return callar('cierre de la charla');
    }
    // "hola" suelto MIENTRAS la charla sigue viva: están por escribir lo que
    // quieren, y contestarles "¿en qué puedo ayudarlo?" es pisarlos.
    //
    // Pero la charla tiene que estar VIVA de verdad. Antes alcanzaba con que el
    // número hubiera escrito alguna vez, y como el historial no vence, cualquiera
    // que ya hubiera hablado con el bot —aunque fuera hace una semana— se quedaba
    // sin respuesta al saludar. Un "Hola" después de un rato largo no es alguien
    // que sigue una charla: es alguien que la empieza.
    const desdeElUltimoMensaje = conv?.actualizado_en
      ? Date.now() - new Date(conv.actualizado_en as string).getTime()
      : Infinity;
    const charlaViva = desdeElUltimoMensaje < VENTANA_CHARLA_VIVA;
    const RE_SALUDO_SUELTO = /^(hola+|buenas+|buen d[ií]a|buenas tardes|buenas noches)[\s!.,]*$/i;
    // Si el último que habló fue el cliente y también fue un saludo suelto, es
    // que ya nos callamos una vez y él sigue esperando. Saludar dos veces sin
    // recibir nada no es "estar por escribir lo que quiere": es que del otro
    // lado no contesta nadie.
    const ultimoDelHistorial = historial[historial.length - 1];
    const saludoSinRespuesta =
      ultimoDelHistorial?.role === 'user' && RE_SALUDO_SUELTO.test(String(ultimoDelHistorial.content).trim());
    if (RE_SALUDO_SUELTO.test(texto.trim()) && historial.length > 0 && charlaViva && !saludoSinRespuesta) {
      return callar('saludo en charla ya abierta');
    }

    // si este número ya se identificó antes (proveedor conocido), el bot lo sabe
    // desde el primer mensaje y no arranca tratándolo como cliente
    const { data: contacto } = await this.db.from('bot_contactos').select('tipo, nombre').eq('telefono', telefono).maybeSingle();
    const quien = contacto?.tipo === 'proveedor'
      ? `; este número ya está registrado como PROVEEDOR${contacto.nombre ? ` (${contacto.nombre})` : ''}: tratalo como tal`
      : '';
    const esProveedor = contacto?.tipo === 'proveedor';

    // Proveedor que manda flyers en ráfaga (hoy: 11 fotos seguidas, 11 "quedó
    // anotado" seguidos). Se acusa recibo UNA vez; el resto de la ráfaga queda
    // en el hilo y en RESPONDE sin respuesta. Compras lo mira en un solo lugar.
    if (imagenDelTurno && esProveedor) {
      const ultimoAck = /^(recib|quedó? (anotad|registrad)|tomamos nota|muchas gracias por la informaci)/i.test(String(ultimoMsgBot).trim());
      if (ultimoAck) {
        const { data: c2 } = await this.db.from('bot_conversaciones').select('actualizado_en').eq('linea', linea).eq('telefono', telefono).maybeSingle();
        const hace = c2?.actualizado_en ? Date.now() - new Date(c2.actualizado_en).getTime() : Infinity;
        if (hace < 30 * 60_000) return callar('ráfaga de flyers de proveedor (ya se acusó recibo)');
      }
    }

    // Archivos que llegaron con el bot apagado o derivado y nadie leyó: se
    // bajan del bucket y se adjuntan a ESTE turno; en la memoria quedan como
    // leídos para no bajarlos de nuevo. Los 2 más recientes alcanzan.
    const bloquesPendientes: any[] = [];
    {
      const RE_SIN_LEER = /\[adjunto sin leer: (https?:\/\/[^\]\s]+)\]/g;
      const pendientes: { url: string; idx: number }[] = [];
      historial.forEach((m, i) => {
        if (m.role !== 'user') return;
        for (const x of String(m.content).matchAll(RE_SIN_LEER)) pendientes.push({ url: x[1], idx: i });
      });
      for (const pen of pendientes.slice(-2)) {
        try {
          const r = await fetch(pen.url, { signal: AbortSignal.timeout(12000) });
          if (!r.ok) continue;
          const buf = Buffer.from(await r.arrayBuffer());
          if (buf.length > 15_000_000) continue;
          if (/\.pdf(\?|$)/i.test(pen.url)) {
            bloquesPendientes.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buf.toString('base64') } });
          } else if (/\.(jpe?g|png|webp)(\?|$)/i.test(pen.url)) {
            const mimeImg = /\.png(\?|$)/i.test(pen.url) ? 'image/png' : /\.webp(\?|$)/i.test(pen.url) ? 'image/webp' : 'image/jpeg';
            bloquesPendientes.push({ type: 'image', source: { type: 'base64', media_type: mimeImg, data: buf.toString('base64') } });
          } else continue;
          historial[pen.idx] = { ...historial[pen.idx], content: String(historial[pen.idx].content).replace(`[adjunto sin leer: ${pen.url}]`, '[adjunto ya leído]') };
          this.log.log(`adjunto pendiente leído para ${telefono}: ${pen.url.slice(-60)}`);
        } catch { /* si no se pudo bajar, queda marcado para el próximo turno */ }
      }
    }

    // la hora y el saludo correcto van en cada turno: el modelo no tiene reloj
    const ahoraBA = new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', weekday: 'long', hour: '2-digit', minute: '2-digit' });
    const horaBA = Number(new Date().toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', hour12: false }));
    const saludo = saludoSegunHora(horaBA);
    // mini-estado de la charla, calculado: el modelo no lleva bien la cuenta de lo
    // que ya dijo (ronda 5: "¿le armo el pedido?" en 8 de 10 respuestas, la
    // dirección pedida 3 veces, saludo reiniciado a mitad de charla)
    const dichoPorElBot = historial.filter((m) => m.role === 'assistant').map((m) => String(m.content));
    const cuenta = (re: RegExp) => dichoPorElBot.filter((t) => re.test(t)).length;
    const yaSaludo = dichoPorElBot.length > 0;
    const vecesOfrecioArmar = cuenta(/(le armo|armo el pedido|armamos el pedido|le dejo armado|dejemos cargado|dejo cargado|avanzamos|avanzo con|arme el pedido|le cotizo|lo cotizo|cerramos el pedido|¿.*pedido\?|¿lo confirmo\?)/i);
    const vecesPidioDireccion = cuenta(/(direcci[oó]n|calle y n[uú]mero)/i);
    const vecesDijoPersonaResponde = cuenta(/doy aviso al sector|aviso al sector correspondiente/i);
    const preguntasDelCliente = (texto.match(/\?/g) ?? []).length + (/\b(cu[aá]nto|cu[aá]ndo|d[oó]nde|qu[eé] tal|hasta qu[eé] hora|tienen|ten[eé]s|hay|se puede|me pod[eé]s|a qu[eé] hora)\b/i.test(texto) && !/\?/.test(texto) ? 1 : 0);
    const estado: string[] = [];
    estado.push(yaSaludo ? 'ya saludaste en esta charla: NO vuelvas a saludar ni a presentarte' : `primer mensaje de la charla: corresponde saludar una vez, con bienvenida: "${saludo}, te damos la bienvenida a O.D.B."`);
    if (vecesOfrecioArmar >= 1) estado.push(`ya ofreciste armar/cotizar el pedido ${vecesOfrecioArmar} vez/veces: no lo vuelvas a ofrecer; contestá y esperá`);
    if (vecesPidioDireccion >= 1) estado.push(`ya pediste la dirección ${vecesPidioDireccion} vez/veces: si no la dio, no la vuelvas a pedir en este mensaje salvo que él quiera cerrar`);
    if (vecesDijoPersonaResponde >= 2) estado.push(`ya dijiste ${vecesDijoPersonaResponde} veces que das aviso al sector: no lo repitas`);
    // El cliente que contesta con una palabra, manda la dirección o dice
    // "mandame esto" después de que el bot hizo varias preguntas NO quiere más
    // preguntas (hoy: cinco preguntas con opciones → "MALÍSIMA, cancelo").
    const preguntasDelBotAntes = (String(ultimoMsgBot).match(/¿/g) ?? []).length;
    const impaciente = preguntasDelBotAntes >= 1 && (texto.trim().length <= 25 || /\b(mand[aá]me|mandalo|env[ií]ame|dale|listo|eh+\??|ya est[aá]|as[ií] nom[aá]s|lo que tengas)\b|[😬🙄😤]/i.test(texto));
    if (impaciente && esProveedor === false) estado.push('el cliente ya no quiere más preguntas: NO preguntes nada más; asumí la opción más común de cada ítem que falte, mostrá el resumen con el total y cerrá con un único "¿Lo confirmo?"');
    if (preguntasDelCliente >= 2) estado.push(`este mensaje trae ${preguntasDelCliente} preguntas: contestá CADA una en una línea, en el orden en que las hizo; si un dato no lo tenés, decilo en su línea`);
    const contenidoDelTurno = (t: string): any => (bloquesPendientes.length
      ? [
          ...bloquesPendientes,
          ...(imagenDelTurno ? [{ type: 'image', source: { type: 'base64', media_type: imagenDelTurno.mime, data: imagenDelTurno.base64 } }] : []),
          ...(documentoDelTurno ? [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: documentoDelTurno.base64 } }] : []),
          { type: 'text', text: t },
        ]
      : imagenDelTurno
      ? [{ type: 'image', source: { type: 'base64', media_type: imagenDelTurno.mime, data: imagenDelTurno.base64 } }, { type: 'text', text: t }]
      : documentoDelTurno
      ? [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: documentoDelTurno.base64 } }, { type: 'text', text: t }]
      : t);
    const messages: Anthropic.MessageParam[] = [
      ...historial,
      { role: 'user', content: contenidoDelTurno(`${texto}\n\n[metadatos: telefono del chat = ${telefono}${quien}; ahora es ${ahoraBA} (hora de Buenos Aires); si corresponde saludar, el saludo correcto es "${saludo}". Estado de la charla: ${estado.join(' · ')}${bloquesPendientes.length ? `. OJO: el cliente mandó ${bloquesPendientes.length} archivo(s) ANTES (cuando no se podían abrir) y ahora los tenés adjuntos en este turno: leelos y usalos para responder; NO preguntes nada que esos archivos ya respondan` : ''}${imagenDelTurno ? (dto.vistaPreviaDeVideo ? '. El cliente mandó un VIDEO y lo que ves es su vista previa (el primer cuadro). Respondé sobre lo que se ve; si con eso no alcanza para responder con seguridad, acusá recibo en una línea y dejá nota_interna para que lo mire alguien de la casa. Jamás digas que no podés ver videos' : '. El cliente mandó una FOTO: mirala y respondé sobre lo que se ve. Si es un producto, buscalo en el catálogo por lo que leas en la etiqueta; si es un comprobante de pago, leé el MONTO y llamá derivar_pago con tipo "comprobante_enviado" y ese monto; si no se entiende, pedí que la saque de nuevo más nítida') : documentoDelTurno ? '. El cliente mandó un PDF: leelo y respondé sobre lo que dice. Si pregunta por productos de una lista, contestá con los del catálogo nuestro; si es un comprobante de pago, leé el MONTO y llamá derivar_pago con tipo "comprobante_enviado" y ese monto; si no se puede leer, pedí que lo reenvíe' : ''}]`) },
    ];

    // 3) loop del agente: Opus razona, pide herramientas, las ejecutamos y sigue
    const tools = linea === 'pedidos' ? HERRAMIENTAS_PEDIDOS : HERRAMIENTAS_PROVEEDORES;
    const system: Anthropic.TextBlockParam[] = [
      {
        type: 'text',
        text: linea === 'pedidos' ? SYSTEM_PEDIDOS : SYSTEM_PROVEEDORES,
        cache_control: { type: 'ephemeral' },
      },
    ];

    // lo último que dijo el bot antes de este mensaje: las guardas de crear_pedido
    // lo usan para saber si ya mostró el total y pidió confirmación
    const ultimoDelBot = [...historial].reverse().find((m) => m.role === 'assistant')?.content ?? '';
    const ultimosDelBot = [...historial].reverse().filter((m) => m.role === 'assistant').slice(0, 3).map((m) => String(m.content));
    const ultimosDelCliente = [...[...historial].reverse().filter((m) => m.role === 'user').slice(0, 6).map((m) => String(m.content)).reverse(), texto];
    const fallosDelTurno = new Map<string, number>();
    // una herramienta puede fijar la respuesta del turno ("Recibido." ante un comprobante)
    const respuestaFija: { texto?: string } = {};
    // todo lo que devolvieron las herramientas en este turno: los únicos
    // números que el bot tiene permitido decir
    const salidasDelTurno: string[] = [];
    let respuesta = '';
    let tokens = 0; // costo del mensaje (entrada+salida, todas las vueltas)
    // desglose para saber en qué se va la plata: entrada fresca ($), caché leída
    // (1/10), caché escrita (1,25x) y salida (5x la entrada). Va al log por turno.
    const uso = { entrada: 0, cacheLeida: 0, cacheEscrita: 0, salida: 0, llamadas: 0 };
    const sumarUso = (u: any) => {
      if (!u) return;
      uso.entrada += u.input_tokens ?? 0;
      uso.cacheLeida += u.cache_read_input_tokens ?? 0;
      uso.cacheEscrita += u.cache_creation_input_tokens ?? 0;
      uso.salida += u.output_tokens ?? 0;
      uso.llamadas += 1;
      tokens += (u.input_tokens ?? 0) + (u.output_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
    };
    // El modelo a veces escribe algo, DESPUÉS pide una herramienta, y recién en la
    // siguiente vuelta termina. Si solo se toma el texto de la última vuelta, lo
    // que dijo antes se pierde y el cliente recibe una respuesta que arranca por
    // la mitad ("Mientras tanto, puedo…"). Se junta el texto de todas las vueltas.
    const textosDelTurno: string[] = [];
    const herramientasDelTurno = new Set<string>();
    let vueltasReintento = 0;
    for (let vuelta = 0; vuelta < MAX_VUELTAS; vuelta++) {
      // si una herramienta ya falló 3 veces en este turno, la siguiente vuelta va
      // SIN herramientas: tiene que contestarle al cliente con palabras
      const atascado = [...fallosDelTurno.values()].some((n) => n >= 3);
      const r = await this.claude.messages.create({
        model: MODELO_BOT,
        // el pensamiento consume el mismo presupuesto que la respuesta: con
        // effort alto y 4096 la contestación salía vacía (probado). Con 8192
        // le sobra lugar para razonar Y escribir.
        max_tokens: 8192,
        thinking: { type: 'adaptive' },
        // Que piense antes de contestar: 'xhigh' es el escalón por encima del
        // default para trabajo con herramientas. Atender a un cliente con plata
        // y stock de por medio merece que razone, no que dispare la primera
        // respuesta. Se paga en tokens de salida, no en tiempo de nadie.
        output_config: { effort: 'xhigh' },
        system,
        tools: tools.length && !atascado ? tools : undefined,
        messages: this.conCache(messages),
      });
      sumarUso(r.usage);

      if (r.stop_reason === 'tool_use') {
        // ejecutar TODAS las herramientas pedidas y devolver los resultados juntos.
        // Si el modelo pide la MISMA herramienta con los MISMOS argumentos varias
        // veces en un turno (tool use paralelo degenerado), se ejecuta UNA sola
        // vez y se reusa el resultado: sin esto, un crear_pedido quintuplicado
        // creó 5 pedidos reales idénticos (visto en producción el 2026-07-21).
        messages.push({ role: 'assistant', content: r.content });
        // el texto que acompaña al pedido de herramienta también es parte de la respuesta
        for (const b of r.content) if (b.type === 'text' && b.text.trim()) textosDelTurno.push(b.text.trim());
        const resultados: Anthropic.ToolResultBlockParam[] = [];
        const vistos = new Map<string, Anthropic.ToolResultBlockParam>();
        for (const block of r.content) {
          if (block.type !== 'tool_use') continue;
          herramientasDelTurno.add(block.name);
          const clave = `${block.name}:${JSON.stringify(block.input)}`;
          const previo = vistos.get(clave);
          if (previo) {
            this.log.warn(`Herramienta ${block.name} duplicada en el mismo turno: reuso el resultado`);
            resultados.push({ ...previo, tool_use_id: block.id });
            continue;
          }
          const res = await this.ejecutarHerramienta(block, telefono, linea, { ultimoBot: ultimoDelBot, ultimosBot: ultimosDelBot, ultimosCliente: ultimosDelCliente, textoCliente: texto, fallos: fallosDelTurno, archivoUrl: dto.archivoUrl, fija: respuestaFija, salidas: salidasDelTurno });
          vistos.set(clave, res);
          resultados.push(res);
        }
        messages.push({ role: 'user', content: resultados });
        continue;
      }

      const final = r.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim();
      // La respuesta es lo que el modelo dice en la ÚLTIMA vuelta: después de la
      // herramienta suele redactar el mensaje completo de nuevo (con lo de antes
      // incluido), y concatenar duplica todo. El texto pre-herramienta se rescata
      // SOLO si la última vuelta vino vacía o es un cierre muy corto que no se
      // sostiene solo ("Mientras tanto, puedo…" sin antecedente).
      const previos = textosDelTurno.join('\n\n').trim();
      if (final && (final.length >= 60 || !previos)) {
        respuesta = final;
      } else if (final && previos) {
        respuesta = `${previos}\n\n${final}`;
      } else {
        respuesta = previos;
      }
      break;
    }
    if (!respuesta) {
      // Ronda 9: "Disculpe, no pude procesar su mensaje" a "¿qué pedidos tengo?" —
      // el loop terminó sin texto (tope de vueltas o el modelo se quedó en
      // herramientas). Antes del genérico, una vuelta más sin herramientas para
      // que conteste con lo que ya juntó.
      try {
        messages.push({ role: 'user', content: '[nota interna: ya no hay más herramientas disponibles en este turno. Con la información que tenés (resultados anteriores e historial), contestale al cliente ahora, en texto, de forma completa y concreta. Si algo no lo pudiste resolver, decilo con claridad y qué sigue.]' });
        const tFin = await this.regenerar(system, messages, 2048, sumarUso);
        if (tFin) respuesta = tFin;
      } catch (e: any) { this.log.warn(`cierre sin herramientas falló: ${e?.message ?? e}`); }
    }
    if (!respuesta) {
      respuesta = 'Disculpe, no pude procesar su mensaje. ¿Me lo repite, por favor?';
    }

    // Guardias de calidad sobre la respuesta final (salen de la auditoría):
    //  · G1: si es igual o casi igual a lo último que dijo el bot, es que ignoró
    //    lo nuevo del cliente → se pide una regeneración que conteste lo pendiente.
    //  · G5: si dice "queda anotado / se lo confirman / le responden" sin haber
    //    usado nota_interna ni derivar, es una promesa vacía → se deja la nota de
    //    verdad para que no lo sea.
    const ultimaDelBot = [...historial].reverse().find((m) => m.role === 'assistant')?.content ?? '';
    const norm = (t: string) => t.toLowerCase().replace(/\s+/g, ' ').trim();
    if (ultimaDelBot && norm(respuesta) === norm(ultimaDelBot) && vueltasReintento === 0) {
      this.log.warn(`respuesta repetida para ${telefono}: regenero contestando lo pendiente`);
      messages.push({ role: 'assistant', content: respuesta });
      messages.push({ role: 'user', content: '[nota interna: acabás de repetir textualmente tu mensaje anterior. Releé el ÚLTIMO mensaje del cliente, enumerá cada pregunta que hizo y contestá cada una; si un dato no lo tenés, decilo explícitamente. No repitas el pedido de dato ni la sugerencia anterior.]' });
      const t2 = await this.regenerar(system, messages, 2048, sumarUso).catch(() => null);
      if (t2) respuesta = t2;
      vueltasReintento++;
    }
    // G2: "el total se lo confirmo en un momento" es una promesa prohibida — el total
    // sale de cotizar_pedido EN este mensaje. Si lo prometió para después y no cotizó,
    // se regenera con la orden de cotizar ahora.
    if (/total[^.]{0,40}(en un momento|en breve|despu[eé]s|m[aá]s tarde|se lo (confirmo|paso))|se lo confirmo en un momento/i.test(respuesta)
        && !herramientasDelTurno.has('cotizar_pedido') && vueltasReintento === 0) {
      this.log.warn(`total prometido sin cotizar para ${telefono}: regenero cotizando`);
      messages.push({ role: 'assistant', content: respuesta });
      messages.push({ role: 'user', content: '[nota interna: prometiste el total para después. Eso está prohibido. Llamá a cotizar_pedido AHORA con los renglones que el cliente pidió y decí el total en este mismo mensaje. Si te falta la cantidad de algo, preguntá solo eso.]' });
      const r3 = await this.claude.messages.create({ model: MODELO_BOT, max_tokens: 3000, thinking: { type: 'adaptive' }, system, tools: tools.length ? tools : undefined, messages: this.conCache(messages) });
      sumarUso(r3.usage);
      if (r3.stop_reason === 'tool_use') {
        messages.push({ role: 'assistant', content: r3.content });
        const res3: Anthropic.ToolResultBlockParam[] = [];
        for (const b of r3.content) if (b.type === 'tool_use') { herramientasDelTurno.add(b.name); res3.push(await this.ejecutarHerramienta(b, telefono, linea, { ultimoBot: ultimoDelBot, ultimosBot: ultimosDelBot, ultimosCliente: ultimosDelCliente, textoCliente: texto, fallos: fallosDelTurno, archivoUrl: dto.archivoUrl, fija: respuestaFija, salidas: salidasDelTurno })); }
        messages.push({ role: 'user', content: res3 });
        const t4 = await this.regenerar(system, messages, 2048, sumarUso).catch(() => null);
        if (t4) respuesta = t4;
      } else {
        const t3 = this.textoFinal(r3);
        if (t3 && !this.tieneMeta(t3)) respuesta = t3;
      }
      vueltasReintento++;
    }
    // G5-bis (ronda 6): oraciones repetidas textualmente de los últimos 3 mensajes
    // del bot ("Para avanzar, necesitaría su nombre y el código" ×5, la fórmula
    // del reparto ×3, el aviso de edad ×3): suena a contestador. Se regenera UNA
    // vez pidiendo decir lo nuevo sin repetir lo ya dicho.
    const oracionesDe = (t: string) => t.split(/(?<=[.!?;:])\s+|\n+/).map((o) => norm(o).replace(/[^a-záéíóúñ0-9 ]/g, '').trim()).filter((o) => o.length >= 30);
    const yaDichas = new Set(ultimosDelBot.flatMap(oracionesDe));
    const repetidas = oracionesDe(respuesta).filter((o) => yaDichas.has(o));
    if (repetidas.length && vueltasReintento < 2) {
      this.log.warn(`oraciones repetidas para ${telefono} (${repetidas.length}): regenero sin repetir`);
      messages.push({ role: 'assistant', content: respuesta });
      messages.push({ role: 'user', content: `[nota interna: repetiste textualmente ${repetidas.length === 1 ? 'una oración' : repetidas.length + ' oraciones'} que ya dijiste en tus últimos mensajes: ${repetidas.map((o) => `"${o.slice(0, 80)}"`).join(' · ')}. Reescribí la respuesta diciendo solo lo NUEVO para este mensaje del cliente. Lo que ya le dijiste (dónde se retira, que se verifica la edad, quién confirma el envío, qué dato necesitás) no lo repitas; si el cliente no te dio un dato que ya pediste dos veces, no lo vuelvas a pedir: contestá lo que preguntó con lo que tenés, o derivá. Una sola pregunta como máximo.]` });
      try {
        const t8 = await this.regenerar(system, messages, 2048, sumarUso);
        if (t8) respuesta = t8;
      } catch (e: any) { this.log.warn(`regeneración por repetición falló: ${e?.message ?? e}`); }
      vueltasReintento++;
    }

    // G5 (invertida en ronda 5): un compromiso en el texto ("queda anotado", "dejo
    // asentado", "lo traslado", "ya lo puse en manos", "se lo confirman por acá",
    // "quedó marcado", "le dan prioridad") sin NINGUNA herramienta que lo respalde en
    // este turno NO sale así: se regenera una vez pidiendo que llame a nota_interna
    // (o derive) o que saque la promesa. Si aun así no hay respaldo, queda la red de
    // seguridad: la nota [auto] + alerta, para que la promesa no sea vacía.
    const RESPALDO = ['nota_interna', 'derivar_a_humano', 'registrar_proveedor', 'derivar_pago', 'cancelar_pedido', 'crear_pedido'];
    // "Registrado: recibe Martín en Juana de Arco…" sin una sola herramienta en el
    // turno (ronda 12): se quita la palabra, no el mensaje.
    if (/^\s*(registrad|anotad|asentad)\w*\s*:/i.test(respuesta) && !RESPALDO.some((h) => herramientasDelTurno.has(h))) {
      this.log.warn(`"Registrado:" sin herramienta para ${telefono}: se quita`);
      respuesta = respuesta.replace(/^\s*(registrad|anotad|asentad)\w*\s*:\s*/i, '');
    }
    const tieneRespaldo = () => RESPALDO.some((h) => herramientasDelTurno.has(h));
    const PROMESA = /(qued(a|an|ó|o)\s+(anotad|asentad|registrad|marcad|derivad|cancelad)|dej(o|é)\s+(anotad|asentad|registrad|marcad|la consulta|el pedido|constancia)|(lo|la|le|se lo)\s+(anoto|traslado|derivo|paso|elevo|dejo anotad|dejo registrad)|ya (lo|la) (puse|dej[eé]) en manos|en manos de (una persona|el equipo)|se lo confirm(a|an)|le confirm(a|an)|le responde(n)? por (este|acá)|le va(n)? a (responder|escribir|contestar|llamar)|se comunican con usted|le dan prioridad|para que (lo vean|lo revisen|le den)|aviso al (equipo|local))/i;
    // La fórmula del envío ("el horario y el costo se los confirma la persona que
    // coordina el reparto, por este chat") es un proceso fijo de la casa, no una
    // promesa puntual: no cuenta. Se saca esa oración antes de evaluar.
    // si en la charla ya hubo un código con "cancelado"/"confirmado", volver a decirlo
    // ("el que armamos quedó cancelado") es describir un hecho, no prometer
    const huboCancelacion = dichoPorElBot.some((t) => /cancelad/i.test(t) && /\b(DOM|RET|PICKUP)-[A-Z0-9]{4,8}\b/.test(t));
    const sinFormulaReparto = (t: string) => t
      .replace(/[^.\n]*coordina el reparto[^.\n]*/gi, '')
      // "el pedido DOM-XXXX quedó cancelado/confirmado" es un hecho (el código solo existe si la herramienta lo creó)
      .replace(/[^.\n]*\b(DOM|RET|PICKUP)-[A-Z0-9]{4,8}\b[^.\n]*/g, '')
      .replace(huboCancelacion ? /[^.\n]*cancelad[^.\n]*/gi : /$^/, '');
    // G6 (ronda 6): plazos e iniciativa que el bot no controla ("en breve le
    // confirman", "apenas lo tenga le aviso", "¿prefiere que le avise?"): el bot no
    // escribe por su cuenta ni sabe cuándo responde el equipo. Se regenera sin eso.
    const PLAZO = /\b(en breve|en un momento|en unos minutos|enseguida|apenas (lo|la) (tenga|sepa|confirme)|apenas se resuelva|ni bien|le aviso (cuando|apenas|en cuanto)|le escribo (cuando|apenas|en cuanto)|(prefiere|quiere) que le avise|en cuanto pueda volver a consultar)\b/i;
    if (PLAZO.test(sinFormulaReparto(respuesta)) && vueltasReintento === 0) {
      this.log.warn(`promesa de plazo/iniciativa para ${telefono}: regenero sin eso`);
      messages.push({ role: 'assistant', content: respuesta });
      messages.push({ role: 'user', content: '[nota interna: escribiste una promesa de plazo o de iniciativa propia ("en breve", "apenas lo tenga le aviso", "¿prefiere que le avise?"). Vos no escribís por tu cuenta ni sabés cuándo responde el equipo. Reescribí la respuesta sin esa promesa: decí lo que es cierto ahora (el dato, o que no lo tenés y que tomás la consulta y das aviso al sector correspondiente), y cerrá con una sola pregunta útil o sin pregunta.]' });
      try {
        const t7 = await this.regenerar(system, messages, 2048, sumarUso);
        if (t7) respuesta = t7;
        else respuesta = respuesta.replace(/[^.\n]*\b(en breve|en un momento|en unos minutos|enseguida|apenas (lo|la) (tenga|sepa|confirme)|apenas se resuelva|ni bien|le aviso (cuando|apenas|en cuanto)|le escribo (cuando|apenas|en cuanto)|(prefiere|quiere) que le avise|en cuanto pueda volver a consultar)\b[^.\n]*[.?!]?/gi, '').replace(/\n{3,}/g, '\n\n').trim() || respuesta;
      } catch (e: any) { this.log.warn(`regeneración por plazo falló: ${e?.message ?? e}`); }
      vueltasReintento++;
    }
    if (PROMESA.test(sinFormulaReparto(respuesta)) && !tieneRespaldo() && vueltasReintento === 0) {
      this.log.warn(`promesa sin respaldo para ${telefono}: regenero pidiendo nota_interna o sin la promesa`);
      messages.push({ role: 'assistant', content: respuesta });
      messages.push({ role: 'user', content: '[nota interna: en tu respuesta prometiste que algo "queda anotado / se lo trasladás / se lo confirman / le responden", pero en este turno NO llamaste a ninguna herramienta que lo haga. Elegí UNA: (a) llamá AHORA a nota_interna (o derivar_a_humano si corresponde) con el contenido concreto de lo que el cliente pidió, y después repetí tu respuesta; o (b) reescribí la respuesta sin esa promesa, diciendo solo lo que es cierto. Nunca digas que algo quedó registrado si no llamaste la herramienta en este mismo turno.]' });
      try {
        const r5 = await this.claude.messages.create({ model: MODELO_BOT, max_tokens: 3000, thinking: { type: 'adaptive' }, system, tools: tools.length ? tools : undefined, messages: this.conCache(messages) });
        sumarUso(r5.usage);
        if (r5.stop_reason === 'tool_use') {
          messages.push({ role: 'assistant', content: r5.content });
          const res5: Anthropic.ToolResultBlockParam[] = [];
          for (const b of r5.content) if (b.type === 'tool_use') { herramientasDelTurno.add(b.name); res5.push(await this.ejecutarHerramienta(b, telefono, linea, { ultimoBot: ultimoDelBot, ultimosBot: ultimosDelBot, ultimosCliente: ultimosDelCliente, textoCliente: texto, fallos: fallosDelTurno, archivoUrl: dto.archivoUrl, fija: respuestaFija, salidas: salidasDelTurno })); }
          messages.push({ role: 'user', content: res5 });
          const t6 = await this.regenerar(system, messages, 2048, sumarUso);
          if (t6) respuesta = t6;
        } else {
          const t5 = this.textoFinal(r5);
          if (t5 && !this.tieneMeta(t5)) respuesta = t5;
        }
      } catch (e: any) {
        this.log.warn(`regeneración por promesa falló: ${e?.message ?? e}`);
      }
      vueltasReintento++;
    }
    if (PROMESA.test(sinFormulaReparto(respuesta)) && !tieneRespaldo()) {
      this.log.warn(`promesa sin respaldo para ${telefono} (tras reintento): creo la nota interna`);
      const { data: autoPrev } = await this.db.from('bot_notas_equipo').select('id').eq('telefono', telefono).like('nota', '[auto]%').gte('creada_en', new Date(Date.now() - 10 * 60_000).toISOString()).limit(1).maybeSingle();
      if (!autoPrev) await this.db.from('bot_notas_equipo').insert({ linea, telefono, nota: `[auto] El bot prometió respuesta del equipo sin registrar nota. Último mensaje del cliente: ${texto.slice(0, 300)}` });
      const { data: cfg } = await this.db.from('lineas_whatsapp').select('avisar_proveedores_a').eq('linea', linea).eq('activa', true).limit(1).maybeSingle();
      await this.db.from('alertas_internas').insert({ para_usuario: cfg?.avisar_proveedores_a ?? null, tipo: 'nota_bot', titulo: `Consulta pendiente de +${telefono}`, detalle: texto.slice(0, 300), referencia: { linea, telefono } });
    }

    // A (ronda 8): "confirmo el pedido / queda cargado / ya está registrado" sin
    // que crear_pedido haya devuelto un código en ESTE turno es mentira. Se
    // regenera una vez con la verdad; si no se puede, se reemplaza la frase.
    const diceCargado = /(pedido (queda|quedó|ya está|está|ya quedó) (confirmado|cargado|registrado|armado|tomado)|confirmo (el|su) pedido|queda(n)? (cargado|registrado|confirmado)s? (el|su) pedido|ya está registrado|pedido confirmado|queda(n)?[^.]{0,40}\b(en|al) (el |su )?pedido\b|agregad[oa] al pedido)/i;
    const pedidoCreadoEnTurno = fallosDelTurno.get('__pedido_creado__') === 1 || /\b(DOM|RET|PICKUP)-[A-Z0-9]{4,8}\b/.test(respuesta);
    if (diceCargado.test(respuesta) && !pedidoCreadoEnTurno && vueltasReintento < 2) {
      this.log.warn(`dice pedido cargado sin crear_pedido exitoso para ${telefono}: regenero`);
      messages.push({ role: 'assistant', content: respuesta });
      messages.push({ role: 'user', content: '[nota interna: dijiste que el pedido está confirmado/cargado/registrado, pero en este turno crear_pedido NO devolvió ningún código: el pedido NO existe. Reescribí la respuesta diciendo la verdad: si faltó un dato, pedilo; si la herramienta falló y ya quedó la nota, decí que tomás el pedido y que das aviso al sector correspondiente para que lo dejen confirmado. Nunca digas "confirmado" ni "cargado" sin código DOM-/RET-.]' });
      const t10 = await this.regenerar(system, messages, 2048, sumarUso);
      if (t10) respuesta = t10;
      else {
        // OJO: no reemplazar la frase EN MEDIO de la oración. Hacerlo dejaba
        // engendros como "Le el pedido todavía no quedó cargado para retiro en
        // Sant Thomas:" — el cliente lee eso y el bot queda peor que si hubiera
        // mentido. Se tira la oración entera y se dice la verdad aparte.
        const sinMentira = respuesta
          .split(/(?<=[.!?])\s+|\n/)
          .filter((o) => !diceCargado.test(o))
          .join(' ')
          .replace(/\s{2,}/g, ' ')
          .trim();
        respuesta = [sinMentira, 'El pedido todavía no quedó cargado: doy aviso al sector correspondiente para dejarlo confirmado.']
          .filter(Boolean)
          .join(' ');
      }
      vueltasReintento++;
    }

    // E (ronda 9): post-proceso determinístico — una oración (≥30 caracteres) o
    // una pregunta de cierre (≥12) que ya apareció textual en los últimos 3
    // mensajes del bot se quita, salvo "¿Lo confirmo?" y salvo que sea todo el mensaje.
    {
      const normO = (o: string) => norm(o).replace(/[^a-záéíóúñ0-9 ¿?]/g, '').trim();
      const previas = new Set(ultimosDelBot.flatMap((t) => t.split(/(?<=[.!?])\s+|\n+/).map(normO)).filter((o) => o.length >= 12));
      const partes = respuesta.split(/(?<=[.!?])\s+|\n/);
      const filtradas = partes.filter((o) => {
        const n = normO(o);
        if (!n) return true;
        if (/lo confirmo\?/.test(n)) return true;
        const esPregunta = /\?$/.test(n);
        const repetida = previas.has(n) && (n.length >= 30 || (esPregunta && n.length >= 12));
        return !repetida;
      });
      const nueva = filtradas.join(' ').replace(/\s{2,}/g, ' ').trim();
      if (nueva && nueva !== respuesta.trim() && nueva.length >= 20) {
        this.log.log(`oraciones repetidas quitadas para ${telefono}: ${partes.length - filtradas.length}`);
        respuesta = nueva;
      }
    }

    // Fórmulas fijas que se dicen UNA vez por conversación (ronda 8: el aviso de
    // edad en 3 mensajes seguidos, la del reparto ×5): si ya se dijeron, la
    // oración que las repite se quita. Determinístico, sin llamada al modelo.
    const dichoAntes = (re: RegExp) => dichoPorElBot.some((t) => re.test(t));
    const quitarOracion = (t: string, re: RegExp) => t.split(/(?<=[.!?])\s+|\n/).filter((o) => !re.test(o)).join(' ').replace(/\s{2,}/g, ' ').trim();
    const RE_EDAD = /verifica(mos|n)?\s+(la\s+)?edad|mayor(es)? de (18|edad)/i;
    if (RE_EDAD.test(respuesta) && dichoAntes(RE_EDAD)) respuesta = quitarOracion(respuesta, RE_EDAD) || respuesta;
    // frases-marca de la casa: se dicen una vez y no vuelven (ronda 10: "coordina
    // el reparto" ×3 en una charla, "por este mismo chat" en 4 de 7 respuestas)
    const MULETILLAS: [RegExp, number][] = [
      [/coordina el reparto/i, 1],
      [/por este mismo chat/i, 1],
      [/doy aviso al sector|aviso al sector correspondiente/i, 2],
      [/se retiran? [uú]nicamente en|de ah[ií] salen los pedidos/i, 1],
      [/qued[oó]\s+(anotad|registrad|asentad)/i, 2],
      [/si prefiere no depender|puede retirar(lo)? sin costo|retirar en sant thomas \(castex/i, 1],
    ];
    for (const [re, tope] of MULETILLAS) {
      if (re.test(respuesta) && dichoPorElBot.filter((t) => re.test(t)).length >= tope && !/¿lo confirmo\?/i.test(respuesta)) {
        // nunca se poda una oración que trae un dato o contesta algo: en la ronda 11
        // este filtro decapitó justo la línea que respondía la pregunta del cliente
        // palabras propias del mensaje del cliente: si la oración las nombra, contesta algo
        const palabrasCliente = texto.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/\s+/).filter((w) => w.length >= 5 && !/^(cuando|donde|cuanto|puedo|quiero|tienen|tenes|hasta|entonces|tambien|porque|ustedes)$/.test(w));
        const traeDato = (o: string) => {
          if (/\$\s?\d|\d{1,2}[:.]\d{2}|\bno (llega|hay|tenemos|figura)\b|no lo tengo|no est[aá] cargad|cobertura|costo del env[ií]o|castex|juana de arco/i.test(o)) return true;
          const no = o.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
          return palabrasCliente.some((w) => no.includes(w));
        };
        const podado = respuesta.split(/(?<=[.!?])\s+|\n/).filter((o) => !(re.test(o) && !traeDato(o))).join(' ').replace(/\s{2,}/g, ' ').trim();
        if (podado.length >= 25 && podado !== respuesta) respuesta = podado;
      }
    }

    // C (ronda 7): con varias preguntas en un mensaje, el prompt no alcanza: un
    // verificador barato (Haiku) lista las preguntas que la respuesta NO contesta
    // (ni con el dato ni diciendo que no lo tiene) y se regenera una vez.
    if (preguntasDelCliente >= 1 && vueltasReintento < 2) {
      try {
        const chk = await this.claude.messages.create({
          model: 'claude-haiku-4-5',
          max_tokens: 300,
          system: 'Sos un verificador. Te dan el mensaje de un cliente de WhatsApp y la respuesta de un asistente. Listá las preguntas o pedidos concretos del cliente que la respuesta NO atiende: ni con el dato, ni diciendo explícitamente que no lo tiene o que lo ve una persona. Si todas están atendidas, devolvé una lista vacía. Sé estricto pero justo: una pregunta contestada con "no lo tengo cargado" cuenta como atendida.',
          messages: [{ role: 'user', content: `MENSAJE DEL CLIENTE:\n${texto}\n\nRESPUESTA DEL ASISTENTE:\n${respuesta}` }],
          output_config: { format: { type: 'json_schema', schema: { type: 'object', properties: { sin_responder: { type: 'array', items: { type: 'string' } } }, required: ['sin_responder'], additionalProperties: false } } },
        } as any);
        const t = (chk.content as any[]).find((b) => b.type === 'text')?.text ?? '{}';
        const faltan: string[] = (JSON.parse(t).sin_responder ?? []).filter((x: any) => typeof x === 'string' && x.trim());
        if (faltan.length) {
          this.log.warn(`preguntas sin responder para ${telefono}: ${faltan.join(' | ')} → regenero`);
          messages.push({ role: 'assistant', content: respuesta });
          messages.push({ role: 'user', content: `[nota interna: en tu respuesta quedaron sin contestar estas preguntas del cliente: ${faltan.map((f) => `"${f}"`).join(', ')}. Reescribí la respuesta completa contestando CADA una en su orden, antes de cualquier resumen o "¿lo confirmo?": con el dato si lo tenés por herramienta (precio, total, franja de reparto, horario), o diciendo en su línea que no lo tenés / que lo confirma la persona del local. Mantené lo que ya estaba bien. Sin ofrecer cerrar el pedido mientras haya preguntas abiertas.]` });
          const t9 = await this.regenerar(system, messages, 2048, sumarUso);
          if (t9) respuesta = t9;
          vueltasReintento++;
        }
      } catch (e: any) { this.log.warn(`verificador de preguntas falló: ${e?.message ?? e}`); }
    }

    // A (ronda 12): un total cerrado sin decir que el envío va aparte deja al
    // cliente creyendo que paga eso. Si el turno cotizó/creó pedido a domicilio
    // y el texto no lo aclara, se agrega la línea.
    const hablaDeEnvio = /\b(env[ií]o|domicilio|se lo mando|se lo llevamos|reparto)\b/i.test(respuesta) || /\b(env[ií]o|domicilio)\b/i.test(texto);
    const dioTotal = /total[^.\n]{0,40}\$?\s?\d{1,3}[.\s]?\d{3}/i.test(respuesta);
    if (dioTotal && hablaDeEnvio && !/(envío|envio)[^.\n]{0,40}(aparte|no est[aá] incluid|no incluye)|mercader[ií]a/i.test(respuesta)) {
      // La aclaración va al FINAL, no intercalada: el "[^.\n]{0,20}" del final
      // cortaba en cualquier lado y salió publicado "Necesito que me def (es el
      // total de la mercadería; el envío va aparte)ina estos puntos". Un
      // paréntesis en medio de una palabra es lo más feo que puede mandar.
      respuesta = `${respuesta.trimEnd()}\n\nEs el total de la mercadería; el envío va aparte.`;
      this.log.log(`aclaración de envío agregada al final para ${telefono}`);
    }

    // No empujar la compra cuando acabás de decir que no sabés algo (ronda 10:
    // cuarto ofrecimiento seguido después de admitir tres veces que no tenía el
    // dato). Se quita solo la pregunta comercial; el resto del mensaje queda.
    const RE_NOSE = /\b(no (lo|la|los|las)? ?tengo( cargad|)|no tengo cargad|no lo puedo (asegurar|confirmar)|no figura|no lo s[eé]|no est[aá] cargad)/i;
    const RE_CIERRE_COMERCIAL = /¿[^?]{0,80}(le armo|armamos|avanzamos|avanzar con la compra|le cotizo|le interesa avanzar|cerramos)[^?]{0,40}\?/i;
    if (RE_NOSE.test(respuesta) && RE_CIERRE_COMERCIAL.test(respuesta)) {
      const podado = respuesta.replace(RE_CIERRE_COMERCIAL, '').replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
      if (podado.length >= 25) {
        this.log.log(`cierre comercial quitado (había un "no lo tengo") para ${telefono}`);
        respuesta = podado;
      }
    }

    // Última barrera: nada de cocina interna le llega al cliente. Se quitan
    // líneas entre corchetes y, si aun así hay marcas internas, se recorta desde
    // la última aparición de "Reformulo…:" / ":" o se cae al mensaje anterior.
    respuesta = respuesta.split('\n').filter((l) => !/^\s*\[.*\]\s*$/.test(l)).join('\n').trim();
    if (this.tieneMeta(respuesta)) {
      this.log.warn(`texto interno en la respuesta final para ${telefono}: se recorta`);
      const limpio = this.sinCocinaInterna(respuesta);
      if (limpio.length >= 30 && !this.tieneMeta(limpio)) respuesta = limpio;
      else {
        const m = respuesta.match(/(?:reformul\w*|reescrib\w*)[^:]{0,60}:\s*([\s\S]+)$/i);
        respuesta = (m && m[1] && !this.tieneMeta(m[1]) ? m[1].trim() : '') || 'Disculpe, ¿me repite su consulta?';
      }
    }

    const RE_RECLAMO = /(?<!\bsin\s)\b(falta(ron|ba|n)?|faltante|incompleto|verg[üu]enza|verguenza|reclamo|me cobraron|cobro doble|doble d[eé]bito|devol|reintegro|quiero la plata|estafa|denuncia|defensa del consumidor|mal servicio|no me lleg[oó]|nunca lleg[oó]|roto|vencid[oa])\b/i;
    // C (ronda 11): la derivación no puede depender del criterio del modelo — en
    // 5 de 8 charlas no derivó cuando correspondía. Si el cliente pide hablar con
    // alguien o reclama plata/faltante/factura y el turno no derivó, se deriva acá.
    const PIDE_HUMANO = /\b(con qui[eé]n (hablo|puedo hablar)|hablar con (alguien|una persona|un humano|el encargado|el due[ñn]o)|p[aá]same con|quiero hablar con|atiendame una persona|una persona de verdad)\b/i;
    const RECLAMO_PLATA = /\b(devol|reintegro|me cobraron|cobro doble|doble d[eé]bito|quiero la plata|factura|transferencia|no me lleg[oó] el dinero)\b/i;
    const yaDerivo = herramientasDelTurno.has('derivar_a_humano') || herramientasDelTurno.has('derivar_pago');
    // basta con que el mensaje sea de plata: un proveedor reclamando una factura
    // no dice "vergüenza" ni "faltante", y en la ronda 12 se fue sin escalar
    if (!yaDerivo && (PIDE_HUMANO.test(texto) || RECLAMO_PLATA.test(texto))) {
      try {
        const motivo = `${PIDE_HUMANO.test(texto) ? 'El cliente pide hablar con una persona' : 'Reclamo de dinero'}: "${texto.slice(0, 200)}"`;
        if (RECLAMO_PLATA.test(texto)) {
          const r = await this.derivarPago(linea, telefono, motivo);
          const numero = (r as any)?.numero;
          if (numero && !new RegExp(String(numero).replace(/\D/g, '').slice(-8)).test(respuesta.replace(/\D/g, ''))) {
            respuesta = `${respuesta}\n\nTomo su reclamo y doy aviso al sector de pagos. Si quiere adelantarlo, ese sector atiende en el ${numero} por WhatsApp.`;
          }
        } else {
          await this.derivarAHumano(linea, telefono, motivo, false);
          // no se pega la frase al final: el mensaje quedaba contradictorio
          // ("por este canal lo atiendo yo" + "ya lo paso con una persona").
          // Se regenera sabiendo que la derivación YA está hecha.
          messages.push({ role: 'assistant', content: respuesta });
          messages.push({ role: 'user', content: '[nota interna: el cliente pidió hablar con una persona y la derivación YA quedó hecha. Reescribí el mensaje completo, coherente con eso: primero decí que sos el asistente automático si te lo preguntó, y después que tomás su consulta y das aviso al sector correspondiente. No ofrezcas seguir atendiéndolo vos ni preguntes "¿en qué puedo ayudarlo?".]' });
          const tD = await this.regenerar(system, messages, 1024, sumarUso);
          respuesta = tD ?? 'Soy Emilia, la asistente de O.D.B. Tomo tu consulta y doy aviso al sector correspondiente.';
        }
        this.log.log(`derivación automática para ${telefono}: ${PIDE_HUMANO.test(texto) ? 'pidió humano' : 'reclamo de plata'}`);
      } catch (e: any) { this.log.warn(`derivación automática falló: ${e?.message ?? e}`); }
    }

    // B (ronda 11): superlativos sin respaldo ("la más accesible de ese estilo"
    // habiendo dos más baratas con stock). Solo se permiten si en el turno hubo
    // una búsqueda; si no, se regenera sin el superlativo.
    const RE_SUPERLATIVO = /\b(el|la|lo)\s+m[aá]s\s+(barat|econ[oó]mic|accesible|car|grande|chic|vendid|nuev)/i;
    if (RE_SUPERLATIVO.test(respuesta) && !herramientasDelTurno.has('buscar_productos') && !herramientasDelTurno.has('consultar_cava') && vueltasReintento < 2) {
      this.log.warn(`superlativo sin búsqueda para ${telefono}: regenero`);
      messages.push({ role: 'assistant', content: respuesta });
      messages.push({ role: 'user', content: '[nota interna: usaste un superlativo ("el más barato", "la más accesible") sin haber buscado la categoría en este turno, así que no podés saberlo. Reescribí la respuesta sin el superlativo: nombrá el producto con su precio, sin rankearlo. Si el cliente quiere lo más barato de una categoría, buscá la categoría primero.]' });
      const t11 = await this.regenerar(system, messages, 2048, sumarUso);
      if (t11) respuesta = t11;
      vueltasReintento++;
    }

    // "¿Qué te mando para mañana?" lo dice el que ENTREGA: es un proveedor
    // ofreciendo mercadería. Preguntarle "¿es un pedido o nos ofrece?" es tirar
    // una moneda y quemar un turno con alguien que ya dijo lo que hace. La
    // dirección del verbo es un dato duro, así que se verifica acá y no queda
    // librado a que el modelo lea bien.
    const RE_EL_ENTREGA = /\b(qu[eé]|cu[aá]nto|cuant[oa]s)\s+te\s+(mando|llevo|dejo|acerco|mand[aá]bamos)\b|\bte\s+(mando|llevo|dejo|acerco)\b|\bles?\s+(mando|llevo|dejo|paso|env[ií]o)\s+(la\s+lista|el\s+listado|mercader|los?\s+precios)|\bpaso\s+a\s+dejar(les|te)?\b|\bsalgo\s+con\s+el\s+reparto\b|\b(manejo|trabajo\s+con|represento)\s+(la\s+)?(marca|l[ií]nea)\b/i;
    const RE_MONEDA_AL_AIRE = /¿[^?]{0,90}\b(pedido|comprar|comprarnos)\b[^?]{0,60}\b(ofreci|ofrece|vender|vendernos|mercader[ií]a|proveedor)\b[^?]{0,40}\?|¿[^?]{0,60}\b(cliente\s+o\s+proveedor|proveedor\s+o\s+cliente)\b[^?]{0,20}\?/i;
    if (RE_EL_ENTREGA.test(texto) && RE_MONEDA_AL_AIRE.test(respuesta) && vueltasReintento < 3) {
      this.log.warn(`preguntó cliente-o-proveedor a alguien que ofrece mercadería (${telefono}): regenero`);
      messages.push({ role: 'assistant', content: respuesta });
      messages.push({ role: 'user', content: '[nota interna: quien escribe dijo que ÉL nos manda/lleva mercadería, así que es un PROVEEDOR: ya está claro y preguntarle si es cliente o proveedor sobra. Reescribí la respuesta saludando y preguntando lo único que falta saber: de qué empresa escribe (y si ya dijo la empresa, qué trae y para cuándo). No le des precios nuestros ni le cotices nada.]' });
      const t14 = await this.regenerar(system, messages, 2048, sumarUso);
      if (t14) respuesta = t14;
      vueltasReintento++;
    }

    // El bot NO dice que no puede escuchar, ver ni abrir lo que le mandaron.
    // Cuando hay transcripción escucha el audio; cuando falla, el archivo queda
    // guardado, se avisa al equipo y lo atiende una persona. En ningún caso el
    // cliente tiene que enterarse de una limitación nuestra: contestarle "no
    // puedo escuchar audios" es la peor respuesta posible y el modelo la
    // improvisa igual, así que se corta acá y no en el prompt.
    // El detector (NEG/VERBO/COSA en cualquier orden) vive en prolijo.ts.
    if (niegaPercepcion(respuesta) && vueltasReintento < 3) {
      this.log.warn(`el bot dijo que no puede escuchar/ver para ${telefono}: regenero`);
      messages.push({ role: 'assistant', content: respuesta });
      messages.push({ role: 'user', content: '[nota interna: dijiste que no podés escuchar, ver o abrir lo que mandó el cliente. Eso no se dice NUNCA: lo que manda el cliente se atiende, y si hace falta lo abre una persona de la casa. Reescribí la respuesta sin ninguna mención a lo que podés o no podés procesar; contestá lo que el cliente necesita, y si no tenés el contenido, pedile en una línea que lo escriba o avisale que alguien de la casa lo revisa.]' });
      const t13 = await this.regenerar(system, messages, 2048, sumarUso);
      if (t13) respuesta = t13;
      vueltasReintento++;
    }
    if (niegaPercepcion(respuesta)) {
      // si insiste, se le saca la oración: es preferible un mensaje más corto
      const limpias = respuesta.split(/(?<=[.!?])\s+/).filter((o) => !niegaPercepcion(o));
      respuesta = limpias.join(' ').trim() || 'Recibí tu mensaje. Contame qué necesitás y lo vemos.';
      this.log.warn(`el bot insistió con "no puedo escuchar/ver" para ${telefono}: oración removida`);
    }

    // "No soy Jaqueline" se dice UNA vez por conversación. Hoy se repitió hasta
    // tres veces en una misma charla ("Gracias Jacky!" → "No soy Jacky, soy el
    // asistente automático…"). Si ya se aclaró, la frase se saca y queda el resto.
    const RE_NO_SOY = /[^.!?\n]*\b(no soy (jaqueline|jacqueline|jackie|jacky|jaqui|jaque|jac)\b|soy el asistente autom[aá]tico|le atiende el asistente|le responde el asistente|asistente autom[aá]tico de o\.?\s?d\.?\s?b)[^.!?\n]*[.!?]?\s*/i;
    if (RE_NO_SOY.test(respuesta) && dichoPorElBot.some((t) => RE_NO_SOY.test(t))) {
      const sinAclaracion = respuesta.replace(RE_NO_SOY, '').trim();
      if (sinAclaracion.length >= 8) {
        this.log.log(`"no soy Jaqueline" repetido para ${telefono}: se saca`);
        respuesta = sinAclaracion;
      }
    }

    // Nadie que atiende un teléfono anuncia que es un robot sin que se lo
    // pregunten. A un "¿cómo andás?" el bot contestó "Cómo ando y si todo bien
    // no lo puedo responder, soy el asistente automático, no una persona": un
    // discurso sobre sí mismo en lugar de un saludo. La identidad se dice SOLO
    // si el cliente la preguntó en este turno; si no, esas oraciones se sacan.
    const clientePreguntoIdentidad = /\b(bot|robot|m[aá]quina|humano|persona\s+(real|de\s+verdad)|sos\s+(vos|una?\s)|asistente|inteligencia|ia)\b/i.test(texto);
    // REGLA APRENDIDA TRES VECES: la oración se tira ENTERA, jamás se recorta
    // por adentro. Y "O.D.B" lleva puntos, así que cualquier corte por puntos
    // la parte al medio ("gracias.D.B y le tomo…"): la sigla se protege antes
    // de dividir y se restaura después.
    const RE_ROBOT = /\b(soy (el|un) asistente( autom[aá]tico)?|asistente autom[aá]tico|no (soy|una) (una )?persona|le (atiende|responde) el asistente|en nombre de (jaqueline|jacqueline|jackie|jacky|juan pablo|leandro|anabella|romina|§odb§)|no lo puedo responder|no puedo responder(le)? (eso|c[oó]mo))\b/i;
    if (!clientePreguntoIdentidad) {
      const protegida = respuesta.replace(/O\.?\s?D\.?\s?B/gi, '§odb§');
      if (RE_ROBOT.test(protegida)) {
        const limpias = protegida
          .split(/(?<=[.!?])\s+|\n+/)
          .filter((o) => !RE_ROBOT.test(o))
          .join(' ')
          .replace(/§odb§/g, 'O.D.B')
          .replace(/\s{2,}/g, ' ')
          .trim();
        this.log.warn(`presentación de robot sin que la pidieran para ${telefono}: oración(es) removida(s)`);
        respuesta = limpias.length >= 8 ? limpias : `${saludo}. ¿En qué te puedo ayudar?`;
      }
    }

    // A un PROVEEDOR nunca se le pide "el código del pedido (DOM-XXXXXX)": él
    // nos entrega a nosotros. Hoy pasó con Maltesi, que avisaba tostadas rotas.
    if (esProveedor && /c[oó]digo del pedido|\bDOM-X|\bRET-X/i.test(respuesta)) {
      const limpio = respuesta.split(/(?<=[.!?])\s+/).filter((o) => !/c[oó]digo del pedido|\bDOM-X|\bRET-X/i.test(o)).join(' ').trim();
      if (limpio.length >= 8) {
        this.log.log(`pidió código de pedido a un proveedor (${telefono}): se saca`);
        respuesta = limpio;
      }
    }

    // Más de dos preguntas en un mensaje es un formulario, no una atención.
    if ((respuesta.match(/¿/g) ?? []).length >= 3 && vueltasReintento < 3) {
      this.log.warn(`${(respuesta.match(/¿/g) ?? []).length} preguntas en un mensaje para ${telefono}: regenero`);
      messages.push({ role: 'assistant', content: respuesta });
      messages.push({ role: 'user', content: '[nota interna: hiciste tres o más preguntas en un solo mensaje. Reescribilo con UNA sola pregunta, la más importante; para lo demás asumí la opción más común y decilo ("le puse azúcar Ledesma 1 kg, que es la común"). Si el cliente ya dio todo lo necesario, no preguntes nada: mostrá el resumen con el total y "¿Lo confirmo?".]' });
      const t15 = await this.regenerar(system, messages, 2048, sumarUso);
      if (t15) respuesta = t15;
      vueltasReintento++;
    }

    // "No puedo confirmar si llega a su zona" / "no estoy seguro" NO se dice:
    // se pide la dirección (si falta) y se consulta por adentro.
    const RE_NO_SE_ENVIO = /\b(no\s+(?:le\s+)?(?:puedo|podr[ií]a|pude)\s+(?:confirmar|asegurar|garantizar)(?:le|les|lo|la)?|no\s+estoy\s+segur[oa]|no\s+tengo\s+(?:cargad[oa]|forma\s+de\s+saber|el\s+dato)|no\s+s[eé]\s+si)\b[^.!?\n]{0,70}\b(lleg|zona|reparto|env[ií]o|cobertura|demora|costo\s+del\s+env)/i;
    if (RE_NO_SE_ENVIO.test(respuesta) && vueltasReintento < 3) {
      this.log.warn(`confesó no saber sobre el envío (${telefono}): regenero`);
      messages.push({ role: 'assistant', content: respuesta });
      messages.push({ role: 'user', content: '[nota interna: dijiste que no podés confirmar / no sabés si el reparto llega. Eso no se le dice al cliente. Si todavía no tenés la dirección exacta (calle y número), pedísela en una línea. Si ya la tenés, llamá a consultar_interno con area "reparto", la dirección y la consulta, y decile en una línea que lo consultás con reparto y le confirmás por acá. Sin "no sé", sin "no puedo confirmar", sin plazos.]' });
      const t16 = await this.regenerar(system, messages, 2048, sumarUso);
      if (t16) respuesta = t16;
      vueltasReintento++;
    }

    // Respuestas acotadas: más de cuatro oraciones sin un total ($) es un
    // discurso, no una atención. Se regenera en dos o tres líneas.
    const oraciones = respuesta.split(/(?<=[.!?])\s+/).filter((o) => o.trim().length > 0).length;
    if (oraciones > 4 && !/\$\s?\d/.test(respuesta) && vueltasReintento < 3) {
      this.log.warn(`${oraciones} oraciones sin cotización (${telefono}): regenero más corto`);
      messages.push({ role: 'assistant', content: respuesta });
      messages.push({ role: 'user', content: '[nota interna: demasiado largo. Reescribilo en dos o tres líneas como máximo: el dato o la respuesta concreta, y a lo sumo una pregunta. Sin explicaciones de lo que podés o no podés hacer.]' });
      const t17 = await this.regenerar(system, messages, 1024, sumarUso);
      if (t17) respuesta = t17;
      vueltasReintento++;
    }

    // Disputa de precio o cantidad ("son 18 botellas de $1.950 c/u", "está mal
    // la cuenta"): el bot no discute. La primera vez recotiza asumiendo que el
    // cliente tiene razón (precio por unidad, cantidad en unidades); si ya
    // discutió una vez, lo consulta adentro y dice que lo verifica.
    const RE_DISPUTA = /\b(mal la cuenta|la cuenta est[aá] mal|est[aá] mal|te cargaron mal|sacando mal|mal las cuentas|c\/u|cada una|cada uno|por unidad|no es (?:el|por) pack|son \d+ (?:botellas|unidades|latas|paquetes))\b/i;
    const RE_REAFIRMA = /\b(verificado|est[aá] correcto|es correcto|corresponde al pack|no est[aá] mal|no est[aá] mal cargado|ya verificado|el total .{0,30} est[aá] (?:bien|correcto))\b/i;
    if (RE_DISPUTA.test(texto) && RE_REAFIRMA.test(respuesta) && vueltasReintento < 3) {
      const yaDiscutio = dichoPorElBot.some((t) => RE_REAFIRMA.test(t));
      this.log.warn(`disputa de precio/cantidad para ${telefono} (${yaDiscutio ? 'segunda' : 'primera'} vez): no se discute`);
      messages.push({ role: 'assistant', content: respuesta });
      messages.push({ role: 'user', content: yaDiscutio
        ? '[nota interna: el cliente ya discutió el precio o la cantidad más de una vez. No vuelvas a decirle que está correcto. Llamá a consultar_interno (area "local") con el detalle de lo que dice el cliente y respondé en una línea: "Lo verifico con el local y le confirmo por acá."]'
        : '[nota interna: el cliente discute el precio o la cantidad. Por defecto tiene razón: los precios del catálogo son por UNIDAD suelta y el "x6un" del nombre es el bulto del proveedor, no un pack. Volvé a cotizar con cotizar_pedido usando la cantidad de UNIDADES que dijo el cliente (si dijo 18 botellas, son 18) y mostrale el total nuevo en dos líneas, sin justificar el anterior.]' });
      const t18 = await this.regenerar(system, messages, 2048, sumarUso);
      if (t18) respuesta = t18;
      vueltasReintento++;
    }

    // NINGÚN IMPORTE INVENTADO. Cada "$N" de la respuesta tiene que existir en lo
    // que devolvieron las herramientas en este turno, en lo que ya dijo el bot
    // (que salió de herramientas anteriores) o en lo que escribió el cliente.
    // Si el modelo hace una cuenta por su cuenta, el número no está en ningún
    // lado y la respuesta se regenera. Así "no puede calcular mal": no calcula.
    const normImporte = (t: string) => [...t.matchAll(/\$\s?(\d{1,3}(?:[.\s]\d{3})+|\d+)(?:,\d{1,2})?/g)].map((m) => m[1].replace(/[.\s]/g, ''));
    const permitidos = new Set<string>();
    // las herramientas devuelven importes formateados ("$35.100") y crudos
    // (35100): se aceptan las dos formas, sin puntos de miles
    for (const salida of salidasDelTurno) for (const m of salida.matchAll(/\d{1,3}(?:\.\d{3})+|\d{2,}/g)) permitidos.add(m[0].replace(/\./g, ''));
    for (const t of dichoPorElBot) for (const n of normImporte(String(t))) permitidos.add(n);
    for (const n of normImporte(texto)) permitidos.add(n);
    const importes = normImporte(respuesta);
    const inventados = importes.filter((n) => !permitidos.has(n));
    if (inventados.length && salidasDelTurno.length && vueltasReintento < 3) {
      this.log.warn(`importes sin origen para ${telefono}: ${inventados.join(', ')} → regenero`);
      messages.push({ role: 'assistant', content: respuesta });
      messages.push({ role: 'user', content: `[nota interna: escribiste importes que el sistema no produjo (${inventados.map((n) => '$' + n).join(', ')}). No hagas cuentas: usá exactamente los precios, subtotales y totales que devolvieron buscar_productos / cotizar_pedido, y si necesitás un total nuevo, llamá a cotizar_pedido otra vez.]` });
      const t19 = await this.regenerar(system, messages, 2048, sumarUso);
      if (t19) respuesta = t19;
      vueltasReintento++;
    }

    // Ningún otro número de teléfono se le da al cliente: los temas internos se
    // resuelven adentro. Si el modelo igual lo escribe, la oración se reemplaza.
    const RE_OTRO_TEL = /\b(?:11|15)\s?\d{4}[\s-]?\d{4}\b/;
    if (RE_OTRO_TEL.test(respuesta)) {
      respuesta = respuesta.split(/(?<=[.!?])\s+/).map((o) => (RE_OTRO_TEL.test(o) ? 'Administración te responde por este mismo chat.' : o)).join(' ');
      this.log.warn(`el bot dio un teléfono al cliente (${telefono}): reemplazado`);
    }

    // Reclamo: la disculpa no puede depender del criterio del modelo (ronda 10:
    // cero "lamento" en toda una charla con un cliente que nombró Defensa del
    // Consumidor). Si el cliente reclama y es la primera vez en la charla, la
    // respuesta arranca con la disculpa sobria.
    const yaSeDisculpo = dichoPorElBot.some((t) => /\b(lamento|disculp|perd[oó]n)/i.test(t));
    if (RE_RECLAMO.test(texto) && !/\b(lamento|disculp|perd[oó]n)/i.test(respuesta) && !yaSeDisculpo) {
      this.log.log(`reclamo sin disculpa para ${telefono}: se antepone`);
      respuesta = `Lamento el inconveniente. ${respuesta}`;
    }

    if (respuestaFija.texto) respuesta = respuestaFija.texto;

    // Primer mensaje de la charla (y no a un proveedor): arranca con el saludo
    // correcto para la hora y la bienvenida a O.D.B, garantizado en código.
    if (!yaSaludo && !esProveedor && respuesta.trim()) {
      const antes = respuesta;
      respuesta = saludarConBienvenida(respuesta, saludo);
      if (antes !== respuesta) this.log.log(`saludo y bienvenida ajustados para ${telefono}`);
    }

    // solo cuando hay listado o importes: no toca una respuesta corta
    if (/•|^\s*[-–—]\s/m.test(respuesta) || (respuesta.match(/\$/g) ?? []).length >= 2) {
      const antes = respuesta;
      respuesta = emprolijarListado(respuesta);
      if (antes !== respuesta) this.log.log(`listado formateado para ${telefono}`);
    }

    // Registro: voseo respetuoso siempre — los restos de "usted" inequívocos,
    // los emojis, las exclamaciones y las muletillas de amigo se corrigen acá.
    {
      const antes = respuesta;
      respuesta = respetuosoSinConfianza(respuesta);
      if (antes !== respuesta) this.log.log(`registro ajustado (usted/confianzudo) para ${telefono}`);
    }

    // CANDADO FINAL (regla del dueño: "jamás pueda esa respuesta"). Las guardas
    // de más arriba regeneran mensajes, y una regeneración tardía puede volver
    // a meter "no puedo ver/escuchar/abrir". Acá ya no se negocia: si la frase
    // sobrevivió a todo, el mensaje entero se reemplaza por uno seguro.
    if (niegaPercepcion(respuesta)) {
      this.log.error(`CANDADO FINAL: "no puedo ver/escuchar" sobrevivió a todas las guardas para ${telefono}; mensaje reemplazado`);
      respuesta = dto.archivoBase64
        ? 'Recibido, ya lo tengo. Lo revisa alguien de la casa y te confirmamos por acá.'
        : 'Recibido. Contame qué necesitás y lo vemos.';
    }

    // 4) persistir memoria (solo los turnos de texto, recortada) + tokens acumulados
    const nuevoHistorial = [
      ...historial,
      { role: 'user' as const, content: texto },
      { role: 'assistant' as const, content: respuesta },
    ].slice(-MAX_HISTORIAL);
    const { data: convPrev } = await this.db
      .from('bot_conversaciones')
      .select('tokens')
      .eq('linea', linea)
      .eq('telefono', telefono)
      .maybeSingle();
    await this.db.from('bot_conversaciones').upsert({
      linea,
      telefono,
      mensajes: nuevoHistorial,
      tokens: Number(convPrev?.tokens ?? 0) + tokens,
      actualizado_en: new Date().toISOString(),
    });
    // tarifa por millón según modelo (entrada, caché leída, caché escrita, salida)
    const TARIFA: Record<string, [number, number, number, number]> = {
      'claude-sonnet-5': [3, 0.3, 3.75, 15],
      'claude-opus-4-8': [5, 0.5, 6.25, 25],
      'claude-haiku-4-5': [1, 0.1, 1.25, 5],
    };
    const [tEnt, tLee, tEsc, tSal] = TARIFA[MODELO_BOT] ?? TARIFA['claude-sonnet-5'];
    const costoUSD = (uso.entrada * tEnt + uso.cacheLeida * tLee + uso.cacheEscrita * tEsc + uso.salida * tSal) / 1_000_000;
    this.log.log(`charla ${linea}/${telefono}: ${tokens} tokens · ${uso.llamadas} llamadas · entrada ${uso.entrada} · caché leída ${uso.cacheLeida} · caché escrita ${uso.cacheEscrita} · salida ${uso.salida} · ≈ USD ${costoUSD.toFixed(3)}`);

    // 5) marcar el mensaje como procesado (idempotencia ante reintentos)
    if (mensajeId) {
      await this.db.from('bot_mensajes').upsert({ linea, mensaje_id: mensajeId, telefono, respuesta });
    }

    return { respuesta };
  }

  // Despacha cada tool_use del modelo a la implementación real. El `telefono`
  // SIEMPRE es el del request autenticado (nunca el que el modelo pase como
  // argumento): así un cliente no puede pedirle al bot "usá este otro
  // teléfono" para operar sobre la cuenta de otra persona (identificar_cliente
  // y crear_pedido ya ni siquiera aceptan ese campo en su schema, ver
  // agente-bot.ts). Los errores vuelven como tool_result con is_error para
  // que el agente se recupere solo.
  // skus que el bot vio en búsquedas/cotizaciones: crear_pedido solo acepta esos
  private skusVistos = new Map<string, Set<string>>();
  private skusDe(telefono: string): Set<string> {
    if (!this.skusVistos.has(telefono)) this.skusVistos.set(telefono, new Set());
    if (this.skusVistos.size > 2000) this.skusVistos.clear();
    return this.skusVistos.get(telefono)!;
  }

  // Caché de prompt sobre el HILO, no solo sobre el system: el loop del modelo
  // reenvía todo el contexto en cada vuelta (system + tools + historial +
  // resultados de herramientas). Con una marca de caché en el último bloque del
  // último mensaje, la vuelta siguiente (y el turno siguiente, dentro de los
  // 5 min) lee ese prefijo a 1/10 del precio. En la ronda 5 el 70% de los turnos
  // tuvo 2–5 vueltas: era el grueso del gasto de entrada.
  private conCache(messages: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
    if (!messages.length) return messages;
    const out = messages.map((m) => ({ ...m }));
    const ult: any = out[out.length - 1];
    const bloques: any[] = typeof ult.content === 'string' ? [{ type: 'text', text: ult.content }] : [...(ult.content as any[])];
    if (!bloques.length) return messages;
    const fin = { ...bloques[bloques.length - 1], cache_control: { type: 'ephemeral' } };
    bloques[bloques.length - 1] = fin;
    ult.content = bloques;
    return out;
  }

  // Dos textos "dicen lo mismo" si comparten más de la mitad de sus palabras
  // significativas (ronda 6: 4 notas + 4 alertas idénticas en 2 min, con otras
  // palabras cada vez, así que el prefijo de 30 caracteres no las atrapaba).
  private parecidas(a: string, b: string): boolean {
    const bolsa = (t: string) => new Set(t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9ñ\s]/g, ' ').split(/\s+/).filter((w) => w.length > 3));
    const A = bolsa(a), B = bolsa(b);
    if (!A.size || !B.size) return false;
    let inter = 0;
    for (const w of A) if (B.has(w)) inter++;
    return inter / Math.min(A.size, B.size) >= 0.5;
  }

  // Ronda 7 (CRÍTICA): una regeneración devolvió el razonamiento del modelo
  // pegado al mensaje ("No corresponde nota interna acá… Reformulo sin esa
  // promesa: Perfecto, …"). Regla: al cliente le llega SOLO el mensaje final.
  // Si un texto trae marcas de cocina interna, se descarta y se usa el anterior.
  private tieneMeta(t: string): boolean {
    return /(nota interna|reformul|reescrib|no hay nada nuevo para sumar|retom[aá]s vos|sin prometer plazos|lo anterior;|\btextual\s*:|mi (último|ultimo) mensaje|no corresponde (nota|derivar|anotar)|promesa (de plazo|pendiente|vac[ií]a)|el cliente (pregunt|dijo|pidi)|la herramienta|herramienta (nota_interna|derivar|cotizar|crear_pedido|buscar_productos)|\[nota|^\s*\[)/i.test(t);
  }
  // Antes de descartar todo el mensaje: los paréntesis/corchetes con cocina
  // interna se recortan ((textual: "…"), [nota interna: …]) y el resto se salva.
  private sinCocinaInterna(t: string): string {
    return t
      .replace(/\((?:[^()]*?)(?:textual\s*:|nota interna|reformul|reescrib)(?:[^()]*)\)/gi, '')
      .replace(/\[[^\]]*\]/g, '')
      .replace(/^\s*(?:reformul\w*|reescrib\w*)[^:]{0,60}:\s*/i, '')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }
  private textoFinal(r: Anthropic.Message): string {
    return r.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('\n').trim();
  }
  // regeneración "limpia": con thinking (el razonamiento va al bloque de
  // pensamiento, no al texto) y sin marcas internas; si las trae, devuelve null
  private async regenerar(system: Anthropic.TextBlockParam[], messages: Anthropic.MessageParam[], maxTokens: number, sumarUso: (u: any) => void): Promise<string | null> {
    const r = await this.claude.messages.create({ model: MODELO_BOT, max_tokens: maxTokens, thinking: { type: 'adaptive' }, system, messages: this.conCache(messages) });
    sumarUso(r.usage);
    let t = this.textoFinal(r);
    if (!t) return null;
    if (this.tieneMeta(t)) {
      const limpio = this.sinCocinaInterna(t);
      if (limpio.length >= 30 && !this.tieneMeta(limpio)) { this.log.warn('regeneración con texto interno: recortada'); return limpio; }
      this.log.warn('regeneración con texto interno: descartada');
      return null;
    }
    return t;
  }

  private async ejecutarHerramienta(
    block: Anthropic.ToolUseBlock,
    telefono: string,
    linea: 'pedidos' | 'proveedores' = 'pedidos',
    ctx: { ultimoBot?: string; ultimosBot?: string[]; ultimosCliente?: string[]; textoCliente?: string; fallos?: Map<string, number>; archivoUrl?: string; fija?: { texto?: string }; salidas?: string[] } = {},
  ): Promise<Anthropic.ToolResultBlockParam> {
    const input: any = block.input;
    const skusVistosEnTurno = this.skusDe(telefono);
    const skusVistosEnHistorial = skusVistosEnTurno; // misma bolsa: persiste mientras vive el proceso
    // queda registrado qué herramienta usó: sirve para auditar que el bot
    // consulta el sistema en vez de improvisar (sobre todo precios y horarios)
    this.log.log(`herramienta ${block.name} · ${linea}/${telefono}`);
    try {
      let out: unknown;
      switch (block.name) {
        case 'identificar_cliente':
          out = await this.identificarCliente(telefono);
          break;
        case 'buscar_productos':
          out = await this.buscarProductos(String(input.q ?? ''), (sku) => skusVistosEnTurno.add(sku));
          for (const it of ((out as any)?.items ?? [])) if (it?.sku) skusVistosEnTurno.add(String(it.sku));
          break;
        case 'crear_pedido': {
          this.log.log(`crear_pedido input · ${telefono}: ${JSON.stringify(input).slice(0, 400)}`);
          // Guardas en código (el prompt no alcanza: en la auditoría creó un pedido real
          // con "dale envío el sábado" y después lo negó):
          //  1. confirmación textual del cliente, y que sea una afirmación, no una elección de modalidad
          //  2. envío → dirección con calle Y número
          //  3. todos los sku tienen que haber salido de una búsqueda/cotización de ESTA conversación
          const conf = String(input.confirmacion_del_cliente ?? '').trim();
          const afirma = /(^|[^a-záéíóúñ])(s[ií](?![a-záéíóúñ])|confirm|dale|hacelo|listo|de acuerdo|ok(?![a-z])|perfecto|cerralo|armalo|quiero ese|va(?![a-záéíóúñ]))/i.test(conf);
          const soloModalidad = /^(env[ií]o|retiro|a domicilio|lo paso a buscar|el (s[aá]bado|domingo|lunes|martes|mi[eé]rcoles|jueves|viernes))\b/i.test(conf) && !/confirm|dale|hacelo|listo|(^|[^a-záéíóúñ])s[ií](?![a-záéíóúñ])/i.test(conf);
          if (!conf || !afirma || soloModalidad) {
            out = { error: 'NO se creó el pedido: falta la confirmación explícita del cliente al resumen con total. Mostrale el resumen (ítems, cantidades, total, modalidad y dirección) y pedile que confirme con un "sí". No digas que el pedido está cargado.' };
            break;
          }
          //  4. DOBLE CONFIRMACIÓN (ronda 5: "juana de arco 7450, mandamelo tipo 12" se tomó como
          //     confirmación y el cliente dijo "yo no te confirmé nada"): el pedido se crea
          //     solo si el ÚLTIMO mensaje del bot mostró el total Y preguntó si lo confirma,
          //     y lo que el cliente acaba de escribir es un sí (o dice "confirmo" textual).
          const ultimoBot = String(ctx.ultimoBot ?? '');
          const textoCli = String(ctx.textoCliente ?? '').trim();
          // el bot tiene que haber mostrado un IMPORTE, no solo la palabra
          // "total" (ronda 11: "¿Confirma estos productos así le paso el total
          // exacto?" pasaba la guarda y un "sí" creaba un pedido sin total dado)
          const RE_TOTAL = /(total[^.\n]{0,40}?\$?\s?\d{1,3}[.\s]?\d{3}|\$\s?\d{1,3}[.\s]?\d{3}[^.\n]{0,40}total)/i;
          const RE_PREGUNTA = /(confirm|lo armo|lo dejo armado|lo armamos|lo dejo listo|lo cierro|lo genero|lo cargo|lo tomo|avanzo|dejo confirmado|lo hacemos|lo mando|lo env[ií]o|lo preparo)[^?]{0,80}\?/i;
          // "confirmalo" dicho con todas las letras vale aunque el resumen haya sido
          // dos mensajes antes (el cliente preguntó un precio en el medio y volvió):
          // obligarlo a decir que sí dos veces es robótico. Un "sí"/"dale" a secas
          // sigue necesitando que el resumen sea LO ÚLTIMO que dijo el bot.
          const diceConfirmar = /\bconfirm(o|ado|ame|alo|ar|emos)\b/i.test(textoCli);
          const candidatos = diceConfirmar ? (ctx.ultimosBot?.length ? ctx.ultimosBot : [ultimoBot]) : [ultimoBot];
          const botMostroTotal = candidatos.some((t) => RE_TOTAL.test(t));
          const botPregunto = candidatos.some((t) => RE_PREGUNTA.test(t));
          const clienteDiceSi = /^\W*(s[ií](?![a-záéíóúñ])|dale|ok(ey)?(?![a-z])|listo|confirm|perfecto|de una|hacelo|armalo|mandalo|genial|b[aá]rbaro|joya|va(?![a-záéíóúñ])|vamos|bueno(?![a-z])|correcto|exacto|as[ií] es|me sirve|hag[aá]moslo|cerr[aá]lo|claro|obvio|por supuesto|eso|esa|ese)/i.test(textoCli) || /\bconfirm(o|ado|ame|alo|ar)\b/i.test(textoCli);
          const clienteNiega = /\b(no\b|par[aá]\b|espera|todav[ií]a no|despu[eé]s|m[aá]s tarde|lo pienso|lo consulto|cancel)/i.test(textoCli) && !/\bconfirm(o|ado)\b/i.test(textoCli);
          if (!textoCli || !botMostroTotal || !botPregunto || !clienteDiceSi || clienteNiega) {
            out = { error: 'NO se creó el pedido: todavía no hay una confirmación explícita a un resumen. Protocolo: en ESTE mensaje mandá el resumen final (ítems con cantidades, total, modalidad y dirección si es envío) y terminá con la pregunta "¿Lo confirmo?". Creá el pedido recién en el próximo mensaje, cuando el cliente diga que sí. No digas que el pedido está cargado ni confirmado.' };
            break;
          }
          const tipo = input.tipo === 'domicilio' ? 'domicilio' : 'pickup';
          const dir = input.direccion ? String(input.direccion).trim() : '';
          if (tipo === 'domicilio' && !/\d{1,5}/.test(dir)) {
            out = { error: 'NO se creó el pedido: para envío hace falta la dirección con calle y número. Pedísela. No digas que el pedido está cargado.' };
            break;
          }
          const skus = (input.items ?? []).map((i: any) => String(i.sku));
          const desconocidos = skus.filter((k: string) => !skusVistosEnTurno.has(k) && !skusVistosEnHistorial.has(k));
          if (desconocidos.length) {
            out = { error: `NO se creó el pedido: estos sku no salieron de ninguna búsqueda de esta conversación: ${desconocidos.join(', ')}. Buscá los productos con buscar_productos y usá el sku exacto que devuelve. Nunca inventes un sku.` };
            break;
          }
          // si el modelo no pasó el nombre, se busca en lo que dijo el cliente
          // ("recibe Martín", "soy Ana", o un "martin" a secas cuando se lo pidieron)
          let nombreRecibe = input.nombre ? String(input.nombre).trim() : '';
          if (!nombreRecibe && tipo === 'domicilio') {
            const msgs = ctx.ultimosCliente ?? [];
            for (let k = msgs.length - 1; k >= 0 && !nombreRecibe; k--) {
              const m = msgs[k].match(/\b(?:recibe|retira|soy|me llamo|a nombre de|nombre[:\s]+)\s*([A-Za-zÁÉÍÓÚÑáéíóúñ]{2,}(?:\s+[A-Za-zÁÉÍÓÚÑáéíóúñ]{2,})?)/i);
              if (m?.[1] && !/^(yo|el|la|los|las|mi|tu|su|que|para|hoy|tipo)$/i.test(m[1])) nombreRecibe = m[1];
            }
            if (!nombreRecibe) {
              // un mensaje corto sin números (una o dos palabras) después de que el bot pidió el nombre
              const corto = [...msgs].reverse().find((m) => /^[A-Za-zÁÉÍÓÚÑáéíóúñ]{2,}(\s+[A-Za-zÁÉÍÓÚÑáéíóúñ]{2,})?$/.test(m.trim()) && !/^(si|sí|no|dale|ok|hola|gracias|bueno|listo|confirmalo|confirmo|claro|perfecto|retiro|envio|envío|domicilio)$/i.test(m.trim()));
              const botPidioNombre = (ctx.ultimosBot ?? []).some((b) => /nombre/i.test(b));
              if (corto && botPidioNombre) nombreRecibe = corto.trim();
            }
            if (nombreRecibe) nombreRecibe = nombreRecibe.replace(/\b\w/g, (c) => c.toUpperCase());
          }
          out = await this.crearPedido({
            telefono,
            nombre: nombreRecibe || undefined,
            tipo,
            items: (input.items ?? []).map((i: any) => ({ sku: String(i.sku), cantidad: Number(i.cantidad) })),
            direccion: dir || undefined,
            notas: input.notas ? String(input.notas).slice(0, 300) : undefined,
            entregaFecha: input.entrega_fecha ? String(input.entrega_fecha) : undefined,
            entregaFranja: input.entrega_franja === 'mañana' || input.entrega_franja === 'tarde' ? input.entrega_franja : undefined,
          });
          ctx.fallos?.set('__pedido_creado__', 1);
          break;
        }
        case 'estado_pedido':
          out = await this.estadoPedido(String(input.codigo ?? input.id ?? ''), telefono);
          break;
        case 'cancelar_pedido':
          out = await this.cancelarPedidoDelCliente(telefono, String(input.codigo ?? input.id ?? ''));
          break;
        case 'estado_local': {
          const est: any = await this.estadoAtencion();
          out = { ...est, aclaracion: 'La franja de reparto es cuándo SALEN los envíos; NO es una hora límite para hacer pedidos: se puede pedir en cualquier momento (lo que entra después de la franja sale al día siguiente hábil de reparto). Nunca digas "puede pedir hasta las X".' };
          break;
        }
        case 'cotizar_pedido': {
          // La cantidad que va a cotizar tiene que ser la que DIJO el cliente.
          // Ayer "18 botellas" se convirtió en 3 packs por cuenta del modelo.
          // Si el cliente nombró un número con unidad (18 botellas, 6 latas) y
          // el renglón trae un divisor exacto de ese número (3, 6, 9), se
          // rechaza la llamada y se le ordena usar el número del cliente.
          const dichoCliente = String((ctx.ultimosCliente ?? []).slice(-1)[0] ?? ctx.textoCliente ?? '');
          const cantidadesDichas = [...dichoCliente.matchAll(/\b(\d{1,3})\s*(?:botellas?|unidades?|latas?|paquetes?|bolsas?|cajas?|u\b|un\b)/gi)].map((m) => Number(m[1])).filter((n) => n > 1);
          const sospechoso = (input.items ?? []).find((i: any) => cantidadesDichas.some((n) => Number(i.cantidad) > 0 && Number(i.cantidad) < n && n % Number(i.cantidad) === 0));
          if (sospechoso) {
            const n = cantidadesDichas.find((x) => x % Number(sospechoso.cantidad) === 0);
            out = { error: `El cliente dijo ${n} unidades y vos pasaste cantidad ${sospechoso.cantidad}. Los precios son por UNIDAD suelta: el "x6un" del nombre no es un pack. Volvé a llamar a cotizar_pedido con cantidad ${n}.` };
            this.log.warn(`cantidad convertida a packs para ${telefono}: cliente dijo ${n}, modelo pasó ${sospechoso.cantidad} → rechazada`);
            break;
          }
          out = await this.cotizarPedido(
            (input.items ?? []).map((i: any) => ({ sku: String(i.sku), cantidad: Number(i.cantidad) })),
            telefono,
            // SOLO el último mensaje del cliente: mirando los últimos tres, una
            // variedad nombrada dos turnos atrás ("rubia", "ipa") bloqueaba una
            // cotización legítima y la charla terminaba sin total (ronda 11)
            { textoCliente: (ctx.ultimosCliente ?? []).slice(-1)[0] ?? ctx.textoCliente ?? '', ultimosBot: ctx.ultimosBot },
          );
          for (const it of ((out as any)?.renglones ?? [])) if (it?.sku && !it.error) skusVistosEnTurno.add(String(it.sku));
          break;
        }
        case 'registrar_proveedor':
          out = await this.registrarProveedor(linea, telefono, {
            nombre: input.nombre ? String(input.nombre) : undefined,
            oferta: String(input.oferta ?? ''),
            urgente: input.urgente === true,
          });
          break;
        case 'derivar_pago': {
          const motivo = String(input.motivo ?? '').trim();
          if (!motivo) { out = { error: 'derivar_pago necesita el motivo: de qué pago se trata. Si el cliente NO habló de plata, no la llames.' }; break; }
          // un tema de pago ya derivado en esta conversación no se vuelve a derivar: se repite el número
          const monto = Number(input.monto) || 0;
          const tipoPago = String(input.tipo ?? 'consulta');
          const { data: yaDeriv } = await this.db.from('alertas_internas').select('id').eq('tipo', 'pago').filter('referencia->>telefono', 'eq', telefono).gte('creada_en', new Date(Date.now() - 10 * 60_000).toISOString()).limit(1).maybeSingle();
          // un comprobante nuevo siempre se registra aunque el tema ya esté avisado;
          // una consulta repetida no se vuelve a anunciar
          if (yaDeriv && !(tipoPago === 'comprobante_enviado' && monto > 0)) {
            out = { derivado: true, aviso: 'Administración ya fue avisada hace un momento de este mismo tema. No lo anuncies de nuevo ni des ningún número: contestá lo nuevo, y si pregunta, decile que administración ya lo tiene y le confirma por acá.' };
            break;
          }
          out = await this.derivarPago(linea, telefono, motivo, { monto, tipo: tipoPago, comprobanteUrl: ctx.archivoUrl, dichoPorElCliente: ctx.textoCliente });
          // un comprobante se contesta con una palabra, y la pone el código
          if (tipoPago === 'comprobante_enviado' && ctx.fija) ctx.fija.texto = 'Recibido.';
          if ((out as any)?.respuestaFija && ctx.fija) ctx.fija.texto = String((out as any).respuestaFija);
          break;
        }
        case 'consultar_interno': {
          const area = String(input.area ?? 'local');
          const consulta = String(input.consulta ?? '').trim();
          const direccion = String(input.direccion ?? '').trim();
          if (!consulta) { out = { error: 'consultar_interno necesita la consulta concreta.' }; break; }
          out = await this.consultarInterno(linea, telefono, area, consulta, direccion);
          break;
        }
        case 'nota_interna': {
          const nota = String(input.nota ?? '').trim();
          // misma consulta en 10 minutos → no se duplica
          const { data: notaPrev } = nota ? await this.db.from('bot_notas_equipo').select('id, nota').eq('telefono', telefono).gte('creada_en', new Date(Date.now() - 30 * 60_000).toISOString()).order('creada_en', { ascending: false }).limit(3) : { data: [] };
          const repetida = (notaPrev ?? []).some((n: any) => String(n.nota).toLowerCase().includes(nota.toLowerCase().slice(0, 30)) || this.parecidas(String(n.nota), nota));
          if (repetida) { out = { ok: false, duplicada: true, aviso: 'Esa consulta YA estaba anotada de antes: NO se guardó nada nuevo. No digas "queda anotado" otra vez; si el cliente insiste, decile que ya está anotada y seguí con lo suyo.' }; break; }
          if (nota) {
            await this.db.from('bot_notas_equipo').insert({ linea, telefono, nota });
            const { data: cfg } = await this.db.from('lineas_whatsapp').select('avisar_proveedores_a').eq('linea', linea).eq('activa', true).limit(1).maybeSingle();
            await this.db.from('alertas_internas').insert({ para_usuario: cfg?.avisar_proveedores_a ?? null, tipo: 'nota_bot', titulo: `Consulta de +${telefono}`, detalle: nota, referencia: { linea, telefono } });
          }
          out = { ok: !!nota, guardada: !!nota, aviso: nota ? 'Nota registrada para el equipo (ya podés decir que quedó anotada). Vos seguís atendiendo: no digas que derivaste.' : 'NO se guardó nada: la nota venía vacía. No digas que quedó anotado.' };
          break;
        }
        case 'derivar_a_humano':
          out = await this.derivarAHumano(linea, telefono, String(input.motivo ?? ''), input.urgente === true);
          break;
        case 'generar_link_pago': {
          const monto = Number(input.monto);
          if (!(monto > 0)) { out = { error: 'Monto inválido' }; break; }
          out = await this.mercadopago.crearLink({ monto, concepto: String(input.concepto ?? 'Pedido ODB') });
          break;
        }
        case 'consultar_cava':
          out = await this.consultarCava({
            tipo: input.tipo ? String(input.tipo) : undefined,
            cepa: input.cepa ? String(input.cepa) : undefined,
            precioMin: input.precioMin != null ? Number(input.precioMin) : undefined,
            precioMax: input.precioMax != null ? Number(input.precioMax) : undefined,
            buscar: input.buscar ? String(input.buscar) : undefined,
          });
          for (const it of ((out as any)?.items ?? [])) if (it?.sku) skusVistosEnTurno.add(String(it.sku));
          break;
        default:
          throw new Error(`Herramienta desconocida: ${block.name}`);
      }
      const contenido = JSON.stringify(out);
      ctx.salidas?.push(contenido);
      return { type: 'tool_result', tool_use_id: block.id, content: contenido };
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'error';
      this.log.warn(`Herramienta ${block.name} falló: ${msg}`);
      // la misma herramienta fallando una y otra vez en el mismo turno (ronda 8:
      // crear_pedido ×8 por el nombre de quien recibe) no se resuelve insistiendo:
      // a la segunda se le ordena parar y contestarle al cliente
      const n = (ctx.fallos?.get(block.name) ?? 0) + 1;
      ctx.fallos?.set(block.name, n);
      let freno = n >= 2 ? ` YA FALLÓ ${n} VECES EN ESTE TURNO: no vuelvas a llamar a ${block.name} ahora. Contestale al cliente pidiendo exactamente el dato que falta (o explicando qué no se puede), y recién en el próximo mensaje volvé a intentar.` : '';
      // crear_pedido atascado con el cliente ya confirmado (ronda 8: 25 rechazos,
      // 4 confirmaciones, 0 pedidos): el carrito NO se pierde. Queda una nota
      // estructurada para el local y el cliente recibe una salida honesta.
      if (block.name === 'crear_pedido' && n === 2 && linea === 'pedidos') {
        try {
          const items = Array.isArray(input?.items) ? input.items.map((i: any) => `${i.cantidad}x ${i.sku}`).join(', ') : '(sin ítems)';
          const nota = `PEDIDO NO CARGADO (falló crear_pedido: ${msg.slice(0, 120)}). Cliente confirmó. Ítems: ${items}. Modalidad: ${input?.tipo ?? '?'}. Dirección: ${input?.direccion ?? '-'}. Recibe: ${input?.nombre ?? '-'}. Notas: ${input?.notas ?? '-'}. Hay que cargarlo a mano y avisarle por este chat.`;
          const hace10 = new Date(Date.now() - 10 * 60_000).toISOString();
          const { data: prev } = await this.db.from('bot_notas_equipo').select('id').eq('telefono', telefono).like('nota', 'PEDIDO NO CARGADO%').gte('creada_en', hace10).limit(1).maybeSingle();
          if (!prev) {
            await this.db.from('bot_notas_equipo').insert({ linea, telefono, nota });
            const { data: cfg } = await this.db.from('lineas_whatsapp').select('avisar_proveedores_a').eq('linea', linea).eq('activa', true).limit(1).maybeSingle();
            await this.db.from('alertas_internas').insert({ para_usuario: cfg?.avisar_proveedores_a ?? null, tipo: 'derivacion', titulo: `Pedido confirmado SIN cargar de +${telefono}`, detalle: nota, referencia: { linea, telefono } });
          }
          freno += ' Ya quedó una nota para el local con todos los datos del pedido (ítems, modalidad, dirección, quien recibe). Decile al cliente, con estas palabras o parecidas: "Tuve un inconveniente para cargar el pedido; tomo su pedido con todos los datos y doy aviso al sector correspondiente para que lo dejen confirmado." NO digas que el pedido está confirmado ni cargado, y no le vuelvas a pedir confirmación.';
        } catch (e2: any) { this.log.warn(`no pude dejar la nota del pedido no cargado: ${e2?.message ?? e2}`); }
      }
      return { type: 'tool_result', tool_use_id: block.id, content: `Error: ${msg}${freno}`, is_error: true };
    }
  }

  // --- Línea PEDIDOS ---

  // Identifica al cliente por su teléfono de WhatsApp (para personalizar y atribuir).
  async identificarCliente(telefono: string) {
    const cola = cola10(telefono);
    if (cola.length < 8) return { existe: false };
    const { data } = await this.db
      .from('clientes')
      .select('id, nombre, tipo, verificado, mayorista, cta_cte_habilitada, saldo_cta_cte, telefono')
      .ilike('telefono', `%${cola}%`)
      .limit(1)
      .maybeSingle();
    if (!data) return { existe: false };
    return {
      existe: true,
      clienteId: data.id,
      nombre: data.nombre,
      tipo: data.tipo,
      verificado: data.verificado === true,
      mayorista: data.mayorista === true,
      ctaCte: data.cta_cte_habilitada === true,
      saldoCtaCte: Number(data.saldo_cta_cte ?? 0),
    };
  }

  // El "experto en productos": busca en el catálogo real y devuelve precio y
  // stock por sucursal. Es lo que hace que el bot no invente ni venda sin stock.
  // Los resultados de herramienta se reenvían en CADA vuelta del loop del modelo:
  // cuanto más compactos, menos tokens. Sucursales como texto corto y sin nulos.
  // 1.063 productos activos llevan "x6un", "x12", "pack" o "caja" en el nombre
  // y TODOS tienen unidades_pack = 1: ese "xN" es el bulto del proveedor, no
  // lo que se lleva el cliente. Ayer (2026-08-21) el bot leyó "Villavicencio
  // 1.5L x6un" a $1.950 y le juró a un cliente que $1.950 era el pack de 6:
  // le cotizó 18 botellas a $5.850. El precio y el stock son por unidad suelta
  // salvo que unidades_pack diga otra cosa, y eso se le dice al modelo en cada
  // producto, no se deja a su interpretación.
  private notaUnidad(nombre: string, unidadesPack?: number | null): string | null {
    if (Number(unidadesPack) > 1) return `pack de ${Number(unidadesPack)}: el precio es por el pack`;
    if (/\bx\s?\d{1,3}\s?(?:un|u|unid|unidades)?\b|\bpack\b|\bcaja\b|\bbulto\b/i.test(nombre)) {
      return 'precio y stock por UNIDAD suelta; el "xN" del nombre es el bulto del proveedor, NO un pack para el cliente';
    }
    return null;
  }

  private sucCompacta(xs: any[] | string | undefined): string {
    // consultar_cava ya trae las sucursales como texto; buscar_productos como array.
    // (Ronda 6: pasarle el texto a .map() rompió la cava entera: 38 llamadas fallidas.)
    if (typeof xs === 'string') return xs;
    return (xs ?? [])
      .map((s: any) => `${String(s.sucursal ?? s.nombre ?? '').replace(/^Suc /, '')}: ${Math.round(Number(s.cantidad ?? 0))}`)
      .join(' · ');
  }
  private sinNulos<T extends Record<string, any>>(o: T): Partial<T> {
    const r: any = {};
    for (const [k, v] of Object.entries(o)) if (v !== null && v !== undefined && v !== false && v !== '') r[k] = v;
    return r;
  }

  async buscarProductos(q: string, skusVistos: (sku: string) => void = () => undefined) {
    const t = (q ?? '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (t.length < 2) return { items: [] };
    // el bot necesita ver la categoría entera ("gaseosas", "cerveza en lata"), no
    // los primeros 10: con 10 decía "tenemos tres" cuando había quince
    let { items: stock } = await this.catalogo.consultarStock(t, 40);
    // Ronda 9 (CRÍTICA): "coca zero" no matcheaba "Coca Cola Zero x1.75L" (la
    // búsqueda es por frase). Segunda pasada con comodines entre palabras
    // ("coca%zero") y se unen los resultados sin repetir.
    const palabras = t.split(/\s+/).filter((w) => w.length >= 2);
    if (palabras.length >= 2 && stock.length < 5) {
      try {
        const { items: extra } = await this.catalogo.consultarStock(palabras.join('%'), 40);
        const vistos = new Set(stock.map((p: any) => p.sku));
        for (const p of extra) if (!vistos.has(p.sku)) { stock.push(p); vistos.add(p.sku); }
      } catch { /* la primera pasada alcanza */ }
    }
    // Ronda 12 (CRÍTICA): "gaseosa" matcheaba 9 sodas importadas sin stock y se
    // perdían 34 con stock, porque la búsqueda es por NOMBRE. Si lo que pidió
    // se parece al nombre de una categoría, se traen los productos de esa
    // categoría con stock en la sucursal de retiro.
    const hayConStock = stock.some((p: any) => Number(p.total) > 0);
    if (!hayConStock || stock.length < 5) {
      try {
        const { data: cats } = await this.db.from('categorias').select('id, nombre');
        const nq = t.toLowerCase();
        const sing = (w: string) => w.replace(/(es|s)$/, '');
        const match = ((cats ?? []) as any[]).filter((c) => {
          const nc = String(c.nombre).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
          return nq.split(/\s+/).some((w) => w.length >= 4 && (nc.includes(sing(w)) || sing(w).includes(nc.split(/\s+/)[0])));
        });
        if (match.length) {
          const { data: porCat } = await this.db
            .from('productos')
            .select('sku, nombre, stock(cantidad, sucursal:sucursales(nombre))')
            .in('categoria_id', match.map((c) => c.id))
            .eq('activo', true)
            .limit(200);
          const vistos = new Set(stock.map((p: any) => p.sku));
          for (const p of ((porCat ?? []) as any[])) {
            const total = (p.stock ?? []).reduce((a: number, r: any) => a + Number(r.cantidad), 0);
            if (total > 0 && !vistos.has(p.sku)) {
              stock.push({ sku: p.sku, nombre: p.nombre, total, sucursales: (p.stock ?? []).map((r: any) => ({ sucursal: r.sucursal?.nombre, cantidad: Number(r.cantidad) })) });
              vistos.add(p.sku);
            }
          }
          this.log.log(`búsqueda "${t}": ${match.length} categoría(s), ${stock.length} productos`);
        }
      } catch (e: any) { this.log.warn(`búsqueda por categoría falló: ${e?.message ?? e}`); }
    }
    if (!stock.length) return { items: [] };
    // El precio se trae POR PRODUCTO de los encontrados, no por una segunda
    // búsqueda de texto con otro límite: antes se cruzaban 40 filas de stock con
    // 8 de precio y quedaban productos "sin precio" que sí lo tenían (auditoría:
    // "el precio no me está tomando en el sistema" con un hielo cotizado 6 turnos antes).
    const { data: prods } = await this.db.from('productos').select('id, sku, es_alcohol').in('sku', stock.map((p: any) => p.sku));
    const idPorSku = new Map((prods ?? []).map((p: any) => [p.sku, p]));
    const { data: precios } = await this.db.rpc('catalogo_precios', { p_ids: (prods ?? []).map((p: any) => p.id) });
    const precioPorId = new Map<string, any>((precios ?? []).map((r: any) => [r.producto_id, r]));
    // los sin stock se marcan bien claro: el modelo los ofrecía igual. Se listan
    // por nombre hasta 6 (para que pueda decir "el de litro no hay"); el resto
    // solo se cuenta: cada fila vuelve a viajar en cada vuelta del modelo.
    const conStock = stock.filter((p: any) => Number(p.total) > 0);
    const sinStock = stock.filter((p: any) => !(Number(p.total) > 0));
    const items = conStock.map((p: any) => {
      const prod = idPorSku.get(p.sku);
      const pr = prod ? precioPorId.get(prod.id) : null;
      return this.sinNulos({
        sku: p.sku,
        nombre: p.nombre,
        precio: pr?.precio_final != null ? Math.round(Number(pr.precio_final)) : null,
        precioMayorista: pr?.precio_mayorista != null && Number(pr.precio_mayorista) !== Number(pr.precio_final) ? Math.round(Number(pr.precio_mayorista)) : null,
        promo: pr?.descuento_nombre ? `${pr.descuento_nombre} (antes $${Math.round(pr.precio_lista)})` : null,
        alcohol: !!prod?.es_alcohol,
        unidad: this.notaUnidad(String(p.nombre ?? ''), prod?.unidades_pack),
        stock: this.sucCompacta(p.sucursales) || String(Math.round(Number(p.total))),
      });
    });
    // Ronda 7 (CRÍTICA, reincidente): "no tenemos Quilmes clásica ni una lager
    // parecida" cuando había Brahma, Imperial, Andes… El bot buscaba por marca y
    // con cero stock se rendía. Si lo buscado no tiene stock, el sistema mismo
    // trae las alternativas de la MISMA categoría con stock, de menor a mayor
    // precio, para que el "no tenemos" salga siempre con el "sí tenemos".
    let alternativas: any[] = [];
    let categoriaAlt: string | null = null;
    // lo que cuenta para un pedido por WhatsApp es el stock de la sucursal con
    // retiro (Sant Thomas): algo que solo está en Santa Inés tampoco se puede pedir
    const { data: sucPickB } = await this.db.from('sucursales').select('nombre').eq('activa', true).eq('pickup', true).limit(1).maybeSingle();
    const nombrePick = String(sucPickB?.nombre ?? 'Suc Sant Thomas');
    const pedible = (p: any) => (p.sucursales ?? []).some((x: any) => String(x.sucursal) === nombrePick && Number(x.cantidad) > 0);
    // se disparan cuando lo mejor rankeado no se puede pedir, o cuando hay menos de
    // 3 opciones pedibles (el cliente que pide "Quilmes clásica" merece ver Brahma,
    // Imperial, Andes… y no solo "Quilmes IPA")
    const referencia = stock.find((p: any) => !pedible(p)) ?? stock[0];
    if (referencia && (!pedible(stock[0]) || conStock.filter(pedible).length < 3)) {
      try {
        const { data: ref } = await this.db.from('productos').select('categoria_id, categoria:categorias(nombre)').eq('sku', referencia.sku).maybeSingle();
        if ((ref as any)?.categoria_id) {
          categoriaAlt = (ref as any).categoria?.nombre ?? null;
          const { data: mismos } = await this.db
            .from('productos')
            .select('id, sku, nombre, es_alcohol, stock(cantidad, sucursal:sucursales(nombre))')
            .eq('categoria_id', (ref as any).categoria_id)
            .eq('activo', true)
            .limit(80);
          const conAlgo = ((mismos ?? []) as any[]).filter((p) => (p.stock ?? []).some((r: any) => Number(r.cantidad) > 0 && String(r.sucursal?.nombre ?? '') === nombrePick));
          if (conAlgo.length) {
            const { data: pr } = await this.db.rpc('catalogo_precios', { p_ids: conAlgo.map((p) => p.id) });
            const precioDe = new Map<string, any>((pr ?? []).map((r: any) => [r.producto_id, r]));
            // ranking: (1) misma marca/otro tamaño (primera palabra del nombre
            // buscado), (2) misma categoría por precio (ronda 8: a "Coca de 1.5"
            // le ofreció Pepsi habiendo Coca 1.75)
            const marcaRef = String(referencia.nombre ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/\s+/).find((w) => w.length >= 3 && !/^(cerveza|vino|agua|gaseosa|fernet|whisky|vodka|gin|licor|aperitivo|espumante|jugo|energizante)$/.test(w)) ?? '';
            const esMismaMarca = (nombre: string) => !!marcaRef && nombre.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(marcaRef);
            alternativas = conAlgo
              .map((p) => ({
                sku: p.sku,
                nombre: p.nombre,
                precio: precioDe.get(p.id)?.precio_final != null ? Math.round(Number(precioDe.get(p.id).precio_final)) : null,
                alcohol: !!p.es_alcohol,
                stock: (p.stock ?? []).filter((r: any) => Number(r.cantidad) > 0).map((r: any) => `${String(r.sucursal?.nombre ?? '').replace(/^Suc /, '')}: ${Math.round(Number(r.cantidad))}`).join(' · '),
              }))
              .filter((p) => p.precio)
              .sort((a, b) => (Number(esMismaMarca(b.nombre)) - Number(esMismaMarca(a.nombre))) || (Number(a.precio) - Number(b.precio)))
              .slice(0, 12)
              .map((p) => (esMismaMarca(p.nombre) ? { ...p, mismaMarca: true } : p));
            for (const a of alternativas) skusVistos(a.sku);
          }
        }
      } catch { /* sin alternativas: el bot lo dice honestamente */ }
    }
    return {
      items,
      ...(sinStock.length
        ? {
            sinStock: `${sinStock.slice(0, 6).map((p: any) => p.nombre).join(' | ')}${sinStock.length > 6 ? ` | +${sinStock.length - 6} más` : ''} [SIN STOCK — no ofrecer]`,
          }
        : {}),
      ...(alternativas.length
        ? {
            alternativasDeLaCategoria: alternativas,
            aviso: `Alternativas con stock en ${nombrePick.replace(/^Suc /, '')} (de ahí salen los pedidos) de la categoría ${categoriaAlt ?? ''}: PRIMERO la misma marca en otro tamaño (mismaMarca: true), después el resto de menor a mayor precio. Si lo que pidió no se puede pedir, el "no tenemos X" va SIEMPRE con "sí tenemos Y a $Z" en el mismo mensaje. NUNCA cotices un producto distinto al que nombró el cliente sin decirlo en la primera línea.`,
          }
        : {}),
    };
  }

  // Crea el pedido en el sistema (mismo pipeline que web/app: entra como 'recibido'
  // y el depósito lo prepara). Identifica/crea al cliente por su teléfono.
  // ---- Horarios y reparto ----
  // El bot NO calcula horarios: los pregunta. Un modelo se equivoca con "¿están
  // abiertos?" y eso termina en un cliente parado en la puerta de un local cerrado.
  // La hora se resuelve en la base, en horario de Buenos Aires.
  async estadoAtencion() {
    const { data, error } = await this.db.rpc('estado_atencion');
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  // ---- Cotización ----
  // El bot tampoco multiplica ni suma: manda los renglones y el sistema devuelve
  // el total. Un peso mal calculado en un presupuesto es un problema en la caja.
  // ¿El producto que se va a cotizar es el que el cliente nombró? (ronda 10, 3ª
  // reincidencia: pidió Coca 1,5 y Quilmes clásica, le cotizó 1,75 e IPA sin
  // decirlo). Compara medida y variedad de lo que dijo el cliente contra el
  // nombre del producto elegido. Devuelve el motivo del desvío o null.
  private desvioDeLoPedido(nombreProducto: string, textoCliente: string): string | null {
    const norm = (t: string) => t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const prod = norm(nombreProducto), cli = norm(textoCliente);
    // medidas que el cliente nombró (1.5 / 1,5 l / 750 / 473 / 2 litros…)
    const medidaCli = [...cli.matchAll(/\b(\d{2,4})\s?(?:cc|ml)\b|\b(\d(?:[.,]\d)?)\s?(?:l\b|lt|lts|litros?)\b/g)]
      .map((m) => (m[1] ? Number(m[1]) : Math.round(Number(String(m[2]).replace(',', '.')) * 1000)))
      .filter((n) => n >= 100);
    if (medidaCli.length) {
      const medidaProd = [...prod.matchAll(/\b(\d{3,4})\s?(?:cc|ml)\b|\b(\d(?:[.,]\d)?)\s?(?:l\b|lt|lts|litros?)\b/g)]
        .map((m) => (m[1] ? Number(m[1]) : Math.round(Number(String(m[2]).replace(',', '.')) * 1000)))
        .filter((n) => n >= 100);
      if (medidaProd.length && !medidaProd.some((mp) => medidaCli.some((mc) => Math.abs(mp - mc) <= 30))) {
        return `el cliente pidió ${medidaCli[0] >= 1000 ? (medidaCli[0] / 1000).toString().replace('.', ',') + ' L' : medidaCli[0] + 'cc'} y este producto es de ${medidaProd[0] >= 1000 ? (medidaProd[0] / 1000).toString().replace('.', ',') + ' L' : medidaProd[0] + 'cc'}`;
      }
    }
    // variedades que se confunden entre sí dentro de una misma marca
    const VARIEDADES = ['ipa', 'stout', 'zero', 'light', 'clasica', 'red lager', 'bock', 'sin alcohol', 'negra', 'rubia'];
    const pidio = VARIEDADES.filter((v) => new RegExp(`\\b${v}\\b`).test(cli));
    const tiene = VARIEDADES.filter((v) => new RegExp(`\\b${v}\\b`).test(prod));
    // "clásica" en el cliente = la común: cualquier variedad en el producto es un desvío
    if (pidio.includes('clasica') && tiene.length) return `el cliente pidió la clásica y este producto es ${tiene[0]}`;
    if (pidio.length && !pidio.some((v) => tiene.includes(v)) && (tiene.length || pidio.some((v) => v !== 'clasica'))) {
      return `el cliente pidió ${pidio[0]} y este producto ${tiene.length ? `es ${tiene[0]}` : 'no lo es'}`;
    }
    return null;
  }

  async cotizarPedido(items: { sku: string; cantidad: number }[], telefono?: string, ctxCliente?: { textoCliente?: string; ultimosBot?: string[] }) {
    if (!items?.length) throw new BadRequestException('No hay renglones para cotizar');

    // el precio depende del cliente (mayorista/segmento), igual que en la venta
    let mayorista = false;
    if (telefono) {
      const ident = await this.identificarCliente(telefono);
      mayorista = (ident as any)?.mayorista === true;
    }

    const renglones: any[] = [];
    let total = 0;
    let hayFaltantes = false;

    // Los pedidos por WhatsApp salen SIEMPRE de la sucursal con retiro (Sant
    // Thomas): el stock que cuenta es el de ahí. Sumar las dos sucursales hacía
    // cotizar 48 latas cuando en Sant Thomas había 30 (ronda 5).
    const { data: sucPick } = await this.db.from('sucursales').select('id, nombre').eq('activa', true).eq('pickup', true).limit(1).maybeSingle();
    const sucPickId = sucPick?.id ?? null;
    const sucPickNombre = String(sucPick?.nombre ?? 'Sant Thomas').replace(/^Suc /, '');

    for (const it of items) {
      const sku = String(it.sku ?? '').trim();
      const cantidad = Number(it.cantidad ?? 0);
      if (!sku || !(cantidad > 0)) continue;

      // por SKU exacto: la búsqueda por texto fallaba con códigos cortos (L1063)
      const { data: prod } = await this.db.from('productos').select('id, sku, nombre, activo, stock(cantidad, sucursal_id)').eq('sku', sku).maybeSingle();
      if (!prod || prod.activo === false) {
        renglones.push({ sku, cantidad, error: 'No existe ese código en el catálogo' });
        hayFaltantes = true;
        continue;
      }
      const { data: pr } = await this.db.rpc('catalogo_precios', { p_ids: [prod.id] });
      const fila: any = (pr ?? [])[0] ?? {};
      const p: any = {
        sku: prod.sku, nombre: prod.nombre,
        precio: fila.precio_final != null ? Number(fila.precio_final) : null,
        precioMayorista: fila.precio_mayorista != null ? Number(fila.precio_mayorista) : null,
        stockTotal: ((prod as any).stock ?? []).reduce((a: number, r: any) => a + Number(r.cantidad), 0),
        stockSantThomas: ((prod as any).stock ?? []).filter((r: any) => !sucPickId || r.sucursal_id === sucPickId).reduce((a: number, r: any) => a + Number(r.cantidad), 0),
      };
      const disponible = sucPickId ? Number(p.stockSantThomas ?? 0) : Number(p.stockTotal ?? 0);
      const unitario = mayorista && p.precioMayorista ? Number(p.precioMayorista) : Number(p.precio ?? 0);
      if (!(unitario > 0)) {
        renglones.push({ sku, nombre: p.nombre, cantidad, error: 'Sin precio cargado' });
        hayFaltantes = true;
        continue;
      }
      // ¿es lo que el cliente pidió, o un reemplazo que nunca anunció?
      const desvio = ctxCliente?.textoCliente ? this.desvioDeLoPedido(p.nombre, ctxCliente.textoCliente) : null;
      if (desvio) {
        // ¿el bot ya avisó del reemplazo? Se compara por MARCA (la palabra
        // significativa del nombre), no por un prefijo fijo de 18 caracteres:
        // "cerveza amstel lag" nunca matcheaba lo que el bot había escrito.
        const normT = (t: string) => t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const marcaProd = normT(String(p.nombre)).split(/\s+/).find((w) => w.length >= 4 && !/^(cerveza|vino|agua|gaseosa|fernet|whisky|vodka|licor|espumante|jugo|lata|botella)$/.test(w)) ?? '';
        const yaLoAnuncio = (ctxCliente?.ultimosBot ?? []).some((b) => {
          const nb = normT(b);
          return (!!marcaProd && nb.includes(marcaProd)) && /(no (la|lo|las|los)? ?tengo|no tenemos|no hay|en su lugar|le cotizo|alternativa|reemplaz|le sirve|le ofrezco|¿va\?)/.test(nb);
        });
        const acepto = /\b(dale|si|sí|ok|va|bueno|perfecto|esa|ese|listo|sirve|me sirve)\b/i.test(String(ctxCliente?.textoCliente ?? '')) && yaLoAnuncio;
        if (!yaLoAnuncio && !acepto) {
          renglones.push({ sku, nombre: p.nombre, cantidad, reemplazo_no_confirmado: true, error: `NO cotices esto todavía: ${desvio}. Decíselo en la primera línea ("la de X no la tengo; ¿le cotizo la de Y a $Z?") y esperá que acepte. Recién después pedí el total.` });
          hayFaltantes = true;
          continue;
        }
      }
      const subtotal = Math.round(unitario * cantidad * 100) / 100;
      total += subtotal;
      renglones.push({
        sku,
        nombre: p.nombre,
        cantidad,
        precioUnitario: unitario,
        renglon: `${cantidad} × $${Math.round(unitario).toLocaleString('es-AR')} c/u = $${Math.round(subtotal).toLocaleString('es-AR')}`,
        unidad: this.notaUnidad(String(p.nombre ?? ''), (prod as any)?.unidades_pack),
        subtotal,
        stockDisponible: disponible,
        stockEnOtraSucursal: Math.max(0, Number(p.stockTotal ?? 0) - disponible),
        alcanzaElStock: disponible >= cantidad,
        ...(disponible < cantidad ? { aviso: `Stock insuficiente en ${sucPickNombre}: hay ${disponible} y el cliente pide ${cantidad}. Ofrecé esa cantidad o una alternativa; no prometas lo que no hay.` } : {}),
      });
      if (disponible < cantidad) hayFaltantes = true;
    }

    return {
      renglones,
      total: Math.round(total * 100) / 100,
      listaDePrecio: mayorista ? 'mayorista' : 'minorista',
      hayFaltantes,
      sucursalDeSalida: sucPickNombre,
      ...(renglones.some((r: any) => r.reemplazo_no_confirmado) ? { reemplazoSinConfirmar: 'HAY UN RENGLÓN QUE NO ES LO QUE EL CLIENTE PIDIÓ: no des ningún total ni pases a retiro/domicilio hasta que acepte el reemplazo.' } : {}),
      aclaracion: `Este total lo calculó el sistema. Informalo tal cual, sin rehacer la cuenta. Cada precio es POR UNIDAD SUELTA (una botella, un paquete) salvo que el renglón diga "pack de N": el "x6un" de un nombre es el bulto del proveedor, no un pack; si el cliente pidió 18 botellas, la cantidad es 18, no 3. Cada renglón viene formateado en "renglon": usalo tal cual (2 × $20.500 c/u = $41.000). El stock que cuenta es el de ${sucPickNombre} (de ahí salen retiros y envíos).${hayFaltantes ? ' HAY RENGLONES SIN STOCK SUFICIENTE: avisale al cliente la cantidad real antes de seguir.' : ''} Si el cliente quiere envío, el total se informa como "total de la mercadería; el envío va aparte y lo define el sector de reparto".`,
    };
  }

  // Cancelación desde el chat: SOLO pedidos de este mismo teléfono y que todavía
  // estén "recibido" (nadie los empezó a preparar). Usa la misma RPC que el
  // panel (lock de fila, idempotente, devuelve la reserva de stock). Si el
  // pedido ya avanzó, no se cancela acá: se deriva y se dice la verdad.
  async cancelarPedidoDelCliente(telefono: string, codigoOId: string) {
    const ref = String(codigoOId ?? '').trim();
    if (!ref) return { error: 'Falta el código del pedido (ej. DOM-XXXXXX) o su id.' };
    const ident = await this.identificarCliente(telefono);
    if (!ident.existe || !ident.clienteId) return { error: 'No encuentro un cliente con este teléfono, así que no hay pedido propio para cancelar.' };
    const esUuid = /^[0-9a-f-]{36}$/i.test(ref);
    const q = this.db.from('pedidos').select('id, estado, total, qr_retiro, creado_en').eq('cliente_id', ident.clienteId);
    const { data: ped } = await (esUuid ? q.eq('id', ref) : q.eq('qr_retiro', ref.toUpperCase())).maybeSingle();
    if (!ped) return { error: `No hay ningún pedido ${ref} de este cliente. Si el código no coincide, pedile al cliente que lo revise o derivá.` };
    if (ped.estado === 'cancelado') return { ok: true, yaEstaba: true, codigo: ped.qr_retiro, mensaje: 'Ese pedido ya estaba cancelado.' };
    if (ped.estado !== 'recibido') {
      return { error: `El pedido ${ped.qr_retiro} ya está "${ped.estado}": no lo puedo cancelar desde acá. Decile al cliente que tomás la baja y que das aviso al sector correspondiente, y usá derivar_a_humano con el código.` };
    }
    const { error } = await this.db.rpc('cancelar_pedido', { p_pedido: ped.id, p_usuario: null });
    if (error) return { error: `No pude cancelar el pedido: ${error.message}. Derivá a un humano con el código ${ped.qr_retiro}.` };
    await this.db.from('bot_notas_equipo').insert({ linea: 'pedidos', telefono, nota: `Pedido ${ped.qr_retiro} cancelado a pedido del cliente desde el chat (total ${ped.total}). El stock volvió a quedar disponible.` }).then(() => null, () => null);
    this.log.log(`pedido ${ped.qr_retiro} cancelado por el cliente vía bot · ${telefono}`);
    return { ok: true, codigo: ped.qr_retiro, estado: 'cancelado', total: Number(ped.total), mensaje: 'Pedido cancelado; el stock volvió a quedar disponible.' };
  }

  async crearPedido(dto: {
    telefono: string;
    nombre?: string;
    tipo?: 'pickup' | 'domicilio';
    items: { sku: string; cantidad: number }[];
    direccion?: string;
    notas?: string;
    entregaFecha?: string; // AAAA-MM-DD: pedido programado para ese día
    entregaFranja?: 'mañana' | 'tarde';
  }) {
    if (!dto.telefono) throw new BadRequestException('Falta el teléfono del cliente');
    if (!dto.items?.length) throw new BadRequestException('El pedido está vacío');
    // topes del canal WhatsApp: un pedido gigante "reserva" stock sin pagar,
    // así que lo grande se deriva a un humano
    const unidades = dto.items.reduce((s, i) => s + Number(i.cantidad || 0), 0);
    if (dto.items.length > maxRenglonesBot() || unidades > maxUnidadesBot()) {
      throw new BadRequestException(
        `El pedido supera el máximo del canal WhatsApp (${maxRenglonesBot()} productos distintos / ${maxUnidadesBot()} unidades). Para pedidos grandes lo toma una persona del equipo: decile al cliente que en breve lo contactan.`,
      );
    }

    // resolver o crear el cliente por teléfono (para atribuir y reconocerlo la próxima)
    let clienteId: string | null = null;
    const ident = await this.identificarCliente(dto.telefono);
    // un envío sin nombre de quien recibe no se puede entregar (ronda 7). Si el
    // modelo lo puso en las notas ("recibe Martín") se toma de ahí.
    dto.nombre = nombreLimpio(dto.nombre) ?? undefined;
    if (dto.tipo === 'domicilio' && !dto.nombre?.trim()) {
      const enNotas = String(dto.notas ?? '').match(/\b(?:recibe|retira|a nombre de|para)\s+([A-ZÁÉÍÓÚÑ][\wáéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][\wáéíóúñ]+)?)/);
      if (enNotas?.[1]) dto.nombre = enNotas[1];
    }
    if (dto.tipo === 'domicilio' && !dto.nombre?.trim() && !ident.nombre) {
      throw new BadRequestException('NO se creó el pedido: para el envío hace falta el nombre de quien recibe. Si el cliente ya lo dijo en la charla, volvé a llamar a crear_pedido pasándolo en el parámetro "nombre" (ej. nombre: "Martín"); si no lo dijo, pedíselo en este mensaje. No digas que el pedido está cargado.');
    }
    if (ident.existe) {
      clienteId = ident.clienteId!;
      if (dto.nombre && !ident.nombre) {
        await this.db.from('clientes').update({ nombre: dto.nombre.trim() }).eq('id', clienteId);
      }
    } else {
      const { data } = await this.db
        .from('clientes')
        .insert({ telefono: soloDigitos(dto.telefono), nombre: dto.nombre?.trim() ?? null })
        .select('id')
        .single();
      clienteId = data?.id ?? null;
    }

    // Idempotencia: si este cliente ya tiene un pedido IGUAL de hace minutos
    // (tool use duplicado, reintento de webhook, "no me llegó, mandalo de nuevo"),
    // devolvemos el existente en vez de duplicar la reserva de stock.
    if (clienteId) {
      const existente = await this.pedidoRecienteIgual(clienteId, dto);
      if (existente) return existente;
    }

    const pedido = await this.pedidos.crearDesdeApp({
      tipo: dto.tipo ?? 'pickup',
      items: dto.items,
      clienteId: clienteId ?? undefined,
      destino: dto.direccion ? { direccion: dto.direccion } : undefined,
    });
    // preferencias del cliente ("tipo 12", "portón negro", "tocar timbre"): quedan
    // en el pedido para el reparto; antes se decían "anotadas" y no iban a ningún lado
    // fecha programada: "para mañana" tiene que quedar como dato, no como nota.
    // Fecha inválida o pasada se ignora (mejor pedido de hoy que pedido roto).
    let entregaFecha: string | null = null;
    if (dto.entregaFecha && /^\d{4}-\d{2}-\d{2}$/.test(dto.entregaFecha)) {
      const hoy = new Date().toISOString().slice(0, 10);
      if (dto.entregaFecha >= hoy) entregaFecha = dto.entregaFecha;
    }
    const cambios: Record<string, unknown> = {};
    if (dto.notas?.trim()) cambios.notas = `WhatsApp: ${dto.notas.trim()}`;
    if (entregaFecha) {
      cambios.entrega_fecha = entregaFecha;
      if (dto.entregaFranja === 'mañana' || dto.entregaFranja === 'tarde') cambios.entrega_franja = dto.entregaFranja;
    }
    if (Object.keys(cambios).length && (pedido as any)?.id) {
      const { error: eNotas } = await this.db.from('pedidos').update(cambios).eq('id', (pedido as any).id);
      if (eNotas) this.log.error(`no pude guardar notas/fecha del pedido ${(pedido as any).qr_retiro ?? (pedido as any).id}: ${eNotas.message}`);
    }

    // resumen legible para que el bot lo repita por WhatsApp
    const p: any = pedido;
    const resumen = (p.items ?? [])
      .map((i: any) => `${i.cantidad}x ${i.producto?.nombre ?? i.nombre ?? ''}`.trim())
      .join(', ');
    const esEnvio = p.canal === 'domicilio';
    return {
      pedidoId: p.id,
      estado: p.estado,
      total: Number(p.total),
      codigoRetiro: p.qr_retiro ?? null,
      resumen,
      canal: p.canal,
      // lo que el cliente tiene que saber en la confirmación (ronda 6: confirmó
      // "total 69.200" sin aclarar que el envío no está incluido ni cómo se paga)
      decirleAlCliente: [
        `El total ${Number(p.total).toLocaleString('es-AR')} es de la mercadería.`,
        esEnvio ? 'El costo del envío no está incluido: lo define el sector de reparto, al que ya le di aviso.' : `Se retira en la sucursal Sant Thomas (Castex 3601) con el código ${p.qr_retiro ?? ''}.`,
        esEnvio ? 'Se abona al recibir, en efectivo o con tarjeta; si preferís, te paso un link de Mercado Pago, o administración te pasa los datos para transferir por acá.' : 'Se abona al retirar, en efectivo o con tarjeta; si preferís, te paso un link de Mercado Pago.',
      ],
    };
  }

  // ¿Este cliente ya creó un pedido idéntico (mismo canal, mismos renglones)
  // en los últimos minutos y sigue activo? Devuelve el existente para no duplicar.
  private async pedidoRecienteIgual(
    clienteId: string,
    dto: { tipo?: 'pickup' | 'domicilio'; items: { sku: string; cantidad: number }[] },
  ) {
    const hace5m = new Date(Date.now() - 5 * 60_000).toISOString();
    const { data } = await this.db
      .from('pedidos')
      .select('id, canal, estado, total, qr_retiro, items:pedidos_items(cantidad, producto:productos(sku, nombre))')
      .eq('cliente_id', clienteId)
      .eq('canal', dto.tipo ?? 'pickup')
      .in('estado', ['recibido', 'pagado', 'en_preparacion'])
      .gte('creado_en', hace5m)
      .order('creado_en', { ascending: false })
      .limit(3);
    const querido = dto.items
      .map((i) => `${i.sku}x${Math.floor(Number(i.cantidad))}`)
      .sort()
      .join('|');
    for (const p of (data ?? []) as any[]) {
      const suyo = (p.items ?? [])
        .map((i: any) => `${i.producto?.sku}x${Math.round(Number(i.cantidad))}`)
        .sort()
        .join('|');
      if (suyo !== querido) continue;
      this.log.warn(`crear_pedido idéntico reciente para cliente ${clienteId}: devuelvo el existente ${p.id}`);
      const resumen = (p.items ?? [])
        .map((i: any) => `${i.cantidad}x ${i.producto?.nombre ?? ''}`.trim())
        .join(', ');
      return {
        pedidoId: p.id,
        estado: p.estado,
        total: Number(p.total),
        codigoRetiro: p.qr_retiro ?? null,
        resumen,
        canal: p.canal,
        nota: 'Este pedido ya estaba creado (era idéntico y reciente): NO se creó uno nuevo. Confirmale al cliente el existente.',
      };
    }
    return null;
  }

  // "Nueva conversación" del simulador del panel: borra la memoria del teléfono
  // ---- Línea mixta: proveedores y pagos ----

  // Un proveedor escribió ofreciendo algo o preguntando por reposición: queda
  // registrado como proveedor (la próxima vez el bot ya sabe quién es) y la
  // encargada de compras recibe la alerta en su usuario del panel.
  async registrarProveedor(linea: 'pedidos' | 'proveedores', telefono: string, dto: { nombre?: string; oferta: string; urgente?: boolean }) {
    // Una alerta por proveedor por día: si vuelve a llamarla en la misma charla,
    // se actualiza la existente en vez de llenar la campanita de duplicados.
    const { data: reciente } = await this.db.from('alertas_internas').select('id, detalle')
      .eq('tipo', 'proveedor_ofrece').filter('referencia->>telefono', 'eq', telefono)
      .gte('creada_en', new Date(Date.now() - 24 * 3600_000).toISOString()).is('leida_en', null).limit(1).maybeSingle();
    if (reciente) {
      const detalle = String(reciente.detalle ?? '');
      // se anexa lo que sea NUEVO (antes comparaba los primeros 40 caracteres y
      // "paso el jueves a las 10 con la lista nueva" se perdía por empezar igual)
      const yaDicho = detalle.toLowerCase().includes(dto.oferta.toLowerCase()) || detalle.split('\n').some((l) => this.parecidas(l, dto.oferta) && l.length >= dto.oferta.length);
      if (!yaDicho) {
        await this.db.from('alertas_internas').update({ detalle: `${detalle}\n+ ${dto.oferta}` }).eq('id', reciente.id);
      }
      await this.db.from('bot_contactos').upsert({ telefono, tipo: 'proveedor', nombre: dto.nombre ?? null, notas: dto.oferta, actualizado_en: new Date().toISOString() }, { onConflict: 'telefono' });
      return { ok: true, registrado: 'proveedor', avisada: true, nota: 'Ya estaba avisado; se agregó el detalle. No lo repitas.' };
    }
    // el contacto queda marcado como proveedor
    await this.db.from('bot_contactos').upsert(
      { telefono, tipo: 'proveedor', nombre: dto.nombre ?? null, notas: dto.oferta, actualizado_en: new Date().toISOString() },
      { onConflict: 'telefono' },
    );

    // ¿a quién se le avisa? lo dice la configuración de la línea
    const { data: cfg } = await this.db
      .from('lineas_whatsapp').select('avisar_proveedores_a').eq('linea', linea).eq('activa', true).limit(1).maybeSingle();

    const titulo = `${dto.urgente ? '🔴 ' : ''}Proveedor por WhatsApp: ${dto.nombre || bonitoTelefono(telefono)}`;
    await this.db.from('alertas_internas').insert({
      para_usuario: cfg?.avisar_proveedores_a ?? null,
      tipo: 'proveedor_ofrece',
      titulo,
      detalle: dto.oferta,
      referencia: { linea, telefono, nombre: dto.nombre ?? null },
    });
    return { ok: true, registrado: 'proveedor', avisada: !!cfg?.avisar_proveedores_a };
  }

  // Temas de plata no los toca el bot: se derivan al número que maneja pagos.
  // Un pago por WhatsApp se resuelve ADENTRO: el comprobante queda en "Cobros a
  // ingresar" para que el dueño lo apruebe (el mismo circuito que la caja), y
  // administración recibe el aviso por su propio WhatsApp con el comprobante
  // adjunto. Al cliente no se le da ningún otro número: hoy (2026-08-21) uno
  // que transfirió $631.717 pidió el alias dos veces y dos veces lo mandamos a
  // otro teléfono.
  async derivarPago(
    linea: 'pedidos' | 'proveedores',
    telefono: string,
    motivo: string,
    extra: { monto?: number; tipo?: string; comprobanteUrl?: string; dichoPorElCliente?: string } = {},
  ) {
    const { data: cfg } = await this.db
      .from('lineas_whatsapp').select('derivar_pagos_a, avisar_proveedores_a, alias_pago, titular_pago, banco_pago, cbu_pago').eq('linea', linea).eq('activa', true).limit(1).maybeSingle();
    const adminWsp = String(cfg?.derivar_pagos_a ?? '').replace(/\D/g, '');
    const monto = Number(extra.monto) || 0;
    const tipo = extra.tipo ?? 'consulta';

    // El alias es un dato de la casa: se da directo, sin pasar por nadie. El
    // comprobante que venga después entra por el circuito de aprobación.
    const alias = String((cfg as any)?.alias_pago ?? '').trim();
    if (tipo === 'quiere_pagar' && alias) {
      const titular = String((cfg as any)?.titular_pago ?? '').trim();
      const banco = String((cfg as any)?.banco_pago ?? '').trim();
      const cbu = String((cfg as any)?.cbu_pago ?? '').trim();
      const datos = `Alias: ${alias}${cbu ? ` · CBU: ${cbu}` : ''}${titular ? ` · Titular: ${titular}` : ''}${banco ? ` (${banco})` : ''}`;
      return {
        derivado: false,
        datosDePago: datos,
        respuestaFija: `${datos}. Cuando transfieras, mandame el comprobante por acá.`,
        aviso: 'Ya está: el código le manda los datos al cliente. No agregues nada.',
      };
    }
    const esComprobante = tipo === 'comprobante_enviado' && monto > 0;

    const ident = await this.identificarCliente(telefono).catch(() => null as any);
    const nombre = ident?.nombre ?? null;

    // 1) el comprobante entra al circuito de aprobación del dueño
    let cobranzaId: string | null = null;
    if (esComprobante && ident?.existe && ident.clienteId) {
      const { data: cob } = await this.db.from('cobranzas_pendientes').insert({
        cliente_id: ident.clienteId, monto, medio: 'transferencia',
        nota: `WhatsApp +${telefono}: ${motivo}${extra.comprobanteUrl ? ` · comprobante: ${extra.comprobanteUrl}` : ''}`,
        cargada_por: null,
      }).select('id').single();
      cobranzaId = cob?.id ?? null;
    }

    // 2) alerta en el panel
    await this.db.from('alertas_internas').insert({
      para_usuario: cfg?.avisar_proveedores_a ?? null,
      tipo: 'pago',
      titulo: esComprobante ? `Comprobante de $${Math.round(monto).toLocaleString('es-AR')} de ${nombre ?? bonitoTelefono(telefono)}` : `Consulta de pago de ${nombre ?? bonitoTelefono(telefono)}`,
      detalle: `${motivo}${extra.comprobanteUrl ? ` · ${extra.comprobanteUrl}` : ''}${cobranzaId ? ' · quedó en Cobros a ingresar' : ''}`,
      referencia: { linea, telefono, monto: monto || null, cobranzaId, comprobanteUrl: extra.comprobanteUrl ?? null },
    });

    // 3) WhatsApp interno a administración, desde la línea del bot
    let avisado = false;
    if (adminWsp.length >= 10) {
      const lineas = [
        esComprobante ? `💳 Comprobante recibido por WhatsApp` : tipo === 'quiere_pagar' ? `💳 Cliente quiere transferir: pasale los datos` : tipo === 'proveedor_factura' ? `🧾 Proveedor por una factura` : `💳 Consulta de pago`,
        `${nombre ? nombre + ' · ' : ''}+${telefono}`,
        monto > 0 ? `Monto: $${Math.round(monto).toLocaleString('es-AR')}` : null,
        motivo,
        extra.dichoPorElCliente && extra.dichoPorElCliente.trim() && extra.dichoPorElCliente.trim() !== motivo ? `El cliente escribió: "${extra.dichoPorElCliente.trim().slice(0, 300)}"` : null,
        cobranzaId ? `Quedó en Clientes → Cobros a ingresar para aprobar.` : null,
        `Respondele al cliente por RESPONDE (la charla está en la línea ${bonitoTelefono(telefono) ? 'de pedidos' : ''}).`,
      ].filter(Boolean).join('\n');
      // el comprobante viaja como lo mandó el cliente (la foto o el PDF), no
      // como un link: administración lo abre directo en el chat
      const url = String(extra.comprobanteUrl ?? '');
      const adjunto = /\.(jpe?g|png|webp)(\?|$)/i.test(url)
        ? { imagenUrl: url }
        : /\.pdf(\?|$)/i.test(url)
          ? { documentoUrl: url }
          : url ? null : undefined; // null = hay url pero sin formato conocido → va como link en el texto
      try {
        const env = await this.enviarPorWhatsapp({
          to: adminWsp,
          text: adjunto === null ? `${lineas}\nComprobante: ${url}` : lineas,
          ...(adjunto || {}),
          kind: 'aviso-interno',
        } as any);
        avisado = !!(env as any)?.enviado;
      } catch (e: any) {
        this.log.warn(`no pude avisar a administración por WhatsApp: ${e?.message ?? e}`);
      }
    }
    if (!avisado && adminWsp.length < 10) {
      await this.derivarAHumano(linea, telefono, `Tema de pago: ${motivo}`, true);
    }

    const queDecir = esComprobante
      ? 'Respondé exactamente "Recibido." y nada más.'
      : tipo === 'quiere_pagar'
        ? 'Respondé en una línea corta: "Le paso los datos por acá en un rato." NO inventes alias ni CBU.'
        : 'Respondé corto: "Recibido, le confirmo por acá."';
    return {
      derivado: true,
      cobranzaRegistrada: !!cobranzaId,
      aviso: `${queDecir} PROHIBIDO darle otro número de teléfono o decirle que escriba a otro lado: administración ya fue avisada por adentro${avisado ? ' (WhatsApp interno enviado)' : ''}.`,
    };
  }

  // Lo que el bot no sabe lo pregunta ADENTRO, no se lo confiesa al cliente.
  // "¿Llegan a Terra 812?" → el bot toma la dirección, le manda la consulta a
  // reparto por WhatsApp interno (con alerta en el panel) y le dice al cliente
  // "lo consulto con reparto y le confirmo por acá". Hoy (2026-08-21) dijo "no
  // puedo confirmar si llega a su zona" y el cliente canceló.
  async consultarInterno(linea: 'pedidos' | 'proveedores', telefono: string, area: string, consulta: string, direccion = '') {
    const { data: cfg } = await this.db
      .from('lineas_whatsapp').select('derivar_pagos_a, avisar_proveedores_a, whatsapp_reparto, whatsapp_compras').eq('linea', linea).eq('activa', true).limit(1).maybeSingle();
    const numeroDe: Record<string, string> = {
      reparto: String((cfg as any)?.whatsapp_reparto ?? cfg?.derivar_pagos_a ?? ''),
      compras: String((cfg as any)?.whatsapp_compras ?? cfg?.derivar_pagos_a ?? ''),
      administracion: String(cfg?.derivar_pagos_a ?? ''),
      local: String(cfg?.derivar_pagos_a ?? ''),
    };
    const destino = (numeroDe[area] ?? numeroDe.local).replace(/\D/g, '');
    const ident = await this.identificarCliente(telefono).catch(() => null as any);
    const nombre = ident?.nombre ?? null;
    const etiqueta = area === 'reparto' ? '🚚 Reparto' : area === 'compras' ? '🛒 Compras' : area === 'administracion' ? '💳 Administración' : '🏪 Local';

    await this.db.from('alertas_internas').insert({
      para_usuario: cfg?.avisar_proveedores_a ?? null,
      tipo: 'consulta',
      titulo: `${etiqueta}: ${nombre ?? bonitoTelefono(telefono)}`,
      detalle: `${consulta}${direccion ? ` · dirección: ${direccion}` : ''}`,
      referencia: { linea, telefono, area, direccion: direccion || null },
    }).then(() => null, () => null);
    await this.db.from('bot_notas_equipo').insert({ linea, telefono, nota: `[${area}] ${consulta}${direccion ? ` · ${direccion}` : ''}` }).then(() => null, () => null);

    // REGLA DEL DUEÑO (2026-09-01): los pedidos y las consultas de la operación
    // viven ADENTRO del sistema (campanita + notas), no salen por WhatsApp.
    // El WhatsApp interno queda reservado para pagos (derivarPago): comprobantes
    // y diferencias de plata, nada más.
    return {
      consultado: true,
      area,
      aviso: `Consulta registrada para ${area} adentro del sistema. Decile al cliente en UNA línea que lo consultás con ${area === 'reparto' ? 'reparto' : area} y que le confirmás por acá. No digas "no sé", "no puedo confirmar" ni "no estoy seguro", y no des plazos.`,
    };
  }

  // ---- Derivación a una persona (mismo circuito que el CRM de Car Cash) ----
  // El bot deja de contestar esa conversación, queda marcada en la bandeja y el
  // equipo recibe el aviso por WhatsApp. Sin esto, "te derivo al equipo" era una
  // promesa que no llegaba a ningún lado.
  async derivarAHumano(linea: 'pedidos' | 'proveedores', telefono: string, motivo: string, urgente = false) {
    const marca = {
      bot_activo: false,
      derivada_en: new Date().toISOString(),
      derivada_motivo: motivo || 'El cliente pidió hablar con una persona',
      resuelta_en: null,
      acuse_derivacion_en: null,
      // si nadie la toma en 20 minutos, el bot vuelve solo
      derivacion_vence_en: new Date(Date.now() + 20 * 60_000).toISOString(),
    };
    // OJO con el orden: la herramienta corre DENTRO del turno, y la conversación
    // recién se guarda al final. En el primer mensaje de un cliente nuevo la fila
    // todavía no existe, así que un update solo no marca nada y la derivación
    // quedaría en la nada (el bot avisa que derivó y no derivó).
    const { data: tocadas, error } = await this.db
      .from('bot_conversaciones')
      .update(marca)
      .eq('linea', linea)
      .eq('telefono', telefono)
      .select('telefono');
    if (error) this.log.warn(`No pude marcar la derivación de ${telefono}: ${error.message}`);
    if (!tocadas?.length) {
      const { error: errAlta } = await this.db
        .from('bot_conversaciones')
        .insert({ linea, telefono, mensajes: [], actualizado_en: new Date().toISOString(), ...marca });
      if (errAlta) this.log.warn(`No pude crear la conversación derivada de ${telefono}: ${errAlta.message}`);
    }

    // REGLA DEL DUEÑO (2026-09-01): las derivaciones (que muchas veces llevan el
    // detalle de un pedido) NO salen por WhatsApp: quedan en la campanita del
    // panel. El WhatsApp interno es solo para pagos.
    const { data: cfgAviso } = await this.db
      .from('lineas_whatsapp').select('avisar_proveedores_a').eq('linea', linea).eq('activa', true).limit(1).maybeSingle();
    await this.db.from('alertas_internas').insert({
      para_usuario: cfgAviso?.avisar_proveedores_a ?? null,
      tipo: 'derivacion',
      titulo: `${urgente ? '🔴' : '🟡'} Conversación derivada: ${bonitoTelefono(telefono)}`,
      detalle: `${motivo || 'El cliente pidió hablar con una persona'} · Contestarle desde RESPONDE.`,
      referencia: { linea, telefono, urgente },
    }).then(() => null, () => null);

    return { derivada: true, aviso: 'El equipo ya fue notificado por el sistema' };
  }

  // ---- Puente con RESPONDE (la app de MetoGroup en Netlify) ----
  // El cerebro de ODB atiende, pero cada charla queda escrita en RESPONDE para
  // que la app la muestre y la controle como a cualquier otro cliente. Y el
  // interruptor "bot activo / atendés vos" de RESPONDE manda: si Jackie pausa
  // desde la app, acá el bot se calla.
  private respondeCfg() {
    const url = process.env.RESPONDE_URL, key = process.env.RESPONDE_ANON_KEY, clave = process.env.RESPONDE_PUENTE_CLAVE;
    return url && key && clave ? { url: url.replace(/\/$/, ''), key, clave } : null;
  }

  private async respondeRpc(fn: string, args: Record<string, unknown>): Promise<any> {
    const cfg = this.respondeCfg();
    if (!cfg) return null;
    const ctrl = new AbortController();
    const reloj = setTimeout(() => ctrl.abort(), 8000);
    try {
      const r = await fetch(`${cfg.url}/rest/v1/rpc/${fn}`, {
        method: 'POST',
        headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_clave: cfg.clave, ...args }),
        signal: ctrl.signal,
      });
      if (!r.ok) { this.log.warn(`RESPONDE ${fn}: ${r.status}`); return null; }
      return await r.json();
    } catch (e) {
      this.log.warn(`RESPONDE ${fn} inalcanzable: ${e instanceof Error ? e.message : e}`);
      return null;
    } finally {
      clearTimeout(reloj);
    }
  }

  // ¿RESPONDE dice que en este chat atiende una persona?
  async respondeModoHumano(whatsappId: string): Promise<boolean> {
    const r = await this.respondeRpc('odb_estado_contacto', { p_whatsapp_id: whatsappId });
    return r?.modo_humano === true || r?.bloqueado === true;
  }

  // Deja el turno escrito en RESPONDE (best-effort: si falla, el bot igual atendió)
  async respondeRegistrar(
    whatsappId: string, nombre: string | null, textoCliente: string, textoBot: string | null, waMessageId?: string,
    media?: { tipo: 'image' | 'audio' | 'video' | 'document'; url: string } | null,
  ) {
    // con tipo + url, la app de RESPONDE dibuja la miniatura / el reproductor,
    // igual que hace con los archivos de Car Cash
    await this.respondeRpc('odb_registrar_turno', {
      p_whatsapp_id: whatsappId, p_nombre: nombre ?? '', p_texto_cliente: textoCliente,
      p_texto_bot: textoBot ?? '', p_wa_message_id: waMessageId ?? null,
      p_media_tipo: media?.tipo ?? null, p_media_url: media?.url ?? null,
    });
  }

  // Transcribe una nota de voz. Usa la API de transcripción estándar (la misma
  // forma en OpenAI y en Groq), así el dueño elige proveedor sin tocar código:
  //   TRANSCRIPCION_KEY   — la clave (lo único obligatorio)
  //   TRANSCRIPCION_URL   — por defecto OpenAI; para Groq:
  //                         https://api.groq.com/openai/v1/audio/transcriptions
  //   TRANSCRIPCION_MODELO— por defecto whisper-1 (Groq: whisper-large-v3-turbo)
  // Si no hay clave, devuelve null y el audio se deriva a una persona como antes.
  async transcribirAudio(base64: string, mime: string): Promise<string | null> {
    const key = process.env.TRANSCRIPCION_KEY;
    if (!key) return null;
    const url = process.env.TRANSCRIPCION_URL || 'https://api.openai.com/v1/audio/transcriptions';
    const modelo = process.env.TRANSCRIPCION_MODELO || 'whisper-1';
    try {
      const bin = Buffer.from(base64, 'base64');
      const ext = /ogg/.test(mime) ? 'ogg' : /mpeg|mp3/.test(mime) ? 'mp3' : /wav/.test(mime) ? 'wav' : /mp4|m4a/.test(mime) ? 'm4a' : 'ogg';
      const fd = new FormData();
      fd.append('file', new Blob([new Uint8Array(bin)], { type: mime || 'audio/ogg' }), `audio.${ext}`);
      fd.append('model', modelo);
      fd.append('language', 'es');
      // el vocabulario del negocio ayuda mucho con marcas y medidas
      fd.append('prompt', 'Pedido de bebidas en Argentina: fernet, Branca, Quilmes, Coca Cola, Sprite, Aquarius, Malbec, espumante, cajón, botella, litro, docena, Canning, Sant Thomas, Santa Inés.');
      const r = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: fd, signal: AbortSignal.timeout(45000) });
      if (!r.ok) { this.log.warn(`transcripción falló (${r.status}): ${(await r.text().catch(() => '')).slice(0, 160)}`); return null; }
      const j: any = await r.json();
      const texto = String(j?.text ?? '').trim();
      return texto || null;
    } catch (e: any) {
      this.log.warn(`transcripción falló: ${e?.message ?? e}`);
      return null;
    }
  }

  // Baja el archivo que mandó el cliente desde WAHA (foto, audio, documento).
  // WAHA lo publica en payload.media.url; hay que pedirlo con la API key.
  private async bajarMediaWaha(p: any): Promise<{ base64: string; mime: string; nombre: string } | null> {
    let url = p?.media?.url ?? p?._data?.media?.url;
    this.log.log(`media url de WAHA: ${String(url ?? '').slice(0, 160)} · mime=${p?.media?.mimetype ?? '?'}`);
    // WAHA arma el enlace con SU hostname (localhost:3000 si no tiene configurada
    // la URL pública). Ese enlace no existe fuera de su contenedor: se reemplaza
    // por la dirección real del servicio, que es la misma que usamos para enviar.
    if (url && process.env.WAHA_URL) {
      try {
        const u = new URL(String(url));
        if (/localhost|127\.0\.0\.1|0\.0\.0\.0/.test(u.hostname)) {
          url = `${process.env.WAHA_URL.replace(/\/$/, '')}${u.pathname}${u.search}`;
          this.log.log(`media url reescrita a ${String(url).slice(0, 120)}`);
        }
      } catch { /* se usa tal cual */ }
    }
    if (!url) {
      // sin esto no hay forma de saber por qué no llegó el archivo
      this.log.warn(`WAHA no mandó el archivo. media=${JSON.stringify(p?.media ?? null)} · claves del payload: ${Object.keys(p ?? {}).join(',')}`);
      return null;
    }
    try {
      const mimeCrudo = String(p?.media?.mimetype ?? '');
      const esAudioOgg = /audio\/(ogg|oga)|opus/.test(mimeCrudo) || /\.oga?$|\.ogg$/i.test(String(url));
      let buf: Buffer | null = null;
      // WAHA convierte el audio EN EL MOMENTO: si se baja apenas llega el
      // webhook, el archivo suele estar a medio escribir y queda cortado
      // (2026-09-01: todos los audios guardados estaban truncados, se
      // escuchaban por la mitad y la transcripción leía solo el principio).
      // Se baja, se verifica el cierre del OGG y se reintenta hasta tenerlo
      // completo; si nunca cierra, va la mejor versión que se consiguió.
      for (let intento = 1; intento <= 5; intento++) {
        const r = await fetch(String(url), { headers: { 'X-Api-Key': process.env.WAHA_API_KEY ?? '' }, signal: AbortSignal.timeout(12000) });
        if (!r.ok) {
          if (buf) break; // ya tenemos una versión: se usa esa
          this.log.warn(`no pude bajar el archivo de WAHA (${r.status}): ${String(url).slice(0, 120)}`);
          return null;
        }
        const intentoBuf = Buffer.from(await r.arrayBuffer());
        if (!buf || intentoBuf.length >= buf.length) buf = intentoBuf;
        if (!esAudioOgg || oggCompleto(intentoBuf)) break;
        this.log.warn(`audio todavía a medio escribir en WAHA (${intentoBuf.length} bytes, intento ${intento}): espero y reintento`);
        await new Promise((res) => setTimeout(res, 1500));
      }
      if (!buf) return null;
      if (esAudioOgg && !oggCompleto(buf)) this.log.warn(`audio quedó SIN cierre tras los reintentos (${buf.length} bytes): va igual, puede estar cortado`);
      this.log.log(`archivo bajado de WAHA: ${buf.length} bytes · ${p?.media?.mimetype ?? '?'}`);
      if (buf.length > 4.5 * 1024 * 1024) { this.log.warn(`archivo demasiado grande (${buf.length} bytes): no va al modelo`); return null; }
      const mime = String(p?.media?.mimetype ?? 'application/octet-stream').split(';')[0];
      const nombre = String(p?.media?.filename ?? url.split('/').pop() ?? 'archivo');
      return { base64: buf.toString('base64'), mime, nombre };
    } catch (e: any) {
      this.log.warn(`bajada del archivo falló: ${e?.name ?? ''} ${e?.message ?? e}`);
      return null;
    }
  }

  // ---- Entrada desde WAHA ----
  // WAHA le pega directo acá con su formato nativo. El sistema traduce, piensa
  // y despacha la respuesta por el mismo camino. Sin escalas: un salto menos es
  // un lugar menos donde se pierden mensajes.
  async webhookWaha(evento: any, numeroLinea?: string) {
    // solo mensajes entrantes de personas
    if (evento?.event !== 'message') return { ignorado: 'no es un mensaje' };
    const p = evento.payload ?? {};
    if (p.fromMe === true) return { ignorado: 'lo mandamos nosotros' };

    const desde = String(p.from ?? '');
    if (!desde) return { ignorado: 'sin remitente' };
    // los grupos no se atienden por bot: un pedido de un grupo es un lío
    if (desde.endsWith('@g.us')) return { ignorado: 'es un grupo' };

    // OJO con @lid: es el id de privacidad de WhatsApp cuando el contacto oculta
    // su número. NO es un teléfono marcable y hay que devolverlo TAL CUAL al
    // responder — armar "digitos@c.us" con un lid hace que el mensaje no llegue.
    const esLid = desde.endsWith('@lid');
    const identidad = esLid ? desde : desde.split('@')[0].replace(/\D/g, '');
    if (!identidad) return { ignorado: 'remitente ilegible' };

    // Si la carga trae el teléfono marcable, se guarda pegado al @lid. Es lo
    // único que después permite reconocer a la gente de la casa, porque el @lid
    // por sí solo no dice nada. Se hace una vez por contacto y no frena nada.
    const real = this.telefonoDeLaCarga(p);
    // La clave es la misma que usa el resto del sistema: charla() le saca todo
    // lo que no sea dígito, así que el contacto se guarda igual o no se
    // encuentra nunca.
    const claveContacto = identidad.replace(/\D/g, '');
    if (real && esLid && claveContacto) {
      const { data: yaEsta } = await this.db
        .from('bot_contactos').select('telefono_real').eq('telefono', claveContacto).maybeSingle();
      if ((yaEsta as any)?.telefono_real !== real.numero) {
        this.log.log(`teléfono real aprendido para ${claveContacto} desde ${real.campo}`);
        await this.db.from('bot_contactos').upsert(
          { telefono: claveContacto, telefono_real: real.numero, actualizado_en: new Date().toISOString() },
          { onConflict: 'telefono' },
        ).then(() => null, () => null);
      }
    } else if (esLid) {
      // Sin el número no se puede reconocer a nadie: queda constancia de qué
      // trae el mensaje, para no diagnosticar a ciegas la próxima vez.
      this.log.log(`@lid sin teléfono en la carga · _data=${Object.keys(p?._data ?? {}).join(',')} · key=${Object.keys(p?._data?.key ?? {}).join(',')}`);
    }

    let texto = String(p.body ?? '').trim();
    const tipo = String(p.type ?? p._data?.type ?? '').toLowerCase();
    // Una línea por mensaje entrante: es lo único que permite arreglar el tema de
    // los adjuntos con datos y no a ciegas.
    this.log.log(
      `waha entrante · type=${tipo || '?'} · hasMedia=${p.hasMedia ?? '?'} · media=${p.media ? Object.keys(p.media).join('/') : 'no'} · body=${JSON.stringify(texto.slice(0, 60))} · claves=${Object.keys(p).join(',')}`,
    );
    // Un adjunto es un adjunto AUNQUE traiga texto: WhatsApp manda el nombre del
    // archivo (o el epígrafe de la foto) en el cuerpo, y con la condición vieja
    // (!texto) el mensaje se trataba como si el cliente hubiera escrito "lista.pdf".
    const esMedia = !!p.hasMedia || !!p.media || ['ptt', 'audio', 'image', 'video', 'document', 'sticker'].includes(tipo);
    // lo que el cliente escribió junto al archivo (si el body es el nombre del archivo, no cuenta)
    const epigrafe = String(p.caption ?? p._data?.caption ?? (esMedia && !/\.[a-z0-9]{2,5}$/i.test(texto) ? texto : '')).trim();
    if (esMedia) {
      const waIdM = esLid ? desde : identidad;
      const media = await this.bajarMediaWaha(p);
      const esImagen = /^image\//.test(media?.mime ?? '') || tipo === 'image';
      const esAudio = ['ptt', 'audio'].includes(tipo) || /^audio\//.test(media?.mime ?? '');

      // Todo lo que manda el cliente se guarda y viaja al monitor con su enlace:
      // "[el cliente mandó un archivo]" a secas no le sirve a nadie.
      let enlacePublico = '';
      if (media) {
        try {
          const ext = (media.nombre.match(/\.[a-z0-9]{2,4}$/i)?.[0]) || (esImagen ? '.jpg' : esAudio ? '.ogg' : '');
          const ruta = `whatsapp/${identidad}/${Date.now()}${ext}`;
          const { error } = await this.db.storage.from('publico').upload(ruta, Buffer.from(media.base64, 'base64'), { contentType: media.mime, upsert: true });
          if (!error) enlacePublico = this.db.storage.from('publico').getPublicUrl(ruta).data.publicUrl;
        } catch { /* sin enlace: el mensaje igual llega */ }
      }
      // el texto va limpio; el archivo viaja aparte como media (tipo + url)
      const etiqueta = (queEsTexto: string) => queEsTexto;
      const tipoMedia: 'image' | 'audio' | 'video' | 'document' = esImagen ? 'image' : esAudio ? 'audio' : tipo === 'video' || /^video\//.test(media?.mime ?? '') ? 'video' : 'document';
      const mediaReg = enlacePublico ? { tipo: tipoMedia, url: enlacePublico } : null;

      // FOTO o PDF: el bot lo mira/lee y contesta sobre lo que dice.
      const esPdf = (media?.mime === 'application/pdf' || /\.pdf$/i.test(media?.nombre ?? '')) && (media?.base64.length ?? Infinity) < 20_000_000;
      if ((esImagen || esPdf) && media) {
        const rotulo = esImagen ? '📷 Foto del cliente' : '📄 PDF del cliente';
        if (await this.respondeModoHumano(waIdM).catch(() => false)) {
          await this.respondeRegistrar(waIdM, p._data?.notifyName ?? p.notifyName ?? null, etiqueta(rotulo), null, p.id ? String(p.id) : undefined, mediaReg).catch(() => null);
          return { contestado: false, motivo: 'RESPONDE: atiende una persona' };
        }
        const r: any = await this.charla({
          numeroLinea, telefono: identidad,
          mensaje: epigrafe,
          archivoBase64: media.base64, mimeType: esPdf && !esImagen ? 'application/pdf' : media.mime,
          archivoUrl: enlacePublico || undefined,
          mensajeId: p.id ? String(p.id) : undefined,
        });
        if (!r?.respuesta) {
          await this.respondeRegistrar(waIdM, p.notifyName ?? null, etiqueta(rotulo), null, p.id ? String(p.id) : undefined, mediaReg).catch(() => null);
          return { contestado: false, motivo: 'sin respuesta' };
        }
        await this.simularEscritura(desde, r.respuesta);
        const env = await this.enviarPorWhatsapp({ to: desde, text: r.respuesta, referencia: `waha/${identidad}` });
        this.respondeRegistrar(waIdM, p.notifyName ?? null, etiqueta(`${rotulo}${epigrafe ? `: ${epigrafe}` : ''}`), r.respuesta, p.id ? String(p.id) : undefined, mediaReg).catch(() => null);
        return { contestado: env.enviado, motivo: esImagen ? 'foto mirada por el bot' : 'pdf leído por el bot' };
      }

      // VIDEO: WhatsApp casi siempre manda la vista previa (el primer cuadro).
      // Con eso el bot puede responder de qué se trata; si no la trae, sigue el
      // camino de siempre (lo abre una persona). Jamás "no puedo ver videos".
      const esVideo = tipo === 'video' || /^video\//.test(media?.mime ?? '');
      if (esVideo) {
        const miniatura = [p._data?.jpegThumbnail, p._data?.message?.videoMessage?.jpegThumbnail, p.media?.preview]
          .find((x: any) => typeof x === 'string' && x.length > 100);
        if (miniatura && !(await this.respondeModoHumano(waIdM).catch(() => false))) {
          const r: any = await this.charla({
            numeroLinea, telefono: identidad,
            mensaje: epigrafe,
            archivoBase64: miniatura, mimeType: 'image/jpeg', vistaPreviaDeVideo: true,
            archivoUrl: enlacePublico || undefined,
            mensajeId: p.id ? String(p.id) : undefined,
          }).catch(() => null);
          if (r?.respuesta) {
            await this.simularEscritura(desde, r.respuesta);
            const env = await this.enviarPorWhatsapp({ to: desde, text: r.respuesta, referencia: `waha/${identidad}` });
            this.respondeRegistrar(waIdM, p.notifyName ?? null, etiqueta(`🎬 Video del cliente${epigrafe ? `: ${epigrafe}` : ''}`), r.respuesta, p.id ? String(p.id) : undefined, mediaReg).catch(() => null);
            return { contestado: env.enviado, motivo: 'video interpretado por su vista previa' };
          }
        }
      }

      // AUDIO: si hay transcripción configurada, se escucha y se atiende como
      // cualquier mensaje. El cliente ni se entera de que era un audio.
      if (esAudio && media) {
        const dicho = await this.transcribirAudio(media.base64, media.mime);
        if (dicho) {
          this.log.log(`audio transcripto de ${identidad}: "${dicho.slice(0, 80)}"`);
          if (await this.respondeModoHumano(waIdM).catch(() => false)) {
            await this.respondeRegistrar(waIdM, p._data?.notifyName ?? p.notifyName ?? null, etiqueta(`🎙️ ${dicho}`), null, p.id ? String(p.id) : undefined, mediaReg).catch(() => null);
            return { contestado: false, motivo: 'RESPONDE: atiende una persona' };
          }
          const r: any = await this.charla({ numeroLinea, telefono: identidad, mensaje: dicho, mensajeId: p.id ? String(p.id) : undefined });
          if (!r?.respuesta) {
            await this.respondeRegistrar(waIdM, p.notifyName ?? null, etiqueta(`🎙️ ${dicho}`), null, p.id ? String(p.id) : undefined, mediaReg).catch(() => null);
            return { contestado: false, motivo: r?.derivada ? 'derivada a una persona' : 'sin respuesta' };
          }
          await this.simularEscritura(desde, r.respuesta);
          const env = await this.enviarPorWhatsapp({ to: desde, text: r.respuesta, referencia: `waha/${identidad}` });
          this.respondeRegistrar(waIdM, p.notifyName ?? null, etiqueta(`🎙️ ${dicho}`), r.respuesta, p.id ? String(p.id) : undefined, mediaReg).catch(() => null);
          return { contestado: env.enviado, motivo: 'audio escuchado y contestado' };
        }
      }

      // AUDIO sin transcripción, o cualquier otro archivo: el bot no lo abre,
      // pero UNA PERSONA SÍ. Se guarda
      // el archivo, se deja el enlace en la nota del equipo y se deriva, para
      // que alguien lo abra y responda. Al cliente no se le dice "no puedo".
      const queEs = esAudio ? 'un audio' : tipo === 'video' ? 'un video' : 'un archivo';
      const enlace = enlacePublico;
      const icono = esAudio ? '🎙️ Audio del cliente' : tipo === 'video' ? '🎬 Video del cliente' : `📄 ${media?.nombre || 'Archivo'} del cliente`;
      await this.respondeRegistrar(waIdM, p._data?.notifyName ?? p.notifyName ?? null, etiqueta(icono), null, p.id ? String(p.id) : undefined, mediaReg).catch(() => null);
      if (await this.respondeModoHumano(waIdM).catch(() => false)) return { contestado: false, motivo: 'RESPONDE: atiende una persona' };

      await this.db.from('bot_notas_equipo').insert({ linea: 'pedidos', telefono: identidad, nota: `El cliente mandó ${queEs} por WhatsApp. Hay que escucharlo/abrirlo y responderle.${enlace ? ` Archivo: ${enlace}` : ''}` }).then(() => null, () => null);
      const { data: cfg } = await this.db.from('lineas_whatsapp').select('avisar_proveedores_a').eq('linea', 'pedidos').eq('activa', true).limit(1).maybeSingle();
      await this.db.from('alertas_internas').insert({ para_usuario: cfg?.avisar_proveedores_a ?? null, tipo: 'derivacion', titulo: `Mensaje de voz de +${identidad}`, detalle: `El cliente mandó ${queEs}. Escuchalo y respondele por WhatsApp.${enlace ? ` ${enlace}` : ''}`, referencia: { linea: 'pedidos', telefono: identidad, enlace } }).then(() => null, () => null);

      const { data: conv } = await this.db.from('bot_conversaciones').select('mensajes').eq('linea', 'pedidos').eq('telefono', identidad).maybeSingle();
      const hist: any[] = Array.isArray(conv?.mensajes) ? conv!.mensajes : [];
      // marca fija en el historial: chequear por palabras fallaba y el cliente
      // recibía el mismo acuse por cada archivo que mandaba
      const MARCA = '[acuse-archivo] ';
      const yaAviso = hist.slice(-8).some((m: any) => m.role === 'assistant' && String(m.content).startsWith(MARCA));
      await this.db.from('bot_conversaciones').upsert({
        linea: 'pedidos', telefono: identidad,
        mensajes: [...hist, { role: 'user', content: `[el cliente mandó ${queEs}]` }, ...(yaAviso ? [] : [{ role: 'assistant', content: MARCA + (esAudio ? 'Recibí tu audio: lo escucha alguien de la casa.' : 'Recibí tu archivo: lo revisa alguien de la casa.') }]),
        ].slice(-40),
        actualizado_en: new Date().toISOString(), bot_activo: false,
        derivada_en: new Date().toISOString(), derivada_motivo: `El cliente mandó ${queEs}: hay que escucharlo/abrirlo`, resuelta_en: null,
      }, { onConflict: 'linea,telefono' }).then(() => null, () => null);
      if (yaAviso) return { contestado: false, motivo: `${queEs}: ya avisado, derivado` };
      const aviso = esAudio
        ? 'Recibí tu audio. Tomo tu mensaje y doy aviso al sector correspondiente para que lo escuchen. Si preferís, escribime lo que necesitás y te lo resuelvo ahora.'
        : 'Recibí tu archivo. Tomo lo que mandaste y doy aviso al sector correspondiente. Si preferís, escribime lo que necesitás y te lo resuelvo ahora.';
      await this.simularEscritura(desde, aviso);
      const env = await this.enviarPorWhatsapp({ to: desde, text: aviso, referencia: `waha/${identidad}` });
      this.respondeRegistrar(waIdM, p.notifyName ?? null, etiqueta(icono), aviso, undefined, mediaReg).catch(() => null);
      return { contestado: env.enviado, motivo: `${queEs}: derivado a una persona` };
    }
    if (!texto) return { ignorado: 'mensaje sin texto' };

    // whatsapp_id como lo guarda RESPONDE: solo dígitos para números normales,
    // el @lid completo para contactos con número oculto
    const waId = esLid ? desde : identidad;

    // Si en RESPONDE la charla está en "atendés vos", el bot se calla: el mensaje
    // igual queda registrado allá para que la persona lo vea.
    if (await this.respondeModoHumano(waId)) {
      await this.respondeRegistrar(waId, p._data?.notifyName ?? p.notifyName ?? null, texto, null, p.id ? String(p.id) : undefined);
      return { contestado: false, motivo: 'RESPONDE: atiende una persona' };
    }

    const r: any = await this.charla({
      numeroLinea,
      telefono: identidad,
      mensaje: texto,
      mensajeId: p.id ? String(p.id) : undefined,
    });

    // La conversación puede estar en manos de una persona: ahí el bot se calla.
    if (!r?.respuesta) {
      await this.respondeRegistrar(waId, p.notifyName ?? null, texto, null, p.id ? String(p.id) : undefined);
      return { contestado: false, motivo: r?.derivada ? 'derivada a una persona' : 'sin respuesta' };
    }

    // Ritmo humano: nadie contesta un párrafo en 0,3 segundos. Se muestra
    // "escribiendo…" y se espera un tiempo proporcional al largo de la respuesta
    // (entre 2 y 8 segundos) antes de despachar. Un bot instantáneo se siente
    // como bot; uno que "escribe" se siente atendido.
    await this.simularEscritura(desde, r.respuesta);
    // listado largo → cartel con pie de foto; si algo falla, va el texto igual
    const cartel = (await this.cartelDePedido(r.respuesta)) ?? (await this.cartelDeListado(r.respuesta));
    let envio = cartel
      ? await this.enviarPorWhatsapp({ to: desde, imagenUrl: cartel.imagenUrl, text: cartel.pie, referencia: `waha/${identidad}` })
      : { enviado: false, motivo: 'sin cartel' } as any;
    if (!envio.enviado) {
      if (cartel) this.log.warn(`el cartel no se pudo enviar (${envio.motivo}): va como texto`);
      envio = await this.enviarPorWhatsapp({ to: desde, text: r.respuesta, referencia: `waha/${identidad}` });
    }
    // el turno completo queda en RESPONDE (best-effort, no bloquea la respuesta)
    this.respondeRegistrar(waId, p.notifyName ?? null, texto, r.respuesta, p.id ? String(p.id) : undefined).catch(() => null);
    return { contestado: envio.enviado, ...envio };
  }

  // "escribiendo…" en WhatsApp + pausa proporcional al texto (2 a 8 s). Si WAHA
  // no está configurado (local), solo espera. Nunca falla: es cosmético.
  // Un listado de precios se manda como CARTEL, no como párrafo: los
  // proveedores les mandan flyers y así es como la gente mira precios en
  // WhatsApp. El texto del listado se saca del pie de foto (ya está en la
  // imagen) y quedan la introducción, el total y la pregunta.
  //
  // Se arma a partir del texto YA formateado por prolijo(), que garantiza una
  // línea por producto: por eso volver a leerlo es confiable y no adivina nada.
  // El pedido confirmado sale como TARJETA, no como texto suelto: renglón por
  // renglón, el total y el código de retiro bien grandes. Es lo que el cliente
  // guarda y muestra en el mostrador. Se dispara cuando la respuesta trae un
  // código de pedido y al menos un renglón con precio — a diferencia del
  // listado, acá UNA sola línea ya amerita la tarjeta.
  private async cartelDePedido(respuesta: string): Promise<{ imagenUrl: string; pie: string } | null> {
    const codigo = respuesta.match(/\b(?:DOM|RET|PICKUP)-[A-Z0-9]{4,10}\b/)?.[0];
    if (!codigo) return null;

    const lineas = respuesta.split('\n');
    const renglones = lineas
      .map((l) => l.trim())
      .filter((l) => l.startsWith('•'))
      .map((l) => {
        const sinVineta = l.replace(/^•\s*/, '');
        // "2 × Fernet Branca 750 cc — $20.500 c/u = $41.000" → nombre + importe final
        const m = sinVineta.match(/^(.*?)[\s—:-]*\$\s?([\d.]+)(?:\s*c\/u)?(?:\s*=\s*\$\s?([\d.]+))?\s*$/);
        if (!m) return null;
        return { nombre: m[1].replace(/[—:-]\s*$/, '').trim(), precio: `$${m[3] ?? m[2]}` };
      })
      .filter((x): x is { nombre: string; precio: string } => !!x && !!x.precio);
    if (!renglones.length) return null;

    const total = respuesta.match(/\*?\s*total[^:\n]{0,20}:\s*(\$\s?[\d.]+)\s*\*?/i)?.[1]?.replace(/\s+/g, ' ') ?? null;

    try {
      const png = await cartelPrecios({
        titulo: `Pedido ${codigo}`,
        renglones,
        total,
        pie: 'Presentá este código al retirar o al recibir tu pedido.',
      });
      const ruta = `carteles/${new Date().toISOString().slice(0, 7)}/pedido-${codigo}-${Date.now()}.png`;
      const { error } = await this.db.storage.from('publico').upload(ruta, png, { contentType: 'image/png' });
      if (error) return null;
      const imagenUrl = this.db.storage.from('publico').getPublicUrl(ruta).data.publicUrl;
      // el texto viaja como epígrafe de la tarjeta: lo que no son renglones
      const pie = lineas.map((l) => l.trim()).filter((l) => l && !l.startsWith('•')).join(' ').replace(/\s{2,}/g, ' ').slice(0, 400);
      return { imagenUrl, pie: pie || `Pedido confirmado: ${codigo}.` };
    } catch (e) {
      this.log.warn(`cartel de pedido falló (${codigo}): ${e instanceof Error ? e.message : e}`);
      return null;
    }
  }

  private async cartelDeListado(respuesta: string): Promise<{ imagenUrl: string; pie: string } | null> {
    const lineas = respuesta.split('\n');
    const items = lineas
      .map((l, i) => ({ l: l.trim(), i }))
      .filter((x) => x.l.startsWith('•') && /\$\s?[\d.]+/.test(x.l));
    if (items.length < 4) return null; // con pocos, el texto se lee mejor

    const renglones = items.map((x) => {
      const sinVineta = x.l.replace(/^•\s*/, '');
      const m = sinVineta.match(/^(.*?)[\s—:-]*(\$\s?[\d.]+(?:\s*c\/u)?(?:\s*=\s*\$[\d.]+)?)\s*$/);
      if (!m) return { nombre: sinVineta, precio: '' };
      return { nombre: m[1].replace(/[—:-]\s*$/, '').trim(), precio: m[2].replace(/\s+/g, ' ').trim() };
    }).filter((r) => r.precio);
    if (renglones.length < 4) return null;

    // título: la línea con ":" justo antes del listado ("Tenemos, por ejemplo:")
    const antes = lineas.slice(0, items[0].i).map((l) => l.trim()).filter(Boolean);
    const conDosPuntos = [...antes].reverse().find((l) => l.endsWith(':'));
    let titulo = (conDosPuntos ?? 'Precios').replace(/:$/, '').trim();
    if (titulo.length > 44 || titulo.length < 3) titulo = 'Precios';

    const mTotal = respuesta.match(/\*?total[^:\n]{0,20}:\s*(\$\s?[\d.]+)\*?/i);
    const hoy = new Date().toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', timeZone: 'America/Argentina/Buenos_Aires' });

    try {
      const png = await cartelPrecios({
        titulo,
        renglones,
        total: mTotal ? mTotal[1].replace(/\s/g, '') : null,
        pie: `Precios al ${hoy} · Sant Thomas, Castex 3601`,
      });
      const ruta = `carteles/${new Date().toISOString().slice(0, 7)}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
      const { error } = await this.db.storage.from('publico').upload(ruta, png, { contentType: 'image/png', upsert: true });
      if (error) { this.log.warn(`no pude subir el cartel: ${error.message}`); return null; }
      const imagenUrl = this.db.storage.from('publico').getPublicUrl(ruta).data.publicUrl;

      // el pie de foto se queda con todo MENOS los renglones del listado
      const descartar = new Set(items.map((x) => x.i));
      const pie = lineas.filter((_l, i) => !descartar.has(i)).join('\n').replace(/\n{3,}/g, '\n\n').trim();
      return { imagenUrl, pie: pie || 'Le dejo los precios.' };
    } catch (e: any) {
      this.log.warn(`no pude armar el cartel: ${e?.message ?? e}`);
      return null;
    }
  }

  private async simularEscritura(to: string, texto: string) {
    const wahaUrl = process.env.WAHA_URL, wahaKey = process.env.WAHA_API_KEY;
    const sesion = process.env.WAHA_SESSION || 'default';
    const crudo = String(to ?? ''); const digitos = crudo.replace(/\D/g, '');
    const chatId = crudo.includes('@') ? crudo.split(':')[0] : digitos ? `${digitos}@c.us` : null;
    // ~40 caracteres por segundo, con piso y techo
    const ms = Math.min(8000, Math.max(2000, Math.round((texto?.length ?? 0) / 40) * 1000));
    const post = async (ruta: string) => {
      if (!wahaUrl || !wahaKey || !chatId) return;
      try {
        await fetch(`${wahaUrl.replace(/\/$/, '')}${ruta}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Api-Key': wahaKey },
          body: JSON.stringify({ session: sesion, chatId }), signal: AbortSignal.timeout(4000),
        });
      } catch { /* cosmético */ }
    };
    await post('/api/startTyping');
    await new Promise((r) => setTimeout(r, ms));
    await post('/api/stopTyping');
  }

  // ---- Salida de WhatsApp (mismo camino que el CRM de CarCash) ----
  // El sistema despacha por WAHA, una instancia propia que maneja la sesión de
  // WhatsApp del negocio. No pasa por Meta: no hay plantillas, ni ventana de 24
  // horas, ni phone_number_id. Si WAHA no está configurado, cae al webhook de
  // n8n como camino viejo.
  //
  // WAHA identifica los chats por chatId: "<digitos>@c.us". Los contactos con
  // número oculto por privacidad llegan como "<id>@lid" y hay que devolverlos
  // TAL CUAL, si no el mensaje no encuentra al destinatario.
  async enviarPorWhatsapp(payload: {
    to: string;
    text?: string | null;
    audioUrl?: string | null;
    imagenUrl?: string | null;
    documentoUrl?: string | null; // un PDF u otro archivo: viaja como documento adjunto
    kind?: string;
    referencia?: string | null;
  }) {
    const wahaUrl = process.env.WAHA_URL;
    const wahaKey = process.env.WAHA_API_KEY;
    const sesion = process.env.WAHA_SESSION || 'default';

    const crudo = String(payload.to ?? '');
    const digitos = crudo.replace(/\D/g, '');
    const chatId = crudo.includes('@') ? crudo.split(':')[0] : digitos ? `${digitos}@c.us` : null;
    if (!chatId) return { enviado: false, motivo: 'Número inválido' };

    if (wahaUrl && wahaKey) {
      const base = wahaUrl.replace(/\/$/, '');
      const cabeceras = { 'Content-Type': 'application/json', 'X-Api-Key': wahaKey };
      const postear = async (ruta: string, cuerpo: any) => {
        const ctrl = new AbortController();
        const reloj = setTimeout(() => ctrl.abort(), 15_000);
        try {
          const r = await fetch(`${base}${ruta}`, {
            method: 'POST',
            headers: cabeceras,
            body: JSON.stringify(cuerpo),
            signal: ctrl.signal,
          });
          const cuerpoRes: any = await r.json().catch(() => ({}));
          return { ok: r.ok, estado: r.status, cuerpo: cuerpoRes };
        } finally {
          clearTimeout(reloj);
        }
      };

      try {
        if (payload.documentoUrl) {
          const nombre = String(payload.documentoUrl).split('/').pop()!.split('?')[0] || 'archivo.pdf';
          const esPdf = /\.pdf$/i.test(nombre);
          const r = await postear('/api/sendFile', {
            session: sesion,
            chatId,
            file: { url: payload.documentoUrl, mimetype: esPdf ? 'application/pdf' : 'application/octet-stream', filename: nombre },
            caption: payload.text || '',
          });
          if (!r.ok) return { enviado: false, motivo: `WAHA sendFile ${r.estado}` };
          return { enviado: true, via: 'waha', id: r.cuerpo?.id ?? null };
        }

        if (payload.imagenUrl) {
          const ext = String(payload.imagenUrl).split('.').pop()!.toLowerCase().split('?')[0];
          const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
          const r = await postear('/api/sendImage', {
            session: sesion,
            chatId,
            file: { url: payload.imagenUrl, mimetype: mime, filename: `foto.${ext || 'jpg'}` },
            caption: payload.text || '',
          });
          if (!r.ok) return { enviado: false, motivo: `WAHA sendImage ${r.estado}` };
          return { enviado: true, via: 'waha', id: r.cuerpo?.id ?? null };
        }

        const esAudio = !!payload.audioUrl;
        const cuerpo = esAudio
          ? {
              session: sesion,
              chatId,
              file: {
                url: payload.audioUrl,
                mimetype: payload.audioUrl!.includes('.webm')
                  ? 'audio/webm; codecs=opus'
                  : 'audio/ogg; codecs=opus',
                filename: `nota-de-voz${payload.audioUrl!.includes('.webm') ? '.webm' : '.ogg'}`,
              },
            }
          : { session: sesion, chatId, text: payload.text ?? '' };

        const r = await postear(esAudio ? '/api/sendVoice' : '/api/sendText', cuerpo);
        if (!r.ok) {
          // WhatsApp solo reproduce notas de voz en OGG/Opus. Si rechaza el audio
          // (típico de un WebM de Android), se reintenta como archivo adjunto:
          // llega peor, pero llega, en vez de perderse en silencio.
          if (esAudio) {
            const alt = await postear('/api/sendFile', { ...cuerpo, caption: '🎤 Nota de voz' });
            if (alt.ok) return { enviado: true, via: 'waha', comoArchivo: true, id: alt.cuerpo?.id ?? null };
          }
          return { enviado: false, motivo: `WAHA respondió ${r.estado}` };
        }
        const id = r.cuerpo?.id ?? r.cuerpo?.key?.id ?? r.cuerpo?._data?.id?.id ?? null;
        // sin id no hay prueba de que haya salido: se reporta como falla
        if (esAudio && !id) return { enviado: false, motivo: 'WhatsApp no confirmó la nota de voz' };
        return { enviado: true, via: 'waha', id };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        this.log.warn(`No se pudo contactar a WAHA: ${msg}`);
        return { enviado: false, motivo: `WAHA inalcanzable: ${msg}` };
      }
    }

    // ---- camino viejo: webhook de n8n ----
    const url = process.env.N8N_WSP_SEND_URL;
    if (!url) {
      this.log.warn('WhatsApp sin conectar: falta WAHA_URL o N8N_WSP_SEND_URL');
      return { enviado: false, motivo: 'WhatsApp no conectado' };
    }
    const ctrl = new AbortController();
    const reloj = setTimeout(() => ctrl.abort(), 10_000);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(process.env.N8N_WEBHOOK_TOKEN ? { 'X-MetoGroup-Secret': process.env.N8N_WEBHOOK_TOKEN } : {}),
        },
        body: JSON.stringify({
          to: payload.to,
          type: payload.audioUrl ? 'audio' : 'text',
          text: payload.audioUrl ? null : (payload.text ?? ''),
          audio_url: payload.audioUrl ?? null,
          kind: payload.kind ?? null,
          referencia: payload.referencia ?? null,
          source: 'odb',
        }),
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`el puente respondió ${res.status}`);
      return { enviado: true, via: 'n8n' };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.log.warn(`No se pudo despachar el WhatsApp a ${payload.to}: ${msg}`);
      return { enviado: false, motivo: msg };
    } finally {
      clearTimeout(reloj);
    }
  }

  // Aviso interno a los teléfonos del equipo (coma-separados en la variable)
  private async avisarAlEquipo(texto: string) {
    const destinos = (process.env.ODB_WSP_EQUIPO ?? '')
      .split(',')
      .map((t) => t.replace(/\D/g, ''))
      .filter((t) => t.length >= 10);
    for (const to of destinos) {
      await this.enviarPorWhatsapp({ to, text: texto, kind: 'aviso-interno' });
    }
  }

  // Respuesta escrita por una persona desde la bandeja: se guarda en el hilo y
  // sale por el puente. Mientras haya alguien atendiendo, el bot sigue callado.
  async responderComoHumano(linea: 'pedidos' | 'proveedores', telefono: string, texto: string, usuarioId?: string) {
    const mensaje = String(texto ?? '').trim();
    if (!mensaje) throw new BadRequestException('El mensaje está vacío');

    const { data: conv } = await this.db
      .from('bot_conversaciones')
      .select('mensajes')
      .eq('linea', linea)
      .eq('telefono', telefono)
      .maybeSingle();
    const historial: { role: 'user' | 'assistant'; content: string }[] = Array.isArray(conv?.mensajes) ? conv!.mensajes : [];

    // se guarda ANTES de despachar: si el puente falla, el hilo igual muestra
    // lo que se quiso mandar y quien atiende sabe que tiene que reintentar
    await this.db.from('bot_conversaciones').upsert(
      {
        linea,
        telefono,
        mensajes: [...historial, { role: 'assistant', content: mensaje }].slice(-40),
        actualizado_en: new Date().toISOString(),
        bot_activo: false,
        atendida_por: usuarioId ?? null,
        derivacion_vence_en: null,
      },
      { onConflict: 'linea,telefono' },
    );

    const envio = await this.enviarPorWhatsapp({ to: telefono, text: mensaje, referencia: `${linea}/${telefono}` });
    // el mensaje de la persona queda también en el hilo de RESPONDE, así la
    // burbuja aparece en la app apenas refresca
    this.respondeRegistrar(telefono, null, '', mensaje).catch(() => null);
    return { ok: true, ...envio };
  }

  // Pausar el bot en UNA charla sin tener que escribir nada (la persona va a
  // atender por el teléfono, o quiere leer tranquila antes de responder).
  async pausarBot(linea: 'pedidos' | 'proveedores', telefono: string, usuarioId?: string) {
    const marca = { bot_activo: false, derivada_en: new Date().toISOString(), derivada_motivo: 'Pausado desde la bandeja', resuelta_en: null, atendida_por: usuarioId ?? null, derivacion_vence_en: null, acuse_derivacion_en: null };
    const { data: tocadas, error } = await this.db
      .from('bot_conversaciones').update(marca).eq('linea', linea).eq('telefono', telefono).select('telefono');
    if (error) throw new BadRequestException(error.message);
    if (!tocadas?.length) {
      await this.db.from('bot_conversaciones').insert({ linea, telefono, mensajes: [], actualizado_en: new Date().toISOString(), ...marca });
    }
    return { ok: true, botActivo: false };
  }

  // Marca que alguien del equipo leyó la charla (saca el "sin leer")
  async marcarLeida(linea: 'pedidos' | 'proveedores', telefono: string, usuarioId?: string) {
    await this.db.from('bot_conversaciones')
      .update({ leida_en: new Date().toISOString(), leida_por: usuarioId ?? null })
      .eq('linea', linea).eq('telefono', telefono);
    return { ok: true };
  }

  // Interruptor general de la línea (emergencia)
  async estadoLinea(linea: 'pedidos' | 'proveedores') {
    const { data } = await this.db.from('lineas_whatsapp')
      .select('linea, numero_legible, bot_activo, bot_pausado_en')
      .eq('linea', linea).eq('activa', true).limit(1).maybeSingle();
    return data ?? { linea, bot_activo: true };
  }

  async setBotLinea(linea: 'pedidos' | 'proveedores', activo: boolean, usuarioId?: string) {
    const { error } = await this.db.from('lineas_whatsapp')
      .update({ bot_activo: activo, bot_pausado_por: activo ? null : (usuarioId ?? null), bot_pausado_en: activo ? null : new Date().toISOString() })
      .eq('linea', linea).eq('activa', true);
    if (error) throw new BadRequestException(error.message);
    await this.db.from('auditoria').insert({
      usuario_id: usuarioId ?? null, accion: activo ? 'bot_linea_encendido' : 'bot_linea_apagado',
      entidad: 'lineas_whatsapp', entidad_id: linea, datos_despues: { activo },
    });
    return { ok: true, botActivo: activo };
  }

  // ---- RESPONDE · gestión: notas, programados, difusiones ----

  // Ficha del contacto: qué sabemos de esta persona (cliente del sistema si lo
  // es, tipo detectado por el bot, notas del equipo)
  async fichaContacto(telefono: string) {
    const [{ data: contacto }, { data: cliente }] = await Promise.all([
      this.db.from('bot_contactos').select('*').eq('telefono', telefono).maybeSingle(),
      this.db.from('clientes').select('id, nombre, dni, tipo, puntos, acepta_marketing').eq('telefono', telefono).maybeSingle(),
    ]);
    let compras: any = null;
    if (cliente?.id) {
      const { data: v } = await this.db.from('ventas').select('total, vendida_en').eq('cliente_id', cliente.id).eq('estado', 'completada').order('vendida_en', { ascending: false }).limit(50);
      const xs = v ?? [];
      compras = { cantidad: xs.length, gastado: xs.reduce((a, b) => a + Number(b.total), 0), ultima: xs[0]?.vendida_en ?? null };
    }
    return { telefono, contacto: contacto ?? null, cliente: cliente ?? null, compras };
  }

  async guardarNota(telefono: string, nota: string, etiquetas?: string[]) {
    const { error } = await this.db.from('bot_contactos').upsert(
      { telefono, notas_equipo: nota, ...(etiquetas ? { etiquetas } : {}), actualizado_en: new Date().toISOString() },
      { onConflict: 'telefono' },
    );
    if (error) throw new BadRequestException(error.message);
    return { ok: true };
  }

  // Programar un mensaje para más tarde (lo despacha el cron de programados)
  async programarMensaje(dto: { linea?: string; telefono: string; texto: string; enviarEn: string; usuarioId?: string }) {
    const cuando = new Date(dto.enviarEn);
    if (isNaN(cuando.getTime()) || cuando.getTime() < Date.now() - 60_000) throw new BadRequestException('La fecha tiene que ser futura');
    if (!dto.texto?.trim()) throw new BadRequestException('El mensaje está vacío');
    const { data, error } = await this.db.from('mensajes_programados').insert({
      linea: dto.linea === 'proveedores' ? 'proveedores' : 'pedidos',
      telefono: dto.telefono, texto: dto.texto.trim(), enviar_en: cuando.toISOString(), creado_por: dto.usuarioId ?? null,
    }).select('id, enviar_en').single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async programados(telefono?: string) {
    let q = this.db.from('mensajes_programados').select('*').is('enviado_en', null).is('cancelado_en', null).order('enviar_en');
    if (telefono) q = q.eq('telefono', telefono);
    const { data } = await q;
    return data ?? [];
  }

  async cancelarProgramado(id: string) {
    const { error } = await this.db.from('mensajes_programados').update({ cancelado_en: new Date().toISOString() }).eq('id', id).is('enviado_en', null);
    if (error) throw new BadRequestException(error.message);
    return { ok: true };
  }

  // Cada minuto: despacha los mensajes programados que ya vencieron
  @Cron('0 * * * * *')
  async despacharProgramados() {
    const { data: pend } = await this.db.from('mensajes_programados').select('*')
      .is('enviado_en', null).is('cancelado_en', null).lte('enviar_en', new Date().toISOString()).limit(50);
    let ok = 0, mal = 0;
    for (const m of (pend ?? []) as any[]) {
      const r = await this.enviarPorWhatsapp({ to: m.telefono, text: m.texto, referencia: `programado/${m.id}` });
      if (r.enviado) { ok++; await this.db.from('mensajes_programados').update({ enviado_en: new Date().toISOString() }).eq('id', m.id); }
      else { mal++; await this.db.from('mensajes_programados').update({ error: r.motivo ?? 'no se pudo enviar' }).eq('id', m.id); }
    }
    return { despachados: ok, fallidos: mal };
  }

  // Difusión: mismo mensaje a muchos. Se despacha con pausa entre envíos
  // (WhatsApp corta números que disparan en ráfaga) y queda registro por
  // destinatario. Solo a quien dio permiso, salvo que se pida explícitamente.
  async crearDifusion(dto: { linea?: string; titulo?: string; texto: string; imagenUrl?: string; telefonos: string[]; usuarioId?: string }) {
    const tels = Array.from(new Set((dto.telefonos ?? []).map((t) => String(t).replace(/\D/g, '')).filter((t) => t.length >= 10)));
    if (!tels.length) throw new BadRequestException('No hay destinatarios');
    if (!dto.texto?.trim() && !dto.imagenUrl) throw new BadRequestException('La difusión está vacía');
    const { data: d, error } = await this.db.from('responde_difusiones').insert({
      linea: dto.linea === 'proveedores' ? 'proveedores' : 'pedidos', titulo: dto.titulo ?? null,
      texto: dto.texto ?? '', imagen_url: dto.imagenUrl ?? null, creado_por: dto.usuarioId ?? null, total: tels.length,
    }).select('id').single();
    if (error) throw new BadRequestException(error.message);
    await this.db.from('responde_difusiones_destinatarios').insert(tels.map((t) => ({ difusion_id: d.id, telefono: t })));
    // se despacha en segundo plano; la pantalla consulta el avance
    this.despacharDifusion(d.id).catch((e) => this.log.warn(`difusión ${d.id}: ${e?.message ?? e}`));
    return { difusionId: d.id, total: tels.length };
  }

  private async despacharDifusion(id: string) {
    const { data: d } = await this.db.from('responde_difusiones').select('*').eq('id', id).single();
    const { data: dest } = await this.db.from('responde_difusiones_destinatarios').select('telefono').eq('difusion_id', id).eq('estado', 'pendiente');
    let ok = 0, mal = 0;
    for (const x of (dest ?? []) as any[]) {
      const r = await this.enviarPorWhatsapp({ to: x.telefono, text: d.texto || null, imagenUrl: d.imagen_url ?? null, referencia: `difusion/${id}` });
      if (r.enviado) { ok++; await this.db.from('responde_difusiones_destinatarios').update({ estado: 'enviado', enviado_en: new Date().toISOString() }).eq('difusion_id', id).eq('telefono', x.telefono); }
      else { mal++; await this.db.from('responde_difusiones_destinatarios').update({ estado: 'fallido', error: r.motivo ?? null }).eq('difusion_id', id).eq('telefono', x.telefono); }
      await this.db.from('responde_difusiones').update({ enviados: ok, fallidos: mal }).eq('id', id);
      // pausa entre envíos: 2 a 4 segundos, como una persona
      await new Promise((r) => setTimeout(r, 2000 + Math.random() * 2000));
    }
    await this.db.from('responde_difusiones').update({ terminada_en: new Date().toISOString() }).eq('id', id);
  }

  async difusiones() {
    const { data } = await this.db.from('responde_difusiones').select('*').order('creado_en', { ascending: false }).limit(30);
    return data ?? [];
  }

  // Base a la que se puede difundir: quien dio permiso y tiene teléfono
  async baseDifundible() {
    const { data } = await this.db.from('base_difundible').select('*').order('gastado', { ascending: false }).limit(2000);
    return data ?? [];
  }

  // Volver a manos del bot (el tema se resolvió)
  async devolverAlBot(linea: 'pedidos' | 'proveedores', telefono: string, usuarioId?: string) {
    const { error } = await this.db
      .from('bot_conversaciones')
      .update({ bot_activo: true, resuelta_en: new Date().toISOString(), atendida_por: usuarioId ?? null })
      .eq('linea', linea)
      .eq('telefono', telefono);
    if (error) throw new BadRequestException(error.message);
    return { ok: true, botActivo: true };
  }

  async borrarConversacion(linea: 'pedidos' | 'proveedores', telefono: string) {
    const tel = (telefono ?? '').replace(/\D/g, '');
    if (!tel) throw new BadRequestException('Falta el teléfono');
    await this.db.from('bot_conversaciones').delete().eq('linea', linea).eq('telefono', tel);
    return { ok: true };
  }

  // ---------- RESPONDE: bandeja del empleado virtual ----------

  // Lista de conversaciones reales (WhatsApp y simulador) para la bandeja
  async conversaciones() {
    const { data } = await this.db
      .from('bot_conversaciones')
      .select('linea, telefono, mensajes, actualizado_en, tokens, bot_activo, derivada_en, derivada_motivo, resuelta_en, leida_en')
      .order('actualizado_en', { ascending: false })
      .limit(100);
    // nombres de los clientes conocidos, en una sola consulta
    const telefonos = ((data ?? []) as any[]).map((c) => c.telefono);
    const nombres = new Map<string, string>();
    if (telefonos.length) {
      const { data: cls } = await this.db.from('clientes').select('telefono, nombre').in('telefono', telefonos);
      for (const c of (cls ?? []) as any[]) if (c.nombre) nombres.set(String(c.telefono), c.nombre);
    }
    return ((data ?? []) as any[]).map((c) => {
      const msjs = Array.isArray(c.mensajes) ? c.mensajes : [];
      const ultimo = msjs[msjs.length - 1];
      const texto = typeof ultimo?.content === 'string'
        ? ultimo.content
        : Array.isArray(ultimo?.content)
          ? (ultimo.content.find((b: any) => b.type === 'text')?.text ?? '')
          : '';
      return {
        linea: c.linea,
        telefono: c.telefono,
        nombre: nombres.get(String(c.telefono)) ?? null,
        actualizado_en: c.actualizado_en,
        tokens: Number(c.tokens || 0),
        turnos: msjs.length,
        ultimo: String(texto).slice(0, 140),
        ultimoRol: ultimo?.role ?? null,
        // el bot está pausado en esta charla (la atiende una persona)
        pausada: c.bot_activo === false,
        derivada: !!c.derivada_en && !c.resuelta_en,
        derivadaMotivo: c.derivada_motivo ?? null,
        // último mensaje del cliente posterior a la última lectura del equipo
        sinLeer: ultimo?.role === 'user' && (!c.leida_en || new Date(c.actualizado_en) > new Date(c.leida_en)),
      };
    });
  }

  // Conversación completa, aplanada a burbujas legibles (sin tool_use crudos)
  async conversacionDetalle(linea: string, telefono: string) {
    const { data } = await this.db
      .from('bot_conversaciones')
      .select('mensajes, actualizado_en, tokens')
      .eq('linea', linea)
      .eq('telefono', String(telefono ?? '').replace(/\D/g, ''))
      .maybeSingle();
    const msjs = Array.isArray((data as any)?.mensajes) ? (data as any).mensajes : [];
    const burbujas = msjs
      .map((m: any) => {
        const texto = typeof m.content === 'string'
          ? m.content
          : Array.isArray(m.content)
            ? m.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n')
            : '';
        return { rol: m.role, texto: String(texto).trim() };
      })
      .filter((b: any) => b.texto);
    return { burbujas, actualizado_en: (data as any)?.actualizado_en ?? null, tokens: Number((data as any)?.tokens || 0) };
  }

  // Métricas simples del empleado virtual para el tablero RESPONDE
  async resumenResponde() {
    const { data } = await this.db.from('bot_conversaciones').select('mensajes, actualizado_en, tokens');
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    let convs = 0, turnos = 0, tokens = 0, activasHoy = 0;
    for (const c of (data ?? []) as any[]) {
      convs++;
      turnos += Array.isArray(c.mensajes) ? c.mensajes.length : 0;
      tokens += Number(c.tokens || 0);
      if (c.actualizado_en && new Date(c.actualizado_en) >= hoy) activasHoy++;
    }
    return { conversaciones: convs, activasHoy, turnos, tokens };
  }

  // La cava consultable del sommelier: vinos/espumantes reales con stock,
  // filtrados por tipo (según la categoría), cepa y rango de precio.
  async consultarCava(f: {
    tipo?: string;
    cepa?: string;
    precioMin?: number;
    precioMax?: number;
    buscar?: string;
  }) {
    // La cava tiene ~2.300 etiquetas y Supabase corta en 1.000 filas por consulta:
    // sin paginar, el bot veía la mitad de la cava y decía "no tenemos" de vinos
    // que estaban en góndola (visto en la auditoría con un Gualtallary a $18.330).
    const data: any[] = [];
    for (let desde = 0; ; desde += 1000) {
      const { data: pagina, error } = await this.db
        .from('productos')
        .select('id, sku, nombre, descripcion, alias_busqueda, categoria:categorias!inner(nombre), stock(cantidad, sucursal:sucursales(nombre))')
        .eq('activo', true)
        .or('nombre.ilike.vino%,nombre.ilike.espumante%,nombre.ilike.champagne%', { referencedTable: 'categoria' })
        .order('id')
        .range(desde, desde + 999);
      if (error) throw new BadRequestException(error.message);
      data.push(...(pagina ?? []));
      if (!pagina || pagina.length < 1000) break;
    }

    const norm = (t: string) =>
      (t ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const tipo = norm(f.tipo ?? 'cualquiera');
    const filtroTipo: Record<string, (cat: string) => boolean> = {
      tinto: (c) => c.includes('tinto'),
      blanco: (c) => c.includes('blanco'),
      rosado: (c) => c.includes('rosado') || c.includes('rose'),
      espumante: (c) => c.includes('espumante') || c.includes('champagne'),
    };

    let vinos = (data ?? [])
      .map((p: any) => ({
        id: p.id,
        sku: p.sku,
        nombre: p.nombre,
        descripcion: p.descripcion ?? null,
        alias: p.alias_busqueda ?? null,
        categoria: p.categoria?.nombre ?? '',
        stockTotal: (p.stock ?? []).reduce((s: number, r: any) => s + Number(r.cantidad), 0),
        // en qué sucursal hay: el bot tiene que poder decirlo sin inventar
        sucursales: (p.stock ?? []).filter((r: any) => Number(r.cantidad) > 0).map((r: any) => `${(r.sucursal?.nombre ?? '').replace(/^Suc /, '')} (${Math.round(Number(r.cantidad))})`).join(', '),
      }))
      .filter((p) => p.stockTotal > 0);

    if (filtroTipo[tipo]) vinos = vinos.filter((p) => filtroTipo[tipo](norm(p.categoria)));
    if (f.cepa) {
      const cepa = norm(f.cepa);
      vinos = vinos.filter((p) => norm(p.categoria).includes(cepa) || norm(p.nombre).includes(cepa));
    }
    if (f.buscar) {
      // por palabras (no frase exacta) y sobre nombre + descripción + alias: así
      // "gualtallary", "catena", "las perdices" encuentran lo que hay aunque el
      // cliente lo escriba en otro orden
      const palabras = norm(f.buscar).split(/\s+/).filter((w) => w.length >= 3);
      if (palabras.length) {
        vinos = vinos.filter((p) => {
          const pajar = norm(`${p.nombre} ${p.descripcion ?? ''} ${p.alias ?? ''}`);
          return palabras.every((w) => pajar.includes(w));
        });
      }
    }
    if (!vinos.length) return { items: [], nota: 'No hay etiquetas con stock para ese filtro; probá aflojando cepa o tipo.' };

    // precios reales (con promos vigentes) en un solo viaje
    const { data: precios } = await this.db.rpc('catalogo_precios', {
      p_ids: vinos.map((p) => p.id),
    });
    const precioPor = new Map<string, any>((precios ?? []).map((r: any) => [r.producto_id, r]));

    const min = Number(f.precioMin ?? 0);
    const max = Number(f.precioMax ?? Infinity);
    const filtrados = vinos
      .map((p) => {
        const pr = precioPor.get(p.id);
        const precio = Math.round(Number(pr?.precio_final ?? 0));
        const desc = String(p.descripcion ?? '').replace(/\s+/g, ' ').trim();
        return this.sinNulos({
          sku: p.sku,
          nombre: p.nombre,
          categoria: p.categoria,
          // la ficha, recortada: es lo único que el bot puede afirmar del vino
          ficha: desc ? (desc.length > 220 ? desc.slice(0, 217) + '…' : desc) : null,
          precio,
          promo: pr?.descuento_nombre ? `${pr.descuento_nombre} (antes $${Math.round(pr.precio_lista)})` : null,
          stock: this.sucCompacta(p.sucursales) || String(Math.round(p.stockTotal)),
        }) as any;
      })
      .filter((p) => p.precio > 0 && p.precio >= min && p.precio <= max)
      // de mayor a menor: lo mejor del presupuesto arriba
      .sort((a, b) => b.precio - a.precio);
    const items = filtrados.slice(0, 20);

    return { items, total_en_cava_para_el_filtro: filtrados.length, ...(filtrados.length > items.length ? { nota: `Se muestran 20 de ${filtrados.length}: afiná cepa/precio si hace falta.` } : {}) };
  }

  // El cliente conoce el código (DOM-XXXXXX / RET-XXXXXX), no el id. Y solo ve
  // pedidos PROPIOS (del teléfono del chat): nadie averigua el pedido de otro
  // adivinando un código. Sin referencia, devuelve los últimos pedidos del cliente.
  async estadoPedido(ref: string, telefono?: string) {
    const r = String(ref ?? '').trim();
    if (telefono) {
      const ident = await this.identificarCliente(telefono);
      if (!ident.existe || !ident.clienteId) return { pedidos: [], aviso: 'Este teléfono no tiene pedidos registrados.' };
      const esUuid = /^[0-9a-f-]{36}$/i.test(r);
      let q = this.db
        .from('pedidos')
        .select('id, estado, total, qr_retiro, canal, destino_direccion, creado_en, listo_en, en_camino_en, entregado_en, items:pedidos_items(cantidad, producto:productos(nombre))')
        .eq('cliente_id', ident.clienteId)
        .order('creado_en', { ascending: false })
        .limit(5);
      if (r) q = esUuid ? q.eq('id', r) : q.eq('qr_retiro', r.toUpperCase());
      const { data } = await q;
      const xs = (data ?? []) as any[];
      if (!xs.length) return { pedidos: [], aviso: r ? `No hay ningún pedido ${r} de este cliente (revisá el código con el cliente).` : 'Este cliente no tiene pedidos.' };
      return {
        pedidos: xs.map((p) => ({
          codigo: p.qr_retiro ?? null,
          estado: p.estado,
          total: Number(p.total),
          modalidad: p.canal === 'domicilio' ? 'envío' : 'retiro',
          direccion: p.destino_direccion ?? null,
          creado: p.creado_en,
          listo: p.listo_en ?? null,
          enCamino: p.en_camino_en ?? null,
          entregado: p.entregado_en ?? null,
          items: (p.items ?? []).map((i: any) => `${i.cantidad}x ${i.producto?.nombre ?? ''}`.trim()),
        })),
      };
    }
    const p: any = await this.pedidos.obtener(r).catch(() => null);
    if (!p) throw new BadRequestException('No existe el pedido');
    return {
      pedidoId: p.id,
      estado: p.estado,
      total: Number(p.total),
      codigoRetiro: p.qr_retiro ?? null,
      items: (p.items ?? []).map((i: any) => ({ cantidad: i.cantidad, nombre: i.producto?.nombre ?? null })),
    };
  }

  // --- Línea PROVEEDORES ---

  // El proveedor manda la factura por WhatsApp (foto/PDF en base64). La IA la
  // extrae y queda en la cola de revisión: un humano la confirma en el panel y
  // recién ahí se mueve stock (nunca automático desde una foto).
  async recibirFactura(dto: { telefono?: string; archivoBase64: string; mimeType: string }) {
    if (!dto.archivoBase64) throw new BadRequestException('Falta el archivo (base64)');
    const buffer = Buffer.from(dto.archivoBase64, 'base64');
    const extraccion = await this.listas.analizarComprobanteFoto({ buffer, mimetype: dto.mimeType, originalname: dto.mimeType.includes('pdf') ? 'f.pdf' : 'f.jpg' });

    const { data, error } = await this.db
      .from('recepciones_bot')
      .insert({
        telefono: dto.telefono ? dto.telefono.replace(/\D/g, '') : null,
        proveedor_id: (extraccion as any).proveedor?.match?.id ?? null,
        proveedor_detectado: (extraccion as any).proveedor?.detectado?.nombre ?? null,
        extraccion,
        con_match: (extraccion as any).conMatch ?? 0,
        total: (extraccion as any).impuestos?.total ? Math.round(Number((extraccion as any).impuestos.total)) : null,
      })
      .select('id')
      .single();
    if (error) throw new BadRequestException(error.message);

    const e: any = extraccion;
    return {
      recepcionId: data.id,
      proveedor: e.proveedor?.match ? e.proveedor.match.razon_social : e.proveedor?.detectado?.nombre ?? 'no identificado',
      proveedorEnSistema: !!e.proveedor?.match,
      comprobante: e.comprobante?.numero ?? null,
      total: e.impuestos?.total ?? null,
      renglones: e.total,
      conMatch: e.conMatch,
      // mensaje sugerido para que el bot le confirme la recepción al proveedor
      mensaje: `Recibimos su factura ${e.comprobante?.numero ?? ''} por $${Math.round(Number(e.impuestos?.total ?? 0)).toLocaleString('es-AR')}. Queda registrada para revisión. Gracias.`,
    };
  }
}
