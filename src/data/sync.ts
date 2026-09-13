import { cloud } from './supabase'
import { ENTITIES } from './cloud-map'
import type { DB, Member, Rates } from './types'

/* eslint-disable @typescript-eslint/no-explicit-any */

const idOf = (e: (typeof ENTITIES)[number], x: any): string =>
  e.idOf ? e.idOf(x) : (x.id as string)

/** Тягне все, що належить дому. Порядок не важливий — читання. */
export async function pullAll(householdId: string): Promise<Partial<DB>> {
  const db = cloud()
  const out: Record<string, unknown[]> = {}

  await Promise.all(ENTITIES.map(async e => {
    const { data, error } = await db
      .from(e.table).select(e.columns).eq('household_id', householdId)
    if (error) throw new Error(`${e.table}: ${error.message}`)
    out[e.key] = (data ?? []).map(r => e.fromRow(r as any))
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
 * Порядок ENTITIES важливий — батьки перед дітьми, інакше зовнішні ключі.
 */
export async function pushDiff(before: DB, after: DB, householdId: string): Promise<void> {
  const db = cloud()

  for (const e of ENTITIES) {
    const prev = new Map((before[e.key] as any[] ?? []).map(x => [idOf(e, x), x]))
    const next = new Map((after[e.key] as any[] ?? []).map(x => [idOf(e, x), x]))

    const upserts: any[] = []
    for (const [k, v] of next) {
      const old = prev.get(k)
      if (!old || JSON.stringify(old) !== JSON.stringify(v)) upserts.push(e.toRow(v, householdId))
    }
    if (upserts.length) {
      const { error } = await db.from(e.table)
        .upsert(upserts, e.onConflict ? { onConflict: e.onConflict } : undefined)
      if (error) throw new Error(`${e.table} upsert: ${error.message}`)
    }

    // Складений ключ — видалення там не буває: setPlanned лише вставляє й оновлює
    if (e.onConflict) continue

    const gone = [...prev.keys()].filter(k => !next.has(k))
    if (gone.length) {
      const { error } = await db.from(e.table).delete().in('id', gone)
      if (error) throw new Error(`${e.table} delete: ${error.message}`)
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
  if (error) throw new Error(`fx_rates: ${error.message}`)
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
      if (error) throw new Error(`household_members: ${error.message}`)
    }
    if (m.id === meId && old && old.name !== m.name) {
      const { error } = await db.from('profiles')
        .update({ display_name: m.name }).eq('id', meId)
      if (error) throw new Error(`profiles: ${error.message}`)
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
