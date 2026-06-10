import { Body, Controller, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { Publico } from './decorators';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Publico()
  @Post('login')
  login(@Body() body: { email: string; clave: string }) {
    return this.auth.login(body.email, body.clave);
  }
}
