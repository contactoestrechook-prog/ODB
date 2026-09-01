// ---- PROLIJIDAD DEL LISTADO ----
// En WhatsApp un listado escrito de corrido es ilegible: "Ya cotizado: - 4 ×
// Agua 2L: 4 × $2.300 c/u = $9.200 - 1/2 kg Queso..." es un bloque de texto.
// Cada renglón tiene que ir en SU línea, con viñeta uniforme y el total en
// negrita. Esto no se le pide al modelo: se normaliza acá, siempre igual.
// Además, el cartel gráfico del pedido parsea estas líneas: si el total viene
// pegado al renglón, la tarjeta no sale.
// El saludo acompaña el reloj de Buenos Aires: buen día hasta las 13, buenas
// tardes hasta las 20, buenas noches después. El modelo no tiene reloj, así
// que esto se decide acá y no por su buena voluntad.
export function saludoSegunHora(hora: number): string {
  return hora < 13 ? 'Buen día' : hora < 20 ? 'Buenas tardes' : 'Buenas noches';
}

// Primer mensaje de una charla: arranca SIEMPRE con el saludo correcto para la
// hora y la bienvenida a la casa, diga lo que diga el modelo. Si el modelo ya
// saludó con otra hora, se corrige; si no saludó, se antepone; la bienvenida
// no se duplica si ya la puso él.
export function saludarConBienvenida(respuesta: string, saludo: string): string {
  let r = respuesta.trim();
  // "Hola, buen día" → el hola sobra si ya viene el saludo horario
  r = r.replace(/^¡?hola[.,!]?\s+(?=¡?buen)/i, '');
  // se quita el saludo que haya puesto el modelo (con la hora que imaginó)
  r = r.replace(/^¡?(buen d[ií]a|buen[oa]s d[ií]as|buenas tardes|buenas noches|hola)[!.,]?\s*/i, '');
  const yaDaBienvenida = /bienvenid/i.test(r);
  if (r) r = r[0].toUpperCase() + r.slice(1);
  const arranque = yaDaBienvenida ? `${saludo}. ` : `${saludo}, le damos la bienvenida a O.D.B. `;
  return (arranque + (r || '¿En qué lo puedo ayudar?')).trim();
}

// Un nombre de cliente es un nombre o no es nada: en producción llegó a
// guardarse un fragmento de llamada de herramienta ('</parameter>…"tipo">pickup')
// como nombre de un cliente real. Solo letras, espacios y puntuación de
// nombres; cualquier otra cosa se descarta y el pedido sigue sin nombre.
export function nombreLimpio(s: string | null | undefined): string | null {
  const n = String(s ?? '').trim().replace(/\s+/g, ' ');
  if (!n || n.length > 60) return null;
  if (!/^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ][A-Za-zÁÉÍÓÚÜÑáéíóúüñ'’.\- ]*$/.test(n)) return null;
  return n;
}

export function emprolijarListado(t: string): string {
  let r = t;
  // 1. cada guion/viñeta de listado arranca renglón propio
  r = r.replace(/[ \t]+[-–—•]\s+(?=[A-ZÁÉÍÓÚÑ0-9¿])/g, '\n• ');
  r = r.replace(/^[ \t]*[-–—]\s+/gm, '• ');
  // 2. "Ya cotizado:" / "Le confirmo lo que quedó:" cortan antes del listado
  r = r.replace(/([:：])[ \t]*(?=•)/g, '$1\n');
  // 3. una línea en blanco antes del listado, ninguna adentro
  r = r.replace(/\n{3,}/g, '\n\n');
  r = r.replace(/(•[^\n]*)\n\n(?=•)/g, '$1\n');
  // 4. lo que sigue a un importe y arranca en mayúscula o pregunta NO es
  // parte del renglón: "$20.900 Subtotal…" y "$4.700 ¿Busca…" quedaban
  // pegados al último ítem del listado
  r = r.replace(/(\$[\d.]+)[ \t]+(?=[¿A-ZÁÉÍÓÚÑ])/g, '$1\n\n');
  // 4a. la pregunta pegada al final de un renglón baja a su propia línea:
  // "…(se compra en el mostrador) ¿Cuántas necesita?" — la regla del importe
  // no la ve porque el renglón termina en paréntesis, no en precio
  r = r.replace(/^(•[^\n¿]*?)[ \t]+(¿[^\n]*\?)[ \t]*$/gm, '$1\n\n$2');
  // 4b. si el modelo YA escribió el total en negrita y pegado al renglón
  // ("= $15.000 *Total: $15.000* Es el total…"), se le saca la negrita y se
  // corta a renglón propio; la regla 5 lo vuelve a armar siempre igual
  r = r.replace(/\*[ \t]*(total[^:\n*]{0,30}:?[ \t]*\$\s?[\d.]+)[ \t]*\*/gi, '$1');
  r = r.replace(/[ \t]+(?=total[^:\n]{0,30}:?[ \t]*\$)/gi, '\n');
  // 5. el TOTAL en negrita de WhatsApp y en su propia línea
  r = r.replace(/(?:^|\n)[ \t]*(?:•\s*)?(total[^:\n]{0,30}:?)[ \t]*(\$\s?[\d.]+)/gi,
    (_m, etiqueta: string, monto: string) => `\n\n*${etiqueta.trim().replace(/:$/, '')}: ${monto.replace(/\s/g, '')}*`);
  // 5b. lo que sigue al total en su misma línea baja a renglón propio
  r = r.replace(/(\*total[^\n]{0,40}\$[\d.]+\*)[ \t]+(?=[¿A-ZÁÉÍÓÚÑ*])/gi, '$1\n\n');
  // 6. separadores de miles uniformes ($9200 → $9.200) y sin espacio tras $
  r = r.replace(/\$\s+(\d)/g, '$$$1');
  r = r.replace(/\$(\d{4,})\b/g, (_m, n: string) => '$' + Number(n).toLocaleString('es-AR'));
  // 7. el signo × uniforme (x, X, * entre números)
  r = r.replace(/(\d)\s*[xX*]\s*(?=\$|\d)/g, '$1 × ');
  return r.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
}
