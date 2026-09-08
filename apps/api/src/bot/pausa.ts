// UNA sola regla para "¿el bot tiene que callar en esta charla?", usada por
// el camino de texto (charla) y por el de archivos (webhook). Hoy (2026-09-08)
// el camino de archivos mandaba "Recibí tu archivo…" con la línea apagada y
// pisaba la pausa de la persona con una derivación que vencía a las 4 h.
export type EstadoLinea = { bot_activo?: boolean | null } | null | undefined;
export type EstadoCharla = { bot_activo?: boolean | null; atendida_por?: string | null; derivada_motivo?: string | null } | null | undefined;

export function atiendeUnaPersona(conv: EstadoCharla): boolean {
  if (!conv || conv.bot_activo !== false) return false;
  return !!conv.atendida_por || /^(Pausado desde la bandeja|Atendida desde el tel[eé]fono)/i.test(String(conv.derivada_motivo ?? ''));
}

export function motivoDeSilencio(linea: EstadoLinea, conv: EstadoCharla, esBancoDePruebas = false): string | null {
  if (linea?.bot_activo === false && !esBancoDePruebas) return 'bot apagado en toda la línea';
  if (atiendeUnaPersona(conv)) return 'conversación en manos de una persona';
  return null;
}
