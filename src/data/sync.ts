import { cloud } from './supabase'
import { ENTITIES } from './cloud-map'
import type { DB, Member, Rates } from './types'

/* eslint-disable @typescript-eslint/no-explicit-any */

type Row = Record<string, unknown>

const idOf = (e: (typeof ENTITIES)[number], x: any): string =>
  e.idOf ? e.idOf(x) : (x.id as string)

/**
 * Відмова бази відрізняється від збою мережі.
 *
 * Мережа впала — зміна чекає й поїде пізніше. База відхилила (обмеження,
 * RLS, кривий uuid) — повтор нічого не дасть, і якщо лишити таку зміну
 * в голові черги, за нею назавжди застрягне все інше. Тому постійні
 * помилки черга викидає, а стан підтягує з бази.
 */
export class SyncError extends Error {
  constructor(message: string, readonly permanent: boolean) { super(message) }
}

function fail(where: string, error: { message: string; code?: string }): SyncError {
  const code = error.code ?? ''
  // без коду — fetch не дійшов; 08/53/57 — зʼєднання, ресурси, таймаут;
  // PGRST3xx — прострочений токен, який сесія оновить сама
  const transient = !code || /^(08|53|57|PGRST3)/.test(code)
  return new SyncError(`${where}: ${error.message}`, !transient)
}

const PAGE = 1000

/**
 * Тягне все, що належить дому.
 *
 * Сторінками: Supabase віддає не більше 1000 рядків за запит і мовчить,
 * що обрізав. Без пагінації через кілька місяців записів баланси фондів
 * і факт по конвертах тихо брехали б, а materialize «догенеровував» би
 * платежі, яких просто не побачив, і затирав ними оплачені.
 */
export async function pullAll(householdId: string): Promise<Partial<DB>> {
  const db = cloud()
  const out: Record<string, unknown[]> = {}

  await Promise.all(ENTITIES.map(async e => {
    const rows: unknown[] = []
    // стабільний порядок, інакше сторінки перекриваються й губляться рядки
    const order = e.onConflict ? e.onConflict.split(',') : ['id']
    for (let from = 0; ; from += PAGE) {
      let q = db.from(e.table).select(e.columns)
        .eq('household_id', householdId)
        .is('deleted_at', null)          // поховані не повертаємо
      for (const col of order) q = q.order(col)
      const { data, error } = await q.range(from, from + PAGE - 1)
      if (error) throw fail(e.table, error)
      rows.push(...(data ?? []).map(r => e.fromRow(r as any)))
      if (!data || data.length < PAGE) break
    }
    out[e.key] = rows
  }))

  return out as Partial<DB>
}

/**
 * Відправляє різницю між двома станами.
 *
 * Порівнюємо знімки, а не перехоплюємо кожну дію: дій у застосунку
 * під сорок, і кожну довелось би не забути. Знімок ловить усе, включно
 * з тим, що materialize() дописав сам.
 *
 * Змінений рядок їде ЛИШЕ зміненими колонками. Повний upsert із пристрою,
 * який пропустив зміни партнера, перезаписав би їх: я поміняв нотатку —
 * і оплата, яку партнер щойно поставив, повернулась у «до оплати».
 *
 * Порядок ENTITIES важливий — батьки перед дітьми, інакше зовнішні ключі.
 */
export async function pushDiff(before: DB, after: DB, householdId: string): Promise<void> {
  const db = cloud()

  for (const e of ENTITIES) {
    const prev = new Map((before[e.key] as any[] ?? []).map(x => [idOf(e, x), x]))
    const next = new Map((after[e.key] as any[] ?? []).map(x => [idOf(e, x), x]))

    const inserts: Row[] = []
    const updates: { id: string; full: Row; patch: Row }[] = []

    for (const [k, v] of next) {
      const old = prev.get(k)
      if (old && JSON.stringify(old) === JSON.stringify(v)) continue
      const row = e.toRow(v, householdId)
      if (!old) {
        // Новий для цього пристрою рядок — живий. deleted_at: null повертає
        // рядок, який колись поховали з тим самим id: внески фонду після
        // «вимкнути-увімкнути нагадування» генеруються з тими самими stableId.
        inserts.push(e.onConflict ? row : { ...row, deleted_at: null })
        continue
      }
      const was = e.toRow(old, householdId)
      const patch: Row = {}
      for (const col of Object.keys(row)) {
        if (JSON.stringify(row[col]) !== JSON.stringify(was[col])) patch[col] = row[col]
      }
      // «Заплановано» → «до оплати» — лише наслідок календаря, materialize
      // робить це на кожному пристрої сам. Відправляти не треба: так застарілий
      // пристрій не поверне в «до оплати» платіж, який партнер уже оплатив.
      if (patch.status === 'due' && was.status === 'projected') delete patch.status
      if (Object.keys(patch).length) updates.push({ id: k, full: row, patch })
    }

    if (inserts.length) {
      const { error } = await db.from(e.table)
        .upsert(inserts, e.onConflict ? { onConflict: e.onConflict } : undefined)
      if (error) throw fail(`${e.table} insert`, error)
    }

    for (const u of updates) {
      if (e.onConflict) {
        // складений ключ і три колонки — повний рядок тут і є патч
        const { error } = await db.from(e.table).upsert(u.full, { onConflict: e.onConflict })
        if (error) throw fail(`${e.table} upsert`, error)
        continue
      }
      const { data, error } = await db.from(e.table).update(u.patch).eq('id', u.id).select('id')
      if (error) throw fail(`${e.table} update`, error)
      // рядка в базі немає (не доїхав колись раніше) — тоді вставляємо повністю
      if (!data?.length) {
        const { error: err2 } = await db.from(e.table).upsert({ ...u.full, deleted_at: null })
        if (err2) throw fail(`${e.table} upsert`, err2)
      }
    }

    // Складений ключ — видалення там не буває: setPlanned лише вставляє й оновлює
    if (e.onConflict) continue

    // Не DELETE, а мітка. Фізичне видалення НЕ доїжджає до іншого пристрою:
    // там рядок просто лишається, і наступне перетягування його воскрешає.
    // Могила ж приїде як звичайна зміна і зникне з вибірки.
    const gone = [...prev.keys()].filter(k => !next.has(k))
    if (gone.length) {
      const { error } = await db.from(e.table)
        .update({ deleted_at: new Date().toISOString() })
        .in('id', gone)
      if (error) throw fail(`${e.table} delete`, error)
    }
  }
}

/* ───────────────────────── курси ───────────────────────── */

const CCY = ['USD', 'EUR'] as const

/** Найсвіжіший курс кожної валюти. fx_rates спільна: курс — не налаштування сімʼї. */
export async function pullRates(): Promise<Partial<Rates>> {
  const { data, error } = await cloud()
    .from('fx_rates')
    .select('base_ccy, rate, rate_date')
    .eq('quote_ccy', 'UAH')
    .in('base_ccy', CCY as unknown as string[])
    .order('rate_date', { ascending: false })
  if (error || !data) return {}

  const out: Partial<Rates> = {}
  for (const r of data) {
    const c = r.base_ccy as keyof Rates
    if (out[c] === undefined) out[c] = Number(r.rate)   // перший = найсвіжіший
  }
  return out
}

export async function pushRates(before: Rates, after: Rates): Promise<void> {
  const today = new Date().toISOString().slice(0, 10)
  const rows = CCY
    .filter(c => before[c] !== after[c])
    .map(c => ({ base_ccy: c, quote_ccy: 'UAH', rate_date: today, rate: after[c], source: 'manual' }))
  if (!rows.length) return

  const { error } = await cloud()
    .from('fx_rates').upsert(rows, { onConflict: 'base_ccy,quote_ccy,rate_date' })
  if (error) throw fail('fx_rates', error)
}

/* ───────────────────────── учасники ───────────────────────── */

/**
 * Колір пишемо в household_members — його можна міняти будь-кому в домі.
 * Імʼя живе в profiles, і profiles_update дозволяє правити ТІЛЬКИ свій
 * профіль. Тому чуже імʼя — тільки для читання, і інтерфейс це показує.
 */
export async function pushMembers(
  before: Member[], after: Member[], householdId: string, meId: string,
): Promise<void> {
  const db = cloud()
  const prev = new Map(before.map(m => [m.id, m]))

  for (const m of after) {
    const old = prev.get(m.id)
    if (old && old.color === m.color && old.name === m.name) continue

    if (!old || old.color !== m.color) {
      const { error } = await db.from('household_members')
        .update({ color: m.color })
        .eq('household_id', householdId).eq('profile_id', m.id)
      if (error) throw fail('household_members', error)
    }
    if (m.id === meId && old && old.name !== m.name) {
      const { error } = await db.from('profiles')
        .update({ display_name: m.name }).eq('id', meId)
      if (error) throw fail('profiles', error)
    }
  }
}

/* ───────────────────────── реалтайм ───────────────────────── */

/**
 * Слухає зміни в домі й кличе onChange.
 *
 * Свідомо НЕ застосовуємо прилетілий рядок точково: подія може прийти
 * посеред нашої власної відправки, і часткове накладання дало б стан,
 * якого не було ні в кого. Замість цього просто перетягуємо все —
 * запит дешевий, а результат завжди цілісний.
 *
 * Зміни, зроблені нами самими, теж повертаються луною. Відсіювати їх
 * за автором не можна: не всі таблиці мають автора. Тому просто
 * перетягуємо — зайвий раз, але без розбіжностей.
 */
export function watchHousehold(householdId: string, onChange: () => void): () => void {
  const db = cloud()
  const channel = db.channel(`household:${householdId}`)

  for (const e of ENTITIES) {
    channel.on(
      'postgres_changes' as any,
      { event: '*', schema: 'public', table: e.table, filter: `household_id=eq.${householdId}` },
      onChange,
    )
  }

  channel.subscribe()
  return () => { void db.removeChannel(channel) }
}
