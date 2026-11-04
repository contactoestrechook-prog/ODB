import { Inject, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { SupabaseClient } from '@supabase/supabase-js';
import { ImapFlow } from 'imapflow';
import { simpleParser, type Attachment } from 'mailparser';
import { SUPABASE } from '../supabase.provider';
import { ListasService } from '../listas/listas.service';

// LA CASILLA DE COMPRAS (Leandro, 3/11/2026). Los proveedores emiten factura
// electrónica: el PDF lo tienen todos. Si la mandan por mail a la casilla de
// compras, cada adjunto entra solo a la bandeja de lectura de «Entrada por
// foto», como si alguien la hubiera subido, y no hace falta sacarle foto al papel.
//
// Cada 2 minutos revisa los mails sin leer de la casilla (IMAP), marca cada uno
// como leído ANTES de procesarlo (si la API se corta en el medio, un mail no se
// carga dos veces) y manda a leer cada PDF o foto adjunta.
//
// Sin COMPRAS_IMAP_HOST, COMPRAS_IMAP_USUARIO y COMPRAS_IMAP_CLAVE en el entorno
// no hace nada. Con COMPRAS_MAIL_REMITENTES (lista separada por comas de mails o
// dominios: «@laserenisima.com.ar, facturas@rueda.com.ar») solo acepta esos.
// Tope de COMPRAS_MAIL_TOPE_DIA lecturas por día (40): cada lectura cuesta y un
// mail de spam con adjuntos no puede vaciar la cuenta de la IA.
const CADA_MS = 120_000;
const MAX_MB = 32;

const ext = (n?: string | null) => String(n ?? '').toLowerCase().split('.').pop() ?? '';

// Qué adjunto es una factura: los PDF siempre; las fotos, si no son el logo de
// la firma del mail (van «inline» o pesan menos de 60 KB).
export function adjuntoDeFactura(a: { contentType?: string; filename?: string | null; size?: number; contentDisposition?: string; related?: boolean }): { mimetype: string } | null {
  const tipo = String(a.contentType ?? '').toLowerCase();
  const tam = Number(a.size) || 0;
  if (tam <= 0 || tam > MAX_MB * 1024 * 1024) return null;
  if (tipo === 'application/pdf' || ext(a.filename) === 'pdf') return { mimetype: 'application/pdf' };
  const esFoto = /^image\/(jpeg|png|webp)$/.test(tipo) || ['jpg', 'jpeg', 'png', 'webp'].includes(ext(a.filename));
  if (!esFoto || a.related || a.contentDisposition === 'inline' || tam < 60 * 1024) return null;
  const mimetype = /^image\//.test(tipo) ? tipo : ext(a.filename) === 'png' ? 'image/png' : ext(a.filename) === 'webp' ? 'image/webp' : 'image/jpeg';
  return { mimetype };
}

export function remitenteAceptado(remitente: string, lista: string): boolean {
  const permitidos = lista.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!permitidos.length) return true;
  const r = remitente.trim().toLowerCase();
  return permitidos.some((p) => (p.startsWith('@') ? r.endsWith(p) : r === p));
}

@Injectable()
export class CasillaComprasService {
  private readonly log = new Logger(CasillaComprasService.name);
  private revisando = false;
  private ultimoError: string | null = null;

  constructor(
    @Inject(SUPABASE) private readonly db: SupabaseClient,
    private readonly listas: ListasService,
  ) {}

  private configurada() {
    return !!(process.env.COMPRAS_IMAP_HOST && process.env.COMPRAS_IMAP_USUARIO && process.env.COMPRAS_IMAP_CLAVE);
  }

  // cuántas lecturas entraron hoy por mail (las de mail no tienen usuario)
  private async leidasHoy(): Promise<number> {
    const hoy = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10); // día de Argentina
    const { count } = await this.db
      .from('lecturas_comprobante')
      .select('id', { count: 'exact', head: true })
      .is('usuario_id', null)
      .like('nombre_archivo', 'Mail · %')
      .gte('creado_en', `${hoy}T03:00:00.000Z`);
    return count ?? 0;
  }

  @Interval(CADA_MS)
  async revisar() {
    if (!this.configurada() || this.revisando) return;
    this.revisando = true;
    const cliente = new ImapFlow({
      host: process.env.COMPRAS_IMAP_HOST!,
      port: Number(process.env.COMPRAS_IMAP_PUERTO) || 993,
      secure: (process.env.COMPRAS_IMAP_PUERTO ?? '993') === '993',
      auth: { user: process.env.COMPRAS_IMAP_USUARIO!, pass: process.env.COMPRAS_IMAP_CLAVE! },
      logger: false,
    });
    try {
      await cliente.connect();
      const candado = await cliente.getMailboxLock('INBOX');
      try {
        const uids = ((await cliente.search({ seen: false }, { uid: true })) || []).slice(0, 10);
        const tope = Number(process.env.COMPRAS_MAIL_TOPE_DIA) || 40;
        let hoy = uids.length ? await this.leidasHoy() : 0;
        for (const uid of uids) {
          if (hoy >= tope) {
            this.log.warn(`casilla de compras: tope de ${tope} lecturas por día; los mails que faltan quedan sin leer para mañana`);
            break;
          }
          // leído ANTES de procesar: un corte no lo carga dos veces
          await cliente.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true });
          const mensaje = await cliente.fetchOne(String(uid), { source: true }, { uid: true });
          if (!mensaje || !mensaje.source) continue;
          const mail = await simpleParser(mensaje.source);
          const remitente = mail.from?.value?.[0]?.address ?? '';
          if (!remitenteAceptado(remitente, process.env.COMPRAS_MAIL_REMITENTES ?? '')) {
            this.log.warn(`casilla de compras: mail de ${remitente} ignorado (no está en COMPRAS_MAIL_REMITENTES)`);
            continue;
          }
          const adjuntos = (mail.attachments ?? []) as Attachment[];
          let cargados = 0;
          for (const a of adjuntos) {
            const tipo = adjuntoDeFactura(a as any);
            if (!tipo || hoy >= tope) continue;
            const nombre = a.filename || (tipo.mimetype === 'application/pdf' ? 'factura.pdf' : 'factura.jpg');
            await this.listas.encolarComprobanteFoto(
              { buffer: a.content, mimetype: tipo.mimetype, originalname: `Mail · ${remitente || 'sin remitente'} · ${nombre}` },
              undefined,
              undefined,
            );
            cargados++;
            hoy++;
          }
          this.log.log(`casilla de compras: mail de ${remitente} «${String(mail.subject ?? '').slice(0, 60)}» · ${cargados} de ${adjuntos.length} adjuntos a leer`);
        }
      } finally {
        candado.release();
      }
      await cliente.logout();
      this.ultimoError = null;
    } catch (e: any) {
      const msg = String(e?.responseText ?? e?.message ?? e).slice(0, 200);
      // el mismo error una sola vez en el log, no cada 2 minutos
      if (msg !== this.ultimoError) this.log.error(`casilla de compras: ${msg}`);
      this.ultimoError = msg;
      try { cliente.close(); } catch { /* ya estaba cerrada */ }
    } finally {
      this.revisando = false;
    }
  }
}
