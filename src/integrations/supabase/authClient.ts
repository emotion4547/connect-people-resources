import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

// Separate auth client to avoid non-Latin1 header issues.
// We force an ASCII-only X-Client-Info header.
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const supabaseAuth = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: localStorage,
    persistSession: true,
    autoRefreshToken: true,
  },
  global: {
    headers: {
      "X-Client-Info": "web-auth",
    },
  },
});
