// Ventana deslizante de tasa por clave (IP, teléfono, etc.) en memoria — mismo
// patrón que ya usaba el bot de WhatsApp (bot.service.ts), extraído acá para
// reutilizarlo en endpoints públicos que pueden abusarse (crear pedidos sin login).
export class LimitadorTasa {
  private readonly llegadas = new Map<string, number[]>();

  constructor(
    private readonly maxPorVentana: number,
    private readonly ventanaMs: number,
  ) {}

  // true si la clave superó el límite (y ya cuenta este intento en la ventana)
  superaLimite(clave: string): boolean {
    const ahora = Date.now();
    const ventana = (this.llegadas.get(clave) ?? []).filter((t) => ahora - t < this.ventanaMs);
    ventana.push(ahora);
    this.llegadas.set(clave, ventana);
    if (this.llegadas.size > 5000) {
      for (const [k, v] of this.llegadas) {
        if (!v.some((t) => ahora - t < this.ventanaMs)) this.llegadas.delete(k);
      }
    }
    return ventana.length > this.maxPorVentana;
  }
}
