// El mapa de todas las pantallas del panel. De acá salen el menú del costado,
// «Todas las pantallas», el buscador, el Inicio y el «Volver a …». Una
// pantalla nueva se agrega acá y aparece sola en todos esos lugares.

export type Zona = "salon" | "cocina" | "puerta" | "plata" | "negocio" | "ajustes";

export type Pantalla = {
  href: string;
  titulo: string;
  que: string; // una línea: para qué sirve
  zona: Zona;
  claves?: string; // otras palabras con las que alguien la buscaría
};

export const ZONAS: Record<Zona, { titulo: string; tinta: string; fondo: string; borde: string }> = {
  salon: { titulo: "Salón", tinta: "text-salon", fondo: "bg-salon", borde: "border-salon" },
  cocina: { titulo: "Cocina", tinta: "text-cocina", fondo: "bg-cocina", borde: "border-cocina" },
  puerta: { titulo: "Puerta", tinta: "text-puerta", fondo: "bg-puerta", borde: "border-puerta" },
  plata: { titulo: "Plata", tinta: "text-plata", fondo: "bg-plata", borde: "border-plata" },
  negocio: { titulo: "Negocio", tinta: "text-negocio", fondo: "bg-negocio", borde: "border-negocio" },
  ajustes: { titulo: "Ajustes", tinta: "text-ajustes", fondo: "bg-ajustes", borde: "border-ajustes" },
};

export const ORDEN_ZONAS: Zona[] = ["salon", "cocina", "puerta", "plata", "negocio", "ajustes"];

export const INICIO: Pantalla = { href: "/", titulo: "Inicio", que: "Lo que pasa ahora y lo que hay que hacer.", zona: "salon" };

export const PANTALLAS: Pantalla[] = [
  { href: "/piso-vivo", titulo: "Piso vivo", que: "Todas las mesas, con su reloj. Tocá una mesa para hacer cualquier cosa.", zona: "salon", claves: "mesas salon sentar abrir liberar" },
  { href: "/encargado", titulo: "Encargado", que: "Sentar gente y asignarle mozo.", zona: "salon", claves: "ubicar sentar asignar" },
  { href: "/mozo", titulo: "Mozo", que: "La cola de mesas de cada mozo.", zona: "salon", claves: "comanda pedido atender" },
  { href: "/cocina", titulo: "Pantalla de cocina", que: "Las comandas en orden, con el reloj de cada plato.", zona: "cocina", claves: "parrilla platos comandas" },
  { href: "/carne", titulo: "Carne y preparación", que: "Cuánto rinde cada corte, qué sacar para mañana y qué está agotado.", zona: "cocina", claves: "rinde merma mise en place cortes agotado faltante" },
  { href: "/reservas", titulo: "Reservas y espera", que: "La agenda de la puerta: reservas, lista de espera y mesas libres.", zona: "puerta", claves: "agenda reservar seña fila" },
  { href: "/espera", titulo: "Lista de espera", que: "Los que esperan mesa y el aviso por WhatsApp.", zona: "puerta", claves: "cola fila vereda" },
  { href: "/derivadores", titulo: "Hoteles y guías", que: "Quién manda gente, cuánto consume y qué comisión le toca.", zona: "puerta", claves: "comision agencia remis conserje qr link derivador" },
  { href: "/caja", titulo: "Caja", que: "Cobrar en pesos, reales o dólares. Pix, QR, tarjeta y efectivo.", zona: "plata", claves: "cobrar cuenta pix cambio dolar real pagar" },
  { href: "/compras", titulo: "Compras", que: "Facturas de proveedores y precios que subieron.", zona: "plata", claves: "proveedores facturas insumos" },
  { href: "/tablero", titulo: "Tablero del dueño", que: "Ayer explicado, mozos, qué deja cada plato y cuánta gente viene.", zona: "negocio", claves: "resumen analista revpash informe pronostico menu ingenieria feriados" },
  { href: "/resenas", titulo: "Reseñas", que: "Las reseñas de Google, la respuesta y de qué se quejan.", zona: "negocio", claves: "google opiniones estrellas tripadvisor" },
  { href: "/post-visita", titulo: "Después de la visita", que: "El mensaje del día siguiente a quien dejó su WhatsApp.", zona: "negocio", claves: "agradecimiento whatsapp seguimiento" },
  { href: "/clientes", titulo: "Clientes", que: "Los WhatsApp que dejaron los clientes.", zona: "negocio", claves: "contactos base telefonos" },
  { href: "/carta", titulo: "Carta", que: "Platos, precios, fotos, idiomas y alérgenos.", zona: "ajustes", claves: "menu platos precios traducir alergenos costo" },
  { href: "/configuracion", titulo: "Configuración", que: "Asientos, horas de servicio y mozos.", zona: "ajustes", claves: "ajustes mozos capacidad" },
];

const sinTildes = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export function buscarPantallas(texto: string): Pantalla[] {
  const t = sinTildes(texto.trim());
  if (!t) return PANTALLAS;
  return PANTALLAS.filter((p) => sinTildes(`${p.titulo} ${p.que} ${p.claves ?? ""} ${ZONAS[p.zona].titulo}`).includes(t));
}

export function pantallaDe(path: string): Pantalla {
  const limpio = path.split("?")[0].replace(/\/$/, "") || "/";
  if (limpio === "/") return INICIO;
  return PANTALLAS.find((p) => limpio === p.href || limpio.startsWith(p.href + "/")) ?? INICIO;
}
