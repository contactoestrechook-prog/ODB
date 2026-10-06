import { BadRequestException } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';

// Aprobar o rechazar un cobro a cuenta, venga de donde venga la firma
// (Clientes → Cobros a ingresar, o la bandeja de Aprobaciones). Antes cada
// pantalla tenía su copia: desde Cobranzas el rechazo le avisaba a quien lo
// cargó y desde Aprobaciones no, y la aprobación no le avisaba a nadie. El
// cajero que tomó la plata se quedaba sin saber si el pago había entrado.

const pesos = (n: unknown) => `$${Math.round(Number(n) || 0).toLocaleString('es-AR')}`;

type Cobranza = {
  estado: string;
  cargada_por: string | null;
  monto: number | string;
  cliente_id?: string | null;
  cliente?: { nombre?: string | null; razon_social?: string | null } | null;
};

async function leer(db: SupabaseClient, id: string): Promise<Cobranza | null> {
  const { data } = await db
    .from('cobranzas_pendientes')
    .select('estado, cargada_por, monto, cliente_id, cliente:clientes(nombre, razon_social)')
    .eq('id', id)
    .maybeSingle();
  return (data as any) ?? null;
}

// La campanita de quien cargó el cobro. No se le avisa a quien firma su propio
// cobro (ya lo sabe), y un aviso que no sale no frena la firma.
export async function avisarCargador(
  db: SupabaseClient,
  id: string,
  c: Cobranza | null,
  resultado: 'aprobada' | 'rechazada',
  firmante: string | null | undefined,
  extra: { respuesta?: string | null; saldoNuevo?: number | null } = {},
) {
  if (!c?.cargada_por || c.cargada_por === firmante) return;
  const nombre = c.cliente?.razon_social || c.cliente?.nombre || 'el cliente';
  const respuesta = extra.respuesta?.trim();
  const aviso =
    resultado === 'aprobada'
      ? {
          titulo: `Cobro aprobado: ${nombre} · ${pesos(c.monto)}`,
          detalle: `El pago de ${pesos(c.monto)} ya se aplicó a la cuenta${extra.saldoNuevo != null ? `; saldo nuevo ${pesos(extra.saldoNuevo)}` : ''}.${respuesta ? ` Nota: ${respuesta}` : ''}`,
        }
      : {
          titulo: `Cobro rechazado: ${nombre}`,
          detalle: `El pago de ${pesos(c.monto)} no se aplicó.${respuesta ? ` Motivo: ${respuesta}` : ''} Revisalo con el cliente.`,
        };
  await db.from('alertas_internas').insert({
    para_usuario: c.cargada_por,
    tipo: 'cobranza',
    ...aviso,
    referencia: { cobranzaId: id, clienteId: c.cliente_id ?? null },
  }).then(() => null, () => null);
}

// Aprobar: baja la deuda (RPC aprobar_cobranza), sale el recibo con folio y le
// avisa a quien cargó el cobro.
export async function aprobarCobranza(db: SupabaseClient, id: string, usuarioId: string | undefined, respuesta?: string | null) {
  const { data, error } = await db.rpc('aprobar_cobranza', {
    p_id: id, p_usuario: usuarioId ?? null, p_respuesta: respuesta ?? null,
  });
  if (error) throw new BadRequestException(error.message);

  // El recibo se emite ACÁ, en el momento en que el pago realmente entra a la
  // cuenta. Los saldos quedan guardados en el documento: si mañana el cliente
  // pide el papel de nuevo, sale idéntico al del día que pagó.
  const saldoNuevo = Number((data as any)?.saldoNuevo ?? 0);
  const monto = Number((data as any)?.monto ?? 0);
  await db.rpc('emitir_documento', {
    p_tipo: 'recibo_cobranza',
    p_entidad: 'cobranzas_pendientes',
    p_entidad_id: id,
    p_usuario: usuarioId ?? null,
    p_datos: { monto, saldo_anterior: saldoNuevo + monto, saldo_nuevo: saldoNuevo },
  }).then(() => null, () => null);

  const saldo = (data as any)?.saldoNuevo;
  await avisarCargador(db, id, await leer(db, id), 'aprobada', usuarioId, {
    respuesta,
    saldoNuevo: saldo != null && Number.isFinite(Number(saldo)) ? Number(saldo) : null,
  });
  return data;
}

// Rechazar: solo un cobro pendiente, y si otra persona lo resolvió en el medio
// se avisa en vez de pisarlo.
export async function rechazarCobranza(db: SupabaseClient, id: string, usuarioId: string | undefined, respuesta?: string | null) {
  const c = await leer(db, id);
  if (!c) throw new BadRequestException('No existe esa cobranza');
  if (c.estado !== 'pendiente') throw new BadRequestException(`Esa cobranza ya fue ${c.estado}`);
  const { data, error } = await db
    .from('cobranzas_pendientes')
    .update({ estado: 'rechazada', resuelta_por: usuarioId ?? null, resuelta_en: new Date().toISOString(), respuesta: respuesta?.trim() || null })
    .eq('id', id)
    .eq('estado', 'pendiente')
    .select('id');
  if (error) throw new BadRequestException(error.message);
  if (!(data ?? []).length) throw new BadRequestException('Esa cobranza la resolvió otra persona recién');
  await avisarCargador(db, id, c, 'rechazada', usuarioId, { respuesta });
  return { rechazada: true };
}
