// supabase-config.js – initialize Supabase client for the front‑end
// This file is loaded as a ES module (type="module") before any other script that uses `supabase`.
// It creates and exports a `supabase` instance that can be imported by other modules.

import { supabase } from "./supabase-config.js";


import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

// 👉 Replace the placeholders with your actual Supabase project URL and anon public key.
// You can store them as environment variables in Vercel and inject them at build time
// (e.g., using `process.env.NEXT_PUBLIC_SUPABASE_URL` in a Next.js app). For a static site,
// you may hard‑code them here – just be aware they are public.
const SUPABASE_URL = "https://celusvfynfnszmhjgqwj.supabase.co"; // e.g. https://xyzcompany.supabase.co
const SUPABASE_ANON_KEY = "sb_publishable_NlHs6PG9x_HHfCDUKOlArQ_pM41Bn7g";

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error("Supabase URL or anon key is missing – please set them in supabase-config.js.");
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Optionally expose `supabase` on the window for legacy scripts that expect a global variable.
// This is safe for a front‑end only app because the anon key is public.
window.supabase = supabase;

