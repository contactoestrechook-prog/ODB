import { Logger } from '@nestjs/common';
import { esAlucinacionDeTranscripcion } from '../bot/prolijo';

// Transcribe un audio. Usa la API de transcripción estándar (la misma forma en
// OpenAI y en Groq), así el dueño elige proveedor sin tocar código:
//   TRANSCRIPCION_KEY   — la clave (lo único obligatorio)
//   TRANSCRIPCION_URL   — por defecto OpenAI; para Groq:
//                         https://api.groq.com/openai/v1/audio/transcriptions
//   TRANSCRIPCION_MODELO— por defecto whisper-1 (Groq: whisper-large-v3-turbo)
// Si no hay clave o falla, devuelve null: quien llama sigue sin el texto.
// La usan el bot (notas de voz de clientes) y la caja (notas de un ticket).
const log = new Logger('Transcripcion');

export function extensionAudio(mime: string): string {
  const m = String(mime ?? '');
  return /ogg/.test(m) ? 'ogg' : /webm/.test(m) ? 'webm' : /mpeg|mp3/.test(m) ? 'mp3' : /wav/.test(m) ? 'wav' : /mp4|m4a|aac/.test(m) ? 'm4a' : 'ogg';
}

export async function transcribirAudio(bin: Buffer, mime: string, vocabulario?: string): Promise<string | null> {
  const key = process.env.TRANSCRIPCION_KEY;
  if (!key) return null;
  const url = process.env.TRANSCRIPCION_URL || 'https://api.openai.com/v1/audio/transcriptions';
  const modelo = process.env.TRANSCRIPCION_MODELO || 'whisper-1';
  try {
    const fd = new FormData();
    fd.append('file', new Blob([new Uint8Array(bin)], { type: mime || 'audio/ogg' }), `audio.${extensionAudio(mime)}`);
    fd.append('model', modelo);
    fd.append('language', 'es');
    // el vocabulario del negocio ayuda mucho con marcas y medidas
    if (vocabulario) fd.append('prompt', vocabulario);
    const r = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: fd, signal: AbortSignal.timeout(45000) });
    if (!r.ok) { log.warn(`transcripción falló (${r.status}): ${(await r.text().catch(() => '')).slice(0, 160)}`); return null; }
    const j: any = await r.json();
    const texto = String(j?.text ?? '').trim();
    // Whisper "alucina" con audios mudos o con ruido: devuelve créditos de
    // subtítulos de YouTube. Eso no lo dijo nadie (Rachel, 23/9/2026).
    if (texto && esAlucinacionDeTranscripcion(texto)) { log.warn(`transcripción descartada (alucinación): "${texto.slice(0, 80)}"`); return null; }
    return texto || null;
  } catch (e: any) {
    log.warn(`transcripción falló: ${e?.message ?? e}`);
    return null;
  }
}
