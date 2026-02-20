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
const SUPABASE_URL = "PEGA_AQUI_TU_SUPABASE_URL";
const SUPABASE_ANON_KEY = "PEGA_AQUI_TU_SUPABASE_ANON_KEY";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
