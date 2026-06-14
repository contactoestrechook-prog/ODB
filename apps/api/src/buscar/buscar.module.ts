import { Controller, Get, Inject, Query, Module } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE, supabaseProvider } from '../supabase.provider';

const TIPOS_LABEL: Record<string, string> = {
  FA: 'Factura A', FB: 'Factura B', FC: 'Factura C',
  NCA: 'N. crédito A', NCB: 'N. crédito B', NCC: 'N. crédito C',
  NDA: 'N. débito A', NDB: 'N. débito B', NDC: 'N. débito C',
  REM: 'Remito', REC: 'Recibo', ANT: 'Anticipo', SIN: 'Interno',
};

// Búsqueda global del panel: productos, clientes y comprobantes en un solo lugar
@Controller('buscar')
export class BuscarController {
  constructor(@Inject(SUPABASE) private readonly db: SupabaseClient) {}

  @Get()
  async buscar(@Query('q') q?: string) {
    const t = (q ?? '').trim();
    if (t.length < 2) return { productos: [], clientes: [], comprobantes: [] };
    const norm = t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const esNum = /^\d+$/.test(t);

    const [prod, cli, comp] = await Promise.all([
      this.db
        .from('productos')
        .select('sku, nombre, categoria:categorias(nombre)')
        .eq('activo', true)
        .or(`nombre_normalizado.ilike.%${norm}%,sku.ilike.%${t}%`)
        .limit(6),
      this.db
        .from('clientes')
        .select('id, dni, nombre, razon_social, tipo, cta_cte_habilitada')
        .or(`dni.ilike.%${t}%,nombre.ilike.%${t}%,razon_social.ilike.%${t}%`)
        .limit(6),
      esNum
        ? this.db
            .from('comprobantes')
            .select('id, tipo, punto_venta, numero, total, receptor')
            .eq('numero', Number(t))
            .order('emitido_en', { ascending: false })
            .limit(6)
        : Promise.resolve({ data: [] as any[] }),
    ]);

    return {
      productos: (prod.data ?? []).map((p: any) => ({
        titulo: p.nombre, sub: `${p.sku} · ${p.categoria?.nombre ?? 'sin rubro'}`, href: `/productos/${encodeURIComponent(p.sku)}`,
      })),
      clientes: (cli.data ?? []).map((c: any) => ({
        titulo: c.razon_social ?? c.nombre ?? `DNI ${c.dni}`,
        sub: `${c.dni ?? ''} · ${c.tipo}`,
        href: c.cta_cte_habilitada ? `/facturacion/cuentas/${c.id}` : `/clientes`,
      })),
      comprobantes: ((comp as any).data ?? []).map((c: any) => ({
        titulo: `${TIPOS_LABEL[c.tipo] ?? c.tipo} ${String(c.punto_venta).padStart(4, '0')}-${String(c.numero).padStart(8, '0')}`,
        sub: `${c.receptor?.nombre ?? 'Consumidor final'} · $${Math.round(Number(c.total)).toLocaleString('es-AR')}`,
        href: `/facturacion/${c.id}`,
      })),
    };
  }
}

@Module({
  controllers: [BuscarController],
  providers: [supabaseProvider],
})
export class BuscarModule {}
