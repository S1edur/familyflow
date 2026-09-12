import { useSyncExternalStore } from 'react'
import type { DB } from './types'

/**
 * Черга відправки.
 *
 * Досі відправка була «випустив і забув»: упав запит — помилка в консоль,
 * і зміна лишалась тільки в цьому браузері. Назавжди, навіть коли мережа
 * поверталась. Тобто офлайну не було, було тихе псування даних.
 *
 * Черга зберігає ЗНІМКИ «до» і «після» для кожної зміни. Саме знімки, а не
 * список операцій: pushDiff і так працює різницею, тож черга не потребує
 * власної мови опису змін і не розійдеться з нею.
 */
export interface Pending {
  id: number
  before: DB
  after: DB
  at: string
}

const KEY = 'ff.queue'
const MAX = 200            // глибше — це вже не затримка мережі, а зламаний пристрій

let items: Pending[] = load()
let seq = items.length ? Math.max(...items.map(i => i.id)) : 0
const listeners = new Set<() => void>()

function load(): Pending[] {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Pending[]) : []
  } catch { return [] }
}

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(items)) } catch { /* приватний режим або переповнення */ }
  listeners.forEach(l => l())
}

export const queueSize = () => items.length
export const subscribeQueue = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }

export function enqueue(before: DB, after: DB) {
  items.push({ id: ++seq, before, after, at: new Date().toISOString() })
  // найстаріші відкидаємо: сенсу тримати сотні знімків немає, вони все одно
  // накладаються один на одного і наступна повна синхронізація їх вирівняє
  if (items.length > MAX) items = items.slice(-MAX)
  save()
}

export function peek(): Pending | undefined { return items[0] }

export function drop(id: number) {
  items = items.filter(i => i.id !== id)
  save()
}

export function clearQueue() { items = []; save() }

/** Скільки змін чекає — для індикатора в інтерфейсі. */
export function usePendingCount(): number {
  return useSyncExternalStore(subscribeQueue, queueSize, queueSize)
}
