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
/**
 * Корінь проєкту — БЕЗ шляху. Бібліотека сама дописує /auth/v1/…,
 * /rest/v1/… і решту.
 *
 * На екрані «Data API» у Supabase поруч лежить REST-адреса
 * (…supabase.co/rest/v1), і сплутати їх дуже легко. Наслідок неочевидний:
 * запит іде на /rest/v1/auth/v1/authorize і повертає 401 без натяку,
 * у чому річ. Тому відрізаємо хвіст самі й кажемо про це вголос.
 */
function projectUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  const trimmed = raw.trim().replace(/\/+$/, '')
  const m = /^(https?:\/\/[^/]+)(\/.*)?$/.exec(trimmed)
  if (!m) return trimmed
  if (m[2]) {
    console.warn(
      `VITE_SUPABASE_URL містить зайвий шлях «${m[2]}» — використовую ${m[1]}. ` +
      'Потрібен корінь проєкту, без /rest/v1.',
    )
  }
  return m[1]
}

const url = projectUrl(import.meta.env.VITE_SUPABASE_URL)

// Supabase перейменував ключі: anon → publishable. Обидві назви живі,
// і плутанина закономірна, тож приймаємо будь-яку.
const key =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  import.meta.env.VITE_SUPABASE_ANON_KEY

/**
 * Помилкове налаштування НЕ має вбивати застосунок.
 *
 * createClient кидає на кривому URL — а це виконується під час завантаження
 * модуля, тобто замість інтерфейсу користувач отримав би білу сторінку.
 * Заглушка на кшталт https://<project-ref>.supabase.co саме так і робила.
 * Тому падіння ловимо й тихо лишаємось у локальному режимі, сказавши причину.
 */
function makeClient(): SupabaseClient | null {
  if (!url || !key) return null
  try {
    return createClient(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        // сесія приїжджає в адресному рядку після Google — підхоплюємо й прибираємо
        detectSessionInUrl: true,
      },
    })
  } catch (e) {
    console.error(
      'Supabase не піднявся, працюємо на локальних даних:',
      e instanceof Error ? e.message : e,
    )
    return null
  }
}

export const supabase: SupabaseClient | null = makeClient()
export const isCloudConfigured = supabase !== null

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
