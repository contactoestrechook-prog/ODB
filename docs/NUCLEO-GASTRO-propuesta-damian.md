# NÚCLEO Gastro — Propuesta superadora para Damián (Puerto Iguazú)

> No es un sistema de gestión. Es el **sistema nervioso** del restaurante.
> Fudo es la memoria: anota lo que pasó. NÚCLEO **siente en tiempo real, entiende y actúa.**
> Caso testigo #1 del vertical gastronómico de MetoGroup.

---

## 0. El cambio de marco (esto es lo que faltaba)

La primera versión vendía features. Esto vende una idea nueva.

**Damián no vende picaña. Vende asiento-hora.**

Su capacidad es el techo (300 cubiertos/día) y su cliente es turista: no vuelve nunca.
Entonces su negocio es idéntico al de una aerolínea o un hotel: tiene un **inventario perecedero
que se evapora cada minuto**. Un asiento vacío a las 21:30 de un sábado no se recupera jamás —
igual que un avión que despega con la butaca vacía. Una mesa que tarda 12 minutos de más en
liberarse cuando hay cola en la vereda es una venta que se cayó al piso y nadie la anotó.

Las aerolíneas y los hoteles resolvieron esto hace 40 años con una sola disciplina:
**revenue management** — medir el rendimiento de cada unidad de inventario y optimizarlo.
En gastronomía existe la métrica equivalente, sale de la Escuela de Hotelería de Cornell, y
**ningún restaurante de Iguazú la conoce**:

### RevPASH — Revenue Per Available Seat-Hour

```
                 Ingreso del período
  RevPASH  =  ─────────────────────────────
              Asientos  ×  Horas de servicio
```

Es la única métrica que junta las tres palancas de Damián en un solo número:

```
  RevPASH  =  Ocupación  ×  Rotación  ×  Ticket
              (¿está      (¿cuántas    (¿cuánto
               lleno?)     veces gira   deja cada
                           la mesa?)    mesa?)
```

Todo lo que sigue —cada métrica, cada feature de IA, hasta las reseñas— existe para mover
**ese** número. Esa es la propuesta: no "te doy reseñas y una carta con QR".
Es **"te doy el primer sistema de revenue management gastronómico con IA del país,
y de paso te arreglo Google".**

---

## 1. "Medí el promedio de todo" — el catálogo maestro

Pediste medir el tiempo de mesa y el promedio de todo. Acá está *todo*.
Cada mesa tiene un ciclo de vida de 7 estados, y de esos 7 timestamps sale absolutamente cada
número del negocio. El ciclo lo maneja la máquina de estados que **ya existe** en el core
(`pedidos/transiciones`), sólo se re-mapea a "mesa".

### El reloj de la mesa (el corazón de lo que pediste)

```
  t0 ────► t1 ────► t2 ────► t3 ────► t4 ────► t5 ────► t6 ────► t7
 sienta   ve la   comanda  1er plato  termina  pide    paga    mesa
          carta   tomada   servido    de comer cuenta          libre
  │        │        │         │         │        │       │       │
  └─ enganche       └─ cocina │         └─ ventana        └─ TIEMPO MUERTO
     └── atención del mozo ───┘            de postre         (el asesino)
```

| # | Intervalo | Qué mide | Por qué importa |
|---|---|---|---|
| t0→t1 | **Enganche** | Cuánto tarda en escanear la carta | Si es alto, falta señalización del QR |
| t1→t2 | **Atención** | Mesa esperando al mozo | Predictor #1 de mala reseña |
| t2→t3 | **Cocina** | Comanda → plato en mesa | Cuello de botella de cocina por franja |
| t3→t4 | **Consumo** | Lo que tardan en comer | Base para proyectar liberación |
| t4→t5 | **Ventana de upsell** | Postre/café/bajativo | Oro puro: acá se sube el ticket |
| t5→t6 | **Cobro** | Pide cuenta → paga | Se ataca con pago por QR en mesa |
| t6→t7 | **Tiempo muerto** | Pagó pero no se levantó / no se limpió | **Inventario tirado a la basura** |
| **t0→t7** | **Tiempo de mesa** | El total | La palanca de rotación |

Y cada intervalo se promedia **cruzado por**: franja horaria · mozo · tamaño de grupo ·
día de semana · sector del salón · nacionalidad (idioma del QR). Ahí aparecen las verdades
incómodas: *"la cocina tarda 9 minutos más los viernes 21-22h"*, *"el mozo X rota la mesa
en 41 min, el mozo Y en 58"*.

### Todos los demás promedios

<table>
<tr><th>Familia</th><th>Métricas</th></tr>
<tr><td><b>💰 Dinero</b></td><td>Ticket por mesa · ticket por cubierto · <b>gasto por cubierto por minuto</b> (yield real) · ítems por cubierto · mix de venta (% picaña / bife / mila) · margen por plato / por mesa / por asiento-hora</td></tr>
<tr><td><b>🔁 Rotación</b></td><td>Giros por mesa por turno · ocupación % en franjas de 30 min (heatmap del salón) · asiento-horas vendidas vs. disponibles · <b>RevPASH</b></td></tr>
<tr><td><b>🎯 Upsell</b></td><td>Tasa de postre · de café · de bajativo · de segunda vuelta de tragos · efectividad del Anfitrión IA (ticket con vs. sin sugerencia)</td></tr>
<tr><td><b>🍸 El 2x1</b></td><td>Costo real del 2x1 por franja · margen quemado en pico vs. valle · mesas <i>atraídas</i> por el 2x1 vs. mesas que lo usaron ya estando adentro</td></tr>
<tr><td><b>⭐ Reputación</b></td><td>Tasa de captura de reseñas (reseñas/mesas) · NPS de mesa en vivo · sentimiento por tema (comida/servicio/tiempo/precio/limpieza) · tiempo de respuesta · rating de Google en el tiempo</td></tr>
<tr><td><b>🚶 Cola</b></td><td>Gente en espera · tiempo de espera · <b>tasa de abandono</b> (los que se fueron de la vereda = demanda perdida medida)</td></tr>
</table>

**El número que le va a doler (del bueno):** el *tiempo muerto*. Si son 8 min por mesa × 100
mesas/día = **13 horas-asiento tiradas cada día**. En horario de cola, eso son varias mesas
enteras que se pierden. Nadie lo mide. NÚCLEO lo pone en la pantalla el primer día.

---

## 2. Las tres capas: SENTIR · ENTENDER · ACTUAR

### 🫀 Capa 1 — SENTIR: El Piso Vivo

Un gemelo digital del salón, en el teléfono de Damián, actualizado al segundo.
Cada mesa es un ladrillo con su reloj corriendo, su ticket proyectado y su **color de salud**:

```
   EL PISO VIVO · sábado 21:47 · ocupación 92% · cola: 4 grupos (~14 min)
  ┌──────────┬──────────┬──────────┬──────────┐
  │  M1  🟢  │  M2  🟢  │  M3  🟡  │  M4  🔴  │
  │  32 min  │  18 min  │  51 min  │  8 min   │
  │ $ com.   │ postre?  │ →cuenta  │ ⚠ espera │
  │ ~libre 15│ ~libre 8 │ ~libre 4 │  al mozo │
  ├──────────┼──────────┼──────────┼──────────┤
  │  M5  🟢  │  M6  🟢  │  M7  🟡  │  M8  🟢  │
  │  ...     │          │          │          │
  └──────────┴──────────┴──────────┴──────────┘
   🔴 = mesa en riesgo (rescate en vivo)   ~libre = predicción IA
```

- **🟢 verde:** fluye bien.
- **🟡 amarillo:** oportunidad — está en la ventana de postre, o a punto de liberarse
  (avisale a la cola).
- **🔴 rojo:** **mesa en riesgo.** Lleva demasiado en un estado sin avanzar (espera al mozo,
  espera la comida hace 25 min). El encargado recibe la alerta **antes de que esa demora se
  transforme en una reseña de 1 estrella.** Rescate en vivo con un trago o una disculpa.

Esto es lo que une las dos mitades del negocio: **el tiempo de mesa no es sólo rotación,
es el detector temprano de una mala reseña.** Una mesa que espera de más es una bomba de tiempo.
El Piso Vivo la desactiva mientras el cliente todavía está sentado.

**¿Cómo se mide sin tocar Fudo?** Tres fuentes, ninguna depende de reemplazar la comanda:
1. **El QR de mesa** marca t0/t1 solo (el cliente escanea para ver la carta) y t5/t6 si paga
   por QR. Cierra medio ciclo sin que nadie toque nada.
2. **Una PWA ultra simple para el mozo** (3-4 toques: *tomé comanda · serví · pidió cuenta ·
   liberé*). Nada de escribir, nada que compita con Fudo.
3. **API de Fudo** como acelerador: si expone apertura/cierre de comanda, leemos esos timestamps
   directo y el mozo toca aún menos. *(A validar técnicamente antes de prometerlo.)*

### 🧠 Capa 2 — ENTENDER: El Analista IA

El tablero de la mañana. Damián abre el teléfono con el café y ve el negocio explicado,
no una planilla. Es el módulo `analista` del core, con el dominio de gastronomía:

```
   ☀️  Buen día Damián · resumen de ayer (viernes)
  ─────────────────────────────────────────────────
   RevPASH        $ 11.240 / asiento-hora   ▲ 6% vs. viernes típico
   Tiempo de mesa 47 min                    ▼ 3 min (¡mejor rotación!)
   Tiempo muerto  6,2 min/mesa   ← 38 asiento-horas = ~$X perdidos
   Ticket medio   $ 18.900                  ▲ 4%
   Tasa de postre 22%                       ▼ (potencial: +$Y/día)
   Reseñas nuevas 11 (rating semana: 4,3 ▲) · 2 respondidas por IA
  ─────────────────────────────────────────────────
   💡 La IA encontró algo:
   "El tiempo muerto se dispara los findes: la cuenta tarda 9 min
    promedio de 21 a 23h. Si activás pago por QR en la mesa, recuperás
    ~4 mesas por noche de sábado. Eso es la cola entera que se te va."
```

El Analista no reporta: **explica el porqué y propone la acción.** Correlaciona todo con todo —
reseñas malas contra turnos y mozos, demoras contra franjas, márgenes contra el 2x1.

### ⚡ Capa 3 — ACTUAR: El Director IA

Acá está la magia de verdad. El sistema no sólo mira: **mueve las palancas.**

1. **2x1 dinámico (yield management puro).** Hoy el 2x1 es fijo, almuerzo y cena — regala margen
   en el pico donde el salón se llena solo. El Director lo vuelve inteligente: mira la ocupación
   *proyectada* y sugiere activarlo sólo cuando el salón va a estar flojo.
   *"Hoy 19h vas al 40% → activá 2x1. Sábado 21h estás lleno → apagalo, estás regalando plata."*
   El 2x1 deja de ser un costo fijo y pasa a ser un imán para los valles.

2. **Mise-en-place predictivo.** *"Mañana: viernes, 31°, feriado en Brasil, 2 reservas de grupo.
   Preparás 42 picañas, 30 bifes, 25 milanesas."* En un negocio de carne —producto caro y
   perecedero— acertar el defrost es plata directa: menos quiebre de stock en el pico, menos
   desperdicio en el valle. Sale del histórico + clima + calendario de feriados (AR y BR).

3. **Lista de espera con predicción de liberación.** El Piso Vivo sabe que la M3 se libera en
   ~4 min → le manda WhatsApp al grupo de la cola justo a tiempo. El turista se va a la costanera
   y vuelve. La tasa de abandono baja y queda **medida**.

4. **El Anfitrión IA.** Es tu Sommelier de ODB con la carta de Damián. Carta trilingüe (ES/PT/EN)
   por QR, y sobre eso un anfitrión que arma la mesa, sugiere el vino para la picaña y sube el
   ticket *antes de que el mozo llegue* — atendiendo en portugués al brasileño que no se anima a
   preguntar.

5. **Reputación como sistema inmune.** Termómetro de mesa trilingüe: contento → un toque a Google
   sin fricción; molesto → WhatsApp del encargado *en el momento*, la mesa todavía sentada.
   La reseña de 1 estrella no se escribe porque el problema se resolvió en la mesa.
   Y toda reseña que igual entra se responde con IA en menos de 24h, en su idioma.

   > ⚠️ **Sin atajos.** Se le pregunta a **todos** por igual y **no se premia** dejar reseña.
   > Filtrar por contento/enojado antes de mandar a Google ("review gating") o pagar reseñas viola
   > las políticas de Google y puede costar el perfil entero. Lo legítimo —y lo que hace la
   > diferencia— es **detectar el problema antes de que el cliente salga por la puerta.**

---

## 3. La aritmética de la magia (con las palancas del RevPASH)

Todo lo de arriba se traduce en un solo número moviéndose. Con ~9.000 cubiertos/mes:

| Palanca | Cómo la mueve NÚCLEO | Efecto conservador |
|---|---|---|
| **Rotación** | Bajar tiempo de mesa 47→42 min ataca tiempo muerto y demoras | +10% de giros **en las horas con cola** = venta que hoy se cae |
| **Ticket** | Anfitrión IA + subir tasa de postre del 22% | +3-5% de ticket |
| **Ocupación** | Lista de espera + 2x1 dinámico llenando valles | +2 a 5 mesas/día |
| **Margen** | 2x1 recortado al valle + mise-en-place sin desperdicio | margen recuperado directo |
| **Reputación** | 5-12% de captura sepulta el historial → más tráfico orgánico | efecto compuesto, baja dependencia de agencias |

Sobre 9.000 cubiertos mensuales, **un +3% de ticket ya paga el abono varias veces.**
Y la rotación en pico es plata que hoy, literalmente, se va caminando por la vereda.
La conversación con Damián no es *"cuánto sale"* — es *"cuánto de esto es plata que hoy se te
cae al piso todos los días sin que lo veas".*

**Palanca comercial:** MetoGroup es proveedor del **Kit 4.0** (el Estado financia hasta 50% de la
transformación digital). Si el resto califica como PyME elegible, la mitad la paga el programa.

---

## 4. Por qué esto es rápido: ya está casi todo construido

Respeta el núcleo: mismo core, mismo schema, mismos despliegues. Se **activan** módulos.

| Módulo del core (ODB) | Rol en gastronomía | Estado |
|---|---|---|
| `pedidos` (máquina de estados + `transiciones`) | **El reloj de la mesa (7 estados)** | ✅ se re-mapea |
| `analista` + `estadisticas` | **El Analista IA / tablero de la mañana** | ✅ reusable |
| `sommelier` | **El Anfitrión IA** (mismo motor) | ✅ reusable |
| `agente` (herramientas + confianza) | El Director que propone y actúa | ✅ vivo |
| `bot` (WhatsApp) | Lista de espera, avisos, post-visita | ⚠️ falta alta en Meta |
| `eventos` + `presupuesto` | **Grupos, agencias, contingentes** (oro en Iguazú) | ✅ reusable |
| `caja` + `facturacion` (ARCA WSFE) | Facturación propia — Fase 2 | ✅ vivo |
| `contable` · `tarjetas` · `conciliacion` | Cierre, Getnet/Clover/MP | ✅ vivo |
| `catalogo` | Carta trilingüe con fotos y precios | ✅ reusable |
| **`sala`** (Piso Vivo + QR de mesa + PWA mozo) | La capa de tiempo real | 🔨 **a construir** |
| **`reputacion`** (termómetro + reseñas + radar) | El sistema inmune | 🔨 **a construir** |

El delta real son **dos módulos nuevos**. El 80% del "sistema revolucionario" ya corre en producción.

---

## 5. Cómo encaja en la escalera de MetoGroup

| Escalón | Qué es acá | Gancho comercial |
|---|---|---|
| **Respondé** | Termómetro + respuesta IA a reseñas | Puerta de entrada. Barato, 1 semana, resultado visible en Maps en 30 días |
| **BPC:2026** | La auditoría **es** el Analista: RevPASH, tiempo muerto, margen del 2x1, fugas | Justifica todo lo demás con números propios de Damián |
| **Implementación** | Piso Vivo, Anfitrión, Director, lista de espera, grupos | Mueve las tres palancas del RevPASH |
| **NÚCLEO** | Comandas + facturación propias, el sistema completo | Fudo se va cuando él lo pida |

Puede entrar sólo por **Respondé**. Si en 60 días las reseñas se dan vuelta y ve su primer
RevPASH, el resto se vende solo.

---

## 6. El piloto — Damián como caso testigo #1

**90 días. Precio de fundador.**

| Semanas | Entrega |
|---|---|
| 1 | Auditoría express: Google Business Profile, carta, costos de tragos, RevPASH base, foto de reputación actual |
| 2-3 | QR + termómetro + respuesta IA a reseñas **vivos** |
| 4-6 | Piso Vivo + PWA del mozo → **tiempo de mesa medido de verdad** |
| 7-9 | Analista completo (RevPASH, tiempo muerto, margen del 2x1) + Anfitrión |
| 10-12 | 2x1 dinámico + lista de espera WhatsApp + informe de resultados |

A cambio del precio de fundador: **(1)** los datos reales del vertical (los necesitás para vender
el segundo), **(2)** testimonio en video con el antes/después de Maps y del RevPASH, **(3)** derecho
a usar el caso para vender en Iguazú.

**El negocio no es Damián, es la llave.** Puerto Iguazú: 100+ restaurantes y toda la hotelería
mirando las mismas estrellas, mercado chico y de boca a boca. Un caso fuerte abre veinte puertas
sin vendedor.

---

## 7. Riesgos, de frente

| Riesgo | Mitigación |
|---|---|
| **API de Google Business Profile** requiere aprobación y puede demorar | ⚠️ **Validar primero.** Plan B: gestión asistida con acceso delegado |
| Políticas de Google (reseñas incentivadas / filtradas) | Diseño limpio desde el día 1: a todos, sin premio |
| **Medir tiempos exige input** (mozo o QR) | Se arranca con lo automático (QR) y 3 toques del mozo; la API de Fudo, si existe, lo hace invisible |
| Los mozos boicotean la PWA / el QR | Ranking por mozo visible + el termómetro también va en el ticket |
| Conectividad en Iguazú | El core ya es *offline-first* con cola de sync |
| Estacionalidad | Medir en temporada y contra-temporada antes de concluir |
| Fudo no expone datos | La Fase 1 **no depende** de Fudo. Por eso entra por afuera |

---

## 8. La frase para arrancar la charla

> *"Damián, vos no vendés picaña. Vendés mesas. Tenés 300 lugares por día y cada minuto que una
> mesa está ocupada al pedo o vacía mientras hay cola afuera, es plata que se te cae al piso y no
> la anota nadie —ni Fudo, ni vos. Te vengo a mostrar, por primera vez, cuánto vale cada mesa por
> hora en tu resto. Y a subírtelo. Lo de las reseñas de Google te lo arreglo de yapa."*

---

*Documento de trabajo — MetoGroup / NÚCLEO Gastro. RevPASH: Cornell School of Hotel Administration.
Los rangos de captura de reseñas y de uplift son referencias del rubro, a validar con los datos
reales del local. La medición fina de tiempos requiere input de mozo (PWA) y/o integración con la
API de Fudo, sujeta a validación técnica.*
