import { BadRequestException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase.provider';
import { hashClave } from '../comun/passwords';
import { normalizarRoles, rolesDe } from '../auth/roles';

/** Email de relleno de un alta para completar: administración pone el real. */
export const DOMINIO_PENDIENTE = '@pendiente.odb.interno';
export const esEmailPendiente = (email?: string | null) => String(email ?? '').toLowerCase().endsWith(DOMINIO_PENDIENTE);
/** Lo único que administración toca de un usuario: completar sus datos (19/11/2026). */
const CAMPOS_DE_ADMINISTRACION = ['nombre', 'email', 'telefono', 'clave'];
const esJefe = (actor: { rol: string }) => actor.rol === 'dueno' || actor.rol === 'gerente';

export type CrearUsuarioDto = {
  nombre: string;
  email: string;
  rol: 'dueno' | 'gerente' | 'comprador' | 'cajero' | 'deposito' | 'administrativo' | 'repartidor' | 'op_salon' | 'fiambreria';
  /** Todos sus roles (19/11/2026). El principal sale solo: el de más alcance. */
  roles?: string[];
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
      .select('id, nombre, email, rol, roles, alta_pendiente, activo, telefono, limite_aprobacion, creado_en, pin_firma, sucursal:sucursales(id, nombre)')
      .order('creado_en');
    if (error) throw new BadRequestException(error.message);
    return (data ?? []).map((u: any) => ({
      id: u.id,
      nombre: u.nombre,
      // el de relleno no se muestra: es lo que administración tiene que completar
      email: esEmailPendiente(u.email) ? '' : u.email,
      rol: u.rol,
      roles: rolesDe(u),
      altaPendiente: u.alta_pendiente === true,
      activo: u.activo,
      telefono: u.telefono ?? null,
      limiteAprobacion: Number(u.limite_aprobacion ?? 0),
      tienePin: u.pin_firma != null,
      sucursal: u.sucursal ?? null,
    }));
  }

  async crear(dto: CrearUsuarioDto, actor: { sub: string; rol: string }) {
    if (!esJefe(actor)) throw new ForbiddenException('Dar de alta es del dueño o del gerente');
    const roles = normalizarRoles(dto.roles?.length ? dto.roles : [dto.rol]);
    if (!roles.length) throw new BadRequestException('Elegí al menos un rol');
    dto = { ...dto, rol: roles[0] as CrearUsuarioDto['rol'], roles };
    this.validar(dto, actor, dto.rol, undefined, roles);
    if (!dto.nombre?.trim() || !dto.email?.trim()) {
      throw new BadRequestException('Nombre y email son obligatorios');
    }
    if (!dto.clave || dto.clave.length < 6) {
      throw new BadRequestException('La clave debe tener al menos 6 caracteres');
    }
    // op salón y fiambrería ya no tienen que tener UNA sucursal (27/11/2026): sin sucursal
    // fija trabajan donde los necesiten (Leandro, por Brenda). Antes era obligatoria (5/11).
    const { data, error } = await this.db
      .from('usuarios')
      .insert({
        nombre: dto.nombre.trim(),
        email: dto.email.trim().toLowerCase(),
        rol: dto.rol,
        roles,
        clave_hash: hash(dto.clave),
        sucursal_id: dto.sucursalId || null,
        pin_firma: dto.pin ? hash(dto.pin) : null,
        limite_aprobacion: dto.limiteAprobacion ?? 0,
        telefono: dto.telefono?.trim() || null,
        // clave temporal: lo obligamos a cambiarla la primera vez que entra
        debe_cambiar_clave: true,
      })
      .select('id')
      .single();
    if (error) {
      throw new BadRequestException(
        error.code === '23505' ? 'Ya existe un usuario con ese email' : error.message,
      );
    }
    await this.auditar(actor.sub, 'crear_usuario', data.id, { email: dto.email, rol: dto.rol, roles });
    return { id: data.id };
  }

  async editar(id: string, dto: EditarUsuarioDto, actor: { sub: string; rol: string }) {
    const { data: objetivo } = await this.db
      .from('usuarios')
      .select('rol, roles, sucursal_id, email, telefono, clave_hash, alta_pendiente, nombre')
      .eq('id', id)
      .maybeSingle();
    if (!objetivo) throw new BadRequestException('Usuario inexistente');
    const o = objetivo as any;

    // Administración (19/11/2026, Leandro: «que Romina termine de crear los
    // usuarios con teléfonos y contraseñas»): completa nombre, email, WhatsApp y
    // clave. Roles, sucursal, firma y altas o bajas siguen siendo del dueño y el
    // gerente.
    if (!esJefe(actor)) {
      const otros = Object.keys(dto).filter((k) => (dto as any)[k] !== undefined && !CAMPOS_DE_ADMINISTRACION.includes(k));
      if (otros.length) throw new ForbiddenException('Desde administración se completan nombre, email, WhatsApp y clave. Los roles y la sucursal los cambia un dueño o el gerente.');
      if (rolesDe(o).some((r) => r === 'dueno' || r === 'gerente')) {
        throw new ForbiddenException('A un dueño o al gerente lo edita un dueño');
      }
    }

    const rolesNuevos = dto.roles !== undefined || dto.rol !== undefined
      ? normalizarRoles(dto.roles?.length ? dto.roles : [dto.rol ?? o.rol])
      : null;
    if (rolesNuevos && !rolesNuevos.length) throw new BadRequestException('Elegí al menos un rol');
    const rolesFinales = rolesNuevos ?? rolesDe(o);
    this.validar(dto, actor, o.rol, rolesNuevos?.[0], rolesNuevos ?? undefined, rolesDe(o));

    if (id === actor.sub && dto.activo === false) {
      throw new BadRequestException('No podés desactivar tu propio usuario');
    }

    const cambios: Record<string, any> = {};
    if (dto.nombre !== undefined) cambios.nombre = dto.nombre.trim();
    if (dto.email !== undefined) {
      const email = dto.email.trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || esEmailPendiente(email)) throw new BadRequestException('Ese email no es válido');
      cambios.email = email;
    }
    if (rolesNuevos) { cambios.rol = rolesNuevos[0]; cambios.roles = rolesNuevos; }
    if (dto.sucursalId !== undefined) cambios.sucursal_id = dto.sucursalId || null;
    if (dto.limiteAprobacion !== undefined) cambios.limite_aprobacion = dto.limiteAprobacion;
    if (dto.telefono !== undefined) cambios.telefono = dto.telefono?.trim() || null;
    if (dto.activo !== undefined) cambios.activo = dto.activo;
    if (dto.clave) {
      if (dto.clave.length < 6) throw new BadRequestException('La clave debe tener al menos 6 caracteres');
      cambios.clave_hash = hash(dto.clave);
      // reset de clave por un admin: la persona la cambia la próxima vez que entra
      cambios.debe_cambiar_clave = true;
    }
    if (dto.pin !== undefined) cambios.pin_firma = dto.pin ? hash(dto.pin) : null;

    // Alta para completar: con email real, WhatsApp y clave queda activa sola
    let completada = false;
    if (o.alta_pendiente) {
      const email = cambios.email ?? o.email;
      const tel = String(cambios.telefono !== undefined ? cambios.telefono ?? '' : o.telefono ?? '').replace(/\D/g, '');
      const conClave = !!(cambios.clave_hash ?? o.clave_hash);
      if (!esEmailPendiente(email) && tel.length >= 10 && conClave) {
        cambios.alta_pendiente = false;
        cambios.activo = true;
        cambios.debe_cambiar_clave = true;
        completada = true;
      } else if (dto.activo === true) {
        throw new BadRequestException('Para activarla faltan datos: email, WhatsApp (con código de área) y clave');
      }
    }
    if (!Object.keys(cambios).length) return { ok: true };

    const { error } = await this.db.from('usuarios').update(cambios).eq('id', id);
    if (error) {
      throw new BadRequestException(
        error.code === '23505' ? 'Ya existe un usuario con ese email' : error.message,
      );
    }
    await this.auditar(actor.sub, completada ? 'completar_alta_usuario' : 'editar_usuario', id, { campos: Object.keys(cambios).filter((k) => k !== 'clave_hash' && k !== 'pin_firma'), ...(rolesNuevos ? { roles: rolesNuevos } : {}) });
    if (completada) await this.cerrarAvisoSiNoQuedan(actor.sub);
    return { ok: true, completada };
  }

  /** El aviso a administración se cierra solo cuando no queda ninguna alta para completar. */
  private async cerrarAvisoSiNoQuedan(actorId: string) {
    const { data: quedan } = await this.db.from('usuarios').select('nombre').eq('alta_pendiente', true).order('nombre');
    const nombres = ((quedan ?? []) as any[]).map((u) => String(u.nombre));
    const avisos = this.db.from('alertas_internas').update(
      nombres.length
        ? { titulo: `Completá ${nombres.length === 1 ? '1 usuario nuevo' : `${nombres.length} usuarios nuevos`}`, detalle: `Falta el email, el WhatsApp y la clave de: ${nombres.join(', ')}.` }
        : { leida_en: new Date().toISOString(), leida_por: actorId },
    ).eq('tipo', 'usuarios_para_completar').is('leida_en', null);
    await avisos.then(() => null, () => null);
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
  private validar(dto: EditarUsuarioDto, actor: { rol: string }, rolObjetivo: string, rolNuevo?: string, rolesNuevos?: string[], rolesObjetivo?: string[]) {
    if (actor.rol === 'dueno') return;
    if (rolObjetivo === 'dueno' || rolNuevo === 'dueno' || rolesNuevos?.includes('dueno') || rolesObjetivo?.includes('dueno')) {
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
