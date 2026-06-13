import { Controller, Get, Headers, Param, Query } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { CatalogoService } from './catalogo.service';
import type { FiltrosCatalogo } from './catalogo.service';
import { Publico } from '../auth/decorators';

// El catálogo es público: es lo que muestra la tienda.
// Si llega un token de cliente verificado, se aplican además
// las promociones exclusivas de la Comunidad ODB.
@Publico()
@Controller()
export class CatalogoController {
  constructor(
    private readonly catalogo: CatalogoService,
    private readonly jwt: JwtService,
  ) {}

  private async esComunidad(authorization?: string): Promise<boolean> {
    const token = (authorization ?? '').replace(/^Bearer /, '');
    if (!token) return false;
    try {
      const payload = await this.jwt.verifyAsync(token);
      return payload.rol === 'cliente' && payload.verificado === true;
    } catch {
      return false;
    }
  }

  // Segmento de comportamiento del cliente logueado (para mostrarle SU precio).
  // El token no lo trae: se busca por id en la base.
  private async segmentoCliente(authorization?: string): Promise<string | undefined> {
    const token = (authorization ?? '').replace(/^Bearer /, '');
    if (!token) return undefined;
    try {
      const payload = await this.jwt.verifyAsync(token);
      if (payload.rol !== 'cliente' || !payload.sub) return undefined;
      const { data } = await this.catalogo.tipoCliente(payload.sub);
      return data ?? undefined;
    } catch {
      return undefined;
    }
  }

  @Get('catalogo/filtros')
  filtros() {
    return this.catalogo.filtros();
  }

  @Get('productos')
  async buscar(
    @Query() q: FiltrosCatalogo & { limite?: string },
    @Headers('authorization') auth?: string,
  ) {
    if (q.limite && !q.porPagina) q.porPagina = q.limite;
    const [comunidad, segmento] = await Promise.all([
      this.esComunidad(auth),
      this.segmentoCliente(auth),
    ]);
    return this.catalogo.buscarProductos(q, comunidad, segmento);
  }

  @Get('productos/:sku')
  porSku(@Param('sku') sku: string) {
    return this.catalogo.obtenerPorSku(sku);
  }

  @Get('productos/:sku/detalle')
  detalle(@Param('sku') sku: string) {
    return this.catalogo.detalle(sku);
  }

  @Get('sucursales')
  sucursales() {
    return this.catalogo.sucursales();
  }
}
