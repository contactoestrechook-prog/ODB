import { Controller, Get, Inject, Query, Module } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE, supabaseProvider } from '../supabase.provider';
import { filtrarColumna } from '../comun/busqueda';

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
    const esNum = /^\d+$/.test(t);

    // Productos y clientes con la regla de comun/busqueda.ts: todas las
    // palabras en cualquier orden, sin tildes ni plurales; los productos,
    // además, con errores de tipeo si no hay nada (lo resuelve la base).
    const productos = async () => {
      const { data: ids } = await this.db
        .rpc('buscar_productos', { p_q: t, p_solo_activos: true })
        .order('nivel')
        .order('en_nombre', { ascending: false })
        .order('parecido', { ascending: false })
        .limit(6);
      const orden = ((ids ?? []) as any[]).map((r) => r.producto_id);
      if (!orden.length) return { data: [] as any[] };
      // con el stock de cada sucursal a la vista (Leandro, 5/11/2026: «le queremos
      // agregar el stock que hay cuando despliego esa lista»)
      const [{ data }, { data: stock }] = await Promise.all([
        this.db.from('productos').select('id, sku, nombre, categoria:categorias(nombre)').in('id', orden),
        this.db.from('stock').select('producto_id, cantidad, sucursal:sucursales(nombre, activa)').in('producto_id', orden),
      ]);
      const porProducto = new Map<string, { sucursal: string; cantidad: number }[]>();
      for (const s of (stock ?? []) as any[]) {
        if (!s.sucursal || s.sucursal.activa === false) continue;
        const lista = porProducto.get(s.producto_id) ?? [];
        lista.push({ sucursal: String(s.sucursal.nombre ?? '').replace(/^suc(ursal)?\.?\s+/i, ''), cantidad: Number(s.cantidad) || 0 });
        porProducto.set(s.producto_id, lista);
      }
      return {
        data: ((data ?? []) as any[])
          .sort((a, b) => orden.indexOf(a.id) - orden.indexOf(b.id))
          .map((p) => ({ ...p, stock: (porProducto.get(p.id) ?? []).sort((a, b) => a.sucursal.localeCompare(b.sucursal)) })),
      };
    };

    const [prod, cli, comp] = await Promise.all([
      productos(),
      filtrarColumna(
        this.db.from('clientes').select('id, dni, nombre, razon_social, tipo, cta_cte_habilitada'),
        'texto_busqueda',
        t,
      ).limit(6),
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
        stock: p.stock ?? [],
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
