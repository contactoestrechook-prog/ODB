import { BadRequestException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase.provider';
import { hashClave } from '../comun/passwords';

export type CrearUsuarioDto = {
  nombre: string;
  email: string;
  rol: 'dueno' | 'gerente' | 'comprador' | 'cajero' | 'deposito';
  clave: string;
  sucursalId?: string | null;
  pin?: string;
  limiteAprobacion?: number;
  telefono?: string;
};

export type EditarUsuarioDto = Partial<CrearUsuarioDto> & { activo?: boolean };

// bcrypt (con salt). verificar_login / aprobar_orden_compra en la DB aceptan
// tanto bcrypt como el sha256 legacy durante la transición.
const hash = (texto: string) => hashClave(texto);

@Injectable()
export class UsuariosService {
  constructor(@Inject(SUPABASE) private readonly db: SupabaseClient) {}

  async listar() {
    const { data, error } = await this.db
      .from('usuarios')
      .select('id, nombre, email, rol, activo, telefono, limite_aprobacion, creado_en, pin_firma, sucursal:sucursales(id, nombre)')
      .order('creado_en');
    if (error) throw new BadRequestException(error.message);
    return (data ?? []).map((u: any) => ({
      id: u.id,
      nombre: u.nombre,
      email: u.email,
      rol: u.rol,
      activo: u.activo,
      telefono: u.telefono ?? null,
      limiteAprobacion: Number(u.limite_aprobacion ?? 0),
      tienePin: u.pin_firma != null,
      sucursal: u.sucursal ?? null,
    }));
  }

  async crear(dto: CrearUsuarioDto, actor: { sub: string; rol: string }) {
    this.validar(dto, actor, dto.rol);
    if (!dto.nombre?.trim() || !dto.email?.trim()) {
      throw new BadRequestException('Nombre y email son obligatorios');
    }
    if (!dto.clave || dto.clave.length < 6) {
      throw new BadRequestException('La clave debe tener al menos 6 caracteres');
    }
    const { data, error } = await this.db
      .from('usuarios')
      .insert({
        nombre: dto.nombre.trim(),
        email: dto.email.trim().toLowerCase(),
        rol: dto.rol,
        clave_hash: hash(dto.clave),
        sucursal_id: dto.sucursalId || null,
        pin_firma: dto.pin ? hash(dto.pin) : null,
        limite_aprobacion: dto.limiteAprobacion ?? 0,
        telefono: dto.telefono?.trim() || null,
      })
      .select('id')
      .single();
    if (error) {
      throw new BadRequestException(
        error.code === '23505' ? 'Ya existe un usuario con ese email' : error.message,
      );
    }
    await this.auditar(actor.sub, 'crear_usuario', data.id, { email: dto.email, rol: dto.rol });
    return { id: data.id };
  }

  async editar(id: string, dto: EditarUsuarioDto, actor: { sub: string; rol: string }) {
    const { data: objetivo } = await this.db.from('usuarios').select('rol').eq('id', id).maybeSingle();
    if (!objetivo) throw new BadRequestException('Usuario inexistente');
    this.validar(dto, actor, objetivo.rol, dto.rol);

    if (id === actor.sub && dto.activo === false) {
      throw new BadRequestException('No podés desactivar tu propio usuario');
    }

    const cambios: Record<string, any> = {};
    if (dto.nombre !== undefined) cambios.nombre = dto.nombre.trim();
    if (dto.email !== undefined) cambios.email = dto.email.trim().toLowerCase();
    if (dto.rol !== undefined) cambios.rol = dto.rol;
    if (dto.sucursalId !== undefined) cambios.sucursal_id = dto.sucursalId || null;
    if (dto.limiteAprobacion !== undefined) cambios.limite_aprobacion = dto.limiteAprobacion;
    if (dto.telefono !== undefined) cambios.telefono = dto.telefono?.trim() || null;
    if (dto.activo !== undefined) cambios.activo = dto.activo;
    if (dto.clave) {
      if (dto.clave.length < 6) throw new BadRequestException('La clave debe tener al menos 6 caracteres');
      cambios.clave_hash = hash(dto.clave);
    }
    if (dto.pin !== undefined) cambios.pin_firma = dto.pin ? hash(dto.pin) : null;
    if (!Object.keys(cambios).length) return { ok: true };

    const { error } = await this.db.from('usuarios').update(cambios).eq('id', id);
    if (error) {
      throw new BadRequestException(
        error.code === '23505' ? 'Ya existe un usuario con ese email' : error.message,
      );
    }
    await this.auditar(actor.sub, 'editar_usuario', id, { campos: Object.keys(cambios) });
    return { ok: true };
  }

  // Elimina un usuario. Si ya tiene historial (ventas, cajas, movimientos), no
  // se puede borrar sin romper la trazabilidad contable: en ese caso se
  // desactiva y se avisa. Solo se borra de verdad a un usuario "limpio".
  async eliminar(id: string, actor: { sub: string; rol: string }) {
    if (id === actor.sub) throw new BadRequestException('No podés eliminar tu propio usuario');
    const { data: objetivo } = await this.db.from('usuarios').select('rol, nombre').eq('id', id).maybeSingle();
    if (!objetivo) throw new BadRequestException('Usuario inexistente');
    if (actor.rol !== 'dueno' && objetivo.rol === 'dueno') {
      throw new ForbiddenException('Solo un dueño puede eliminar usuarios con rol dueño');
    }

    const { error } = await this.db.from('usuarios').delete().eq('id', id);
    if (error) {
      // 23503 = foreign key: el usuario tiene historial, no se borra. Se desactiva.
      if (error.code === '23503') {
        await this.db.from('usuarios').update({ activo: false }).eq('id', id);
        await this.auditar(actor.sub, 'desactivar_usuario', id, { motivo: 'tiene historial, no se puede borrar', nombre: objetivo.nombre });
        return { eliminado: false, desactivado: true, mensaje: 'El usuario tiene historial (ventas/cajas), así que se desactivó en vez de borrarse.' };
      }
      throw new BadRequestException(error.message);
    }
    await this.auditar(actor.sub, 'eliminar_usuario', id, { nombre: objetivo.nombre });
    return { eliminado: true };
  }

  // Gerentes administran al equipo, pero todo lo que toque a un dueño
  // (o nombre a un dueño nuevo) es terreno exclusivo del dueño
  private validar(dto: EditarUsuarioDto, actor: { rol: string }, rolObjetivo: string, rolNuevo?: string) {
    if (actor.rol === 'dueno') return;
    if (rolObjetivo === 'dueno' || rolNuevo === 'dueno') {
      throw new ForbiddenException('Solo un dueño puede administrar usuarios con rol dueño');
    }
    if (dto.limiteAprobacion !== undefined || dto.pin !== undefined) {
      throw new ForbiddenException('Solo un dueño puede cambiar PIN de firma o límites de aprobación');
    }
  }

  private async auditar(usuarioId: string, accion: string, entidadId: string, detalle: any) {
    await this.db.from('auditoria').insert({
      usuario_id: usuarioId,
      accion,
      entidad: 'usuario',
      entidad_id: entidadId,
      datos_despues: detalle,
    });
  }
}
