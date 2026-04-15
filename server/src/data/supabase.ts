import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { CONFIG } from '../config';

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (client) return client;
  if (!CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_KEY) {
    console.warn('[Supabase] No credentials configured — running in-memory only');
    return null;
  }
  client = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY);
  console.log('[Supabase] Client initialized');
  return client;
}
