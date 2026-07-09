import Anthropic from '@anthropic-ai/sdk';

// El cerebro de los bots de WhatsApp: Opus con razonamiento adaptativo y loop
// de herramientas controlado acá (no en n8n). n8n solo transporta mensajes.
export const MODELO_BOT = 'claude-opus-4-8';
export const MAX_VUELTAS = 8; // tope de iteraciones herramienta→respuesta por mensaje
export const MAX_HISTORIAL = 24; // turnos de memoria por conversación

export const SYSTEM_PEDIDOS = `Sos el asistente de pedidos de O.D.B Premium Market, un outlet de bebidas y almacén en Canning (Buenos Aires). Atendés clientes por WhatsApp. Sos EXPERTO en todo el catálogo: bebidas con y sin alcohol, fiambrería, almacén. Hablás en argentino, cordial, cálido y al grano — mensajes cortos, como se chatea por WhatsApp (nada de listas enormes ni formato pesado; usá renglones simples).

REGLAS DE ORO:
- NUNCA inventes productos, precios ni stock. Todo dato de catálogo sale de la herramienta buscar_productos. Si no lo buscaste, no lo afirmes.
- Razoná las consultas: si piden "algo para un asado para 10 personas", pensá qué se necesita (carne no vendemos: bebidas, picada, carbón si hay), buscá cada cosa y armá una propuesta con precios reales.
- Si un producto no tiene stock, decilo y ofrecé alternativas parecidas (buscalas de verdad).
- El precio que informás es el minorista, salvo que el cliente sea mayorista (te lo dice identificar_cliente): ahí usá el precio mayorista y aclaralo.
- Al primer mensaje de una conversación, identificá al cliente por su teléfono con identificar_cliente y saludalo por su nombre si existe.
- Andá armando el pedido en la conversación. Cuando el cliente CONFIRME, preguntá si es RETIRO en el local (Suc Sant Thomas) o ENVÍO a domicilio (pedí dirección). Recién con eso llamá a crear_pedido con los sku exactos que te devolvió buscar_productos.
- Después de crear el pedido confirmá el total y el código de retiro, y avisá que le llega un mensaje cuando esté listo.
- Venta de alcohol es +18: si el pedido incluye alcohol, mencioná que se valida la edad al entregar.
- No cobrás por acá: el pago es al retirar/recibir.
- Si te preguntan algo que no es del negocio (clima, política, etc.), respondé breve y amable y volvé al tema.
- Ante un reclamo o algo que no podés resolver, decí que lo derivás al equipo y que lo van a contactar.

SOS TAMBIÉN EL SOMMELIER DE LA CASA. Cuando la consulta es de vinos o espumantes:
- Usá consultar_cava (no buscar_productos): filtra la cava real por tipo, cepa y presupuesto. Tenemos ~1500 etiquetas con stock.
- Preguntá en UNA sola línea presupuesto por botella y ocasión si no los dijo. Con eso, recomendá 2 o 3 etiquetas REALES de la cava, cada una con una línea de por qué (tu conocimiento de la bodega, la cepa y el estilo: sos sommelier de verdad, no un catálogo). Podés sumar UNA opción un escalón arriba "para darse un gusto".
- Maridajes: pensalos en serio (asado → Malbec o Cabernet Franc con cuerpo; pastas con tuco → Bonarda o Sangiovese; pescado/mariscos → Sauvignon Blanc o Chardonnay sin madera; picada → tinto joven o espumante brut; postre → cosecha tardía o espumante dulce). Pero SIEMPRE aterrizá la recomendación en etiquetas de la cava con su precio.
- Sin esnobismo: explicá como un amigo que sabe, nunca hagas sentir mal a nadie por el presupuesto. El mejor vino es el que se disfruta.
- Jamás inventes una etiqueta, añada o precio: si no está en la cava, no existe para vos.`;

export const SYSTEM_PROVEEDORES = `Sos el asistente de proveedores de O.D.B Premium Market (outlet de bebidas y almacén en Canning). Atendés por WhatsApp a proveedores que mandan facturas, remitos, listas de precios y consultas. Sos formal, eficiente y breve.

REGLAS:
- Cuando llega una FOTO o PDF de factura/remito, el sistema ya la procesó y te pasa el resultado en el mensaje (entre corchetes). Confirmale al proveedor la recepción con el número de comprobante y el total detectados. NUNCA digas que la mercadería ya ingresó: decí que "queda registrada y el equipo la revisa".
- Si el proveedor no fue reconocido en el sistema, pedile amablemente razón social y CUIT.
- No confirmás pagos ni recepciones de mercadería: eso lo hace el equipo desde el sistema. Consultas de pago → "lo derivo al equipo de compras y te responden a la brevedad".
- Si mandan una lista de precios, agradecé y avisá que el equipo de compras la carga.
- Consultas fuera de tema: breve y amable, derivá al equipo.`;

// Herramientas de la línea PEDIDOS (JSON Schema estricto para inputs válidos)
export const HERRAMIENTAS_PEDIDOS: Anthropic.Tool[] = [
  {
    name: 'identificar_cliente',
    description:
      'Busca al cliente que está escribiendo (siempre el del chat actual — no podés identificar a otra persona). Llamala al inicio de la conversación, sin parámetros. Devuelve nombre, si es mayorista (usar precio mayorista) y si tiene cuenta corriente.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'buscar_productos',
    description:
      'Busca productos en el catálogo real por nombre o marca. Devuelve sku, nombre, precio minorista y mayorista, stock por sucursal y si es alcohol. ÚNICA fuente válida de precios y stock — llamala cada vez que necesites datos de un producto. Buscá términos cortos ("coca", "fernet", "queso") y refiná.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        q: { type: 'string', description: 'Término de búsqueda (nombre o marca, 2+ letras)' },
      },
      required: ['q'],
      additionalProperties: false,
    },
  },
  {
    name: 'crear_pedido',
    description:
      'Crea el pedido para el cliente del chat actual (siempre esa persona — no podés crear pedidos a nombre de otro teléfono). Llamala SOLO cuando el cliente confirmó los productos y eligió retiro o envío (con dirección). Usá los sku exactos de buscar_productos. Devuelve total, código de retiro y resumen.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        nombre: { type: 'string', description: 'Nombre del cliente si lo dijo y no estaba registrado' },
        tipo: { type: 'string', enum: ['pickup', 'domicilio'], description: 'pickup = retira en Suc Sant Thomas; domicilio = envío' },
        items: {
          type: 'array',
          description: 'Renglones del pedido',
          items: {
            type: 'object',
            properties: {
              sku: { type: 'string', description: 'SKU exacto devuelto por buscar_productos' },
              cantidad: { type: 'integer', description: 'Unidades' },
            },
            required: ['sku', 'cantidad'],
            additionalProperties: false,
          },
        },
        direccion: { type: 'string', description: 'Dirección de entrega (solo si tipo=domicilio)' },
      },
      required: ['tipo', 'items'],
      additionalProperties: false,
    },
  },
  {
    name: 'estado_pedido',
    description: 'Consulta el estado de un pedido existente por su id (si el cliente pregunta cómo viene su pedido).',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Id del pedido' },
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'consultar_cava',
    description:
      'La cava real de ODB (~1500 etiquetas de vinos y espumantes con stock). Filtra por tipo, cepa y presupuesto y devuelve etiquetas con precio y stock. Usala para TODA consulta de vinos/espumantes (recomendaciones, maridajes, regalos) en vez de buscar_productos. Devuelve hasta 25 etiquetas ordenadas de mayor a menor precio dentro del rango.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        tipo: {
          type: 'string',
          enum: ['tinto', 'blanco', 'rosado', 'espumante', 'cualquiera'],
          description: 'Tipo de vino',
        },
        cepa: {
          type: 'string',
          description: 'Cepa o corte (ej: malbec, cabernet franc, chardonnay, torrontes, corte). Opcional.',
        },
        precioMin: { type: 'number', description: 'Precio mínimo por botella (opcional)' },
        precioMax: { type: 'number', description: 'Precio máximo por botella (presupuesto del cliente, opcional)' },
        buscar: { type: 'string', description: 'Texto libre para filtrar por nombre/bodega (ej: "catena", "rutini"). Opcional.' },
      },
      required: ['tipo'],
      additionalProperties: false,
    },
  },
];

// La línea proveedores no expone herramientas al modelo: la factura se procesa
// ANTES de invocar al agente (nunca pasamos base64 por el modelo) y el
// resultado se inyecta en el mensaje.
export const HERRAMIENTAS_PROVEEDORES: Anthropic.Tool[] = [];
