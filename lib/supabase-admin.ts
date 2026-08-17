import { createClient } from "@supabase/supabase-js";

// Service role key bypasses RLS entirely. Only import this file from
// app/api/** route handlers (server-side) — never from client components.
export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);
