# SIMULACIÓN de la carga del Crack del 10/11/2026 (solo lee). Arma plan.json y
# resumen.txt en la carpeta de los CSV. Criterio por sección (ver resumen).
import csv, json, sys, re, math, urllib.request, collections, datetime, unicodedata

D = sys.argv[1]
ENV = dict(l.split('=', 1) for l in open('/Users/leandroalonso/Projects/odb/apps/api/.env').read().splitlines() if re.match(r'^[A-Z0-9_]+=', l))
URL, KEY = ENV['SUPABASE_URL'].strip(), ENV['SUPABASE_SERVICE_KEY'].strip()
ST = '229906e6-df69-48eb-b027-2b57fefb89fe'
T_ULTIMA = '2026-11-03T20:40:00Z'  # la carga anterior (export-0311, 17:36)
CORTE = '2026-11-10T11:20:16-03:00'

def todas(ruta):
    out, a = [], 0
    while True:
        req = urllib.request.Request(f'{URL}/rest/v1/{ruta}', headers={'apikey': KEY, 'Authorization': f'Bearer {KEY}', 'Range': f'{a}-{a+999}'})
        d = json.load(urllib.request.urlopen(req))
        out += d
        if len(d) < 1000: return out
        a += 1000

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
for x in todas(f"precios?select=producto_id,precio,vigente_desde&lista_id=eq.{lista['id']}&order=vigente_desde.desc,id.desc"):
    precios.setdefault(x['producto_id'], x)
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
plan = {'referencia': 'export-1011', 'corte': CORTE, 'sucursal_id': ST, 'lista_id': lista['id']}
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
stock_crack = {r[0].strip(): max(0.0, num(r[2]) or 0) for r in stk}
for x in altas: x['stock'] = round(stock_crack.get(x['codigo'], 0.0), 3)
plan['altas'] = altas
res.append(f'1. PRODUCTOS: {len(existentes)} ya están en NÚCLEO; {len(altas)} altas nuevas ({sum(1 for a in altas if not a["categoria_id"])} sin categoría por su rubro); {len(rev["codigo_repetido_en_odb"])} códigos repetidos en NÚCLEO, {len(repetidos_crack)} repetidos en el Crack ({", ".join(sorted(repetidos_crack))}) y {len(rev["alta_sin_precio_valido"])} altas sin precio válido, a revisión.')

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
    if act and act['vigente_desde'] > T_ULTIMA:
        # NÚCLEO lo cambió después de la carga anterior (remarcó una compra): NÚCLEO es más nuevo
        precio_nucleo_mas_nuevo.append([p['sku'], p['nombre'], act['precio'], nuevo]); continue
    if act and float(act['precio']) > 0 and abs(nuevo / float(act['precio']) - 1) > 0.6:
        rev['salto_mas_60'].append([p['sku'], p['nombre'], act['precio'], nuevo]); continue
    precio_nuevo.append({'producto_id': p['id'], 'precio': nuevo})
plan['precios'] = precio_nuevo
res.append(f'3. PRECIOS (lista 1 del Crack → Minorista de NÚCLEO, vigencia nueva, nunca se borra el historial): {len(precio_nuevo)} cambian; {len(precio_nucleo_mas_nuevo)} NO, porque NÚCLEO los remarcó después del 3/11 (hay que pasarlos al Crack); {len(rev["salto_mas_60"])} saltos de más de ±60 % y {len(rev["precio_basura"])} precios basura, a revisión.')

# ---------- 4. stock de Sant Thomas ----------
# objetivo = lo que dice el Crack + lo que entró o salió SOLO en NÚCLEO desde la carga anterior
# (compras de Ana, correcciones, traspasos, reservas de pedidos). Las ventas de prueba de NÚCLEO no cuentan.
solo_nucleo = collections.defaultdict(float); compras_n = collections.defaultdict(float); todo_desde = collections.defaultdict(float)
for m in movs:
    q = float(m['cantidad']); todo_desde[m['producto_id']] += q
    if m['tipo'] == 'venta' or m['referencia_tipo'] in ('venta_prueba', 'importacion'): continue
    solo_nucleo[m['producto_id']] += q
    if m['tipo'] == 'compra': compras_n[m['producto_id']] += q
# lo que vendió el Crack desde el 3/11 (fecha sin hora: el 3/11 entero cuenta, alcanza para ver si el Crack tuvo compras)
vend_crack = collections.defaultdict(float)
for r in ven:
    d, mm, aa = (int(x) for x in r[0].split('/'))
    if aa == 2026 and mm == 11 and d >= 3: vend_crack[r[3]] += num(r[4]) or 0
ajustes, dobles = [], 0
for r in stk:
    cod = r[0].strip(); p = existentes.get(cod)
    if not p: continue
    crack = num(r[2]) or 0
    pid = p['id']; antes = stock_n.get(pid, 0.0)
    extra = solo_nucleo.get(pid, 0.0)
    # si el Crack también tuvo esa compra (su stock subió desde el 3/11), no se cuenta dos veces
    if compras_n.get(pid):
        base_t = antes - todo_desde.get(pid, 0.0)  # lo que quedó el 3/11 (= el Crack de ese día)
        entradas_crack = max(0.0, crack - base_t + vend_crack.get(cod, 0.0))
        quita = min(compras_n[pid], entradas_crack)
        if quita > 0.0005: dobles += 1; extra -= quita
    objetivo = round(max(0.0, crack + extra), 3)
    if abs(objetivo - antes) >= 0.001: ajustes.append({'producto_id': pid, 'objetivo': objetivo, 'antes': round(antes, 3), 'crack': crack, 'solo_nucleo': round(extra, 3)})
plan['stock'] = ajustes
res.append(f'4. STOCK SANT THOMAS: {len(ajustes)} productos se ajustan. Objetivo = el stock del Crack (corte 10/11 11:20) + lo que entró o salió solo en NÚCLEO desde el 3/11 ({sum(1 for v in solo_nucleo.values() if v)} productos: las compras de Ana y las correcciones). {dobles} compras que el Crack también tenía no se cuentan dos veces. Las ventas de prueba de NÚCLEO no cuentan. Negativos → 0. Santa Inés no se toca (no está en el Crack).')

# ---------- 5. códigos de barras ----------
agregar, quitar_caja = [], []
for r in bar:
    cod, ean, desc, cuanto = r[0].strip(), re.sub(r'\D', '', r[1]), r[2], num(r[3]) or 0
    p = existentes.get(cod)
    if not p or not (6 <= len(ean) <= 14): continue
    dueno = barras.get(ean)
    if cuanto == 1 or cuanto == 0:
        if dueno is None: agregar.append({'ean': ean, 'producto_id': p['id']})
        elif dueno != p['id']: rev['barra_de_otro_producto'].append([ean, cod, r[1]])
    elif dueno == p['id']:
        quitar_caja.append({'ean': ean, 'producto_id': p['id'], 'unidades': cuanto})  # el de la caja no es la unidad
plan['barras_agregar'] = agregar; plan['barras_quitar_caja'] = quitar_caja
res.append(f'5. CÓDIGOS DE BARRAS: {len(agregar)} nuevos (de la unidad); {len(quitar_caja)} de CAJA que estaban puestos en la unidad, se sacan (escanear la caja no puede sumar 1); {len(rev["barra_de_otro_producto"])} que en NÚCLEO son de otro producto, a revisión.')

# ---------- 6. clientes ----------
IVA = {'CONSUMIDOR FINAL': 'consumidor_final', 'RESPONSABLE INSCRIPTO': 'responsable_inscripto', 'MONOTRIBUTO': 'monotributo', 'EXENTO': 'exento'}
cli_altas, cli_completar = [], []
for r in cli:
    if len(r) < 10 or not r[0].strip(): continue
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
res.append(f'6. CLIENTES: {len(cli_altas)} altas (los que tienen saldo, cuenta corriente o compras en el último año; {len(sin_actividad)} sin ningún movimiento no se cargan); {len(cli_completar)} completan datos vacíos (CUIT, teléfono, mail, barrio, IVA). Lo que NÚCLEO ya tiene no se pisa.')

# ---------- 7. cuenta corriente: saldos al corte ----------
saldo_crack = {}
for r in cli:
    if len(r) >= 10 and r[0].strip(): saldo_crack['st-' + r[0].strip()] = num(r[9]) or 0
ajustes_cc = []
for cod, s in saldo_crack.items():
    c = cli_cod.get(cod)
    if not c: continue  # los que se dan de alta llevan su saldo en la sección de altas
    actual = round(float(c['saldo_cta_cte'] or 0), 2)  # el saldo que muestra la pantalla (hay saldos de junio sin movimiento)
    if abs(s - actual) >= 1: ajustes_cc.append({'cliente_id': c['id'], 'monto': round(s - actual, 2), 'saldo_crack': s, 'saldo_nucleo': actual, 'habilitar': s != 0 and not c['cta_cte_habilitada']})
altas_saldo = sum(1 for a in cli_altas if saldo_crack.get(a['codigo_legacy']))
for a in cli_altas: a['saldo'] = saldo_crack.get(a['codigo_legacy'], 0)
plan['ctacte_ajustes'] = ajustes_cc
res.append(f'7. CUENTA CORRIENTE: en NÚCLEO no hubo cobros ni ventas a cuenta desde el 24/10: el saldo del Crack manda. {len(ajustes_cc)} clientes se ajustan («Ajuste de saldo del sistema anterior (corte 10/11/2026 11:20)»), por un neto de ${sum(a["monto"] for a in ajustes_cc):,.0f}; {altas_saldo} altas traen saldo. El historial de movimientos del Crack ({len(cta)} renglones) reemplaza al del 3/11.')

# ---------- 8. ventas: historial por cliente y unidades por producto ----------
desde_ultima = datetime.date(2026, 10, 24); hasta = datetime.date(2026, 11, 9)
por_prod = collections.defaultdict(float); con_cliente = 0
for r in ven:
    d, mm, aa = (int(x) for x in r[0].split('/')); f = datetime.date(aa, mm, d)
    if desde_ultima <= f <= hasta: por_prod[r[3]] += num(r[4]) or 0
    if r[7].strip() and r[7].strip().lower() != 'clientes local': con_cliente += 1
vh = [{'codigo': c, 'producto_id': existentes[c]['id'], 'sku': existentes[c]['sku'], 'nombre': existentes[c]['nombre'], 'unidades': round(u, 3)} for c, u in por_prod.items() if c in existentes and u]
plan['ventas_historicas'] = {'desde': str(desde_ultima), 'hasta': str(hasta), 'filas': vh}
res.append(f'8. VENTAS: unidades vendidas por producto del 24/10 al 9/11 ({len(vh)} productos, {sum(v["unidades"] for v in vh):,.0f} unidades) para las estadísticas y el Analista (ya estaba hasta el 23/10). Las compras de cada cliente ({con_cliente} renglones con cliente) reemplazan a las del 3/11 desde el 10/11/2025.')

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
