import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Клієнт Supabase.
 *
 * Ключі необовʼязкові НАВМИСНО. Без них застосунок працює як і працював —
 * на локальних даних, без входу. Це те, чим лишається офлайнова однофайлова
 * збірка dist/family-flow.html, яка відкривається подвійним кліком.
 *
 * Ключ публічний за задумом: Vite запікає VITE_* у бандл, тож він однаково
 * видно в devtools. Захищають політики RLS, а не таємність ключа.
 */
const url = import.meta.env.VITE_SUPABASE_URL

// Supabase перейменував ключі: anon → publishable. Обидві назви живі,
// і плутанина закономірна, тож приймаємо будь-яку.
const key =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  import.meta.env.VITE_SUPABASE_ANON_KEY

export const isCloudConfigured = Boolean(url && key)

export const supabase: SupabaseClient | null = isCloudConfigured
  ? createClient(url!, key!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        // сесія приїжджає в адресному рядку після Google — підхоплюємо й прибираємо
        detectSessionInUrl: true,
      },
    })
  : null

/** Кидає, якщо викликано без налаштованих ключів — щоб помилка була гучною, а не мовчазною. */
export function cloud(): SupabaseClient {
  if (!supabase) {
    throw new Error(
      'Supabase не налаштований: немає VITE_SUPABASE_URL або VITE_SUPABASE_PUBLISHABLE_KEY. ' +
      'Скопіюйте .env.example у .env.local і заповніть.',
    )
  }
  return supabase
}
