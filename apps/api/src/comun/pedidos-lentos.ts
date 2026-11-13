import { Logger } from '@nestjs/common';

// PEDIDOS LENTOS (13/11/2026). Anabella avisó «está tardando mucho el sistema
// en responder» y no había con qué saber qué pantalla ni cuánto: la API no
// guardaba la duración de nada. Desde ahora todo pedido que tarda más de 3 s
// queda en el log con la ruta (sin lo que va después del «?»), cómo terminó,
// cuánto tardó y quién lo pidió. Regulable con PEDIDO_LENTO_MS.

const log = new Logger('Lento');

export function textoPedidoLento(
  req: { method?: string; originalUrl?: string; url?: string; usuario?: { sub?: string; rol?: string } },
  estado: number,
  ms: number,
): string {
  const ruta = String(req.originalUrl ?? req.url ?? '').split('?')[0];
  const quien = req.usuario?.sub ? `${req.usuario.rol} ${req.usuario.sub}` : 'sin sesión';
  return `${req.method} ${ruta} → ${estado} · ${(ms / 1000).toFixed(1)} s · ${quien}`;
}

export function registrarPedidosLentos(umbralMs = Number(process.env.PEDIDO_LENTO_MS) || 3000) {
  return (req: any, res: any, next: () => void) => {
    const t0 = Date.now();
    let anotado = false;
    const anotar = (cortado: boolean) => {
      if (anotado) return;
      anotado = true;
      const ms = Date.now() - t0;
      if (ms >= umbralMs) log.warn(`${textoPedidoLento(req, cortado ? 499 : res.statusCode, ms)}${cortado ? ' · la persona se fue antes' : ''}`);
    };
    res.on('finish', () => anotar(false));
    res.on('close', () => anotar(!res.writableEnded));
    next();
  };
}
