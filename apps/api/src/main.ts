import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import compression from 'compression';
import { AppModule } from './app.module';

async function bootstrap() {
  // rawBody: necesario para validar la firma HMAC de los webhooks (Didit, etc.)
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
  app.use(compression());
  // listas de proveedor pueden subirse como archivo (PDF/imagen) en base64
  app.useBodyParser('json', { limit: '25mb' });
  app.useBodyParser('urlencoded', { limit: '25mb', extended: true });
  // CORS por lista blanca: el panel y la app nativa no usan CORS (server-side /
  // sin Origin), así que solo habilitamos orígenes de navegador conocidos.
  const origenes = (process.env.CORS_ORIGINS ?? 'http://localhost:3000,http://localhost:8081,http://localhost:19006')
    .split(',').map((s) => s.trim()).filter(Boolean);
  app.enableCors({ origin: (o, cb) => cb(null, !o || origenes.includes(o)), credentials: true });
  // PORT lo inyectan los hostings (Railway/Render); PUERTO es el override local
  await app.listen(process.env.PUERTO ?? process.env.PORT ?? 3001);
}
bootstrap();
