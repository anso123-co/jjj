import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

/**
 * CONFIGURACIÓN (obligatoria):
 * 1) En Supabase: Project Settings → API
 * 2) Copia:
 *    - Project URL
 *    - anon public key
 * 3) Pégalos abajo.
 *
 * Nota: usar anon key en el front es normal (RLS te protege).
 */
const SUPABASE_URL = "https://hguwqejcrypslxbcrdgy.supabase.co";
const SUPABASE_ANON_KEY ="sb_publishable_Hp1PqdiYBVnptBmgqaxq_w_L7RPfOAB";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
