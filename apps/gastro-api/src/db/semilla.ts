import type { Tablas } from './memoria';

// DATOS DE MUESTRA para el modo demo. Nada de esto es de Gran Caminito: son
// números inventados para poder recorrer las pantallas. Se generan igual cada
// vez (azar con semilla fija) y relativos a la hora en que arranca la API.

function azarFijo(semilla: number) {
  let a = semilla;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MIN = 60_000;
const DIA = 86_400_000;

export function sembrar(): Tablas {
  const azar = azarFijo(20261112);
  const elegir = <T,>(xs: T[]) => xs[Math.floor(azar() * xs.length)];
  const entre = (a: number, b: number) => a + Math.floor(azar() * (b - a + 1));
  let n = 0;
  const id = (p: string) => `${p}-${String(++n).padStart(5, '0')}`;
  const ahora = Date.now();
  const iso = (ms: number) => new Date(ms).toISOString();

  // ── salón ──
  const mesas = [
    ...Array.from({ length: 14 }, (_, i) => ({ numero: i + 1, sector: 'Salón' })),
    ...Array.from({ length: 6 }, (_, i) => ({ numero: i + 15, sector: 'Galería' })),
    ...Array.from({ length: 4 }, (_, i) => ({ numero: i + 21, sector: 'Vereda' })),
  ].map((m) => ({ id: id('mesa'), ...m, qr_token: `demo-mesa-${m.numero}`, activa: true, creado_en: iso(ahora - 90 * DIA) }));

  const mozos = ['Rocío', 'Matías', 'Lucas', 'Camila'].map((nombre) => ({ id: id('mozo'), nombre, activo: true, creado_en: iso(ahora - 90 * DIA) }));

  const derivadores = [
    { nombre: 'Hotel Selva Alta', tipo: 'hotel', contacto: 'Conserjería', telefono: '5493757400001', comision_pct: 10, codigo: 'selva-alta' },
    { nombre: 'Posada del Lapacho', tipo: 'hotel', contacto: 'Recepción', telefono: '5493757400002', comision_pct: 8, codigo: 'lapacho' },
    { nombre: 'Marcos · guía de Cataratas', tipo: 'guia', contacto: 'Marcos', telefono: '5493757400003', comision_pct: 10, codigo: 'marcos-guia' },
    { nombre: 'Iguazú Receptivo', tipo: 'agencia', contacto: 'Ventas', telefono: '5493757400004', comision_pct: 12, codigo: 'receptivo' },
    { nombre: 'Remises Tres Fronteras', tipo: 'remis', contacto: 'Base', telefono: '5493757400005', comision_pct: 5, codigo: 'tres-fronteras' },
  ].map((d) => ({ id: id('deriv'), ...d, activo: true, notas: null, creado_en: iso(ahora - 60 * DIA) }));

  // ── carta ──
  const cortes = [
    { nombre: 'Picaña', rinde_objetivo_pct: 78 },
    { nombre: 'Bife de chorizo', rinde_objetivo_pct: 82 },
    { nombre: 'Ojo de bife', rinde_objetivo_pct: 80 },
    { nombre: 'Vacío', rinde_objetivo_pct: 75 },
    { nombre: 'Nalga (milanesa)', rinde_objetivo_pct: 88 },
  ].map((c) => ({ id: id('corte'), ...c, activo: true, creado_en: iso(ahora - 90 * DIA) }));
  const corte = (nombre: string) => cortes.find((c) => c.nombre === nombre)!.id;

  const categorias = [
    { nombre: 'Entradas', nombre_pt: 'Entradas', nombre_en: 'Starters' },
    { nombre: 'Parrilla', nombre_pt: 'Churrasco', nombre_en: 'From the grill' },
    { nombre: 'Otros principales', nombre_pt: 'Outros pratos', nombre_en: 'Other mains' },
    { nombre: 'Guarniciones', nombre_pt: 'Acompanhamentos', nombre_en: 'Sides' },
    { nombre: 'Postres', nombre_pt: 'Sobremesas', nombre_en: 'Desserts' },
    { nombre: 'Bebidas', nombre_pt: 'Bebidas', nombre_en: 'Drinks' },
  ].map((c, i) => ({ id: id('cat'), ...c, orden: i }));
  const cat = (nombre: string) => categorias.find((c) => c.nombre === nombre)!.id;

  type It = {
    c: string; nombre: string; pt: string; en: string; desc: string; dpt: string; den: string; precio: number; costo: number;
    al?: string[]; et?: string[]; min?: number; corte?: string; gr?: number; peso: number;
  };
  const defs: It[] = [
    { c: 'Entradas', nombre: 'Provoleta a la parrilla', pt: 'Provolone na brasa', en: 'Grilled provolone', desc: 'Con orégano y aceite de oliva.', dpt: 'Com orégano e azeite de oliva.', den: 'With oregano and olive oil.', precio: 12000, costo: 3900, al: ['lacteos'], et: ['vegetariano', 'sin_tacc'], min: 8, peso: 30 },
    { c: 'Entradas', nombre: 'Empanadas de carne (2)', pt: 'Empanadas de carne (2)', en: 'Beef empanadas (2)', desc: 'Cortadas a cuchillo, al horno.', dpt: 'Carne cortada na faca, assadas.', den: 'Hand-cut beef, baked.', precio: 7000, costo: 2100, al: ['gluten', 'huevo'], min: 10, peso: 34 },
    { c: 'Entradas', nombre: 'Chorizo criollo', pt: 'Linguiça crioula', en: 'Creole sausage', desc: 'De cerdo, con pan y chimichurri.', dpt: 'De porco, com pão e chimichurri.', den: 'Pork sausage with bread and chimichurri.', precio: 6000, costo: 1900, al: ['gluten'], min: 12, peso: 26 },
    { c: 'Parrilla', nombre: 'Picaña', pt: 'Picanha', en: 'Picanha (rump cap)', desc: 'El corte que piden en Brasil. 400 g, jugosa, con su grasa.', dpt: 'O corte preferido do Brasil. 400 g, suculenta, com a capa de gordura.', den: 'Brazil’s favourite cut. 400 g, juicy, with its fat cap.', precio: 34000, costo: 12600, et: ['sin_tacc'], min: 22, corte: 'Picaña', gr: 400, peso: 62 },
    { c: 'Parrilla', nombre: 'Bife de chorizo', pt: 'Bife de chorizo (contrafilé)', en: 'Sirloin strip steak', desc: 'El clásico argentino. 450 g, sin hueso.', dpt: 'O clássico argentino. 450 g, sem osso.', den: 'The Argentine classic. 450 g, boneless.', precio: 36000, costo: 13700, et: ['sin_tacc'], min: 20, corte: 'Bife de chorizo', gr: 450, peso: 48 },
    { c: 'Parrilla', nombre: 'Ojo de bife', pt: 'Ojo de bife (filé de costela)', en: 'Ribeye', desc: 'El más tierno y marmolado. 400 g.', dpt: 'O mais macio e marmorizado. 400 g.', den: 'The most tender and marbled. 400 g.', precio: 39000, costo: 16400, et: ['sin_tacc'], min: 20, corte: 'Ojo de bife', gr: 400, peso: 22 },
    { c: 'Parrilla', nombre: 'Vacío', pt: 'Vacío (fraldinha)', en: 'Flank steak', desc: 'Cocción lenta, crocante por fuera. 450 g.', dpt: 'Cozimento lento, crocante por fora. 450 g.', den: 'Slow-cooked, crisp outside. 450 g.', precio: 31000, costo: 9900, et: ['sin_tacc'], min: 25, corte: 'Vacío', gr: 450, peso: 30 },
    { c: 'Otros principales', nombre: 'Milanesa napolitana', pt: 'Milanesa à napolitana', en: 'Breaded beef with ham and cheese', desc: 'Con jamón, queso y salsa de tomate. Con papas fritas.', dpt: 'Com presunto, queijo e molho de tomate. Com batatas fritas.', den: 'Topped with ham, cheese and tomato sauce. With fries.', precio: 24000, costo: 7400, al: ['gluten', 'huevo', 'lacteos'], min: 18, corte: 'Nalga (milanesa)', gr: 300, peso: 40 },
    { c: 'Otros principales', nombre: 'Surubí grillado', pt: 'Surubim grelhado', en: 'Grilled surubí', desc: 'Pescado de río, con limón y manteca de hierbas.', dpt: 'Peixe de rio, com limão e manteiga de ervas.', den: 'River fish with lemon and herb butter.', precio: 29000, costo: 12800, al: ['pescado', 'lacteos'], et: ['sin_tacc'], min: 18, peso: 14 },
    { c: 'Otros principales', nombre: 'Ñoquis caseros', pt: 'Nhoque caseiro', en: 'Homemade gnocchi', desc: 'Con salsa de tomate o crema.', dpt: 'Com molho de tomate ou creme.', den: 'With tomato or cream sauce.', precio: 18000, costo: 4300, al: ['gluten', 'huevo', 'lacteos'], et: ['vegetariano'], min: 12, peso: 12 },
    { c: 'Guarniciones', nombre: 'Papas fritas', pt: 'Batatas fritas', en: 'French fries', desc: 'Para compartir.', dpt: 'Para compartilhar.', den: 'To share.', precio: 8500, costo: 1900, et: ['vegetariano', 'vegano'], min: 8, peso: 58 },
    { c: 'Guarniciones', nombre: 'Ensalada mixta', pt: 'Salada mista', en: 'Mixed salad', desc: 'Lechuga, tomate y cebolla.', dpt: 'Alface, tomate e cebola.', den: 'Lettuce, tomato and onion.', precio: 9000, costo: 2200, et: ['vegetariano', 'vegano', 'sin_tacc'], min: 5, peso: 36 },
    { c: 'Postres', nombre: 'Flan con dulce de leche', pt: 'Pudim com doce de leite', en: 'Flan with dulce de leche', desc: 'Casero.', dpt: 'Caseiro.', den: 'Homemade.', precio: 8000, costo: 1700, al: ['huevo', 'lacteos'], et: ['vegetariano', 'sin_tacc'], min: 3, peso: 16 },
    { c: 'Postres', nombre: 'Panqueque con dulce de leche', pt: 'Panqueca com doce de leite', en: 'Crêpe with dulce de leche', desc: 'Tibio, caramelizado.', dpt: 'Morno, caramelizado.', den: 'Warm and caramelised.', precio: 8500, costo: 1600, al: ['gluten', 'huevo', 'lacteos'], et: ['vegetariano'], min: 6, peso: 11 },
    { c: 'Postres', nombre: 'Helado (2 bochas)', pt: 'Sorvete (2 bolas)', en: 'Ice cream (2 scoops)', desc: 'Dulce de leche, chocolate o frutilla.', dpt: 'Doce de leite, chocolate ou morango.', den: 'Dulce de leche, chocolate or strawberry.', precio: 7000, costo: 2400, al: ['lacteos'], et: ['vegetariano'], min: 2, peso: 7 },
    { c: 'Bebidas', nombre: 'Malbec (botella)', pt: 'Malbec (garrafa)', en: 'Malbec (bottle)', desc: 'Mendoza. 750 ml.', dpt: 'Mendoza. 750 ml.', den: 'Mendoza. 750 ml.', precio: 26000, costo: 9800, et: ['sin_tacc'], peso: 22 },
    { c: 'Bebidas', nombre: 'Malbec (copa)', pt: 'Malbec (taça)', en: 'Malbec (glass)', desc: '', dpt: '', den: '', precio: 7500, costo: 1700, et: ['sin_tacc'], peso: 18 },
    { c: 'Bebidas', nombre: 'Cerveza (porrón 500 ml)', pt: 'Cerveja (500 ml)', en: 'Beer (500 ml)', desc: '', dpt: '', den: '', precio: 6500, costo: 2300, al: ['gluten'], peso: 44 },
    { c: 'Bebidas', nombre: 'Caipirinha', pt: 'Caipirinha', en: 'Caipirinha', desc: 'Cachaça, lima y azúcar.', dpt: 'Cachaça, limão e açúcar.', den: 'Cachaça, lime and sugar.', precio: 8500, costo: 2000, et: ['sin_tacc'], peso: 24 },
    { c: 'Bebidas', nombre: 'Gaseosa', pt: 'Refrigerante', en: 'Soft drink', desc: '', dpt: '', den: '', precio: 4000, costo: 1300, et: ['sin_tacc'], peso: 50 },
    { c: 'Bebidas', nombre: 'Agua mineral', pt: 'Água mineral', en: 'Mineral water', desc: 'Con o sin gas.', dpt: 'Com ou sem gás.', den: 'Still or sparkling.', precio: 3500, costo: 900, et: ['sin_tacc'], peso: 46 },
    { c: 'Bebidas', nombre: 'Café', pt: 'Café', en: 'Coffee', desc: '', dpt: '', den: '', precio: 3000, costo: 600, et: ['sin_tacc'], min: 3, peso: 20 },
  ];
  const items = defs.map((d, i) => ({
    id: id('item'), categoria_id: cat(d.c), nombre: d.nombre, nombre_pt: d.pt, nombre_en: d.en,
    descripcion: d.desc || null, descripcion_pt: d.dpt || null, descripcion_en: d.den || null,
    precio: d.precio, costo: d.costo, imagen_url: null, alergenos: d.al ?? [], etiquetas: d.et ?? [],
    activo: true, agotado: d.nombre === 'Surubí grillado', orden: i, tiempo_coccion_min: d.min ?? null,
    corte_id: d.corte ? corte(d.corte) : null, gramos_porcion: d.gr ?? null,
  }));
  const porCat = (c: string) => items.map((it, i) => ({ it, peso: defs[i].peso, c: defs[i].c })).filter((x) => x.c === c);
  const elegirPesado = (xs: { it: (typeof items)[number]; peso: number }[]) => {
    const total = xs.reduce((s, x) => s + x.peso, 0);
    let r = azar() * total;
    for (const x of xs) { r -= x.peso; if (r <= 0) return x.it; }
    return xs[xs.length - 1].it;
  };

  const mesa_ciclos: any[] = [];
  const comanda_items: any[] = [];
  const pagos: any[] = [];
  const CAMBIO_BRL = 290;
  const CAMBIO_USD = 1550;

  function pedido(cicloId: string, cubiertos: number, enviado: number, estadoItems: string, conPostre: boolean) {
    const lista: (typeof items)[number][] = [];
    for (let i = 0; i < cubiertos; i++) {
      lista.push(elegirPesado([...porCat('Parrilla'), ...porCat('Otros principales')]));
      lista.push(elegirPesado(porCat('Bebidas')));
    }
    for (let i = 0; i < Math.ceil(cubiertos / 2); i++) lista.push(elegirPesado(porCat('Guarniciones')));
    if (azar() < 0.55) lista.push(elegirPesado(porCat('Entradas')));
    if (conPostre) for (let i = 0; i < Math.ceil(cubiertos / 2); i++) lista.push(elegirPesado(porCat('Postres')));
    const agrupado = new Map<string, { it: (typeof items)[number]; cant: number }>();
    for (const it of lista) agrupado.set(it.id, { it, cant: (agrupado.get(it.id)?.cant ?? 0) + 1 });
    let total = 0;
    for (const { it, cant } of agrupado.values()) {
      total += it.precio * cant;
      const coccion = it.tiempo_coccion_min ?? 0;
      comanda_items.push({
        id: id('com'), ciclo_id: cicloId, item_id: it.id, nombre: it.nombre, cantidad: cant, precio_unitario: it.precio,
        tiempo_coccion_min: it.tiempo_coccion_min, estado: estadoItems, enviado_en: iso(enviado),
        en_coccion_desde: estadoItems === 'pendiente' ? null : iso(enviado + entre(1, 6) * MIN),
        listo_en: ['listo', 'entregado'].includes(estadoItems) ? iso(enviado + (entre(2, 7) + coccion + entre(-3, 6)) * MIN) : null,
        entregado_en: estadoItems === 'entregado' ? iso(enviado + (coccion + entre(8, 14)) * MIN) : null,
        creado_en: iso(enviado),
      });
    }
    return total;
  }

  // ── historia: 35 días cerrados ──
  for (let d = 35; d >= 1; d--) {
    // 00:00 de Argentina de hace d días (el día de hoy queda afuera)
    const hoy = new Date(ahora - 3 * 3_600_000);
    const base = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate() - d, 3, 0, 0));
    const diaSemana = new Date(base.getTime() + 9 * 3_600_000).getUTCDay();
    const cantidad = [34, 22, 24, 27, 31, 44, 48][diaSemana] + entre(-4, 4);
    for (let k = 0; k < cantidad; k++) {
      const cena = azar() < 0.62;
      const inicio = base.getTime() + (cena ? entre(20 * 60, 23 * 60 + 10) : entre(12 * 60, 14 * 60 + 40)) * MIN;
      const mozo = elegir(mozos);
      const lento = mozo.nombre === 'Lucas' ? 4 : mozo.nombre === 'Rocío' ? -2 : 0;
      const cubiertos = elegir([2, 2, 2, 3, 4, 4, 5, 6]);
      const tCarta = inicio + entre(1, 4) * MIN;
      const tComanda = tCarta + (entre(3, 8) + lento) * MIN;
      const tPlato = tComanda + entre(16, 28) * MIN;
      const tTermina = tPlato + entre(22, 38) * MIN;
      const tCuenta = tTermina + entre(4, 14) * MIN;
      const tPago = tCuenta + (cena ? entre(5, 12) : entre(3, 7)) * MIN;
      const tLibre = tPago + entre(2, 11) * MIN;
      const cicloId = id('ciclo');
      const conPostre = azar() < (mozo.nombre === 'Rocío' ? 0.42 : mozo.nombre === 'Lucas' ? 0.14 : 0.24);
      const total = pedido(cicloId, cubiertos, tComanda, 'entregado', conPostre);
      const deriv = azar() < 0.24 ? elegirPesado(derivadores.map((x, i) => ({ it: x as any, peso: [40, 18, 22, 14, 6][i] }))) as any : null;
      mesa_ciclos.push({
        id: cicloId, mesa_id: elegir(mesas).id, mozo_id: mozo.id, derivador_id: deriv?.id ?? null, reserva_id: null,
        estado: 'libre', estado_desde: iso(tLibre), cubiertos, monto: total, llamado_mozo_en: null,
        pago_preferido_metodo: null, pago_preferido_moneda: null,
        sentada_en: iso(inicio), vio_carta_en: iso(tCarta), comanda_tomada_en: iso(tComanda), plato_servido_en: iso(tPlato),
        terminando_en: iso(tTermina), pidio_cuenta_en: iso(tCuenta), pago_en: iso(tPago), libre_en: iso(tLibre), creado_en: iso(inicio),
      });
      const r = azar();
      const pago = r < 0.3 ? { metodo: 'pix', moneda: 'BRL' } : r < 0.6 ? { metodo: 'tarjeta', moneda: 'ARS' } : r < 0.75 ? { metodo: 'qr', moneda: 'ARS' } : r < 0.92 ? { metodo: 'efectivo', moneda: 'ARS' } : { metodo: 'efectivo', moneda: 'USD' };
      const cambio = pago.moneda === 'BRL' ? CAMBIO_BRL : pago.moneda === 'USD' ? CAMBIO_USD : 1;
      pagos.push({
        id: id('pago'), ciclo_id: cicloId, ...pago, monto: Math.round((total / cambio) * 100) / 100, tipo_cambio: cambio,
        monto_ars: total, estado: 'confirmado', referencia: null, cargado_por: mozo.nombre, creado_en: iso(tPago),
      });
    }
  }

  // ── ahora mismo: nueve mesas abiertas en distintos momentos ──
  const abiertas: [number, string, number, number, number][] = [
    // [mesa, estado, minutos sentada, minutos en el estado, cubiertos]
    [2, 'sentada', 2, 2, 2], [4, 'vio_carta', 9, 7, 4], [5, 'comanda_tomada', 21, 14, 3], [7, 'comanda_tomada', 34, 27, 5],
    [9, 'plato_servido', 44, 18, 2], [11, 'terminando', 61, 6, 4], [15, 'pidio_cuenta', 72, 5, 2], [16, 'pidio_cuenta', 80, 9, 6],
    [21, 'pago', 77, 4, 2],
  ];
  const ORDEN = ['sentada', 'vio_carta', 'comanda_tomada', 'plato_servido', 'terminando', 'pidio_cuenta', 'pago'];
  abiertas.forEach(([numero, estado, minSentada, minEstado, cubiertos], i) => {
    const mesa = mesas.find((m) => m.numero === numero)!;
    const cicloId = id('ciclo');
    const sentada = ahora - minSentada * MIN;
    const desde = ahora - minEstado * MIN;
    const idx = ORDEN.indexOf(estado);
    const hito = (e: string, atras: number) => (ORDEN.indexOf(e) < idx ? iso(Math.min(desde, sentada + atras * MIN)) : ORDEN.indexOf(e) === idx ? iso(desde) : null);
    let total: number | null = null;
    if (idx >= 2) {
      const estadoItems = idx === 2 ? (numero === 7 ? 'en_coccion' : 'pendiente') : 'entregado';
      total = pedido(cicloId, cubiertos, ahora - (minSentada - 7) * MIN, estadoItems, idx >= 5 && i % 2 === 0);
    }
    mesa_ciclos.push({
      id: cicloId, mesa_id: mesa.id, mozo_id: mozos[i % mozos.length].id,
      derivador_id: numero === 11 ? derivadores[0].id : numero === 16 ? derivadores[3].id : null, reserva_id: null,
      estado, estado_desde: iso(desde), cubiertos, monto: estado === 'pago' ? total : null,
      llamado_mozo_en: numero === 4 ? iso(ahora - 3 * MIN) : numero === 15 ? iso(ahora - 5 * MIN) : null,
      pago_preferido_metodo: numero === 15 ? 'pix' : null, pago_preferido_moneda: numero === 15 ? 'BRL' : null,
      sentada_en: iso(sentada), vio_carta_en: hito('vio_carta', 2), comanda_tomada_en: hito('comanda_tomada', 7),
      plato_servido_en: hito('plato_servido', 26), terminando_en: hito('terminando', 55), pidio_cuenta_en: hito('pidio_cuenta', 66),
      pago_en: hito('pago', 73), libre_en: null, creado_en: iso(sentada),
    });
    if (estado === 'pago' && total) {
      pagos.push({
        id: id('pago'), ciclo_id: cicloId, metodo: 'tarjeta', moneda: 'ARS', monto: total, tipo_cambio: 1, monto_ars: total,
        estado: 'confirmado', referencia: null, cargado_por: 'Rocío', creado_en: iso(desde),
      });
    }
  });

  // ── reservas de hoy y de mañana ──
  const hoyArt = new Date(ahora - 3 * 3_600_000);
  const aLas = (dias: number, h: number, m: number) =>
    iso(Date.UTC(hoyArt.getUTCFullYear(), hoyArt.getUTCMonth(), hoyArt.getUTCDate() + dias, h + 3, m));
  const reservas = [
    { nombre: 'Familia Souza', telefono: '5545999000001', personas: 6, fecha_hora: aLas(0, 20, 30), idioma: 'pt', estado: 'confirmada', origen: 'whatsapp', derivador_id: null, sena_monto: 30000, sena_pagada: true, notas: 'Cumpleaños. Piden mesa en la galería.' },
    { nombre: 'Grupo Iguazú Receptivo', telefono: '5493757400004', personas: 18, fecha_hora: aLas(0, 21, 0), idioma: 'en', estado: 'confirmada', origen: 'derivador', derivador_id: derivadores[3].id, sena_monto: 150000, sena_pagada: false, notas: 'Contingente. Menú fijo a definir.' },
    { nombre: 'Laura Benítez', telefono: '5491155000003', personas: 2, fecha_hora: aLas(0, 21, 30), idioma: 'es', estado: 'pendiente', origen: 'web', derivador_id: null, sena_monto: null, sena_pagada: false, notas: null },
    { nombre: 'Thomas Keller', telefono: '4915100000004', personas: 4, fecha_hora: aLas(0, 22, 0), idioma: 'en', estado: 'pendiente', origen: 'google', derivador_id: null, sena_monto: null, sena_pagada: false, notas: 'Un celíaco en la mesa.' },
    { nombre: 'Hotel Selva Alta · hab. 12', telefono: '5493757400001', personas: 3, fecha_hora: aLas(1, 13, 0), idioma: 'pt', estado: 'confirmada', origen: 'derivador', derivador_id: derivadores[0].id, sena_monto: null, sena_pagada: false, notas: null },
    { nombre: 'Carla Méndez', telefono: '5493764000006', personas: 5, fecha_hora: aLas(1, 21, 0), idioma: 'es', estado: 'pendiente', origen: 'whatsapp', derivador_id: null, sena_monto: null, sena_pagada: false, notas: null },
  ].map((r) => ({ id: id('res'), ...r, mesa_id: null, recordatorio_en: null, creado_en: iso(ahora - 2 * DIA) }));

  const lista_espera = [
    { nombre: 'Rafael', telefono: '5545999000010', personas: 4, idioma: 'pt', estado: 'esperando', creado_en: iso(ahora - 18 * MIN) },
    { nombre: 'Sofía', telefono: '5491155000011', personas: 2, idioma: 'es', estado: 'avisado', creado_en: iso(ahora - 26 * MIN), avisado_en: iso(ahora - 3 * MIN) },
  ].map((e) => ({ id: id('esp'), avisado_en: null, resuelto_en: null, ...e }));

  // ── compras de carne: kilos por corte ──
  const proveedores = [{ id: id('prov'), nombre: 'Frigorífico del Litoral', cuit: null }, { id: id('prov'), nombre: 'Distribuidora Misionera', cuit: null }];
  const compras: any[] = [];
  const compra_items: any[] = [];
  const kilosSemana: Record<string, [number, number]> = {
    'Picaña': [124, 19800], 'Bife de chorizo': [104, 18200], 'Ojo de bife': [41, 23500], 'Vacío': [62, 13900], 'Nalga (milanesa)': [54, 12400],
  };
  for (let s = 5; s >= 1; s--) {
    const compraId = id('compra');
    const fecha = iso(ahora - s * 7 * DIA).slice(0, 10);
    let total = 0;
    for (const c of cortes) {
      const [kg, precio] = kilosSemana[c.nombre];
      const kilos = Math.round(kg * (0.92 + azar() * 0.16));
      const unit = Math.round(precio * (1 + (5 - s) * 0.018));
      total += kilos * unit;
      compra_items.push({ id: id('ci'), compra_id: compraId, descripcion: `${c.nombre} x kg`, cantidad: kilos, precio_unitario: unit, total: kilos * unit, corte_id: c.id, kilos });
    }
    compras.push({ id: compraId, proveedor_id: proveedores[0].id, numero_comprobante: `A-0003-0000${4100 + s}`, fecha, subtotal: null, iva_105: null, iva_21: null, total, creado_en: iso(ahora - s * 7 * DIA) });
  }

  // ── opiniones, reseñas y contactos ──
  const opiniones: any[] = [];
  for (let i = 0; i < 64; i++) {
    const r = azar();
    opiniones.push({ id: id('op'), mesa_id: elegir(mesas).id, sentimiento: r < 0.74 ? 'contento' : r < 0.9 ? 'neutral' : 'molesto', comentario: null, creado_en: iso(ahora - entre(1, 29) * DIA) });
  }
  const opMolesta = { id: id('op'), mesa_id: mesas[6].id, sentimiento: 'molesto', comentario: 'Hace 25 minutos que esperamos la comida.', creado_en: iso(ahora - 4 * MIN) };
  opiniones.push(opMolesta);
  const alertas_encargado = [{ id: id('al'), mesa_id: mesas[6].id, opinion_id: opMolesta.id, sentimiento: 'molesto', atendida: false, creado_en: iso(ahora - 4 * MIN) }];

  const resenas_google = [
    { autor: 'Juliana M.', rating: 5, texto: 'A melhor picanha que comi na Argentina! Atendimento em português, muito atenciosos.', idioma: 'pt', tema: 'comida', respuesta_estado: 'pendiente' },
    { autor: 'Pedro A.', rating: 2, texto: 'La carne muy rica pero esperamos 20 minutos para que nos traigan la cuenta.', idioma: 'es', tema: 'tiempo', respuesta_estado: 'pendiente' },
    { autor: 'Emily R.', rating: 4, texto: 'Great steak and wine. A bit loud on Saturday night.', idioma: 'en', tema: 'ambiente', respuesta_estado: 'borrador', respuesta_ia: 'Thank you, Emily! Glad you enjoyed the steak and the Malbec. Saturdays do get lively — next time ask for a table in the gallery, it is quieter.' },
    { autor: 'Bruno C.', rating: 3, texto: 'Comida boa, mas demorou para o garçom vir à mesa.', idioma: 'pt', tema: 'servicio', respuesta_estado: 'pendiente' },
    { autor: 'Marta G.', rating: 5, texto: 'Excelente atención de Rocío. El flan, un diez.', idioma: 'es', tema: 'servicio', respuesta_estado: 'publicada', respuesta_ia: '¡Gracias, Marta! Le pasamos el saludo a Rocío. Te esperamos para otro flan.' },
  ].map((r, i) => ({ id: id('rs'), origen: 'google', respuesta_ia: null, publicado_en: null, ...r, creado_en: iso(ahora - (i + 1) * DIA) }));

  const cerradosAyer = mesa_ciclos.filter((c) => c.estado === 'libre' && c.libre_en > iso(ahora - 2 * DIA)).slice(0, 7);
  const nombres = [['Juliana', 'pt', '5545999001'], ['Diego', 'es', '5491155002'], ['Emily', 'en', '447700900'], ['Bruno', 'pt', '5511988003'], ['Marta', 'es', '5493764004'], ['Lucas', 'pt', '5541977005'], ['Ana', 'es', '5493757006']];
  const contactos = cerradosAyer.map((c, i) => ({
    id: id('ct'), telefono: nombres[i][2] + String(100 + i), nombre: nombres[i][0], idioma: nombres[i][1], mesa_id: c.mesa_id, ciclo_id: c.id,
    post_visita_enviado_en: i === 0 ? iso(ahora - 3 * 3_600_000) : null, creado_en: c.terminando_en,
  }));

  // Sólo fechas fijas, para que el pronóstico tenga con qué probar. Los
  // feriados movibles (Carnaval, Semana Santa, puentes) se cargan desde el panel.
  const anio = hoyArt.getUTCFullYear();
  const feriados = [
    ...[['11-15', 'Proclamação da República'], ['11-20', 'Consciência Negra'], ['12-25', 'Natal'], ['01-01', 'Ano Novo'], ['04-21', 'Tiradentes'], ['05-01', 'Dia do Trabalho'], ['09-07', 'Independência'], ['10-12', 'Nossa Senhora Aparecida'], ['11-02', 'Finados']].map(([f, nombre]) => ({ pais: 'BR', f, nombre })),
    ...[['12-08', 'Inmaculada Concepción'], ['12-25', 'Navidad'], ['01-01', 'Año Nuevo'], ['03-24', 'Día de la Memoria'], ['04-02', 'Malvinas'], ['05-01', 'Día del Trabajador'], ['05-25', 'Revolución de Mayo'], ['07-09', 'Independencia']].map(([f, nombre]) => ({ pais: 'AR', f, nombre })),
  ].flatMap((x) => [anio, anio + 1].map((a) => ({ id: id('fer'), fecha: `${a}-${x.f}`, pais: x.pais, nombre: x.nombre })));

  return {
    mesas, mozos, derivadores, reservas, mesa_ciclos, lista_espera, cortes,
    carta_categorias: categorias, carta_items: items, comanda_items, pagos,
    derivador_liquidaciones: [], proveedores, compras, compra_items, opiniones, alertas_encargado, contactos, resenas_google,
    configuracion: [{
      id: true, nombre_restaurante: 'Gran Caminito', capacidad_asientos: 96, horas_servicio_dia: 7,
      dos_por_uno_activo: false, cambio_brl: CAMBIO_BRL, cambio_usd: CAMBIO_USD, cambio_actualizado_en: iso(ahora - 5 * 3_600_000),
      pix_modo: 'terminal', whatsapp_dueno: null, factor_feriado: 1.25, actualizado_en: iso(ahora - 5 * 3_600_000),
    }],
    feriados, analista_insights: [],
  };
}
