// Configuration read from the function environment. The secret key comes from
// the variables Supabase injects (ADR-010); it is never sent to the browser.

export function supabaseUrl(): string {
  const url = Deno.env.get('SUPABASE_URL')
  if (!url) throw new Error('SUPABASE_URL is not set')
  return url
}

/** The project's default secret key (sb_secret_…). Not the legacy service_role JWT. */
export function secretKey(): string {
  const keys = Deno.env.get('SUPABASE_SECRET_KEYS')
  if (keys) {
    const parsed = JSON.parse(keys) as Record<string, string>
    if (parsed.default) return parsed.default
  }
  // Local development fallback provided by the CLI.
  const single = Deno.env.get('SUPABASE_SECRET_KEY')
  if (single) return single
  throw new Error('No Supabase secret key is available to this function')
}

/** Domain of the synthetic Auth emails (ADR-001). Must match VITE_AUTH_EMAIL_DOMAIN. */
export function authEmailDomain(): string {
  const domain = Deno.env.get('AUTH_EMAIL_DOMAIN')
  if (!domain || !/^[a-z0-9.-]+\.[a-z0-9-]+$/.test(domain)) {
    throw new Error('AUTH_EMAIL_DOMAIN is missing or invalid')
  }
  return domain
}

/** Browser origins allowed to call the functions, comma-separated. */
export function allowedOrigins(): string[] {
  return (Deno.env.get('ALLOWED_ORIGINS') ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
}
