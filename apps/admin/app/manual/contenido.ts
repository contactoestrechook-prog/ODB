// El manual del sistema, área por área.
//
// Está escrito como datos y no como una página de texto por dos motivos: se
// puede buscar por palabra (que es como la gente lo va a usar de verdad, con
// una duda concreta y el cliente esperando) y se puede filtrar por el rol de
// quien lo abre, para que un cajero no tenga que pasar por seis pantallas que
// no va a ver nunca.
//
// Regla al escribirlo: cada paso tiene que corresponder a algo que la pantalla
// hace hoy. Un manual que promete de más se deja de leer a la segunda vez.

export type Bloque =
  | { tipo: 'texto'; texto: string }
  | { tipo: 'pasos'; titulo?: string; pasos: string[] }
  | { tipo: 'ojo'; titulo?: string; puntos: string[] }
  | { tipo: 'campos'; titulo?: string; filas: [string, string][] };

export type Seccion = {
  id: string;
  titulo: string;
  area: string;
  roles: string[]; // qué roles la usan a diario (para ordenar, no para esconder)
  bajada: string;
  bloques: Bloque[];
};

export const AREAS = [
  'Para empezar',
  'Salón y caja',
  'Depósito',
  'Administración',
  'Compras',
  'Clientes y cuenta corriente',
  'Reparto',
  'Dirección',
  'WhatsApp',
] as const;

export const SECCIONES: Seccion[] = [
  // ---------------------------------------------------------------- empezar
  {
    id: 'entrar',
    titulo: 'Entrar al sistema y tenerlo a mano',
    area: 'Para empezar',
    roles: ['dueno', 'gerente', 'comprador', 'cajero', 'deposito', 'administrativo', 'repartidor'],
    bajada: 'Usuario, clave y cómo dejarlo instalado en el teléfono como una aplicación.',
    bloques: [
      {
        tipo: 'pasos',
        titulo: 'La primera vez',
        pasos: [
          'Entrá con el usuario y la clave que te dieron.',
          'El sistema te va a pedir que cambies la clave. Elegí una que no uses en otro lado.',
          'Cada persona entra con SU usuario. Todo lo que se hace queda con nombre y hora: quién cobró, quién recibió la mercadería, quién aprobó un pago. Prestar el usuario es prestar la firma.',
        ],
      },
      {
        tipo: 'pasos',
        titulo: 'Dejarlo como aplicación en el celular',
        pasos: [
          'Abrí el panel en el navegador del teléfono.',
          'Cuando aparezca el cartel de abajo, tocá "Instalar".',
          'Queda un ícono en la pantalla de inicio y abre en pantalla completa, sin la barra del navegador.',
        ],
      },
      {
        tipo: 'ojo',
        titulo: 'Cuando algo se ve raro',
        puntos: [
          'Si aparece el aviso de actualización arriba, tocá "Actualizar ahora": estás viendo una versión vieja de la pantalla.',
          'Cada persona ve el menú de su área. Si no ves una pantalla, es porque tu rol no la abre, no porque esté rota.',
        ],
      },
    ],
  },

  // ------------------------------------------------------------------- caja
  {
    id: 'caja-vender',
    titulo: 'Cobrar una venta',
    area: 'Salón y caja',
    roles: ['cajero', 'gerente', 'dueno'],
    bajada: 'El circuito de todos los días: abrir la caja, cargar, cobrar y cerrar.',
    bloques: [
      {
        tipo: 'pasos',
        titulo: 'Abrir la caja',
        pasos: [
          'Al empezar el turno, "Abrir caja" y cargá la base inicial: el efectivo que hay en el cajón antes de vender.',
          'Si la base está mal cargada, el arqueo del cierre va a dar diferencia toda la jornada.',
        ],
      },
      {
        tipo: 'pasos',
        titulo: 'Cargar los productos',
        pasos: [
          'Pasá el código de barras con el lector, o buscá por nombre.',
          'Si un producto no aparece, probá con parte del nombre. Si sigue sin aparecer, avisá a backoffice: falta darlo de alta o vincularle el código.',
          'El precio sale de la lista, no se escribe a mano.',
        ],
      },
      {
        tipo: 'pasos',
        titulo: 'Antes de cobrar: el documento del cliente',
        pasos: [
          'Pedí el DNI (o el CUIT si es cuenta corriente) y cargalo.',
          'Si el cliente ya compró antes, aparece su nombre y, después de tres compras, qué suele llevar. Ese atajo suma el producto de un toque.',
          'Si es cliente de cuenta corriente, aparece el saldo anterior, cómo queda con esta venta y cuánto le queda disponible.',
          'Si el cliente no lo quiere dar, seguí sin DNI. No frena la venta.',
        ],
      },
      {
        tipo: 'campos',
        titulo: 'Formas de cobro',
        filas: [
          ['Efectivo', 'Entra al arqueo del turno.'],
          ['Tarjeta (posnet)', 'Elegí la terminal que usaste. El sistema después cruza contra lo que liquida la tarjeta.'],
          ['Cuenta corriente', 'Solo si el cliente la tiene habilitada y le queda disponible. No baja plata: sube la deuda.'],
          ['Cheque', 'Queda en cartera y se ve en la pantalla de Cheques.'],
        ],
      },
      {
        tipo: 'pasos',
        titulo: 'Si se corta el internet',
        pasos: [
          'La caja sigue vendiendo, SOLO en efectivo. Arriba aparece "SIN RED" con la cantidad de ventas en cola.',
          'Cada venta queda guardada en esa máquina y se envía sola cuando vuelve la conexión: no hay que hacer nada.',
          'Tarjeta, QR y cuenta corriente quedan bloqueados: el posnet está muerto igual, y la cuenta corriente no puede verificar el saldo sin conexión.',
          'No cierres la caja mientras haya ventas "por enviar": el arqueo del sistema no las incluye hasta que suban.',
          'Si el corte es largo, la salida rápida es compartir internet desde un celular: el sistema anda igual por cualquier conexión.',
        ],
      },
      {
        tipo: 'ojo',
        titulo: 'Cosas que no se hacen a mano',
        puntos: [
          'El descuento necesita autorización: pide el PIN de un supervisor. No es desconfianza, es que quede registrado quién lo dio.',
          'Una devolución se hace desde "Devolución de venta", eligiendo la venta y los renglones. Nunca cobrando en negativo.',
          'La consulta de precio (F9) no toca la venta en curso.',
        ],
      },
    ],
  },
  {
    id: 'caja-pago-cuenta',
    titulo: 'Un cliente de cuenta corriente deja un pago',
    area: 'Salón y caja',
    roles: ['cajero', 'administrativo', 'gerente', 'dueno'],
    bajada: 'Lo tomás vos, pero la deuda baja recién cuando lo aprueba el dueño.',
    bloques: [
      {
        tipo: 'pasos',
        pasos: [
          'En la caja, "Dejó un pago". Cargá el monto y con qué pagó.',
          'Si hay comprobante (foto de la transferencia, ticket del posnet), sacale una foto y adjuntala. Es lo que después zanja cualquier discusión.',
          'El pago queda en "Cobros a ingresar" y al dueño le llega el aviso.',
          'Cuando él lo aprueba, ahí sí baja la deuda del cliente y se emite el recibo con número.',
        ],
      },
      {
        tipo: 'ojo',
        puntos: [
          'Hasta que no está aprobado, el cliente sigue debiendo ese monto en el sistema. Es a propósito: nadie más que el dueño toca la cuenta corriente.',
          'Vos podés ver los pagos que cargaste vos, para saber si ya se aplicaron. La cola completa del local la ve dirección.',
        ],
      },
    ],
  },
  {
    id: 'caja-cierre',
    titulo: 'Cerrar la caja y arquear',
    area: 'Salón y caja',
    roles: ['cajero', 'gerente', 'dueno'],
    bajada: 'Contar lo que hay contra lo que el sistema dice que tendría que haber.',
    bloques: [
      {
        tipo: 'pasos',
        pasos: [
          '"Cerrar caja · arqueo" al terminar el turno.',
          'El sistema muestra el efectivo esperado: base inicial más las ventas en efectivo, menos los movimientos de caja.',
          'Contá el cajón y cargá lo que hay de verdad.',
          'Si hay diferencia, se registra. No la ajustes para que dé cero: la diferencia sirve justamente para encontrar el error.',
        ],
      },
      {
        tipo: 'ojo',
        puntos: [
          'Todo retiro o ingreso de efectivo que no sea una venta se carga como movimiento de caja, con monto y motivo, en el momento.',
          'Una caja que queda abierta de un día para otro ensucia el arqueo del día siguiente.',
        ],
      },
    ],
  },

  // --------------------------------------------------------------- depósito
  {
    id: 'deposito-pedidos',
    titulo: 'Preparar pedidos',
    area: 'Depósito',
    roles: ['deposito', 'cajero', 'gerente', 'dueno'],
    bajada: 'La cola de lo que hay que armar, en orden.',
    bloques: [
      {
        tipo: 'pasos',
        pasos: [
          'La pantalla de Depósito muestra tres columnas: recibidos, en preparación y listos para retirar.',
          '"Empezar a preparar" cuando lo agarrás. Así el resto sabe que ese pedido ya tiene dueño.',
          '"Marcar listo" cuando está armado.',
          '"Entregar" cuando se lo lleva el cliente o sale con el repartidor.',
        ],
      },
      {
        tipo: 'ojo',
        puntos: [
          'Si falta un producto del pedido, avisá antes de marcarlo listo. Un pedido incompleto marcado como listo llega mal al cliente y vuelve como reclamo.',
        ],
      },
    ],
  },
  {
    id: 'deposito-recepcion',
    titulo: 'Recibir mercadería con el lector',
    area: 'Depósito',
    roles: ['deposito', 'administrativo', 'gerente', 'dueno'],
    bajada: 'Lo que baja del camión se cuenta escaneando, y eso es lo que entra al stock.',
    bloques: [
      {
        tipo: 'pasos',
        pasos: [
          'Elegí el proveedor y la sucursal.',
          'Escaneá cada bulto. Aparece arriba el último leído para confirmar que es el correcto.',
          'Si un código no lo conoce el sistema, avisa. Ese producto se vincula o se da de alta en backoffice; no lo dejes pasar.',
          'Al terminar, confirmá. El stock sube con lo que escaneaste.',
        ],
      },
      {
        tipo: 'ojo',
        puntos: [
          'La recepción NO define precios. Lo que se cuenta acá es cantidad; el costo llega con la factura.',
          'Del acta de recepción sale un papel con número, que muestra lo pedido contra lo recibido y marca las diferencias. Si falta mercadería, ese papel es el reclamo.',
        ],
      },
    ],
  },
  {
    id: 'deposito-stock',
    titulo: 'Stock, conteos, ajustes y mermas',
    area: 'Depósito',
    roles: ['deposito', 'administrativo', 'gerente', 'dueno'],
    bajada: 'Cómo se corrige el stock sin romper el número.',
    bloques: [
      {
        tipo: 'campos',
        titulo: 'Qué es cada cosa',
        filas: [
          ['Conteo', 'Contás una parte del depósito y el sistema muestra las diferencias contra lo que tenía. Es la forma limpia de corregir.'],
          ['Ajuste', 'Corrección puntual de un producto. Pide motivo.'],
          ['Merma', 'Lo que se rompió, venció o se perdió. Pide motivo.'],
          ['Transferencia', 'Mercadería que se manda a la otra sucursal. La sucursal que recibe la confirma.'],
        ],
      },
      {
        tipo: 'ojo',
        puntos: [
          'Los ajustes y mermas grandes piden el PIN de un supervisor.',
          'Un ajuste sin motivo escrito es un agujero que nadie va a poder explicar en tres meses.',
          'La pantalla de Stock tiene una vista de negativos: si un producto está en negativo, entró una venta de algo que el sistema creía que no había. Se corrige contando, no ajustando a ojo.',
        ],
      },
    ],
  },

  // --------------------------------------------------------- administración
  {
    id: 'admin-factura',
    titulo: 'Cargar una factura de proveedor',
    area: 'Administración',
    roles: ['administrativo', 'comprador', 'gerente', 'dueno'],
    bajada: 'Lo que define la deuda con el proveedor y los costos reales.',
    bloques: [
      {
        tipo: 'pasos',
        pasos: [
          'Entrá a Facturas de compra y cargá la factura: proveedor, número, fecha y los renglones.',
          'Adjuntá el archivo o la foto de la factura. Después nadie tiene que ir a buscar el papel.',
          'Revisá el desglose: neto, IVA, percepciones e impuestos internos van separados. De ahí sale el Libro IVA.',
          'Guardá. La factura queda como deuda pendiente de pago.',
        ],
      },
      {
        tipo: 'ojo',
        puntos: [
          'Una factura ya cargada no se edita de prepo: se pide el cambio con el motivo, y lo aprueba un dueño. Queda el antes y el después.',
          'Si un renglón no matchea con ningún producto, se puede dar de alta el producto ahí mismo. No lo dejes sin vincular: ese costo no llega al precio de venta.',
        ],
      },
      {
        tipo: 'campos',
        titulo: 'Tres cosas que hay que mirar en cada renglón',
        filas: [
          ['Viene por bulto', 'Si el renglón dice "X 24B", "PACK X 6" o similar, el sistema muestra la cuenta hecha (84 bultos = 2.016 unidades) y un botón "Pasar a unidad". Tocalo si el producto vinculado es la botella suelta. Dejalo como está solo si vinculaste el cajón entero.'],
          ['Bonificado', 'Los renglones sin cargo aparecen marcados. Si el mismo producto viene dos veces —con cargo y bonificado— entran como uno solo, con el costo repartido entre todas las unidades: 18 cajas al costo de 15.'],
          ['El costo no coincide', 'Abajo está la cuenta escrita: de cuánto se leyó a cuánto quedó, y con qué impuestos. Si aparece un aviso amarillo, los renglones no suman el neto del pie y hay que revisarlo ANTES de registrar.'],
        ],
      },
    ],
  },
  {
    id: 'admin-remarcacion',
    titulo: 'Costos, remarcación y precio de venta',
    area: 'Administración',
    roles: ['administrativo', 'comprador', 'gerente', 'dueno'],
    bajada: 'Cómo se convierte el costo de la factura en el precio de la góndola.',
    bloques: [
      {
        tipo: 'texto',
        texto:
          'La primera vez que entra un producto de un proveedor se elige el porcentaje de remarcación. A partir de ahí el sistema lo recuerda: la próxima vez que ese producto entre por ese proveedor, propone el mismo porcentaje, con opción de cambiarlo.',
      },
      {
        tipo: 'campos',
        filas: [
          ['Remarcación habitual', 'La que el sistema recuerda y aplica sola.'],
          ['Remarcación ocasional', 'Para una compra puntual (el proveedor sacó un precio excepcional). Afecta solo esa entrada; la próxima vuelve la habitual.'],
          ['Fijar la remarcación', 'Marcala como fija cuando querés que ese porcentaje pase a ser el nuevo habitual.'],
          ['Percepciones', 'Las percepciones de IVA e IIBB entran al costo. Son pago a cuenta de impuestos propios, así que en los libros no serían costo, pero solo dejan de serlo si después se usan contra ese impuesto: acumuladas sin consumir son plata que salió y no vuelve. Se pueden sacar en una factura puntual con el tilde "Percepciones al costo".'],
        ],
      },
      {
        tipo: 'ojo',
        puntos: [
          'Los precios se redondean a la centena: de 50 para arriba sube, de 50 para abajo baja. Los de menos de cien pesos quedan como están.',
          'El precio que ve el cliente sale de la lista. Si un precio quedó mal, se corrige en el sistema, no con una etiqueta escrita a mano.',
        ],
      },
    ],
  },
  {
    id: 'admin-productos',
    titulo: 'Dar de alta un producto',
    area: 'Administración',
    roles: ['administrativo', 'comprador', 'gerente', 'dueno'],
    bajada: 'La ficha completa, para que después el producto se encuentre solo.',
    bloques: [
      {
        tipo: 'pasos',
        pasos: [
          'Productos → nuevo producto.',
          'Empezá por el código de barras: si ya es de otro producto, el sistema te avisa en el momento. Cargar el mismo artículo dos veces rompe el stock y los pedidos, y arreglarlo después es a mano.',
          'Nombre, rubro y marca. Si el nombre se parece a uno que ya existe, aparece el aviso.',
          'Medida, unidades por pack, graduación e IVA: el pack es importante, porque de ahí sale que "una de agua" no cotice como el bulto.',
          'Alias de búsqueda: cómo lo pide el cliente. Lo usan el buscador y el bot.',
          'Proveedores que lo traen, con el código de cada uno: eso hace que la próxima factura lo reconozca sola.',
          'Precios y foto. Guardá, o "Guardar y cargar otro" si venís con varios.',
        ],
      },
    ],
  },
  {
    id: 'admin-etiquetas',
    titulo: 'Verificador de precios y etiquetas',
    area: 'Administración',
    roles: ['administrativo', 'deposito', 'cajero', 'gerente', 'dueno'],
    bajada: 'Consultar un precio en el salón e imprimir la etiqueta ahí mismo.',
    bloques: [
      {
        tipo: 'pasos',
        pasos: [
          'Abrí Precios en el equipo de mano.',
          'Pasá el código: aparece el precio en grande.',
          'Si hace falta etiqueta, elegí cuántas copias e imprimí. La impresora se conecta por Bluetooth.',
        ],
      },
    ],
  },

  // ---------------------------------------------------------------- compras
  {
    id: 'compras-pedido',
    titulo: 'Armar un pedido a un proveedor',
    area: 'Compras',
    roles: ['administrativo', 'comprador', 'gerente', 'dueno'],
    bajada: 'Desde el celular, caminando el depósito.',
    bloques: [
      {
        tipo: 'pasos',
        pasos: [
          'Abrí "Pedido a proveedor" y elegí a quién le vas a pedir.',
          'Aparece la lista de productos de ese proveedor. Por defecto solo lo que hace falta reponer; con "Ver toda la lista" ves el resto.',
          'Cada renglón muestra el stock, cuántos días aguanta y cuánto conviene pedir. El sugerido se calcula con lo que se vendió en los últimos 30 días, para cubrir 14.',
          'Cargá las cantidades con los botones, o escribí el número.',
          'Si un producto no está en la lista del proveedor, tocá "+ Producto que no está", buscalo y agregalo. Queda cargado para siempre.',
          '"Enviar a aprobación". El pedido queda esperando la firma del dueño.',
        ],
      },
      {
        tipo: 'ojo',
        puntos: [
          'Mientras no haya ventas cargadas en el sistema, el sugerido va a mostrar cero: no tiene con qué calcular todavía.',
          'La lista de cada proveedor se completa sola cada vez que se recibe mercadería suya.',
        ],
      },
    ],
  },
  {
    id: 'compras-circuito',
    titulo: 'El circuito completo de una compra',
    area: 'Compras',
    roles: ['administrativo', 'comprador', 'gerente', 'dueno'],
    bajada: 'Pedido, aprobación, recepción, factura y pago. Cada paso deja su papel.',
    bloques: [
      {
        tipo: 'pasos',
        pasos: [
          'Orden de compra: qué se le pide al proveedor. Sale en PDF con número propio, para mandársela.',
          'Aprobación: la firma el dueño. Sin firma, la orden no se manda.',
          'Recepción: el depósito escanea lo que llega. Sale el acta de recepción, con lo pedido contra lo recibido.',
          'Factura: administración la carga con el desglose fiscal.',
          'Conciliación: se cruza la factura contra el remito. Es el paso que verifica que te facturaron lo que efectivamente entró.',
          'Orden de pago: junta las facturas que se van a pagar. La firma el dueño y recién ahí se paga.',
        ],
      },
      {
        tipo: 'ojo',
        puntos: [
          'La conciliación no es un trámite: es lo único que evita pagar mercadería que no llegó.',
          'Cada documento lleva número de la casa y no se renumera. Si lo volvés a imprimir, sale el mismo.',
        ],
      },
    ],
  },
  {
    id: 'compras-trazabilidad',
    titulo: 'Trazabilidad: qué quedó sin cerrar',
    area: 'Compras',
    roles: ['administrativo', 'comprador', 'gerente', 'dueno'],
    bajada: 'La pantalla que se mira todos los días para que no se pierda nada.',
    bloques: [
      {
        tipo: 'campos',
        titulo: 'Qué muestra',
        filas: [
          ['Órdenes sin recepción', 'Se pidió y nadie registró que haya llegado.'],
          ['Recibido sin factura', 'Entró stock y la deuda no está cargada.'],
          ['Facturas sin cruzar', 'Están la mercadería y la factura, pero nadie verificó que digan lo mismo.'],
          ['Facturas sin respaldo', 'Se va a pagar algo que nadie contó contra un pedido.'],
          ['Vencidas impagas', 'Vencieron y siguen con saldo.'],
        ],
      },
      {
        tipo: 'texto',
        texto:
          'Desde cualquier orden se abre "Ver cadena": la línea de tiempo completa de esa compra, con quién hizo cada paso, cuándo, y el documento que lo respalda. Es lo que contesta "¿quién autorizó esto?" sin depender de la memoria de nadie.',
      },
    ],
  },

  // --------------------------------------------------------------- clientes
  {
    id: 'ctacte',
    titulo: 'Cuentas corrientes',
    area: 'Clientes y cuenta corriente',
    roles: ['administrativo', 'gerente', 'dueno'],
    bajada: 'Quién debe, cuánto puede deber y quién paga bien.',
    bloques: [
      {
        tipo: 'pasos',
        pasos: [
          'A cada cliente con cuenta corriente se le asigna un tope de crédito.',
          'Cuando consume el 80% del tope, salta el aviso. Al 100%, la caja no lo deja seguir cargando a cuenta.',
          'El tablero muestra el semáforo de riesgo, los que mejor pagan y los que se atrasan.',
        ],
      },
      {
        tipo: 'ojo',
        puntos: [
          'La deuda baja únicamente cuando el dueño aprueba un pago. Ni el cajero ni el repartidor la tocan.',
          'Todo pago aprobado deja recibo numerado para darle al cliente.',
        ],
      },
    ],
  },

  // ---------------------------------------------------------------- reparto
  {
    id: 'reparto',
    titulo: 'Armar el reparto y salir a la calle',
    area: 'Reparto',
    roles: ['repartidor', 'cajero', 'gerente', 'dueno'],
    bajada: 'La hoja de ruta, las entregas y la rendición al volver.',
    bloques: [
      {
        tipo: 'pasos',
        titulo: 'En el local',
        pasos: [
          'Reparto → nueva hoja de ruta. Agregá los clientes que salen en ese viaje.',
          'Cada reparto se numera con el día de la semana y el orden de salida, así se identifica sin confusión.',
          '"Salir a la calle" cuando el repartidor arranca.',
        ],
      },
      {
        tipo: 'pasos',
        titulo: 'En la calle',
        pasos: [
          'El repartidor ve sus entregas del día en su pantalla.',
          'Puede compartir la ubicación mientras reparte, para saber dónde está el camión.',
          '"Marcar entregado" en cada parada.',
        ],
      },
      {
        tipo: 'ojo',
        puntos: [
          'Reparto no es lo mismo que envío a domicilio: el reparto sale con fecha y franja horaria pactadas.',
          'Al volver se rinde: lo que se cobró y lo que quedó a cuenta. Lo cobrado entra como pago pendiente de aprobación; lo no cobrado queda como deuda del cliente en el momento.',
        ],
      },
    ],
  },

  // -------------------------------------------------------------- dirección
  {
    id: 'aprobaciones',
    titulo: 'Aprobaciones: la cola de firmas',
    area: 'Dirección',
    roles: ['dueno', 'gerente'],
    bajada: 'Todo lo que espera la firma del dueño, en una sola pantalla.',
    bloques: [
      {
        tipo: 'campos',
        titulo: 'Qué llega acá',
        filas: [
          ['Órdenes de compra', 'Sin firma no se le manda el pedido al proveedor.'],
          ['Órdenes de pago', 'Es lo único que saca plata de la casa.'],
          ['Cobros a cuenta', 'La deuda del cliente no baja hasta aprobarlo.'],
          ['Cambios en facturas', 'Correcciones o anulaciones de facturas ya cargadas.'],
          ['Cambios de costos', 'Cambian el costo y el precio de venta de varios productos de una.'],
        ],
      },
      {
        tipo: 'ojo',
        puntos: [
          'Arriba va lo que más días lleva esperando, no lo más caro: lo urgente es lo que está frenando a alguien.',
          'Antes de firmar una orden de compra o de pago se puede abrir el documento desde la misma fila.',
          'Firma solo el dueño. Gerencia ve la cola pero no firma. Quien firma queda registrado con su usuario.',
        ],
      },
    ],
  },
  {
    id: 'direccion-numeros',
    titulo: 'Los números del negocio',
    area: 'Dirección',
    roles: ['dueno', 'gerente'],
    bajada: 'Dónde mirar cada cosa.',
    bloques: [
      {
        tipo: 'campos',
        filas: [
          ['Informe diario', 'Resumen del día anterior, sin tener que entrar a buscarlo.'],
          ['Estadísticas', 'Ventas por período, por rubro y por sucursal.'],
          ['Cierres', 'Arqueos por cajero y diferencias de caja.'],
          ['Contable y Libro IVA', 'Lo que se le pasa al contador.'],
          ['ARCA', 'Comprobantes electrónicos con CAE y lo que quedó pendiente de emitir.'],
          ['Mercado Pago y Tarjetas', 'Lo que liquidan contra lo que se cobró.'],
          ['Cheques', 'Cartera de cheques recibidos y emitidos.'],
          ['Eficiencia', 'Cuánto tarda cada área en lo suyo.'],
        ],
      },
    ],
  },

  // --------------------------------------------------------------- whatsapp
  {
    id: 'bot',
    titulo: 'El bot de WhatsApp',
    area: 'WhatsApp',
    roles: ['dueno'],
    bajada: 'Qué contesta solo, qué deriva y cómo se apaga.',
    bloques: [
      {
        tipo: 'texto',
        texto:
          'El bot atiende la línea del local: responde precios, arma pedidos, escucha audios y los contesta. Cuando la consulta es de administración (un pago, un comprobante), la registra y avisa internamente en lugar de mandar al cliente a otro teléfono.',
      },
      {
        tipo: 'texto',
        texto:
          'Las respuestas largas van con imagen de la marca: si pasa una lista de 4 productos o más, o confirma un pedido, además del texto manda un cartel con el isologo de O.D.B — los renglones, el total en la banda negra y, en los pedidos, el código de retiro bien grande para mostrar en el mostrador.',
      },
      {
        tipo: 'ojo',
        puntos: [
          'Todo lo que el bot cotiza sale de la lista de precios del sistema. Si un precio está mal en el sistema, el bot lo va a repetir mal.',
          'Las conversaciones completas se ven en RESPONDE. Ahí se revisa qué contestó y se corrige lo que haga falta.',
          'El bot se puede apagar desde la pantalla del Bot cuando conviene atender a mano.',
        ],
      },
    ],
  },
];
