# RESPONDE · reels para redes (estética metogroup.ar)

Todo generado por código: 1080×1920 @60fps, sin licencias de música ni stock.
Newsreader + Inter Tight, paleta grafito / hueso / tan `#c9a96e`, grano pesado.

| script | salida | qué es |
|---|---|---|
| `composition-a.html` | responde-247.mp4 (46s) | ancla: qué es RESPONDE y cómo funciona |
| `composition-b.html` | responde-secretaria.mp4 (43s) | consultorio: turnos + recordatorios (mundo papel) |
| `composition-c.html` | responde-vendedor.mp4 (44s) | Plan Manager: link de Mercado Pago + cobro |
| `composition-d.html` | responde-vendedor-corto.mp4 (24s) | versión corta, 7 golpes grandes |
| `composition-e.html` | responde-sin-excusas.mp4 (33s) | manifiesto v1 (sólo carteles) |
| `composition-f.html` | responde-manifiesto.mp4 (34s) | manifiesto v2: HUD, índice de placa, cronómetro |
| `composition-g.html` | responde-latido.mp4 (38s) | **paro cardíaco**: ECG en vivo + casilla explotada |

## Cómo se genera

```bash
npm i playwright-core
node render.mjs --file composition-g.html --fps 60 --outdir frames-g
node score.mjs g
ffmpeg -framerate 60 -i frames-g/f%05d.jpg -i mix-g.wav -c:v libx264 -preset slow -crf 21 -pix_fmt yuv420p -c:a aac -b:a 192k -movflags +faststart -shortest responde-latido.mp4
```

Preview de un momento puntual, sin renderizar todo:

```bash
node render.mjs --file composition-g.html --stills "9.5,24.5"
```

## Piezas

- **`motor.js`** — motor compartido: cámara (whips, shakes, flashes), grano, mundo oscuro/papel,
  scramble de texto, odómetro, chat, y el margen de seguridad para Instagram (contenido al 93%).
  Paletas de fondo intercambiables: `brasa` (cálida), `grafito` (fría), `petroleo`.
- **`latidos.js`** — fuente única del pulso del video G. La usan el ECG en pantalla y el audio,
  así el latido que se ve y el que se escucha son exactamente el mismo.
- **`score.mjs`** — música y efectos sintetizados por video (braams, plucks, sellos de goma,
  latidos, tono de línea plana, monedas).
- Los textos y los tiempos de cada video están en la constante `TL` al inicio de su `composition`.

## Notas de marca

- RESPONDE es la **etapa 00** de MetoGroup (empleados virtuales con IA). No confundir con NÚCLEO
  (etapa 03) ni con el módulo de reseñas del vertical gastronómico.
- Los cierres llevan CTA + `metogroup.ar`. Sin mención al Kit 4.0 (se quitó a pedido).
- Los casos son genéricos a propósito (corralón, consultorio, tienda): no se usan clientes reales.
