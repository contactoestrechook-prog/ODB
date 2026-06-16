import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthGuard } from './auth.guard';
import { supabaseProvider } from '../supabase.provider';

@Module({
  imports: [
    JwtModule.registerAsync({
      global: true,
      // diferido: el .env ya está cargado cuando corre la factory
      useFactory: () => {
        const secret = process.env.JWT_SECRET;
        if (!secret || secret.length < 16) {
          throw new Error('JWT_SECRET ausente o demasiado corto (mínimo 16 caracteres): abortando arranque');
        }
        return { secret, signOptions: { expiresIn: '24h' } };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, supabaseProvider, { provide: APP_GUARD, useClass: AuthGuard }],
})
export class AuthModule {}
