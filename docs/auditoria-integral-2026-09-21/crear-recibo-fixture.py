from PIL import Image, ImageDraw, ImageFont
im=Image.new('RGB',(1000,720),'white');d=ImageDraw.Draw(im);f=ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf',28)
for i,s in enumerate(['COMPROBANTE SINTETICO - SIN VALIDEZ','Transferencia enviada','Estado: PENDIENTE DE ACREDITACION','Importe: $12.345,67 ARS','Origen: Cliente de Prueba','Destino: ODB de Prueba','Fecha: 21/09/2026','Operacion: TEST-000001','Este comprobante NO acredita recepcion de fondos.']):d.text((35,35+i*66),s,font=f,fill='black')
im.save('tmp/pdfs/recibo-sintetico.png')
