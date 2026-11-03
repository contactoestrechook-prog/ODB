import { NotFoundException } from '@nestjs/common';
import { GpsService } from './gps.service';

// Base de mentira: anota cada operación (tabla, acción, filtros) y contesta el
// vehículo que se le pase.
function armar(vehiculo: any) {
  const ops: { tabla: string; accion: string; datos?: any; filtros: string[] }[] = [];
  const db: any = {
    from(tabla: string) {
      const op: any = { tabla, accion: 'select', filtros: [] };
      ops.push(op);
      const q: any = {
        select: () => q,
        update: (datos: any) => { op.accion = 'update'; op.datos = datos; return q; },
        upsert: (datos: any) => { op.accion = 'upsert'; op.datos = datos; return q; },
        eq: (c: string, v: any) => { op.filtros.push(`${c}=${v}`); return q; },
        or: (f: string) => { op.filtros.push(`or(${f})`); return q; },
        maybeSingle: () => Promise.resolve({ data: vehiculo, error: null }),
        then: (ok: any) => Promise.resolve({ data: null, error: null }).then(ok),
      };
      return q;
    },
  };
  return { svc: new GpsService(db), ops };
}

const lectura = (en: string) => ({ equipo: '860000000000001', lat: -34.42, lng: -58.57, velocidadKmh: 35, en: new Date(en) });

describe('GPS del vehículo', () => {
  it('la posición entra al vehículo, al mapa de flota y a los envíos en camino', async () => {
    const { svc, ops } = armar({ id: 'v-1', repartidor_id: 'u-1', gps_en: '2026-11-03T17:00:00Z' });
    await expect(svc.registrar(lectura('2026-11-03T17:01:00Z'))).resolves.toEqual({ ok: true });

    const veh = ops.find((o) => o.tabla === 'vehiculos' && o.accion === 'update');
    expect(veh?.datos).toEqual({ gps_lat: -34.42, gps_lng: -58.57, gps_velocidad: 35, gps_en: '2026-11-03T17:01:00.000Z' });

    const flota = ops.find((o) => o.tabla === 'repartidor_posicion');
    expect(flota?.accion).toBe('upsert');
    expect(flota?.datos).toEqual({ repartidor_id: 'u-1', lat: -34.42, lng: -58.57, actualizado_en: '2026-11-03T17:01:00.000Z' });

    const envios = ops.find((o) => o.tabla === 'pedidos');
    expect(envios?.filtros).toEqual(['canal=domicilio', 'estado=en_camino', 'or(repartidor_id.eq.u-1,vehiculo_id.eq.v-1)']);
  });

  it('una lectura más vieja que la última (el equipo descargando lo guardado) no mueve nada', async () => {
    const { svc, ops } = armar({ id: 'v-1', repartidor_id: 'u-1', gps_en: '2026-11-03T17:05:00Z' });
    await expect(svc.registrar(lectura('2026-11-03T17:01:00Z'))).resolves.toEqual({ ok: true, ignorada: 'lectura vieja' });
    expect(ops.filter((o) => o.accion !== 'select')).toEqual([]);
  });

  it('un equipo que no está en ningún vehículo se rechaza', async () => {
    const { svc } = armar(null);
    await expect(svc.registrar(lectura('2026-11-03T17:01:00Z'))).rejects.toBeInstanceOf(NotFoundException);
  });
});
