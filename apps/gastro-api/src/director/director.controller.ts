import { Controller, Get } from '@nestjs/common';
import { DirectorService } from './director.service';

@Controller('admin/director')
export class DirectorController {
  constructor(private readonly director: DirectorService) {}

  @Get('sugerencias')
  sugerencias() {
    return this.director.sugerencias();
  }
}
