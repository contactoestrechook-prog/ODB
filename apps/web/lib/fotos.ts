// Mapea el nombre de un producto a fotos por TIPO en apps/web/public/cat/<tipo>-<n>.jpg.
// Devuelve VARIAS candidatas (hash → variante distinta por producto); el componente
// prueba en orden y, si una no existe, pasa a la siguiente o al tile de marca.
const REGLAS: { tipo: string; kw: string[] }[] = [
  { tipo: "espumante", kw: ["espumante", "champ", "prosecco", "cava", "brut nature"] },
  { tipo: "vino", kw: ["vino", "malbec", "cabernet", "syrah", "merlot", "bonarda", "chardonnay", "sauvignon", "pinot", "tannat", "torrontes", "tinto", "blanco", "rosado", "cuvee", "boher", "gascon", "septima", "rutini", "zuccardi", "viognier"] },
  { tipo: "fernet", kw: ["fernet"] },
  { tipo: "whisky", kw: ["whisky", "whiskey", "jack daniel", "chivas"] },
  { tipo: "gin", kw: ["gin ", "ginebra"] },
  { tipo: "aperitivo", kw: ["aperitivo", "gancia", "campari", "aperol", "vermouth", "vermut", "cynar"] },
  { tipo: "cerveza", kw: ["cerveza", "birra", "ipa", "lager", "stout", "quilmes", "heineken", "corona", "brahma", "stella", "patagonia", "andes", "imperial", "schneider"] },
  { tipo: "gaseosa", kw: ["gaseosa", "coca", "pepsi", "sprite", "fanta", "seven up", "7up", "manaos", " cola", "paso de los toros"] },
  { tipo: "agua", kw: ["agua", "soda", "villavicencio", "villa del sur"] },
  { tipo: "jugo", kw: ["jugo", "exprimido", "baggio", "cepita"] },
  { tipo: "queso", kw: ["queso", "muzzarella", "mozzarella", "provolone", "reggianito", "cremoso", "roquefort", "brie", "gruyere", "sardo"] },
  { tipo: "fiambre", kw: ["jamon", "jamón", "salame", "salam", "mortadela", "bondiola", "lomo ", "paleta", "panceta", "salchich", "morcilla", "chorizo", "fiambre", "pastron", "pancetta", "sobrasada", "butifarra", "pate", "paté", "leberkasse", "cracovia", "matambre", "tirolesa", "guanciale", "copetin"] },
  { tipo: "aceitunas", kw: ["aceituna"] },
  { tipo: "aceite", kw: ["aceite"] },
  { tipo: "mayonesa", kw: ["mayonesa", "ketchup", "mostaza", "salsa golf", "aderezo", "savora", "barbacoa"] },
  { tipo: "fideos", kw: ["fideo", "pasta", "tallarin", "mostachol", "spaghetti", "ñoqui", "noqui", "tirabuzon", "codito", "lucchetti", "matarazzo"] },
  { tipo: "arroz", kw: ["arroz"] },
  { tipo: "harina", kw: ["harina", "premezcla", "maizena", "almidon"] },
  { tipo: "yerba", kw: ["yerba", "playadito", "rosamonte", "taragui", "cruz de malta", "amanda"] },
  { tipo: "cafe", kw: ["cafe", "café", "nescafe", "la virginia", "dolca"] },
  { tipo: "galletitas", kw: ["galletita", "galleta", "bizcocho", "biscocho", "oblea", "criollita", "terrabusi"] },
  { tipo: "chocolate", kw: ["chocolate", "alfajor", "bombon", "bombón", "cofler", "milka", "block"] },
  { tipo: "snacks", kw: ["papas fritas", "chizito", "palitos", "mani", "maní", "snack", "nachos", "doritos", "lays", "gauchitas"] },
  { tipo: "leche", kw: ["leche", "serenisima", "sancor"] },
  { tipo: "conservas", kw: ["atun", "atún", "arveja", "choclo", "tomate", "lenteja", "poroto", "conserva", "caballa", "sardina", "pure de tomate"] },
  { tipo: "limpieza", kw: ["lavandina", "detergente", "jabon", "jabón", "limpiador", "desinfectante", "lavavajilla", "suavizante", "esponja", "magistral", "cif"] },
];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export function fotosCandidatas(nombre?: string | null, sku?: string | null): string[] {
  const n = (nombre ?? "").toLowerCase();
  const tipo = REGLAS.find((r) => r.kw.some((k) => n.includes(k)))?.tipo;
  if (!tipo) return [];
  const pick = (hash(sku || nombre || tipo) % 3) + 1; // variante por producto (1-3)
  const orden = [pick, 1, 2, 3].filter((v, i, a) => a.indexOf(v) === i);
  return orden.map((i) => `/cat/${tipo}-${i}.jpg`);
}
