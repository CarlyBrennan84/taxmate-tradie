import { createClient } from "@supabase/supabase-js";

// Captured before createClient() runs below, since Supabase's own URL
// detection strips these params from the hash as part of client setup.
export const arrivedViaInviteOrRecovery =
  typeof window !== "undefined" && /type=(invite|recovery)/.test(window.location.hash);

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

/**
 * The Supabase anon key is designed to be public — it's safe to ship in the
 * client bundle. Data access is protected by row-level security policies on
 * the database side (see supabase/schema.sql), not by keeping this key secret.
 */
export const supabase =
  SUPABASE_URL && SUPABASE_ANON_KEY ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;
