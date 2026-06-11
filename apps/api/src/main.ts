import { NestFactory } from '@nestjs/core';
import compression from 'compression';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.use(compression());
  app.enableCors({ origin: true });
  await app.listen(process.env.PUERTO ?? 3001);
}
bootstrap();
