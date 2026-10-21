import { HttpException, HttpStatus } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';

// El PIN de supervisor tiene 4 dígitos y verificar_pin_supervisor no cuenta
// los errores: quien tuviera un usuario de caja, depósito o administrativo
// podía probarlos todos en un bucle contra caja/autorizar o
// compras/autorizar-prorrateo (unos 35 minutos), y de paso frenaba todo el
// panel, porque el límite global se cuenta por la IP del servidor del panel
// (revisión del 21/10/2026). Ahora se frena por usuario: 5 PIN errados en 15
// minutos y ese usuario no puede probar más durante 15 minutos. Cada error
// queda en auditoría (pin_supervisor_errado). En memoria: vale para la
// instancia que corre (hay una sola).

export const PIN_MAX_ERRADOS = 5;
export const PIN_VENTANA_MS = 15 * 60_000;

type Cuenta = { errados: number; desde: number; frenadoHasta: number };

export class FrenoDePin {
  private readonly cuentas = new Map<string, Cuenta>();

  constructor(
    private readonly max = PIN_MAX_ERRADOS,
    private readonly ventanaMs = PIN_VENTANA_MS,
    private readonly ahora: () => number = Date.now,
  ) {}

  /** Si el usuario está frenado, corta con 429 diciendo cuánto falta. */
  revisar(usuario: string): void {
    const c = this.cuentas.get(usuario);
    const t = this.ahora();
    if (!c || c.frenadoHasta <= t) return;
    const minutos = Math.max(1, Math.ceil((c.frenadoHasta - t) / 60_000));
    throw new HttpException(
      `Demasiados PIN errados seguidos. Probá de nuevo en ${minutos === 1 ? '1 minuto' : `${minutos} minutos`} o pedile al supervisor que lo teclee él.`,
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  /** Cuenta un PIN errado. Devuelve true si con este quedó frenado. */
  errado(usuario: string): boolean {
    const t = this.ahora();
    const previa = this.cuentas.get(usuario);
    const c: Cuenta = previa && t - previa.desde < this.ventanaMs ? previa : { errados: 0, desde: t, frenadoHasta: 0 };
    c.errados += 1;
    if (c.errados >= this.max) c.frenadoHasta = t + this.ventanaMs;
    this.cuentas.set(usuario, c);
    return c.frenadoHasta > t;
  }

  /** Un PIN correcto borra la cuenta de errores. */
  acerto(usuario: string): void {
    this.cuentas.delete(usuario);
  }
}

/** Uno solo para la caja y el prorrateo: los errores de los dos suman juntos. */
export const frenoDePin = new FrenoDePin();

/**
 * Deja en auditoría un PIN de supervisor errado: quién lo tecleó, dónde y si
 * con ese quedó frenado. Si la auditoría falla, la respuesta no cambia.
 */
export async function registrarPinErrado(db: SupabaseClient, usuarioId: string | undefined, donde: 'caja' | 'prorrateo', frenado: boolean) {
  try {
    await Promise.resolve(
      db.from('auditoria').insert({
        usuario_id: usuarioId ?? null,
        accion: 'pin_supervisor_errado',
        entidad: 'usuario',
        entidad_id: usuarioId ?? 'sin-usuario',
        datos_despues: { donde, frenado },
      }),
    );
  } catch {
    // la auditoría no frena la respuesta
  }
}
