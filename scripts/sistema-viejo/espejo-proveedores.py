# QUIÉN VENDE CADA PRODUCTO, IGUAL QUE EL CRACK (10/11/2026): calcula qué vínculos sacar
# (el Crack no los tiene y no hay compra real en NÚCLEO) y cuáles agregar. Solo lee:
# deja espejo.json; se aplica guardándolo en auditoría (ver README, fila 1083).
# Los vínculos producto ↔ proveedor IGUAL que el Crack (columna «proveedor habitual»).
import csv, json, re, sys, urllib.request, unicodedata, collections
import os
D = sys.argv[1]  # la carpeta con articulos.csv en UTF-8
ENV = dict(l.split('=', 1) for l in open(os.path.expanduser('~/Projects/odb/apps/api/.env')).read().splitlines() if re.match(r'^[A-Z0-9_]+=', l))
URL, KEY = ENV['SUPABASE_URL'].strip(), ENV['SUPABASE_SERVICE_KEY'].strip()
def todas(ruta):
    out, a = [], 0
    while True:
        req = urllib.request.Request(f'{URL}/rest/v1/{ruta}', headers={'apikey': KEY, 'Authorization': f'Bearer {KEY}', 'Range': f'{a}-{a+999}'})
        d = json.load(urllib.request.urlopen(req)); out += d
        if len(d) < 1000: return out
        a += 1000
def norm(t): return re.sub(r'[^a-z0-9]+', ' ', unicodedata.normalize('NFD', str(t or '')).encode('ascii', 'ignore').decode().lower()).strip()
art = list(csv.reader(open(f'{D}/articulos.csv', encoding='utf-8'), delimiter=';'))[1:]
provs = todas('proveedores?select=id,razon_social&order=id')
m = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'mapa-proveedores.json')))
prov_id_por_nombre = collections.defaultdict(list)
for p in provs: prov_id_por_nombre[norm(p['razon_social'])].append(p['id'])
grupo_de = {}
for g in m['grupos']:
    for v, _ in g['variantes']: grupo_de[v] = g['nombre']
def genérico(t):
    b = norm(t)
    for clave, nombre in (('golosin', 'Golosinas importadas'), ('import', 'Importados'), ('congel', 'Congelados'), ('fruto', 'Frutos secos'), ('huevo', 'Huevos')):
        if clave in b: return nombre
def por_nombre(n):
    ids = prov_id_por_nombre.get(norm(n), [])
    return ids[0] if len(ids) == 1 else None
def destino(texto):
    r = m['res'].get(texto)
    if r:
        tipo = r[0].split()[0]
        if r[1]: return r[1]
        if tipo == 'nuevo': return por_nombre(grupo_de.get(texto, texto))
        if tipo == 'generico': return por_nombre(genérico(texto) or '')
        return None  # propio, basura, revisar: el Crack no dice un proveedor
    return por_nombre(texto)  # escrituras nuevas desde el 21/10: solo si el nombre es igual
prods = todas('productos?select=id,codigo_legacy,nombre&order=id')
por_cod = {p['codigo_legacy']: p for p in prods if p['codigo_legacy']}
rel = todas('proveedor_productos?select=proveedor_id,producto_id,codigo_proveedor,alias_descripcion&order=proveedor_id,producto_id')
por_prod = collections.defaultdict(list)
for r in rel: por_prod[r['producto_id']].append(r)
compras = {(h['proveedor_id'], h['producto_id']) for h in todas('compras_historial?select=proveedor_id,producto_id&producto_id=not.is.null&order=id')}
fact = {(f['factura']['proveedor_id'], f['producto_id']) for f in todas('facturas_proveedor_items?select=producto_id,factura:facturas_proveedor!inner(proveedor_id)&producto_id=not.is.null&order=id') if f.get('factura')}
prueba = compras | fact
nombre = {p['id']: p['razon_social'] for p in provs}
agregar, borrar, sin_destino = [], [], collections.Counter()
for a in art:
    p = por_cod.get(a[0].strip())
    if not p: continue
    hab = a[11].strip() if len(a) > 11 else ''
    t = destino(hab) if hab else None
    if not t: sin_destino[hab or '(vacío)'] += 1; continue
    actuales = por_prod.get(p['id'], [])
    if not any(r['proveedor_id'] == t for r in actuales):
        costo = float(a[5].replace('.', '').replace(',', '.') or 0) if a[5].strip() else None
        agregar.append({'proveedor_id': t, 'producto_id': p['id'], 'ultimo_costo': costo or None})
    for r in actuales:
        if r['proveedor_id'] == t: continue
        if r['codigo_proveedor'] or r['alias_descripcion'] or (r['proveedor_id'], p['id']) in prueba: continue  # se lo compraron de verdad
        borrar.append({'proveedor_id': r['proveedor_id'], 'producto_id': p['id'], 'de': nombre.get(r['proveedor_id']), 'producto': p['nombre'], 'crack': hab})
json.dump({'agregar': agregar, 'borrar': borrar}, open(f'{D}/espejo.json', 'w'), ensure_ascii=False)
print('vínculos que el Crack NO tiene (y sin compra real en NÚCLEO), se sacan:', len(borrar))
print('vínculos que el Crack tiene y NÚCLEO no, se agregan:', len(agregar))
print('de qué proveedores salen:', collections.Counter(b['de'] for b in borrar).most_common(8))
print('distrisur pierde:', sum(1 for b in borrar if b['de'] == 'distrisur'), [b['producto'][:26] for b in borrar if b['de'] == 'distrisur'][:12])
print('productos sin proveedor claro en el Crack (no se tocan):', sum(sin_destino.values()), sin_destino.most_common(6))
