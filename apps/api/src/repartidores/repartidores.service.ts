import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { SUPABASE } from '../supabase.provider';
import { hashClave } from '../comun/passwords';

export type CrearRepartidorDto = {
  nombre: string;
  email: string;
  clave: string;
  dni?: string;
  telefono?: string;
};

export type VehiculoDto = {
  tipo: 'auto' | 'moto' | 'camioneta' | 'bici';
  marca?: string;
  modelo?: string;
  patente?: string;
  color?: string;
  seguroCompania?: string;
  seguroPoliza?: string;
  seguroVencimiento?: string; // YYYY-MM-DD
};

const TIPOS = ['auto', 'moto', 'camioneta', 'bici'];

@Injectable()
export class RepartidoresService {
  constructor(@Inject(SUPABASE) private readonly db: SupabaseClient) {}

  // Lista los repartidores con sus vehículos (y el estado del seguro).
  async listar() {
    const { data, error } = await this.db
      .from('usuarios')
      .select('id, nombre, email, dni, telefono, activo')
      .eq('rol', 'repartidor')
      .order('nombre');
    if (error) throw new BadRequestException(error.message);
    const repartidores = data ?? [];
    const ids = repartidores.map((r: any) => r.id);
    const { data: vehiculos } = ids.length
      ? await this.db.from('vehiculos').select('*').in('repartidor_id', ids).eq('activo', true)
      : { data: [] as any[] };
    const porRepartidor = new Map<string, any[]>();
    for (const v of (vehiculos ?? []) as any[]) {
      const lista = porRepartidor.get(v.repartidor_id) ?? [];
      lista.push(this.formatearVehiculo(v));
      porRepartidor.set(v.repartidor_id, lista);
    }
    return repartidores.map((r: any) => ({ ...r, vehiculos: porRepartidor.get(r.id) ?? [] }));
  }

  async crear(dto: CrearRepartidorDto) {
    if (!dto.nombre?.trim() || !dto.email?.trim()) throw new BadRequestException('Nombre y email son obligatorios');
    if (!dto.clave || dto.clave.length < 6) throw new BadRequestException('La clave debe tener al menos 6 caracteres');
    const { data, error } = await this.db
      .from('usuarios')
      .insert({
        nombre: dto.nombre.trim(),
        email: dto.email.trim().toLowerCase(),
        rol: 'repartidor',
        clave_hash: hashClave(dto.clave),
        dni: dto.dni?.trim() || null,
        telefono: dto.telefono?.trim() || null,
      })
      .select('id')
      .single();
    if (error) {
      throw new BadRequestException(error.code === '23505' ? 'Ya existe un usuario con ese email' : error.message);
    }
    return { id: data.id };
  }

  async editar(id: string, dto: Partial<CrearRepartidorDto> & { activo?: boolean }) {
    const cambios: Record<string, any> = {};
    if (dto.nombre !== undefined) cambios.nombre = dto.nombre.trim();
    if (dto.email !== undefined) cambios.email = dto.email.trim().toLowerCase();
    if (dto.dni !== undefined) cambios.dni = dto.dni?.trim() || null;
    if (dto.telefono !== undefined) cambios.telefono = dto.telefono?.trim() || null;
    if (dto.activo !== undefined) cambios.activo = dto.activo;
    if (dto.clave) {
      if (dto.clave.length < 6) throw new BadRequestException('La clave debe tener al menos 6 caracteres');
      cambios.clave_hash = hashClave(dto.clave);
    }
    if (!Object.keys(cambios).length) return { ok: true };
    const { error } = await this.db.from('usuarios').update(cambios).eq('id', id).eq('rol', 'repartidor');
    if (error) throw new BadRequestException(error.code === '23505' ? 'Ya existe un usuario con ese email' : error.message);
    return { ok: true };
  }

  // --- Vehículos ---
  async agregarVehiculo(repartidorId: string, dto: VehiculoDto) {
    if (!TIPOS.includes(dto.tipo)) throw new BadRequestException(`Tipo de vehículo inválido (${TIPOS.join(', ')})`);
    const { data, error } = await this.db
      .from('vehiculos')
      .insert({
        repartidor_id: repartidorId,
        tipo: dto.tipo,
        marca: dto.marca?.trim() || null,
        modelo: dto.modelo?.trim() || null,
        patente: dto.patente?.trim().toUpperCase() || null,
        color: dto.color?.trim() || null,
        seguro_compania: dto.seguroCompania?.trim() || null,
        seguro_poliza: dto.seguroPoliza?.trim() || null,
        seguro_vencimiento: dto.seguroVencimiento || null,
      })
      .select('id')
      .single();
    if (error) throw new BadRequestException(error.message);
    return { id: data.id };
  }

  async editarVehiculo(id: string, dto: Partial<VehiculoDto>) {
    const cambios: Record<string, any> = {};
    if (dto.tipo !== undefined) {
      if (!TIPOS.includes(dto.tipo)) throw new BadRequestException(`Tipo de vehículo inválido (${TIPOS.join(', ')})`);
      cambios.tipo = dto.tipo;
    }
    if (dto.marca !== undefined) cambios.marca = dto.marca?.trim() || null;
    if (dto.modelo !== undefined) cambios.modelo = dto.modelo?.trim() || null;
    if (dto.patente !== undefined) cambios.patente = dto.patente?.trim().toUpperCase() || null;
    if (dto.color !== undefined) cambios.color = dto.color?.trim() || null;
    if (dto.seguroCompania !== undefined) cambios.seguro_compania = dto.seguroCompania?.trim() || null;
    if (dto.seguroPoliza !== undefined) cambios.seguro_poliza = dto.seguroPoliza?.trim() || null;
    if (dto.seguroVencimiento !== undefined) cambios.seguro_vencimiento = dto.seguroVencimiento || null;
    if (!Object.keys(cambios).length) return { ok: true };
    const { error } = await this.db.from('vehiculos').update(cambios).eq('id', id);
    if (error) throw new BadRequestException(error.message);
    return { ok: true };
  }

  async desactivarVehiculo(id: string) {
    const { error } = await this.db.from('vehiculos').update({ activo: false }).eq('id', id);
    if (error) throw new BadRequestException(error.message);
    return { ok: true };
  }

  // Sube el archivo de la póliza (PDF/imagen) al storage y lo linkea al vehículo.
  async subirPoliza(vehiculoId: string, archivo: Express.Multer.File) {
    if (!archivo) throw new BadRequestException('Subí el archivo de la póliza');
    const ext = (archivo.mimetype === 'application/pdf') ? 'pdf' : (archivo.originalname.split('.').pop() || 'jpg').toLowerCase();
    const ruta = `polizas/${vehiculoId}-${randomUUID().slice(0, 8)}.${ext}`;
    const { error } = await this.db.storage
      .from('productos')
      .upload(ruta, archivo.buffer, { contentType: archivo.mimetype, upsert: true });
    if (error) throw new BadRequestException(error.message);
    const url = `${process.env.SUPABASE_URL}/storage/v1/object/public/productos/${ruta}`;
    const { error: errUpd } = await this.db.from('vehiculos').update({ seguro_archivo_url: url }).eq('id', vehiculoId);
    if (errUpd) throw new BadRequestException(errUpd.message);
    return { url };
  }

  // Asigna repartidor + vehículo a un pedido a domicilio (para la autorización).
  async asignarReparto(pedidoId: string, repartidorId: string, vehiculoId?: string) {
    const { error } = await this.db
      .from('pedidos')
      .update({ repartidor_id: repartidorId, vehiculo_id: vehiculoId || null })
      .eq('id', pedidoId);
    if (error) throw new BadRequestException(error.message);
    return this.autorizacion(pedidoId);
  }

  // Arma la autorización de ingreso lista para mandar a la seguridad del barrio.
  async autorizacion(pedidoId: string) {
    const { data: pedido, error } = await this.db
      .from('pedidos')
      .select('id, destino_direccion, repartidor:usuarios!pedidos_repartidor_id_fkey(nombre, dni, telefono), vehiculo:vehiculos(*)')
      .eq('id', pedidoId)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!pedido) throw new BadRequestException('No existe el pedido');
    const rep = (pedido as any).repartidor;
    const veh = (pedido as any).vehiculo;
    if (!rep) throw new BadRequestException('El pedido no tiene repartidor asignado');

    const vencido = veh?.seguro_vencimiento ? new Date(veh.seguro_vencimiento) < new Date(new Date().toDateString()) : false;
    const partes = [
      'AUTORIZACIÓN DE INGRESO',
      'Comercio: O.D.B — CHINVENGUENCHA SRL (CUIT 30-71696971-8)',
      '',
      `Repartidor: ${rep.nombre}${rep.dni ? ` — DNI ${rep.dni}` : ''}${rep.telefono ? ` — Tel ${rep.telefono}` : ''}`,
    ];
    if (veh) {
      partes.push(
        `Vehículo: ${[veh.tipo, veh.marca, veh.modelo].filter(Boolean).join(' ')}${veh.color ? ` (${veh.color})` : ''}`,
        `Patente: ${veh.patente ?? '—'}`,
      );
      if (veh.seguro_compania || veh.seguro_poliza) {
        partes.push(`Seguro: ${veh.seguro_compania ?? ''}${veh.seguro_poliza ? ` — Póliza ${veh.seguro_poliza}` : ''}${veh.seguro_vencimiento ? ` — Vence ${veh.seguro_vencimiento}` : ''}${vencido ? ' ⚠ VENCIDO' : ''}`);
      }
    } else {
      partes.push('Vehículo: (sin asignar)');
    }
    if ((pedido as any).destino_direccion) partes.push('', `Destino: ${(pedido as any).destino_direccion}`);

    return {
      texto: partes.join('\n'),
      seguroVencido: vencido,
      polizaUrl: veh?.seguro_archivo_url ?? null,
    };
  }

  private formatearVehiculo(v: any) {
    const vencido = v.seguro_vencimiento ? new Date(v.seguro_vencimiento) < new Date(new Date().toDateString()) : false;
    return {
      id: v.id,
      tipo: v.tipo,
      marca: v.marca,
      modelo: v.modelo,
      patente: v.patente,
      color: v.color,
      seguroCompania: v.seguro_compania,
      seguroPoliza: v.seguro_poliza,
      seguroVencimiento: v.seguro_vencimiento,
      seguroArchivoUrl: v.seguro_archivo_url,
      seguroVencido: vencido,
    };
  }
}
