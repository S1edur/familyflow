/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** https://<project-ref>.supabase.co */
  readonly VITE_SUPABASE_URL?: string
  /** sb_publishable_… — публічний за задумом, захищає RLS */
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string
  /** стара назва того самого ключа, до перейменування в Supabase */
  readonly VITE_SUPABASE_ANON_KEY?: string
  /** публічна половина VAPID-пари для пушів; приватна живе лише у Vercel */
  readonly VITE_VAPID_PUBLIC_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
