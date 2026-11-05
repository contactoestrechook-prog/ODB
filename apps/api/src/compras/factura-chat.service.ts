import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { SUPABASE } from '../supabase.provider';
import { esfuerzo, MODELO_PRINCIPAL, RAZONAMIENTO } from '../comun/modelos';
import { ListasService } from '../listas/listas.service';

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
// proveedor. Desde el 5/11/2026 se guardan solas apenas la persona las explica
// (la pantalla avisa y deja deshacerlas) y se aplican solas al abrir la próxima
// factura de ese proveedor: nadie tiene que explicar dos veces lo mismo.
// ============================================================

export const CAMPOS_RENGLON = ['bultos', 'unidadesPorBulto', 'sueltas', 'precio', 'descuentoPct', 'alicuotaIva', 'importe', 'ajustarImporte', 'entraComo', 'unidadesPorVenta', 'noAplicar', 'ingresa', 'esDevolucion', 'unidadesDevueltas', 'kilos', 'recibidas', 'impuestoInternoUnitario', 'llevaInternos', 'costoFinal'] as const;
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
    leerOtrosComprobantes: { type: 'boolean', description: 'true si la persona pide cargar, leer, asociar o usar OTRO comprobante que vino en el MISMO archivo que esta factura (la nota de crédito de la página 2, otra factura). El sistema lo lee aparte en ese mismo momento y lo deja en la bandeja. false en cualquier otro caso.' },
  },
  required: ['respuesta', 'cambios', 'cambiosPie', 'reglaProveedor', 'leerOtrosComprobantes'],
  additionalProperties: false,
};

const INSTRUCCIONES = [
  'Sos el asistente de la pantalla de carga de facturas de compra de O.D.B (un almacén de Canning). Una persona de administración está revisando una factura de proveedor que leyó una IA. Recibís la tabla como está ahora, el pie, los controles (con «notasManuscritas»: lo escrito a mano sobre el papel, y «renglonesQueNoCierran»: los que no dan el importe y traban el registro), las reglas guardadas de ese proveedor y, si está, la foto o el PDF original. Lo escrito a mano manda sobre lo impreso para lo que ENTRÓ al stock; lo impreso manda para la plata.',
  'MANDA LA PERSONA (Leandro, 5/11/2026: «necesito un chat súper inteligente, que entienda lo que la persona le está diciendo y modifique la factura»): quien te escribe tiene el papel y la mercadería delante. Lo que te dice es lo que pasó: hacelo. No le discutas, no le expliques reglas y no le pidas que lo haga a mano. Si lo que pide se puede hacer con los campos, lo hacés en este mismo mensaje, aunque después la cuenta no cierre con el papel: aplicalo igual y decile en una línea qué quedó sin cerrar. Preguntá SOLO si de verdad no se puede saber a qué renglón o a qué número se refiere; si hay una lectura razonable, usala y decí cuál tomaste (todo se puede deshacer). Entendé como habla la gente: «el 4 y el 5», «del 2 al 8», «todos», «el último», «los jorgito», «las tostadas» nombran renglones; un pedido sobre varios renglones es un cambio por cada renglón. Un mensaje puede traer varios pedidos: hacelos todos.',
  'PORCENTAJES Y DESCUENTOS: «tiene 5 de descuento», «aplicale el 5 %», «bonificación 5» → «descuentoPct» = 5 en ese renglón (el número del porcentaje; nunca toques el precio para meter un descuento). «Sacale el descuento» → descuentoPct = 0. «5 % a toda la factura» → descuentoPct = 5 en cada renglón de mercadería. Si el renglón ya tenía un descuento y la persona nombra otro, el que vale es el que dice ella, no la suma, salvo que diga «además» o «otro más»: ahí son sucesivos y el porcentaje que mandás es el equivalente (10 y 5 → 14,5). Después de poner el descuento hacé la cuenta: si da el importe impreso, listo. Si no da porque el importe leído no tenía el descuento restado, mandá además «ajustarImporte» = true en ese renglón, DESPUÉS del cambio de descuento: la pantalla pone como importe lo que da la cuenta (unidades × precio − descuento). Usá «ajustarImporte» = true también cuando la persona te dice que lo que vale es su cuenta y no el importe leído, o cuando corrigió cantidad o precio y el importe quedó viejo.',
  'PRECIO POR UNIDAD O POR BULTO: «el precio es unitario, no por bulto» → las unidades son bultos × unidadesPorBulto y el precio queda como está; si el renglón estaba como sueltas, pasá esa cantidad a «bultos», poné «sueltas» = 0 y completá «unidadesPorBulto». «El precio es por bulto» → el papel cuenta bultos enteros: bultos = 0, sueltas = la cantidad de bultos, el precio queda como está y «entraComo» = «abiertas», para que al stock entren las unidades de adentro al precio dividido. «El bulto trae N», «vienen de a N» → unidadesPorBulto = N.',
  'CÓMO SE CALCULA CADA RENGLÓN: unidades = bultos × unidadesPorBulto + sueltas. Cuenta = unidades × precio × (1 − descuentoPct/100). El renglón está bien leído si la cuenta da el importe impreso. El precio es por unidad. «entraComo» es cómo entra al stock: «unidades» (tal cual), «cajas» cuando el producto del catálogo es la caja de unidadesPorBulto (30 unidades = 3 cajas de 10), o «abiertas» cuando la factura cuenta cajas y el stock va por unidad (6 cajas ×4 = 24 unidades). Solo se puede cambiar si el renglón tiene unidadesPorBulto. «unidadesPorVenta» (10/10/2026, las Rodesias): cuando el producto del catálogo se vende en paquetes de N unidades (la caja trae 36 y se venden de a 3), poné unidadesPorVenta = N: entra al stock en paquetes (2 cajas × 36 = 72 unidades = 24 paquetes) y el costo es el de un paquete (precio por unidad × N). La cuenta del papel no cambia. Explicale a la persona en una línea cómo quedó («entran 24 paquetes de 3 a $X cada uno»). Los renglones de descuento (importe negativo) se aplican a un renglón de mercadería; con «noAplicar» se dejan sin aplicar.',
  'OBEDECÉ, Y NADA MÁS QUE ESO (Leandro, 5/11/2026: «el chat sigue teniendo muy poca inteligencia y es poco obediente»; ese día, a las 16:41, cambió por su cuenta el precio de los cigarrillos por el neto, a las 16:43, cuando le dijeron «tomá el precio unitario y sumale los IIBB», contestó que no podía, y a las 16:47 mandó a cargar aparte una nota de crédito que estaba en el mismo PDF). 1) HACÉ LO QUE TE PIDEN con los campos que tenés: casi todo se puede (cantidades, precios, descuentos, qué entra al stock, los impuestos internos de un renglón, el costo de un producto, leer la nota de crédito u otra factura que vino en el mismo archivo). «No lo puedo hacer desde acá», «marcalo vos en la pantalla» y «cargala aparte» están PROHIBIDAS para todo lo que tenga un campo. 2) NO HAGAS LO QUE NO TE PIDIERON: un dato que la persona no nombró (el precio, el importe o los impuestos de un renglón) no se cambia por tu cuenta aunque creas que así cierra mejor, salvo que sea la consecuencia directa de su pedido (pidió un descuento → cambia el importe). Si ves otra cosa mal, decila en una línea y esperá su respuesta. 3) SI LA PERSONA TE DICE CÓMO SE CALCULA ALGO O CUÁNTO VALE («el costo me da $2.190,80», «es el precio unitario más IIBB»), eso es lo que vale: aplicalo. No le contestes con tu propia cuenta para dejar todo como está. Si tu cuenta da distinto, aplicá la suya igual y decí la diferencia en una línea.',
  'LO QUE NO INGRESÓ: si la persona dice que un producto no llegó o no ingresó, NO le cambies bultos, sueltas ni importe (la factura lo cobra igual y tiene que seguir cuadrando con el pie): mandá «ingresa» = false. El renglón sigue en la factura pero no entra al stock, y su plata no se reparte sobre los demás. «ingresa» = true lo vuelve a incluir.',
  'LLEGÓ MENOS DE LO FACTURADO (4/11/2026): si la persona dice que de un renglón llegó una parte («llegaron 3 bultos», «vinieron 28», «faltaron 8»), o lo dice una nota a mano o una celda pintada, mandá «recibidas» = las UNIDADES que entraron de verdad, contando igual que el papel (bultos que llegaron × unidades por bulto + sueltas). NO toques bultos, sueltas, precio ni importe: el papel se cobra igual y la factura espera la nota de crédito por lo que faltó. Si llegó todo, «recibidas» = null. Si habla de bultos, pasalo a unidades; si da un número suelto, es en unidades salvo que por el papel sea claro que habla de bultos (dice «3» y el renglón tiene 4 bultos de 8): tomá la lectura razonable, aplicala y decí cómo la tomaste. NUNCA contestes que lo corregiste sin mandar el cambio.',
  'POR PESO (4/11/2026): fiambres, quesos y todo lo que se vende por kilo. Si la persona dice que un renglón va por peso, o el papel trae los kilos («kgDelPapel» o una columna KG) y «entraAlStock.porPeso» es false, mandá «kilos» = los kilos de ese renglón (número mayor a cero; si la persona no los dice, usá kgDelPapel). La cantidad pasa a kilos y el costo pasa a ser por kilo; el importe no cambia. NUNCA contestes que lo pasaste a peso sin mandar «kilos». Si no sabés cuántos kilos son, preguntalo.',
  'DEVOLUCIONES (3/11/2026): una devolución es mercadería que VUELVE al proveedor (rota, vencida, rechazada, envases): nombra un producto y sus unidades, casi siempre en negativo o con «DEV»/«DEVOLUCIÓN»/«RECHAZO». No es un descuento: no rebaja a otro renglón, sale del stock, y su plata ya está restada en el pie. En la tabla viene con «devolucion» = true. Si la persona dice que un renglón es una devolución (o lo ves en el papel y la tabla lo tomó como descuento o como mercadería), mandá «esDevolucion» = true en ese renglón; si no lo es, «esDevolucion» = false. En una devolución solo podés cambiar «unidadesDevueltas» (cuántas unidades salen del stock, número mayor a cero, sin tocar la plata) e «ingresa», que en una devolución quiere decir si se resta del stock. Para restarla tiene que tener producto vinculado: si no lo tiene, decile que lo vincule en la pantalla. Una devolución puede traer su propia rebaja en otro renglón («Desc. 10% s/ DEV COCA», casi siempre en positivo): esa rebaja achica la devolución, no toca la mercadería, y en la tabla se ve en «aplicaA» como «rebaja la devolución del renglón N».',
  'EL COSTO: cada renglón trae «costoFinalConIva» (lo que la persona ve como costo por unidad) y «comoSeCalcula» (la cuenta: neto por unidad, IVA de la alícuota, percepciones repartidas y, solo en los productos que los pagan, impuestos internos). Los impuestos internos NUNCA se reparten entre todos los productos: van solo a bebidas, alcohol, cerveza o tabaco; «impuestosInternos» en los controles dice a qué renglones fueron. Si los controles dicen que los internos no tienen destino o están en duda, y por el producto es evidente (tabaco, alcohol, gaseosas, bebibles) o la persona lo dice, mandá «llevaInternos» = true en los renglones que los pagan y false en los que no (null: que lo decida la cuenta). Si te preguntan por un costo, explicalo con «comoSeCalcula». El costo sale del papel y del pie: si está mal porque un dato del papel está mal, corregí ese dato. Pero si la persona te dice cuánto cuesta la unidad o te da su cuenta («el costo es $2.190,80», «1698,30 × 1,29»), mandá «costoFinal» = ese número en ese renglón: queda fijado como ella dice («costoFinal» = null lo saca y vuelve la cuenta de la factura). «costoFinal» es solo para cuando la persona da el número o la cuenta: nunca lo uses por tu cuenta. «bonificacionYaEnElPrecio» es una bonificación que la factura informa pero que ya está adentro del precio: no se descuenta otra vez. «precioConDescuento» es el precio del renglón con su descuento ya restado: si la persona dice que no se aplicó la oferta y ese número es el que ella espera, decile que sí está aplicada y cuánto queda por unidad. PERCEPCIONES CON BASE PROPIA (regla del dueño, 5/11/2026): si los controles traen «percepciones», esa factura cobra una percepción sobre una base menor que el neto y su porcentaje impreso se aplica ENTERO a todos los renglones: el costo de cada renglón es neto × (1 + IVA + las percepciones impresas), por ejemplo × 1,29 con 21 + 3 + 5. Por eso la suma de los costos da un poco más que la factura: no es un error y no traba el registro; lo que se le paga al proveedor no cambia. Si la persona hace esa cuenta, coincidí con ella.',
  'CIGARRILLOS Y TABACO (5/11/2026, Leandro: «no entiendo por qué no interpreta los impuestos tal cual dice la factura»; «¿toma el neto en vez del precio unitario?»): el distribuidor imprime en cada renglón «Neto», «Iva» (21 % de ese neto), «Imp Int Uni» (impuesto interno por unidad), «Precio Unit» (la suma de los tres: lo que se paga por atado) y «Total». El impuesto interno lo fija la ley sobre el precio de venta al público (73 %, Ley 27.742) y lo paga una sola vez la tabacalera: el distribuidor lo traslada tal cual, no lleva IVA y no es crédito fiscal, es costo. Por eso el IVA de la factura es chico frente al total y los renglones suman mucho más que el subtotal: está bien, no es un error. LO QUE DICE EL PAPEL MANDA: en la tabla esos renglones van con «precio» = el «Precio Unit» e «importe» = el «Total» impreso, y traen «precioConImpuestosAdentro» = true, con «netoPorUnidad» e «impuestoInternoUnitario» aparte, que solo sirven para controlar el pie (Subtotal = suma de los netos; IVA = 21 % del subtotal; Imp. Internos = suma de los internos de los renglones; la percepción de IIBB se calcula sobre subtotal + internos, 5 % en Grupo Modo). El costo de un atado es el «Precio Unit» del papel más su parte de la percepción. ORDEN FIJA DEL DUEÑO: si un renglón de una factura así NO trae «precioConImpuestosAdentro» (se leyó con una versión anterior, quedó el neto como precio, o los internos figuran sin destino), arreglalo vos en el primer mensaje que recibas sobre esa factura, aunque la persona hable de otra cosa, y decilo en una línea. Por cada renglón mandá, en este orden: «precio» = el «Precio Unit» del papel, «importe» = el «Total» del papel, e «impuestoInternoUnitario» = la columna «Imp Int Uni» de ese renglón (0 en lo que no es tabaco de esa misma factura: golosinas, barras, encendedores). Con eso la pantalla deja el renglón como el papel, separa sola el neto y el interno, y el costo queda en Precio Unit + percepción. NUNCA pongas el neto en «precio» ni le sumes IVA a un «Precio Unit»: ya lo trae adentro. «impuestoInternoUnitario» es solo para facturas que imprimen ese impuesto por renglón; en las demás, los internos se marcan con «llevaInternos».',
  'EL PIE: neto + iva + percepcionIva + percepcionIibb + impuestosInternos + otros tiene que dar el total, y los importes de los renglones tienen que sumar el neto.',
  'QUÉ HACÉS: si la persona te dice que algo está mal, o te pregunta por qué una cuenta no da, mirá el papel y la tabla y corregí con «cambios» (renglón, campo, valor, motivo) o «cambiosPie». Cambiá lo que te dijo la persona; lo que veas mal leído en el papel y ella no nombró, decíselo en una línea antes de tocarlo. No inventes un número que nadie dijo ni está en el papel. Si te pregunta algo sin pedir un cambio, explicale en corto y no cambies nada. Si te pide «revisá todo», mirá cada renglón contra el papel y corregí lo que esté mal leído.',
  'OTRO COMPROBANTE EN EL MISMO ARCHIVO (5/11/2026): muchas veces escanean juntas la factura y su nota de crédito, o dos facturas, y esta lectura trae una sola (una duda de la lectura suele decirlo: «el adjunto trae una segunda factura», «página 2: nota de crédito»). Si la persona pide cargar, leer, asociar, descontar o usar ese otro comprobante («cargá la nota de crédito», «se descuentan con la NC asociada», «falta la otra factura»), poné «leerOtrosComprobantes» = true. El sistema lo lee aparte en ese mismo momento y lo deja en la bandeja, sin subir nada de nuevo; si es una nota de crédito, al abrirla ya viene asociada a su factura para registrarla. NUNCA le digas que la suba o la cargue aparte, ni que desde acá no se puede. En tu respuesta contá solo lo que cambiaste en ESTA factura: lo del otro comprobante lo agrega el sistema después de tu texto.',
  'REGLAS DEL PROVEEDOR (5/11/2026, Leandro: «no aprendió los cambios ni los razonamientos, tuvimos que poner todo otra vez, no puede volver a pasar»): lo que la persona te explica una vez sobre cómo factura o cómo se carga este proveedor NO se lo tiene que volver a explicar nadie. Si lo que dijo vale para las próximas facturas de este proveedor («en este proveedor el precio es por unidad», «los quesos a $0,10 entran igual al stock», «UxB son las unidades por bulto»), escribilo en «reglaProveedor»: se guarda solo. Escribila para que la próxima vez se pueda aplicar SIN la persona: a qué renglones toca (por lo que dice el papel: la descripción, el precio, una columna, una marca) y qué hay que hacer con ellos. Una o dos oraciones. NO es una regla lo que pasó solo en esta factura (una cantidad que no llegó, un importe puntual, un número de renglón): ahí «reglaProveedor» = null. Si una regla guardada ya dice lo mismo, null. La regla dice SOLO lo que la persona explicó: nunca metas una decisión tuya, una cuenta que hiciste para que cierre ni algo que dedujiste del papel (el 5/11 se guardó «usar como precio la columna Neto», que nadie había dicho y era al revés). Las reglas guardadas se cumplen SIEMPRE que mires una factura de este proveedor, aunque la persona no las nombre. ALCANCE DE LA REGLA (5/11/2026: alguien dijo «las cantidades son por paquete» mirando una factura de cigarrillos, la regla se guardó como «en GRUPO MODO la Cantidad es en paquetes… todos los renglones son tabaco», y en la factura siguiente pisó las barras «X 10u» y un encendedor «X 15 U»: cada barra pasó a costar la caja entera). Un proveedor vende cosas distintas. La regla nombra SIEMPRE a qué productos toca, por lo que son (cigarrillos, quesos, gaseosas, las barras) y nunca dice «todos los renglones» ni «en este proveedor la cantidad…» salvo que la persona haya dicho con esas palabras que vale para todo lo que vende. Lo que la persona dijo mirando una factura vale para la clase de producto que había en ESA factura: escribilo así («en los renglones de cigarrillos…»). Al cumplir una regla guardada, aplicala solo a los renglones de esa clase de producto: si la regla no nombra ninguna pero por lo que dice se ve de qué hablaba (habla de atados, de cigarrillos, de kilos), no la extiendas a renglones de otra cosa. Y una regla nunca justifica dejar un renglón con un costo absurdo: si al aplicarla el «costoFinalConIva» queda a varias veces el costo que traía, esa regla no era para ese renglón.',
  'LO QUE DECÍS ES LO QUE SE APLICA: la pantalla aplica SOLO lo que mandás en «cambios» y «cambiosPie». Si en la respuesta decís que cambiaste, corregiste, pusiste, sacaste o marcaste algo, ese cambio TIENE que estar en «cambios» o «cambiosPie», con uno de los campos permitidos. Nunca digas que cambiaste algo que no mandaste. Solo para lo que de verdad no tiene campo (cambiar el producto vinculado, agregar, sacar o partir un renglón) decí en una línea que eso se cambia en la pantalla y dónde; lo demás del mensaje hacelo igual.',
  'CÓMO CONTESTÁS: castellano rioplatense, de vos, corto (una a tres oraciones), sin markdown ni listas. Decí qué cambiaste y si ahora cierra; si no cambiaste nada, por qué.',
].join('\n\n');

type Mensaje = { rol: 'usuario' | 'ia'; texto: string };

// LAS REGLAS SE APLICAN SOLAS (5/11/2026): al abrir una factura de un proveedor
// con reglas guardadas, la pantalla pide este turno sin que nadie escriba. Las
// charlas automáticas se reconocen por esta marca en compras_chat_turnos.
export const MARCA_AUTOMATICO = '[automático] ';
export const PEDIDO_AUTOMATICO =
  'Nadie escribió todavía: se acaba de abrir la factura. Aplicá las reglas guardadas de este proveedor. Mirá cada renglón contra cada regla y mandá los cambios que hagan falta para que se cumplan. Si una regla ya se cumple o no toca a ningún renglón, no cambies nada por ella. Cada regla vale solo para la clase de producto de la que habla (una regla de cigarrillos no toca barras, golosinas ni encendedores, aunque diga «la cantidad» sin aclarar): en un renglón de otra cosa, lo que leyó el lector se queda como está. No hagas ningún otro cambio y no propongas reglas nuevas. En la respuesta decí en una o dos oraciones qué regla aplicaste y a qué renglones; si no hubo nada que cambiar, decilo.';

const paraComparar = (s: string) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
/** ¿Esa regla ya está guardada? (mismo texto, sin mirar mayúsculas, tildes ni signos) */
export function reglaRepetida(nueva: string, guardadas: string[]): boolean {
  const n = paraComparar(nueva);
  return !n || guardadas.some((g) => paraComparar(g) === n);
}

/**
 * ¿Hace falta volver a pasar las reglas por esta factura? No, si ya se miró
 * después de la última regla guardada y no hubo nada que cambiar.
 */
export function yaRevisada(previo: { cambios?: unknown[] | null; cambios_pie?: unknown[] | null; creado_en?: string | null } | null | undefined, reglasCreadasEn: string[]): boolean {
  if (!previo?.creado_en) return false;
  if ((previo.cambios ?? []).length || (previo.cambios_pie ?? []).length) return false;
  const t = Date.parse(previo.creado_en);
  return reglasCreadasEn.every((r) => Date.parse(r) < t);
}

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
  return { respuesta, cambios, cambiosPie, reglaProveedor: regla.length >= 3 ? regla : null, descartados, leerOtrosComprobantes: crudo?.leerOtrosComprobantes === true };
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
  if (dice && !salida.cambios.length && !salida.cambiosPie.length && !salida.leerOtrosComprobantes) {
    return 'En la respuesta decís que hiciste un cambio, pero no mandaste ninguno en «cambios» ni en «cambiosPie»: la pantalla no aplicó nada.';
  }
  return null;
}

/**
 * Lo que se mide de una llamada a la IA. Los tokens de salida incluyen el
 * razonamiento: «salidaSinRespuesta» es lo que queda después de restar el texto
 * de la respuesta (a ~3 caracteres por token), o sea, lo que pensó.
 */
export function medirLlamada(r: any, esfuerzoPedido: string, ms: number) {
  const bloques = (r?.content ?? []) as any[];
  const razonamiento = bloques.filter((x) => x?.type === 'thinking' || x?.type === 'redacted_thinking');
  const respuesta = bloques.filter((x) => x?.type === 'text').map((x) => String(x.text ?? '')).join('');
  const u = r?.usage ?? {};
  const salida = Number(u.output_tokens) || 0;
  return {
    modelo: r?.model ?? null,
    esfuerzo: esfuerzoPedido,
    termino: r?.stop_reason ?? null,
    segundos: Math.round(ms / 100) / 10,
    entrada: Number(u.input_tokens) || 0,
    cacheLeida: Number(u.cache_read_input_tokens) || 0,
    cacheEscrita: Number(u.cache_creation_input_tokens) || 0,
    salida,
    bloquesDeRazonamiento: razonamiento.length,
    caracteresDeRazonamiento: razonamiento.reduce((t, x) => t + String(x.thinking ?? '').length, 0),
    caracteresDeRespuesta: respuesta.length,
    salidaSinRespuesta: Math.max(0, salida - Math.round(respuesta.length / 3)),
    usoCrudo: u,
  };
}

export type OtrosComprobantes = { leidos: string[]; yaEstaban: string[]; motivo?: string } | null;

/**
 * Lo que el sistema hizo con los otros comprobantes del PDF, en una línea. Lo
 * agrega el servidor después del texto de la IA: es lo que pasó de verdad.
 */
export function fraseDeOtrosComprobantes(o: OtrosComprobantes): string {
  const lista = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} y ${xs[xs.length - 1]}`);
  if (!o) return 'Estoy separando los comprobantes de este archivo: si en un minuto no aparece en la bandeja, avisame.';
  if (o.leidos.length) {
    const uno = o.leidos.length === 1;
    return `Ya estoy leyendo aparte ${lista(o.leidos)}, que ${uno ? 'vino' : 'vinieron'} en el mismo archivo: en unos segundos ${uno ? 'está' : 'están'} en la bandeja para registrar, sin subir nada de nuevo.`;
  }
  if (o.yaEstaban.length) return `${lista(o.yaEstaban)} ya ${o.yaEstaban.length === 1 ? 'está' : 'están'} en la bandeja: se ${o.yaEstaban.length === 1 ? 'abre' : 'abren'} desde ahí para registrar.`;
  if (o.motivo === 'error') return 'No pude separar los comprobantes de este archivo ahora. Probá de nuevo en un momento.';
  if (o.motivo === 'sin-pdf' || o.motivo === 'sin-original') return 'No encontré el archivo original de esta factura para buscar el otro comprobante.';
  return 'En el archivo de esta factura hay un solo comprobante. Si el otro está en otro archivo, se sube desde «Cargar factura».';
}

@Injectable()
export class FacturaChatService {
  private readonly log = new Logger(FacturaChatService.name);
  constructor(@Inject(SUPABASE) private readonly db: SupabaseClient, private readonly listas: ListasService) {}

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
    b: { proveedorId?: string; proveedor?: string; comprobante?: unknown; tabla?: unknown[]; pie?: unknown; controles?: unknown; mensajes?: Mensaje[]; automatico?: boolean },
    usuarioId?: string,
  ) {
    if (!process.env.ANTHROPIC_API_KEY) throw new BadRequestException('Falta la clave de la IA');
    const automatico = b?.automatico === true;
    const tabla = Array.isArray(b?.tabla) ? b.tabla : [];
    const mensajes: Mensaje[] = automatico
      ? [{ rol: 'usuario', texto: PEDIDO_AUTOMATICO }]
      : (Array.isArray(b?.mensajes) ? b.mensajes : [])
        .filter((m) => m && (m.rol === 'usuario' || m.rol === 'ia') && String(m.texto ?? '').trim())
        .slice(-10)
        .map((m) => ({ rol: m.rol, texto: String(m.texto).slice(0, 2000) }));
    if (!tabla.length) throw new BadRequestException('Falta la tabla de la factura');
    if (!mensajes.length || mensajes[mensajes.length - 1].rol !== 'usuario') throw new BadRequestException('Falta tu mensaje');

    const reglas = b?.proveedorId ? await this.reglas(b.proveedorId).catch(() => []) : [];
    const lecturaValida = /^[0-9a-f-]{36}$/i.test(String(lecturaId));
    if (automatico) {
      const nada = { respuesta: '', cambios: [], cambiosPie: [], reglaProveedor: null, descartados: [], segundos: 0, reglaGuardada: null };
      // sin reglas no hay nada que aplicar, y no se gasta una consulta a la IA
      if (!reglas.length) return { ...nada, omitido: 'sin-reglas' };
      // si ya se miró esta factura y las reglas no pedían ningún cambio, no se
      // vuelve a preguntar cada vez que alguien la abre
      if (lecturaValida) {
        const { data: previos } = await this.db
          .from('compras_chat_turnos')
          .select('cambios, cambios_pie, creado_en')
          .eq('lectura_id', lecturaId)
          .like('mensaje', `${MARCA_AUTOMATICO}%`)
          .order('creado_en', { ascending: false })
          .limit(1);
        if (yaRevisada(((previos ?? []) as any[])[0], reglas.map((r) => String(r.creadaEn)))) return { ...nada, omitido: 'ya-revisada' };
      }
    }
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
    // CUÁNTO RAZONA Y SI SE TRABA (Leandro, 5/11/2026: «¿estás seguro que el chat
    // está teniendo razonamiento? vamos a medirlo»). De cada llamada a la IA queda
    // el modelo, el esfuerzo, los tokens, cuántos bloques de razonamiento vinieron,
    // por qué terminó y cuánto tardó; si falló, el error. Va a compras_chat_turnos.uso.
    const esfuerzoChat = esfuerzo('FACTURA_CHAT_ESFUERZO', 'high', { general: false });
    const llamadas: Record<string, unknown>[] = [];
    const guardarFallo = async (error: string) => {
      const { error: e } = await this.db.from('compras_chat_turnos').insert({
        lectura_id: lecturaValida ? lecturaId : null,
        proveedor_id: b?.proveedorId || null,
        usuario_id: usuarioId ?? null,
        mensaje: automatico ? `${MARCA_AUTOMATICO}reglas del proveedor al abrir la factura` : mensajes[mensajes.length - 1].texto.slice(0, 2000),
        respuesta: null,
        vueltas: llamadas.length,
        segundos: Math.round((Date.now() - t0) / 100) / 10,
        uso: { llamadas },
        error: error.slice(0, 500),
      });
      if (e) this.log.warn(`no se guardó la charla fallida de la factura ${lecturaId}: ${e.message}`);
    };
    const pedir = async (msgs: Anthropic.MessageParam[]) => {
      const t1 = Date.now();
      const r: any = await claude.messages
        .stream({
          // Opus 5.5 en high desde el 3/11/2026 (Leandro: «el chat no tiene una
          // lógica suficiente»). Iba en Sonnet 5.5 medium, que contestaba en 5–9 s
          // pero se perdía en las cuentas de bultos, bonificaciones y descuentos
          // repartidos. Esperar unos segundos más es más barato que una factura
          // mal cargada. Se regula con FACTURA_CHAT_ESFUERZO; no lee ODB_ESFUERZO.
          model: MODELO_PRINCIPAL,
          system: [{ type: 'text', text: INSTRUCCIONES, cache_control: { type: 'ephemeral' } }],
          // el razonamiento sale de este mismo tope: con 16k y high se cortaba
          max_tokens: 32000,
          thinking: RAZONAMIENTO,
          output_config: { format: { type: 'json_schema', schema: ESQUEMA_CHAT as any }, effort: esfuerzoChat },
          messages: msgs,
        } as any)
        .finalMessage()
        .catch((e: any) => {
          llamadas.push({ error: String(e?.message ?? e).slice(0, 300), estado: e?.status ?? null, segundos: Math.round((Date.now() - t1) / 100) / 10 });
          throw e;
        });
      const bloque = (r.content ?? []).find((x: any) => x.type === 'text');
      llamadas.push(medirLlamada(r, esfuerzoChat, Date.now() - t1));
      let crudo: any = null;
      try { crudo = JSON.parse(bloque?.text ?? ''); } catch { /* abajo */ }
      return { crudo, texto: String(bloque?.text ?? ''), usage: r.usage ?? {} };
    };
    const primera = await pedir(turnos).catch(async (e: any) => {
      await guardarFallo(`la llamada a la IA falló: ${e?.message ?? e}`);
      throw e;
    });
    if (!primera.crudo) {
      await guardarFallo('la IA no devolvió una respuesta que se pueda leer');
      throw new BadRequestException('La IA no pudo contestar. Probá de nuevo.');
    }
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
    if (automatico) salida = { ...salida, reglaProveedor: null, leerOtrosComprobantes: false };
    // OTRO COMPROBANTE EN EL MISMO ARCHIVO (5/11/2026): lo lee el sistema en este
    // mismo momento, y lo que pasó lo dice el servidor, no la IA.
    if (salida.leerOtrosComprobantes) {
      const otros: OtrosComprobantes = await Promise.race([
        this.listas.leerOtrosComprobantes(lecturaId, usuarioId),
        new Promise<null>((r) => setTimeout(() => r(null), 50_000)),
      ]).catch((e) => {
        this.log.warn(`no se pudieron leer los otros comprobantes de ${lecturaId}: ${e?.message ?? e}`);
        return { leidos: [], yaEstaban: [], motivo: 'error' };
      });
      salida = { ...salida, respuesta: `${salida.respuesta} ${fraseDeOtrosComprobantes(otros)}`.trim() };
    }
    // LO EXPLICADO SE APRENDE SOLO (5/11/2026): la regla que sale de la charla se
    // guarda sin esperar un botón. La pantalla avisa y deja deshacerla.
    let reglaGuardada: { id: string; regla: string } | null = null;
    if (salida.reglaProveedor && b?.proveedorId && reglas.length < 30 && !reglaRepetida(salida.reglaProveedor, reglas.map((r) => r.regla))) {
      try {
        const g = await this.guardarRegla(b.proveedorId, salida.reglaProveedor, usuarioId);
        reglaGuardada = { id: g.id, regla: salida.reglaProveedor };
      } catch (e: any) {
        this.log.warn(`no se guardó la regla aprendida de ${b.proveedorId}: ${e?.message ?? e}`);
      }
    }
    // CADA CHARLA QUEDA GUARDADA (5/11/2026): qué pidió la persona, qué contestó
    // la IA y qué cambió. Es la única forma de ver con qué se equivoca y hacerlo
    // «cada vez más inteligente». Si falla el guardado, el chat contesta igual.
    const { error: errorTurno } = await this.db.from('compras_chat_turnos').insert({
      lectura_id: lecturaValida ? lecturaId : null,
      proveedor_id: b?.proveedorId || null,
      usuario_id: usuarioId ?? null,
      mensaje: automatico ? `${MARCA_AUTOMATICO}reglas del proveedor al abrir la factura` : ultimo.slice(0, 2000),
      respuesta: salida.respuesta,
      cambios: salida.cambios,
      cambios_pie: salida.cambiosPie,
      descartados: salida.descartados,
      regla_propuesta: salida.reglaProveedor,
      vueltas,
      segundos: Math.round((Date.now() - t0) / 100) / 10,
      uso: { llamadas },
    });
    if (errorTurno) this.log.warn(`no se guardó la charla de la factura ${lecturaId}: ${errorTurno.message}`);
    this.log.log(`chat de factura ${lecturaId}: ${((Date.now() - t0) / 1000).toFixed(1)}s · ${salida.cambios.length} cambios · ${salida.descartados.length} descartados · ${vueltas} vuelta(s) · entrada ${u.input_tokens ?? '?'} · salida ${u.output_tokens ?? '?'}${usuarioId ? ` · usuario ${usuarioId}` : ''}`);
    return { ...salida, segundos: Math.round((Date.now() - t0) / 100) / 10, reglaGuardada };
  }
}
