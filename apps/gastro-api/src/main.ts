import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import compression from 'compression';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // detrás del proxy de Railway/Netlify: sin esto, req.ip da siempre la IP del proxy
  app.set('trust proxy', 1);
  app.use(compression());
  // CORS por lista blanca: gastro-web (clientes por QR) y gastro-admin (Damián)
  const origenes = (process.env.CORS_ORIGINS ?? 'http://localhost:3010,http://localhost:3011')
    .split(',').map((s) => s.trim()).filter(Boolean);
  app.enableCors({ origin: (o, cb) => cb(null, !o || origenes.includes(o)), credentials: true });
  await app.listen(process.env.PUERTO ?? process.env.PORT ?? 3002);
}
bootstrap();
