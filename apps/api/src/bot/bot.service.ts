import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { SUPABASE } from '../supabase.provider';
import { PedidosService } from '../pedidos/pedidos.service';
import { CatalogoService } from '../catalogo/catalogo.service';
import { ListasService } from '../listas/listas.service';
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
const maxRenglonesBot = () => Number(process.env.ODB_BOT_MAX_RENGLONES ?? 15);
const maxUnidadesBot = () => Number(process.env.ODB_BOT_MAX_UNIDADES ?? 60);

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
  ) {}

  // --- El agente conversacional (cerebro de las dos líneas) ---
  //
  // n8n solo transporta: WhatsApp → POST /bot/charla → respuesta → WhatsApp.
  // Acá corre Opus con razonamiento adaptativo y el loop de herramientas,
  // con memoria por (línea, teléfono) persistida en bot_conversaciones.
  async charla(dto: {
    linea: 'pedidos' | 'proveedores';
    telefono: string;
    mensaje?: string;
    mensajeId?: string;
    archivoBase64?: string;
    mimeType?: string;
  }) {
    const linea = dto.linea === 'proveedores' ? 'proveedores' : 'pedidos';
    const telefono = (dto.telefono ?? '').replace(/\D/g, '');
    if (!telefono) throw new BadRequestException('Falta el teléfono');
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new BadRequestException('El bot necesita ANTHROPIC_API_KEY en apps/api/.env');
    }

    // límite por teléfono/hora: si se pasa, respuesta fija SIN gastar Opus
    if (this.superaLimite(telefono)) {
      return {
        respuesta:
          'Recibí muchos mensajes tuyos en la última hora y prefiero que te atienda una persona. En breve te contacta alguien del equipo. ¡Gracias por la paciencia!',
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
    } finally {
      if (this.colas.get(clave) === actual) this.colas.delete(clave);
    }
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
    dto: { mensaje?: string; mensajeId?: string; archivoBase64?: string; mimeType?: string },
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
    if (dto.archivoBase64) {
      if (linea === 'proveedores') {
        try {
          const r = await this.recibirFactura({ telefono, archivoBase64: dto.archivoBase64, mimeType: dto.mimeType ?? 'image/jpeg' });
          texto += `\n[El proveedor envió un comprobante. El sistema lo procesó y quedó en la cola de revisión: proveedor "${r.proveedor}"${r.proveedorEnSistema ? '' : ' (NO reconocido en el sistema)'}, comprobante ${r.comprobante ?? 'sin número'}, total $${r.total ?? '?'}, ${r.renglones} renglones (${r.conMatch} matcheados).]`;
        } catch (e) {
          texto += `\n[El proveedor envió un archivo pero el sistema no pudo procesarlo: ${e instanceof Error ? e.message : 'error'}. Pedile que reenvíe la foto más nítida o el PDF.]`;
        }
      } else {
        texto += '\n[El cliente envió una imagen; este canal no procesa imágenes de clientes: pedile que lo escriba.]';
      }
    }
    if (!texto) throw new BadRequestException('Mensaje vacío');

    // 2) memoria de conversación (solo texto plano user/assistant, sin bloques internos)
    const { data: conv } = await this.db
      .from('bot_conversaciones')
      .select('mensajes')
      .eq('linea', linea)
      .eq('telefono', telefono)
      .maybeSingle();
    const historial: { role: 'user' | 'assistant'; content: string }[] = Array.isArray(conv?.mensajes) ? conv!.mensajes : [];

    const messages: Anthropic.MessageParam[] = [
      ...historial,
      { role: 'user', content: `${texto}\n\n[metadatos: telefono del chat = ${telefono}]` },
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

    let respuesta = '';
    let tokens = 0; // costo del mensaje (entrada+salida, todas las vueltas)
    for (let vuelta = 0; vuelta < MAX_VUELTAS; vuelta++) {
      const r = await this.claude.messages.create({
        model: MODELO_BOT,
        max_tokens: 4096,
        thinking: { type: 'adaptive' },
        system,
        tools: tools.length ? tools : undefined,
        messages,
      });
      tokens +=
        (r.usage?.input_tokens ?? 0) +
        (r.usage?.output_tokens ?? 0) +
        (r.usage?.cache_creation_input_tokens ?? 0) +
        (r.usage?.cache_read_input_tokens ?? 0);

      if (r.stop_reason === 'tool_use') {
        // ejecutar TODAS las herramientas pedidas y devolver los resultados juntos.
        // Si el modelo pide la MISMA herramienta con los MISMOS argumentos varias
        // veces en un turno (tool use paralelo degenerado), se ejecuta UNA sola
        // vez y se reusa el resultado: sin esto, un crear_pedido quintuplicado
        // creó 5 pedidos reales idénticos (visto en producción el 2026-07-21).
        messages.push({ role: 'assistant', content: r.content });
        const resultados: Anthropic.ToolResultBlockParam[] = [];
        const vistos = new Map<string, Anthropic.ToolResultBlockParam>();
        for (const block of r.content) {
          if (block.type !== 'tool_use') continue;
          const clave = `${block.name}:${JSON.stringify(block.input)}`;
          const previo = vistos.get(clave);
          if (previo) {
            this.log.warn(`Herramienta ${block.name} duplicada en el mismo turno: reuso el resultado`);
            resultados.push({ ...previo, tool_use_id: block.id });
            continue;
          }
          const res = await this.ejecutarHerramienta(block, telefono);
          vistos.set(clave, res);
          resultados.push(res);
        }
        messages.push({ role: 'user', content: resultados });
        continue;
      }

      respuesta = r.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim();
      break;
    }
    if (!respuesta) {
      respuesta = 'Perdoname, me trabé procesando tu mensaje. ¿Me lo repetís?';
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
    this.log.log(`charla ${linea}/${telefono}: ${tokens} tokens`);

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
  private async ejecutarHerramienta(block: Anthropic.ToolUseBlock, telefono: string): Promise<Anthropic.ToolResultBlockParam> {
    const input: any = block.input;
    try {
      let out: unknown;
      switch (block.name) {
        case 'identificar_cliente':
          out = await this.identificarCliente(telefono);
          break;
        case 'buscar_productos':
          out = await this.buscarProductos(String(input.q ?? ''));
          break;
        case 'crear_pedido':
          out = await this.crearPedido({
            telefono,
            nombre: input.nombre ? String(input.nombre) : undefined,
            tipo: input.tipo === 'domicilio' ? 'domicilio' : 'pickup',
            items: (input.items ?? []).map((i: any) => ({ sku: String(i.sku), cantidad: Number(i.cantidad) })),
            direccion: input.direccion ? String(input.direccion) : undefined,
          });
          break;
        case 'estado_pedido':
          out = await this.estadoPedido(String(input.id ?? ''));
          break;
        case 'consultar_cava':
          out = await this.consultarCava({
            tipo: input.tipo ? String(input.tipo) : undefined,
            cepa: input.cepa ? String(input.cepa) : undefined,
            precioMin: input.precioMin != null ? Number(input.precioMin) : undefined,
            precioMax: input.precioMax != null ? Number(input.precioMax) : undefined,
            buscar: input.buscar ? String(input.buscar) : undefined,
          });
          break;
        default:
          throw new Error(`Herramienta desconocida: ${block.name}`);
      }
      return { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(out) };
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'error';
      this.log.warn(`Herramienta ${block.name} falló: ${msg}`);
      return { type: 'tool_result', tool_use_id: block.id, content: `Error: ${msg}`, is_error: true };
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
  async buscarProductos(q: string) {
    const t = (q ?? '').trim();
    if (t.length < 2) return { items: [] };
    const [{ items: stock }, may] = await Promise.all([
      this.catalogo.consultarStock(t),
      this.catalogo.posBuscar(t),
    ]);
    const precioPorSku = new Map(
      (may.items ?? []).map((p: any) => [p.sku, { precio: p.precio, precioMayorista: p.precioMayorista, esAlcohol: p.esAlcohol }]),
    );
    return {
      items: stock.map((p: any) => {
        const pr = precioPorSku.get(p.sku) ?? {};
        return {
          sku: p.sku,
          nombre: p.nombre,
          precio: (pr as any).precio ?? null,
          precioMayorista: (pr as any).precioMayorista ?? null,
          esAlcohol: (pr as any).esAlcohol ?? false,
          stockTotal: p.total,
          disponible: p.total > 0,
          sucursales: p.sucursales,
        };
      }),
    };
  }

  // Crea el pedido en el sistema (mismo pipeline que web/app: entra como 'recibido'
  // y el depósito lo prepara). Identifica/crea al cliente por su teléfono.
  async crearPedido(dto: {
    telefono: string;
    nombre?: string;
    tipo?: 'pickup' | 'domicilio';
    items: { sku: string; cantidad: number }[];
    direccion?: string;
    notas?: string;
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

    // resumen legible para que el bot lo repita por WhatsApp
    const p: any = pedido;
    const resumen = (p.items ?? [])
      .map((i: any) => `${i.cantidad}x ${i.producto?.nombre ?? i.nombre ?? ''}`.trim())
      .join(', ');
    return {
      pedidoId: p.id,
      estado: p.estado,
      total: Number(p.total),
      codigoRetiro: p.qr_retiro ?? null,
      resumen,
      canal: p.canal,
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
  async borrarConversacion(linea: 'pedidos' | 'proveedores', telefono: string) {
    const tel = (telefono ?? '').replace(/\D/g, '');
    if (!tel) throw new BadRequestException('Falta el teléfono');
    await this.db.from('bot_conversaciones').delete().eq('linea', linea).eq('telefono', tel);
    return { ok: true };
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
    const { data, error } = await this.db
      .from('productos')
      .select('id, sku, nombre, categoria:categorias!inner(nombre), stock(cantidad)')
      .eq('activo', true)
      .or('nombre.ilike.vino%,nombre.ilike.espumante%,nombre.ilike.champagne%', {
        referencedTable: 'categoria',
      });
    if (error) throw new BadRequestException(error.message);

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
        categoria: p.categoria?.nombre ?? '',
        stockTotal: (p.stock ?? []).reduce((s: number, r: any) => s + Number(r.cantidad), 0),
      }))
      .filter((p) => p.stockTotal > 0);

    if (filtroTipo[tipo]) vinos = vinos.filter((p) => filtroTipo[tipo](norm(p.categoria)));
    if (f.cepa) {
      const cepa = norm(f.cepa);
      vinos = vinos.filter((p) => norm(p.categoria).includes(cepa) || norm(p.nombre).includes(cepa));
    }
    if (f.buscar) {
      const q = norm(f.buscar);
      vinos = vinos.filter((p) => norm(p.nombre).includes(q));
    }
    if (!vinos.length) return { items: [], nota: 'No hay etiquetas con stock para ese filtro; probá aflojando cepa o tipo.' };

    // precios reales (con promos vigentes) en un solo viaje
    const { data: precios } = await this.db.rpc('catalogo_precios', {
      p_ids: vinos.map((p) => p.id),
    });
    const precioPor = new Map<string, any>((precios ?? []).map((r: any) => [r.producto_id, r]));

    const min = Number(f.precioMin ?? 0);
    const max = Number(f.precioMax ?? Infinity);
    const items = vinos
      .map((p) => {
        const pr = precioPor.get(p.id);
        const precio = Math.round(Number(pr?.precio_final ?? 0));
        return {
          sku: p.sku,
          nombre: p.nombre,
          categoria: p.categoria,
          precio,
          promo: pr?.descuento_nombre ? `${pr.descuento_nombre} (antes $${Math.round(pr.precio_lista)})` : null,
          stock: Math.round(p.stockTotal),
        };
      })
      .filter((p) => p.precio > 0 && p.precio >= min && p.precio <= max)
      // de mayor a menor: lo mejor del presupuesto arriba
      .sort((a, b) => b.precio - a.precio)
      .slice(0, 25);

    return { items, total_en_cava_para_el_filtro: items.length };
  }

  async estadoPedido(id: string) {
    const p: any = await this.pedidos.obtener(id).catch(() => null);
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
      mensaje: `Recibí tu factura ${e.comprobante?.numero ?? ''} por $${Math.round(Number(e.impuestos?.total ?? 0)).toLocaleString('es-AR')}. Queda registrada y la revisamos. ¡Gracias!`,
    };
  }
}
