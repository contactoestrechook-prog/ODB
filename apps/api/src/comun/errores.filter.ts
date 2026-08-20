import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';

// Deja registrado TODO error que el API devuelve, con la ruta, el mensaje y el
// usuario. Sin esto, cuando alguien del local avisa "me tira error", del lado
// del servidor no queda rastro: el navegador solo muestra "400" y hay que
// adivinar. Los 401 no se registran (son ruido: sesiones vencidas).
@Catch()
export class ErroresFilter implements ExceptionFilter {
  private readonly log = new Logger('Errores');

  catch(error: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest();
    const res = ctx.getResponse();

    const esHttp = error instanceof HttpException;
    const status = esHttp ? error.getStatus() : 500;
    const cuerpo: any = esHttp ? error.getResponse() : { message: 'Error interno' };
    const mensaje = typeof cuerpo === 'string' ? cuerpo : (cuerpo?.message ?? '');

    if (status !== 401) {
      const quien = req?.usuario?.sub ? `${req.usuario.rol} ${req.usuario.sub}` : 'sin sesión';
      const texto = `${req?.method} ${req?.url} → ${status} · ${Array.isArray(mensaje) ? mensaje.join(' / ') : mensaje} · ${quien}`;
      if (status >= 500) this.log.error(texto, (error as any)?.stack);
      else this.log.warn(texto);
    }

    res.status(status).json(
      typeof cuerpo === 'string'
        ? { statusCode: status, message: cuerpo }
        : { statusCode: status, ...cuerpo },
    );
  }
}
