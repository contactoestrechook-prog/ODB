import { NestFactory } from '@nestjs/core';
import compression from 'compression';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.use(compression());
  app.enableCors({ origin: true });
  // PORT lo inyectan los hostings (Railway/Render); PUERTO es el override local
  await app.listen(process.env.PUERTO ?? process.env.PORT ?? 3001);
}
bootstrap();
