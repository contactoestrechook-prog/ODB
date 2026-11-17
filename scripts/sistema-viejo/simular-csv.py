# SIMULACIÓN de la carga del Crack de Sant Thomas (solo lee). Arma plan.json,
# revision.json y resumen.txt en la carpeta de los CSV. Criterio por sección (ver resumen).
# Desde el 17/11/2026 las fechas ya no se editan a mano: el corte sale del archivo de
# stock y la carga anterior, de la base (ver «fechas» más abajo).
import csv, json, sys, re, math, urllib.request, collections, datetime, unicodedata, os, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # con python3 -I no entra solo
import vincular as vinc

D = sys.argv[1]
ENV = dict(l.split('=', 1) for l in open('/Users/leandroalonso/Projects/odb/apps/api/.env').read().splitlines() if re.match(r'^[A-Z0-9_]+=', l))
URL, KEY = ENV['SUPABASE_URL'].strip(), ENV['SUPABASE_SERVICE_KEY'].strip()
ST = '229906e6-df69-48eb-b027-2b57fefb89fe'

def todas(ruta):
    out, a = [], 0
    while True:
        req = urllib.request.Request(f'{URL}/rest/v1/{ruta}', headers={'apikey': KEY, 'Authorization': f'Bearer {KEY}', 'Range': f'{a}-{a+999}'})
        for intento in range(8):  # el proxy a veces corta la respuesta a la mitad (17/11/2026)
            try: d = json.load(urllib.request.urlopen(req)); break
            except Exception:
                if intento == 7: raise
                time.sleep(1 + intento)
        out += d
        if len(d) < 1000: return out
        a += 1000

# ---------- fechas ----------
# CORTE: el del archivo de stock («17/11/2026 12:20:32», hora de Argentina).
# T_ULTIMA: la última sincronización del stock de Sant Thomas ANTERIOR al corte (la carga
# completa o «Poner al día», la misma regla que la pantalla): lo que se movió después es lo que
# pasó solo en NÚCLEO. T_PRECIOS: la última carga completa anterior al corte (para ver si NÚCLEO
# tuvo movimientos de cuenta corriente propios). Si ya hubo una sincronización DESPUÉS del corte,
# el archivo es viejo: se frena (salvo --verificar, para revisar una carga recién aplicada).
def dia_local(iso): return (datetime.datetime.strptime(iso[:19], '%Y-%m-%dT%H:%M:%S') - datetime.timedelta(hours=3)).date()  # la base guarda UTC
def corto(f): return f'{f.day}/{f.month}'
_c = re.match(r'[^;]*;[^;]*;[^;]*;\s*(\d{1,2})/(\d{1,2})/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?', open(f'{D}/stock.csv', encoding='utf-8').read().splitlines()[1])
CORTE = f'{_c[3]}-{int(_c[2]):02d}-{int(_c[1]):02d}T{int(_c[4]):02d}:{_c[5]}:{_c[6] or "00"}-03:00'
CORTE_UTC = (datetime.datetime.strptime(CORTE[:19], '%Y-%m-%dT%H:%M:%S') + datetime.timedelta(hours=3)).strftime('%Y-%m-%dT%H:%M:%SZ')
DIA_CORTE = datetime.date(int(_c[3]), int(_c[2]), int(_c[1]))
CORTE_TXT = f'{int(_c[1])}/{int(_c[2])}/{_c[3]} {int(_c[4]):02d}:{_c[5]}'
REF = f'export-{int(_c[1]):02d}{int(_c[2]):02d}'
def _ultima(antes_de=None):
    filtro = f'&creado_en=lt.{antes_de}' if antes_de else ''
    def uno(ruta):
        d = todas(ruta + filtro); return d[0]['creado_en'].replace('+00:00', 'Z') if d else ''  # «+» en la URL se lee como espacio
    return (max(uno(f'movimientos_stock?select=creado_en&sucursal_id=eq.{ST}&referencia_tipo=eq.importacion&order=creado_en.desc&limit=1'),
                uno(f'auditoria?select=creado_en&accion=eq.puesta_al_dia_aplicada&datos_despues->>sucursal_id=eq.{ST}&order=creado_en.desc&limit=1')),
            uno('auditoria?select=creado_en&accion=eq.importacion_sistema_viejo_aplicada&entidad_id=like.export-*&order=creado_en.desc&limit=1'))
T_ULTIMA, T_PRECIOS = _ultima(CORTE_UTC)
_despues = _ultima()[0]
if _despues and _despues > CORTE_UTC and '--verificar' not in sys.argv:
    sys.exit(f'FRENO: Sant Thomas ya se sincronizó después del corte de este archivo ({CORTE_TXT}): el {_despues}. Bajá un export nuevo (o, para revisar una carga recién aplicada, agregá --verificar).')

def filas(f):
    r = list(csv.reader(open(f'{D}/{f}.csv', encoding='utf-8'), delimiter=';'))
    return r[0], r[1:]
num = lambda s: float(str(s).strip().replace('.', '').replace(',', '.')) if str(s).strip() not in ('', '-') else None
def norm(t): return re.sub(r'[^a-z0-9]+', ' ', unicodedata.normalize('NFD', str(t or '')).encode('ascii', 'ignore').decode().lower()).strip()

# ---------- la base ----------
prods = todas('productos?select=id,sku,codigo_legacy,nombre,costo,alicuota_iva,plu,categoria_id,es_alcohol,activo&order=id')
por_cod = {}
for p in prods:
    if p['codigo_legacy']: por_cod.setdefault(str(p['codigo_legacy']), []).append(p)
cats = {c['id']: c['nombre'] for c in todas('categorias?select=id,nombre&order=id')}
lista = todas('listas_precios?select=id,nombre,es_base&es_base=eq.true')[0]
precios = {}
for x in todas(f"precios?select=producto_id,precio,vigente_desde,creado_por&lista_id=eq.{lista['id']}&order=vigente_desde.desc,id.desc"):
    precios.setdefault(x['producto_id'], x)  # el que rige hoy (creado_por vacío = lo puso una carga; con usuario = NÚCLEO)
# el precio de cada artículo en el Crack en la carga anterior (cada plan lo guarda desde el 17/11/2026)
_pc = todas(f'auditoria?select=pc:datos_despues->precios_crack&accion=eq.importacion_sistema_viejo&entidad=eq.carga&creado_en=lt.{CORTE_UTC}&order=creado_en.desc&limit=1')
crack_antes = (_pc[0]['pc'] or {}) if _pc else {}
stock_n = {s['producto_id']: float(s['cantidad']) for s in todas(f'stock?select=producto_id,cantidad&sucursal_id=eq.{ST}&order=producto_id')}
movs = todas(f'movimientos_stock?select=producto_id,tipo,cantidad,referencia_tipo&sucursal_id=eq.{ST}&creado_en=gt.{T_ULTIMA}&order=id')
barras = {b['codigo']: b['producto_id'] for b in todas('codigos_barras?select=codigo,producto_id&order=codigo')}
clis = todas('clientes?select=id,codigo_legacy,nombre,cuit,telefono,email,barrio,condicion_iva,saldo_cta_cte,cta_cte_habilitada&order=id')
cli_cod = {c['codigo_legacy']: c for c in clis if c['codigo_legacy']}
cc = collections.defaultdict(float)
for m in todas('cuenta_corriente?select=cliente_id,debe,haber&order=id'): cc[m['cliente_id']] += float(m['debe'] or 0) - float(m['haber'] or 0)
provs = todas('proveedores?select=id,razon_social,cuit&order=id')
pp = {(x['producto_id'], x['proveedor_id']) for x in todas('proveedor_productos?select=producto_id,proveedor_id&order=proveedor_id,producto_id')}
# el proveedor decidido en NÚCLEO manda sobre el Crack (Jackie, 10/11/2026): ver proveedor_decidido
decidido = {x['producto_id']: x['proveedor_id'] for x in todas('proveedor_decidido?select=producto_id,proveedor_id&order=producto_id')}

# ---------- los archivos ----------
_, art = filas('articulos'); _, stk = filas('stock'); _, pxp = filas('productosxproveedor')
_, bar = filas('codigobarras'); _, cli = filas('clientes'); _, cta = filas('ctacte_clientes'); _, ven = filas('ventas'); _, prv = filas('proveedores')
# CÓDIGOS REPETIDOS EN EL CRACK (12/11/2026). El stock, las barras y las ventas vienen solo con
# el código: con dos artículos en el mismo código, cada fila le aplicaba lo suyo al MISMO producto
# de NÚCLEO (el 10/11: +7 y −7 al 12252, Gin y Raid; −17 y +17 al 10610, vino y Procenex; +0,705
# y −0,705 al 8139, espumante y queso). Van a revisión y la carga no les toca nada.
repetidos_crack = {c for c, n in collections.Counter(r[0].strip() for r in art if r[0].strip()).items() if n > 1}
plan ={'referencia': REF, 'corte': CORTE, 'sucursal_id': ST, 'lista_id': lista['id']}
rev = collections.defaultdict(list)  # a revisión (no se aplica)
res = []

# ---------- 1. productos: vincular por código, altas ----------
# rubro → categoría: la que más usan los productos de ese rubro que ya existen
rubro_cat = collections.defaultdict(collections.Counter)
for r in art:
    for p in por_cod.get(r[0], []):
        if p['categoria_id']: rubro_cat[norm(r[2])][p['categoria_id']] += 1
ALCOHOL = re.compile(r'vino|whisk|cerveza|vodka|gin|ron |licor|fernet|aperitiv|espumant|champ|sidra|tequila|grappa|cognac|brandy|vermut|malbec|cabernet|blend|blanco|tinto|rosado|syrah|merlot|chardonnay|sauvignon|torrontes|pinot|bonarda|vinos')
altas, existentes = [], {}
for r in art:
    cod = r[0].strip()
    if not cod: continue
    ps = [p for p in por_cod.get(cod, [])]
    if cod in repetidos_crack: rev['codigo_repetido_en_el_crack'].append([cod, r[1], ' | '.join(p['sku'] for p in ps)]); continue
    if len(ps) > 1: rev['codigo_repetido_en_odb'].append([cod, r[1], ' | '.join(p['sku'] for p in ps)]); continue
    if ps:
        existentes[cod] = ps[0]; continue
    precio = num(r[6]); costo = num(r[5]) or 0
    if not precio or precio < 100:
        rev['alta_sin_precio_valido'].append([cod, r[1], r[6]]); continue
    cat = rubro_cat[norm(r[2])].most_common(1)
    altas.append({'codigo': cod, 'nombre': r[1].strip(), 'categoria_id': cat[0][0] if cat else None, 'rubro': r[2],
                  'es_alcohol': bool(ALCOHOL.search(norm(r[2]) + ' ')), 'precio': precio, 'costo': costo,
                  'alicuota_iva': num(r[4]), 'plu': r[10].strip() or None})
# VINCULAR EN VEZ DE DUPLICAR (17/11/2026, vincular.py): el artículo nuevo del Crack puede ser
# un producto que NÚCLEO ya creó al cargar una factura, sin código del Crack. Ese recibe el
# código y sigue como uno existente (stock, precio, barras, proveedor); no se crea otro.
sin_codigo = [p for p in prods if not p['codigo_legacy'] and p['activo']]
barras_unidad = collections.defaultdict(set)
for r in bar:
    if len(r) > 3 and (num(r[3]) or 0) in (0, 1): barras_unidad[r[0].strip()].add(re.sub(r'\D', '', r[1]))
vinc_ok, rev['posible_duplicado'] = vinc.buscar(altas, sin_codigo, barras_unidad, barras)
plan['vincular'] = []
for a in altas:
    if a['codigo'] not in vinc_ok: continue
    p, motivo, nota = vinc_ok[a['codigo']]
    existentes[a['codigo']] = p
    plan['vincular'].append({'codigo': a['codigo'], 'producto_id': p['id'], 'sku': p['sku'], 'nombre_nucleo': p['nombre'], 'nombre_crack': a['nombre'], 'motivo': motivo, 'puntaje': nota})
altas = [a for a in altas if a['codigo'] not in vinc_ok]
stock_crack = {r[0].strip(): max(0.0, num(r[2]) or 0) for r in stk}
for x in altas: x['stock'] = round(stock_crack.get(x['codigo'], 0.0), 3)
plan['altas'] = altas
res.append(f'1. PRODUCTOS: {len(existentes)} ya están en NÚCLEO; {len(plan["vincular"])} artículos nuevos del Crack que NÚCLEO ya tenía sin código (de una factura) se VINCULAN en vez de duplicarse ({sum(1 for v in plan["vincular"] if v["motivo"] == "barra")} por barra, {sum(1 for v in plan["vincular"] if v["motivo"] == "nombre")} por nombre); {len(rev["posible_duplicado"])} posibles duplicados se dan de alta igual y van a revisión; {len(altas)} altas nuevas ({sum(1 for a in altas if not a["categoria_id"])} sin categoría por su rubro); {len(rev["codigo_repetido_en_odb"])} códigos repetidos en NÚCLEO, {len(repetidos_crack)} repetidos en el Crack ({", ".join(sorted(repetidos_crack))}) y {len(rev["alta_sin_precio_valido"])} altas sin precio válido, a revisión.')

# ---------- 2. completar datos que NÚCLEO no tiene (IVA, PLU, costo vacío) ----------
completar = []
plu_usados = {str(p['plu']) for p in prods if p['plu']}
for r in art:
    p = existentes.get(r[0].strip())
    if not p: continue
    cambio = {}
    if p['alicuota_iva'] is None and num(r[4]) in (0, 10.5, 21, 27): cambio['alicuota_iva'] = num(r[4])
    plu = r[10].strip()
    if not p['plu'] and plu and plu != r[0].strip() and plu not in plu_usados: cambio['plu'] = plu
    if not float(p['costo'] or 0) and (num(r[5]) or 0) > 0: cambio['costo'] = num(r[5])
    if cambio: completar.append({'producto_id': p['id'], **cambio})
plan['completar'] = completar
res.append(f'2. DATOS QUE FALTABAN: {len(completar)} productos ({sum(1 for c in completar if "alicuota_iva" in c)} IVA, {sum(1 for c in completar if "plu" in c)} PLU, {sum(1 for c in completar if "costo" in c)} costo vacío). Lo que NÚCLEO ya tiene NO se pisa: el costo y el IVA de las facturas de NÚCLEO valen más.')

# ---------- 3. precios: Lista Precio 1 → Minorista ----------
precio_nuevo, precio_nucleo_mas_nuevo = [], []
for r in art:
    p = existentes.get(r[0].strip())
    if not p: continue
    nuevo = num(r[6]); act = precios.get(p['id'])
    if nuevo is None: continue
    if act and abs(float(act['precio']) - nuevo) < 0.01: continue
    if nuevo < 100:
        rev['precio_basura'].append([r[0], r[1], r[6], act and act['precio']]); continue
    if act and act['creado_por']:
        # El precio que rige lo puso alguien en NÚCLEO (remarcó una compra). Hasta el 17/11 se lo
        # respetaba solo si era posterior a la carga ANTERIOR: a la carga siguiente se pisaba con el
        # precio viejo del Crack aunque nadie lo hubiera cambiado en la caja (el 17/11 volvieron
        # atrás 91; se restauraron, auditoría 1200). Ahora se mira si el CRACK lo cambió desde la
        # carga anterior (su precio de entonces queda guardado en cada plan, «precios_crack»).
        antes = crack_antes.get(r[0].strip())
        nucleo_despues = bool(T_PRECIOS) and act['vigente_desde'] > T_PRECIOS
        if antes is None:
            # sin precio guardado (cargas anteriores al 17/11, o artículo nuevo): la regla de antes
            if nucleo_despues: precio_nucleo_mas_nuevo.append([p['sku'], p['nombre'], act['precio'], nuevo]); continue
        elif abs(float(antes) - nuevo) < 0.01:
            # el Crack sigue igual que en la carga anterior: NÚCLEO es más nuevo
            precio_nucleo_mas_nuevo.append([p['sku'], p['nombre'], act['precio'], nuevo]); continue
        elif nucleo_despues:
            # los dos lo cambiaron desde la carga anterior: no se sabe cuál es más nuevo
            rev['precio_cambio_en_los_dos'].append([p['sku'], p['nombre'], act['precio'], antes, nuevo]); continue
        # si no: NÚCLEO lo cambió antes de la carga anterior y el Crack después → vale el Crack
    if act and float(act['precio']) > 0 and abs(nuevo / float(act['precio']) - 1) > 0.6:
        rev['salto_mas_60'].append([p['sku'], p['nombre'], act['precio'], nuevo]); continue
    precio_nuevo.append({'producto_id': p['id'], 'precio': nuevo})
plan['precios'] = precio_nuevo
# lo que dice hoy el Crack de cada artículo: la próxima carga lo usa para saber si el Crack lo cambió
plan['precios_crack'] = {r[0].strip(): num(r[6]) for r in art if r[0].strip() and num(r[6]) is not None}
res.append(f'3. PRECIOS (lista 1 del Crack → Minorista de NÚCLEO, vigencia nueva, nunca se borra el historial): {len(precio_nuevo)} cambian; {len(precio_nucleo_mas_nuevo)} NO, porque NÚCLEO los remarcó y el Crack sigue con el precio de antes (hay que pasarlos a la caja del Crack); {len(rev["precio_cambio_en_los_dos"])} cambiaron en NÚCLEO y también en el Crack, a revisión; {len(rev["salto_mas_60"])} saltos de más de ±60 % y {len(rev["precio_basura"])} precios basura, a revisión.')

# ---------- 4. stock de Sant Thomas ----------
# objetivo = lo que dice el Crack + lo que entró o salió SOLO en NÚCLEO desde la carga anterior
# (compras de Ana, correcciones, traspasos, reservas de pedidos). Las ventas de prueba de NÚCLEO no cuentan.
solo_nucleo = collections.defaultdict(float); compras_n = collections.defaultdict(float); todo_desde = collections.defaultdict(float)
for m in movs:
    q = float(m['cantidad']); todo_desde[m['producto_id']] += q
    if m['tipo'] == 'venta' or m['referencia_tipo'] in ('venta_prueba', 'importacion'): continue
    solo_nucleo[m['producto_id']] += q
    if m['tipo'] == 'compra': compras_n[m['producto_id']] += q
# lo que vendió el Crack desde el día de la última sincronización (fecha sin hora: ese día entero
# cuenta, alcanza para ver si el Crack tuvo compras)
DIA_ULTIMA = dia_local(T_ULTIMA) if T_ULTIMA else datetime.date(2000, 1, 1)
vend_crack = collections.defaultdict(float)
for r in ven:
    d, mm, aa = (int(x) for x in r[0].split('/'))
    if datetime.date(aa, mm, d) >= DIA_ULTIMA: vend_crack[r[3]] += num(r[4]) or 0
ajustes, dobles = [], 0
for r in stk:
    cod = r[0].strip(); p = existentes.get(cod)
    if not p: continue
    crack = num(r[2]) or 0
    pid = p['id']; antes = stock_n.get(pid, 0.0)
    extra = solo_nucleo.get(pid, 0.0)
    # si el Crack también tuvo esa compra (su stock subió desde la última sincronización), no se cuenta dos veces
    if compras_n.get(pid):
        base_t = antes - todo_desde.get(pid, 0.0)  # lo que quedó en la última sincronización (= el Crack de ese día)
        entradas_crack = max(0.0, crack - base_t + vend_crack.get(cod, 0.0))
        quita = min(compras_n[pid], entradas_crack)
        if quita > 0.0005: dobles += 1; extra -= quita
    objetivo = round(max(0.0, crack + extra), 3)
    if abs(objetivo - antes) >= 0.001: ajustes.append({'producto_id': pid, 'objetivo': objetivo, 'antes': round(antes, 3), 'crack': crack, 'solo_nucleo': round(extra, 3)})
plan['stock'] = ajustes
res.append(f'4. STOCK SANT THOMAS: {len(ajustes)} productos se ajustan. Objetivo = el stock del Crack (corte {CORTE_TXT}) + lo que entró o salió solo en NÚCLEO desde la última sincronización, el {corto(DIA_ULTIMA)} ({sum(1 for v in solo_nucleo.values() if v)} productos: las compras de Ana y las correcciones). {dobles} compras que el Crack también tenía no se cuentan dos veces. Las ventas de prueba de NÚCLEO no cuentan. Negativos → 0. Santa Inés no se toca (no está en el Crack).')

# ---------- 5. códigos de barras ----------
agregar, quitar_caja = [], []
# el Crack a veces pone la MISMA barra como unidad x1 y como caja x6 del mismo artículo (17/11:
# Levite 1367, Alambrado 2101, Fond de Cave 6680): esa no se saca, va a revisión
como_unidad = {(r[0].strip(), re.sub(r'\D', '', r[1])) for r in bar if len(r) > 3 and (num(r[3]) or 0) in (0, 1)}
for r in bar:
    cod, ean, desc, cuanto = r[0].strip(), re.sub(r'\D', '', r[1]), r[2], num(r[3]) or 0
    p = existentes.get(cod)
    if not p or not (6 <= len(ean) <= 14): continue
    dueno = barras.get(ean)
    if cuanto == 1 or cuanto == 0:
        if dueno is None: agregar.append({'ean': ean, 'producto_id': p['id']})
        elif dueno != p['id']: rev['barra_de_otro_producto'].append([ean, cod, r[1]])
    elif dueno == p['id'] and (cod, ean) in como_unidad:
        rev['barra_unidad_y_caja'].append([ean, cod, r[2], cuanto])
    elif dueno == p['id']:
        quitar_caja.append({'ean': ean, 'producto_id': p['id'], 'unidades': cuanto})  # el de la caja no es la unidad
plan['barras_agregar'] = agregar; plan['barras_quitar_caja'] = quitar_caja
res.append(f'5. CÓDIGOS DE BARRAS: {len(agregar)} nuevos (de la unidad); {len(quitar_caja)} de CAJA que estaban puestos en la unidad, se sacan (escanear la caja no puede sumar 1); {len(rev["barra_de_otro_producto"])} que en NÚCLEO son de otro producto, a revisión.')

# ---------- 6. clientes ----------
IVA = {'CONSUMIDOR FINAL': 'consumidor_final', 'RESPONSABLE INSCRIPTO': 'responsable_inscripto', 'MONOTRIBUTO': 'monotributo', 'EXENTO': 'exento'}
cli_altas, cli_completar = [], []
# CÓDIGOS DE CLIENTE REPETIDOS EN EL CRACK (17/11/2026: 17 códigos, dos clientes cada uno). La
# ficha de NÚCLEO es de uno solo: el saldo y los datos del otro la pisaban. Van a revisión.
cli_rep = {c for c, n in collections.Counter(r[0].strip() for r in cli if len(r) >= 10 and r[0].strip()).items() if n > 1}
for r in cli:
    if len(r) < 10 or not r[0].strip(): continue
    if r[0].strip() in cli_rep:
        rev['cliente_codigo_repetido_en_el_crack'].append([r[0].strip(), r[1].strip(), r[9].strip(), (cli_cod.get('st-' + r[0].strip()) or {}).get('nombre', '(no está en NÚCLEO)')]); continue
    cod = 'st-' + r[0].strip(); c = cli_cod.get(cod)
    cuit = re.sub(r'\D', '', r[2]); tel = r[4].strip(); mail = r[5].strip(); barrio = r[7].strip(); iva = IVA.get(r[3].strip().upper())
    if not c:
        cli_altas.append({'codigo_legacy': cod, 'nombre': r[1].strip()[:120], 'cuit': cuit or None, 'telefono': tel or None, 'email': mail or None, 'barrio': barrio or None, 'condicion_iva': iva, 'domicilio': r[6].strip() or None})
        continue
    cambio = {}
    for campo, val in (('cuit', cuit), ('telefono', tel), ('email', mail), ('barrio', barrio)):
        if val and not c.get(campo): cambio[campo] = val
    if iva and not c.get('condicion_iva'): cambio['condicion_iva'] = iva
    if cambio: cli_completar.append({'cliente_id': c['id'], **cambio})
# solo los que tienen actividad: saldo, cuenta corriente o compras en el último año
con_cta = {r[0].strip() for r in cta}
nombre_cod = collections.defaultdict(set)
for r in cli:
    if len(r) >= 10: nombre_cod[r[1].strip().lower()].add(r[0].strip())
con_compra = set()
for r in ven:
    n = r[7].strip().lower()
    if n and n != 'clientes local': con_compra |= nombre_cod.get(n, set())
saldo_de = {('st-' + r[0].strip()): (num(r[9]) or 0) for r in cli if len(r) >= 10 and r[0].strip()}
sin_actividad = [a for a in cli_altas if not (saldo_de.get(a['codigo_legacy']) or a['codigo_legacy'][3:] in con_cta or a['codigo_legacy'][3:] in con_compra)]
cli_altas = [a for a in cli_altas if a not in sin_actividad]
plan['clientes_altas'] = cli_altas; plan['clientes_completar'] = cli_completar
res.append(f'6. CLIENTES: {len(cli_altas)} altas (los que tienen saldo, cuenta corriente o compras en el último año; {len(sin_actividad)} sin ningún movimiento no se cargan); {len(cli_completar)} completan datos vacíos (CUIT, teléfono, mail, barrio, IVA). Lo que NÚCLEO ya tiene no se pisa. {len(cli_rep)} códigos que el Crack tiene repetidos (dos clientes) no se tocan: a revisión.')

# ---------- 7. cuenta corriente: saldos al corte ----------
saldo_crack = {}
for r in cli:
    if len(r) >= 10 and r[0].strip() and r[0].strip() not in cli_rep: saldo_crack['st-' + r[0].strip()] = num(r[9]) or 0
ajustes_cc = []
for cod, s in saldo_crack.items():
    c = cli_cod.get(cod)
    if not c: continue  # los que se dan de alta llevan su saldo en la sección de altas
    actual = round(float(c['saldo_cta_cte'] or 0), 2)  # el saldo que muestra la pantalla (hay saldos de junio sin movimiento)
    if abs(s - actual) >= 1: ajustes_cc.append({'cliente_id': c['id'], 'monto': round(s - actual, 2), 'saldo_crack': s, 'saldo_nucleo': actual, 'habilitar': s != 0 and not c['cta_cte_habilitada']})
altas_saldo = sum(1 for a in cli_altas if saldo_crack.get(a['codigo_legacy']))
for a in cli_altas: a['saldo'] = saldo_crack.get(a['codigo_legacy'], 0)
plan['ctacte_ajustes'] = ajustes_cc
# el saldo del Crack manda SOLO si NÚCLEO no tuvo cobros ni ventas a cuenta propios desde la carga anterior
propios = [m for m in todas(f'cuenta_corriente?select=concepto&creado_en=gt.{T_PRECIOS}&order=id') if not re.match(r'(Ajuste de saldo|Saldo inicial) del sistema', m['concepto'] or '')] if T_PRECIOS else []
if propios: rev['ctacte_movimientos_de_nucleo'] = [[m['concepto']] for m in propios]
res.append(f'7. CUENTA CORRIENTE: ' + (f'OJO: NÚCLEO tuvo {len(propios)} movimientos propios desde la carga anterior (a revisión): el saldo del Crack los pisaría. ' if propios else 'en NÚCLEO no hubo cobros ni ventas a cuenta propios desde la carga anterior: el saldo del Crack manda. ') + f'{len(ajustes_cc)} clientes se ajustan («Ajuste de saldo del sistema anterior (corte {CORTE_TXT})»), por un neto de ${sum(a["monto"] for a in ajustes_cc):,.0f}; {altas_saldo} altas traen saldo. El historial de movimientos del Crack ({len(cta)} renglones) reemplaza al anterior.')

# ---------- 8. ventas: historial por cliente y unidades por producto ----------
# desde el día siguiente a lo ya cargado (por esta carga o por «Poner al día») hasta el día antes del corte
_vh = todas(f'ventas_historicas?select=hasta&sucursal_id=eq.{ST}&order=hasta.desc&limit=1')
desde_ultima = (datetime.date.fromisoformat(_vh[0]['hasta'][:10]) + datetime.timedelta(days=1)) if _vh else DIA_CORTE - datetime.timedelta(days=60)
hasta = DIA_CORTE - datetime.timedelta(days=1)
por_prod = collections.defaultdict(float); con_cliente = 0
for r in ven:
    d, mm, aa = (int(x) for x in r[0].split('/')); f = datetime.date(aa, mm, d)
    if desde_ultima <= f <= hasta: por_prod[r[3]] += num(r[4]) or 0
    if r[7].strip() and r[7].strip().lower() != 'clientes local': con_cliente += 1
vh = [{'codigo': c, 'producto_id': existentes[c]['id'], 'sku': existentes[c]['sku'], 'nombre': existentes[c]['nombre'], 'unidades': round(u, 3)} for c, u in por_prod.items() if c in existentes and u]
plan['ventas_historicas'] = {'desde': str(desde_ultima), 'hasta': str(hasta), 'filas': vh}
res.append((f'8. VENTAS: unidades vendidas por producto del {corto(desde_ultima)} al {corto(hasta)} ({len(vh)} productos, {sum(v["unidades"] for v in vh):,.0f} unidades) para las estadísticas y el Analista.' if desde_ultima <= hasta else f'8. VENTAS: ya están cargadas hasta el {corto(hasta)} (nada nuevo).') + f' Las compras de cada cliente ({con_cliente} renglones con cliente) reemplazan a las anteriores desde la primera fecha del archivo.')

# ---------- 9. quién vende cada producto: IGUAL que el Crack ----------
# Leandro, 10/11/2026: «es nada más agarrar los productos como los exporta el Crack
# y ponerlos igual». La columna que vale es «proveedor habitual» de articulos.csv
# (verificado con sus ejemplos: Johnnie Walker → Lalo Importados, Don Satur → Clan).
# El código de productosxproveedor.csv NO sirve: para los proveedores nuevos apunta
# a otro (mandó Johnnie Walker, SodaStream y vinos a «distrisur»). Cada escritura del
# Crack se traduce con mapa-proveedores.json (la tabla corregida a mano el 23/10).
import os
MAPA = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'mapa-proveedores.json')))
grupo_de = {v: g['nombre'] for g in MAPA['grupos'] for v, _ in g['variantes']}
prov_por_nombre = collections.defaultdict(list)
for p in provs: prov_por_nombre[norm(p['razon_social'])].append(p['id'])
def un_prov(n):
    ids = prov_por_nombre.get(norm(n or ''), [])
    return ids[0] if len(ids) == 1 else None
def generico(t):
    b = norm(t)
    for clave, nombre in (('golosin', 'Golosinas importadas'), ('import', 'Importados'), ('congel', 'Congelados'), ('fruto', 'Frutos secos'), ('huevo', 'Huevos')):
        if clave in b: return nombre
def prov_del_crack(texto):
    r = MAPA['res'].get(texto)
    if r:
        if r[1]: return r[1]
        tipo = r[0].split()[0]
        if tipo == 'nuevo': return un_prov(grupo_de.get(texto, texto))
        if tipo == 'generico': return un_prov(generico(texto))
        return None
    return un_prov(texto)
rel, prov_altas = [], []
sin_par = collections.Counter()
for r in art:
    p = existentes.get(r[0].strip()); hab = r[11].strip() if len(r) > 11 else ''
    if not p or not hab: continue
    if p['id'] in decidido: continue  # lo decidió alguien en NÚCLEO: el Crack no lo toca
    pv = prov_del_crack(hab)
    if not pv: sin_par[hab] += 1; continue
    if (p['id'], pv) not in pp: rel.append({'producto_id': p['id'], 'proveedor_id': pv, 'ultimo_costo': num(r[5])})
plan['proveedores_altas'] = []; plan['proveedor_productos'] = rel
res.append(f'9. QUIÉN VENDE CADA PRODUCTO (igual que el «proveedor habitual» del Crack): {len(rel)} vínculos nuevos; {sum(sin_par.values())} productos con un proveedor que no está en NÚCLEO ni en la tabla (a revisión). Sacar los que el Crack no tiene: ver espejo en el README.')
prov_altas = [{'codigo': '', 'razon_social': k, 'cuit': None} for k in sin_par]
rev['proveedores_no_encontrados'] = [[a['codigo'], a['razon_social'], a['cuit']] for a in prov_altas]
rev['precio_nucleo_mas_nuevo'] = precio_nucleo_mas_nuevo

plan['t'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
json.dump(plan, open(f'{D}/plan.json', 'w'), ensure_ascii=False)
json.dump(rev, open(f'{D}/revision.json', 'w'), ensure_ascii=False)
open(f'{D}/resumen.txt', 'w').write('\n'.join(res))
print('\n'.join(res))
print('\nA REVISIÓN:', {k: len(v) for k, v in rev.items()})
