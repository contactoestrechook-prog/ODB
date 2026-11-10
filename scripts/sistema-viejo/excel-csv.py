import json, openpyxl, sys
from openpyxl.styles import Font, PatternFill, Alignment
D = sys.argv[1]
p = json.load(open(f'{D}/plan.json')); r = json.load(open(f'{D}/revision.json')); res = open(f'{D}/resumen.txt').read().split('\n')
import urllib.request, re
ENV = dict(l.split('=', 1) for l in open('/Users/leandroalonso/Projects/odb/apps/api/.env').read().splitlines() if re.match(r'^[A-Z0-9_]+=', l))
def todas(ruta):
    out, a = [], 0
    while True:
        req = urllib.request.Request(f"{ENV['SUPABASE_URL'].strip()}/rest/v1/{ruta}", headers={'apikey': ENV['SUPABASE_SERVICE_KEY'].strip(), 'Authorization': 'Bearer ' + ENV['SUPABASE_SERVICE_KEY'].strip(), 'Range': f'{a}-{a+999}'})
        d = json.load(urllib.request.urlopen(req)); out += d
        if len(d) < 1000: return out
        a += 1000
nom = {x['id']: (x['sku'], x['nombre']) for x in todas('productos?select=id,sku,nombre')}
wb = openpyxl.Workbook(); ws = wb.active; ws.title = 'Resumen'
ws.append(['Carga del sistema anterior (Crack) · corte 10/11/2026 11:20 · Sant Thomas']); ws['A1'].font = Font(bold=True, size=14)
ws.append(['Simulación: todavía NO se aplicó nada.']); ws.append([])
for l in res: ws.append([l]); ws.cell(ws.max_row, 1).alignment = Alignment(wrap_text=True)
ws.column_dimensions['A'].width = 160
def hoja(titulo, enc, filas):
    h = wb.create_sheet(titulo[:31]); h.append(enc)
    for c in h[1]: c.font = Font(bold=True, color='FFFFFF'); c.fill = PatternFill('solid', fgColor='B82D25')
    for f in filas: h.append(f)
    for i, _ in enumerate(enc): h.column_dimensions[openpyxl.utils.get_column_letter(i + 1)].width = 18 if i else 14
    if len(enc) > 1: h.column_dimensions['B'].width = 46
hoja('Stock', ['SKU', 'Producto', 'NÚCLEO hoy', 'Crack', 'Solo en NÚCLEO (compras)', 'Queda'], sorted([[*nom.get(a['producto_id'], ('', ''))][:2] + [a['antes'], a['crack'], a['solo_nucleo'], a['objetivo']] for a in p['stock']], key=lambda f: -abs(f[5] - f[2])))
hoja('Precios que cambian', ['SKU', 'Producto', 'Precio nuevo'], [[*nom.get(a['producto_id'], ('', ''))][:2] + [a['precio']] for a in p['precios']])
hoja('Precio NÚCLEO más nuevo', ['SKU', 'Producto', 'NÚCLEO (se queda)', 'Crack (actualizar la caja)'], r['precio_nucleo_mas_nuevo'])
hoja('Saltos +-60% (revisar)', ['SKU', 'Producto', 'Precio hoy', 'Crack'], r['salto_mas_60'])
hoja('Precios basura (revisar)', ['Código', 'Producto', 'Crack', 'NÚCLEO'], r['precio_basura'])
hoja('Altas de productos', ['Código', 'Nombre', 'Rubro', 'Precio', 'Costo', 'Alcohol'], [[a['codigo'], a['nombre'], a['rubro'], a['precio'], a['costo'], 'sí' if a['es_alcohol'] else ''] for a in p['altas']])
hoja('Clientes nuevos', ['Código', 'Nombre', 'Teléfono', 'Saldo'], [[a['codigo_legacy'], a['nombre'], a['telefono'], a['saldo']] for a in p['clientes_altas']])
hoja('Cuenta corriente', ['Cliente', 'Saldo NÚCLEO', 'Saldo Crack', 'Ajuste'], [[a['cliente_id'], a['saldo_nucleo'], a['saldo_crack'], a['monto']] for a in p['ctacte_ajustes']])
hoja('Barras de otro producto', ['EAN', 'Código Crack', 'EAN leído'], r['barra_de_otro_producto'])
hoja('Proveedores no encontrados', ['Código', 'Razón social', 'CUIT'], r['proveedores_no_encontrados'])
wb.save(f'{D}/carga-crack-10-11.xlsx'); print('ok')
