# VINCULAR EN VEZ DE DUPLICAR (17/11/2026)
#
# La carga del Crack daba de alta todo código que NÚCLEO no tenía. Pero cuando Ana
# carga una factura con un producto nuevo, NÚCLEO lo crea SIN código del Crack
# (SKU 409xx), y días después el Crack le pone código al mismo artículo. La carga
# lo creaba otra vez: el 10/11 duplicó 2 y el 17/11, 17 (Moodie, focaccias Saccha,
# dátiles Jomara…), con la compra contada dos veces en el stock.
#
# Antes de dar de alta, se busca el artículo entre los productos ACTIVOS de NÚCLEO
# que no tienen código del Crack (son pocos: 9 el 17/11 después de unificar):
#   1. por código de barras: una barra de la unidad del Crack que en NÚCLEO es de
#      uno de esos productos → es el mismo;
#   2. por nombre: sin tildes, mayúsculas ni signos, con las unidades juntas
#      («312g», «1l»), tolerando errores de tipeo («Homeadas»), y con un freno: si
#      los dos nombres dicen un tamaño y no coinciden (250g / 500g), NO es el mismo.
# Lo seguro se VINCULA (el producto de NÚCLEO recibe el código y sigue la carga
# como uno existente: stock, precio, barras, proveedor). Lo dudoso se da de alta
# como siempre pero va a la planilla como «posible duplicado».
import re, unicodedata, difflib

VACIAS = {'x', 'de', 'del', 'con', 'la', 'el', 'los', 'las', 'y', 'en', 'por', 'sabor', 'sab', 'un', 'u', 'unid', 'unidad', 'fraccion', 'a', 'al'}
UNIDADES = [(r'(gr|grs|g|gramos?)', 'g'), (r'(kg|kgs|kilos?)', 'kg'), (r'(ml|cc|cm3|cm)', 'ml'), (r'(l|lt|lts|litros?)', 'l')]


def palabras(t):
    t = re.sub(r'(?<=[a-z])(?=[A-Z])', ' ', str(t or ''))  # «MuzzarelaSACCHA» → «Muzzarela SACCHA»
    t = unicodedata.normalize('NFD', t).encode('ascii', 'ignore').decode().lower()
    t = re.sub(r'(?<=\d),(?=\d)', '.', t)
    t = re.sub(r'[^a-z0-9.]+', ' ', t)
    t = re.sub(r'(?<=[a-z])(?=\d)|(?<=\d)(?=[a-z])', ' ', t)  # «sq1l» → «sq 1 l»
    for patron, unidad in UNIDADES:
        t = re.sub(r'\b(\d+(?:\.\d+)?)\s+' + patron + r'\b', r'\1' + unidad, t)
    ps = (p.strip('.') for p in t.split())
    return [p for p in ps if p and p not in VACIAS]


def tamanos(ps):
    return {p for p in ps if re.fullmatch(r'\d+(?:\.\d+)?(g|kg|ml|l)', p)}


def parecida(a, b):
    if a == b: return True
    return len(a) >= 5 and len(b) >= 5 and difflib.SequenceMatcher(None, a, b).ratio() >= 0.85


def puntaje(n1, n2):
    a, b = palabras(n1), palabras(n2)
    if not a or not b: return 0.0
    ta, tb = tamanos(a), tamanos(b)
    if ta and tb and ta != tb: return 0.0  # dicen tamaños distintos: no es el mismo
    corto, largo = (a, b) if len(a) <= len(b) else (b, a)
    comunes = sum(1 for p in corto if any(parecida(p, q) for q in largo))
    if comunes < 2: return 0.0
    return comunes / len(corto)


def buscar(altas, sin_codigo, barras_crack, barras_nucleo, seguro=0.8, duda=0.5):
    """altas: [{'codigo', 'nombre'}]; sin_codigo: productos activos sin código del Crack
    [{'id', 'sku', 'nombre'}]; barras_crack: código → barras de la unidad; barras_nucleo:
    barra → producto_id. Devuelve (vincular: código → (producto, motivo, puntaje), dudosos)."""
    por_id = {p['id']: p for p in sin_codigo}
    propuestas = []
    for a in altas:
        por_barra = {barras_nucleo.get(e) for e in barras_crack.get(a['codigo'], ())} & set(por_id)
        if len(por_barra) == 1:
            propuestas.append((2.0, a, por_id[por_barra.pop()], 'barra')); continue
        notas = sorted(((puntaje(a['nombre'], p['nombre']), p) for p in sin_codigo), key=lambda x: -x[0])
        if not notas or notas[0][0] < duda: continue
        mejor, p = notas[0]
        segundo = notas[1][0] if len(notas) > 1 else 0.0
        propuestas.append((mejor if mejor >= seguro and mejor - segundo >= 0.1 else -mejor, a, p, 'nombre'))
    vincular, dudosos, usados = {}, [], set()
    for nota, a, p, motivo in sorted(propuestas, key=lambda x: -x[0]):
        if nota > 0 and p['id'] not in usados:
            vincular[a['codigo']] = (p, motivo, round(min(nota, 1.0), 2)); usados.add(p['id'])
        else:
            dudosos.append([a['codigo'], a['nombre'], p['sku'], p['nombre'], round(abs(nota), 2)])
    return vincular, dudosos
