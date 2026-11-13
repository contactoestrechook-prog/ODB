import { Logger } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { BaseEnMemoria } from './db/memoria';
import { sembrar } from './db/semilla';

export const SUPABASE = 'SUPABASE';

export const esDemo = () => process.env.SUPABASE_URL === 'demo';

// Una sola base en memoria para toda la API (cada módulo pide este provider).
let demo: BaseEnMemoria | null = null;

export const supabaseProvider = {
  provide: SUPABASE,
  useFactory: (): SupabaseClient => {
    const url = process.env.SUPABASE_URL;
    // SUPABASE_URL=demo → datos de muestra en memoria (ver db/memoria.ts). Sirve
    // para recorrer las pantallas sin base; no guarda nada entre reinicios.
    if (url === 'demo') {
      if (!demo) {
        demo = new BaseEnMemoria(sembrar());
        new Logger('Base').warn('MODO DEMO: datos de muestra en memoria. Nada se guarda.');
      }
      return demo as unknown as SupabaseClient;
    }
    // service key (escrituras de admin) si está configurada; si no, la pública (solo lectura)
    const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;
    if (!url || !key) {
      throw new Error('Faltan SUPABASE_URL / SUPABASE_KEY en el .env');
    }
    return createClient(url, key, { auth: { persistSession: false } });
  },
};
