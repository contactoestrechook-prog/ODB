import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase.provider';
import { libroIvaCompras, libroIvaVentas } from '../facturacion/libro-iva';

// Módulo contable: junta en un solo lugar lo que el contador necesita del mes.
// - IVA VENTAS (débito): comprobantes fiscales del módulo de facturación
//   + facturas electrónicas de la caja con CAE que no tienen comprobante impreso
//   asociado (deduplicado por venta para no contar dos veces la misma operación).
// - IVA COMPRAS (crédito): facturas de proveedor, con percepciones discriminadas.
// - Percepciones IVA e IIBB (ARBA/PBA) sufridas en compras: son pagos a cuenta.
// - Posición IVA del mes y base de Ingresos Brutos.
// Retenciones bancarias/SIRCREB todavía no se capturan (se cargan cuando haya fuente).

const ALIC: Record<number, number> = { 3: 0, 9: 2.5, 8: 5, 4: 10.5, 5: 21, 6: 27 };

@Injectable()
export class ContableService {
  constructor(@Inject(SUPABASE) private readonly db: SupabaseClient) {}

  async resumen(mes?: string) {
    const base = /^\d{4}-\d{2}$/.test(mes ?? '') ? mes! : new Date().toISOString().slice(0, 7);
    const [y, m] = base.split('-').map(Number);
    const desde = `${base}-01`;
    const hasta = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);

    // ---------- VENTAS: comprobantes fiscales del módulo de facturación ----------
    const ventasRaw: any[] = [];
    for (let off = 0; ; off += 1000) {
      const { data, error } = await this.db
        .from('comprobantes')
        .select('tipo, punto_venta, numero, emitido_en, receptor, neto, iva, total, iva_detalle, estado, venta_id')
        .gte('emitido_en', `${desde}T00:00:00`)
        .lt('emitido_en', `${hasta}T00:00:00`)
        .in('tipo', ['FA', 'FB', 'FC', 'NCA', 'NCB', 'NCC', 'NDA', 'NDB', 'NDC'])
        .range(off, off + 999);
      if (error) throw new BadRequestException(error.message);
      ventasRaw.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }
    const ventas = libroIvaVentas(
      ventasRaw.map((c) => ({
        tipo: c.tipo,
        puntoVenta: c.punto_venta,
        numero: c.numero,
        fecha: String(c.emitido_en).slice(0, 10),
        receptor: c.receptor,
        neto: Number(c.neto),
        iva: Number(c.iva),
        total: Number(c.total),
        ivaDetalle: c.iva_detalle ?? [],
        estado: c.estado,
      })),
    );

    // ---------- VENTAS ELECTRÓNICAS de la caja SIN comprobante impreso ----------
    // (la misma venta puede tener factura impresa + electrónica: se cuenta UNA vez)
    const ventasConComprobante = new Set(ventasRaw.map((c) => c.venta_id).filter(Boolean));
    const { data: arcaRaw } = await this.db
      .from('comprobantes_arca')
      .select('tipo, punto_venta, numero, cae, venta:ventas!inner(id, total, vendida_en)')
      .eq('estado', 'emitido')
      .gte('venta.vendida_en', desde)
      .lt('venta.vendida_en', hasta)
      .limit(10000);
    const soloElectronicos = ((arcaRaw ?? []) as any[]).filter((c) => !ventasConComprobante.has(c.venta.id));
    let electronicos = { cantidad: 0, neto: 0, iva: 0, total: 0 };
    if (soloElectronicos.length) {
      const ids = soloElectronicos.map((c) => c.venta.id);
      const itemsPorVenta = new Map<string, any[]>();
      for (let i = 0; i < ids.length; i += 100) {
        const { data: its } = await this.db
          .from('ventas_items')
          .select('venta_id, cantidad, precio_unitario, producto:productos(alicuota_iva)')
          .in('venta_id', ids.slice(i, i + 100));
        for (const it of (its ?? []) as any[]) {
          const arr = itemsPorVenta.get(it.venta_id) ?? [];
          arr.push(it);
          itemsPorVenta.set(it.venta_id, arr);
        }
      }
      for (const c of soloElectronicos) {
        const total = Number(c.venta.total);
        const items = itemsPorVenta.get(c.venta.id) ?? [];
        const { neto, iva } = this.netoIva(items, total);
        const signo = String(c.tipo).startsWith('NC') ? -1 : 1;
        electronicos.cantidad++;
        electronicos.neto += signo * neto;
        electronicos.iva += signo * iva;
        electronicos.total += signo * total;
      }
      electronicos = {
        cantidad: electronicos.cantidad,
        neto: r2(electronicos.neto),
        iva: r2(electronicos.iva),
        total: r2(electronicos.total),
      };
    }

    // ---------- COMPRAS: facturas de proveedor con percepciones ----------
    const { data: comprasRaw, error: ec } = await this.db
      .from('facturas_proveedor')
      .select('numero, monto, neto, iva, percepcion_iva, percepcion_iibb, otros_impuestos, creado_en, proveedor:proveedores(razon_social, cuit)')
      .gte('creado_en', `${desde}T00:00:00`)
      .lt('creado_en', `${hasta}T00:00:00`)
      .order('creado_en')
      .limit(5000);
    if (ec) throw new BadRequestException(ec.message);
    const comprasLista = ((comprasRaw ?? []) as any[]).map((f) => ({
      numero: f.numero,
      fecha: String(f.creado_en).slice(0, 10),
      proveedor: f.proveedor?.razon_social ?? null,
      cuit: f.proveedor?.cuit ?? null,
      monto: Number(f.monto),
      neto: f.neto != null ? Number(f.neto) : null,
      iva: f.iva != null ? Number(f.iva) : null,
    }));
    const compras = libroIvaCompras(comprasLista);
    // percepciones discriminadas por factura (para el CSV del contador)
    const comprasFilas = compras.filas.map((fila: any, i: number) => ({
      ...fila,
      percepcionIva: r2(Number((comprasRaw as any[])[i]?.percepcion_iva ?? 0)),
      percepcionIibb: r2(Number((comprasRaw as any[])[i]?.percepcion_iibb ?? 0)),
      otrosImpuestos: r2(Number((comprasRaw as any[])[i]?.otros_impuestos ?? 0)),
    }));
    const percepciones = {
      iva: r2(comprasFilas.reduce((s: number, f: any) => s + f.percepcionIva, 0)),
      iibb: r2(comprasFilas.reduce((s: number, f: any) => s + f.percepcionIibb, 0)),
      otros: r2(comprasFilas.reduce((s: number, f: any) => s + f.otrosImpuestos, 0)),
    };

    // ---------- posición del mes ----------
    const ivaDebito = r2(ventas.totales.iva + electronicos.iva);
    const ivaCredito = r2(compras.totales.iva);
    const saldoTecnico = r2(ivaDebito - ivaCredito);
    // las percepciones de IVA sufridas se computan a cuenta del saldo
    const ivaAPagar = r2(saldoTecnico - percepciones.iva);

    // Ingresos Brutos PBA: base = ventas netas devengadas del mes; las
    // percepciones sufridas van a cuenta. La alícuota la define el contador.
    const baseIibb = r2(ventas.totales.neto + electronicos.neto);

    return {
      mes: base,
      ventas: {
        facturacion: { cantidad: ventas.cantidad, ...ventas.totales, porAlicuota: ventas.porAlicuota, filas: ventas.filas },
        electronicosCaja: electronicos,
        totales: {
          neto: r2(ventas.totales.neto + electronicos.neto),
          iva: ivaDebito,
          total: r2(ventas.totales.total + electronicos.total),
        },
      },
      compras: {
        cantidad: compras.cantidad,
        estimadas: compras.estimadas,
        ...compras.totales,
        filas: comprasFilas,
      },
      percepciones,
      posicion: {
        ivaDebito,
        ivaCredito,
        saldoTecnico,
        percepcionesIvaACuenta: percepciones.iva,
        ivaAPagar,
        baseIibb,
        percepcionesIibbACuenta: percepciones.iibb,
        retenciones: 0, // sin fuente de datos todavía (SIRCREB / retenciones bancarias)
      },
    };
  }

  // neto/IVA de una venta minorista (precios con IVA incluido) por alícuota de producto
  private netoIva(items: any[], total: number) {
    const porAlic = new Map<number, number>();
    let suma = 0;
    for (const i of items) {
      const alic = Number((i.producto as any)?.alicuota_iva ?? 21);
      const imp = Number(i.cantidad) * Number(i.precio_unitario);
      porAlic.set(alic, (porAlic.get(alic) ?? 0) + imp);
      suma += imp;
    }
    const factor = suma > 0 ? total / suma : 1;
    let neto = 0;
    for (const [alic, imp] of porAlic) neto += (imp * factor) / (1 + alic / 100);
    neto = r2(neto);
    return { neto, iva: r2(total - neto) };
  }
}

const r2 = (n: number) => Math.round((n || 0) * 100) / 100;
