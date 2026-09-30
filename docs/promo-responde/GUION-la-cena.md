# LA CENA · RESPONDE
### Guion técnico para Higgsfield + capa gráfica propia

**Duración:** ~48 s · **Formato:** 9:16 (1080×1920) · **Tono:** drama silencioso, nada de comedia.

> **La idea:** no mostramos el producto. Mostramos lo que cuesta no tenerlo.
> Él no escuchó lo más importante que le dijeron en el año porque estaba mirando pedidos.
> El golpe no es un mensaje sin responder: es **la cara de no saber qué contestar.**

---

## 1. Decisión de producción (importante)

La IA de video **no sabe escribir texto legible en una pantalla de celular**. Si le pedimos que
muestre WhatsApp con mensajes en español, va a salir un garabato.

Por eso partimos el video en dos fuentes:

| Qué | Quién lo hace | Por qué |
|---|---|---|
| Los planos de la cena (personas, mesa, miradas, silencio) | **Higgsfield** | Necesitamos actuación y piel real |
| **Los insertos de pantalla** (mensajes llegando, respuestas) | **Nuestro motor** | Texto perfecto, tipografía de marca, control al cuadro |
| Los carteles / latigazos / cierre | **Nuestro motor** | Marca RESPONDE |
| Música y sonido | **Nuestro motor** | Sincronizado al cuadro, sin licencias |

**Regla de oro:** en los planos de Higgsfield el celular aparece **de reojo, desenfocado o de canto** —
nunca con la pantalla legible de frente. Cuando hay que leer, cortamos a un **inserto nuestro** donde
el teléfono llena el cuadro. Así no hay que trackear nada y no se rompe la ilusión.

---

## 2. Casting: gente real, NO modelos

> La IA por defecto te da caras perfectas, simétricas, con piel de publicidad. **Eso mata el video.**
> Si el tipo parece modelo, nadie se ve reflejado. Tiene que parecer un cliente tuyo.

**Bloque de casting** (va dentro del fotograma maestro):

```
An ordinary-looking couple in their early 40s, real people, NOT models, NOT attractive
in a commercial way. HIM: thinning hairline, tired eyes with visible dark circles,
uneven patchy stubble, slight double chin, a bit overweight, visible skin pores, an
old blemish on the cheek, a plain wrinkled button-up shirt. HER: no makeup, fine lines
around the eyes and mouth, hair slightly out of place, a simple worn blouse.
Asymmetrical faces, uneven skin tone, natural imperfect Latin American features,
realistic skin texture with pores, shine on the forehead, real body language.
```

**Bloque de fotografía** (esto es lo que le da cine):

```
Low-key cinematic lighting: a single warm practical hanging lamp above the table is the
only light source, hard falloff, most of the frame in deep shadow, crushed blacks,
underexposed background. Out-of-focus foreground occlusion (a wine glass and a bottle
in the near foreground, another diner's shoulder at the edge of frame). Off-center
composition with negative space.
Shot on Sony FX6, 35mm prime, HLG3 log profile, f/1.8 very shallow focus, slight focus
breathing, handheld micro-movement, filmic contrast, halation on the practical light,
35mm film grain, gentle lens vignetting, desaturated shadows, warm highlights.
Hyper-realistic, photorealistic, vertical 9:16.
```

**Negativo** (cargalo en el campo de negative prompt si el modelo lo tiene):

```
model face, flawless skin, makeup, beauty retouching, symmetrical perfect features,
studio lighting, flat even exposure, bright cheerful scene, smiling at camera,
stock photo look, CGI skin, plastic skin, text on screen, subtitles, watermark
```

### Fotograma maestro

Generá **primero uno solo** con los dos personajes y usalo como *imagen inicial*
(image-to-video) en los ocho planos. Sin eso, cada plano te devuelve caras distintas
y perdés créditos al pedo.

```
[BLOQUE DE CASTING]
Having dinner at a small dark restaurant table, seen from a low 3/4 angle. A smartphone
lies face-up on the tablecloth next to his plate. Two glasses of red wine.
[BLOQUE DE FOTOGRAFÍA]
```

**Regla:** los dos bloques (casting + fotografía) van al final de **todos** los prompts
de la lista de planos. En la lista de abajo sólo está la acción de cada plano.

---

## 3. Los planos

### ACTO 1 · LA CENA (0:00 — 0:27)

**P1 · 0:00-0:04 · Establecimiento** — *cámara: dolly in muy lento*
> Wide shot of a man and a woman having dinner at a warm-lit restaurant table. She is
> talking, relaxed, gesturing with her hands. He nods, listening. A smartphone lies
> face-up on the tablecloth beside his plate. Calm, intimate atmosphere.

**P2 · 0:04-0:08 · Ella habla** — *cámara: fija, respiración a mano*
> Medium shot of the woman talking warmly across the dinner table, mid-conversation,
> alive and engaged. The man is soft-focus in the foreground, slightly out of frame.

**P3 · 0:08-0:10 · INSERTO — nuestro** — *pantalla: llega el primer mensaje*
`"Hola, ¿tenés stock de…?"` · un globo entra con vibración

**P4 · 0:10-0:14 · La primera mirada** — *cámara: rack focus de ella al teléfono*
> Close shot of the man at the dinner table. His eyes flick down to the phone screen
> beside his plate, then back up to the woman. Micro-expression of divided attention.
> Rack focus from his face to the phone and back.

**P5 · 0:14-0:16 · INSERTO — nuestro** — *dos mensajes más, uno es un reclamo*

**P6 · 0:16-0:20 · Ella se pone seria** — *cámara: push in lento a ella*
> Medium close-up of the woman across the dinner table. Her expression shifts from light
> to serious. She is telling him something difficult. Slow push in.

**P7 · 0:20-0:23 · Él no está** — *cámara: fija*
> Close-up of the man at the table, eyes down on the phone screen, thumb hovering.
> He is not present. Warm light on half his face.

**P8 · 0:23-0:25 · INSERTO — nuestro** — *el teléfono vibra otra vez · 3 sin leer*

**P9 · 0:25-0:31 · EL SILENCIO** — *cámara: quieta, plano sostenido — el corazón del video*
> Extreme close-up of the man's face at the dinner table. He slowly lifts his eyes from
> the phone to her. Dawning realization that he did not hear a single word. His mouth
> opens slightly and closes. He has nothing to say. Long held shot, no movement.
> Devastating quiet performance.

**P10 · 0:31-0:34 · Ella espera** — *cámara: fija*
> Close-up of the woman looking at him across the table, waiting for a response that
> never comes. Her expression slowly falls. She looks away.

> **Nota de dirección:** en P9 y P10 **no hay música**. Solo el ruido del restaurante y
> la vibración del teléfono. El silencio es el efecto.

### ACTO 2 · EL LATIGAZO (0:34 — 0:39) — *nuestro motor*

Corte seco a negro. Tipografía de marca:

**"NO ESCUCHÓ NADA."** → **"Estaba contestando pedidos."**
→ **NO SEAS COMO ÉL.**

### ACTO 3 · LA RESOLUCIÓN (0:39 — 0:48) — *nuestro motor + un plano*

**P11 · INSERTO — nuestro** — los mismos mensajes, respondiéndose solos, uno por uno:
`Respondido por RESPONDE ✓✓` · el contador baja a **0 sin leer**

**P12 · 0:44-0:47 · El plano espejo** — *cámara: push in muy lento · misma mesa, misma luz*
> Same restaurant table, same two people. The smartphone now lies **face down** on the
> tablecloth. The man is looking directly at the woman, fully present, listening. She is
> talking again, and this time he is there. Warm, calm, resolved.

**Cierre:** RESPONDE · *El que contesta primero.* · **Probame ahora →** · metogroup.ar

---

## 4. La música

Cuerdas clásicas, tenues, casi de fondo — y **partitura dramática sólo en los momentos clave**:

| Momento | Música |
|---|---|
| 0:00-0:16 · la cena | cuarteto de cuerdas suave, cálido, casi imperceptible |
| 0:16-0:25 · ella se pone seria | las cuerdas bajan de tono, entra un cello sostenido |
| **0:25-0:34 · el silencio** | **todo se corta.** Sólo ambiente + la vibración del teléfono |
| 0:34 · el latigazo | golpe de cuerdas seco (stinger) |
| 0:39-0:48 · la resolución | las mismas cuerdas del principio, ahora en mayor, resolviendo |

La partitura la sintetizo yo con el motor, sincronizada al cuadro exacto.

---

## 5. Cómo lo armamos

1. Generás el **fotograma maestro** y lo aprobás (que las caras te gusten).
2. Con esa imagen como semilla, generás los **9 planos de Higgsfield** (P1, P2, P4, P6, P7, P9, P10, P12).
3. Me dejás los MP4 en `docs/promo-responde/footage/` con los nombres `p01.mp4`, `p02.mp4`, etc.
4. Yo hago: los insertos de pantalla, los carteles, el cierre, la música, el color match entre planos,
   y el armado final con los tiempos de arriba.

**Duración total estimada: 48 s.** Si querés versión de pauta, se corta a 30 s sacando P2 y P6.
