import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { SaludController } from './salud.controller';
import { AdminKeyGuard } from './auth/admin-key.guard';
import { CartaModule } from './carta/carta.module';
import { MesasModule } from './mesas/mesas.module';
import { TermometroModule } from './termometro/termometro.module';
import { ResenasModule } from './resenas/resenas.module';
import { PisoModule } from './piso/piso.module';
import { ConfiguracionModule } from './configuracion/configuracion.module';
import { AnalistaModule } from './analista/analista.module';
import { AnfitrionModule } from './anfitrion/anfitrion.module';
import { EsperaModule } from './espera/espera.module';
import { DirectorModule } from './director/director.module';
import { ProveedoresModule } from './proveedores/proveedores.module';
import { CocinaModule } from './cocina/cocina.module';
import { MozosModule } from './mozos/mozos.module';
import { ClientesModule } from './clientes/clientes.module';

@Module({
  controllers: [SaludController],
  providers: [
    // límite global de tráfico por IP (anti-abuso)
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // todo lo que no sea @Publico() exige x-admin-key (panel de Damián)
    { provide: APP_GUARD, useClass: AdminKeyGuard },
  ],
  imports: [
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
    ConfigModule.forRoot({ isGlobal: true }),
    CartaModule,
    MesasModule,
    TermometroModule,
    ResenasModule,
    PisoModule,
    ConfiguracionModule,
    AnalistaModule,
    AnfitrionModule,
    EsperaModule,
    DirectorModule,
    ProveedoresModule,
    CocinaModule,
    MozosModule,
    ClientesModule,
  ],
})
export class AppModule {}
