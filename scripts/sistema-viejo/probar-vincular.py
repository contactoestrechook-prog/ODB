# Prueba de vincular.py con los casos REALES del 17/11/2026 (no usa la base).
# Correr: python3 -I probar-vincular.py   → tiene que terminar en «OK».
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import vincular

# productos de NÚCLEO sin código del Crack (creados al cargar facturas) y sus barras
NUCLEO = [
    ('40909', 'Barra ahumada Santa Narcisa', None), ('40908', 'Emmenthal Cremac x fraccion', None),
    ('40911', 'Datiles Jomara rellenos surtidos x 200gr', None), ('40912', 'Datiles Jomara rellenos con pistacho x 200gr', None),
    ('40913', 'Guantes de Latex ProMax M Media Naranja', '7798136926105'), ('40914', '8083 - JUEGO DE CARTAS UNO ARGENTINA', '7452102884867'),
    ('40915', 'REGGIANITO MELINCUE', '491'), ('40916', 'Bria - Castañas de Cajú Homeadas 150g Bañadas en Chocolate y Sal Marina', 'CJHCHYS'),
    ('40917', 'Focaccia Panceta Saccha 312g', 'FOC-002'), ('40918', 'Focaccia Porteña MuzzarelaSACCHA  312g', 'FOC-006'),
    ('40919', 'Focaccia Porteña Hongos SACCHA  312g', 'FOC-008'), ('40920', 'Rapiditas protein Bimbo XXL', '7793890262728'),
    ('40921', 'Moodie brownie', '0606582461958'), ('40922', 'Moodie chocotorta', '0606582461941'),
    ('40907', 'PREP. VEG BEBIBLE LA SERENISIMA ALMENDRA SAB CHOCO SQ1L', '7790742341709'),
    # los que quedaban sin código ese día: no tienen que agarrar nada de lo de abajo
    ('40898', 'FIDEOS MATARAZZO MUNICION 500G + 50G', '7790070320032'), ('40899', 'Mani King Mani Tostado sin Piel sin Sal x100gr', None),
    ('40901', 'Galletitas Cerealitas xl cacao x 243gr', None), ('40905', 'QUESO LS SARDO SIN LACTOSA FRACC 280 GR', '470400'),
    ('40906', 'Galletitas Terrabusi Melba tripack', None), ('HUEVOS-DOC', 'Huevos x docena', None),
]
# artículos nuevos del Crack: (código, nombre, barra de la unidad, SKU que tiene que encontrar o None)
CRACK = [
    ('13960', 'Barra ahumada Santa Narcisa x fraccion', None, '40909'), ('13961', 'Emmenthal Cremac x fraccion', None, '40908'),
    ('13962', 'Datiles Jomara rellenos surtidos x 200gr', '6290361204481', '40911'), ('13963', 'Datiles Jomara rellenos con pistacho x 200gr', '6291108639238', '40912'),
    ('13964', 'Guantes Media Naranja talle M', '7798136926105', '40913'), ('13965', 'Juego de cartas Uno argentina', '7452102884867', '40914'),
    ('13966', 'Queso Reggianito Melincue x fraccion', None, '40915'), ('13967', 'Castañas de caju horneadas Bria  x 150gr', '7798435160231', '40916'),
    ('13969', 'Focaccia panceta Saccha x 312gr', '0714604269458', '40917'), ('13970', 'Focaccia porteña muzzarella Saccha x 312gr', '0714604269465', '40918'),
    ('13971', 'Focaccia porteña hongos Saccha x 312gr', '0714604269489', '40919'), ('13968', 'Rapiditas protein Bimbo XXL', '7793890262728', '40920'),
    ('13998', 'Moodie brownie', '0606582461958', '40921'), ('13999', 'Moodie chocotorta', '0606582461941', '40922'),
    ('13937', 'Prep. veg bebible LS almendra sabor choco sq 1L', '7790742341709', '40907'),
    # altas verdaderas de ese día (y trampas de tamaño): no tienen que vincularse
    ('99004', 'Mani King tostado sin piel sin sal x 200gr', None, None), ('14004', 'Vaporizador The Black Sheep dual tank x 20k', None, None),
    ('13972', 'Cerveza Importada Leffe Blonde x 330cc', None, None), ('13985', 'Oreo Gingerbread x 154gr', None, None),
    ('13997', 'Chips ahoy x 5 barritas', None, None), ('13976', 'Salame veinticino Lopardo A/V x 160gr', None, None),
    ('14005', 'Canela en polvo Badia x 56.7 gr', None, None), ('13981', 'Papas Fritas Mc cain Air Fryer Artesanal x 700gr', None, None),
]
pool = [{'id': s, 'sku': s, 'nombre': n} for s, n, _ in NUCLEO]
barras_nucleo = {b: s for s, _, b in NUCLEO if b}
barras_crack = {c: {b} for c, _, b, _ in CRACK if b}
v, dudosos = vincular.buscar([{'codigo': c, 'nombre': n} for c, n, _, _ in CRACK], pool, barras_crack, barras_nucleo)
mal = []
for c, n, _, esperado in CRACK:
    obtenido = v[c][0]['sku'] if c in v else None
    if obtenido != esperado: mal.append((c, n, esperado, obtenido))
assert vincular.puntaje('Datiles Medjoul DP x 250gr', 'Datiles Medjoul DP x 500gr') == 0, 'tamaños distintos no son el mismo'
if mal or dudosos:
    print('MAL:', mal, '\nDUDOSOS:', dudosos); sys.exit(1)
print(f'OK: {sum(1 for x in CRACK if x[3])} vinculados bien, {sum(1 for x in CRACK if not x[3])} altas sin confundir')
