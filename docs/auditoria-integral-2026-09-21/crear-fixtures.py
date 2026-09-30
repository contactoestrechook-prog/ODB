from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4
from pathlib import Path
out=Path('output/pdf/auditoria-integral')
def doc(name,lines):
 c=canvas.Canvas(str(out/name),pagesize=A4)
 for page in lines:
  y=800
  for line in page:
   c.setFont('Helvetica',11);c.drawString(40,y,line);y-=25
  c.showPage()
 c.save()
doc('01-packs-bonificacion.pdf',[[
'DOCUMENTO SINTETICO - SIN VALIDEZ FISCAL','Distribuidora Prueba - CUIT 30-00000000-0','FACTURA A 0001-00000001 - 21/09/2026','Cliente: Comercio de Prueba','Descripcion | Cantidad | Precio por pack | Importe neto',
'Agua mineral 1,5 L - pack x 6 | 2 packs | $6.000,00 | $12.000,00',
'Agua mineral 1,5 L - pack x 6 | 1 pack | $6.000,00 | $0,00',
'Bonificacion del segundo renglon: 100% (mercaderia sin cargo)',
'Neto gravado: $12.000,00','IVA 21%: $2.520,00','TOTAL: $14.520,00']])
doc('02-peso-decimales.pdf',[[
'DOCUMENTO SINTETICO - SIN VALIDEZ FISCAL','Proveedor de Prueba - CUIT 30-00000000-0','FACTURA A 0001-00000002 - 21/09/2026','Descripcion | Cantidad kg | Precio por kg | Importe neto',
'Queso cremoso a granel | 0,500 kg | $1.500,50 | $750,25',
'Neto gravado: $750,25','IVA 21%: $157,55','TOTAL: $907,80']])
doc('03-dos-paginas.pdf',[[
'DOCUMENTO SINTETICO - SIN VALIDEZ FISCAL','Proveedor de Prueba - CUIT 30-00000000-0','FACTURA A 0001-00000003 - Hoja 1 de 2',
'Descripcion | Cantidad unidades | Precio unitario | Importe neto','Detergente 500 ml | 3 | $100,00 | $300,00','Subtotal que pasa a hoja 2: $300,00'],[
'DOCUMENTO SINTETICO - SIN VALIDEZ FISCAL','FACTURA A 0001-00000003 - Hoja 2 de 2','Subtotal anterior: $300,00',
'Descripcion | Cantidad unidades | Precio unitario | Importe neto','Lavandina 1 L | 2 | $200,00 | $400,00',
'Neto gravado: $700,00','IVA 21%: $147,00','TOTAL FACTURA (ambas hojas): $847,00']])
