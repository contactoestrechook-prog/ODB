// Las pantallas que el manual escrito no explicaba (26/11/2026), una sección
// por pantalla del menú. Mismas reglas que contenido.ts: cada paso es algo que
// la pantalla hace hoy, con los nombres de botones tal como se ven.
import type { Seccion } from './contenido';

export const SECCIONES_PANTALLAS: Seccion[] = [
  // ------------------------------------------------------------- empezar
  {
    id: 'inicio',
    titulo: 'Inicio: el negocio de un vistazo',
    area: 'Para empezar',
    roles: ['dueno', 'gerente'],
    pantallas: ['/inicio'],
    bajada: 'Lo primero que ves al entrar: cómo viene el día y los accesos a cada área.',
    bloques: [
      {
        tipo: 'texto',
        texto:
          'Arriba, «Centro de operación» con cuatro cifras de hoy: «Facturado hoy», «Ventas» (cantidad de tickets), «Por cobrar» (lo que deben las cuentas corrientes) y «Quiebres» (productos sin stock, en naranja si hay). Cada cifra se toca y abre su detalle. Abajo, los accesos por área: Operación, Catálogo y abastecimiento, Clientes y administración y Dirección. El número rojo en un acceso es algo que espera (pedidos activos, órdenes sin firmar).',
      },
      {
        tipo: 'pasos',
        titulo: 'Buscar cualquier cosa sin saber dónde está',
        pasos: [
          'Arriba de todo está el buscador: «Buscar producto, cliente o comprobante».',
          'Escribí un nombre, un DNI, un código de barras o un número de comprobante.',
          'Te muestra lo que encontró separado en Productos, Clientes y Comprobantes. Tocá el que buscás y te lleva a su pantalla.',
        ],
      },
      {
        tipo: 'ojo',
        puntos: [
          'Cada uno ve solo los accesos de las pantallas que su rol puede abrir.',
          '«Sueldos», «Fondos de caja» y «Horarios» aparecen apagados: todavía no existen en el sistema. Para la plata del dueño está la Caja del dueño.',
          'Si aparece «No pude consultar la API», las cifras pueden no ser reales: revisá la conexión o volvé a entrar.',
          'La campanita de avisos y «Avisos en el celular» están explicados en «Entrar al sistema y tenerlo a mano».',
        ],
      },
    ],
  },

  // ---------------------------------------------------------- salón y caja
  {
    id: 'ventas',
    titulo: 'Ventas: los tickets del día',
    area: 'Salón y caja',
    roles: ['dueno', 'gerente', 'cajero'],
    pantallas: ['/ventas'],
    bajada: 'Lo que se vendió en las cajas del sistema, por sucursal y por medio de pago.',
    bloques: [
      {
        tipo: 'texto',
        texto:
          'Arriba, «Facturado hoy», «Tickets», «Ticket promedio» y «Descuentos». Las tarjetas de sucursal y de medio de pago (Efectivo, Mercado Pago, Tarjeta, Cuenta corriente) se tocan para filtrar: la elegida queda con borde rojo. Las pestañas son «Del día», «Por sucursal», «Medios de pago», «Anuladas» y «Buscar ticket».',
      },
      {
        tipo: 'pasos',
        titulo: 'Para encontrar un ticket',
        pasos: [
          'Andá a la pestaña «Buscar ticket».',
          'Escribí el número de ticket, el DNI o el nombre del cliente y tocá «Buscar».',
          'Si a esa venta le falta la factura, tocá «Facturar»: te lleva a Facturación con la venta y el total cargados.',
        ],
      },
      {
        tipo: 'ojo',
        puntos: [
          'Acá están solo las ventas que se cobraron con la Caja del sistema. Lo que los locales venden con el sistema anterior (el Crack) se ve en Facturación, que junta las dos cosas.',
          'Una venta anulada aparece apagada y con «anulada · NC»: la nota de crédito ya está hecha.',
        ],
      },
    ],
  },
  {
    id: 'presupuestos',
    titulo: 'Presupuestos para el cliente, por WhatsApp',
    area: 'Salón y caja',
    roles: ['dueno', 'gerente', 'cajero', 'deposito', 'administrativo', 'comprador', 'op_salon', 'fiambreria'],
    pantallas: ['/presupuestos'],
    bajada: 'Cuando alguien llama y quiere saber cuánto le sale lo que necesita: se le arma y se le manda.',
    bloques: [
      {
        tipo: 'texto',
        texto:
          'Lo puede armar cualquiera del local. Lleva el precio de lista y el stock de cada producto, y el precio vale 48 horas. Las pestañas: «Abiertos», «Pasaron a pedido», «Vencidos o anulados» y «Todos». Cada presupuesto dice su estado: «Sin mandar», «Mandado», «Pasó a pedido», «Vencido» o «Anulado».',
      },
      {
        tipo: 'pasos',
        titulo: 'Para armar uno',
        pasos: [
          'Tocá «Nuevo presupuesto».',
          'Poné el «Celular del cliente» y su «Nombre», y de qué local «Sale de».',
          'Buscá lo que pide (por nombre o código): cada producto que tocás se suma con su precio y su stock. Ajustá las cantidades.',
          'Si querés, escribí una «Nota (va en el PDF)».',
          'Tocá «Mandar por WhatsApp»: al cliente le llega la tarjeta roja con el detalle y el PDF.',
        ],
      },
      {
        tipo: 'pasos',
        titulo: 'Si el cliente dice que sí',
        pasos: [
          'Abrí el presupuesto y tocá «Pasar a pedido».',
          'Elegí «Lo retira en el local» o «Envío a domicilio» (con la «Dirección de entrega»), «Cómo paga» y, si hace falta, «Algo más para quien lo arma».',
          'Confirmá: entra como pedido nuevo, sin tomar, con el stock reservado, y suena en las cajas como cualquier otro.',
        ],
      },
      {
        tipo: 'ojo',
        puntos: [
          'Pasadas las 48 horas queda «Vencido». Si lo mandás de nuevo («Mandar de nuevo»), sale con los precios de hoy y vale 48 horas más.',
          'Si algún precio cambió entre el presupuesto y el pedido, queda escrito en las notas del pedido.',
          '«Anular» lo deja en la lista como anulado; al cliente no le llega nada. «PDF» baja el mismo documento que recibe el cliente.',
        ],
      },
    ],
  },
  {
    id: 'salida',
    titulo: 'Control de salida (Comprá Fácil)',
    area: 'Salón y caja',
    roles: ['cajero', 'gerente', 'dueno'],
    pantallas: ['/salida'],
    bajada: 'Verificar en la puerta que lo que lleva el cliente es lo que pagó.',
    bloques: [
      {
        tipo: 'pasos',
        pasos: [
          'El cliente muestra su código de salida (empieza con CF-).',
          'Escribilo en «Código de salida» y tocá «Buscar».',
          'Mirá el resumen: los productos y el total pagado. Compará con lo que lleva en la bolsa.',
          'Si coincide, tocá «Validar salida».',
        ],
      },
      {
        tipo: 'ojo',
        puntos: [
          'Si dice «YA VALIDADA — posible doble salida», ese código ya se usó: no lo dejes pasar sin revisar.',
          '«Código inexistente» quiere decir que no hay ninguna compra con ese código.',
        ],
      },
    ],
  },
  {
    id: 'sommelier',
    titulo: 'Somelier ODB: qué vino recomendar',
    area: 'Salón y caja',
    roles: ['cajero', 'gerente', 'dueno'],
    pantallas: ['/sommelier'],
    bajada: 'Para el vendedor: le contás lo que pide el cliente y te da tres vinos del local, con el porqué.',
    bloques: [
      {
        tipo: 'texto',
        texto:
          'A la izquierda, el somelier; a la derecha, «La cava» del local: cuántos vinos hay, por tipo y por precio, y la lista ordenada para esa ocasión con el stock de los dos locales y el precio en efectivo. Arriba se elige el local del cliente o «Los dos».',
      },
      {
        tipo: 'pasos',
        titulo: 'Para recomendar',
        pasos: [
          'Escribí o dictá lo que pide el cliente, como lo dijo: «un malbec para el asado, hasta 20 mil». Hay ejemplos para tocar.',
          'Los filtros de la cava se prenden solos. Tocá «Que elija el somelier»: te da tres opciones con «Por qué lo eligió», para decírselo al cliente.',
          'Si no convencen, «Otras 3». Si querés ver uno parecido, «Ver parecidos».',
          'Sumá los que le gustan con «Sumar para el cliente» y tocá «Copiar para WhatsApp»: queda listo para pegarlo en la charla.',
          'Para el próximo, «Otro cliente» limpia la charla y los filtros.',
        ],
      },
      {
        tipo: 'ojo',
        puntos: [
          'Solo recomienda lo que hay en stock en el local elegido. Si con los filtros no queda nada, probá sacar alguno o «Ver los dos locales».',
          'También se puede usar sin el somelier: tocá un tipo o un tramo de precio de la cava y ordená por «Para recomendar», «Más baratos», «Más caros» o «Más stock».',
        ],
      },
    ],
  },

  // -------------------------------------------------------------- depósito
  {
    id: 'salon-armado',
    titulo: 'Salón: armar pedidos, lugares y puerta de depósito',
    area: 'Depósito',
    roles: ['op_salon', 'fiambreria', 'deposito', 'cajero', 'gerente', 'dueno'],
    pantallas: ['/salon'],
    bajada: 'La pantalla del que arma en el celular, y la sala de control para el que reparte el trabajo.',
    bloques: [
      {
        tipo: 'texto',
        texto:
          'Tiene tres pestañas: «Armar pedidos», «Stock y ubicación» y «Puerta de depósito». Quien arma (op salón, fiambrería, depósito) ve solo sus pedidos. Dueños, gerentes y la caja que no arma ven la sala de control: «Esperan quién lo arme», «Se están armando» (cada punto es un producto, en el orden en que se camina el salón), «En la mesa de retiro» y «La gente del salón».',
      },
      {
        tipo: 'pasos',
        titulo: 'Para asignar un pedido (sala de control)',
        pasos: [
          'En «Esperan quién lo arme», tocá «Asignar» en el pedido.',
          'Elegí a la persona: le llega al celular y por WhatsApp, y empieza a correr el reloj.',
          'Para cambiarlo después, «Cambiar quién arma». Para seguirlo, «Ver el armado».',
        ],
      },
      {
        tipo: 'pasos',
        titulo: 'Para cargar dónde está cada producto',
        pasos: [
          'Andá a «Stock y ubicación» y elegí una categoría (o buscá un producto).',
          'Si están todos en el mismo lugar, cargalo una vez para toda la categoría.',
          'Si no, escribí el lugar de cada uno y tocá Enter: se guarda y pasa al siguiente.',
        ],
      },
      {
        tipo: 'pasos',
        titulo: 'Cuando baja mercadería por la puerta de depósito',
        pasos: [
          'En «Puerta de depósito», en «Cargar lo que bajó», elegí el «Proveedor», el «N.º de remito» y la «Sucursal».',
          'Escaneá cada bulto (si ya está en la lista, suma uno) o buscalo. Poné el vencimiento si tiene.',
          'Tocá «Mandar a administración». Queda «Espera factura» y todavía no suma al stock.',
        ],
      },
      {
        tipo: 'ojo',
        puntos: [
          'Con los lugares cargados, la lista de armado sale en el orden en que se camina el salón; sin lugar, sale por orden alfabético y el que arma camina de más.',
          'Si a alguien le sacan un pedido que estaba armando, le aparece «Se lo pasaron a otra persona o se canceló: no lo armes».',
          'Si un producto no está en el sistema, la puerta de depósito avisa: «Ese producto no está en el sistema: avisale a administración».',
          'Cómo se arma un pedido paso a paso (lo que falta, los parecidos, la consulta al cliente) está en «Preparar pedidos».',
        ],
      },
    ],
  },
  {
    id: 'traspasos',
    titulo: 'Traspasos entre Sant Thomas y Santa Inés',
    area: 'Depósito',
    roles: ['deposito', 'cajero', 'administrativo', 'gerente', 'dueno'],
    pantallas: ['/traspasos'],
    bajada: 'Pedir mercadería al otro local, mandarla con remito y recibirla contando.',
    bloques: [
      {
        tipo: 'texto',
        texto:
          'Arriba dice en qué local estás («Estás en»). Las pestañas: «Pedir», «Para mandar», «En camino», «Diferencias» e «Historial». Cada traspaso pasa por Pedido → En camino → Recibido (o Con diferencias), y todo queda valorizado al costo.',
      },
      {
        tipo: 'pasos',
        titulo: 'Para pedirle al otro local',
        pasos: [
          'En «Pedir», mirá «¿Qué me conviene pedir?»: lo que a vos te falta y al otro le sobra. «Agregar todos» los suma de una.',
          'O buscá un producto (por nombre o con la pistola) y poné la cantidad.',
          'Elegí a quién («Pedirle a»), escribí una nota si hace falta y mandá el pedido.',
        ],
      },
      {
        tipo: 'pasos',
        titulo: 'Para mandar lo que te pidieron',
        pasos: [
          'En «Para mandar» está lo que te pidieron. Abrilo y preparalo escaneando: cada escaneo suma 1. Si no hay, poné 0 y el otro local ve que no salió.',
          'Elegí «¿Quién lo lleva?» y mandalo. Sale de tu stock y queda «En camino», con remito.',
          'Si querés mandar algo que nadie pidió, «Mandar sin pedido».',
        ],
      },
      {
        tipo: 'pasos',
        titulo: 'Para recibir',
        pasos: [
          'En «En camino», tocá «Recibir».',
          'Si llegó todo como salió, «Llegó todo». Si no, contá lo que llegó y tocá «Recibir con lo contado».',
        ],
      },
      {
        tipo: 'ojo',
        puntos: [
          'Lo que no cierra va a «Diferencias» y lo decide gerencia: «Volvió al origen», «Se perdió: merma» o «Queda así».',
          'Un envío se puede anular: lo que salió vuelve al stock del local que lo mandó. Un pedido que no se va a mandar se cierra con «No lo vamos a mandar».',
        ],
      },
    ],
  },
  {
    id: 'frio',
    titulo: 'Frío: la temperatura de cámaras y heladeras',
    area: 'Depósito',
    roles: ['deposito', 'gerente', 'dueno'],
    pantallas: ['/frio'],
    bajada: 'Cada equipo de frío con su temperatura de ahora, su curva y la planilla para Bromatología.',
    bloques: [
      {
        tipo: 'texto',
        texto:
          'Una fila por equipo, con su lugar, su estado («En rango», «Cerca del límite», «Pasado de temperatura», «Demasiado frío» o «Sin datos»), la temperatura de ahora contra su rango y una curva chica. Los datos los mandan los sensores QBIT, una medición por minuto. Se filtra por equipo, por estado y por período.',
      },
      {
        tipo: 'pasos',
        titulo: 'Para ver un equipo',
        pasos: [
          'Tocá la fila: se abre la curva grande. Pasá el mouse o el dedo para ver cada medición.',
          'Abajo están las salidas de rango (cuándo y cuánto duraron).',
          '«Planilla para Bromatología»: elegí el mes y sale la planilla lista para presentar.',
        ],
      },
      {
        tipo: 'ojo',
        puntos: [
          'Los equipos (nombre, lugar, mínimo y máximo, a quién avisar por WhatsApp) los cambia solo el dueño o un gerente, con «Editar». «＋ Sumar equipo» agrega uno nuevo con su número de QBIT.',
          'Si dice «Los avisos por WhatsApp todavía están apagados», hoy nadie recibe un mensaje cuando un equipo se pasa: hay que mirarlo en la pantalla.',
        ],
      },
    ],
  },

  // -------------------------------------------------------- administración
  {
    id: 'facturacion',
    titulo: 'Facturación: el mes facturado y emitir comprobantes',
    area: 'Administración',
    roles: ['dueno', 'gerente', 'administrativo'],
    pantallas: ['/facturacion'],
    bajada: 'Cuánto se facturó en el mes, cómo pagaron, quién compró, quién debe, y cada comprobante.',
    bloques: [
      {
        tipo: 'texto',
        texto:
          'Junta lo que se factura con el sistema anterior (el Crack, que llega con cada carga de sus archivos) y lo que se emite desde este. Tiene tres vistas: «Resumen del mes», «Comprobantes» y «Cuentas corrientes». Con las flechas cambiás de mes, y arriba elegís «Las dos», «Sant Thomas» o «Santa Inés».',
      },
      {
        tipo: 'campos',
        titulo: 'Qué hay en el resumen',
        filas: [
          ['Las cifras del mes', 'El acumulado contra el mes anterior al mismo día.'],
          ['Facturado por día', 'Una barra por día; tocá un día para ver sus comprobantes. La línea gris es el mismo día del mes anterior.'],
          ['Cómo pagaron y Por tipo de comprobante', 'Lo facturado según el medio de pago y según la letra.'],
          ['Los que más compraron', 'Con su WhatsApp para escribirles de un toque.'],
          ['Por cobrar hoy', 'Lo que se debe, por antigüedad, y los que más deben (en rojo si pasaron el límite).'],
        ],
      },
      {
        tipo: 'pasos',
        titulo: 'Para emitir un comprobante',
        pasos: [
          'Tocá «+ Emitir factura». Para otro tipo, «Otro comprobante»: «Nota de crédito», «Nota de débito», «Recibo de cobranza», «Anticipo» o «Remito».',
          'Elegí el cliente (vacío es Consumidor final) y agregá los productos del catálogo o un «+ renglón libre (sin producto)».',
          'Si es a cuenta del cliente, marcá «A cuenta corriente (queda como deuda del cliente)». Si saca mercadería, dejá marcado «Descontar stock al emitir» y elegí la «Sucursal de salida».',
          'Tocá «Emitir comprobante». La numeración es automática.',
        ],
      },
      {
        tipo: 'ojo',
        puntos: [
          'Si hay ventas de la caja esperando su factura electrónica o facturas rechazadas, aparece una franja «ARCA:» con «Ver en ARCA →».',
          'Al tocar un comprobante ves lo que se llevó; abriéndolo se imprime o se anula.',
          'En «Comprobantes» se filtra por tipo, medio y letra, y «Exportar» baja la lista.',
        ],
      },
    ],
  },
  {
    id: 'facturas-compra-listado',
    titulo: 'Facturas de compra: vencimientos, pagos y anulaciones',
    area: 'Administración',
    roles: ['administrativo', 'comprador', 'gerente', 'dueno'],
    pantallas: ['/facturas-compra'],
    bajada: 'Todas las facturas de proveedores y los gastos: qué se debe, qué vence y qué se pagó.',
    bloques: [
      {
        tipo: 'texto',
        texto:
          'Arriba, «Deuda total», «Vencido», «Vence en 7 días» y «Vence en 30 días». Los estados se eligen en las pestañas: «Todas», «Pendientes», «Parciales», «En pago», «Vencidas», «Pagadas» y «Anuladas». Se filtra por proveedor, por empresa («Las dos empresas», Sant Thomas · CHINVENGUENCHA o Santa Inés · ODB SRL), por tipo y por categoría («Solo mercadería», «Solo gastos» o un gasto puntual). «Mis facturas» deja solo las que cargaste vos y «Exportar CSV» baja la lista.',
      },
      {
        tipo: 'pasos',
        titulo: 'Para cargar un gasto o un comprobante sin mercadería',
        pasos: [
          'Tocá «+ Cargar comprobante». (Las facturas de mercadería se cargan con «Cargar por foto»: ver «Cargar una factura de proveedor».)',
          'Elegí proveedor, empresa y tipo (Factura, Nota de crédito o Nota de débito), con número, fechas y total.',
          'Si no mueve stock, marcá «Es un gasto (no mueve stock)» y elegí la categoría: alquiler, servicios, honorarios, impuestos, fletes, etc. Si ya se pagó, «Ya está pagada».',
          'Tocá «Cargar comprobante».',
        ],
      },
      {
        tipo: 'pasos',
        titulo: 'Para registrar un pago',
        pasos: [
          'Abrí la factura y tocá «Registrar pago».',
          'Poné el monto, el medio de pago y una nota si hace falta. Puede ser un pago parcial: la factura queda «Pago parcial» con su saldo.',
        ],
      },
      {
        tipo: 'ojo',
        puntos: [
          'Registran pagos y anulan directo: gerencia, los dueños y quien tenga ese permiso propio (como Anabella). Los demás tocan «Pedir anulación» o «Pedir el cambio a un dueño», con motivo, y lo aprueba un dueño en «Cambios pendientes».',
          'Corregir los renglones de una factura ya registrada («Corregir en la carga») es de gerencia y dueños; el resto lo pide y queda esperando.',
          'Si la factura está dentro de una orden de pago, los pagos van por ese circuito, no desde acá.',
          'Una factura «Espera nota de crédito · no se paga» está frenada hasta que llegue la nota del proveedor.',
          'En «Conciliación: remitos escaneados vs facturas» se compara lo facturado contra lo que entró por la pistola, renglón por renglón, y se concilia («Conciliar» o «Conciliar con diferencias», que queda para el reclamo).',
        ],
      },
    ],
  },
  {
    id: 'listas-venta',
    titulo: 'Listas de venta: Minorista, Por caja, Mayorista y Eventos',
    area: 'Administración',
    roles: ['gerente', 'dueno'],
    pantallas: ['/listas-venta'],
    bajada: 'Las cuatro listas de precios y el porcentaje de cada una sobre Minorista.',
    bloques: [
      {
        tipo: 'texto',
        texto:
          'Minorista es el «Precio base» de cada producto. Las otras listas se calculan como un porcentaje sobre Minorista. El nombre y el porcentaje de cada una se pueden cambiar.',
      },
      {
        tipo: 'pasos',
        titulo: 'Para cambiar una lista',
        pasos: [
          'Cambiá el nombre o el porcentaje de la lista y tocá «Guardar».',
          'Tocá «Regenerar precios» y confirmá: cada producto toma su precio Minorista de hoy y se le aplica el porcentaje.',
        ],
      },
      {
        tipo: 'ojo',
        puntos: [
          'Regenerar reemplaza los precios que esa lista tenía.',
          'Si después cambian precios de Minorista, las otras listas no se mueven solas: hay que volver a regenerar.',
        ],
      },
    ],
  },
  {
    id: 'promociones',
    titulo: 'Promociones y descuentos',
    area: 'Administración',
    roles: ['gerente', 'dueno'],
    pantallas: ['/promociones'],
    bajada: 'Crear descuentos, ver los que corren y cuánto movieron, con propuestas armadas con el stock.',
    bloques: [
      {
        tipo: 'texto',
        texto:
          'Arriba, el ticket promedio general y el de cada segmento de clientes (Nuevos, Ocasionales, Frecuentes, Mayoristas), marcando si está por encima o por debajo. Las pestañas: «Sugeridas por IA» (mira stock, vencimientos y el calendario), «Por stock» (lo que hay que mover y el margen banca el descuento), «Por contexto», «Vigentes y últimas» y «Rendimiento».',
      },
      {
        tipo: 'pasos',
        titulo: 'Para crear una promoción',
        pasos: [
          'Tocá «+ Nueva promoción» y ponele un nombre.',
          'Elegí a quién («Todos los clientes» o un segmento) y el alcance: «Toda la tienda», «Una categoría», «Una marca» o «Un producto».',
          'Elegí el beneficio: «% de descuento», «$ menos» o «Precio fijo $», y las fechas «Desde» y «Hasta».',
          'Si corresponde: «Solo para la Comunidad ODB», «Combinable con otras promociones» o «Solo pagando con» un medio.',
          'Tocá «Crear promoción».',
        ],
      },
      {
        tipo: 'pasos',
        titulo: 'Para una promo de un momento (un partido, el Día del Padre)',
        pasos: [
          'Andá a «Por contexto», escribí el contexto y tocá «Generar»: arma combos con lo que hay en stock.',
          'Si te sirve una, «Crear promo». Desde «Por stock» también se crea de un toque la liquidación sugerida.',
        ],
      },
      {
        tipo: 'ojo',
        puntos: [
          'Vigente va en verde, programada en celeste y el resto apagado.',
          'Si elegís «Con pauta publicitaria», la promoción te arma el texto del aviso para copiar. La publicación automática en Meta todavía no está conectada: el aviso se sube a mano desde el administrador de anuncios.',
        ],
      },
    ],
  },
  {
    id: 'tiendanube',
    titulo: 'Tienda Nube',
    area: 'Administración',
    roles: ['gerente', 'dueno'],
    pantallas: ['/tiendanube'],
    bajada: 'Subir el catálogo a la tienda de Tienda Nube y traer sus pedidos.',
    bloques: [
      {
        tipo: 'texto',
        texto:
          'Arriba dice si la tienda está conectada, con «Productos publicados» y «Pedidos importados». Con la conexión hecha, «Sincronizar catálogo» sube los productos con stock y «Importar pedidos» trae los pedidos, que entran a Pedidos como canal «Tienda Nube».',
      },
      {
        tipo: 'ojo',
        puntos: [
          'Si dice «No conectado» y «Falta cargar las credenciales de la API de Tienda Nube», la tienda todavía no está enlazada y los botones no hacen nada: eso lo configura MetoGroup.',
        ],
      },
    ],
  },
  {
    id: 'mercadopago',
    titulo: 'Mercado Pago: cobros, comisiones y cuándo se libera la plata',
    area: 'Administración',
    roles: ['dueno', 'gerente'],
    pantallas: ['/mercadopago'],
    bajada: 'Lo que entró por Mercado Pago en las dos cuentas, lo que se cobró de comisión y lo que falta liberar.',
    bloques: [
      {
        tipo: 'texto',
        texto:
          'Pide un PIN al entrar (queda abierto hasta que cierres el navegador). Tiene tres vistas: «Mes a mes», «La plata» y «Cobros». Se elige la cuenta: Sant Thomas · Chinvenguencha SRL, Santa Inés · ODB SRL o «Las dos».',
      },
      {
        tipo: 'campos',
        filas: [
          ['Mes a mes', 'Un año de cobros por medio de pago, la comisión de Mercado Pago (y cuánto es por crédito) y cada mes contra el anterior. Tocá un mes para ver sus días, y un día para ver sus pagos.'],
          ['La plata', 'Lo liberado en los últimos 30 días, lo que se libera hoy, en los próximos 7 días y todo lo pendiente. Abajo, el «Extracto de la cuenta» con el saldo, los retiros y los pagos hechos con esa plata.'],
          ['Cobros', 'Los pagos uno por uno, con bruto, comisión y neto. «Traer pagos ahora» los actualiza y «Link de pago» genera un link para cobrar a distancia (el pago entra solo).'],
        ],
      },
      {
        tipo: 'ojo',
        puntos: [
          'Las transferencias que llegan a la cuenta no son ventas: van aparte, en «Transferencias recibidas».',
          'El sistema pide los reportes de Mercado Pago cada 10 minutos; lo último puede tardar un rato en aparecer.',
          '«Contra el anterior» compara lo cobrado por día, así un mes corto no parece peor. Los montos no se ajustan por inflación.',
        ],
      },
    ],
  },
  {
    id: 'tarjetas',
    titulo: 'Tarjetas: Getnet y Clover',
    area: 'Administración',
    roles: ['dueno', 'gerente'],
    pantallas: ['/tarjetas'],
    bajada: 'Lo cobrado con tarjeta en la caja y cuándo se acredita cada pago.',
    bloques: [
      {
        tipo: 'texto',
        texto:
          'Arriba, «Cobrado con tarjeta (30 días)», «Por acreditar», «Acreditado (neto)» y «Comisión real». Abajo, cada cobro con su terminal (Getnet o Clover), sucursal, bruto, comisión, neto y la fecha de acreditación. Arriba de la lista, «Próximas acreditaciones estimadas».',
      },
      {
        tipo: 'ojo',
        puntos: [
          'Solo aparecen los cobros con tarjeta que pasaron por la Caja del sistema.',
          'La fecha es estimada (el plazo típico, 2 días) hasta que se acredita. La comisión y el neto reales se completan al acreditar en Conciliación.',
        ],
      },
    ],
  },
  {
    id: 'conciliacion',
    titulo: 'Conciliación: lo que te deben Mercado Pago y las tarjetas',
    area: 'Administración',
    roles: ['dueno', 'gerente'],
    pantallas: ['/conciliacion'],
    bajada: 'Seguir el bruto que falta acreditar y anotar lo que realmente entró.',
    bloques: [
      {
        tipo: 'texto',
        texto:
          'Arriba, «Por acreditar», «Pendientes», «Atrasadas» y «Acreditado (mes)». Abajo, «Pendientes de acreditación» (cada venta con su medio, bruto y fecha en que debería acreditar; en rojo «atrasada») y «Acreditadas» de los últimos 120 días, con la comisión y el neto reales.',
      },
      {
        tipo: 'pasos',
        titulo: 'Para acreditar',
        pasos: [
          'En la fila, tocá «Acreditar».',
          'Poné el «Neto real acreditado» y la «Fecha de acreditación»: la comisión real sale de la diferencia.',
          'Para varias juntas, «Acreditar en lote» hasta una fecha. Para Mercado Pago, «Conciliar con Mercado Pago» las cruza solas con lo que informó.',
        ],
      },
    ],
  },
  {
    id: 'cheques',
    titulo: 'Cheques: la cartera de valores',
    area: 'Administración',
    roles: ['cajero', 'administrativo', 'gerente', 'dueno'],
    pantallas: ['/cheques'],
    bajada: 'Los cheques que se reciben y los que se emiten, de la cartera al banco.',
    bloques: [
      {
        tipo: 'texto',
        texto:
          'Arriba, «En cartera», «Vencen en 7 días», «Depositados», «Rechazados» y «Propios pendientes». Se filtra por estado, por de terceros o propios, y se busca por número, banco o librador.',
      },
      {
        tipo: 'pasos',
        titulo: 'Para cargar un cheque',
        pasos: [
          'Tocá «Cargar cheque».',
          'Elegí «De terceros (recibido)» o «Propio (emitido)» y completá número, banco, importe, fecha de cobro y titular o librador.',
          'Tocá «Cargar».',
        ],
      },
      {
        tipo: 'campos',
        titulo: 'Lo que se hace con cada uno',
        filas: [
          ['Depositar', 'Lo mandaste al banco: queda esperando acreditación.'],
          ['Acreditar', 'El banco lo pagó.'],
          ['Endosar', 'Se lo das a un proveedor: elegís a cuál.'],
          ['Rechazar', 'Rebotó: se anota el motivo.'],
          ['Debitado', 'Un cheque propio que el banco ya debitó.'],
          ['Anular', 'Un cheque propio que no va.'],
        ],
      },
      {
        tipo: 'ojo',
        puntos: [
          'Si un cheque rechazado venía de una cobranza, la deuda del cliente se reabre en su cuenta corriente.',
          'En rojo «vencido»: pasó la fecha de cobro y sigue en cartera.',
        ],
      },
    ],
  },
  {
    id: 'arca',
    titulo: 'ARCA: facturas electrónicas y el paquete para el contador',
    area: 'Administración',
    roles: ['dueno', 'gerente', 'administrativo'],
    pantallas: ['/arca'],
    bajada: 'Los comprobantes con CAE, los que quedaron sin emitir y el archivo del mes para el contador.',
    bloques: [
      {
        tipo: 'texto',
        texto:
          'Pide un PIN al entrar. Arriba, del mes elegido: «Comprobantes», «Neto gravado», «IVA débito fiscal» y «Total facturado». Abajo, «Pendientes de CAE» (lo que todavía no salió a ARCA o volvió con error) y «Comprobantes con CAE» del mes.',
      },
      {
        tipo: 'pasos',
        titulo: 'Si hay pendientes',
        pasos: [
          'Mirá la lista de «Pendientes de CAE»: en rojo los que ARCA rechazó.',
          'Tocá «Emitir todos» para mandarlos de nuevo.',
          'Si alguno vuelve a fallar, avisá con «Esto está mal»: es un dato del comprobante que hay que corregir.',
        ],
      },
      {
        tipo: 'pasos',
        titulo: 'Para el contador',
        pasos: [
          'Elegí el mes.',
          'Tocá «Descargar CSV para el contador»: trae cada comprobante con número, receptor, neto, IVA, total y CAE, con coma decimal para Excel.',
        ],
      },
    ],
  },
  {
    id: 'contable',
    titulo: 'Contable: IVA, Ingresos Brutos y los libros',
    area: 'Administración',
    roles: ['dueno', 'gerente', 'administrativo'],
    pantallas: ['/contable'],
    bajada: 'El cierre del mes para el contador: posición de IVA, base de Ingresos Brutos y percepciones.',
    bloques: [
      {
        tipo: 'texto',
        texto:
          'Se elige el período: «Hoy», «7 días», «Quincena», «Mes», «Semestre», «Año» o «Año mes a mes». Muestra la «Posición IVA» (IVA débito de ventas, IVA crédito de compras, saldo técnico y percepciones a cuenta, con el IVA a pagar o a favor estimado), «Ingresos Brutos (ARBA · Prov. de Buenos Aires)» con la base imponible y las percepciones sufridas, y el detalle de «IVA Ventas» e «IVA Compras». Los CSV bajan los libros completos.',
      },
      {
        tipo: 'ojo',
        puntos: [
          'El impuesto de Ingresos Brutos lo calcula el contador con la alícuota de la actividad: acá está la base y los pagos a cuenta.',
          'Las facturas de compra marcadas con * se cargaron sin el IVA discriminado y se estiman al 21 %. Para que el libro quede exacto, cargalas con neto e IVA.',
          'Las retenciones bancarias todavía no tienen de dónde salir: no están en el cálculo.',
        ],
      },
    ],
  },
  {
    id: 'libro-iva',
    titulo: 'Libro IVA',
    area: 'Administración',
    roles: ['dueno', 'gerente', 'administrativo'],
    pantallas: ['/libro-iva'],
    bajada: 'El libro de IVA ventas y el de compras del período, listo para imprimir.',
    bloques: [
      {
        tipo: 'texto',
        texto:
          'Arriba, «IVA débito (ventas)» e «IVA crédito (compras)» con el saldo: «Saldo a pagar a la AFIP» o «Saldo técnico a favor». Abajo, los dos libros, comprobante por comprobante, con sus totales. Se elige el período y se imprime con «Imprimir» (sale siempre la tabla).',
      },
      {
        tipo: 'ojo',
        puntos: [
          'Lo marcado «IVA estimado» es una factura de compra cargada sin desglose: se calcula al 21 %.',
        ],
      },
    ],
  },

  // ---------------------------------------------------------------- compras
  {
    id: 'puerta-deposito',
    titulo: 'Puerta de depósito: confirmar con la factura',
    area: 'Compras',
    roles: ['administrativo', 'comprador', 'gerente', 'dueno'],
    pantallas: ['/puerta-deposito'],
    bajada: 'Lo que el salón recibió con remito espera acá la factura antes de sumar al stock.',
    bloques: [
      {
        tipo: 'texto',
        texto:
          'Cada ingreso que cargó el salón aparece con su proveedor, el remito, lo que bajó y la nota del salón. Pestañas: «Esperan factura» y «Todos».',
      },
      {
        tipo: 'pasos',
        pasos: [
          'Abrí el ingreso y escribí el «N.º de factura».',
          'Corregí la cantidad de los renglones donde la factura dice otra cosa que el remito.',
          'Tocá «Confirmar y sumar al stock»: entra como una recepción más y el remito queda para conciliar con la factura de compra.',
          'Si no corresponde, «Rechazar» con el motivo: no suma nada y el salón ve por qué.',
        ],
      },
    ],
  },
  {
    id: 'comparador',
    titulo: 'Comparador de precios entre proveedores',
    area: 'Compras',
    roles: ['administrativo', 'comprador', 'gerente', 'dueno'],
    pantallas: ['/comparador'],
    bajada: 'Cargar la lista de un proveedor y ver en qué productos conviene más o menos que el actual.',
    bloques: [
      {
        tipo: 'texto',
        texto:
          'Arriba: cuántos proveedores, cuántos productos se pueden comparar, el «Ahorro potencial» y cuánto dependés del principal. Abajo, «Productos con más de un proveedor», con a quién conviene comprarle cada uno y la diferencia, y el directorio de proveedores con su condición de pago.',
      },
      {
        tipo: 'pasos',
        titulo: 'Para analizar una lista',
        pasos: [
          'En «Cargar lista de un proveedor y analizarla», poné el proveedor, pegá la lista o tocá «Subir PDF / imagen».',
          'Tocá «Analizar lista»: te dice cuántos productos leyó, cuántos coinciden con tu catálogo y en cuántos es más barato o más caro.',
          'Si el proveedor ofrece algo («si compro 6 cajas me regala 2»), escribilo o dictalo en «Aclaración del proveedor» y tocá «Interpretar»: recalcula los costos.',
        ],
      },
      {
        tipo: 'ojo',
        puntos: [
          '«Aplicar al catálogo» guarda la lista, da de alta el proveedor y cambia en el momento el costo y el precio de venta (costo × markup) de los productos que coincidieron, sin pasar por Aprobaciones. Usalo solo cuando estés seguro; para cambios de costo que firma el dueño está Mesa de compras.',
        ],
      },
    ],
  },
  {
    id: 'listas-proveedor',
    titulo: 'Listas de proveedor: ver qué cambia antes de aplicar',
    area: 'Compras',
    roles: ['administrativo', 'comprador', 'gerente', 'dueno'],
    pantallas: ['/listas'],
    bajada: 'Subir la lista nueva de un proveedor y ver la diferencia de costo producto por producto.',
    bloques: [
      {
        tipo: 'pasos',
        pasos: [
          'Elegí el «Proveedor» y subí el archivo de la lista (PDF o Excel).',
          'Tocá «Analizar»: la lee, la cruza con el catálogo y muestra la «Propuesta de actualización» con «Costo actual», «Costo nuevo» y la «Variación» de cada producto.',
          'Los renglones «sin matchear» no se reconocieron: hay que resolverlos a mano.',
        ],
      },
      {
        tipo: 'ojo',
        puntos: [
          'Esta pantalla solo muestra la propuesta: no cambia ningún costo ni precio. Los costos se actualizan al cargar la factura o con una propuesta que firma el dueño (Mesa de compras).',
        ],
      },
    ],
  },

  // -------------------------------------------------- clientes y cuenta corriente
  {
    id: 'clientes',
    titulo: 'Base de clientes',
    area: 'Clientes y cuenta corriente',
    roles: ['dueno', 'gerente'],
    pantallas: ['/clientes', '/clientes?sucursal=st', '/clientes?sucursal=si'],
    bajada: 'Todos los clientes, quién compra cómo, a quién reactivar y los cobros a cuenta por aprobar.',
    bloques: [
      {
        tipo: 'texto',
        texto:
          'Arriba: «Clientes», «Comunidad ODB», «Con cuenta cte.», «Opt-in WhatsApp», «Cumplen este mes» y «Ticket prom.». Las pestañas: «Todos», «Segmentos», «Comunidad ODB», «Cuentas corrientes», «Reactivación» y «Difusiones WhatsApp». En el menú, «Sant Thomas» y «Santa Inés» muestran los clientes de cada sucursal.',
      },
      {
        tipo: 'pasos',
        titulo: 'Cobros a ingresar (arriba de todo)',
        pasos: [
          'Son los pagos a cuenta que tomaron los cajeros y todavía no bajaron la deuda.',
          'Chequealo contra la caja o el posnet (con «ver comprobante» si lo hay).',
          'El dueño toca «Aprobar» y recién ahí baja la deuda, con su «Recibo». Si no corresponde, «Rechazar» con el motivo: le llega a quien lo cargó.',
        ],
      },
      {
        tipo: 'pasos',
        titulo: 'Para sumar clientes a una sucursal',
        pasos: [
          'Entrá a Clientes › Sant Thomas (o Santa Inés).',
          'A la derecha están los que todavía no tienen sucursal: buscalo y tocá «Sumar».',
        ],
      },
      {
        tipo: 'ojo',
        puntos: [
          '«Reactivación» muestra los que no compran hace más de 60 días y los cumpleaños del mes.',
          '«Difusiones WhatsApp» manda solo a los clientes que aceptaron recibir mensajes y tienen teléfono, por la línea oficial con opción de baja. Las campañas por la línea del local están en Difusiones.',
        ],
      },
    ],
  },
  {
    id: 'cuentas-corrientes',
    titulo: 'Cuentas corrientes: quién debe, cuánto y desde cuándo',
    area: 'Clientes y cuenta corriente',
    roles: ['administrativo', 'gerente', 'dueno'],
    pantallas: ['/cuentas-corrientes', '/cuentas-corrientes?tipo=sponsor'],
    bajada: 'La plata en la calle, el tope de cada cliente y el resumen automático por WhatsApp.',
    bloques: [
      {
        tipo: 'texto',
        texto:
          'Arriba: «En la calle», «Disponible para fiar», «Días de deuda promedio», «Ticket promedio», «Pagaron (30 días)» y «Riesgo alto». Abajo, una tarjeta por cuenta: cuánto debe contra su límite, el porcentaje usado, lo último que compró y pagó, y los botones «Llamar», «WhatsApp» y «Ver y editar». Los filtros: «Todas», «Riesgo alto», «Atención», «Al día», «Deben hace +90 días», «Pasadas del límite» y «Sin límite»; y se ordena por «Más deuda primero», «Deuda más vieja primero», «Más tiempo sin pagar», «Más cerca del límite», «Los que más compran» o «Por nombre».',
      },
      {
        tipo: 'pasos',
        titulo: 'Para abrir una cuenta nueva',
        pasos: [
          'Tocá «Sumar cuenta» y buscá al cliente por nombre, DNI o CUIT (casi todos ya están cargados). Si no está, «Es un cliente nuevo».',
          'Poné el «Tope de crédito» y, si viene con una deuda de antes, «Ya debe (saldo inicial)».',
          'Tocá «Abrir la cuenta».',
        ],
      },
      {
        tipo: 'pasos',
        titulo: 'En la ficha de cada cuenta («Ver y editar»)',
        pasos: [
          'Los datos del cliente, el tipo de cuenta y el «Tope de crédito», con «Guardar cambios».',
          '«Cómo compra»: ticket promedio, qué días, mes a mes, lo que más compra y cómo paga.',
          '«Movimientos» y los «Resúmenes por WhatsApp» que le llegaron; con «No mandarle» se le apaga el resumen a ese cliente.',
          '«Corregir el saldo» (solo el dueño): para un error de carga. Queda como movimiento con el motivo; el saldo nunca se pisa.',
          '«Dar de baja la cuenta»: deja de poder comprar a cuenta y sale del tablero. «Volver a abrir la cuenta» la reabre.',
        ],
      },
      {
        tipo: 'ojo',
        puntos: [
          'La deuda baja con un pago a cuenta tomado en la Caja que aprueba el dueño (en Clientes › Cobros a ingresar o en Aprobaciones). Ni el cajero ni el repartidor la bajan solos.',
          'Una cuenta que debe la da de baja solo un dueño; gerencia, solo si no debe nada. La deuda queda y se sigue cobrando: aparece abajo en «Dadas de baja con deuda».',
          'Desde Pedidos y desde Envíos se puede entregar un pedido a «Cuenta corriente»: se elige la cuenta (abierta y dentro del tope), sale la factura A o B y la deuda queda en su cuenta.',
          'El «Resumen de saldo por WhatsApp» sale los días 1 y 16 a las 10 h a todos los que deben, por la línea general. Mientras diga «Pausado» no le llega nada a nadie; antes de prenderlo, «Mandarme una prueba».',
          'En el menú, «Sponsors WF» son las cuentas de los sponsors del Wine Fest: misma pantalla, con «Sumar sponsor».',
        ],
      },
    ],
  },
  {
    id: 'agenda',
    titulo: 'Agenda: todos los que escribieron por WhatsApp',
    area: 'Clientes y cuenta corriente',
    roles: ['dueno', 'gerente'],
    pantallas: ['/agenda'],
    bajada: 'Cada contacto que le escribió a las líneas del local, para llamarlo o escribirle de un toque.',
    bloques: [
      {
        tipo: 'pasos',
        pasos: [
          'Buscá por nombre o por parte del número, o filtrá «Clientes», «Proveedores», «Equipo» o «Todos».',
          '«Llamar» o «WhatsApp» abren la llamada o la charla.',
          'Si el nombre está mal, tocalo, corregilo y «Guardar».',
        ],
      },
      {
        tipo: 'ojo',
        puntos: ['La ven solo los dueños y gerentes: tiene el teléfono de todos los que escribieron.'],
      },
    ],
  },
  {
    id: 'mensajes',
    titulo: 'Mensajes: solicitudes y notificaciones de la app',
    area: 'Clientes y cuenta corriente',
    roles: ['dueno', 'gerente'],
    pantallas: ['/mensajes'],
    bajada: 'Lo que piden los clientes desde la app de ODB y los avisos que se les mandan al celular.',
    bloques: [
      {
        tipo: 'texto',
        texto:
          'Pestañas: «Solicitudes» (devoluciones, consultas, pedidos especiales y reclamos que mandan los clientes desde la app), «Enviar», «Automáticas» e «Historial».',
      },
      {
        tipo: 'pasos',
        titulo: 'Para atender una solicitud',
        pasos: [
          'Filtrá «Abiertas» y abrí la solicitud.',
          'Escribí la respuesta y tocá «Responder y notificar»: al cliente le llega en la app.',
          'Cambiá el estado: «Marcar en proceso» o «Marcar resuelta».',
        ],
      },
      {
        tipo: 'pasos',
        titulo: 'Para mandar una notificación',
        pasos: [
          'En «Enviar», elegí a quién: «Todos», «Un segmento» o «Un cliente».',
          'Escribí el título y el mensaje y tocá «Enviar notificación».',
        ],
      },
      {
        tipo: 'ojo',
        puntos: [
          'Las automáticas (cumpleaños y reactivación) corren solas todos los días a las 9:00. «Correr automáticas ahora» las dispara a mano.',
          'Esto llega a la app de ODB, no al WhatsApp. Para WhatsApp están RESPONDE y Difusiones.',
        ],
      },
    ],
  },

  // --------------------------------------------------------------- whatsapp
  {
    id: 'difusiones',
    titulo: 'Difusiones y mensajes programados por WhatsApp',
    area: 'WhatsApp',
    roles: ['dueno', 'gerente'],
    pantallas: ['/bandeja'],
    bajada: 'Campañas a una lista de contactos y los mensajes que quedaron programados.',
    bloques: [
      {
        tipo: 'texto',
        texto:
          'Arriba, una tarjeta por número de WhatsApp con su interruptor del bot. Pestañas: «Difusiones» y «Programados». Las conversaciones no están acá: están en RESPONDE.',
      },
      {
        tipo: 'pasos',
        titulo: 'Para mandar una difusión',
        pasos: [
          'Tocá «Nueva difusión» y poné un título interno.',
          'Escribí el mensaje. Si hay más de un número, elegí por cuál sale («Sale por»).',
          'Elegí a quién: la «Lista» (o «toda la base»), la «Relación» (activo, enfriándose, dormido), el «Origen» y el «Barrio». «Solo sin difusiones previas» arma las tandas para no repetirle a nadie.',
          'Elegí «Enviar: ahora» o programala para una fecha y hora, y confirmá. Sale con pausa entre mensajes.',
        ],
      },
      {
        tipo: 'ojo',
        puntos: [
          'Las difusiones las mandan los dueños y gerentes.',
          'Los mensajes programados se crean desde una charla de RESPONDE, con el reloj. Acá se ven y se cancelan.',
        ],
      },
    ],
  },

  // -------------------------------------------------------------- dirección
  {
    id: 'caja-dueno',
    titulo: 'Caja del dueño: tu plata, anotada al toque',
    area: 'Dirección',
    roles: ['dueno'],
    pantallas: ['/caja-dueno'],
    bajada: 'Cuánto tenés, y lo que entra y sale anotado como lo dirías, escrito o dictado.',
    bloques: [
      {
        tipo: 'texto',
        texto:
          'No es la caja del local: es la plata que manejás vos (retiros de la caja de Sant Thomas, lo del reparto, lo que pagás a proveedores, sueldos, servicios). Arriba dice «Tenés» con el total; abajo, el mes con lo que entró y salió, «De dónde entró» y «En qué se fue», el mes pasado al lado y los «Movimientos» día por día.',
      },
      {
        tipo: 'pasos',
        titulo: 'Para anotar',
        pasos: [
          'En «Anotá como lo dirías», escribí o tocá «Dictar» y decilo: «pagué 686 mil a CCU», «saqué 5,1 millones de la caja de St Thomas», «ayer me pagaron 91 mil del reparto».',
          'Te muestra «Entendí: …». Si está bien, «Anotar». Si no, «Cambiar».',
          'Si la frase no dice si entró o salió, te pregunta «¿Entró o salió?»: un toque.',
          'Si te equivocaste, «Deshacer». Para algo que repetís siempre, tocalo en «Lo de siempre» y confirmás.',
        ],
      },
      {
        tipo: 'ojo',
        puntos: [
          'También se anota con los botones «+ Entró plata» y «− Salió plata», eligiendo cuánto, de dónde y cuándo.',
          'Tocá un movimiento para corregirlo o borrarlo. «Bajar en Excel» baja los movimientos.',
          'Solo la ve quien tiene ese permiso propio (hoy, Juan Pablo): no alcanza con ser dueño. Para dárselo a otra persona, pedíselo a MetoGroup.',
          'Lo que se cobra y se paga en el sistema (caja de los locales, facturas de proveedores) no entra solo: se anota acá lo que vos agarrás o pagás.',
        ],
      },
    ],
  },
  {
    id: 'estadisticas',
    titulo: 'Estadísticas: 30 días de venta',
    area: 'Dirección',
    roles: ['dueno', 'gerente'],
    pantallas: ['/estadisticas'],
    bajada: 'Cuánto se vendió, cómo se pagó y qué productos ganan, pierden o se quedan sin stock.',
    bloques: [
      {
        tipo: 'texto',
        texto:
          'Arriba: «Facturado (30 días)», «Tickets», «Ticket promedio» y «Descuentos otorgados». Después, «Ventas por día (30 días)» y «Medios de pago (30 días)». Abajo, los rankings: «Ganadores del momento» (los que aceleran esta semana), «Más vendidos (unidades)», «Peores (candidatos a liquidar)», «Más facturación» y «Más margen (la plata de verdad)».',
      },
      {
        tipo: 'ojo',
        puntos: [
          '«Más vendidos y cobertura de stock» dice cuántos días dura el stock al ritmo de venta, con semáforo; tocá un producto para ver su stock.',
          'Son las ventas que pasaron por la Caja del sistema. El mes completo de los dos locales, con lo del sistema anterior, está en Facturación.',
        ],
      },
    ],
  },
  {
    id: 'informe-diario',
    titulo: 'Informe diario: el parte de las 7',
    area: 'Dirección',
    roles: ['dueno', 'gerente'],
    pantallas: ['/informes'],
    bajada: 'Todas las mañanas, cómo fue la venta del día anterior y qué atender.',
    bloques: [
      {
        tipo: 'texto',
        texto:
          'Se genera solo a las 7:00 con la venta del día anterior: «Facturado», «Tickets», «Ticket promedio» y «Promedio diario (30d)», el «Top del día (facturación)», «Abastecimiento», lo que está «Por vencer (≤15 días)» y los «Medios de pago».',
      },
      {
        tipo: 'ojo',
        puntos: ['Si un día no está, «Generar informe de ayer» lo arma en el momento.'],
      },
    ],
  },
  {
    id: 'usuarios',
    titulo: 'Usuarios: el equipo, sus roles y quién firma',
    area: 'Dirección',
    roles: ['dueno', 'gerente', 'administrativo'],
    pantallas: ['/usuarios'],
    bajada: 'Dar de alta a alguien, cambiarle el rol o la sucursal, y darlo de baja.',
    bloques: [
      {
        tipo: 'texto',
        texto:
          'Arriba, cuántos hay en el equipo, activos, «para completar» y «con firma». Cada persona tiene uno o más roles: Dueño, Gerente, Administrativo, Comprador, Caja, Depósito, Reparto, Op salón y Fiambrería. El rol decide qué pantallas ve.',
      },
      {
        tipo: 'pasos',
        titulo: 'Para sumar a alguien',
        pasos: [
          'Tocá «Sumar al equipo».',
          'Poné «Nombre y apellido», email, WhatsApp y los roles (podés marcar más de uno). A caja, salón y fiambrería elegile la sucursal: solo ve y arma los pedidos de esa.',
          'Poné una clave temporal (mínimo 6 caracteres): la primera vez que entre elige la suya.',
          'Tocá «Guardar y activar» y mandale los accesos con «Enviar por WhatsApp» o «Copiar mensaje».',
        ],
      },
      {
        tipo: 'campos',
        titulo: 'Permisos',
        filas: [
          ['PIN de firma y Límite de aprobación', 'Habilitan a firmar órdenes de compra hasta ese monto.'],
          ['Gerente', 'Opera todo y administra el equipo. Ve la cola de aprobaciones, pero firmar es del dueño.'],
        ],
      },
      {
        tipo: 'ojo',
        puntos: [
          'Administración puede completar las altas que quedaron «Para completar» (email, WhatsApp y clave). Los roles y las bajas son del dueño.',
          '«Eliminar»: si la persona tiene ventas o cajas registradas, se desactiva en vez de borrarse, para no romper el historial. El sistema la saca al minuto.',
        ],
      },
    ],
  },
  {
    id: 'reportes-equipo',
    titulo: 'Reportes del equipo: lo que marcaron con «Esto está mal»',
    area: 'Dirección',
    roles: ['dueno', 'gerente'],
    pantallas: ['/reportes'],
    bajada: 'La cola de errores y dudas que el equipo reportó desde las pantallas.',
    bloques: [
      {
        tipo: 'texto',
        texto:
          'Cada reporte trae lo que escribió la persona, de qué pantalla, la clasificación («Sistema», «Dato» o «Duda») y el «Contexto adjunto». También entran acá los pedidos que se le hacen a MetoGroup desde el Manual. Filtros: «Pendientes» y «Todos».',
      },
      {
        tipo: 'pasos',
        pasos: [
          'Abrí el reporte y mirá el contexto.',
          'Si ya se resolvió, «Resolver» y escribí «Qué se hizo»: le llega a quien lo reportó por la campanita.',
          'Si no corresponde, «Descartar».',
        ],
      },
    ],
  },
  {
    id: 'eficiencia',
    titulo: 'Eficiencia: los tiempos de cada uno',
    area: 'Dirección',
    roles: ['dueno', 'gerente'],
    pantallas: ['/eficiencia'],
    bajada: 'Cuánto tarda cada cajero por cliente y cada uno en armar un pedido.',
    bloques: [
      {
        tipo: 'campos',
        filas: [
          ['Cajeros: velocidad de atención', 'Tickets, minutos por cliente, clientes por hora y facturado, por persona.'],
          ['Armado en el salón (últimos 7 días)', 'Pedidos, cuánto tardó en arrancar y de asignado a terminado, por persona.'],
          ['Preparación de pedidos', 'El tiempo de armado y de entrega de cada pedido.'],
        ],
      },
      {
        tipo: 'ojo',
        puntos: [
          'Se llena a medida que se opera en el sistema: lo que se vende con el sistema anterior o se arma sin el celular no se mide.',
        ],
      },
    ],
  },
  {
    id: 'mantenimiento',
    titulo: 'Mantenimiento: lo que hizo MetoGroup',
    area: 'Dirección',
    roles: ['dueno', 'gerente'],
    pantallas: ['/mantenimiento'],
    bajada: 'Cada cambio publicado en el sistema, quién lo pidió, cuándo y cuánto tiempo llevó.',
    bloques: [
      {
        tipo: 'texto',
        texto:
          'Se carga solo cada vez que se publica algo. Se ve «Día por día», «Qué tipo de trabajo fue» (bugs resueltos, arreglos, mejoras, funciones nuevas y propuestas de MetoGroup), «Sobre qué trabajamos», «Quién lo pidió» y «El registro completo». Cada número y cada barra se toca y filtra la lista. También está la medida de la carga de facturas: cuántas entran sin tocar.',
      },
      {
        tipo: 'ojo',
        puntos: [
          'El abono incluye horas por mes. Lo que pasa de esas horas aparece en «Horas por encima del abono» y se hace o se cobra solo si el dueño toca «Aprobar». Con «Rechazar» se escribe el motivo y le llega a MetoGroup.',
          'Lo nuevo del último mes también está en el Manual, en la pestaña «Lo nuevo».',
        ],
      },
    ],
  },
  {
    id: 'agente-ia',
    titulo: 'Agente IA: el catálogo que se completa solo',
    area: 'Dirección',
    roles: ['dueno', 'gerente'],
    pantallas: ['/agente'],
    bajada: 'Un ayudante que carga productos, completa datos y busca fotos, y pregunta cuando duda.',
    bloques: [
      {
        tipo: 'texto',
        texto:
          'Hace solo lo de bajo riesgo y escala a una persona cuando duda; cada acción queda en la «Auditoría». Las tareas se ven por estado: «Pendientes», «Escaladas a humano», «Completadas» y «Con error».',
      },
      {
        tipo: 'pasos',
        titulo: 'Para darle una tarea',
        pasos: [
          'En «Darle una tarea al agente», escribila como la dirías: «Cargá Vino Trapiche Reserva Malbec 750ml a $4.500, categoría Vinos Tintos».',
          'Tocá «Encolar» y después «Procesar pendientes».',
          'Lo que quede «Escalada» espera que alguien lo mire: abrila y «Resolver».',
        ],
      },
      {
        tipo: 'ojo',
        puntos: [
          '«Buscar fotos por código de barra (60)» trae fotos de una base pública y las filtra por calidad; cubre una parte del catálogo, sobre todo marcas grandes.',
          '«Pack de fotos de un proveedor»: subí las fotos tal como las mandó; si el archivo se llama con el SKU, el código de barras o el código del proveedor, las reconoce solo.',
          '«Enriquecer catálogo (50)» y «Barrido de mantenimiento» completan y revisan datos de a tandas.',
        ],
      },
    ],
  },
];
