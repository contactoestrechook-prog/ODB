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
      useFactory: () => ({
        secret: process.env.JWT_SECRET,
        signOptions: { expiresIn: '12h' },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, supabaseProvider, { provide: APP_GUARD, useClass: AuthGuard }],
})
export class AuthModule {}
