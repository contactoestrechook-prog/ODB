from PIL import Image, ImageDraw, ImageFont
im=Image.new('RGB',(1000,700),'white');d=ImageDraw.Draw(im);font=ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf',30)
for x in [170,570]:
 d.rounded_rectangle((x,140,x+240,610),radius=55,fill='#cfedf9',outline='#435f70',width=5)
 d.rectangle((x+70,70,x+170,165),fill='#cfedf9',outline='#435f70',width=5)
 d.rounded_rectangle((x+65,50,x+175,90),radius=8,fill='#2059a2')
 d.rectangle((x+10,290,x+230,445),fill='white',outline='#2059a2',width=3)
 for j,t in enumerate(['AGUA PRUEBA','Sin gas','1,5 L']):d.text((x+14,300+j*44),t,fill='black',font=font)
d.text((75,645),'Ilustracion sintetica para evaluar reconocimiento',fill='black',font=font)
im.save('tmp/pdfs/dos-botellas.png')
