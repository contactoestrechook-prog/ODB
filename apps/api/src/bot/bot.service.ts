import { esperaRetiroOEnvio, eligeRetiroOEnvio, eligioModalidad } from './entrega';
import { esContestadorAutomatico } from './contestador';
import { conPreguntaDeCompleto, elegirPorDefecto, puedeCotizar } from './completo';
import { cierraLaLista, coincideConLoAnotado, cuandoLegible, esConfirmacionDePedido, listaCerrada, nadaMasConfirma, nombreDeQuienRetira, PREGUNTA_NOMBRE_RETIRO, RE_ARMADO_A_PEDIDO, RE_PREGUNTA_NOMBRE_RETIRO, ultimaListaAnotada } from './cierre';
import { conDescuentoEfectivo, porcentajeEfectivo, RUBROS_DESCUENTO_EFECTIVO, tieneDescuentoEfectivo } from './descuento-efectivo';
import { esSilenciado } from './pausa';
import { agruparItems, cantidadesIndividuales, centavos, confirmacionInequivoca, idWhatsappCorto, importesDeHerramienta, importesDelTexto, pesos, presentacionProducto } from './comercio';
import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { volumenMl, etiquetaVolumen, pideTamano, medidaPartida, resumenDeTamanos, cantidadesPedidas, PALABRA_GENERICA } from './formatos';
import { emprolijarListado, nombreLimpio, saludoSegunHora, saludarConBienvenida, niegaPercepcion, respetuosoSinConfianza, saintThomas, envioSinCargo, asegurarEnvioSinCargo, casiIgual, campoLimpio, quitarOraciones, respuestaConConsulta, esAlucinacionDeTranscripcion, nombreSucursalCliente, esAutomaticoWhatsappBusiness, minimoConMonto, retiroOEnvio, sinCocinaInterna, sinLoConsulto } from './prolijo';
import { controlDeFechas } from './fechas';
import { desvioDeLoPedido } from './desvio';
import { audioDeclarado, estadoOgg } from './ogg';
import { atiendeUnaPersona, avisoEsperaPorWhatsapp, decisionSesion, esperasParaAvisar, motivoDeSilencio, pideRespuesta } from './pausa';
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
import { costoUSD } from './tarifas';
import { cartelesListaPrecios, cartelesPedido, fechaLegible, imagenEsperada, leerResumenDePedido, nombreParaCartel, pieSinPrecios, preciosDeLaRespuesta, sinPreguntaDeConfirmar, ProductoConPrecio } from '../comun/cartel-pedido';
/** La tarjeta de una respuesta: una o más páginas cuadradas y el texto que va al pie de la última. */
export type Tarjeta = { imagenUrl: string; imagenes: string[]; pie: string };

// pedido mínimo para envío a domicilio (Leandro, 25/9/2026); ENVIO_MINIMO lo cambia sin tocar código
const envioMinimo = () => Number(process.env.ENVIO_MINIMO ?? 70000) || 70000;
// herramientas que solo leen: se pueden ejecutar en paralelo dentro de un turno
const HERRAMIENTAS_DE_LECTURA = new Set(['buscar_productos', 'consultar_cava', 'identificar_cliente', 'estado_local', 'estado_pedido']);
const TODAVIA_SIN_PRECIOS = 'TODAVÍA NO PASES PRECIOS (regla del dueño): primero confirmá que el pedido está completo. Respondé con la lista de lo que anotaste, un renglón por producto «• cantidad × producto puntual», SIN precios ni total, y la pregunta «¿Está completo el pedido o querés sumar algo?». Si algo no tiene stock o hay que elegir variante, decilo en esa lista. Recién cuando el cliente confirme que está completo, cotizar_pedido.';

/**
 * ¿Es un acuse corto ("ok", "listo", "Okk", 👍🏻, 🙏)? Lo que administración
 * contesta así a un aviso de pedido no es para nadie (3/10/2026).
 */
function esAcuse(texto: string): boolean {
  const t = String(texto ?? '').replace(/[\u{1F3FB}-\u{1F3FF}\uFE0F]/gu, '').trim();
  return !!t && /^(?:ok+[iy]*s?|okey|oka+|dale|listo|recibido|visto|gracias|perfecto|joya|genial|s[ií]+|\p{Extended_Pictographic}|[\s.,!])+$/iu.test(t);
}

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
    // el aviso sale UNA vez por hora: repetido en cada mensaje alimentaba la
    // ronda con un contestador automático del otro lado (24/9/2026)
    if (this.superaLimite(telefono)) {
      const avisado = this.avisoLimite.get(telefono) ?? 0;
      if (Date.now() - avisado < 3_600_000) return { respuesta: null, silencio: true, motivo: 'límite por hora (ya avisado)' } as any;
      this.avisoLimite.set(telefono, Date.now());
      if (this.avisoLimite.size > 2000) this.avisoLimite.clear();
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
  // WhatsApp manda un @lid (id de privacidad) en vez del número. WAHA, con su
  // store activo, traduce el @lid al número y conoce el nombre con el que el
  // teléfono del local tiene agendado al contacto. Sin esto la bandeja mostraba
  // "+191169078280330@lid" y nadie reconocía a nadie (2026-09-08).
  private contactosResueltos = new Map<string, number>();
  async resolverContactoWaha(claveContacto: string, esLid: boolean) {
    const base = (process.env.WAHA_URL ?? '').replace(/\/$/, '');
    const key = process.env.WAHA_API_KEY ?? '';
    const sesion = process.env.WAHA_SESSION ?? 'odb';
    if (!base || !key || !claveContacto) return null;
    const ahora = Date.now();
    const previo = this.contactosResueltos.get(claveContacto);
    if (previo && ahora - previo < 6 * 3600_000) return null;
    this.contactosResueltos.set(claveContacto, ahora);
    const opts = { headers: { 'X-Api-Key': key }, signal: AbortSignal.timeout(6000) } as any;
    let telefonoReal: string | null = null;
    const lid = esLid ? `${claveContacto}@lid` : null;
    try {
      if (lid) {
        const r = await fetch(`${base}/api/${sesion}/lids/${encodeURIComponent(lid)}`, opts);
        if (r.ok) { const j: any = await r.json(); telefonoReal = String(j?.pn ?? '').split('@')[0].replace(/\D/g, '') || null; }
      }
      const contactId = telefonoReal ? `${telefonoReal}@c.us` : lid ?? `${claveContacto}@c.us`;
      let nombre: string | null = null;
      const c = await fetch(`${base}/api/contacts?contactId=${encodeURIComponent(contactId)}&session=${sesion}`, opts);
      if (c.ok) {
        const j: any = await c.json();
        nombre = (j?.name ?? j?.pushname ?? j?.pushName ?? '') || null;
        if (!telefonoReal && j?.phoneNumber) telefonoReal = String(j.phoneNumber).split('@')[0].replace(/\D/g, '') || null;
      }
      if (!telefonoReal && !nombre) return null;
      await this.db.from('bot_contactos').upsert(
        {
          telefono: claveContacto,
          ...(telefonoReal ? { telefono_real: telefonoReal } : {}),
          ...(nombre ? { nombre_wa: nombre } : {}),
          ...(lid ? { lid } : {}),
          resuelto_en: new Date().toISOString(),
          actualizado_en: new Date().toISOString(),
        },
        { onConflict: 'telefono' },
      ).then(() => null, () => null);
      this.log.log(`contacto resuelto: ${claveContacto} → ${telefonoReal ?? '?'} · ${nombre ?? 'sin nombre de agenda'}`);
      // el nombre viaja a RESPONDE apenas se conoce: sin esto el panel muestra
      // "+110634079383788@lid" y la charla no se puede encontrar (18/9/2026).
      // Con los textos vacíos, la RPC solo crea/nombra el contacto: no agrega mensajes.
      const nombrePanel = nombre || (telefonoReal ? `+${telefonoReal}` : '');
      if (nombrePanel) {
        this.respondeRpc('odb_registrar_turno', {
          p_whatsapp_id: esLid ? `${claveContacto}@lid` : (telefonoReal ?? claveContacto),
          p_nombre: nombrePanel, p_texto_cliente: '', p_texto_bot: '', p_wa_message_id: null,
        }).catch(() => null);
      }
      return { telefonoReal, nombre };
    } catch (e: any) {
      this.log.warn(`no se pudo resolver el contacto ${claveContacto}: ${e?.message ?? e}`);
      return null;
    }
  }

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

  private avisoLimite = new Map<string, number>();
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
      if (previo && typeof previo.respuesta === 'string') return previo.respuesta
        ? { respuesta: previo.respuesta }
        : { respuesta: null, silencio: true, motivo: 'mensaje ya procesado sin respuesta' } as any;
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
      .select('mensajes, bot_activo, derivada_motivo, derivacion_vence_en, atendida_por, acuse_derivacion_en, actualizado_en, importes_verificados')
      .eq('linea', linea)
      .eq('telefono', telefono)
      .maybeSingle();

    // Interruptor GENERAL de la línea (emergencia): si el bot está apagado para
    // toda la línea, se guarda el mensaje y no se contesta nada.
    const { data: lineaCfg } = await this.db
      .from('lineas_whatsapp')
      .select('bot_activo, notas')
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

    // CONTACTOS SILENCIADOS (26/9/2026, pedido de Leandro): proveedores y
    // conocidos a los que el bot no tiene que contestar nunca. El mensaje queda
    // en el hilo (y en RESPONDE) para quien atiende, pero no se contesta ni se
    // anota como espera: esos contactos llenaban el WhatsApp de administración
    // de avisos "⏳ nadie contestó" y tapaban las consultas de clientes.
    // Se saca al reactivar la charla desde el panel.
    {
      const { data: k } = await this.db.from('bot_contactos').select('etiquetas').eq('telefono', telefono).maybeSingle();
      if (esSilenciado((k as any)?.etiquetas)) {
        const hist: { role: 'user' | 'assistant'; content: string }[] = Array.isArray(conv?.mensajes) ? conv!.mensajes : [];
        await this.db.from('bot_conversaciones').upsert({
          linea, telefono, bot_activo: false,
          mensajes: [...hist, { role: 'user', content: texto + marcaAdjunto }].slice(-40),
          actualizado_en: new Date().toISOString(),
          esperando_desde: null, esperando_texto: null, esperando_aviso_en: null, esperando_avisos: 0,
        }, { onConflict: 'linea,telefono' }).then(() => null, () => null);
        this.log.log(`contacto silenciado ${telefono}: no se contesta`);
        return { respuesta: null, silencio: true, motivo: 'contacto silenciado' } as any;
      }
    }

    // La conversación está derivada a una persona: el mensaje se guarda en el
    // hilo (para que el que atiende lo vea) pero el bot NO contesta, así no le
    // pisa la respuesta al humano.
    if (botApagadoGlobal || (conv && conv.bot_activo === false)) {
      const hist: { role: 'user' | 'assistant'; content: string }[] = Array.isArray(conv?.mensajes) ? conv!.mensajes : [];
      const ahora = new Date();

      // REGLA DE LEANDRO (2026-09-16): una charla pausada se reactiva SOLO a mano
      // desde RESPONDE. Antes el bot volvía solo (a los 20 min si nadie tomaba la
      // derivación, a las 6 h si alguien había contestado desde el teléfono) y
      // en las derivadas contestaba "en modo acotado". Ahora, pausada = silencio:
      // el mensaje queda en el hilo para quien atiende y nadie lo pisa.
      {
        const respuesta: string | null = null;
        const yaAcuso = !!conv?.acuse_derivacion_en;
        const preguntaIdentidad = false;
        if (!botApagadoGlobal) {
          await this.db.from('bot_notas_equipo').insert({ linea, telefono, nota: `[en pausa] ${texto.slice(0, 300)}` }).then(() => null, () => null);
        }
        await this.db.from('bot_conversaciones').upsert(
          {
            linea,
            telefono,
            mensajes: [...hist, { role: 'user', content: texto + marcaAdjunto }, ...(respuesta ? [{ role: 'assistant', content: respuesta }] : [])].slice(-40),
            actualizado_en: ahora.toISOString(),
            // el cliente escribió y nadie le va a contestar: queda esperando,
            // y el cron avisa a administración si pasa el tiempo (19/9/2026)
            esperando_desde: (conv as any)?.esperando_desde ?? ahora.toISOString(),
            esperando_texto: (texto + marcaAdjunto).slice(0, 300),
            ...(respuesta && !yaAcuso && !preguntaIdentidad ? { acuse_derivacion_en: ahora.toISOString() } : {}),
          },
          { onConflict: 'linea,telefono' },
        );
        return { respuesta, derivada: true, motivo: botApagadoGlobal ? 'bot apagado en toda la línea' : 'conversación pausada: se reactiva desde RESPONDE' };
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
    // del otro lado contesta una máquina (bot de menú de otra empresa): no se le
    // habla, o las dos máquinas charlan en ronda (24/9/2026)
    if (esContestadorAutomatico(texto, historial.filter((m) => m.role === 'user').slice(-12).map((m) => String(m.content)))) {
      return callar('contestador automático del otro lado');
    }

    const ultimoMsgBot = [...historial].reverse().find((m) => m.role === 'assistant')?.content ?? '';
    const botDejoPregunta = /\?\s*$/.test(String(ultimoMsgBot).trim()) || /¿[^?]*\?/.test(String(ultimoMsgBot).slice(-160));
    const RE_CIERRE = /^(?:(?:dale|ok+|okey|oka|okis|listo|perfecto|b[aá]rbaro|genial|joya|buen[ií]simo|bueno|gracias+|muchas gracias|mil gracias|de nada|a vos|saludos|hablamos|nos vemos|un abrazo|abrazo|chau|ciao|hablamos despu[eé]s|despu[eé]s|(?:ja|je|ji){2,})\b[\s!.,]*)+$|^[\s👍🙏🫶👌🏻🏼❤️🙂😊😂🤣✨🔥]+$/i;
    const RE_SI_NO = /^(s[ií]+|sisi|si si|no|nop|dale|ok|listo|bueno)\b[\s!.]*$/i;
    // un ARCHIVO con "gracias" abajo no es un cierre: es un comprobante o una
    // lista, y hay que abrirlo (Belén, 23/9/2026: PDF + "Graciassss" quedó sin leer)
    const traeArchivo = !!(dto.archivoBase64 || dto.archivoUrl);
    if (!traeArchivo && RE_CIERRE.test(texto.trim())) {
      // "sí" / "dale" / "ok" CONTESTAN una pregunta del bot: esos pasan. Los demás
      // cierres, y cualquier cierre sin pregunta pendiente, no se responden.
      // "Perfecto" o 👍 a "¿Está completo el pedido…?" cierran la lista: pasan
      // (3/10/2026; antes el pedido quedaba sin respuesta)
      if (!(botDejoPregunta && RE_SI_NO.test(texto.trim())) && !(nadaMasConfirma() && cierraLaLista(texto, String(ultimoMsgBot)))) return callar('cierre de la charla');
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

    // RESPUESTAS CLAVE (campañas): si el mensaje ES la palabra clave de una
    // campaña activa ("ENTRADA" tras una difusión), la respuesta sale fija e
    // instantánea, sin gastar modelo y sin margen de improvisación.
    {
      const palabra = texto.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]/g, '').trim();
      if (palabra && palabra.length <= 30) {
        const { data: claves } = await this.db.from('bot_respuestas_clave').select('clave, respuesta').eq('activa', true);
        const hit = ((claves ?? []) as any[]).find((c) => {
          const k = String(c.clave).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
          return palabra === k || palabra === k + 's' || palabra + 's' === k;
        });
        if (hit) {
          this.log.log(`respuesta clave "${hit.clave}" para ${telefono}`);
          await this.db.from('bot_conversaciones').upsert({
            linea, telefono,
            mensajes: [...historial, { role: 'user', content: texto }, { role: 'assistant', content: hit.respuesta }].slice(-MAX_HISTORIAL),
            actualizado_en: new Date().toISOString(),
          }, { onConflict: 'linea,telefono' }).then(() => null, () => null);
          if (mensajeId) await this.db.from('bot_mensajes').upsert({ linea, mensaje_id: mensajeId, telefono, respuesta: hit.respuesta }).then(() => null, () => null);
          return { respuesta: hit.respuesta };
        }
      }
    }

    // A NOMBRE DE QUIÉN SE RETIRA (3/10/2026). Las picadas se arman a pedido:
    // al confirmar un retiro con picadas el bot pregunta "¿A nombre de quién lo
    // retiran?". La respuesta queda en las notas del pedido ("Retira: Juan
    // Pérez") para que el mostrador sepa a quién entregarlo, sin pasar por el
    // modelo. Si lo que contestó no es un nombre, sigue la charla normal.
    // Solo contestando la confirmación ("Pedido PICKUP-… confirmado. … ¿A nombre
    // de quién lo retiran?") y en el pedido de ESE código.
    const codigoConfirmado = nadaMasConfirma() && esConfirmacionDePedido(ultimoMsgBot) && RE_PREGUNTA_NOMBRE_RETIRO.test(String(ultimoMsgBot))
      ? String(ultimoMsgBot).match(/\b(?:DOM|RET|PICKUP)-[A-Z0-9]{4,}\b/)?.[0] ?? null
      : null;
    if (!traeArchivo && codigoConfirmado) {
      const nombre = nombreDeQuienRetira(texto);
      const anotado = nombre
        ? await this.anotarQuienRetira(telefono, linea, codigoConfirmado, nombre).catch((e: any) => { this.log.warn(`no pude anotar quién retira (${telefono}): ${e?.message ?? e}`); return false; })
        : false;
      if (nombre && anotado) {
        const resp = `Listo, queda a nombre de ${nombre}.`;
        await this.db.from('bot_conversaciones').upsert({
          linea, telefono,
          mensajes: [...historial, { role: 'user', content: texto }, { role: 'assistant', content: resp }].slice(-MAX_HISTORIAL),
          actualizado_en: new Date().toISOString(),
        }, { onConflict: 'linea,telefono' });
        if (mensajeId) await this.db.from('bot_mensajes').upsert({ linea, mensaje_id: mensajeId, telefono, respuesta: resp }).then(() => null, () => null);
        return { respuesta: resp };
      }
    }

    // UN "SÍ" DE MÁS DESPUÉS DE CONFIRMAR (23/9/2026). Si el último mensaje del
    // bot ya fue "Pedido X confirmado", otro "si"/"dale"/"ok" es un acuse:
    // el modelo lo tomaba como pedido nuevo y armaba el mismo pedido otra vez.
    if (!traeArchivo && /^Pedido \S+ confirmado\./.test(String(ultimoMsgBot).trim()) && (confirmacionInequivoca(texto) || RE_SI_NO.test(texto.trim()))) {
      return callar('acuse de un pedido ya confirmado');
    }

    // SOLO LA FORMA DE PAGO DESPUÉS DEL RESUMEN (25/9/2026): el cliente dice
    // "efectivo" al "¿Lo confirmo?" y el modelo rehacía el resumen entero, casi
    // igual (Catalina). La forma de pago no cambia el pedido: se anota en la
    // cotización y se vuelve a pedir confirmación en una línea, con el total.
    {
      const medio = /^(?:en |con |pago (?:en |con )?)?(efectivo|tarjeta(?: de (?:d[eé]bito|cr[eé]dito))?|d[eé]bito|cr[eé]dito)[\s!.]*$/i.exec(texto.trim())?.[1];
      if (!traeArchivo && medio && /¿lo confirmo\?/i.test(String(ultimoMsgBot))) {
        const { data: q } = await this.db.from('bot_cotizaciones').select('id, total, tipo, notas, items, confirmada_en, creada_en')
          .eq('telefono', telefono).eq('linea', linea).order('creada_en', { ascending: false }).limit(1).maybeSingle();
        if (q && !q.confirmada_en && Date.now() - new Date(q.creada_en).getTime() < 3 * 3600_000 && String(ultimoMsgBot).includes(`$${pesos(Number(q.total))}`)) {
          const forma = medio.toLowerCase().startsWith('efectivo') ? 'efectivo' : 'tarjeta';
          await this.db.from('bot_cotizaciones').update({ notas: [q.notas, `Paga con ${forma}`].filter(Boolean).join(' · ').slice(0, 300) }).eq('id', q.id);
          // con efectivo, el descuento de los rubros que lo tienen (30/9/2026)
          const conEfectivo = forma === 'efectivo'
            ? Math.round(((q as any).items ?? []).reduce((s: number, r: any) => s + Number(r?.subtotalEfectivo ?? r?.subtotal ?? 0), 0))
            : Number(q.total);
          const resp = conEfectivo && conEfectivo < Number(q.total)
            ? `Perfecto, ${forma} al ${q.tipo === 'domicilio' ? 'recibir' : 'retirar'}: con el ${porcentajeEfectivo()}% off en ${RUBROS_DESCUENTO_EFECTIVO} te queda en $${pesos(conEfectivo)} (total de lista $${pesos(Number(q.total))}). ¿Lo confirmo?`
            : `Perfecto, ${forma} al ${q.tipo === 'domicilio' ? 'recibir' : 'retirar'}. Total $${pesos(Number(q.total))}. ¿Lo confirmo?`;
          await this.db.from('bot_conversaciones').upsert({
            linea, telefono,
            mensajes: [...historial, { role: 'user', content: texto }, { role: 'assistant', content: resp }].slice(-MAX_HISTORIAL),
            actualizado_en: new Date().toISOString(),
          }, { onConflict: 'linea,telefono' });
          if (mensajeId) await this.db.from('bot_mensajes').upsert({ linea, mensaje_id: mensajeId, telefono, respuesta: resp }).then(() => null, () => null);
          return { respuesta: resp };
        }
      }
    }

    // EL "SÍ" CREA EL PEDIDO (23/9/2026). El banco de pruebas mostró que, ante un
    // "si" al "¿Lo confirmo?", el modelo a veces volvía a llamar preparar_pedido
    // y repetía el resumen entero (Catalina, Pedro, Juan). Es intermitente: la
    // misma charla sale bien o mal según la corrida. Un sí sin vueltas a un
    // resumen con "¿Lo confirmo?" no necesita al modelo: lo confirma el servidor
    // con las mismas guardas de crear_pedido (cotización fresca, mismo total).
    // Si la guarda lo rechaza, sigue el camino de siempre.
    if (!traeArchivo && confirmacionInequivoca(texto) && /¿lo confirmo\?/i.test(String(ultimoMsgBot))) {
      try {
        const creado = await this.crearPedido({ telefono, linea, confirmacion: texto, resumenPresentado: String(ultimoMsgBot) });
        this.log.log(`pedido ${creado.codigoRetiro} confirmado por el "sí" de ${telefono} (sin modelo)`);
        await this.db.from('bot_conversaciones').upsert({
          linea, telefono,
          mensajes: [...historial, { role: 'user', content: texto }, { role: 'assistant', content: creado.respuesta }].slice(-MAX_HISTORIAL),
          actualizado_en: new Date().toISOString(),
          esperando_desde: null, esperando_texto: null, esperando_aviso_en: null, esperando_avisos: 0,
        }, { onConflict: 'linea,telefono' });
        if (mensajeId) await this.db.from('bot_mensajes').upsert({ linea, mensaje_id: mensajeId, telefono, respuesta: creado.respuesta }).then(() => null, () => null);
        return { respuesta: creado.respuesta };
      } catch (e: any) {
        this.log.warn(`el "sí" de ${telefono} no alcanzó para confirmar directo (${e?.message ?? e}); decide el modelo`);
      }
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
    // EL "NADA MÁS" CONFIRMA (3/10/2026): si el cliente cerró la lista ("solo
    // eso", "nada más", un "sí" a "¿Está completo?") y no la cambió después, el
    // pedido se confirma en el turno en que queda preparado, sin "¿Lo confirmo?".
    // Con la charla quieta más de 3 horas, solo cuenta un cierre en este mismo
    // mensaje: un "nada más" de ayer no confirma hoy. `anotadoSinPrecios` es la
    // última lista que el bot le mostró sin precios: lo que se cotiza con la
    // lista cerrada tiene que ser eso mismo (ver cierre.ts).
    const anotadoSinPrecios = ultimaListaAnotada(historial as any[]);
    const cierreDeLista = nadaMasConfirma() && linea === 'pedidos' && anotadoSinPrecios.length
      ? listaCerrada(historial as any[], texto, { soloEsteMensaje: desdeElUltimoMensaje > 3 * 3600_000 })
      : null;
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
    if (cierreDeLista) estado.push(`el cliente YA cerró la lista ("${cierreDeLista.slice(0, 60)}"): no le preguntes si está completo ni "¿Lo confirmo?". Si ya sabés si retira o se lo enviamos (y para envío, quién recibe y la dirección), llamá preparar_pedido: con la lista cerrada CONFIRMA el pedido. Si falta uno de esos datos, preguntá SOLO ese`);
    else if (impaciente && esProveedor === false) estado.push('el cliente ya no quiere más preguntas: NO preguntes nada más; asumí la opción más común de cada ítem que falte, mostrá el resumen con el total y cerrá con un único "¿Lo confirmo?"');
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
      { role: 'user', content: contenidoDelTurno(`${texto}\n\n[metadatos: telefono del chat = ${telefono}${quien}; ahora es ${ahoraBA} (hora de Buenos Aires); si corresponde saludar, el saludo correcto es "${saludo}". Estado de la charla: ${estado.join(' · ')}${bloquesPendientes.length ? `. OJO: el cliente mandó ${bloquesPendientes.length} archivo(s) ANTES (cuando no se podían abrir) y ahora los tenés adjuntos en este turno: leelos y usalos para responder; NO preguntes nada que esos archivos ya respondan` : ''}${imagenDelTurno ? (dto.vistaPreviaDeVideo ? '. El cliente mandó un VIDEO y lo que ves es su vista previa (el primer cuadro). Usá la vista previa para entender el requerimiento, sin describir la imagen. Si falta un dato, ejecutá consultar_interno para que lo revise el local y guardá silencio hasta tener respuesta. Jamás digas que no podés ver videos' : '. El cliente mandó una FOTO: usala como información para resolver su requerimiento. NO describas la imagen, no enumeres lo visible, no digas "veo dos botellas" ni "recibí la foto". La cantidad visible NO es cantidad pedida. Respondé directamente al pedido del texto o del historial. Si falta intención, una sola pregunta concreta. Si es un producto, buscalo en el catálogo por lo que leas en la etiqueta; si es un comprobante de pago, leé el MONTO y el NOMBRE o razón social del titular que transfirió, y llamá derivar_pago con tipo "comprobante_enviado", ese monto y de_quien; si no se entiende, pedí que la saque de nuevo más nítida') : documentoDelTurno ? '. El cliente mandó un PDF: usalo para resolver su requerimiento, sin resumir el archivo salvo que lo pida. Si pregunta por productos de una lista, contestá con los del catálogo nuestro; si es un comprobante de pago, leé el MONTO y el NOMBRE o razón social del titular que transfirió, y llamá derivar_pago con tipo "comprobante_enviado", ese monto y de_quien; si no se puede leer, pedí que lo reenvíe' : ''}]`) },
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
    // El modelo NO tiene reloj: sin esto inventaba fechas de entrega pasadas y
    // "mañana" era cualquier día. Va como bloque aparte (cambia cada minuto y
    // no debe romper el caché del prompt fijo).
    const reloj = new Date();
    const fechaLarga = reloj.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Argentina/Buenos_Aires' });
    const fechaIso = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(reloj);
    const horaReloj = reloj.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/Buenos_Aires' });
    const manianaIso = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date(reloj.getTime() + 86400_000));
    system.push({ type: 'text', text: `HOY ES ${fechaLarga}, ${horaReloj} hs (Buenos Aires). En formato AAAA-MM-DD: hoy ${fechaIso}, mañana ${manianaIso}. Una fecha de entrega solo se pasa si el cliente pidió un día; si no, entrega_fecha va vacío.` });

    // Información vigente de la línea (campañas, eventos, avisos del momento):
    // la carga la dirección en las notas de la línea y Emilia la conoce sin
    // deploy. Va como bloque aparte para no romper el caché del prompt fijo.
    const infoVigente = String((lineaCfg as any)?.notas ?? '').trim();
    if (infoVigente) {
      system.push({
        type: 'text',
        // el día de la semana lo calcula el sistema: en la nota decía "jueves
        // 30/10/2026" y el 30 cae viernes; el bot se lo dijo así a un cliente (18/9/2026)
        text: `INFORMACIÓN VIGENTE DE LA CASA (cargada por la dirección). Es OFICIAL: afirmá estos datos tal cual están, incluidos precios de entradas, fechas y promociones del evento — la regla de no inventar precios aplica a los productos del catálogo, no a esto. No digas "lo vas a ver en el link": el dato lo tenés acá.\n${infoVigente.slice(0, 4000)}\n${controlDeFechas(infoVigente)}`.trim(),
      });
    }

    // "coca de 2 litros 25" es 2,25 L, no 25 unidades de 2 L: la medida partida
    // la resuelve el sistema y se la dice al modelo (18/9/2026).
    const mlPartida = medidaPartida(texto);
    if (mlPartida) {
      system.push({
        type: 'text',
        text: `MEDIDA QUE ESCRIBIÓ EL CLIENTE: "${texto.slice(0, 80)}" significa ${String(mlPartida / 1000).replace('.', ',')} L (la medida viene partida, NO es una cantidad). Buscá ese tamaño (por ejemplo "${String(mlPartida / 1000).replace('.', ',')}") antes de contestar.`,
      });
    }

    // CUÁNTO pidió de cada cosa, leído por el sistema. "Puede ser 4 Malboro gold"
    // son cuatro: el bot cotizó uno y el cliente tuvo que pedirlo dos veces más
    // UN "?" SUELTO (23/9/2026): el bot repetía los precios que acababa de dar.
    if (/^\s*[?¿]+\s*$/.test(texto)) {
      system.push({ type: 'text', text: 'El cliente mandó solo un signo de pregunta: no entendió lo último o espera algo más. PROHIBIDO repetir nada de lo que ya le dijiste (ni precios ni productos) y no llames herramientas. Preguntale en UNA línea corta qué necesita saber.' });
    }
    // (18/9/2026). El modelo ve la cuenta ya hecha y no tiene que deducirla.
    const pedidas = cantidadesPedidas(texto);
    if (pedidas.length) {
      system.push({
        type: 'text',
        text: `CANTIDADES QUE PIDIÓ EL CLIENTE EN ESTE MENSAJE (las leyó el sistema, son firmes): ${pedidas.map((x) => `${x.cantidad} × ${x.que}`).join(' · ')}. Anotá ESAS cantidades de una, sin volver a preguntar cuántas, y nombrando el producto puntual que pidió (no la lista de la marca).`,
      });
    }

    // lo último que dijo el bot antes de este mensaje: las guardas de crear_pedido
    // lo usan para saber si ya mostró el total y pidió confirmación
    const ultimoDelBot = [...historial].reverse().find((m) => m.role === 'assistant')?.content ?? '';
    const ultimosDelBot = [...historial].reverse().filter((m) => m.role === 'assistant').slice(0, 3).map((m) => String(m.content));
    const ultimosDelCliente = [...[...historial].reverse().filter((m) => m.role === 'user').slice(0, 6).map((m) => String(m.content)).reverse(), texto];
    const fallosDelTurno = new Map<string, number>();
    // una herramienta puede fijar la respuesta del turno ("Recibido." ante un comprobante)
    const respuestaFija: { texto?: string; consultaPendiente?: boolean; operacion?: boolean; derivada?: boolean } = {};
    // la casa le prometió al cliente avisar al sector por un pedido, o el bot dijo
    // "confirmado" sin código en este turno (ver al final: sale a administración)
    let prometioAvisoDePedido = false;
    let dijoCargadoSinCodigo = false;
    let vueltasTrasConsulta = 0;
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
        // LAS BÚSQUEDAS VAN EN PARALELO (1/10/2026: "tiene que responder en un
        // minuto"). Una foto con 33 productos tardaba 166 s: el modelo pedía las
        // 33 búsquedas de una, pero se ejecutaban una detrás de otra. Las que
        // solo LEEN arrancan juntas (de a 8); las que tienen efecto (pedido,
        // consulta, derivación) siguen de a una, en orden, como siempre.
        const ctxHerr = { ultimoBot: ultimoDelBot, ultimosBot: ultimosDelBot, ultimosCliente: ultimosDelCliente, textoCliente: texto, fallos: fallosDelTurno, archivoUrl: dto.archivoUrl, fija: respuestaFija, salidas: salidasDelTurno, cierre: cierreDeLista, anotado: anotadoSinPrecios };
        const adelantadas = new Map<string, Promise<Anthropic.ToolResultBlockParam>>();
        {
          const lecturas = (r.content as any[]).filter((b) => b.type === 'tool_use' && HERRAMIENTAS_DE_LECTURA.has(b.name));
          const unicas = new Map<string, any>();
          for (const b of lecturas) { const k = `${b.name}:${JSON.stringify(b.input)}`; if (!unicas.has(k)) unicas.set(k, b); }
          const cola = [...unicas.values()];
          const enCurso: Promise<void>[] = [];
          const lanzar = (b: any) => { const pr = this.ejecutarHerramienta(b, telefono, linea, ctxHerr); adelantadas.set(b.id, pr); return pr.then(() => undefined, () => undefined); };
          for (const b of cola) {
            if (enCurso.length >= 8) await Promise.race(enCurso);
            const p = lanzar(b);
            enCurso.push(p);
            p.then(() => enCurso.splice(enCurso.indexOf(p), 1));
          }
        }
        for (const block of r.content) {
          if (block.type !== 'tool_use') continue;
          herramientasDelTurno.add(block.name);
          const clave = `${block.name}:${JSON.stringify(block.input)}`;
          const previo = vistos.get(clave);
          // una consulta interna por turno: si el modelo la vuelve a pedir en la
          // vuelta siguiente, no se manda de nuevo a la casa (23/9/2026)
          if (block.name === 'consultar_interno' && respuestaFija.consultaPendiente) {
            resultados.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify({ consultado: true, aviso: 'Ya consultaste en este turno. No consultes de nuevo: escribí ahora la respuesta al cliente con lo que sí sabés.' }) });
            continue;
          }
          if (previo) {
            this.log.warn(`Herramienta ${block.name} duplicada en el mismo turno: reuso el resultado`);
            resultados.push({ ...previo, tool_use_id: block.id });
            continue;
          }
          const res = await (adelantadas.get(block.id) ?? this.ejecutarHerramienta(block, telefono, linea, ctxHerr));
          vistos.set(clave, res);
          resultados.push(res);
        }
        messages.push({ role: 'user', content: resultados });
        // tras consultar_interno el modelo SIGUE una vuelta más para contestar lo
        // que sí sabe (23/9/2026); si insiste con herramientas, se corta ahí
        if (respuestaFija.operacion) break;
        if (respuestaFija.consultaPendiente) { vueltasTrasConsulta++; if (vueltasTrasConsulta > 1) break; }
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
    if (!respuestaFija.consultaPendiente && !respuestaFija.operacion) {
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
        for (const b of r3.content) if (b.type === 'tool_use') { herramientasDelTurno.add(b.name); res3.push(await this.ejecutarHerramienta(b, telefono, linea, { ultimoBot: ultimoDelBot, ultimosBot: ultimosDelBot, ultimosCliente: ultimosDelCliente, textoCliente: texto, fallos: fallosDelTurno, archivoUrl: dto.archivoUrl, fija: respuestaFija, salidas: salidasDelTurno, cierre: cierreDeLista, anotado: anotadoSinPrecios })); }
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
    const huboCancelacion = dichoPorElBot.some((t) => /cancelad/i.test(t) && /\b(DOM|RET|PICKUP)-[A-Z0-9]{4,12}\b/.test(t));
    const sinFormulaReparto = (t: string) => t
      .replace(/[^.\n]*coordina el reparto[^.\n]*/gi, '')
      // "el pedido DOM-XXXX quedó cancelado/confirmado" es un hecho (el código solo existe si la herramienta lo creó)
      .replace(/[^.\n]*\b(DOM|RET|PICKUP)-[A-Z0-9]{4,12}\b[^.\n]*/g, '')
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
          for (const b of r5.content) if (b.type === 'tool_use') { herramientasDelTurno.add(b.name); res5.push(await this.ejecutarHerramienta(b, telefono, linea, { ultimoBot: ultimoDelBot, ultimosBot: ultimosDelBot, ultimosCliente: ultimosDelCliente, textoCliente: texto, fallos: fallosDelTurno, archivoUrl: dto.archivoUrl, fija: respuestaFija, salidas: salidasDelTurno, cierre: cierreDeLista, anotado: anotadoSinPrecios })); }
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
    const pedidoCreadoEnTurno = fallosDelTurno.get('__pedido_creado__') === 1 || /\b(DOM|RET|PICKUP)-[A-Z0-9]{4,12}\b/.test(respuesta);
    if (diceCargado.test(respuesta) && !pedidoCreadoEnTurno && vueltasReintento < 2) {
      dijoCargadoSinCodigo = true;
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
        prometioAvisoDePedido = true;
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
      // por renglón: antes se volvía a unir todo con espacios y la lista del
      // pedido llegaba en una sola línea aunque no se quitara nada (3/10/2026)
      const { texto: nueva, quitadas } = quitarOraciones(respuesta, (o) => {
        const n = normO(o);
        if (!n || /lo confirmo\?/.test(n)) return false;
        const esPregunta = /\?$/.test(n);
        return previas.has(n) && (n.length >= 30 || (esPregunta && n.length >= 12));
      });
      if (quitadas && nueva.length >= 20) {
        this.log.log(`oraciones repetidas quitadas para ${telefono}: ${quitadas}`);
        respuesta = nueva;
      }
    }

    // Fórmulas fijas que se dicen UNA vez por conversación (ronda 8: el aviso de
    // edad en 3 mensajes seguidos, la del reparto ×5): si ya se dijeron, la
    // oración que las repite se quita. Determinístico, sin llamada al modelo.
    const dichoAntes = (re: RegExp) => dichoPorElBot.some((t) => re.test(t));
    const quitarOracion = (t: string, re: RegExp) => quitarOraciones(t, (o) => re.test(o)).texto;
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
          // "no quedó cargado: doy aviso…" es la promesa por un pedido: nunca se poda (3/10/2026)
          if (/\$\s?\d|\d{1,2}[:.]\d{2}|\bno (llega|hay|tenemos|figura)\b|no lo tengo|no est[aá] cargad|no qued[oó] cargad|para (?:que lo dejen|dejarlo) confirmado|cobertura|costo del env[ií]o|castex|juana de arco/i.test(o)) return true;
          const no = o.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
          return palabrasCliente.some((w) => no.includes(w));
        };
        const { texto: podado, quitadas } = quitarOraciones(respuesta, (o) => re.test(o) && !traeDato(o));
        if (quitadas && podado.length >= 25) respuesta = podado;
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

    // EL ENVÍO EN ODB ES SIN CARGO (regla del dueño, 18/9/2026). Antes el bot
    // cerraba los pedidos con "el total es de la mercadería; el envío va
    // aparte" y le cobró de más, de palabra, a un cliente con un pedido de
    // $176.000. Si igual se le escapa, acá se corrige el texto ya escrito.
    // preguntó por el costo del envío: la respuesta la tenemos, no se consulta
    const conDato = asegurarEnvioSinCargo(texto, respuesta);
    if (conDato !== respuesta) {
      respuesta = conDato;
      this.log.warn(`preguntó por el costo del envío y la respuesta no lo decía (${telefono}): se antepuso "sin cargo"`);
    }
    const conEnvio = envioSinCargo(respuesta);
    if (conEnvio !== respuesta) {
      respuesta = conEnvio;
      this.log.warn(`decía que el envío iba aparte a ${telefono}: corregido a "sin cargo"`);
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
      messages.push({ role: 'user', content: '[nota interna: hiciste tres o más preguntas en un solo mensaje. Reescribilo con UNA sola pregunta, la más importante; no asumas presentaciones ni cantidades para los demás artículos. Si el cliente ya dio todo lo necesario, no preguntes nada: mostrá el resumen con el total y "¿Lo confirmo?".]' });
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
    // Solo cuenta el texto corrido: los renglones con viñeta son la lista (lo
    // anotado de una foto de 30 productos, una lista de precios) y antes este
    // control la achicaba a "tengo la lista anotada" (Blanquita, 1/10/2026).
    const prosa = respuesta.split('\n').filter((l) => !/^\s*•/.test(l)).join('\n');
    const oraciones = prosa.split(/(?<=[.!?])\s+/).filter((o) => o.trim().length > 0).length;
    if ((oraciones > 4 || prosa.length > 600) && !herramientasDelTurno.has('cotizar_pedido') && !herramientasDelTurno.has('crear_pedido') && vueltasReintento < 3) {
      this.log.warn(`${oraciones} oraciones sin cotización (${telefono}): regenero más corto`);
      messages.push({ role: 'assistant', content: respuesta });
      messages.push({ role: 'user', content: '[nota interna: demasiado largo. Conservá exactamente los datos verificados, importes y enlaces necesarios. Reescribilo en dos o tres líneas como máximo: el dato o la respuesta concreta, y a lo sumo una pregunta. Sin explicaciones de lo que podés o no podés hacer.]' });
      const t17 = await this.regenerar(system, messages, 1024, sumarUso);
      if (t17) respuesta = t17;
      vueltasReintento++;
    }

    // ============================================================
    // NADA DE MÁS (Leandro, 16/9/2026: "responde breve y conciso, no dice nada
    // de más"). El control de largo de arriba no ve las respuestas con precio,
    // y justo ahí se escapaban: preguntaron por el estacionamiento del evento y
    // el bot repitió precio, voucher y link; preguntaron por un Rutini y ofreció
    // otros dos vinos; preguntaron si llegan y ofreció el retiro.
    // ============================================================
    const saludoInicial = /^(buen d[ií]a|buenas tardes|buenas noches|hola)[^.\n]*[.!]?\s*(te damos la bienvenida a o\.?d\.?b\.?)?\s*/i;
    const cuerpo = respuesta.replace(saludoInicial, '').trim();
    const oracionesCuerpo = cuerpo.split(/(?<=[.!?])\s+/).filter((o) => o.trim().length > 0).length;

    // Consultas sin dato se registran en la barrera final, sin reformular
    // una promesa ni solicitar herramientas a una llamada que no las tiene.

    // 3) Pidió algo puntual y se lo ofrecen con otros productos que no pidió.
    const RE_OFRECE_OTROS = /\b(tambi[eé]n (?:tengo|tenemos|hay)|si quer[eé]s algo de la misma l[ií]nea|otras opciones|te puedo ofrecer|ten[eé]s tambi[eé]n)\b/i;
    const RE_PIDE_OPCIONES = /\b(opciones|recomend|suger|alternativ|qu[eé] (?:ten[eé]s|tienen|hay)|algo (?:para|parecido|similar)|otro|otra|cu[aá]les|variedad|parecid)/i;
    if (RE_OFRECE_OTROS.test(cuerpo) && !RE_PIDE_OPCIONES.test(texto) && vueltasReintento < 3) {
      this.log.warn(`ofreció productos que no pidieron (${telefono}): regenero`);
      messages.push({ role: 'assistant', content: respuesta });
      messages.push({ role: 'user', content: '[nota interna: el cliente preguntó por algo puntual. Contestá SOLO eso (si lo hay, precio y disponibilidad) y a lo sumo una pregunta para avanzar. No ofrezcas otros productos que no pidió.]' });
      const t21 = await this.regenerar(system, messages, 1024, sumarUso);
      if (t21) respuesta = t21;
      vueltasReintento++;
    }

    // Disputa de precio o cantidad ("son 18 botellas de $1.950 c/u", "está mal
    // la cuenta"): el bot no discute. La primera vez vuelve a verificar lo que el
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
        : '[nota interna: el cliente discute el precio o la cantidad. Verificá la presentación real con unidadesPorVenta; no asumas que todos los artículos se venden sueltos ni que un x6 en el nombre define el precio. Volvé a cotizar con cotizar_pedido usando la cantidad de UNIDADES que dijo el cliente (si dijo 18 botellas, son 18) y mostrale el total nuevo en dos líneas, sin justificar el anterior.]' });
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
    // los importes de la información vigente de la casa (evento/campaña) son
    // oficiales: el precio de la entrada no sale de cotizar_pedido
    for (const m of infoVigente.matchAll(/\d{1,3}(?:\.\d{3})+|\d{2,}/g)) permitidos.add(m[0].replace(/\./g, ''));
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
    // "Recibido." ante un comprobante va solo, sin saludo (regla del dueño, 23/9/2026)
    if (!yaSaludo && !esProveedor && respuesta.trim() && respuesta.trim() !== 'Recibido.') {
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
      respuesta = saintThomas(respetuosoSinConfianza(respuesta));
      if (antes !== respuesta) this.log.log(`registro ajustado (usted/confianzudo) para ${telefono}`);
    }

    // Una foto aporta contexto comercial; no pide una descripción visual.
    if (imagenDelTurno && !/\b(describ[ií]|descripci[oó]n|qu[eé] (?:ves|se ve|hay en la foto))\b/i.test(texto)
        && /\b(veo|se (?:ve|ven|observa|observan)|en la (?:foto|imagen) (?:hay|aparece|se ve)|recib[ií] (?:la|tu) foto)\b/i.test(respuesta)) {
      messages.push({ role: 'assistant', content: respuesta });
      messages.push({ role: 'user', content: '[nota interna: no describas la foto ni acuses recibo. Respondé directamente al requerimiento comercial usando SOLO los datos verificados. No asumas que la cantidad visible es la pedida. Si falta intención, hacé una sola pregunta útil. Conservá los importes verificados sin agregar otros.]' });
      const directa = await this.regenerar(system, messages, 1024, sumarUso);
      if (directa) respuesta = directa;
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

    }

    // NUNCA EL MISMO MENSAJE DOS VECES (regla del dueño, 22/9/2026). Si lo que
    // está por salir es casi igual al último mensaje del bot, el cliente ya lo
    // leyó y ya contestó: se reescribe una vez diciendo algo que AVANCE; si
    // vuelve a salir igual, la charla pasa a una persona en vez de repetir.
    if (respuesta && !respuestaFija.operacion && ultimosDelBot[0] && casiIgual(respuesta, ultimosDelBot[0])) {
      this.log.warn(`iba a repetir el mismo mensaje a ${telefono}: reescribo`);
      messages.push({ role: 'assistant', content: respuesta });
      messages.push({ role: 'user', content: `[nota interna: ese mensaje es casi idéntico al último que le mandaste, y el cliente ya lo leyó y contestó "${texto.slice(0, 120)}". Prohibido repetirlo. Si contestó que sí a "¿Lo confirmo?", el pedido está confirmado: llamá a crear_pedido AHORA. Si dio un dato (forma de pago, quién recibe, dirección), tomalo y avanzá al paso siguiente sin volver a resumir. Si no sabés cómo seguir, derivá a una persona con derivar_a_humano. Respondé distinto y corto.]` });
      let otra: string | null = null;
      try { otra = await this.regenerar(system, messages, 1024, sumarUso); } catch (e: any) { this.log.warn(`reescritura anti-repetición falló: ${e?.message ?? e}`); }
      if (otra && !casiIgual(otra, ultimosDelBot[0]) && !casiIgual(otra, respuesta)) {
        respuesta = otra;
      } else {
        this.log.error(`el bot iba a repetir dos veces el mismo mensaje a ${telefono}: pasa a una persona`);
        await this.derivarAHumano(linea, telefono, `El bot iba a repetir el mismo mensaje. Último del cliente: ${texto.slice(0, 200)}`, true).catch(() => null);
        respuesta = 'Te paso con una persona del local, te contesta por acá.';
      }
    }

    // Última validación, DESPUÉS de todas las reformulaciones: sólo importes
    // devueltos por herramientas, nunca números escritos por el cliente.
    const hechos = new Set<number>(Array.isArray(conv?.importes_verificados) ? conv.importes_verificados.filter((n: any) => Number.isInteger(n)) : []);
    for (const raw of salidasDelTurno) {
      try { for (const n of importesDeHerramienta(JSON.parse(raw))) hechos.add(n); } catch { /* error de herramienta sin datos */ }
    }
    for (const n of importesDelTexto(infoVigente)) hechos.add(n);
    if (respuestaFija.operacion && respuestaFija.texto) respuesta = respuestaFija.texto;
    else if (respuestaFija.consultaPendiente) respuesta = respuestaConConsulta(respuesta, ultimosDelBot[0]);
    else {
      const importeSinFuente = importesDelTexto(respuesta).some(n => !hechos.has(n));
      const prometeConsultar = /\b(lo consulto|[tl]e confirm(?:o|amos) por ac[aá]|vuelvo a vos|lo verifico con|no (?:lo |la )?tengo (?:ese |el |este |esa |la )?(?:dato|info(?:rmaci[oó]n)?|cargad)|no cuento con (?:ese|esa|el|la) (?:dato|informaci[oó]n)|lo revisa alguien)\b/i.test(respuesta);
      if (importeSinFuente || prometeConsultar) {
        try {
          const consulta = await this.consultarInterno(linea, telefono, 'local', texto || 'Revisar el adjunto enviado por el cliente', '', dto.archivoUrl);
          if (consulta.consultado) { respuestaFija.consultaPendiente = true; respuesta = respuestaConConsulta(importeSinFuente ? '' : respuesta, ultimosDelBot[0]); }
        } catch {
          await this.derivarAHumano(linea, telefono, `Revisar consulta no resuelta: ${texto.slice(0,500)}`, true);
          respuesta = 'Tomo tu consulta y doy aviso al equipo.';
        }
      }
    }

    // si preguntó cuánto sale el envío, la respuesta lo dice SIEMPRE, también
    // cuando la validación de importes de arriba reemplazó el texto por el acuse
    // de consulta (banco 25/9/2026: "¿cuánto es el flete?" → "Lo consulto…")
    // también si quedó vacía (acuse ya dicho): "¿cuánto es el flete?" no queda sin
    // respuesta nunca (banco 1/10/2026: silencio)
    respuesta = asegurarEnvioSinCargo(texto, respuesta ?? '');
    if (respuesta) respuesta = minimoConMonto(respuesta, envioMinimo());
    // con la lista ya cerrada no se vuelve a preguntar si está completa
    // la promesa de avisar por un pedido se decide sobre lo que escribió el bot,
    // ANTES de la pregunta de completo que agrega el sistema (3/10/2026)
    const respuestaDelBot = respuesta;
    const prometeAvisoAlSector = /aviso al (?:sector|local|equipo)/i.test(respuesta ?? '');
    if (respuesta && !respuestaFija.operacion && !cierreDeLista) { if (!prometioAvisoDePedido && !prometeAvisoAlSector) respuesta = conPreguntaDeCompleto(respuesta); }
    // si el bot todavía pide confirmación, o el sistema le agregó "¿Está completo…?"
    // (es una lista en armado), no hay un pedido confirmado que avisar
    const sigueEnCurso = /¿\s*lo confirmo\?|¿[^?]*(?:est[aá] completo|sumar algo)[^?]*\?/i.test(respuestaDelBot ?? '') || respuesta !== respuestaDelBot;
    // lo interno (stock, sucursales, "el sistema") no sale al cliente (1/10/2026)
    if (respuesta) respuesta = sinLoConsulto(retiroOEnvio(sinCocinaInterna(respuesta)));

    // "doy aviso al sector correspondiente para dejarlo confirmado" es una
    // promesa al cliente: que se cumpla. Sale a administración como PEDIDO
    // CONFIRMADO SIN CARGAR (3/10/2026). Solo con hechos: la frase la puso el
    // sistema, o crear_pedido falló en este turno; y no si el chat ya tiene un
    // pedido confirmado en las últimas horas (entonces preguntaba por ese).
    const prometePedido = /aviso al sector correspondiente para (?:que lo dejen|dejarlo) confirmado|\btomo (?:tu|su|el) pedido\b|aviso al (?:sector|local|equipo)[^.\n]{0,80}?para (?:que lo dejen|dejarlo) (?:confirmad|cargad|armad)/i.test(respuesta ?? '');
    const huboIntentoDePedido = herramientasDelTurno.has('crear_pedido') || (fallosDelTurno.get('crear_pedido') ?? 0) >= 1 || dijoCargadoSinCodigo || /¿[^?]{0,30}\bconfirm\w*[^?]{0,60}\?|lo dejo cargad/i.test(String(ultimoDelBot));
    // si la respuesta todavía pide confirmación, no hay pedido confirmado que avisar
    if (linea === 'pedidos' && fallosDelTurno.get('__pedido_creado__') !== 1 && !sigueEnCurso
        && (prometioAvisoDePedido || (prometePedido && huboIntentoDePedido))) {
      await this.encolarPedidoSinCargar(linea, telefono, `El bot le dijo al cliente: «${respuesta.slice(0, 300)}». Último mensaje del cliente: «${texto.slice(0, 300)}».`, { salvoPedidoReciente: true });
    }

    // 4) persistir memoria (solo los turnos de texto, recortada) + tokens acumulados
    const nuevoHistorial = [
      ...historial,
      { role: 'user' as const, content: texto },
      ...(respuesta ? [{ role: 'assistant' as const, content: respuesta }] : []),
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
      importes_verificados: [...hechos].slice(-400),
      actualizado_en: new Date().toISOString(),
      // La cola de consultas tiene seguimiento propio; no borrar la espera al callar.
      // si en el turno se consultó o se derivó, el cliente sigue esperando a una persona
      ...(respuestaFija.consultaPendiente || respuestaFija.derivada ? {} : { esperando_desde: null, esperando_texto: null, esperando_aviso_en: null, esperando_avisos: 0 }),
    });
    // la tarifa vive en tarifas.ts (la misma que usa el banco de pruebas)
    const costo = costoUSD(MODELO_BOT, uso);
    this.log.log(`charla ${linea}/${telefono}: ${tokens} tokens · ${uso.llamadas} llamadas · entrada ${uso.entrada} · caché leída ${uso.cacheLeida} · caché escrita ${uso.cacheEscrita} · salida ${uso.salida} · ≈ USD ${costo.toFixed(3)}`);

    // 5) marcar el mensaje como procesado (idempotencia ante reintentos)
    if (mensajeId) {
      await this.db.from('bot_mensajes').upsert({ linea, mensaje_id: mensajeId, telefono, respuesta });
    }

    // los productos con precio que el bot consultó en el turno: con ellos se
    // arma la imagen de precios, escriba como escriba la respuesta (1/10/2026)
    const catalogo: ProductoConPrecio[] = [];
    const sinStockVistos: string[] = [];
    for (const raw of salidasDelTurno) {
      try {
        const o = JSON.parse(raw);
        for (const it of (Array.isArray(o?.items) ? o.items : [])) {
          if (it?.nombre && Number(it?.precio) > 0) catalogo.push({ sku: it.sku, nombre: String(it.nombre), precio: Number(it.precio), precioEfectivo: it.precioEfectivo ?? null });
        }
        if (typeof o?.sinStock === 'string') sinStockVistos.push(o.sinStock);
        if (o?.tamanos) sinStockVistos.push(typeof o.tamanos === 'string' ? o.tamanos : JSON.stringify(o.tamanos));
      } catch { /* salida sin JSON */ }
    }
    return respuestaFija.consultaPendiente && !respuesta
      ? { respuesta: null, silencio: true, motivo: 'consulta interna pendiente' } as any
      : { respuesta, catalogo, sinStock: sinStockVistos };
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
    ctx: { ultimoBot?: string; ultimosBot?: string[]; ultimosCliente?: string[]; textoCliente?: string; fallos?: Map<string, number>; archivoUrl?: string; fija?: { texto?: string; consultaPendiente?: boolean; operacion?: boolean; derivada?: boolean }; salidas?: string[]; cierre?: string | null; anotado?: { cantidad: number; nombre: string }[] } = {},
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
          out = await this.buscarProductos(String(input.q ?? ''), (sku) => skusVistosEnTurno.add(sku), telefono);
          for (const it of ((out as any)?.items ?? [])) if (it?.sku) skusVistosEnTurno.add(String(it.sku));
          break;
        case 'preparar_pedido': {
          // ya se confirmó un pedido en este turno (por el cierre de la lista):
          // otro preparar_pedido armaría un segundo pedido igual
          if (ctx.fallos?.get('__pedido_creado__') === 1) { out = { error: 'El pedido ya quedó confirmado en este turno: no prepares otro. Contestale con la confirmación.' }; break; }
          if (!puedeCotizar(ctx.textoCliente ?? '', ctx.ultimosBot ?? [], (ctx.ultimosCliente ?? []).slice(0, -1))) { out = { error: TODAVIA_SIN_PRECIOS }; break; }
          out = await this.prepararPedido(telefono, linea, input, ctx.textoCliente, ctx.ultimoBot, ctx.ultimosCliente);
          if (ctx.fija) { ctx.fija.texto = (out as any).resumen; ctx.fija.operacion = true; }
          // EL "NADA MÁS" CONFIRMA (3/10/2026). Si el cliente ya cerró la lista y
          // lo cotizado es lo mismo que vio anotado, el pedido se confirma acá y la
          // respuesta es la confirmación, sin "¿Lo confirmo?". Si algo no cierra
          // (una fecha corregida, el modelo cambió un producto o una cantidad, la
          // base lo rechaza), queda el resumen con "¿Lo confirmo?" como siempre.
          const prep: any = out;
          const cotizado = ((prep?.renglones ?? []) as any[]).map((r) => ({ cantidad: Number(r.cantidad), nombre: String(r.nombre ?? '') }));
          // Un pedido de este chat confirmado hace menos de 15 minutos: puede ser
          // un reintento del mismo mensaje (el proceso se cayó antes de guardar
          // la charla). No se crea otro sin preguntar: queda el "¿Lo confirmo?".
          const confirmadoHacePoco = ctx.cierre
            ? !!(await this.db.from('bot_cotizaciones').select('id').eq('telefono', telefono).eq('linea', linea)
                .gte('confirmada_en', new Date(Date.now() - 15 * 60_000).toISOString()).limit(1).maybeSingle()).data
            : false;
          if (confirmadoHacePoco) this.log.warn(`lista cerrada de ${telefono}, pero hay un pedido confirmado hace menos de 15 min: se pide confirmación`);
          if (ctx.cierre && !confirmadoHacePoco && prep?.cotizacionId && !prep.avisoFecha && coincideConLoAnotado(ctx.anotado ?? [], cotizado)) {
            try {
              const creado = await this.crearPedido({ telefono, linea, confirmacion: ctx.cierre, modo: 'completo', cotizacionId: prep.cotizacionId });
              this.log.log(`pedido ${creado.codigoRetiro} confirmado por el cierre de la lista ("${ctx.cierre.slice(0, 40)}") de ${telefono}`);
              ctx.fallos?.set('__pedido_creado__', 1);
              out = { ...creado, aviso: `El cliente ya había cerrado la lista ("${ctx.cierre.slice(0, 60)}"): el pedido QUEDÓ CONFIRMADO con el código ${creado.codigoRetiro}. No llames a crear_pedido ni le pidas confirmación.` };
              if (ctx.fija) { ctx.fija.texto = creado.respuesta; ctx.fija.operacion = true; }
            } catch (e: any) {
              this.log.warn(`el cierre de la lista de ${telefono} no alcanzó para confirmar directo (${e?.message ?? e}); queda el "¿Lo confirmo?"`);
            }
          }
          break;
        }
        case 'crear_pedido': {
          if (!confirmacionInequivoca(ctx.textoCliente ?? '')) {
            out = { error: 'NO se creó el pedido: falta confirmación inequívoca al resumen. Usá preparar_pedido y esperá la aceptación del cliente.' };
            break;
          }
          out = await this.crearPedido({ telefono, linea, confirmacion: ctx.textoCliente!, resumenPresentado: ctx.ultimoBot ?? '' });
          ctx.fallos?.set('__pedido_creado__', 1);
          if (ctx.fija) { ctx.fija.texto = (out as any).respuesta; ctx.fija.operacion = true; }
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
          if (!puedeCotizar(ctx.textoCliente ?? '', ctx.ultimosBot ?? [], (ctx.ultimosCliente ?? []).slice(0, -1))) {
            // frena los precios, pero avisa lo que no alcanza: sin cantidades de
            // stock a la vista, el bot no tenía cómo saberlo (500 Fernet, 1/10/2026)
            let faltan = '';
            try {
              const prueba: any = await this.cotizarPedido((input.items ?? []).map((i: any) => ({ sku: String(i.sku), cantidad: Number(i.cantidad) })), telefono);
              const cortos = (prueba?.renglones ?? []).filter((r: any) => r.alcanzaElStock === false).map((r: any) => r.nombre);
              if (cortos.length) faltan = ` OJO: de ${cortos.join(', ')} NO hay disponible la cantidad que pide. En esa misma lista decile que esa cantidad no la tenés disponible ahora (sin decir cuántas hay) y consultalo con el local (consultar_interno).`;
            } catch { /* sin datos de stock: sigue la guarda */ }
            out = { error: TODAVIA_SIN_PRECIOS + faltan }; break;
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
          // un comprobante se registra UNA vez por turno: el modelo a veces llama
          // la herramienta varias veces seguidas y a administración le llegaban
          // avisos repetidos del mismo pago (banco de pruebas, 23/9/2026)
          if (tipoPago === 'comprobante_enviado' && ctx.fallos?.get('__comprobante__')) {
            out = { derivado: true, aviso: 'Este comprobante ya quedó registrado y avisado en este turno. No llames más derivar_pago. Respondé exactamente "Recibido."' };
            if (ctx.fija) ctx.fija.texto = 'Recibido.';
            break;
          }
          if (tipoPago === 'comprobante_enviado') ctx.fallos?.set('__comprobante__', 1);
          out = await this.derivarPago(linea, telefono, motivo, { monto, tipo: tipoPago, comprobanteUrl: ctx.archivoUrl, dichoPorElCliente: ctx.textoCliente, deQuien: input.de_quien ? String(input.de_quien).slice(0, 120) : undefined });
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
          out = await this.consultarInterno(linea, telefono, area, consulta, direccion, ctx.archivoUrl);
          if ((out as any)?.consultado && ctx.fija) ctx.fija.consultaPendiente = true;
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
          if (ctx.fija) ctx.fija.derivada = true;
          break;
        case 'generar_link_pago': {
          out = await this.linkDelPedido(telefono, String(input.codigo ?? ''));
          if (ctx.fija) { ctx.fija.texto = `Total: $${pesos((out as any).monto)}. ${(out as any).url}`; ctx.fija.operacion = true; }
          break;
        }
        case 'consultar_cava':
          out = await this.consultarCava({
            tipo: input.tipo ? String(input.tipo) : undefined,
            cepa: input.cepa ? String(input.cepa) : undefined,
            precioMin: input.precioMin != null ? Number(input.precioMin) : undefined,
            precioMax: input.precioMax != null ? Number(input.precioMax) : undefined,
            buscar: input.buscar ? String(input.buscar) : undefined,
          }, telefono);
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
      // PEDIDO GRANDE (3/10/2026): supera el máximo del canal y "debe tomarlo el
      // equipo". Con los datos completos (el tope se revisa después de modalidad,
      // nombre y dirección), sale a administración en el acto, con nota y campanita.
      if (block.name === 'preparar_pedido' && linea === 'pedidos' && /supera el m[aá]ximo del canal/i.test(msg)) {
        try {
          const items = Array.isArray(input?.items) ? input.items : [];
          const unidades = items.reduce((n: number, i: any) => n + (Number(i?.cantidad) || 0), 0);
          const nota = `PEDIDO GRANDE NO CARGADO (supera el máximo del canal WhatsApp: ${items.length} renglones / ${unidades} u). Ítems: ${items.map((i: any) => `${i.cantidad}x ${i.sku}`).join(', ') || '(sin ítems)'}. Modalidad: ${input?.tipo ?? '?'}. Dirección: ${input?.direccion ?? '-'}. Recibe: ${input?.nombre ?? '-'}. Notas: ${input?.notas ?? '-'}. Hay que cargarlo a mano y avisarle por este chat.`;
          const hace10 = new Date(Date.now() - 10 * 60_000).toISOString();
          const { data: prev } = await this.db.from('bot_notas_equipo').select('id').eq('telefono', telefono).like('nota', 'PEDIDO GRANDE NO CARGADO%').gte('creada_en', hace10).limit(1).maybeSingle();
          if (!prev) {
            await this.db.from('bot_notas_equipo').insert({ linea, telefono, nota });
            const { data: cfg } = await this.db.from('lineas_whatsapp').select('avisar_proveedores_a').eq('linea', linea).eq('activa', true).limit(1).maybeSingle();
            await this.db.from('alertas_internas').insert({ para_usuario: cfg?.avisar_proveedores_a ?? null, tipo: 'derivacion', titulo: `Pedido grande de +${telefono} para cargar a mano`, detalle: nota, referencia: { linea, telefono } });
          }
          await this.encolarPedidoSinCargar(linea, telefono, nota);
          freno += ' Por el tamaño, este pedido lo carga una persona del local: la nota y el aviso a administración YA salieron con todos los datos. NO pidas confirmación, NO digas confirmado ni cargado y NO vuelvas a llamar a preparar_pedido. Decile al cliente, con estas palabras o parecidas: "Por el tamaño del pedido, tomo su pedido con todos los datos y doy aviso al sector correspondiente para que lo dejen confirmado."';
        } catch (e2: any) { this.log.warn(`no pude dejar la nota del pedido grande: ${e2?.message ?? e2}`); }
      }
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
          // y sale por WhatsApp a administración (regla del 3/10/2026), sin
          // depender de cómo redacte el bot la respuesta: es el caso en que más
          // falta hace avisar (encolar ya descarta repetidos por chat)
          await this.encolarPedidoSinCargar(linea, telefono, nota);
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
  // unidades_pack=1 también se usa en artículos envasados y kits. No prueba
  // que se pueda abrir un envase o vender su contenido por separado.
  private presentacionAmbigua(nombre: string, unidadesPack?: number | null): boolean {
    return presentacionProducto({ nombre, unidades_pack: unidadesPack }).presentacion === 'requiere_verificacion';
  }
  private notaUnidad(nombre: string, unidadesPack?: number | null): string {
    return presentacionProducto({ nombre, unidades_pack: unidadesPack }).unidad;
  }
  private async preciosDelCliente(ids: string[], telefono?: string) {
    const cliente = telefono ? await this.identificarCliente(telefono) : null;
    const { data, error } = await this.db.rpc('catalogo_precios_bot', { p_ids: ids, p_cliente_id: cliente?.clienteId ?? null });
    if (error) throw new BadRequestException('No se pudo consultar el precio vigente del cliente');
    return data ?? [];
  }

  private sucCompacta(xs: any[] | string | undefined): string {
    // consultar_cava ya trae las sucursales como texto; buscar_productos como array.
    // (Ronda 6: pasarle el texto a .map() rompió la cava entera: 38 llamadas fallidas.)
    if (typeof xs === 'string') return xs;
    return (xs ?? [])
      .map((s: any) => `${String(s.sucursal ?? s.nombre ?? '').replace(/^Suc /, '').replace(/^Sant Thomas/, 'Saint Thomas')}: ${Number(s.cantidad ?? 0)}`)
      .join(' · ');
  }
  private sinNulos<T extends Record<string, any>>(o: T): Partial<T> {
    const r: any = {};
    for (const [k, v] of Object.entries(o)) if (v !== null && v !== undefined && v !== false && v !== '') r[k] = v;
    return r;
  }

  async buscarProductos(q: string, skusVistos: (sku: string) => void = () => undefined, telefono?: string) {
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
    {
      try {
        const { data: cats } = await this.db.from('categorias').select('id, nombre');
        const nq = t.toLowerCase();
        const sing = (w: string) => w.replace(/(es|s)$/, '');
        const esDeCategoria = (w: string, nc: string) => w.length >= 4 && (nc.includes(sing(w)) || sing(w).includes(nc.split(/\s+/)[0]));
        const nombresCat = ((cats ?? []) as any[]).map((c) => String(c.nombre).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''));
        const match = ((cats ?? []) as any[]).filter((_, i) => nq.split(/\s+/).some((w) => esDeCategoria(w, nombresCat[i])));
        // 16/9/2026: "whisky" traía 13 productos (los que dicen "whisky" en el
        // nombre) y se perdía el resto de la categoría, incluido el Chivas de
        // 4,5 L. Si no nombró marca (solo categoría y tamaño), va la categoría entera.
        const sinMarca = match.length > 0 && nq.split(/\s+/).every((w) => PALABRA_GENERICA.test(w) || nombresCat.some((nc) => esDeCategoria(w, nc)));
        if (match.length && (!hayConStock || stock.length < 5 || sinMarca)) {
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
    const { data: prods } = await this.db.from('productos').select('id, sku, es_alcohol, unidades_pack, vendido_por_peso, unidades_vendidas, categoria:categorias(nombre)').in('sku', stock.map((p: any) => p.sku));
    const esMayorista = telefono ? (await this.identificarCliente(telefono).catch(() => null as any))?.mayorista === true : false;
    const idPorSku = new Map((prods ?? []).map((p: any) => [p.sku, p]));
    const precios = await this.preciosDelCliente((prods ?? []).map((p: any) => p.id), telefono);
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
        precio: pr?.precio_final != null ? Number(pr.precio_final) : null,
        precioEfectivo: pr?.precio_final != null && !esMayorista && tieneDescuentoEfectivo(prod?.categoria?.nombre) ? conDescuentoEfectivo(Number(pr.precio_final)) : null,
        promo: pr?.descuento_nombre ? `${pr.descuento_nombre} (antes $${Math.round(pr.precio_lista)})` : null,
        alcohol: !!prod?.es_alcohol,
        ...presentacionProducto({ ...prod, nombre: p.nombre }),
        medida: etiquetaVolumen(volumenMl(p.nombre)),
        disponible: true, // cantidades y sucursales no viajan: son internas (1/10/2026)
      });
    });
    // Tamaños: la medida viaja aparte y las botellas de MÁS de 1 litro se
    // nombran explícitas. Si pidió un tamaño, las más grandes van primero.
    const tamano = pideTamano(t);
    if (tamano) items.sort((a: any, b: any) => (volumenMl(b.nombre) ?? 0) - (volumenMl(a.nombre) ?? 0));
    // POR DEFECTO, EL MÁS VENDIDO (Leandro, 1/10/2026: "el sistema pregunta
    // mucho; Baron B es extra brut, Savora es de 250, la manteca es La Serenísima
    // por 200… y si algo está mal que lo cambie la persona"). Si el cliente no
    // aclaró marca, tamaño o variante, va el más vendido de lo que hay en stock.
    const porDefecto: any = !tamano ? elegirPorDefecto(items as any[], (sku: string) => Number(idPorSku.get(sku)?.unidades_vendidas ?? 0), t) : null;
    if (porDefecto) { porDefecto.porDefecto = true; items.splice(items.indexOf(porDefecto), 1); items.unshift(porDefecto); }
    const grandes = items.filter((i: any) => (volumenMl(i.nombre) ?? 0) > 1000);
    const avisoGrandes = grandes.length
      ? `Formatos de MÁS de 1 litro con stock: ${grandes.map((i: any) => `${i.nombre} (${i.medida}) $${i.precio}`).join(' | ')}. Si el cliente pide "más de 1 litro", "2 o 3 litros", "grande" o para regalo, OFRECÉ ESTOS primero; nunca digas que 1 L es lo más grande.`
      : tamano?.grande ? 'En esta búsqueda no hay botellas de más de 1 litro con stock. Antes de decírselo al cliente, buscá también "balancin" y la categoría sola.' : null;
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
            .select('id, sku, nombre, es_alcohol, unidades_pack, vendido_por_peso, stock(cantidad, sucursal:sucursales(nombre))')
            .eq('categoria_id', (ref as any).categoria_id)
            .eq('activo', true)
            .limit(80);
          const conAlgo = ((mismos ?? []) as any[]).filter((p) => (p.stock ?? []).some((r: any) => Number(r.cantidad) > 0 && String(r.sucursal?.nombre ?? '') === nombrePick));
          if (conAlgo.length) {
            const pr = await this.preciosDelCliente(conAlgo.map((p) => p.id), telefono);
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
                precio: precioDe.get(p.id)?.precio_final != null ? Number(precioDe.get(p.id).precio_final) : null,
                ...presentacionProducto(p),
                alcohol: !!p.es_alcohol,
                medida: etiquetaVolumen(volumenMl(p.nombre)),
                stock: (p.stock ?? []).filter((r: any) => Number(r.cantidad) > 0).map((r: any) => `${String(r.sucursal?.nombre ?? '').replace(/^Suc /, '').replace(/^Sant Thomas/, 'Saint Thomas')}: ${Number(r.cantidad)}`).join(' · '),
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
    // Tamaños del catálogo, con y sin stock. Sin esto el bot dice "no lo
    // tenemos" o "el formato más grande es X" cuando el tamaño existe y solo
    // falta stock (18/9/2026: Coca 2,25 L, que la casa sí vende).
    const tamanos = resumenDeTamanos(items.map((i: any) => String(i.nombre ?? '')), sinStock.map((p: any) => String(p.nombre ?? '')));
    return {
      items,
      ...(tamanos ? { tamanos } : {}),
      ...(avisoGrandes ? { formatosGrandes: avisoGrandes } : {}),
      ...(sinStock.length
        ? {
            sinStock: `${sinStock.slice(0, 6).map((p: any) => p.nombre).join(' | ')}${sinStock.length > 6 ? ` | +${sinStock.length - 6} más` : ''} [SIN STOCK — no ofrecer]`,
          }
        : {}),
      ...(alternativas.length
        ? {
            alternativasDeLaCategoria: alternativas,
            aviso: `Alternativas con stock en ${nombreSucursalCliente(nombrePick)} (de ahí salen los pedidos) de la categoría ${categoriaAlt ?? ''}: PRIMERO la misma marca en otro tamaño (mismaMarca: true), después el resto de menor a mayor precio. Si lo que pidió no se puede pedir, el "no tenemos X" va SIEMPRE con "sí tenemos Y a $Z" en el mismo mensaje. NUNCA cotices un producto distinto al que nombró el cliente sin decirlo en la primera línea.`,
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
  // el control de desvío vive en desvio.ts (con tests): ver por qué ahí

  async cotizarPedido(items: { sku: string; cantidad: number }[], telefono?: string, ctxCliente?: { textoCliente?: string; ultimosBot?: string[] }) {
    items = agruparItems(items);

    // el precio depende del cliente (mayorista/segmento), igual que en la venta
    let mayorista = false;
    if (telefono) {
      const ident = await this.identificarCliente(telefono);
      mayorista = (ident as any)?.mayorista === true;
    }

    const renglones: any[] = [];
    let total = 0;
    let totalEfectivo = 0;
    let hayFaltantes = false;

    // Los pedidos por WhatsApp salen SIEMPRE de la sucursal con retiro (Sant
    // Thomas): el stock que cuenta es el de ahí. Sumar las dos sucursales hacía
    // cotizar 48 latas cuando en Sant Thomas había 30 (ronda 5).
    const { data: sucPick } = await this.db.from('sucursales').select('id, nombre').eq('activa', true).eq('pickup', true).limit(1).maybeSingle();
    const sucPickId = sucPick?.id ?? null;
    const sucPickNombre = nombreSucursalCliente(sucPick?.nombre);

    for (const it of items) {
      const sku = String(it.sku ?? '').trim();
      const cantidad = Number(it.cantidad ?? 0);
      if (!sku || !Number.isFinite(cantidad) || !(cantidad > 0)) throw new BadRequestException('Cada renglón necesita SKU y cantidad positiva finita');

      // por SKU exacto: la búsqueda por texto fallaba con códigos cortos (L1063)
      const { data: prod } = await this.db.from('productos').select('id, sku, nombre, activo, unidades_pack, vendido_por_peso, categoria:categorias(nombre), stock(cantidad, sucursal_id)').eq('sku', sku).maybeSingle();
      if (!prod || prod.activo === false) {
        renglones.push({ sku, cantidad, error: 'No existe ese código en el catálogo' });
        hayFaltantes = true;
        continue;
      }
      // Solo contrastar una cantidad inequívoca de un único producto. Comparar
      // todos los números con todos los SKU rechazaba listas válidas (6 aguas + 2 vinos).
      const unidadesPorVenta = Number(prod.unidades_pack ?? 1);
      const cantidades = cantidadesIndividuales(String(ctxCliente?.textoCliente ?? ''));
      if (!prod.vendido_por_peso && !Number.isInteger(cantidad)) {
        renglones.push({ sku, cantidad, error: 'Este producto se vende por unidades enteras; no se puede fraccionar.' }); hayFaltantes = true; continue;
      }
      if (cantidades.length && this.presentacionAmbigua(prod.nombre, prod.unidades_pack)) {
        renglones.push({ sku, cantidad, error: 'Contenido del envase no verificado. Consultá al local antes de cotizar unidades individuales de este artículo.' });
        hayFaltantes = true;
        continue;
      }
      if (items.length === 1 && cantidades.length === 1 && !/\b(packs?|cajas?|bultos?)\b/i.test(ctxCliente?.textoCliente ?? '')) {
        const solicitadas = cantidades[0];
        if (cantidad * unidadesPorVenta !== solicitadas) {
          renglones.push({ sku, cantidad, unidadesPorVenta, error: `El cliente pidió ${solicitadas} unidades individuales; cada unidad de venta contiene ${unidadesPorVenta}. No cambies la cantidad solicitada. Si no se puede vender esa cantidad exacta, preguntá antes de redondear o sustituir.` });
          hayFaltantes = true;
          continue;
        }
      }
      const pr = await this.preciosDelCliente([prod.id], telefono);
      const fila: any = (pr ?? [])[0] ?? {};
      const p: any = {
        sku: prod.sku, nombre: prod.nombre,
        precio: fila.precio_final != null ? Number(fila.precio_final) : null,
        stockTotal: ((prod as any).stock ?? []).reduce((a: number, r: any) => a + Number(r.cantidad), 0),
        stockSantThomas: ((prod as any).stock ?? []).filter((r: any) => sucPickId && r.sucursal_id === sucPickId).reduce((a: number, r: any) => a + Number(r.cantidad), 0),
      };
      const disponible = Number(p.stockSantThomas ?? 0);
      const unitario = Number(p.precio ?? 0);
      if (!(unitario > 0)) {
        renglones.push({ sku, nombre: p.nombre, cantidad, error: 'Sin precio cargado' });
        hayFaltantes = true;
        continue;
      }
      // ¿es lo que el cliente pidió, o un reemplazo que nunca anunció?
      const desvio = ctxCliente?.textoCliente ? desvioDeLoPedido(p.nombre, ctxCliente.textoCliente) : null;
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
        if (!acepto) {
          renglones.push({ sku, nombre: p.nombre, cantidad, reemplazo_no_confirmado: true, error: `NO cotices esto todavía: ${desvio}. Decíselo en la primera línea ("la de X no la tengo; ¿le cotizo la de Y a $Z?") y esperá que acepte. Recién después pedí el total.` });
          hayFaltantes = true;
          continue;
        }
      }
      const subtotal = Math.round(unitario * cantidad * 100) / 100;
      total += subtotal;
      const conDescuento = !mayorista && tieneDescuentoEfectivo((prod as any)?.categoria?.nombre);
      const subtotalEfectivo = conDescuento ? conDescuentoEfectivo(subtotal) : subtotal;
      totalEfectivo += subtotalEfectivo;
      renglones.push({
        sku,
        producto_id: prod.id,
        unidades_pack: prod.unidades_pack,
        nombre: p.nombre,
        cantidad,
        precioUnitario: unitario,
        unidadesIndividuales: this.presentacionAmbigua(prod.nombre, prod.unidades_pack) ? null : cantidad * unidadesPorVenta,
        renglon: `${cantidad} × $${pesos(unitario)} c/u = $${pesos(subtotal)}`,
        ...presentacionProducto({ ...prod, nombre: p.nombre }),
        subtotal,
        ...(conDescuento ? { subtotalEfectivo } : {}),
        stockDisponible: disponible,
        alcanzaElStock: disponible >= cantidad,
        ...(disponible < cantidad ? { aviso: `No alcanza el stock para ${cantidad}. NO le digas al cliente cuántas hay ni dónde: decile que esa cantidad no la tenés disponible ahora y consultalo con el local (consultar_interno). No prometas lo que no hay.` } : {}),
      });
      if (disponible < cantidad) hayFaltantes = true;
    }

    return {
      renglones,
      total: Math.round(total * 100) / 100,
      ...(Math.round(totalEfectivo) < Math.round(total) ? {
        totalEfectivo: Math.round(totalEfectivo * 100) / 100,
        descuentoEfectivo: `Pagando en efectivo o transferencia hay ${porcentajeEfectivo()}% de descuento en ${RUBROS_DESCUENTO_EFECTIVO}: el total queda en totalEfectivo. Informá los dos totales; el pedido se confirma con el total de lista.`,
      } : {}),
      listaDePrecio: mayorista ? 'mayorista' : 'minorista',
      hayFaltantes,
      sucursalId: sucPickId,
      sucursalDeSalida: sucPickNombre,
      ...(renglones.some((r: any) => r.reemplazo_no_confirmado) ? { reemplazoSinConfirmar: 'HAY UN RENGLÓN QUE NO ES LO QUE EL CLIENTE PIDIÓ: no des ningún total ni pases a retiro/domicilio hasta que acepte el reemplazo.' } : {}),
      aclaracion: `Este total lo calculó el sistema. Informalo tal cual, sin rehacer la cuenta. Cada precio es por UNIDAD DE VENTA del SKU. Respetá unidad, presentacion y unidadesPorVenta de cada renglón; no deduzcas el contenido de un envase por su nombre. Los renglones con error no están cotizados; el total es parcial y no permite confirmar el pedido completo. Cada renglón viene formateado en "renglon": usalo tal cual (2 × $20.500 c/u = $41.000). El stock es interno: nunca le digas al cliente cantidades ni sucursales.${hayFaltantes ? ' HAY RENGLONES SIN STOCK SUFICIENTE: decile que esa cantidad no la tenés disponible ahora, sin decir cuántas hay.' : ''} El envío es SIN CARGO: el total que informás es todo lo que paga, no agregues costo de entrega ni digas que "va aparte".`,
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

  async prepararPedido(telefono: string, linea: string, input: any, textoCliente?: string, ultimoBot?: string, dichoPorElCliente?: string[]) {
    const tipo = input.tipo;
    if (!['pickup', 'domicilio'].includes(tipo)) throw new BadRequestException('Falta elegir retiro o envío');
    // RETIRO O ENVÍO LO ELIGE EL CLIENTE (23/9/2026). Si el bot acaba de
    // preguntarlo y el cliente contestó otra cosa ("sumale 1 smirnoff"), el
    // modelo ponía "Retiro en la sucursal Saint Thomas" por su cuenta.
    if ((esperaRetiroOEnvio(ultimoBot ?? '') && !eligeRetiroOEnvio(textoCliente ?? '')) || (dichoPorElCliente && !eligioModalidad(tipo, String(input.direccion ?? ''), dichoPorElCliente))) {
      throw new BadRequestException('El cliente todavía NO eligió retiro o envío: cotizá lo nuevo con cotizar_pedido y volvé a preguntarle si lo retira por la sucursal Saint Thomas o se lo enviamos.');
    }
    // el modelo llena los campos obligatorios con basura cuando no tiene el dato
    for (const k of ['nombre', 'direccion', 'notas', 'entrega_fecha', 'entrega_franja']) input[k] = campoLimpio(input[k]);
    const nombre = nombreLimpio(input.nombre);
    const direccion = String(input.direccion ?? '').trim();
    if (tipo === 'domicilio' && (!nombre || !/[a-záéíóúñ]/i.test(direccion) || !/\d/.test(direccion))) throw new BadRequestException('Para envío faltan nombre y dirección con calle y número');
    const items = agruparItems(input.items ?? []);
    if (items.length > maxRenglonesBot() || items.reduce((n, i) => n + i.cantidad, 0) > maxUnidadesBot()) throw new BadRequestException('El pedido supera el máximo del canal WhatsApp; debe tomarlo el equipo');
    const cot = await this.cotizarPedido(items, telefono, { textoCliente });
    if (cot.hayFaltantes || cot.renglones.some(r => r.error || r.presentacion === 'requiere_verificacion') || !cot.sucursalId) throw new BadRequestException('No se puede confirmar: falta stock, precio o un dato de la presentación');
    // PEDIDO MÍNIMO PARA ENVÍO (Leandro, 25/9/2026): $70.000. El retiro no tiene mínimo.
    if (tipo === 'domicilio' && cot.total < envioMinimo()) {
      throw new BadRequestException(`El envío a domicilio es para pedidos desde $${pesos(envioMinimo())} y este suma $${pesos(cot.total)}. Decíselo al cliente con esos números y ofrecé sumar productos o retirarlo sin mínimo en la sucursal Saint Thomas. No lo prepares como envío.`);
    }
    const ident = await this.identificarCliente(telefono);
    // La fecha NO tumba el pedido (22/9/2026): el modelo no sabe qué día es y
    // llenaba entrega_fecha con una fecha pasada; preparar_pedido fallaba dos
    // veces y el pedido nunca se guardaba. Una fecha inválida o pasada se
    // ignora y queda avisado en el resultado; el pedido sigue.
    let fecha = String(input.entrega_fecha ?? '').trim();
    const hoyBA = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date());
    let avisoFecha: string | null = null;
    if (fecha && (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || Number.isNaN(Date.parse(fecha)) || new Date(fecha).toISOString().slice(0,10) !== fecha || fecha < hoyBA)) {
      this.log.warn(`preparar_pedido: fecha "${fecha}" inválida o pasada (hoy ${hoyBA}); se ignora y el pedido sigue`);
      avisoFecha = `La fecha "${fecha}" es inválida o pasada (hoy es ${hoyBA}): se guardó el pedido SIN fecha. Si el cliente pidió un día puntual, decíselo y pedí la fecha correcta.`;
      fecha = '';
    }
    const franja = ['mañana','tarde'].includes(input.entrega_franja) ? input.entrega_franja : null;
    // para retirar, si el cliente dijo a nombre de quién, queda "Retira: X" en
    // las notas (y no se le vuelve a preguntar al confirmar). Solo si el nombre
    // lo escribió el cliente: el modelo no lo completa con el de su perfil.
    const sinTildes = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const retira = tipo === 'pickup' && nombre && sinTildes((dichoPorElCliente ?? []).join(' ')).includes(sinTildes(nombre)) ? nombre : null;
    const notas = [String(input.notas ?? '').trim(), retira ? `Retira: ${retira}` : ''].filter(Boolean).join(' · ').slice(0, 300) || null;
    const resumen = [
      ...cot.renglones.map(r => `• ${r.nombre} — ${r.renglon}`),
      `Total: $${pesos(cot.total)}`,
      (cot as any).totalEfectivo ? `Pagando en efectivo o transferencia: $${pesos((cot as any).totalEfectivo)} (${porcentajeEfectivo()}% off en ${RUBROS_DESCUENTO_EFECTIVO}).` : null,
      tipo === 'domicilio' ? `Envío sin cargo a ${direccion}. Recibe ${nombre}.` : `Retiro en la sucursal Saint Thomas.${retira ? ` Retira ${retira}.` : ''}`,
      fecha || franja ? `${tipo === 'domicilio' ? 'Entrega' : 'Retiro'}: ${cuandoLegible(fecha, franja)}.` : null,
      input.notas ? `Indicaciones: ${String(input.notas).slice(0,300)}` : null,
      '¿Lo confirmo?',
    ].filter(Boolean).join('\n');
    const { data, error } = await this.db.from('bot_cotizaciones').insert({
      linea, telefono, cliente_id: ident.clienteId ?? null, sucursal_id: cot.sucursalId,
      items: cot.renglones, total: cot.total, tipo, direccion: tipo === 'domicilio' ? direccion : null,
      nombre, notas,
      entrega_fecha: fecha || null, entrega_franja: franja, resumen,
    }).select('id').single();
    if (error || !data?.id) {
      this.log.error(`preparar_pedido: no se pudo guardar la cotización de ${telefono}: ${error?.message ?? 'sin id'} · input=${JSON.stringify(input).slice(0, 300)}`);
      throw new BadRequestException('No se pudo guardar el resumen: no pidas confirmación todavía');
    }
    return { cotizacionId: data.id, resumen, total: cot.total, renglones: cot.renglones, ...(avisoFecha ? { avisoFecha } : {}) };
  }

  async crearPedido(dto: { telefono: string; linea?: string; confirmacion?: string; resumenPresentado?: string; items?: {sku:string;cantidad:number}[]; tipo?: string; modo?: 'si' | 'completo'; cotizacionId?: string }) {
    // Se conserva la firma antigua sólo para rechazar clientes desactualizados.
    if (dto.items && (dto.items.length > maxRenglonesBot() || dto.items.reduce((n,i)=>n+i.cantidad,0)>maxUnidadesBot())) throw new BadRequestException('El pedido supera el máximo del canal WhatsApp');
    // modo 'completo' (3/10/2026): el cliente cerró la lista ("solo eso") y la
    // cotización se acaba de guardar en este mismo turno. La frase la vuelve a
    // controlar la base (confirmar_cotizacion_bot con p_modo 'completo').
    const completo = dto.modo === 'completo';
    if (completo ? !dto.cotizacionId || !String(dto.confirmacion ?? '').trim() : !confirmacionInequivoca(dto.confirmacion ?? '')) throw new BadRequestException('NO se creó el pedido: falta confirmación inequívoca');
    const { data: q, error } = await this.db.from('bot_cotizaciones').select('*')
      .eq('telefono', dto.telefono).eq('linea', dto.linea ?? 'pedidos').order('creada_en', { ascending: false }).limit(1).maybeSingle();
    // EL BUCLE DEL "¿LO CONFIRMO?" (Catalina, 21/9/2026). Antes se exigía que el
    // último mensaje del bot fuera IDÉNTICO al resumen de preparar_pedido. Pero
    // entre el resumen y el "sí" el cliente contesta cosas ("efectivo", "recibe
    // Catalina") y el bot escribe un mensaje nuevo con el mismo total y otra vez
    // "¿Lo confirmo?". Ese mensaje ya no era el resumen: el "sí" se rechazaba,
    // el bot volvía a preguntar, y así tres veces. Ahora también vale que el
    // último mensaje del bot pregunte "¿Lo confirmo?" con el MISMO total de la
    // cotización vigente (misma plata, misma charla, cotización fresca).
    const ultimo = String(dto.resumenPresentado ?? '');
    const totalTxt = q ? `$${pesos(Number(q.total))}` : '';
    const fresca = !!q && !q.confirmada_en && Date.now() - new Date(q.creada_en).getTime() < 3 * 3600_000;
    const coincideResumen = !!q && !!ultimo && q.resumen === ultimo;
    const preguntaConMismoTotal = fresca && /¿lo confirmo\?/i.test(ultimo) && !!totalTxt && ultimo.includes(totalTxt);
    // la recién guardada, sin confirmar, de hace menos de 2 minutos
    const recienPreparada = !!q && q.id === dto.cotizacionId && !q.confirmada_en && Date.now() - new Date(q.creada_en).getTime() < 2 * 60_000;
    if (error || !q || !(completo ? recienPreparada : coincideResumen || preguntaConMismoTotal)) throw new BadRequestException('NO se creó el pedido: usá preparar_pedido para mostrar un resumen verificable y esperá confirmación');
    const { data: id, error: e } = await this.db.rpc('confirmar_cotizacion_bot', completo
      ? { p_id: q.id, p_telefono: dto.telefono, p_linea: dto.linea ?? 'pedidos', p_confirmacion: dto.confirmacion, p_modo: 'completo' }
      : { p_id: q.id, p_telefono: dto.telefono, p_linea: dto.linea ?? 'pedidos', p_confirmacion: dto.confirmacion });
    if (e || !id) throw new BadRequestException(e?.message ?? 'No se pudo confirmar el pedido');
    const ped: any = await this.pedidos.obtener(id);
    // si ya dijo cómo paga, se repite eso y no "efectivo o tarjeta" (25/9/2026)
    // con el descuento en efectivo o transferencia (30/9/2026), los dos totales
    const totalLista = Number(ped.total);
    const totalEfectivo = Math.round(((q.items ?? []) as any[]).reduce((s2: number, r: any) => s2 + Number(r?.subtotalEfectivo ?? r?.subtotal ?? 0), 0));
    const hayDescuento = totalEfectivo > 0 && totalEfectivo < Math.round(totalLista);
    const notas = String(q.notas ?? '');
    const paga = /efectivo/i.test(notas) ? 'efectivo' : /tarjeta|d[eé]bito|cr[eé]dito/i.test(notas) ? 'tarjeta' : null;
    const cobro = hayDescuento
      ? (paga === 'efectivo' ? `en efectivo: $${pesos(totalEfectivo)}` : paga === 'tarjeta' ? `con tarjeta: $${pesos(totalLista)}` : `$${pesos(totalLista)} con tarjeta o $${pesos(totalEfectivo)} en efectivo o transferencia`)
      : (paga === 'efectivo' ? 'en efectivo' : paga === 'tarjeta' ? 'con tarjeta' : 'en efectivo o tarjeta');
    // cuándo y dónde, en palabras ("el domingo 4/10 por la mañana"), y para un
    // retiro con picadas, a nombre de quién (se arman a pedido)
    const cuando = cuandoLegible(q.entrega_fecha, q.entrega_franja);
    const entrega = q.tipo === 'domicilio'
      ? `Envío sin cargo${q.direccion ? ` a ${q.direccion}` : ''}${cuando ? `, ${cuando}` : ''}. Se abona al recibir, ${cobro}.`
      : `Retiro en la sucursal Saint Thomas${cuando ? `, ${cuando}` : ''}. Se abona al retirar, ${cobro}.`;
    const preguntaNombre = nadaMasConfirma() && q.tipo !== 'domicilio' && !/\bRetira:/i.test(notas) && await this.seArmaAPedido(q.items);
    const respuesta = `Pedido ${ped.qr_retiro} confirmado. Total: $${pesos(totalLista)}.\n${entrega}${preguntaNombre ? `\n\n${PREGUNTA_NOMBRE_RETIRO}` : ''}`;
    return { pedidoId: id, codigoRetiro: ped.qr_retiro, total: Number(ped.total), estado: ped.estado, respuesta };
  }

  /**
   * Un pedido que el cliente confirmó y no se pudo cargar sale a administración
   * (avisos_pedidos, tipo pedido_sin_cargar: lo manda y lo vigila el mismo
   * circuito que los pedidos nuevos). Uno por chat cada 10 minutos.
   */
  private async encolarPedidoSinCargar(linea: string, telefono: string, nota: string, opciones: { salvoPedidoReciente?: boolean } = {}) {
    // el banco de pruebas y "Probar el bot" del panel no le escriben a administración
    // (el simulador usa 11 + 8 dígitos y nunca pasa por bot_entrantes: así no se
    // confunde con un chat real que tenga esa forma)
    if (/^54911000000\d{1,3}$/.test(telefono)) return;
    if (/^11\d{8}$/.test(telefono)) {
      const { data: real } = await this.db.from('bot_entrantes').select('waha_id').like('chat', `${telefono}@%`).limit(1);
      if (!(real ?? []).length) return;
    }
    try {
      if (opciones.salvoPedidoReciente) {
        // si la ÚLTIMA cotización del chat ya tiene pedido, hablaba de ese; si hay
        // una más nueva sin confirmar, es otro pedido y el aviso sale
        const { data: ultima } = await this.db.from('bot_cotizaciones').select('pedido_id, confirmada_en')
          .eq('telefono', telefono).eq('linea', linea).order('creada_en', { ascending: false }).limit(1).maybeSingle();
        const confirmada = (ultima as any)?.pedido_id && (ultima as any)?.confirmada_en ? new Date((ultima as any).confirmada_en).getTime() : 0;
        if (confirmada && Date.now() - confirmada < 6 * 3600_000) return;
      }
      const { data: prev } = await this.db.from('avisos_pedidos').select('id').eq('tipo', 'pedido_sin_cargar')
        .eq('detalle->>telefono', telefono).gte('creado_en', new Date(Date.now() - 10 * 60_000).toISOString()).limit(1).maybeSingle();
      if (prev) return;
      const { error } = await this.db.from('avisos_pedidos').insert({ tipo: 'pedido_sin_cargar', detalle: { linea, telefono, nota: nota.slice(0, 1000) } });
      if (error) {
        this.log.error(`no pude encolar el aviso de pedido sin cargar de ${telefono}: ${error.message}`);
        // que al menos quede la nota y la campanita
        await this.db.from('bot_notas_equipo').insert({ linea, telefono, nota: `PEDIDO SIN CARGAR (no salió el aviso a administración): ${nota.slice(0, 900)}` }).then(() => null, () => null);
        await this.db.from('alertas_internas').insert({ para_usuario: null, tipo: 'pedido_sin_aviso', titulo: `Pedido sin cargar de +${telefono}: no salió el aviso a administración`, detalle: nota.slice(0, 900), referencia: { linea, telefono } }).then(() => null, () => null);
      }
      else this.log.error(`pedido confirmado SIN cargar de ${telefono}: sale a administración`);
    } catch (e: any) {
      this.log.error(`no pude encolar el aviso de pedido sin cargar de ${telefono}: ${e?.message ?? e}`);
    }
  }

  /** ¿Hay en el pedido algo que se arma a pedido (las picadas)? */
  private async seArmaAPedido(items: unknown): Promise<boolean> {
    const lista = (Array.isArray(items) ? items : []) as any[];
    if (lista.some((r) => RE_ARMADO_A_PEDIDO.test(String(r?.nombre ?? '')))) return true;
    const ids = lista.map((r) => r?.producto_id).filter(Boolean);
    if (!ids.length) return false;
    const { data, error } = await this.db.from('productos').select('id').in('id', ids).eq('se_arma_a_pedido', true);
    return !error && (data ?? []).length > 0;
  }

  /**
   * "Retira: Juan Pérez" en las notas del pedido `codigo`, si lo confirmó el
   * bot en ESTE chat. false si no hay a qué pedido anotarlo.
   */
  private async anotarQuienRetira(telefono: string, linea: string, codigo: string, nombre: string): Promise<boolean> {
    const { data: ped } = await this.db.from('pedidos').select('id, notas, estado').eq('qr_retiro', codigo).maybeSingle();
    if (!ped || ['cancelado', 'entregado'].includes(String(ped.estado))) return false;
    // el pedido tiene que ser de este chat: lo confirmó una cotización de este teléfono
    const { data: q } = await this.db.from('bot_cotizaciones').select('id')
      .eq('telefono', telefono).eq('linea', linea).eq('pedido_id', ped.id).limit(1).maybeSingle();
    if (!q) return false;
    const previas = String(ped.notas ?? '').split(' · ').map((s) => s.trim()).filter((s) => s && !/^Retira:/i.test(s));
    const { error } = await this.db.from('pedidos').update({ notas: [...previas, `Retira: ${nombre}`].join(' · ').slice(0, 500) }).eq('id', ped.id);
    if (error) throw new Error(error.message);
    this.log.log(`pedido ${ped.id}: retira ${nombre} (${telefono})`);
    return true;
  }

  private async linkDelPedido(telefono: string, codigo: string) {
    if (!codigo.trim()) throw new BadRequestException('Hace falta el código del pedido confirmado');
    const ident = await this.identificarCliente(telefono);
    if (!ident.clienteId) throw new BadRequestException('No hay un pedido propio para cobrar');
    const { data: pedido, error } = await this.db.from('pedidos').select('id,total,estado,cliente_id,qr_retiro')
      .eq('cliente_id', ident.clienteId).eq('qr_retiro', codigo.trim()).maybeSingle();
    if (error || !pedido || !['recibido','en_preparacion','listo'].includes(pedido.estado)) throw new BadRequestException('No hay un pedido propio pendiente de pago con ese código');
    const enlace = await this.pedidos.crearPreferenciaMP(pedido.id);
    return { ...enlace, monto: Number(pedido.total), codigo: pedido.qr_retiro };
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
    extra: { monto?: number; tipo?: string; comprobanteUrl?: string; dichoPorElCliente?: string; deQuien?: string } = {},
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
    let nombre = ident?.nombre ?? (extra.deQuien ? String(extra.deQuien).trim() : null);

    // REGLA DEL DUEÑO (2026-09-01): a administración no le llega un teléfono
    // pelado con un monto — no sabe quién es ni de quién es la plata. Antes de
    // avisar, el bot CONSTRUYE la identidad: la lee del comprobante, la saca
    // del sistema si el cliente ya existe, o la pregunta. Sin identidad, no se
    // manda nada: se le pide el nombre al cliente y se deriva en el próximo turno.
    // Con un COMPROBANTE no se frena (23/9/2026, pedido del dueño: al cliente
    // "Recibido." y nada más): el archivo mismo dice quién transfirió y le llega
    // adjunto a administración, así que no es un teléfono pelado. Va con el
    // nombre de WhatsApp si no hay otro.
    const conArchivo = esComprobante && !!extra.comprobanteUrl;
    if (!nombre && conArchivo) nombre = extra.deQuien = `${await this.nombreDeContacto(telefono)} (ver comprobante adjunto)`;
    if (!nombre && !conArchivo && tipo !== 'quiere_pagar') {
      return {
        derivado: false,
        faltaIdentidad: true,
        aviso: 'NO avisaste a administración todavía y NO le digas al cliente que ya está avisado: falta saber DE PARTE DE QUIÉN es el pago. Si hay comprobante, leé el nombre o razón social del titular que transfirió y volvé a llamar derivar_pago con ese dato en de_quien. Si no hay comprobante ni nombre en la charla, preguntale en UNA línea ("¿A nombre de quién figura la transferencia?" o "¿De qué empresa me escribís?") y cuando lo diga, llamá derivar_pago de nuevo con de_quien.',
      };
    }

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
        `De: ${nombre ?? 'sin identificar'} · +${telefono}`,
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
        // el circuito queda abierto: cuando administración conteste "recibido"
        // en su chat, el bot le confirma al cliente y lo cierra
        if (avisado) {
          await this.db.from('bot_pagos_en_confirmacion').insert({
            linea, telefono_cliente: telefono, nombre, monto: monto || null,
            resumen: motivo.slice(0, 400),
            waha_msg_id: (env as any)?.id ? String((env as any).id) : null,
          }).then(() => null, () => null);
        }
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

  // Registra la pregunta, avisa al área y espera el dato sin promesas al cliente.
  async consultarInterno(linea: 'pedidos' | 'proveedores', telefono: string, area: string, consulta: string, direccion = '', archivoUrl?: string) {
    consulta = String(consulta).replace(/<[^>]*>/g, '').trim().slice(0,1000);
    direccion = /[<>]/.test(direccion) ? '' : direccion.slice(0,300);
    if (!consulta) throw new BadRequestException('Falta la consulta concreta');
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

    await this.db.from('bot_notas_equipo').insert({ linea, telefono, nota: `[${area}] ${consulta}${direccion ? ` · ${direccion}` : ''}` }).then(() => null, () => null);

    // Registrar antes del envío: la consulta no se pierde si WhatsApp falla.
    const esPrueba = /^54911000000\d{1,3}$/.test(telefono);
    const { data: pendiente, error } = await this.db.from('bot_consultas_internas').insert({
      linea, telefono_cliente: telefono, nombre, area, consulta: consulta.slice(0, 1000), gestion_version: 2,
      direccion: direccion || null,
      enviado_a: esPrueba ? 'banco-de-pruebas' : destino || null,
      ...(esPrueba ? { respondido_en: new Date().toISOString() } : {}),
    }).select('id').maybeSingle();
    // El aviso lleva el id de la consulta: así el recordatorio sabe que ya hay
    // uno y, cuando el área responde, se cierra solo (1/10/2026: la campanita
    // tenía 1.260 avisos de consulta sin leer, uno nuevo cada 6 h por consulta).
    if (!esPrueba) await this.db.from('alertas_internas').insert({
      para_usuario: cfg?.avisar_proveedores_a ?? null,
      tipo: 'consulta',
      titulo: `${etiqueta}: ${nombre ?? bonitoTelefono(telefono)}`,
      detalle: `${consulta}${direccion ? ` · dirección: ${direccion}` : ''}`,
      referencia: { linea, telefono, area, direccion: direccion || null, consulta_id: pendiente?.id ?? null },
    }).then(() => null, () => null);
    if (error || !pendiente?.id) throw new Error('No se pudo registrar la consulta interna');
    let enviada = false;
    if (destino.length >= 10 && !esPrueba) {
      const texto = [
        `Consulta de un cliente (${area})`,
        `De: ${nombre ?? 'sin identificar'} · +${telefono}`,
        consulta,
        direccion ? `Dirección: ${direccion}` : null,
        archivoUrl ? `Adjunto del cliente (acceso temporal): ${archivoUrl}` : null,
        'Respondé CITANDO este mensaje con el texto para el cliente, sin notas internas.',
      ].filter(Boolean).join('\n');
      try {
        const env: any = await this.enviarPorWhatsapp({ to: destino, text: texto, kind: 'aviso-interno' } as any);
        enviada = !!env?.enviado;
        if (pendiente?.id && env?.id) await this.db.from('bot_consultas_internas')
          .update({ waha_msg_id: String(env.id) }).eq('id', pendiente.id);
      } catch (e: any) {
        this.log.warn(`consulta registrada, aviso a ${area} falló: ${e?.message ?? e}`);
      }
    }
    return {
      consultado: true,
      area,
      avisoPorWhatsapp: enviada,
      aviso: 'Consulta registrada. NO envíes mensaje al cliente: ni acuse, ni lo consulto, ni vuelvo a vos. La respuesta se enviará cuando el área aporte el dato.',
    };
  }

  // ---- Derivación a una persona (mismo circuito que el CRM de Car Cash) ----
  // El bot deja de contestar esa conversación, queda marcada en la bandeja y el
  // equipo recibe el aviso por WhatsApp. Sin esto, "te derivo al equipo" era una
  // promesa que no llegaba a ningún lado.
  /** Nombre para mostrar: agenda › WhatsApp › teléfono real › lo que haya (nunca el @lid crudo). */
  private async nombreDeContacto(telefono: string): Promise<string> {
    const { data: k } = await this.db.from('bot_contactos').select('nombre, nombre_wa, telefono_real').eq('telefono', String(telefono).replace(/\D/g, '')).maybeSingle();
    return String((k as any)?.nombre ?? (k as any)?.nombre_wa ?? '').trim()
      || ((k as any)?.telefono_real ? bonitoTelefono((k as any).telefono_real) : bonitoTelefono(telefono));
  }

  async derivarAHumano(linea: 'pedidos' | 'proveedores', telefono: string, motivo: string, urgente = false) {
    // la derivación entra al vigilante de esperas (23/9/2026): antes quedaba en
    // una alerta que nadie leía (147 sin leer) y el cliente esperaba días. El
    // texto del aviso es genérico: el motivo puede traer el detalle de un pedido
    // y eso no sale por WhatsApp (regla del 1/9).
    const { data: previa } = await this.db.from('bot_conversaciones').select('esperando_desde').eq('linea', linea).eq('telefono', telefono).maybeSingle();
    const marca = {
      esperando_desde: (previa as any)?.esperando_desde ?? new Date().toISOString(),
      esperando_texto: urgente ? '🔔 Urgente: pidió que lo atienda una persona' : '🔔 Pidió que lo atienda una persona',
      bot_activo: false,
      derivada_en: new Date().toISOString(),
      derivada_motivo: motivo || 'El cliente pidió hablar con una persona',
      resuelta_en: null,
      acuse_derivacion_en: null,
      // sin vencimiento: se reactiva a mano desde RESPONDE (regla del 16/9)
      derivacion_vence_en: null,
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
      titulo: `${urgente ? '🔴' : '🟡'} Conversación derivada: ${await this.nombreDeContacto(telefono)}`,
      detalle: `${motivo || 'El cliente pidió hablar con una persona'} · Contestarle desde RESPONDE.`,
      referencia: { linea, telefono, urgente },
    }).then(() => null, () => null);

    await this.respondePausar(telefono);
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
  // RESPONDE es el interruptor de cada charla. Cuando se pregunta el estado, ODB
  // se alinea: si allá la reactivaron a mano, acá el bot retoma; si allá la
  // pausaron, acá queda pausada. Si RESPONDE no contesta, no se toca nada.
  async respondeModoHumano(whatsappId: string): Promise<boolean> {
    const r = await this.respondeRpc('odb_estado_contacto', { p_whatsapp_id: whatsappId });
    const humano = r?.modo_humano === true || r?.bloqueado === true;
    if (r && r.existe === true) await this.sincronizarPausa(whatsappId, humano).catch(() => null);
    return humano;
  }

  private async sincronizarPausa(whatsappId: string, humano: boolean) {
    const telefono = String(whatsappId).split('@')[0].replace(/\D/g, '');
    if (!telefono) return;
    const { data: conv } = await this.db.from('bot_conversaciones').select('bot_activo, derivada_motivo').eq('linea', 'pedidos').eq('telefono', telefono).maybeSingle();
    if (!conv) return;
    const ahora = new Date().toISOString();
    if (!humano && conv.bot_activo === false) {
      await this.db.from('bot_conversaciones').update({
        bot_activo: true, resuelta_en: ahora, derivacion_vence_en: null, atendida_por: null,
        derivada_motivo: `${conv.derivada_motivo ?? ''} · reactivada desde RESPONDE`.replace(/^ · /, ''),
      }).eq('linea', 'pedidos').eq('telefono', telefono);
      this.log.log(`charla ${telefono} reactivada desde RESPONDE: el bot retoma`);
      await this.limpiarEspera('pedidos', telefono);
    } else if (humano && conv.bot_activo !== false) {
      await this.db.from('bot_conversaciones').update({
        bot_activo: false, derivada_en: ahora, derivada_motivo: 'Pausado desde RESPONDE', derivacion_vence_en: null, resuelta_en: null,
      }).eq('linea', 'pedidos').eq('telefono', telefono);
    }
  }

  // Pone la charla en "atendés vos" en RESPONDE (la crea si no existe). Se usa
  // en cada pausa que nace en ODB, para que la app muestre el estado real y la
  // reactivación sea desde ahí.
  async respondePausar(telefonoOWaId: string, nombre?: string | null) {
    const ident = await this.identidadResponde(telefonoOWaId, nombre);
    const waId = ident.waId;
    if (/^54911000000\d{1,3}$/.test(waId)) return; // banco de pruebas
    const r = await this.respondeRpc('odb_pausar_contacto', { p_whatsapp_id: waId, p_nombre: ident.nombre || null });
    if (!r) this.log.warn(`no pude pausar ${waId} en RESPONDE: la app va a mostrar el bot activo`);
  }

  // Deja el turno escrito en RESPONDE (best-effort: si falla, el bot igual atendió)
  // CHARLA PAUSADA: el cliente escribió y el bot se calla (la atiende una
  // persona). La pausa se respeta SIEMPRE —regla del dueño— pero el mensaje no
  // se pierde: queda en el historial del bot (para que tenga contexto cuando lo
  // reactiven) y la charla queda marcada como esperando respuesta. Si nadie
  // contesta, el cron avisaEsperandoRespuesta() le escribe a administración.
  // 19/9/2026: un pedido de un cliente estuvo 4 horas sin que nadie lo viera.
  private async anotarEsperaEnPausa(linea: 'pedidos' | 'proveedores', telefono: string, texto: string) {
    const limpio = String(texto ?? '').trim();
    if (!limpio || /^54911000000\d{1,3}$/.test(telefono)) return;
    try {
      const { data: conv } = await this.db.from('bot_conversaciones')
        .select('mensajes, esperando_desde').eq('linea', linea).eq('telefono', telefono).maybeSingle();
      const hist: any[] = Array.isArray((conv as any)?.mensajes) ? (conv as any).mensajes : [];
      const ahora = new Date().toISOString();
      await this.db.from('bot_conversaciones').upsert({
        linea, telefono,
        mensajes: [...hist, { role: 'user', content: limpio }].slice(-40),
        actualizado_en: ahora,
        bot_activo: false,
        esperando_desde: (conv as any)?.esperando_desde ?? ahora,
        esperando_texto: limpio.slice(0, 300),
      }, { onConflict: 'linea,telefono' });
    } catch (e: any) {
      this.log.warn(`no pude anotar la espera de ${telefono}: ${e?.message ?? e}`);
    }
  }

  /** Alguien de la casa atendió (o el bot volvió): la charla deja de esperar. */
  private async limpiarEspera(linea: 'pedidos' | 'proveedores', telefono: string) {
    await this.db.from('bot_conversaciones')
      .update({ esperando_desde: null, esperando_texto: null, esperando_aviso_en: null, esperando_avisos: 0 })
      .eq('linea', linea).eq('telefono', telefono).then(() => null, () => null);
  }

  // Identidad ÚNICA de una charla en RESPONDE (18/9/2026). El panel mostraba
  // "+110634079383788@lid" sin nombre —imposible de encontrar— y una respuesta
  // mandada al número real abría un contacto NUEVO para la misma persona. Acá se
  // resuelve siempre al mismo id (el @lid si el contacto lo tiene) y se completa
  // el nombre de la agenda, que el sistema ya conoce.
  private async identidadResponde(destino: string, nombre?: string | null) {
    const t = String(destino ?? '');
    const digitos = t.replace(/\D/g, '');
    // sin contacto en la base vale la forma del id: 14 dígitos o más no es un
    // teléfono argentino, es un @lid
    let waId = t.includes('@') ? t : (digitos.length >= 14 ? `${digitos}@lid` : digitos);
    let nombreFinal = (nombre ?? '').trim();
    if (!digitos) return { waId, nombre: nombreFinal };
    try {
      const { data } = await this.db
        .from('bot_contactos').select('telefono, telefono_real, lid, nombre, nombre_wa')
        .or(`telefono.eq.${digitos},telefono_real.eq.${digitos}`).limit(1).maybeSingle();
      const c: any = data;
      if (c) {
        const lid = String(c.lid ?? '');
        if (lid) waId = lid;
        else if (!t.includes('@')) waId = String(c.telefono ?? digitos);
        // el contacto existe y NO tiene @lid: es un teléfono común
        if (!nombreFinal) nombreFinal = String(c.nombre ?? c.nombre_wa ?? '').trim() || (c.telefono_real ? `+${c.telefono_real}` : '');
      }
    } catch { /* si la consulta falla, se registra igual con lo que vino */ }
    return { waId, nombre: nombreFinal };
  }

  async respondeRegistrar(
    whatsappId: string, nombre: string | null, textoCliente: string, textoBot: string | null, waMessageId?: string,
    media?: { tipo: 'image' | 'audio' | 'video' | 'document'; url: string } | null,
    salida?: { waMessageId?: string; humano?: boolean },
  ) {
    // las charlas del banco de pruebas (54911000000xx) no van al panel: son
    // ensayos del sistema y confundían a quien atiende (22/9/2026)
    if (/^54911000000\d{1,3}(@|$)/.test(String(whatsappId))) return;
    // con tipo + url, la app de RESPONDE dibuja la miniatura / el reproductor,
    // igual que hace con los archivos de Car Cash
    const ident = await this.identidadResponde(whatsappId, nombre);
    await this.respondeRpc('odb_registrar_turno', {
      p_whatsapp_id: ident.waId, p_nombre: ident.nombre, p_texto_cliente: textoCliente,
      p_texto_bot: textoBot ?? '', p_wa_message_id: waMessageId ?? null,
      p_media_tipo: media?.tipo ?? null, p_media_url: media?.url ?? null,
      // lo que sale: su id (para no duplicarlo) y si lo escribió una persona
      ...(salida ? { p_bot_wa_message_id: salida.waMessageId ?? null, p_bot_humano: !!salida.humano } : {}),
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
      // Whisper "alucina" con audios mudos o con ruido: devuelve créditos de
      // subtítulos de YouTube. Eso no lo dijo el cliente (Rachel, 23/9/2026).
      if (texto && esAlucinacionDeTranscripcion(texto)) { this.log.warn(`transcripción descartada (alucinación): "${texto.slice(0, 80)}"`); return null; }
      return texto || null;
    } catch (e: any) {
      this.log.warn(`transcripción falló: ${e?.message ?? e}`);
      return null;
    }
  }

  // Baja el archivo que mandó el cliente desde WAHA (foto, audio, documento).
  // WAHA lo publica en payload.media.url; hay que pedirlo con la API key.
  // Administración contesta en SU chat el aviso de pago; el bot escucha esa
  // respuesta y se la lleva al cliente: "recibimos tu pago, muchas gracias".
  // Si contesta citando el aviso, se matchea ese pago puntual; si no, el
  // único pendiente inequívoco. Devuelve null si el mensaje no es de
  // administración: sigue el camino normal.
  private async respuestaDeAdministracion(identidad: string, p: any) {
    const { data: cfg } = await this.db.from('lineas_whatsapp')
      .select('bot_activo, derivar_pagos_a, whatsapp_reparto, whatsapp_compras').eq('linea', 'pedidos').eq('activa', true).limit(1).maybeSingle();
    const destinos = [cfg?.derivar_pagos_a, cfg?.whatsapp_reparto, cfg?.whatsapp_compras].map(v => soloDigitos(String(v ?? ''))).filter(Boolean);
    let quien = soloDigitos(identidad);
    if (String(identidad).includes('@lid')) {
      const { data } = await this.db.from('bot_contactos').select('telefono_real').eq('telefono', quien).maybeSingle();
      quien = soloDigitos(String(data?.telefono_real ?? ''));
    }
    const admin = destinos.find(t => t === quien);
    if (!admin) return null;
    const esAdministracion = admin === soloDigitos(String(cfg?.derivar_pagos_a ?? ''));
    const texto = String(p.body ?? '').trim();
    if (!texto) return { contestado: false, motivo: 'equipo: sin texto' };
    const citado = idWhatsappCorto(typeof p.replyTo === 'object' ? p.replyTo?.id : p.replyTo);
    // Los avisos de PEDIDOS (3/10/2026) también llegan a este chat. Una respuesta
    // que cita uno (cualquier página de la tarjeta, de cualquier día) es un acuse:
    // no se lleva a ningún cliente. Sin cita, con avisos de pedidos del día, un
    // "ok" puede ser para el pedido: cuenta como un pendiente más (con más de
    // uno, se pide citar), así nunca le llega a un cliente lo que era para el pedido.
    let avisosDelDia = 0;
    if (esAdministracion) {
      if (citado) {
        const { data: envio } = await this.db.from('bot_envios').select('waha_id')
          .in('origen', ['aviso-pedido', 'aviso-pedido-escalado']).ilike('waha_id', `%${citado}`).limit(1);
        if ((envio ?? []).length) {
          // un acuse ("ok", 👍) no se contesta; algo más largo puede ser para el
          // cliente ("ya lo cargué, avisale"): se le aclara que así no le llega
          if (!esAcuse(String(p.body ?? ''))) {
            await this.enviarPorWhatsapp({ to: admin, text: 'Eso no le llega al cliente: responder un aviso de PEDIDO no se lo manda a nadie. Para escribirle, hacelo desde RESPONDE.', kind: 'aviso-interno' }).catch(() => null);
          }
          return { contestado: false, motivo: 'acuse de un aviso de pedido' };
        }
      }
      // solo un acuse corto ("ok", 👍) puede ser para un pedido: una respuesta con
      // contenido sigue yendo a su consulta o pago como siempre
      if (esAcuse(texto)) {
        const { count, error: eAvisos } = await this.db.from('avisos_pedidos').select('id', { count: 'exact', head: true })
          .in('estado', ['enviado', 'entregado']).gte('enviado_en', new Date(Date.now() - 24 * 3600_000).toISOString());
        // si no se puede saber, se supone que hubo: mejor pedir que cite que llevarle a un cliente algo que no era para él
        avisosDelDia = eAvisos ? 1 : Number(count ?? 0);
      }
    }
    // Sin ventana de 24h ni límite global: una cita vieja sigue identificando su consulta.
    const consultasTodas = await this.pendientesPaginados('bot_consultas_internas', 'respondido_en');
    const consultas = consultasTodas.filter(c => soloDigitos(String(c.enviado_a ?? '')) === admin || (!c.enviado_a && esAdministracion));
    const lista = esAdministracion ? await this.pendientesPaginados('bot_pagos_en_confirmacion', 'confirmado_en') : [];
    const consultaCitada = citado ? consultas.find(c => idWhatsappCorto(c.waha_msg_id) === citado) : null;
    const pagoCitado = citado ? lista.find(c => idWhatsappCorto(c.waha_msg_id) === citado) : null;
    const pedirReferencia = async () => {
      // con avisos de pedidos del día, el "ok" puede haber sido para un pedido: que no haga falta contestar
      const pedido = avisosDelDia ? 'Si es por un PEDIDO, no hace falta responder. Si es por un pago o una consulta, respondé CITANDO ese aviso.' : 'Respondé CITANDO el aviso exacto de la consulta o del pago. No pude identificar una única referencia.';
      await this.enviarPorWhatsapp({ to: admin, text: pedido, kind: 'aviso-interno' }).catch(() => null);
      return { contestado: false, motivo: 'falta referencia inequívoca' };
    };
    if (citado) {
      if (consultaCitada && !pagoCitado) return this.llevarRespuestaDeConsulta(consultaCitada, texto, admin, cfg?.bot_activo !== false);
      if (!pagoCitado || consultaCitada) return pedirReferencia();
    } else {
      if (consultas.length + lista.length + (avisosDelDia ? 1 : 0) > 1) return pedirReferencia();
      if (consultas.length === 1) return this.llevarRespuestaDeConsulta(consultas[0], texto, admin, cfg?.bot_activo !== false);
      if (!lista.length) return { contestado: false, motivo: 'sin consultas o pagos pendientes' };
    }
    const fila = pagoCitado ?? lista[0];
    const montoTexto = fila.monto ? ` de $${Number(fila.monto).toLocaleString('es-AR', { maximumFractionDigits: 2 })}` : '';
    const destinoCliente = String(fila.telefono_cliente).length >= 14 ? `${fila.telefono_cliente}@lid` : String(fila.telefono_cliente);

    const NO = /\bno\s+(lleg[oó]|figura|est[aá]|aparece|entr[oó]|acredit[oó]|lo veo|la veo|lo encuentro|la encuentro)\b/i;
    const SI = /\b(recibido|recib[ií]|ok|okey|oka|confirmado|confirmo|lleg[oó]|acreditad[oa]|est[aá] bien|correcto|perfecto|listo|dale|s[ií])\b/i;

    const avisarCliente = async (msj: string) => {
      if (cfg?.bot_activo === false) return false;
      const { data: estado } = await this.db.from('bot_conversaciones').select('bot_activo').eq('linea', fila.linea).eq('telefono', String(fila.telefono_cliente)).maybeSingle();
      if (estado?.bot_activo === false) return false;
      const { data: claim, error } = await this.db.rpc('tomar_aviso_pago_bot', { p_id: fila.id });
      if (error || !(Array.isArray(claim) ? claim.length : claim)) return false;
      const env: any = await this.enviarPorWhatsapp({ to: destinoCliente, text: msj, referencia: `pago-confirmado/${fila.id}` }).catch(() => ({ enviado: false }));
      if (!env?.enviado) {
        await this.db.from('bot_pagos_en_confirmacion').update({ ultimo_error: 'Entrega no confirmada; revisar antes de repetir', ...(env?.reintentable === true ? { envio_iniciado_en: null } : {}) }).eq('id',fila.id);
        return false;
      }
      const { data: conv } = await this.db.from('bot_conversaciones').select('mensajes').eq('linea', fila.linea).eq('telefono', String(fila.telefono_cliente)).maybeSingle();
      const hist: any[] = Array.isArray(conv?.mensajes) ? conv!.mensajes : [];
      await this.db.from('bot_conversaciones').upsert({
        linea: fila.linea, telefono: String(fila.telefono_cliente),
        mensajes: [...hist, { role: 'assistant', content: msj }].slice(-MAX_HISTORIAL),
        actualizado_en: new Date().toISOString(),
      }, { onConflict: 'linea,telefono' }).then(() => null, () => null);
      this.respondeRegistrar(destinoCliente.includes('@') ? destinoCliente : String(fila.telefono_cliente), fila.nombre ?? null, '', msj).catch(() => null);
      return !!(env as any)?.enviado;
    };

    if (NO.test(texto)) {
      await this.db.from('bot_pagos_en_confirmacion').update({ respuesta_admin: texto.slice(0, 300) }).eq('id', fila.id).then(() => null, () => null);
      const ok = await avisarCliente(`Estuvimos revisando tu transferencia${montoTexto} y todavía no la encontramos acreditada. ¿Me reenviás el comprobante así lo chequean de nuevo?`);
      await this.enviarPorWhatsapp({ to: admin, text: ok ? `Listo, le avisé a ${fila.nombre ?? '+' + fila.telefono_cliente} que todavía no figura y le pedí el comprobante de nuevo.` : `Respuesta guardada; la entrega al cliente sigue pendiente. Revisá el estado del bot y del envío.`, kind: 'aviso-interno' } as any).catch(() => null);
      this.log.log(`administración respondió "no figura" para ${fila.telefono_cliente}: relayado=${ok}`);
      if (ok) await this.db.from('bot_pagos_en_confirmacion').update({ confirmado_en: new Date().toISOString(), ultimo_error: null }).eq('id', fila.id);
      return { contestado: ok, motivo: ok ? 'administración: no figura, cliente avisado' : 'respuesta guardada, envío pendiente' };
    }
    if (!SI.test(texto)) {
      await this.db.from('bot_pagos_en_confirmacion').update({ respuesta_admin: texto.slice(0, 300) }).eq('id', fila.id).then(() => null, () => null);
      return { contestado: false, motivo: 'administración: respuesta no concluyente, quedó registrada' };
    }

    await this.db.from('bot_pagos_en_confirmacion').update({ respuesta_admin: texto.slice(0, 300) }).eq('id', fila.id).then(() => null, () => null);
    const ok = await avisarCliente(`Te confirmamos que recibimos tu pago${montoTexto}. Muchas gracias.`);
    await this.enviarPorWhatsapp({ to: admin, text: ok ? `Listo: le confirmé a ${fila.nombre ?? '+' + fila.telefono_cliente} que su pago${montoTexto} quedó recibido.` : `Confirmación guardada; la entrega al cliente sigue pendiente. Revisá el estado del bot y del envío.`, kind: 'aviso-interno' } as any).catch(() => null);
    if (ok) await this.db.from('bot_pagos_en_confirmacion').update({ confirmado_en: new Date().toISOString() }).eq('id', fila.id);
    this.log.log(`pago${montoTexto} de ${fila.telefono_cliente} confirmado por administración: cliente avisado=${ok}`);
    return { contestado: ok, motivo: ok ? 'pago confirmado por administración, cliente avisado' : 'pago confirmado por administración, envío pendiente' };
  }

  // Consultas y pagos se resuelven por referencia, nunca por proximidad temporal.
  private async pendientesPaginados(tabla: 'bot_consultas_internas' | 'bot_pagos_en_confirmacion', cierre: string): Promise<any[]> {
    const todos: any[] = [];
    for (let desde = 0; ; desde += 500) {
      const { data, error } = await this.db.from(tabla).select('*').is(cierre, null).order('creado_en', { ascending: false }).range(desde, desde + 499);
      if (error) throw new Error('No se pudieron consultar las referencias pendientes');
      todos.push(...(data ?? []));
      if (!data || data.length < 500) return todos;
    }
  }

  private async llevarRespuestaDeConsulta(c: any, respuesta: string, admin: string, botActivo: boolean) {
    const texto = String(respuesta ?? '').trim();
    const { error: eRespuesta } = await this.db.from('bot_consultas_internas').update({ respuesta_admin: texto.slice(0,1000) }).eq('id', c.id);
    if (eRespuesta) throw new Error('No se pudo guardar la respuesta del equipo');
    const { data: conv } = await this.db.from('bot_conversaciones').select('bot_activo,mensajes').eq('linea', c.linea).eq('telefono', c.telefono_cliente).maybeSingle();
    if (!botActivo || conv?.bot_activo === false) {
      return { contestado: false, motivo: 'respuesta guardada; bot apagado o atiende una persona' };
    }
    // La respuesta del área es el dato autorizado, no una nueva orden al agente.
    // No llamar a charla: eso podía abrir otra consulta o ejecutar otras herramientas.
    if (!texto || texto.length > 1000 || /nota interna|no le digas|decile al bot|instrucciones para/i.test(texto)) {
      await this.enviarPorWhatsapp({ to: admin, text: 'Escribí la respuesta dirigida al cliente, sin instrucciones internas y en pocas líneas.', kind: 'aviso-interno' }).catch(() => null);
      return { contestado: false, motivo: 'requiere texto para el cliente' };
    }
    const { data: tomadas, error: eClaim } = await this.db.rpc('tomar_entrega_consulta_bot', { p_id: c.id });
    if (eClaim) throw new Error('No se pudo reservar la entrega de la consulta');
    const tomada = Array.isArray(tomadas) ? tomadas[0] : tomadas;
    if (!tomada) return { contestado: false, motivo: 'consulta ya entregada o en proceso' };
    if (tomada.envio_iniciado_en) return { contestado: false, motivo: 'envío anterior incierto: revisar antes de repetir' };
    const destino = String(c.telefono_cliente).length >= 14 ? `${c.telefono_cliente}@lid` : String(c.telefono_cliente);
    const mensaje = envioSinCargo(texto); // aplica la política comercial también al texto que se registra
    const { error: eInicio } = await this.db.from('bot_consultas_internas').update({ mensaje_cliente: mensaje, envio_iniciado_en: new Date().toISOString() }).eq('id', c.id);
    if (eInicio) throw new Error('No se pudo registrar el intento de envío');
    let env: any;
    try { env = await this.enviarPorWhatsapp({ to: destino, text: mensaje, referencia: `consulta/${c.id}` }); }
    catch { env = { enviado: false, motivo: 'resultado de transporte incierto' }; }
    const ok = env?.enviado === true;
    if (!ok) {
      const conocido = env?.reintentable === true;
      await this.db.from('bot_consultas_internas').update({
        ultimo_error: conocido ? 'No enviado; reintento programado' : 'Envío incierto; revisar antes de repetir',
        ...(conocido ? { envio_iniciado_en: null } : {}),
        bloqueada_hasta: null,
        proximo_intento_en: conocido ? new Date(Date.now()+5*60_000).toISOString() : null,
      }).eq('id', c.id);
      return { contestado: false, motivo: conocido ? 'envío pendiente' : 'envío incierto; requiere revisión' };
    }
    const { error: eCierre } = await this.db.from('bot_consultas_internas').update({
      respondido_en: new Date().toISOString(), ultimo_error: null, bloqueada_hasta: null, proximo_intento_en: null,
    }).eq('id', c.id);
    if (eCierre) throw new Error('Mensaje enviado; falta registrar el cierre. No repetir automáticamente');
    // Respondida: sus avisos salen de la campanita sin que nadie toque "Listo".
    // El mensaje ya salió: nada de acá puede cortar el cierre.
    try {
      await this.db.from('alertas_internas').update({ leida_en: new Date().toISOString() })
        .eq('tipo', 'consulta').filter('referencia->>consulta_id', 'eq', c.id).is('leida_en', null);
    } catch { /* la campanita no frena la entrega */ }
    const hist = Array.isArray(conv?.mensajes) ? conv.mensajes : [];
    await this.db.from('bot_conversaciones').upsert({ linea: c.linea, telefono: c.telefono_cliente,
      mensajes: [...hist, { role: 'assistant', content: mensaje }].slice(-MAX_HISTORIAL), actualizado_en: new Date().toISOString(),
    }, { onConflict: 'linea,telefono' });
    await this.respondeRegistrar(destino, c.nombre ?? null, '', mensaje).catch(() => null);
    return { contestado: true, motivo: 'respuesta del equipo enviada al cliente' };
  }

  // Sólo pendientes creados con el circuito nuevo. No vuelve a enviar el backlog
  // histórico: pudo haberse atendido manualmente y requiere conciliación.
  @Cron('10 */5 * * * *')
  async seguirConsultasPendientes() {
    const { data: cfg } = await this.db.from('lineas_whatsapp').select('bot_activo,derivar_pagos_a').eq('linea','pedidos').eq('activa',true).maybeSingle();
    if (!cfg?.bot_activo) return;
    const todos = await this.pendientesPaginados('bot_consultas_internas','respondido_en');
    const porEntregar = (x: any) => x.respuesta_admin && !x.envio_iniciado_en && Number(x.intentos ?? 0) < 3;
    // Solo las que tienen algo por hacer: con 50 consultas viejas sin cerrar, el
    // slice dejaba afuera a las nuevas (sin recordatorio ni reintento de entrega).
    for (const c of todos.filter(x => x.gestion_version === 2 && x.enviado_a !== 'banco-de-pruebas' && (porEntregar(x) || !x.aviso_recordatorio_en)).reverse().slice(0,50)) {
      if (porEntregar(c) && (!c.proximo_intento_en || Date.parse(c.proximo_intento_en) <= Date.now())) {
        const entrega = await this.llevarRespuestaDeConsulta(c,c.respuesta_admin,c.enviado_a ?? cfg.derivar_pagos_a,true).catch(e=>{ this.log.warn(e.message); return null; });
        if (entrega?.contestado) continue;
      }
      // Un solo recordatorio por consulta, a los 20 min: después queda en la
      // campanita hasta que la respondan o alguien toque "Listo". Antes salía uno
      // nuevo cada 6 h para siempre (hasta 39 por consulta) y tapaba todo lo demás.
      // Se toma con un update condicional: si corren dos procesos, avisa uno.
      if (c.aviso_recordatorio_en || Date.now()-Date.parse(c.creado_en)<20*60_000) continue;
      const { data: tomada } = await this.db.from('bot_consultas_internas').update({aviso_recordatorio_en:new Date().toISOString()}).eq('id',c.id).is('aviso_recordatorio_en',null).select('id');
      if (!tomada?.length) continue;
      const { error } = await this.db.from('alertas_internas').insert({ tipo:'consulta', titulo:'Consulta pendiente de atención', detalle:String(c.consulta).slice(0,500), referencia:{consulta_id:c.id,telefono:c.telefono_cliente,area:c.area,recordatorio:true} });
      if (error) await this.db.from('bot_consultas_internas').update({aviso_recordatorio_en:null}).eq('id',c.id);
    }
  }

  private async guardarAdjuntoPrivado(ruta: string, media: { base64: string; mime: string }): Promise<string> {
    const bucket = this.db.storage.from('bot-adjuntos');
    const { error } = await bucket.upload(ruta, Buffer.from(media.base64, 'base64'), { contentType: media.mime, upsert: false });
    if (error) { this.log.warn('No se pudo archivar el adjunto privado'); return ''; }
    const { data, error: firma } = await bucket.createSignedUrl(ruta, 3600);
    if (firma) return '';
    return data?.signedUrl ?? '';
  }

  // Acceso del staff autenticado: renueva únicamente rutas del archivo privado.
  async renovarAdjunto(ruta: string) {
    // los contactos nuevos de WhatsApp se guardan como "123…@lid": sin esto el panel
    // no podía renovar sus fotos y audios (Blanquita, 1/10/2026)
    if (!/^whatsapp\/[0-9]+(?:@lid)?\/(?:enviado-)?[0-9]+(?:\.[a-z0-9]{2,4})?$/.test(String(ruta ?? ''))) {
      throw new BadRequestException('Ruta de adjunto inválida');
    }
    const { data, error } = await this.db.storage.from('bot-adjuntos').createSignedUrl(ruta, 3600);
    if (error || !data?.signedUrl) throw new BadRequestException('Adjunto no disponible');
    return { url: data.signedUrl, venceEnSegundos: 3600 };
  }

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
      // ¿Está entero? (ver ogg.ts). Hasta el 2/10/2026 se exigía la marca de
      // fin del OGG, que las notas de WhatsApp NO traen: cada audio esperaba 7 s
      // de reintentos y el log decía "puede estar cortado" aunque estaba entero
      // (231 de 231 medidos). Ahora: mismo tamaño que declaró WhatsApp, o marca
      // de fin, o páginas enteras hasta el último byte y tamaño estable entre
      // dos bajadas. Solo si nada de eso se cumple se reintenta.
      const declarado = audioDeclarado(p);
      const entero = (b: Buffer, anterior: number | null) => {
        if (declarado.bytes && b.length === declarado.bytes) return true;
        const e = estadoOgg(b);
        return e.eos || (e.paginasEnteras && anterior === b.length);
      };
      let anterior: number | null = null;
      let completo = false;
      for (let intento = 1; intento <= 5; intento++) {
        let intentoBuf: Buffer;
        try {
          const r = await fetch(String(url), { headers: { 'X-Api-Key': process.env.WAHA_API_KEY ?? '' }, signal: AbortSignal.timeout(12000) });
          if (!r.ok) {
            if (buf) break; // ya tenemos una versión: se usa esa
            this.log.warn(`no pude bajar el archivo de WAHA (${r.status}): ${String(url).slice(0, 120)}`);
            return null;
          }
          intentoBuf = Buffer.from(await r.arrayBuffer());
        } catch (e) {
          if (buf) break; // un reintento que falla no tira la versión que ya se bajó
          throw e;
        }
        if (!buf || intentoBuf.length >= buf.length) buf = intentoBuf;
        if (!esAudioOgg || entero(intentoBuf, anterior)) { completo = true; break; }
        anterior = intentoBuf.length;
        if (intento === 5) break; // no se espera después del último intento
        // con páginas enteras alcanza una segunda bajada para ver que no creció
        if (!estadoOgg(intentoBuf).paginasEnteras) this.log.warn(`audio todavía a medio escribir en WAHA (${intentoBuf.length} bytes, intento ${intento}): espero y reintento`);
        await new Promise((res) => setTimeout(res, 1500));
      }
      if (!buf) return null;
      if (esAudioOgg) {
        const e = estadoOgg(buf);
        const dur = e.segundos != null ? `${e.segundos.toFixed(1)} s` : '?';
        const dijo = declarado.segundos != null ? ` (WhatsApp dice ${declarado.segundos} s)` : '';
        if (completo) this.log.log(`audio entero: ${buf.length} bytes · ${dur}${dijo}`);
        else this.log.warn(`audio posiblemente cortado tras los reintentos: ${buf.length} bytes${declarado.bytes ? ` de ${declarado.bytes} declarados` : ''} · ${dur}${dijo}`);
      }
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
  // WhatsApp devuelve también lo que sale de este número ("fromMe", con el
  // evento message.any). Si lo mandó el sistema (está en bot_envios) se ignora.
  // Si no, lo tecleó una PERSONA desde el teléfono: el bot se pausa 6 h en esa
  // charla para no pisarla y lo escrito queda en el hilo. Vence solo: si nadie
  // sigue, el bot vuelve con una nota interna.
  private async mensajePropio(p: any, numeroLinea?: string) {
    // Al re-vincular, WhatsApp sincroniza el historial y reenvía mensajes VIEJOS
    // como si salieran ahora: respuestas del bot anteriores al registro de
    // envíos parecerían "una persona tecleando" y pausarían charlas en masa
    // (pasó el 2026-09-08 al volver a vincular). Solo cuenta lo de los últimos
    // 2 minutos, y nunca el chat con uno mismo.
    const ts = Number(p?.timestamp ?? p?._data?.messageTimestamp ?? 0);
    if (ts > 0 && Date.now() / 1000 - ts > 120) return { ignorado: 'fromMe histórico (sincronización)' };
    const id = String(p?.id ?? p?.key?.id ?? p?._data?.key?.id ?? '').trim();
    if (id) {
      // WAHA a veces devuelve el id corto al mandar ("3EB0…") y el eco llega con
      // el largo ("true_549…@c.us_3EB0…"): se buscan las dos formas. Sin esto,
      // cada aviso interno (recuperar clave, devoluciones, reportes) parecía una
      // persona escribiendo y pausaba la charla (16/9/2026).
      const corto = id.includes('_') ? id.split('_').pop()! : id;
      const buscar = () => this.db.from('bot_envios').select('waha_id').in('waha_id', [...new Set([id, corto])]).limit(1);
      let { data: nuestros, error } = await buscar();
      let nuestro = Array.isArray(nuestros) ? nuestros[0] : nuestros;
      // CARRERA (23/9/2026): el eco de WhatsApp puede llegar antes de que se
      // termine de anotar el envío, y un mensaje del bot se tomaba como de una
      // persona y pausaba la charla. Se espera un momento y se vuelve a mirar.
      if (!nuestro && !error) {
        await new Promise((r) => setTimeout(r, 2500));
        ({ data: nuestros, error } = await buscar());
        nuestro = Array.isArray(nuestros) ? nuestros[0] : nuestros;
      }
      if (nuestro) return { ignorado: 'lo mandamos nosotros' };
      // y si el texto es el mismo que el bot acaba de mandar a ese chat, también es nuestro
      const eco = String(p?.body ?? '').trim();
      const reciente = [...this.ultimoEnviado.entries()].find(([, v]) => Date.now() - v.en < 180_000 && eco && v.texto.trim() === eco);
      if (reciente) return { ignorado: 'eco de un mensaje del bot' };
      // ante la duda, NO pausar: pausar de más le calla el bot a un cliente
      if (error) return { ignorado: 'registro de envíos no disponible' };
    }
    // la bienvenida y el fuera de horario de WhatsApp Business no son una persona
    if (esAutomaticoWhatsappBusiness(p?.body ?? p?._data?.message?.conversation)) return { ignorado: 'automático de WhatsApp Business' };
    // NOWEB: lo que se manda desde el teléfono llega con `to` vacío y el chat en
    // `_data.key.remoteJid` (o en `from`, que en un fromMe es la otra persona)
    const chat = String(p?.to ?? p?.chatId ?? p?._data?.key?.remoteJid ?? p?.from ?? '');
    if (!chat || chat.endsWith('@g.us') || chat.includes('status@broadcast')) return { ignorado: 'fromMe sin chat de persona' };
    // MISMA clave que charla(): solo dígitos (un @lid se guarda sin el sufijo).
    // Con '@lid' la pausa iba a una charla distinta de la real y cada persona
    // aparecía dos veces en la bandeja (2026-09-08).
    const identidad = chat.split('@')[0].replace(/\D/g, '');
    if (!identidad) return { ignorado: 'fromMe sin destinatario' };
    this.resolverContactoWaha(identidad, chat.endsWith('@lid')).catch(() => null);
    const propio = String(numeroLinea ?? '').replace(/\D/g, '');
    if (propio && identidad === propio) return { ignorado: 'chat con uno mismo' };
    let texto = String(p?.body ?? p?.caption ?? '').trim();
    // FOTO/AUDIO/ARCHIVO mandado desde el teléfono (16/9/2026): antes solo se
    // registraba el texto y en RESPONDE no aparecía nada. Se baja YA (WAHA borra
    // sus archivos enseguida), se guarda en el bucket y viaja como media.
    const tipoMsg = String(p?.type ?? p?._data?.type ?? '').toLowerCase();
    const esMedia = !!p?.hasMedia || !!p?.media || ['ptt', 'audio', 'image', 'video', 'document', 'sticker'].includes(tipoMsg);
    let mediaSaliente: { tipo: 'image' | 'audio' | 'video' | 'document'; url: string } | null = null;
    let epigrafeMedia = ''; // lo que la persona escribió junto a la foto/audio (si escribió algo)
    if (esMedia) {
      const media = await this.bajarMediaWaha(p).catch(() => null);
      const mime = media?.mime ?? String(p?.media?.mimetype ?? '');
      const tipoMedia: 'image' | 'audio' | 'video' | 'document' = /^image\//.test(mime) || tipoMsg === 'image' ? 'image'
        : /^audio\//.test(mime) || ['ptt', 'audio'].includes(tipoMsg) ? 'audio'
        : /^video\//.test(mime) || tipoMsg === 'video' ? 'video' : 'document';
      if (media) {
        try {
          const ext = (media.nombre.match(/\.[a-z0-9]{2,4}$/i)?.[0]) || (tipoMedia === 'image' ? '.jpg' : tipoMedia === 'audio' ? '.ogg' : '');
          const ruta = `whatsapp/${identidad}/enviado-${Date.now()}${ext}`;
          const url = await this.guardarAdjuntoPrivado(ruta, media);
          if (url) mediaSaliente = { tipo: tipoMedia, url };
        } catch { /* sin archivo: igual queda el rótulo */ }
      }
      const rotulo = tipoMedia === 'image' ? '📷 Foto enviada' : tipoMedia === 'audio' ? '🎙️ Audio enviado' : tipoMedia === 'video' ? '🎬 Video enviado' : '📄 Archivo enviado';
      const epigrafe = String(p?.caption ?? p?._data?.caption ?? (/\.[a-z0-9]{2,5}$/i.test(texto) ? '' : texto)).trim();
      epigrafeMedia = epigrafe;
      texto = epigrafe ? `${rotulo}: ${epigrafe}` : rotulo;
    }
    const { data: conv } = await this.db.from('bot_conversaciones').select('mensajes, bot_activo').eq('linea', 'pedidos').eq('telefono', identidad).maybeSingle();
    const hist: any[] = Array.isArray(conv?.mensajes) ? conv!.mensajes : [];
    // red de seguridad si el id no coincidió: lo que dijo el bot en sus últimos
    // turnos no es de una persona
    const dichoPorElBot = hist.filter((m) => m.role === 'assistant').slice(-5).map((m) => String(m.content ?? '').replace(/^\[acuse-archivo\] /, '').trim());
    // Con una foto/audio se compara SOLO lo que se escribió con ella: el rótulo
    // ("🎙️ Audio enviado") es igual para todos los audios, así que el segundo
    // audio de una persona al mismo cliente coincidía con el primero y se
    // descartaba como si fuera del bot. 2/10/2026: faltaban en RESPONDE 33 de
    // 69 audios del equipo en una semana, y esos tampoco pausaban el bot.
    const paraComparar = esMedia ? epigrafeMedia : texto;
    if (paraComparar && dichoPorElBot.includes(paraComparar)) return { ignorado: 'coincide con lo último del bot' };
    this.log.log(`una persona contestó desde el teléfono a ${identidad}: el bot queda pausado hasta que lo reactiven desde RESPONDE`);
    // Lo que se escribió desde el teléfono va también a RESPONDE: sin esto la
    // charla quedaba con los mensajes del cliente solos y no se entendía nada
    // (16/9/2026: faltaban 8 respuestas en una charla de 23 mensajes). Con el
    // id de WhatsApp, un aviso repetido de WAHA no lo duplica.
    if (texto) {
      const waId = chat.endsWith('@lid') ? `${identidad}@lid` : identidad;
      this.respondeRegistrar(waId, null, '', texto, undefined, mediaSaliente, { waMessageId: id || undefined, humano: true }).catch(() => null);
    }
    await this.db.from('bot_conversaciones').upsert({
      linea: 'pedidos', telefono: identidad,
      mensajes: [...hist, ...(texto ? [{ role: 'assistant', content: texto }] : [])].slice(-40),
      actualizado_en: new Date().toISOString(),
      bot_activo: false, derivada_en: new Date().toISOString(), derivada_motivo: 'Atendida desde el teléfono',
      atendida_por: null, derivacion_vence_en: null, acuse_derivacion_en: null,
    }, { onConflict: 'linea,telefono' }).then(() => null, () => null);
    await this.respondePausar(chat.endsWith('@lid') ? `${identidad}@lid` : identidad);
    await this.limpiarEspera('pedidos', identidad); // ya la atendieron: deja de esperar
    return { pausada: true, motivo: 'una persona contestó desde el teléfono' };
  }

  async webhookWaha(evento: any, numeroLinea?: string, origen: 'webhook' | 'barrido' = 'webhook') {
    // mensajes entrantes de personas ('message') y lo que sale de este número ('message.any' con fromMe)
    if (evento?.event !== 'message' && evento?.event !== 'message.any') return { ignorado: 'no es un mensaje' };
    const p = evento.payload ?? {};
    if (p.fromMe === true) return this.mensajePropio(p, numeroLinea);
    if (evento.event === 'message.any') return { ignorado: 'entrante por message.any: lo procesa el evento message' };

    // Cada entrante queda anotado ANTES de procesarse y se marca terminado al
    // final. Así un aviso repetido no se contesta dos veces y el barrido de
    // cada minuto (recuperarEntrantesPerdidos) encuentra lo que nunca llegó o
    // quedó a medias por un reinicio. 16/9/2026: un deploy devolvió 502 a n8n
    // y el pedido de una clienta se perdió sin rastro.
    // canales, estados y grupos no son una persona: nada que contestar ni que anotar
    // (16/9/2026 el bot le contestó dos veces a un canal de YouTube)
    if (/@newsletter$|@broadcast$|@g\.us$/.test(String(p.from ?? ''))) return { ignorado: 'canal, estado o grupo' };
    const idEntrante = String(p.id ?? '').trim();
    if (idEntrante) {
      const alta = await this.db.from('bot_entrantes').insert({
        waha_id: idEntrante, chat: String(p.from ?? ''), origen,
        mensaje_ts: Number(p.timestamp) > 0 ? new Date(Number(p.timestamp) * 1000).toISOString() : null,
      }).then((r: any) => r, () => null);
      if (alta?.error?.code === '23505' && origen === 'webhook') return { ignorado: 'mensaje ya recibido' };
    }
    try {
      const r = await this.procesarEntrante(p, numeroLinea);
      if (idEntrante) await this.db.from('bot_entrantes').update({ terminado_en: new Date().toISOString() }).eq('waha_id', idEntrante).then(() => null, () => null);
      return r;
    } catch (e) {
      this.log.error(`entrante ${idEntrante || '?'} falló: ${(e as any)?.message ?? e} (el barrido lo reintenta)`);
      throw e;
    }
  }

  // Barrido de seguridad: cada minuto mira las charlas con movimiento reciente
  // en WhatsApp y procesa los entrantes que el sistema no registró, o que
  // quedaron sin terminar (máximo 3 intentos). Nada viejo: solo los últimos 20
  // minutos, y nunca antes del primer registro (para no re-contestar historia).
  private barriendo = false;
  private registroDesde: number | null = null;
  @Cron('30 * * * * *')
  async recuperarEntrantesPerdidos() {
    const url = process.env.WAHA_URL, key = process.env.WAHA_API_KEY;
    if (!url || !key || this.barriendo) return;
    this.barriendo = true;
    try {
      if (this.registroDesde == null) {
        const { data } = await this.db.from('bot_entrantes').select('recibido_en').order('recibido_en', { ascending: true }).limit(1).maybeSingle();
        if (!data) return;
        this.registroDesde = new Date((data as any).recibido_en).getTime();
      }
      const base = `${url.replace(/\/$/, '')}/api/${process.env.WAHA_SESSION || 'odb'}`;
      const pedir = async (ruta: string) => {
        const r = await fetch(`${base}${ruta}`, { headers: { 'X-Api-Key': key }, signal: AbortSignal.timeout(15000) });
        return r.ok ? r.json() : [];
      };
      const ahora = Date.now();
      const desde = Math.max(this.registroDesde, ahora - 20 * 60_000);
      const chats = ((await pedir('/chats?limit=30&sortBy=conversationTimestamp&sortOrder=desc')) as any[])
        .filter((c) => Number(c.conversationTimestamp) * 1000 >= desde)
        .map((c) => String(c.id ?? ''))
        .filter((id) => id && !/@g\.us$|@newsletter$|^status@broadcast$/.test(id));
      for (const chat of chats) {
        const lista = async (media: boolean) => ((await pedir(`/chats/${encodeURIComponent(chat)}/messages?limit=12&downloadMedia=${media}`)) as any[]) ?? [];
        let msgs = (await lista(false)).filter((m) => !m.fromMe && m.id && Number(m.timestamp) * 1000 >= desde && Number(m.timestamp) * 1000 <= ahora - 90_000);
        if (!msgs.length) continue;
        const { data: vistos } = await this.db.from('bot_entrantes').select('waha_id, terminado_en, intentos, recibido_en').in('waha_id', msgs.map((m) => String(m.id)));
        const porId = new Map(((vistos ?? []) as any[]).map((v) => [v.waha_id, v]));
        const pendientes = msgs.filter((m) => {
          const v = porId.get(String(m.id));
          return !v || (!v.terminado_en && v.intentos < 3 && ahora - new Date(v.recibido_en).getTime() > 6 * 60_000);
        });
        if (!pendientes.length) continue;
        if (pendientes.some((m) => m.hasMedia)) {
          const conMedia = new Map((await lista(true)).map((m) => [String(m.id), m]));
          msgs = pendientes.map((m) => conMedia.get(String(m.id)) ?? m);
        } else msgs = pendientes;
        msgs.sort((a, b) => Number(a.timestamp) - Number(b.timestamp));
        for (const m of msgs) {
          const v = porId.get(String(m.id));
          this.log.warn(`barrido: entrante ${v ? 'sin terminar' : 'PERDIDO'} de ${chat} (${String(m.body ?? '').slice(0, 40)}): lo proceso ahora`);
          try {
            if (v) {
              await this.db.from('bot_entrantes').update({ intentos: v.intentos + 1, origen: 'barrido' }).eq('waha_id', String(m.id));
              await this.procesarEntrante(m, process.env.WAHA_NUMERO_LINEA || '5491122812200');
              await this.db.from('bot_entrantes').update({ terminado_en: new Date().toISOString() }).eq('waha_id', String(m.id));
            } else {
              await this.webhookWaha({ event: 'message', payload: m }, process.env.WAHA_NUMERO_LINEA || '5491122812200', 'barrido');
            }
          } catch (e: any) { this.log.warn(`barrido: no pude procesar ${m.id}: ${e?.message ?? e}`); }
        }
      }
    } catch (e: any) {
      this.log.warn(`barrido de entrantes: ${e?.message ?? e}`);
    } finally {
      this.barriendo = false;
    }
  }

  private async procesarEntrante(p: any, numeroLinea?: string) {

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
    // La charla SIEMPRE se guarda con la clave en dígitos: charla() normaliza
    // así, y usar el "@lid" crudo abría una conversación fantasma donde el
    // chequeo de silencio no veía nada y el bot le hablaba encima a la persona
    // que estaba atendiendo (19/9/2026).
    const clave = identidad.replace(/\D/g, '');

    // Si la carga trae el teléfono marcable, se guarda pegado al @lid. Es lo
    // único que después permite reconocer a la gente de la casa, porque el @lid
    // por sí solo no dice nada. Se hace una vez por contacto y no frena nada.
    const real = this.telefonoDeLaCarga(p);
    // La clave es la misma que usa el resto del sistema: charla() le saca todo
    // lo que no sea dígito, así que el contacto se guarda igual o no se
    // encuentra nunca.
    const claveContacto = identidad.replace(/\D/g, '');
    // número real y nombre de agenda vía WAHA (con memoria: no pega por cada mensaje)
    this.resolverContactoWaha(claveContacto, esLid).catch(() => null);
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

    // ¿Es ADMINISTRACIÓN contestando un aviso de pago? El circuito lo cierra
    // el bot (regla del dueño, 2026-09-01): administración dice "recibido" en
    // su chat y el bot le confirma al cliente. Todo pasa por el bot.
    const rAdmin = await this.respuestaDeAdministracion(identidad, p).catch((e) => {
      this.log.warn(`respuesta de administración: ${e?.message ?? e}`);
      return null;
    });
    if (rAdmin) return rAdmin;

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
          enlacePublico = await this.guardarAdjuntoPrivado(ruta, media);
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
          await this.anotarEsperaEnPausa('pedidos', clave, etiqueta(rotulo));
          return { contestado: false, motivo: 'RESPONDE: atiende una persona' };
        }
        const r: any = await this.charla({
          numeroLinea, telefono: clave,
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
        const env = await this.enviarConTarjeta(desde, identidad, r);
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
            numeroLinea, telefono: clave,
            mensaje: epigrafe,
            archivoBase64: miniatura, mimeType: 'image/jpeg', vistaPreviaDeVideo: true,
            archivoUrl: enlacePublico || undefined,
            mensajeId: p.id ? String(p.id) : undefined,
          }).catch(() => null);
          if (r?.respuesta) {
            await this.simularEscritura(desde, r.respuesta);
            const env = await this.enviarConTarjeta(desde, identidad, r);
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
            await this.anotarEsperaEnPausa('pedidos', clave, `🎙️ ${dicho}`);
            return { contestado: false, motivo: 'RESPONDE: atiende una persona' };
          }
          const r: any = await this.charla({ numeroLinea, telefono: clave, mensaje: dicho, mensajeId: p.id ? String(p.id) : undefined });
          if (!r?.respuesta) {
            await this.respondeRegistrar(waIdM, p.notifyName ?? null, etiqueta(`🎙️ ${dicho}`), null, p.id ? String(p.id) : undefined, mediaReg).catch(() => null);
            return { contestado: false, motivo: r?.derivada ? 'derivada a una persona' : 'sin respuesta' };
          }
          await this.simularEscritura(desde, r.respuesta);
          const env = await this.enviarConTarjeta(desde, identidad, r);
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
      // ¿Hay que callar? (línea apagada, o una persona atiende esta charla). Se
      // guarda el archivo en el hilo con su enlace —para leerlo al retomar— y
      // no se manda acuse ni se toca la pausa de la persona.
      {
        const { data: lineaCfg } = await this.db.from('lineas_whatsapp').select('bot_activo').eq('linea', 'pedidos').eq('activa', true).limit(1).maybeSingle();
        const { data: convPrev } = await this.db.from('bot_conversaciones').select('mensajes, bot_activo, atendida_por, derivada_motivo').eq('linea', 'pedidos').eq('telefono', clave).maybeSingle();
        const silencio = motivoDeSilencio(lineaCfg as any, convPrev as any, /^54911000000\d{1,3}$/.test(identidad));
        if (silencio) {
          const hist: any[] = Array.isArray((convPrev as any)?.mensajes) ? (convPrev as any).mensajes : [];
          await this.db.from('bot_conversaciones').upsert({
            linea: 'pedidos', telefono: clave,
            mensajes: [...hist, { role: 'user', content: `[el cliente mandó ${queEs}]${enlace ? ` [adjunto sin leer: ${enlace}]` : ''}` }].slice(-40),
            actualizado_en: new Date().toISOString(),
            esperando_desde: (convPrev as any)?.esperando_desde ?? new Date().toISOString(),
            esperando_texto: `${esAudio ? '🎙️' : tipo === 'video' ? '🎬' : '📄'} El cliente mandó ${queEs} y nadie lo abrió`,
          }, { onConflict: 'linea,telefono' }).then(() => null, () => null);
          await this.respondeRegistrar(waIdM, p._data?.notifyName ?? p.notifyName ?? null, etiqueta(esAudio ? '🎙️ Audio del cliente' : tipo === 'video' ? '🎬 Video del cliente' : `📄 ${media?.nombre || 'Archivo'} del cliente`), null, p.id ? String(p.id) : undefined, mediaReg).catch(() => null);
          this.log.log(`archivo de ${identidad} guardado sin acuse (${silencio})`);
          return { contestado: false, motivo: silencio };
        }
      }
      const icono = esAudio ? '🎙️ Audio del cliente' : tipo === 'video' ? '🎬 Video del cliente' : `📄 ${media?.nombre || 'Archivo'} del cliente`;
      await this.respondeRegistrar(waIdM, p._data?.notifyName ?? p.notifyName ?? null, etiqueta(icono), null, p.id ? String(p.id) : undefined, mediaReg).catch(() => null);
      if (await this.respondeModoHumano(waIdM).catch(() => false)) return { contestado: false, motivo: 'RESPONDE: atiende una persona' };

      await this.db.from('bot_notas_equipo').insert({ linea: 'pedidos', telefono: clave, nota: `El cliente mandó ${queEs} por WhatsApp. Hay que escucharlo/abrirlo y responderle.${enlace ? ` Archivo: ${enlace}` : ''}` }).then(() => null, () => null);
      const { data: cfg } = await this.db.from('lineas_whatsapp').select('avisar_proveedores_a').eq('linea', 'pedidos').eq('activa', true).limit(1).maybeSingle();
      await this.db.from('alertas_internas').insert({ para_usuario: cfg?.avisar_proveedores_a ?? null, tipo: 'derivacion', titulo: `Mensaje de voz de +${identidad}`, detalle: `El cliente mandó ${queEs}. Escuchalo y respondele por WhatsApp.${enlace ? ` ${enlace}` : ''}`, referencia: { linea: 'pedidos', telefono: clave, enlace } }).then(() => null, () => null);

      const { data: conv } = await this.db.from('bot_conversaciones').select('mensajes').eq('linea', 'pedidos').eq('telefono', clave).maybeSingle();
      const hist: any[] = Array.isArray(conv?.mensajes) ? conv!.mensajes : [];
      // marca fija en el historial: chequear por palabras fallaba y el cliente
      // recibía el mismo acuse por cada archivo que mandaba
      const MARCA = '[acuse-archivo] ';
      const yaAviso = hist.slice(-8).some((m: any) => m.role === 'assistant' && String(m.content).startsWith(MARCA));
      await this.db.from('bot_conversaciones').upsert({
        linea: 'pedidos', telefono: clave,
        mensajes: [...hist, { role: 'user', content: `[el cliente mandó ${queEs}]` }, ...(yaAviso ? [] : [{ role: 'assistant', content: MARCA + (esAudio ? 'Recibí tu audio: lo escucha alguien de la casa.' : 'Recibí tu archivo: lo revisa alguien de la casa.') }]),
        ].slice(-40),
        actualizado_en: new Date().toISOString(), bot_activo: false,
        derivada_en: new Date().toISOString(), derivada_motivo: `El cliente mandó ${queEs}: hay que escucharlo/abrirlo`, resuelta_en: null,
        // Vence sola: sin esto, 68 charlas quedaron derivadas para siempre (nadie
        // las tomó) y esos clientes solo recibían "ya está avisado" (2026-09-08).
        atendida_por: null, derivacion_vence_en: new Date(Date.now() + 4 * 3600_000).toISOString(),
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
    // UN MENSAJE QUE NO ES TEXTO NI ARCHIVO NO SE TIRA (19/9/2026). WhatsApp
    // manda la ubicación, la tarjeta de contacto, la encuesta o la respuesta de
    // un botón sin `body` y sin media: caían en "mensaje sin texto" y
    // desaparecían — ni respuesta, ni RESPONDE, ni nota. Y justo la ubicación es
    // lo que manda el cliente cuando el bot le pide la dirección del envío.
    if (!texto) {
      const ubic = p.location ?? p._data?.location ?? p._data?.message?.locationMessage;
      const contacto = p.vCards ?? p._data?.message?.contactMessage;
      texto = ubic
        ? `📍 Ubicación del cliente${ubic.description || ubic.name ? `: ${ubic.description ?? ubic.name}` : ''}${ubic.latitude && ubic.longitude ? ` (mapa: https://maps.google.com/?q=${ubic.latitude},${ubic.longitude})` : ''}`
        : contacto ? '📇 El cliente mandó una tarjeta de contacto'
        : `✉️ El cliente mandó un mensaje que no puedo leer (tipo ${tipo || 'desconocido'})`;
      this.log.warn(`entrante sin texto (type=${tipo || '?'}): se deriva a una persona · ${clave}`);
      const waIdSinTexto = esLid ? desde : identidad;
      await this.respondeRegistrar(waIdSinTexto, p._data?.notifyName ?? p.notifyName ?? null, texto, null, p.id ? String(p.id) : undefined).catch(() => null);
      await this.db.from('bot_notas_equipo')
        .insert({ linea: 'pedidos', telefono: clave, nota: `${texto} Hay que mirarlo y contestarle.` })
        .then(() => null, () => null);
      await this.anotarEsperaEnPausa('pedidos', clave, texto);
      return { contestado: false, motivo: 'mensaje sin texto: derivado a una persona' };
    }

    // whatsapp_id como lo guarda RESPONDE: solo dígitos para números normales,
    // el @lid completo para contactos con número oculto
    const waId = esLid ? desde : identidad;

    // Si en RESPONDE la charla está en "atendés vos", el bot se calla: el mensaje
    // igual queda registrado allá para que la persona lo vea.
    if (await this.respondeModoHumano(waId)) {
      await this.respondeRegistrar(waId, p._data?.notifyName ?? p.notifyName ?? null, texto, null, p.id ? String(p.id) : undefined);
      await this.anotarEsperaEnPausa('pedidos', clave, texto);
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
    // el resumen del pedido (cantidades, total, entrega) va con el diseño Placa
    // roja (25/9/2026); una lista de precios sin cantidades, con el cartel de siempre
    const envio = await this.enviarConTarjeta(desde, identidad, r);
    // el turno completo queda en RESPONDE (best-effort, no bloquea la respuesta)
    this.respondeRegistrar(waId, p.notifyName ?? null, texto, r.respuesta, p.id ? String(p.id) : undefined).catch(() => null);
    // SI NO SALIÓ, NO ESTÁ CONTESTADO (19/9/2026). Antes se registraba el turno
    // como si el cliente lo hubiera recibido: el panel mostraba la respuesta, el
    // bot creía que ya lo había dicho y el cliente no tenía nada. Ahora queda
    // marcado como esperando, con nota, y el barrido lo reintenta (la excepción
    // evita que el entrante se marque como terminado).
    if (!envio.enviado) {
      await this.anotarEsperaEnPausa('pedidos', clave, `${texto} [el bot contestó pero WhatsApp no lo entregó]`);
      await this.db.from('bot_notas_equipo')
        .insert({ linea: 'pedidos', telefono: clave, nota: `[no entregado] La respuesta del bot no salió (${envio.motivo ?? 'sin motivo'}). El cliente sigue esperando: ${texto.slice(0, 200)}` })
        .then(() => null, () => null);
      throw new Error(`WhatsApp no entregó la respuesta a ${clave}: ${envio.motivo ?? 'sin motivo'}`);
    }
    return { contestado: envio.enviado, ...envio };
  }

  // La respuesta del bot sale con su tarjeta Placa roja cuando detalla
  // productos (resumen, pedido confirmado, precios); si la tarjeta no se arma o
  // no sale, va el texto. Es el mismo camino para texto, foto, audio y video
  // (2/10/2026: lo que contestaba a una foto o a un audio salía siempre como
  // texto, y el pedido por foto es justo el que trae la lista larga).
  private async enviarConTarjeta(desde: string, identidad: string, r: { respuesta: string; catalogo?: ProductoConPrecio[] }) {
    const cartel = await this.armarTarjeta(r);
    // si le correspondía imagen y no salió, que quede en el log (1/10/2026)
    if (!cartel && imagenEsperada(r.respuesta)) this.log.warn(`le correspondía imagen de ${imagenEsperada(r.respuesta)} y no se armó (${identidad})`);
    // una o más páginas cuadradas (3/10/2026): el texto va al pie de la última
    let envio: any = { enviado: false, motivo: 'sin cartel' };
    if (cartel) {
      for (let i = 0; i < cartel.imagenes.length; i++) {
        const ultima = i === cartel.imagenes.length - 1;
        envio = await this.enviarPorWhatsapp({ to: desde, imagenUrl: cartel.imagenes[i], text: ultima ? cartel.pie : '', referencia: `waha/${identidad}` });
        if (!envio.enviado) break;
      }
    }
    if (!envio.enviado) {
      if (cartel) this.log.warn(`el cartel no se pudo enviar (${envio.motivo}): va como texto`);
      envio = await this.enviarPorWhatsapp({ to: desde, text: r.respuesta, referencia: `waha/${identidad}` });
    }
    return envio;
  }

  // Sube las páginas de una tarjeta al storage público y devuelve sus URL
  // (null si falla alguna: va el texto).
  private async subirPaginas(pngs: Buffer[], nombre: string): Promise<string[] | null> {
    const mes = new Date().toISOString().slice(0, 7);
    const base = `${nombre}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const urls: string[] = [];
    for (let i = 0; i < pngs.length; i++) {
      const ruta = `carteles/${mes}/${base}${pngs.length > 1 ? `-${i + 1}` : ''}.png`;
      const { error } = await this.db.storage.from('publico').upload(ruta, pngs[i], { contentType: 'image/png', upsert: true });
      if (error) { this.log.warn(`no pude subir la tarjeta ${nombre}: ${error.message}`); return null; }
      urls.push(this.db.storage.from('publico').getPublicUrl(ruta).data.publicUrl);
    }
    return urls;
  }

  // Qué tarjeta le toca a la respuesta, en este orden: el resumen del pedido,
  // el pedido confirmado, los precios de lo que consultó y la lista escrita a
  // mano. null: va el texto solo.
  private async armarTarjeta(r: { respuesta: string; catalogo?: ProductoConPrecio[] }): Promise<Tarjeta | null> {
    return (await this.cartelDeResumen(r.respuesta)) ?? (await this.cartelDePedido(r.respuesta)) ?? (await this.cartelDePrecios(r.respuesta, r.catalogo ?? [])) ?? (await this.cartelDeListado(r.respuesta));
  }

  // Para "Probar el bot" del panel (2/10/2026): la misma tarjeta que le llega al
  // cliente, armada con la misma regla que enviarConTarjeta, para que el
  // simulador muestre la imagen y su epígrafe en vez del texto. No manda nada
  // por WhatsApp; la imagen queda en el storage público, como la de un envío.
  async tarjetaDeLaRespuesta(r: { respuesta?: string | null; catalogo?: ProductoConPrecio[] } | null | undefined): Promise<Tarjeta | null> {
    if (!r?.respuesta) return null;
    return this.armarTarjeta({ respuesta: r.respuesta, catalogo: r.catalogo });
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
  // Lista de precios como imagen (1/10/2026): con los productos que el bot
  // consultó y nombró en la respuesta, desde 3. El epígrafe se queda con lo que
  // no son precios (la pregunta).
  private async cartelDePrecios(respuesta: string, catalogo: ProductoConPrecio[]): Promise<Tarjeta | null> {
    if (leerResumenDePedido(respuesta)) return null;
    const productos = preciosDeLaRespuesta(respuesta, catalogo);
    if (productos.length < 2) return null;
    try {
      const fecha = new Date().toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', timeZone: 'America/Argentina/Buenos_Aires' });
      const imagenes = await this.subirPaginas(await cartelesListaPrecios(productos.slice(0, 18), fecha), 'precios');
      if (!imagenes) return null;
      return { imagenUrl: imagenes[0], imagenes, pie: pieSinPrecios(respuesta) || 'Te paso los precios.' };
    } catch (e) {
      this.log.warn(`lista de precios falló: ${e instanceof Error ? e.message : e}`);
      return null;
    }
  }

  // Resumen de pedido como imagen (diseño Placa roja, elegido el 25/9/2026).
  // Solo si TODOS los renglones se leen y suman el total; si no, va el texto.
  private async cartelDeResumen(respuesta: string): Promise<Tarjeta | null> {
    const resumen = leerResumenDePedido(respuesta);
    if (!resumen) return null;
    try {
      const imagenes = await this.subirPaginas(await cartelesPedido(resumen), 'resumen');
      if (!imagenes) return null;
      // la tarjeta ya dice "Respondé SÍ y lo confirmamos": el epígrafe no lo
      // vuelve a preguntar (3/10/2026: se pedía confirmación dos veces)
      const pie = resumen.confirmar ? sinPreguntaDeConfirmar(resumen.pie) : resumen.pie;
      return { imagenUrl: imagenes[0], imagenes, pie };
    } catch (e) {
      this.log.warn(`cartel de resumen falló: ${e instanceof Error ? e.message : e}`);
      return null;
    }
  }

  // El pedido confirmado sale como tarjeta Placa roja "PEDIDO" con su código
  // (2/10/2026; antes usaba la gráfica vieja y solo si el texto traía
  // renglones, que la confirmación no trae: no salía nunca). Los renglones y el
  // total salen de la base, no del texto; si no suman lo que dice el texto, va
  // el texto. Es lo que el cliente guarda y muestra en el mostrador.
  private async cartelDePedido(respuesta: string): Promise<Tarjeta | null> {
    // el código real tiene 12 caracteres ("PICKUP-5F2451C6C111"): con {4,10}
    // la tarjeta no salía nunca (3/10/2026)
    const codigo = respuesta.match(/\b(?:DOM|RET|PICKUP)-[A-Z0-9]{4,12}\b/)?.[0];
    if (!codigo) return null;
    // solo al confirmarlo: "tu pedido DOM-… está en camino" o "…quedó cancelado"
    // no llevan la tarjeta (diría "mostrá este código" de un pedido cancelado)
    if (!/\bconfirmad[oa]\b/i.test(respuesta) || /\bcancelad[oa]\b/i.test(respuesta)) return null;
    try {
      const { data: ped } = await this.db.from('pedidos')
        .select('id, destino_direccion, entrega_fecha, entrega_franja, pedidos_items(cantidad, precio_unitario, productos(nombre))')
        .eq('qr_retiro', codigo).maybeSingle();
      const items = (((ped as any)?.pedidos_items ?? []) as any[]).filter((i) => Number(i.cantidad) > 0);
      if (!items.length) return null;
      const renglones = items.map((i) => ({
        nombre: nombreParaCartel(i.productos?.nombre ?? 'Producto'),
        cantidad: Number(i.cantidad),
        unitario: Number(i.precio_unitario),
        subtotal: Math.round(Number(i.cantidad) * Number(i.precio_unitario)),
      }));
      const suma = renglones.reduce((t, r) => t + r.subtotal, 0);
      const dicho = respuesta.match(/total[^:\n]{0,20}:\s*\$\s?([\d.]+)/i)?.[1];
      if (dicho && Math.abs(Number(dicho.replace(/\./g, '')) - suma) > 1) return null;
      const domicilio = codigo.startsWith('DOM');
      const direccion = (ped as any)?.destino_direccion as string | null;
      const cuando = [fechaLegible((ped as any)?.entrega_fecha), (ped as any)?.entrega_franja].filter(Boolean).join(', ');
      const pngs = await cartelesPedido({
        renglones,
        total: suma,
        entrega: domicilio
          ? { titulo: 'Envío sin cargo', detalle: [direccion, cuando].filter(Boolean).join(' · ') || null }
          : { titulo: 'Retiro en la sucursal Saint Thomas', detalle: ['Castex 3601, Canning', cuando].filter(Boolean).join(' · ') },
        confirmar: false,
        pie: '',
        titulo: 'PEDIDO',
        subtitulo: codigo,
        nota: domicilio ? 'Mostrá este código al recibir tu pedido.' : 'Presentá este código al retirar.',
      });
      const imagenes = await this.subirPaginas(pngs, `pedido-${codigo}`);
      if (!imagenes) return null;
      // el texto viaja como epígrafe, sin lo que ya está en la tarjeta (los
      // renglones, el código, el total y dónde y cuándo): queda "Pedido
      // confirmado." y lo que no está en la imagen (cómo se paga, a nombre de
      // quién lo retiran)
      const resto = respuesta.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('•')).join('\n')
        .replace(/^Pedido\s+\S+\s+confirmado\.\s*(?:Total:\s*\$\s?[\d.]+\.?)?\s*/i, '')
        .replace(/^(?:Retiro en la sucursal Saint Thomas|Envío sin cargo)[\s\S]*?(?=Se abona\b)/i, '')
        .replace(/[ \t]{2,}/g, ' ').trim();
      const pie = `Pedido confirmado.${resto ? (/^¿/.test(resto) ? '\n\n' : ' ') + resto : ''}`.slice(0, 400);
      return { imagenUrl: imagenes[0], imagenes, pie };
    } catch (e) {
      this.log.warn(`tarjeta del pedido falló (${codigo}): ${e instanceof Error ? e.message : e}`);
      return null;
    }
  }

  // Lista de precios escrita a mano por el bot ("• Producto — $precio"), cuando
  // los productos no salen de lo que consultó en el turno: también Placa roja
  // (2/10/2026; antes, la gráfica vieja). Desde 2 productos.
  private async cartelDeListado(respuesta: string): Promise<Tarjeta | null> {
    if (leerResumenDePedido(respuesta)) return null;
    const productos = respuesta.split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith('•') && /\$\s?[\d.]+/.test(l) && !/c\/u\s*=/.test(l))
      .map((l): ProductoConPrecio | null => {
        const m = l.replace(/^•\s*/, '').match(/^(.*?)[\s—–:-]*\$\s?([\d.]+)(?:[^$(\n]*\(\s*\$\s?([\d.]+)[^)]*\))?/);
        if (!m) return null;
        const precio = Number(m[2].replace(/\./g, ''));
        const efectivo = m[3] ? Number(m[3].replace(/\./g, '')) : null;
        return { nombre: m[1].replace(/[—–:-]\s*$/, '').trim(), precio, precioEfectivo: efectivo && efectivo < precio ? efectivo : null };
      })
      .filter((p): p is ProductoConPrecio => !!p && !!p.nombre && p.precio > 0);
    if (productos.length < 2) return null;
    try {
      const fecha = new Date().toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', timeZone: 'America/Argentina/Buenos_Aires' });
      const imagenes = await this.subirPaginas(await cartelesListaPrecios(productos.slice(0, 18), fecha), 'precios');
      if (!imagenes) return null;
      return { imagenUrl: imagenes[0], imagenes, pie: pieSinPrecios(respuesta) || 'Te paso los precios.' };
    } catch (e) {
      this.log.warn(`no pude armar el listado: ${e instanceof Error ? e.message : e}`);
      return null;
    }
  }

  private async simularEscritura(to: string, texto: string) {
    const wahaUrl = process.env.WAHA_URL, wahaKey = process.env.WAHA_API_KEY;
    const sesion = process.env.WAHA_SESSION || 'default';
    const crudo = String(to ?? ''); const digitos = crudo.replace(/\D/g, '');
    const chatId = crudo.includes('@') ? crudo.split(':')[0] : digitos ? `${digitos}@c.us` : null;
    // ~40 caracteres por segundo, con piso y techo
    const ms = Math.min(2000, Math.max(0, Number(process.env.ODB_BOT_PAUSA_ESCRITURA_MS ?? 0)));
    if (!ms) return;
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
  // Todo lo que sale por WhatsApp queda registrado por su id: así, cuando
  // WhatsApp devuelve un mensaje "fromMe", se sabe si lo mandó el sistema o lo
  // tecleó una persona desde el teléfono.
  private async registrarEnvio<T extends { enviado: boolean; id?: string | null }>(r: T, telefono: string, origen?: string): Promise<T> {
    // se ESPERA la anotación: si no, el eco llegaba antes y pausaba la charla
    if (r?.enviado && r.id) {
      await this.db.from('bot_envios').upsert({ waha_id: String(r.id), telefono, origen: origen ?? 'bot' }, { onConflict: 'waha_id' }).then(() => null, () => null);
    }
    return r;
  }

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

    // ÚLTIMA PUERTA: el envío en ODB es SIN CARGO y por acá sale TODO lo que la
    // casa manda por WhatsApp (bot, cierres de pedido, avisos, difusiones,
    // respuestas desde el panel). Regla de Leandro, 19/9/2026: "nunca más que
    // digas esa parte". Si algún texto todavía dice que el envío se cobra, se
    // corrige acá, aunque venga de un camino que nadie revisó.
    if (payload.text) {
      const limpio = envioSinCargo(String(payload.text));
      if (limpio !== payload.text) {
        this.log.warn(`salía un mensaje diciendo que el envío se cobra (${payload.referencia ?? payload.kind ?? 'sin referencia'}): corregido a "sin cargo"`);
        payload = { ...payload, text: limpio };
      }
    }

    // RÁFAGAS: 10 fotos juntas se procesan en paralelo y cada una ve el mismo
    // historial, así que salían 9 respuestas iguales seguidas (Distribuidora
    // Porti, 23/9/2026). Lo mismo al mismo chat dentro de 3 minutos no sale dos veces.
    if (payload.text && !payload.imagenUrl && !payload.audioUrl && !payload.documentoUrl && payload.kind !== 'aviso-interno') {
      const k = String(payload.to ?? '').replace(/\D/g, '');
      const prev = this.ultimoEnviado.get(k);
      if (prev && Date.now() - prev.en < 180_000 && casiIgual(prev.texto, String(payload.text))) {
        this.log.warn(`mensaje repetido a ${k} dentro de 3 min: no se manda de nuevo`);
        return { enviado: true, id: null, via: 'omitido-repetido' } as any;
      }
      this.ultimoEnviado.set(k, { texto: String(payload.text), en: Date.now() });
      if (this.ultimoEnviado.size > 3000) this.ultimoEnviado.clear();
    }

    const crudo = String(payload.to ?? '');
    const digitos = crudo.replace(/\D/g, '');
    let chatId = crudo.includes('@') ? crudo.split(':')[0] : digitos ? `${digitos}@c.us` : null;
    if (!chatId) return { enviado: false, reintentable: false, motivo: 'Número inválido' };
    // Un @lid (el id de privacidad de WhatsApp) NO es un número marcable: armar
    // "digitos@c.us" con él manda el mensaje a la nada o a un desconocido. Las
    // charlas guardan esos dígitos como teléfono, así que acá se traduce al
    // número real del contacto y, si no lo tenemos, al @lid tal cual
    // (18/9/2026: una corrección al cliente no habría llegado nunca).
    if (!crudo.includes('@') && digitos.length >= 11) {
      const { data: contacto } = await this.db
        .from('bot_contactos').select('telefono_real, lid').eq('telefono', digitos).maybeSingle();
      const lid = String((contacto as any)?.lid ?? '');
      if (lid.startsWith(digitos)) {
        const real = String((contacto as any)?.telefono_real ?? '').replace(/\D/g, '');
        chatId = real ? `${real}@c.us` : lid;
        this.log.log(`destino @lid traducido: ${digitos} → ${chatId}`);
      }
    }

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
          return this.registrarEnvio({ enviado: true, via: 'waha', id: r.cuerpo?.id ?? r.cuerpo?.key?.id ?? null }, payload.to, payload.kind);
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
          return this.registrarEnvio({ enviado: true, via: 'waha', id: r.cuerpo?.id ?? r.cuerpo?.key?.id ?? null }, payload.to, payload.kind);
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
        return this.registrarEnvio({ enviado: true, via: 'waha', id }, payload.to, payload.kind);
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
      return { enviado: false, reintentable: true, motivo: 'WhatsApp no conectado' };
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

    await this.respondePausar(telefono);
    await this.limpiarEspera(linea, telefono); // la atendió una persona desde el panel
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
    await this.respondePausar(telefono);
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

  // VIGILANTE DE LA SESIÓN DE WHATSAPP (23/9/2026). La sesión de WAHA quedó en
  // FAILED el domingo 21/9 a las 18:49 y no entró ni un mensaje por casi dos
  // días sin que nadie se enterara. Cada 5 minutos se mira el estado: si falla
  // dos veces seguidas se reinicia UNA vez y queda la alerta en la campanita del
  // panel (no por WhatsApp: justamente es lo que está caído).
  private fallosSesion = 0;
  private ultimoEnviado = new Map<string, { texto: string; en: number }>();
  @Cron('40 */5 * * * *')
  async vigilarSesionWhatsapp() {
    const url = process.env.WAHA_URL, key = process.env.WAHA_API_KEY;
    if (!url || !key) return;
    const sesion = process.env.WAHA_SESSION || 'odb';
    const base = url.replace(/\/$/, '');
    let status: string | null = null;
    try {
      const r = await fetch(`${base}/api/sessions/${sesion}`, { headers: { 'X-Api-Key': key }, signal: AbortSignal.timeout(15000) });
      status = r.ok ? String(((await r.json()) as any)?.status ?? '') || null : null;
    } catch { status = null; }
    const d = decisionSesion(status, this.fallosSesion);
    this.fallosSesion = d.fallos;
    if (!d.alertar && !d.reiniciar) return;
    this.log.error(`WhatsApp: la sesión "${sesion}" está ${status ?? 'sin respuesta'} (${d.fallos} lecturas seguidas)${d.reiniciar ? ': la reinicio' : ''}`);
    if (d.reiniciar) {
      await fetch(`${base}/api/sessions/${sesion}/restart`, { method: 'POST', headers: { 'X-Api-Key': key }, signal: AbortSignal.timeout(60000) }).catch(() => null);
    }
    const hace2h = new Date(Date.now() - 2 * 3600_000).toISOString();
    const { data: prev } = await this.db.from('alertas_internas').select('id').eq('tipo', 'whatsapp_caido').gte('creada_en', hace2h).limit(1).maybeSingle();
    if (prev) return;
    const { data: cfg } = await this.db.from('lineas_whatsapp').select('avisar_proveedores_a').eq('linea', 'pedidos').eq('activa', true).limit(1).maybeSingle();
    await this.db.from('alertas_internas').insert({
      para_usuario: (cfg as any)?.avisar_proveedores_a ?? null,
      tipo: 'whatsapp_caido',
      titulo: status === 'SCAN_QR_CODE' ? 'WhatsApp desvinculado: hay que escanear el QR' : 'La línea de WhatsApp no recibe mensajes',
      detalle: status === 'SCAN_QR_CODE'
        ? 'El teléfono de la línea se desvinculó del sistema. Hasta escanear el QR de nuevo, el bot no recibe ni manda nada: atendé desde el teléfono.'
        : `La sesión de WhatsApp está ${status ?? 'sin respuesta'}. ${d.reiniciar ? 'Ya se intentó reiniciar sola.' : 'Sigue caída después del reinicio.'} Mientras tanto los clientes escriben y el bot no los ve: atendé desde el teléfono.`,
      referencia: { sesion, status },
    }).then(() => null, () => null);
  }

  // NADIE SE QUEDA SIN RESPUESTA (19/9/2026). La charla pausada sigue pausada:
  // el bot no habla. Pero si el cliente escribió algo que pide respuesta y
  // pasaron más de 20 minutos sin que nadie conteste, queda una nota en el panel.
  // El WhatsApp a administración con el nombre y lo que dijo está APAGADO desde
  // el 1/10/2026 (pedido del dueño); se prende con ODB_AVISO_ESPERA_WHATSAPP=1.
  // Solo en horario de local (8 a 21) para no despertar a nadie.
  @Cron('20 */5 * * * *')
  async avisarEsperandoRespuesta() {
    const hora = Number(new Date().toLocaleString('es-AR', { hour: '2-digit', hour12: false, timeZone: 'America/Argentina/Buenos_Aires' }));
    if (!(hora >= 8 && hora < 21)) return;
    // se traen TODAS las esperas (son decenas) y la selección la hace una
    // función con tests: nunca avisadas primero, re-avisos a las 6 y 24 h, tope 3
    const { data: esperando } = await this.db.from('bot_conversaciones')
      .select('linea, telefono, esperando_desde, esperando_texto, esperando_aviso_en, esperando_avisos')
      .not('esperando_desde', 'is', null)
      .limit(500);
    // los contactos silenciados no generan avisos (26/9/2026)
    const { data: silenciados } = await this.db.from('bot_contactos').select('telefono').contains('etiquetas', ['silenciado']);
    const callados = new Set(((silenciados ?? []) as any[]).map((x) => String(x.telefono)));
    const pendientes = esperasParaAvisar(((esperando ?? []) as any[]).filter((e) => !callados.has(String(e.telefono))), Date.now());
    if (!pendientes.length) return;

    const { data: cfg } = await this.db
      .from('lineas_whatsapp').select('derivar_pagos_a').eq('linea', 'pedidos').eq('activa', true).limit(1).maybeSingle();
    const admin = String((cfg as any)?.derivar_pagos_a ?? '').replace(/\D/g, '');

    for (const c of pendientes) {
      const texto = String(c.esperando_texto ?? '').trim();
      const marcarAvisado = () => this.db.from('bot_conversaciones')
        .update({ esperando_aviso_en: new Date().toISOString(), esperando_avisos: Number(c.esperando_avisos ?? 0) + 1 })
        .eq('linea', c.linea).eq('telefono', c.telefono).then(() => null, () => null);
      // "gracias", "ok", un pulgar: no hace falta que nadie corra
      if (!pideRespuesta(texto)) { await marcarAvisado(); continue; }
      const minutos = Math.round((Date.now() - new Date(c.esperando_desde).getTime()) / 60_000);
      const { data: k } = await this.db.from('bot_contactos')
        .select('nombre, nombre_wa, telefono_real').eq('telefono', c.telefono).maybeSingle();
      const { data: conv } = await this.db.from('bot_conversaciones')
        .select('derivada_motivo, atendida_por').eq('linea', c.linea).eq('telefono', c.telefono).maybeSingle();
      // el aviso dice la verdad: casi siempre la pausó un mensaje desde el teléfono, no hay nadie atendiendo
      const porque = /tel[eé]fono/i.test(String((conv as any)?.derivada_motivo ?? ''))
        ? 'La charla quedó en pausa porque alguien escribió desde el teléfono de la línea'
        : (conv as any)?.atendida_por ? 'La charla la tomó una persona desde el panel' : 'La charla está en pausa';
      const quien = String((k as any)?.nombre ?? (k as any)?.nombre_wa ?? '').trim()
        || ((k as any)?.telefono_real ? `+${(k as any).telefono_real}` : c.telefono);
      const aviso = `⏳ ${quien} escribió hace ${minutos >= 60 ? `${Math.round(minutos / 60)} h` : `${minutos} min`} y nadie contestó. ${porque}, así que el bot no habla.\n\nDice: "${texto.slice(0, 200)}"\n\nContestale vos, o reactivá el bot desde el panel de ODB → WhatsApp → REACTIVAR BOT.${Number(c.esperando_avisos ?? 0) >= 2 ? '\n(Último aviso por esta charla.)' : ''}`;
      await this.db.from('bot_notas_equipo')
        .insert({ linea: c.linea, telefono: c.telefono, nota: `[esperando] ${texto.slice(0, 280)}` })
        .then(() => null, () => null);
      // sin WhatsApp: queda la nota y se marca como avisada, así no se repite cada 5 min
      if (!avisoEsperaPorWhatsapp()) { await marcarAvisado(); continue; }
      const env: any = admin ? await this.enviarPorWhatsapp({ to: admin, text: aviso, kind: 'aviso-interno' } as any).catch(() => ({ enviado: false })) : { enviado: false };
      this.log.warn(`charla en pausa sin atender: ${quien} hace ${minutos} min · aviso ${env?.enviado ? 'enviado' : 'NO salió'}`);
      // si el aviso no salió (WhatsApp caído), no se gasta: se reintenta en la próxima vuelta
      if (env?.enviado) await marcarAvisado();
    }
  }

  // Cada minuto: despacha los mensajes programados que ya vencieron
  @Cron('0 * * * * *')
  async despacharProgramados() {
    // difusiones programadas que llegaron a su hora: se reclaman de a una
    // (update condicional) para no despachar dos veces
    const { data: dueDif } = await this.db.from('responde_difusiones')
      .select('id').is('despachada_en', null).not('programada_para', 'is', null)
      .lte('programada_para', new Date().toISOString()).limit(5);
    for (const d of (dueDif ?? []) as any[]) {
      const { data: mia } = await this.db.from('responde_difusiones')
        .update({ despachada_en: new Date().toISOString() })
        .eq('id', d.id).is('despachada_en', null).select('id');
      if (mia?.length) {
        this.log.log(`difusión programada ${d.id}: hora cumplida, despachando`);
        this.despacharDifusion(d.id).catch((e) => this.log.warn(`difusión ${d.id}: ${e?.message ?? e}`));
      }
    }
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
  async crearDifusion(dto: { linea?: string; titulo?: string; texto: string; imagenUrl?: string; telefonos: string[]; usuarioId?: string; programadaPara?: string }) {
    const tels = Array.from(new Set((dto.telefonos ?? []).map((t) => String(t).replace(/\D/g, '')).filter((t) => t.length >= 10)));
    if (!tels.length) throw new BadRequestException('No hay destinatarios');
    // Tope de tanda: WhatsApp corta números que disparan masivo. Las campañas
    // grandes salen en tandas de hasta 300 por día — la pantalla filtra "sin
    // difusiones previas", así la tanda de mañana trae a los siguientes.
    if (tels.length > 300) {
      throw new BadRequestException(
        `Son ${tels.length} destinatarios y el tope por tanda es 300 (cuida que WhatsApp no bloquee la línea). Mandá esta tanda con los primeros 300 y repetí mañana: el filtro "sin difusiones previas" te trae a los que faltan.`,
      );
    }
    if (!dto.texto?.trim() && !dto.imagenUrl) throw new BadRequestException('La difusión está vacía');
    // programada: queda visible en la pantalla y el cron la despacha a su hora
    const programada = dto.programadaPara ? new Date(dto.programadaPara) : null;
    if (programada && isNaN(programada.getTime())) throw new BadRequestException('La fecha programada no se entiende');
    const esFutura = !!programada && programada.getTime() > Date.now() + 60_000;

    const { data: d, error } = await this.db.from('responde_difusiones').insert({
      linea: dto.linea === 'proveedores' ? 'proveedores' : 'pedidos', titulo: dto.titulo ?? null,
      texto: dto.texto ?? '', imagen_url: dto.imagenUrl ?? null, creado_por: dto.usuarioId ?? null, total: tels.length,
      programada_para: esFutura ? programada!.toISOString() : null,
      despachada_en: esFutura ? null : new Date().toISOString(),
    }).select('id').single();
    if (error) throw new BadRequestException(error.message);
    await this.db.from('responde_difusiones_destinatarios').insert(tels.map((t) => ({ difusion_id: d.id, telefono: t })));
    if (esFutura) return { difusionId: d.id, total: tels.length, programadaPara: programada!.toISOString() };
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
      // pausa entre envíos, como una persona: 2-4 s en tandas chicas; en
      // tandas grandes (contactos fríos) 8-15 s — la línea vale más que la prisa
      const grande = ((dest ?? []) as any[]).length > 50;
      await new Promise((r) => setTimeout(r, grande ? 8000 + Math.random() * 7000 : 2000 + Math.random() * 2000));
    }
    await this.db.from('responde_difusiones').update({ terminada_en: new Date().toISOString() }).eq('id', id);
  }

  // Listas de difusión guardadas (General ODB, zonas, Degustación): la
  // pantalla las ofrece como punto de partida para armar cada tanda.
  async listasDifusion() {
    const { data: listas, error } = await this.db.from('responde_listas').select('id, nombre, descripcion').order('nombre');
    if (error) throw new BadRequestException(error.message);
    const salida = [] as any[];
    for (const l of (listas ?? []) as any[]) {
      const { count } = await this.db.from('responde_listas_miembros').select('telefono', { count: 'exact', head: true }).eq('lista_id', l.id);
      salida.push({ ...l, miembros: count ?? 0 });
    }
    return salida;
  }

  // Los teléfonos de una lista, en formato WhatsApp (549...). Paginado: el
  // tope silencioso de 1.000 filas dejaría media lista afuera.
  async listaTelefonos(id: string) {
    const tels: string[] = [];
    for (let desde = 0; ; desde += 1000) {
      const { data, error } = await this.db.from('responde_listas_miembros').select('telefono').eq('lista_id', id).range(desde, desde + 999);
      if (error) throw new BadRequestException(error.message);
      for (const m of (data ?? []) as any[]) {
        const d = String(m.telefono).replace(/\D/g, '');
        tels.push(d.startsWith('549') ? d : '549' + d);
      }
      if (!data || data.length < 1000) break;
    }
    return { telefonos: tels };
  }

  // Una programada se puede cancelar mientras no haya salido
  async cancelarDifusion(id: string) {
    const { data, error } = await this.db.from('responde_difusiones')
      .delete().eq('id', id).is('despachada_en', null).select('id');
    if (error) throw new BadRequestException(error.message);
    if (!data?.length) throw new BadRequestException('Esa difusión ya salió o no existe: no se puede cancelar');
    return { cancelada: true };
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
      .update({ bot_activo: true, resuelta_en: new Date().toISOString(), atendida_por: usuarioId ?? null, derivacion_vence_en: null })
      .eq('linea', linea)
      .eq('telefono', telefono);
    if (error) throw new BadRequestException(error.message);
    // RESPONDE queda igual: si no, al próximo mensaje la volvería a pausar
    const waId = telefono.replace(/\D/g, '').length >= 14 ? `${telefono.replace(/\D/g, '')}@lid` : telefono.replace(/\D/g, '');
    await this.respondeRpc('odb_reactivar_contacto', { p_whatsapp_id: waId });
    await this.limpiarEspera(linea, String(telefono).replace(/\D/g, ''));
    // reactivar desde el panel también saca el silencio del contacto
    const { data: k } = await this.db.from('bot_contactos').select('etiquetas').eq('telefono', String(telefono).replace(/\D/g, '')).maybeSingle();
    if (esSilenciado((k as any)?.etiquetas)) {
      await this.db.from('bot_contactos').update({ etiquetas: ((k as any).etiquetas as string[]).filter((e) => e !== 'silenciado') }).eq('telefono', String(telefono).replace(/\D/g, ''));
    }
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
    const reales = new Map<string, string>();
    const agenda = new Map<string, string>();
    const equipo = new Set<string>();
    if (telefonos.length) {
      const { data: cts } = await this.db.from('bot_contactos').select('telefono, telefono_real, nombre_wa, es_equipo').in('telefono', telefonos);
      for (const c of (cts ?? []) as any[]) {
        if (c.telefono_real) reales.set(String(c.telefono), String(c.telefono_real));
        if (c.nombre_wa) agenda.set(String(c.telefono), c.nombre_wa);
        if (c.es_equipo) equipo.add(String(c.telefono));
      }
      const claves = [...new Set([...telefonos, ...reales.values()])];
      const { data: cls } = await this.db.from('clientes').select('telefono, nombre').in('telefono', claves);
      const porTel = new Map<string, string>();
      for (const c of (cls ?? []) as any[]) if (c.nombre) porTel.set(String(c.telefono), c.nombre);
      for (const t of telefonos) {
        const n = porTel.get(String(t)) ?? (reales.get(String(t)) ? porTel.get(reales.get(String(t))!) : undefined) ?? agenda.get(String(t));
        if (n) nombres.set(String(t), n);
      }
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
        telefonoReal: reales.get(String(c.telefono)) ?? (/^549\d{10}$/.test(String(c.telefono)) ? String(c.telefono) : null),
        esEquipo: equipo.has(String(c.telefono)),
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
  }, telefono?: string) {
    // La cava tiene ~2.300 etiquetas y Supabase corta en 1.000 filas por consulta:
    // sin paginar, el bot veía la mitad de la cava y decía "no tenemos" de vinos
    // que estaban en góndola (visto en la auditoría con un Gualtallary a $18.330).
    const data: any[] = [];
    for (let desde = 0; ; desde += 1000) {
      const { data: pagina, error } = await this.db
        .from('productos')
        .select('id, sku, nombre, descripcion, alias_busqueda, unidades_pack, vendido_por_peso, categoria:categorias!inner(nombre), stock(cantidad, sucursal:sucursales(nombre))')
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
        unidades_pack: p.unidades_pack,
        vendido_por_peso: p.vendido_por_peso,
        descripcion: p.descripcion ?? null,
        alias: p.alias_busqueda ?? null,
        categoria: p.categoria?.nombre ?? '',
        stockTotal: (p.stock ?? []).reduce((s: number, r: any) => s + Number(r.cantidad), 0),
        // en qué sucursal hay: el bot tiene que poder decirlo sin inventar
        sucursales: (p.stock ?? []).filter((r: any) => Number(r.cantidad) > 0).map((r: any) => `${(r.sucursal?.nombre ?? '').replace(/^Suc /, '')} (${Number(r.cantidad)})`).join(', '),
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
    const precios = await this.preciosDelCliente(vinos.map((p) => p.id), telefono);
    const precioPor = new Map<string, any>((precios ?? []).map((r: any) => [r.producto_id, r]));

    const min = Number(f.precioMin ?? 0);
    const max = Number(f.precioMax ?? Infinity);
    const filtrados = vinos
      .map((p) => {
        const pr = precioPor.get(p.id);
        const precio = Number(pr?.precio_final ?? 0);
        const desc = String(p.descripcion ?? '').replace(/\s+/g, ' ').trim();
        return this.sinNulos({
          sku: p.sku,
          nombre: p.nombre,
          categoria: p.categoria,
          ...presentacionProducto(p),
          // la ficha, recortada: es lo único que el bot puede afirmar del vino
          ficha: desc ? (desc.length > 220 ? desc.slice(0, 217) + '…' : desc) : null,
          precio,
          precioEfectivo: precio > 0 && tieneDescuentoEfectivo(p.categoria) ? conDescuentoEfectivo(precio) : null,
          promo: pr?.descuento_nombre ? `${pr.descuento_nombre} (antes $${Math.round(pr.precio_lista)})` : null,
          disponible: true,
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
