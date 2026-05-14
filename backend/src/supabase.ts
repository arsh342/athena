import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export type AuthProvider = 'legacy' | 'supabase';

/** Returns the normalized auth provider, defaulting to legacy. */
export function getAuthProvider(raw: string | undefined = process.env.AUTH_PROVIDER): AuthProvider {
  return String(raw ?? '').trim().toLowerCase() === 'supabase' ? 'supabase' : 'legacy';
}

/** Returns true when the auth provider is configured as supabase. */
export function isSupabaseProvider(raw: string | undefined = process.env.AUTH_PROVIDER): boolean {
  return getAuthProvider(raw) === 'supabase';
}

function required(name: 'SUPABASE_URL' | 'SUPABASE_ANON_KEY' | 'SUPABASE_SERVICE_ROLE_KEY'): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required when AUTH_PROVIDER=supabase`);
  return value;
}

let cached: { anon: SupabaseClient; service: SupabaseClient } | null = null;

/** Creates and caches anon/service Supabase clients for backend auth operations. */
export function createSupabaseClients(): { anon: SupabaseClient; service: SupabaseClient } {
  if (cached) return cached;

  const url = required('SUPABASE_URL');
  const anonKey = required('SUPABASE_ANON_KEY');
  const serviceRoleKey = required('SUPABASE_SERVICE_ROLE_KEY');

  cached = {
    anon: createClient(url, anonKey, { auth: { persistSession: false } }),
    service: createClient(url, serviceRoleKey, { auth: { persistSession: false } }),
  };

  return cached;
}
