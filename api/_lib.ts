/**
 * Спільне для серверних функцій сповіщень. Файли з «_» Vercel маршрутами не робить.
 *
 * Тут живуть ТАЄМНІ ключі — лише зі змінних середовища Vercel, ніколи з коду:
 *   VAPID_PRIVATE_KEY          підпис пушів
 *   SUPABASE_SERVICE_ROLE_KEY  читання підписок в обхід RLS
 *   CRON_SECRET                щоб щоденний підсумок не міг запустити будь-хто
 * Публічні (VITE_SUPABASE_URL, VITE_VAPID_PUBLIC_KEY) — ті самі, що в бандлі.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import webpush from 'web-push'

export interface Payload { title: string; body: string; url: string; tag?: string }

function need(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`На сервері не задано ${name}`)
  return v
}

let client: SupabaseClient | null = null
let vapidReady = false

export function admin(): SupabaseClient {
  if (!client) {
    // той самий корінь без /rest/v1, що й у клієнті — див. src/data/supabase.ts
    const url = need('VITE_SUPABASE_URL').trim().replace(/^(https?:\/\/[^/]+).*$/, '$1')
    client = createClient(url, need('SUPABASE_SERVICE_ROLE_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  }
  return client
}

function vapid() {
  if (vapidReady) return
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:family-flow@example.com',
    need('VITE_VAPID_PUBLIC_KEY'),
    need('VAPID_PRIVATE_KEY'),
  )
  vapidReady = true
}

/** Шле всім пристроям цих людей. Мертві підписки (404/410) прибирає. */
export async function sendTo(profileIds: string[], payload: Payload): Promise<number> {
  if (!profileIds.length) return 0
  vapid()
  const db = admin()
  const { data, error } = await db
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth')
    .in('profile_id', profileIds)
  if (error) throw new Error(error.message)

  let sent = 0
  await Promise.all((data ?? []).map(async s => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(payload),
        { TTL: 12 * 60 * 60 },
      )
      sent++
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode
      // браузер відписався або застосунок видалили — адреса більше не житиме
      if (code === 404 || code === 410) {
        await db.from('push_subscriptions').delete().eq('endpoint', s.endpoint)
      }
    }
  }))
  return sent
}

/**
 * Одноразовість: true, якщо з цим ключем ще нічого не надсилали.
 * Первинний ключ у push_log робить перевірку атомарною — два паралельні
 * запуски не надішлють двічі.
 */
export async function once(key: string): Promise<boolean> {
  const { error } = await admin().from('push_log').insert({ key })
  if (!error) return true
  if (error.code === '23505') return false
  throw new Error(error.message)
}

export const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** Дата в Києві: сервер живе в UTC, а «сьогодні» в людей — своє. */
export function kyivDate(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 864e5)
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv' }).format(d)
}

const SYMBOL: Record<string, string> = { UAH: '₴', USD: '$', EUR: '€' }

/** Як у застосунку (src/lib/money.ts): вузький пробіл у розрядах, копійки лише ненульові й завжди двома цифрами. */
export function money(minor: number, currency = 'UAH'): string {
  const abs = Math.abs(minor)
  const whole = Math.floor(abs / 100).toLocaleString('uk-UA').replace(/\s/g, '\u202F')
  const cents = abs % 100
  return `${minor < 0 ? '−' : ''}${whole}${cents ? ',' + String(cents).padStart(2, '0') : ''} ${SYMBOL[currency] ?? currency}`
}

export function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10, m100 = n % 100
  if (m10 === 1 && m100 !== 11) return one
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few
  return many
}
