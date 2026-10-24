import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase.provider';
import { celularWhatsapp, enviarTextoWhatsapp } from '../comun/whatsapp';
import { LINEA_GENERAL } from '../comun/lineas';

const TZ = 'America/Argentina/Buenos_Aires';

// Resumen de cuenta corriente por WhatsApp (Leandro, 24/10/2026): «cada 15
// días enviándoles su saldo». Decidido con él: línea general por WAHA, días 1
// y 16 a las 10:00, a todos los que deben.
//
// Nace pausado: la config arranca con activo = false y el dueño lo prende
// desde Cuentas corrientes después de mandarse una prueba.
//
// Los mensajes salen de a uno, con 25 a 45 segundos entre cada uno: ~90
// clientes son menos de una hora, y una ráfaga es lo que hizo cortar la sesión
// de WAHA con el Wine Fest. Con 5 errores seguidos frena y avisa al dueño.

export type Config = {
  activo: boolean;
  dias: number[];
  hora: number;
  piso: number;
  plantilla: string;
  actualizado_en?: string;
};

type Candidato = {
  clienteId: string;
  nombre: string;
  telefono: string | null;
  destino: string | null;
  saldo: number;
  texto: string;
  estado: 'pendiente' | 'sin_telefono';
};

const pesos = (n: number) => `$${Math.round(n).toLocaleString('es-AR')}`;
const fechaCorta = (d: Date) => d.toLocaleDateString('es-AR', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' });

/** Hoy en Buenos Aires: día del mes, hora y la fecha ISO (la tanda). */
function ahoraBA() {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date())
      .map((x) => [x.type, x.value]),
  );
  return { dia: Number(p.day), hora: Number(p.hour), iso: `${p.year}-${p.month}-${p.day}` };
}

/** Un celular argentino que WhatsApp entiende: 549 + 10 dígitos. */
function destinoValido(tel: string | null | undefined): string | null {
  const d = celularWhatsapp(String(tel ?? ''));
  return /^549\d{10}$/.test(d) ? d : null;
}

/** El primer nombre, para el saludo: «JUAN PEREZ» → «Juan». Una razón social va entera. */
function saludo(nombre: string, razonSocial: string | null): string {
  if (razonSocial?.trim()) return razonSocial.trim();
  const primero = String(nombre ?? '').trim().split(/\s+/)[0] ?? '';
  return primero ? primero[0].toUpperCase() + primero.slice(1).toLowerCase() : '';
}

@Injectable()
export class CtaCteResumenesService {
  private readonly log = new Logger('CtaCteResumenes');
  private corriendo = false;

  constructor(@Inject(SUPABASE) private readonly db: SupabaseClient) {}

  async config(): Promise<Config> {
    const { data, error } = await this.db.from('cta_cte_resumenes_config').select('*').eq('id', 1).maybeSingle();
    if (error) throw new BadRequestException(error.message);
    return {
      activo: !!data?.activo,
      dias: (data?.dias ?? [1, 16]).map(Number),
      hora: Number(data?.hora ?? 10),
      piso: Number(data?.piso ?? 0),
      plantilla: String(data?.plantilla ?? ''),
      actualizado_en: data?.actualizado_en,
    };
  }

  async guardarConfig(cambios: Partial<Pick<Config, 'activo' | 'plantilla' | 'piso'>>, usuario: string | null) {
    const fila: Record<string, unknown> = { actualizado_en: new Date().toISOString(), actualizado_por: usuario };
    if (cambios.activo !== undefined) fila.activo = !!cambios.activo;
    if (cambios.piso !== undefined) {
      const piso = Number(cambios.piso);
      if (!Number.isFinite(piso) || piso < 0) throw new BadRequestException('El piso tiene que ser un monto válido');
      fila.piso = piso;
    }
    if (cambios.plantilla !== undefined) {
      const p = String(cambios.plantilla).trim();
      if (!p.includes('{saldo}')) throw new BadRequestException('El mensaje tiene que llevar {saldo}');
      if (p.length > 1500) throw new BadRequestException('El mensaje es demasiado largo');
      fila.plantilla = p;
    }
    const { error } = await this.db.from('cta_cte_resumenes_config').update(fila).eq('id', 1);
    if (error) throw new BadRequestException(error.message);
    return this.config();
  }

  /** La próxima fecha en que sale el resumen, según los días y la hora. */
  proxima(cfg: Config): string {
    const { dia, hora, iso } = ahoraBA();
    const [y, m] = iso.split('-').map(Number);
    const dias = [...cfg.dias].sort((a, b) => a - b);
    const hoySale = dias.includes(dia) && hora < cfg.hora;
    const esteMes = dias.find((d) => d > dia);
    const pad = (n: number) => String(n).padStart(2, '0');
    if (hoySale) return iso;
    if (esteMes) return `${y}-${pad(m)}-${pad(esteMes)}`;
    const ny = m === 12 ? y + 1 : y;
    const nm = m === 12 ? 1 : m + 1;
    return `${ny}-${pad(nm)}-${pad(dias[0])}`;
  }

  /**
   * Quiénes recibirían el resumen hoy y con qué texto. No escribe nada.
   * Los movimientos son los de la cuenta corriente desde el último resumen
   * enviado (o los últimos 15 días si nunca recibió uno).
   */
  async candidatos(cfg?: Config): Promise<Candidato[]> {
    const c = cfg ?? (await this.config());
    const { data, error } = await this.db
      .from('clientes')
      .select('id, nombre, razon_social, telefono, saldo_cta_cte')
      .eq('cta_cte_habilitada', true)
      .eq('cta_cte_resumen', true)
      .gt('saldo_cta_cte', Math.max(c.piso, 0.99))
      .order('saldo_cta_cte', { ascending: false });
    if (error) throw new BadRequestException(error.message);
    const clientes = (data ?? []) as any[];
    if (!clientes.length) return [];
    const ids = clientes.map((x) => x.id);

    const [{ data: linea }, { data: previos }, { data: movs }] = await Promise.all([
      this.db.from('lineas_whatsapp').select('alias_pago, titular_pago').eq('linea', LINEA_GENERAL).maybeSingle(),
      this.db.from('cta_cte_resumenes').select('cliente_id, enviado_en').eq('estado', 'enviado').in('cliente_id', ids).order('enviado_en', { ascending: false }),
      this.db.from('cuenta_corriente').select('cliente_id, debe, haber, creado_en').in('cliente_id', ids).gte('creado_en', new Date(Date.now() - 45 * 86400_000).toISOString()),
    ]);

    const ultimoResumen = new Map<string, string>();
    for (const r of (previos ?? []) as any[]) if (!ultimoResumen.has(r.cliente_id)) ultimoResumen.set(r.cliente_id, r.enviado_en);

    const alias = String((linea as any)?.alias_pago ?? '').trim() || 'consultá en el local';
    const titular = String((linea as any)?.titular_pago ?? '').trim() || 'O.D.B';
    const hoy = fechaCorta(new Date());

    return clientes.map((cli) => {
      const desde = ultimoResumen.get(cli.id) ?? new Date(Date.now() - 15 * 86400_000).toISOString();
      let compras = 0;
      let pagos = 0;
      for (const m of (movs ?? []) as any[]) {
        if (m.cliente_id !== cli.id || m.creado_en <= desde) continue;
        compras += Number(m.debe ?? 0);
        pagos += Number(m.haber ?? 0);
      }
      const partes = [compras > 0 ? `compras por ${pesos(compras)}` : '', pagos > 0 ? `pagos por ${pesos(pagos)}` : ''].filter(Boolean);
      const movimientos = partes.length ? `Desde el ${fechaCorta(new Date(desde))}: ${partes.join(' y ')}.` : '';
      const saldo = Number(cli.saldo_cta_cte ?? 0);
      const texto = c.plantilla
        .replaceAll('{nombre}', saludo(cli.nombre, cli.razon_social))
        .replaceAll('{saldo}', pesos(saldo))
        .replaceAll('{fecha}', hoy)
        .replaceAll('{alias}', alias)
        .replaceAll('{titular}', titular)
        .replaceAll('{movimientos}', movimientos)
        // sin movimientos queda un renglón vacío de más; y «Hola  👋» sin nombre
        .replace(/\n{3,}/g, '\n\n')
        .replace(/ {2,}/g, ' ')
        .trim();
      const destino = destinoValido(cli.telefono);
      return {
        clienteId: cli.id,
        nombre: cli.razon_social || cli.nombre,
        telefono: cli.telefono ?? null,
        destino,
        saldo,
        texto,
        estado: destino ? 'pendiente' : 'sin_telefono',
      };
    });
  }

  /** Anota la tanda (una vez por cliente) y despacha lo pendiente. */
  async correrTanda(tanda: string, manual = false) {
    const cfg = await this.config();
    const lista = await this.candidatos(cfg);
    if (lista.length) {
      const { error } = await this.db.from('cta_cte_resumenes').upsert(
        lista.map((x) => ({
          tanda, cliente_id: x.clienteId, telefono: x.destino ?? x.telefono, saldo: x.saldo, texto: x.texto, estado: x.estado,
          motivo: x.estado === 'sin_telefono' ? 'sin celular válido en la ficha' : null, manual,
        })),
        { onConflict: 'tanda,cliente_id', ignoreDuplicates: true },
      );
      if (error) throw new BadRequestException(error.message);
    }
    // sin esperar: una tanda tarda cerca de una hora
    void this.despachar(tanda);
    const { count } = await this.db.from('cta_cte_resumenes').select('id', { count: 'exact', head: true }).eq('tanda', tanda).eq('estado', 'pendiente');
    return { tanda, pendientes: count ?? 0, sinTelefono: lista.filter((x) => x.estado === 'sin_telefono').length };
  }

  private async despachar(tanda: string) {
    if (this.corriendo) return;
    this.corriendo = true;
    let seguidos = 0;
    let enviados = 0;
    try {
      for (;;) {
        // se relee cada vez: si el dueño lo pausa en el medio, frena acá
        const cfg = await this.config();
        const { data: sig } = await this.db.from('cta_cte_resumenes').select('id, manual').eq('tanda', tanda).eq('estado', 'pendiente').order('saldo', { ascending: false }).limit(1).maybeSingle();
        if (!sig) break;
        // «Mandar ahora» lo pide el dueño a propósito: sale aunque lo automático esté pausado
        if (!cfg.activo && !sig.manual) break;

        // tomarlo: si otra instancia ya lo agarró, este update no devuelve nada
        const { data: fila } = await this.db.from('cta_cte_resumenes').update({ estado: 'enviando' }).eq('id', sig.id).eq('estado', 'pendiente').select('id, telefono, texto').maybeSingle();
        if (!fila) continue;

        const r = await enviarTextoWhatsapp(this.db, fila.telefono, fila.texto, 'cta-cte-resumen');
        // un envío incierto (corte por tiempo) se da por enviado: reintentarlo
        // sería mandarle el saldo dos veces
        const ok = r.enviado || r.incierto;
        await this.db.from('cta_cte_resumenes').update({
          estado: ok ? 'enviado' : 'error',
          motivo: r.enviado ? null : r.motivo ?? null,
          waha_id: r.id ?? null,
          enviado_en: ok ? new Date().toISOString() : null,
        }).eq('id', fila.id);

        if (ok) { enviados++; seguidos = 0; } else seguidos++;
        if (seguidos >= 5) {
          await this.db.from('alertas_internas').insert({
            para_usuario: null, tipo: 'cta-cte',
            titulo: 'El resumen de cuenta corriente se frenó',
            detalle: `5 errores seguidos al mandar por WhatsApp (último: ${r.motivo ?? 'sin detalle'}). Revisá la línea general y volvé a tocar «Mandar ahora» en Cuentas corrientes: sigue desde donde quedó.`,
            referencia: { tanda },
          }).then(() => null, () => null);
          break;
        }
        await new Promise((res) => setTimeout(res, 25_000 + Math.random() * 20_000));
      }
    } catch (e) {
      this.log.error(`tanda ${tanda}: ${e instanceof Error ? e.message : e}`);
    } finally {
      this.corriendo = false;
      this.log.log(`tanda ${tanda}: ${enviados} resúmenes enviados`);
    }
  }

  // Cada hora en punto: si hoy es día de resumen y ya pasó la hora, arma la
  // tanda (si ya está armada, no duplica) y sigue lo pendiente. Así, si el
  // servidor estaba caído a las 10, sale apenas vuelve, y nunca de noche.
  @Cron('0 * * * *', { timeZone: TZ })
  async alToqueDeHora() {
    const cfg = await this.config().catch(() => null);
    if (!cfg?.activo) return;
    const { dia, hora, iso } = ahoraBA();
    if (!cfg.dias.includes(dia) || hora < cfg.hora || hora > 20) return;
    await this.correrTanda(iso).catch((e) => this.log.error(e instanceof Error ? e.message : String(e)));
  }

  /** Manda el texto de un cliente (o el primero de la lista) a un número de prueba. */
  async prueba(telefono: string, clienteId?: string) {
    const destino = destinoValido(telefono);
    if (!destino) throw new BadRequestException('Ese número no es un celular válido');
    const lista = await this.candidatos();
    const x = (clienteId && lista.find((c) => c.clienteId === clienteId)) || lista[0];
    if (!x) throw new BadRequestException('Hoy no hay nadie con saldo para armar el ejemplo');
    const r = await enviarTextoWhatsapp(this.db, destino, `[PRUEBA · así le llegaría a ${x.nombre}]\n\n${x.texto}`, 'cta-cte-prueba');
    if (!r.enviado && !r.incierto) throw new BadRequestException(`No salió: ${r.motivo ?? 'sin detalle'}`);
    return { ok: true, cliente: x.nombre };
  }

  /** Lo enviado y lo que falta de las últimas tandas. */
  async historial() {
    const { data, error } = await this.db
      .from('cta_cte_resumenes')
      .select('tanda, estado, saldo, manual')
      .order('tanda', { ascending: false })
      .limit(2000);
    if (error) throw new BadRequestException(error.message);
    const porTanda = new Map<string, { tanda: string; enviados: number; errores: number; pendientes: number; sinTelefono: number; monto: number; manual: boolean }>();
    for (const r of (data ?? []) as any[]) {
      const t = porTanda.get(r.tanda) ?? { tanda: r.tanda, enviados: 0, errores: 0, pendientes: 0, sinTelefono: 0, monto: 0, manual: false };
      if (r.estado === 'enviado') { t.enviados++; t.monto += Number(r.saldo); }
      else if (r.estado === 'error') t.errores++;
      else if (r.estado === 'pendiente' || r.estado === 'enviando') t.pendientes++;
      else if (r.estado === 'sin_telefono') t.sinTelefono++;
      if (r.manual) t.manual = true;
      porTanda.set(r.tanda, t);
    }
    return [...porTanda.values()].slice(0, 12);
  }

  /** Estado de cuenta de un cliente: movimientos y resúmenes que recibió. */
  async estadoDeCuenta(clienteId: string) {
    const [{ data: cli }, { data: movs }, { data: resumenes }] = await Promise.all([
      this.db.from('clientes').select('id, nombre, razon_social, telefono, cuit, domicilio, email, saldo_cta_cte, limite_credito, cta_cte_habilitada, cta_cte_resumen').eq('id', clienteId).maybeSingle(),
      this.db.from('cuenta_corriente').select('id, concepto, debe, haber, creado_en').eq('cliente_id', clienteId).order('creado_en', { ascending: false }).limit(100),
      this.db.from('cta_cte_resumenes').select('tanda, estado, saldo, motivo, enviado_en').eq('cliente_id', clienteId).order('tanda', { ascending: false }).limit(24),
    ]);
    if (!cli) throw new BadRequestException('No existe ese cliente');
    return {
      cliente: {
        id: cli.id,
        nombre: cli.razon_social || cli.nombre,
        datos: { nombre: cli.nombre ?? '', razonSocial: cli.razon_social ?? '', cuit: cli.cuit ?? '', domicilio: cli.domicilio ?? '', email: cli.email ?? '' },
        telefono: cli.telefono,
        celularValido: !!destinoValido(cli.telefono),
        saldo: Number(cli.saldo_cta_cte ?? 0),
        limite: Number(cli.limite_credito ?? 0),
        habilitada: !!cli.cta_cte_habilitada,
        recibeResumen: cli.cta_cte_resumen !== false,
      },
      movimientos: (movs ?? []).map((m: any) => ({ ...m, debe: Number(m.debe ?? 0), haber: Number(m.haber ?? 0) })),
      resumenes: resumenes ?? [],
    };
  }

  async cambiarCliente(clienteId: string, cambios: DatosCliente & { recibeResumen?: boolean; limite?: number; habilitada?: boolean }) {
    const fila: Record<string, unknown> = datosAFila(cambios);
    if (cambios.recibeResumen !== undefined) fila.cta_cte_resumen = !!cambios.recibeResumen;
    if (cambios.limite !== undefined) {
      const tope = Number(cambios.limite);
      if (!Number.isFinite(tope) || tope < 0) throw new BadRequestException('El tope tiene que ser un monto válido');
      fila.limite_credito = tope;
    }
    if (cambios.habilitada !== undefined) {
      // cerrada, la cuenta sale del tablero: con deuda adentro, la plata se perdería de vista
      if (!cambios.habilitada) {
        const { data } = await this.db.from('clientes').select('saldo_cta_cte').eq('id', clienteId).maybeSingle();
        if (Number(data?.saldo_cta_cte ?? 0) > 0) throw new BadRequestException('No se puede cerrar una cuenta que todavía debe');
      }
      fila.cta_cte_habilitada = !!cambios.habilitada;
    }
    if (!Object.keys(fila).length) return { ok: true };
    const { error } = await this.db.from('clientes').update(fila).eq('id', clienteId);
    if (error) throw new BadRequestException(error.code === '23505' ? 'Ese CUIT o DNI ya está en otro cliente' : error.message);
    return { ok: true };
  }

  /**
   * Sumar una cuenta: un cliente que ya existe (clienteId) o uno nuevo
   * (datos, con nombre). Habilita la cuenta, fija el tope y, si viene con una
   * deuda de antes, la carga como saldo inicial (cta_cte_abrir, en la base).
   */
  async abrirCuenta(dto: { clienteId?: string; datos?: DatosCliente; tope?: number; saldoInicial?: number; nota?: string }) {
    const tope = Number(dto.tope ?? 0);
    const saldoInicial = Number(dto.saldoInicial ?? 0);
    if (!Number.isFinite(tope) || tope < 0) throw new BadRequestException('El tope tiene que ser un monto válido');
    if (!Number.isFinite(saldoInicial) || saldoInicial < 0) throw new BadRequestException('El saldo inicial tiene que ser un monto válido');

    let clienteId = dto.clienteId ?? null;
    if (!clienteId) {
      if (!String(dto.datos?.nombre ?? '').trim()) throw new BadRequestException('Falta el nombre del cliente');
      const fila = datosAFila(dto.datos ?? {});
      const { data, error } = await this.db.from('clientes').insert(fila).select('id').single();
      if (error) throw new BadRequestException(error.code === '23505' ? 'Ese CUIT o DNI ya está en otro cliente: buscalo y sumalo desde ahí' : error.message);
      clienteId = data.id as string;
    } else if (dto.datos) {
      await this.cambiarCliente(clienteId, dto.datos);
    }

    const { data: saldo, error } = await this.db.rpc('cta_cte_abrir', {
      p_cliente: clienteId, p_tope: tope, p_saldo_inicial: saldoInicial, p_nota: dto.nota?.trim() || null,
    });
    if (error) throw new BadRequestException(error.message);
    return { clienteId, saldo: Number(saldo ?? 0) };
  }
}

export type DatosCliente = { nombre?: string; razonSocial?: string; cuit?: string; domicilio?: string; email?: string; telefono?: string };

/** Los datos de la ficha, validados, como columnas de clientes. */
function datosAFila(d: DatosCliente): Record<string, unknown> {
  const fila: Record<string, unknown> = {};
  const texto = (v: string | undefined) => (v === undefined ? undefined : String(v).trim() || null);
  if (d.nombre !== undefined) {
    if (!String(d.nombre).trim()) throw new BadRequestException('El nombre no puede quedar vacío');
    fila.nombre = String(d.nombre).trim();
  }
  if (d.razonSocial !== undefined) fila.razon_social = texto(d.razonSocial);
  if (d.domicilio !== undefined) fila.domicilio = texto(d.domicilio);
  if (d.email !== undefined) {
    const e = texto(d.email);
    if (e && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new BadRequestException('El mail no es válido');
    fila.email = e;
  }
  if (d.cuit !== undefined) {
    const c = String(d.cuit).replace(/\D/g, '');
    if (c && c.length !== 11) throw new BadRequestException('El CUIT tiene 11 números');
    fila.cuit = c || null;
  }
  if (d.telefono !== undefined) {
    const t = String(d.telefono).trim();
    if (t && !destinoValido(t)) throw new BadRequestException('Ese celular no sirve: código de área + número, sin el 15 (ej. 11 2345-6789)');
    fila.telefono = t || null;
  }
  return fila;
}
