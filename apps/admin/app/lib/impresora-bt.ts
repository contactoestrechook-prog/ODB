// Impresora térmica por Bluetooth (Urovo K419 y compatibles).
//
// Por qué así: el K419 habla CPCL y ESC/POS por Bluetooth 4.0 (BLE), y Chrome
// para Android sabe hablar BLE desde una página web. Con eso el sistema imprime
// etiquetas SIN una app Android intermedia: el equipo de mano abre el panel,
// se empareja una vez con la impresora del cinturón, y listo.
//
// Se usa CPCL y no ESC/POS porque las etiquetas son troqueladas: CPCL maneja el
// gap entre etiquetas y posiciona por coordenadas. Y el código de barras lo
// dibuja LA IMPRESORA (comando BARCODE 128), así que no hay que generarlo acá:
// un código mal dibujado no escanea, o peor, escanea otro producto.

// UUIDs de los perfiles serie sobre BLE que usan estas impresoras. No hay un
// estándar: cada fabricante toma uno. Se prueban todos y, si ninguno aparece,
// se busca cualquier característica que acepte escritura.
const SERVICIOS = [
  '000018f0-0000-1000-8000-00805f9b34fb', // el más común en térmicas chinas
  '0000ff00-0000-1000-8000-00805f9b34fb',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455', // Microchip/ISSC transparent UART
  '6e400001-b5a3-f393-e0a9-e50e24dcca9e', // Nordic UART
  '0000ffe0-0000-1000-8000-00805f9b34fb',
];

export type Etiqueta = {
  nombre: string;
  marca?: string | null;
  precio: number | null;
  promo?: string | null;
  codigo?: string | null; // código de barras a imprimir
  sku?: string | null;
  anchoMm?: number; // ancho de la etiqueta (por defecto 50)
  altoMm?: number; // alto de la etiqueta (por defecto 30)
  copias?: number;
};

const pesos = (n: number | null) => (n == null ? '' : '$' + Math.round(n).toLocaleString('es-AR'));

// Las térmicas no imprimen acentos salvo que se les configure la tabla de
// caracteres. "LIMON" se lee; "LIM?N" es un cartel roto. Se sacan y listo.
const sinAcentos = (s: string) =>
  String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7E]/g, ' ').trim();

/**
 * Arma la etiqueta en CPCL. 203 dpi = 8 puntos por mm.
 * El código de barras lo genera la impresora a partir del número.
 */
export function etiquetaCPCL(e: Etiqueta): Uint8Array {
  const PPM = 8; // puntos por mm a 203 dpi
  const ancho = Math.round((e.anchoMm ?? 50) * PPM);
  const alto = Math.round((e.altoMm ?? 30) * PPM);
  const copias = Math.max(1, Math.min(e.copias ?? 1, 20));

  const nombre = sinAcentos(e.nombre).slice(0, 32);
  const marca = sinAcentos(e.marca ?? '').slice(0, 24);
  const precio = pesos(e.precio);
  const promo = sinAcentos(e.promo ?? '').slice(0, 24);
  const codigo = String(e.codigo ?? '').replace(/\D/g, '');

  const l: string[] = [];
  l.push(`! 0 200 200 ${alto} ${copias}`);
  l.push(`PW ${ancho}`);
  l.push('SETSP 0');
  // nombre (fuente 7 = chica y legible; 5 = más ancha)
  l.push(`TEXT 7 0 8 6 ${nombre}`);
  if (marca) l.push(`TEXT 7 0 8 30 ${marca}`);
  // el precio es lo que se lee de lejos: fuente grande
  l.push(`SETBOLD 2`);
  l.push(`TEXT 5 3 8 ${marca ? 54 : 40} ${precio}`);
  l.push(`SETBOLD 0`);
  if (promo) l.push(`TEXT 7 0 8 ${marca ? 110 : 96} ${promo}`);
  // código de barras dibujado por la impresora (CODE128), con su número debajo
  if (codigo.length >= 6) {
    l.push('BARCODE-TEXT 7 0 5');
    l.push(`BARCODE 128 1 1 40 8 ${alto - 62} ${codigo}`);
    l.push('BARCODE-TEXT OFF');
  } else if (e.sku) {
    l.push(`TEXT 7 0 8 ${alto - 30} SKU ${sinAcentos(String(e.sku))}`);
  }
  l.push('FORM');
  l.push('PRINT');

  const texto = l.join('\r\n') + '\r\n';
  const bytes = new Uint8Array(texto.length);
  for (let i = 0; i < texto.length; i++) bytes[i] = texto.charCodeAt(i) & 0xff;
  return bytes;
}

export function hayBluetooth(): boolean {
  return typeof navigator !== 'undefined' && !!(navigator as any).bluetooth;
}

type Conexion = { device: any; caracteristica: any };
let conexion: Conexion | null = null;

/** Busca una característica que acepte escritura dentro de los servicios del equipo. */
async function buscarCaracteristica(server: any): Promise<any> {
  const servicios = await server.getPrimaryServices();
  for (const s of servicios) {
    let cs: any[] = [];
    try { cs = await s.getCharacteristics(); } catch { continue; }
    const escribible = cs.find((c: any) => c.properties?.write || c.properties?.writeWithoutResponse);
    if (escribible) return escribible;
  }
  throw new Error('La impresora se conectó pero no expone por dónde enviarle los datos.');
}

/** Empareja (pide el permiso al usuario) y deja la conexión lista. */
export async function conectarImpresora(): Promise<string> {
  if (!hayBluetooth()) throw new Error('Este navegador no maneja Bluetooth. Usá Chrome en el equipo de mano.');
  const device = await (navigator as any).bluetooth.requestDevice({
    // se listan TODAS: el nombre del equipo varía por lote y filtrar de más
    // hace que la impresora no aparezca en la lista
    acceptAllDevices: true,
    optionalServices: SERVICIOS,
  });
  const server = await device.gatt.connect();
  const caracteristica = await buscarCaracteristica(server);
  conexion = { device, caracteristica };
  device.addEventListener?.('gattserverdisconnected', () => { conexion = null; });
  return device.name || 'impresora';
}

export function impresoraConectada(): string | null {
  return conexion?.device?.gatt?.connected ? (conexion.device.name || 'impresora') : null;
}

/** Envía los bytes en pedazos: BLE no acepta un envío grande de una. */
async function enviar(bytes: Uint8Array) {
  if (!conexion) throw new Error('No hay impresora conectada.');
  if (!conexion.device.gatt.connected) {
    const server = await conexion.device.gatt.connect();
    conexion.caracteristica = await buscarCaracteristica(server);
  }
  const c = conexion.caracteristica;
  const TROZO = 180;
  for (let i = 0; i < bytes.length; i += TROZO) {
    const parte = bytes.slice(i, i + TROZO);
    if (c.properties?.writeWithoutResponse && c.writeValueWithoutResponse) {
      await c.writeValueWithoutResponse(parte);
      await new Promise((r) => setTimeout(r, 20)); // sin acuse, hay que darle aire
    } else {
      await c.writeValue(parte);
    }
  }
}

/** Imprime una etiqueta. Si no hay impresora emparejada, la pide primero. */
export async function imprimirEtiqueta(e: Etiqueta): Promise<void> {
  if (!impresoraConectada()) await conectarImpresora();
  await enviar(etiquetaCPCL(e));
}
