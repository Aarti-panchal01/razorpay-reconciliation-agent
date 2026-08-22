import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-only Supabase client using the service-role key. Never import this
 * from a "use client" component — the service role bypasses RLS entirely,
 * which is exactly why it must never reach the browser. All persistence
 * goes through API routes; the client never talks to Supabase directly.
 */
let cached: SupabaseClient | null = null;

export function getSupabaseServerClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    // Persistence is optional — the engine works fully without it. Callers
    // check for null and skip persistence rather than crashing the batch.
    return null;
  }

  if (!cached) {
    cached = createClient(url, key, { auth: { persistSession: false } });
  }
  return cached;
}
