import { createClient } from '@supabase/supabase-js';

// En el navegador las variables llegan por import.meta.env (Vite).
// En node (tests, scripts) por process.env. Soportar las dos permite
// probar esta misma capa de datos fuera del browser.
const entorno =
  (typeof import.meta !== 'undefined' && import.meta.env) ||
  (typeof process !== 'undefined' && process.env) ||
  {};

const url = entorno.VITE_SUPABASE_URL;
const key = entorno.VITE_SUPABASE_ANON_KEY;

if (!url || !key) {
  throw new Error(
    'Faltan VITE_SUPABASE_URL y/o VITE_SUPABASE_ANON_KEY. ' +
    'Copiá .env.example a .env y completalos.'
  );
}

export const supabase = createClient(url, key, {
  auth: {
    // Mi viejo entra una vez y no ve el login nunca más.
    persistSession: true,
    autoRefreshToken: true,
  },
});
