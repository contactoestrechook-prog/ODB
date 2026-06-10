import { createClient, SupabaseClient } from '@supabase/supabase-js';

export const SUPABASE = 'SUPABASE';

export const supabaseProvider = {
  provide: SUPABASE,
  useFactory: (): SupabaseClient => {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_KEY;
    if (!url || !key) {
      throw new Error('Faltan SUPABASE_URL / SUPABASE_KEY en el .env');
    }
    return createClient(url, key, { auth: { persistSession: false } });
  },
};
