import { cloud } from './supabase'
import { ENTITIES } from './cloud-map'
import type { DB } from './types'

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
