import { useSyncExternalStore } from 'react'
import type {
  DB, Occurrence, Task, Currency, EntryKind, ID, Priority,
  Project, ProjectStatus, RecurringPlan, TaskTemplate, Member, Rates,
} from './types'
import { emptyDB, seed } from './seed'
import { notifyAssigned } from './push'
import {
  addDays, clampDayOfMonth, iso, isoDow, monthKey, monthsUntil, parse, relativeDue, today,
} from '../lib/dates'
import { money, toBase } from '../lib/money'
import { SyncError, pullAll, pullRates, pushDiff, pushMembers, pushRates, watchHousehold } from './sync'
import { toast } from '../ui/Toast'
import { drop, enqueue, peek, queueSize, clearQueue } from './queue'

/*
 * v2 — модель «усе проєкти». Дані v1 (конверти, фонди, борги) сюди не
 * переносяться: у локальному режимі це демо, а в хмарі їх переніс
 * sql/14_projects.sql, і дім однаково перетягується з бази при вході.
 */
const KEY = 'familyflow.v2'
const OLD_KEYS = ['familyflow.v1']
const HORIZON_MONTHS = 13
const TASK_HORIZON_DAYS = 7

let db: DB = init()
const listeners = new Set<() => void>()

function init(): DB {
  try {
    // Черга старого формату містить знімки з конвертами — у нову схему їх
    // не відправити, тож прибираємо разом зі старим сховищем.
    if (OLD_KEYS.some(k => localStorage.getItem(k) !== null)) {
      OLD_KEYS.forEach(k => localStorage.removeItem(k))
      clearQueue()
    }
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as DB
      if (Array.isArray(parsed.projects)) return materialize(parsed)
    }
  } catch { /* впав парсинг — починаємо з чистого */ }
  return materialize(seed())
}

function emit() {
  try { localStorage.setItem(KEY, JSON.stringify(db)) } catch { /* приватний режим */ }
  listeners.forEach(l => l())
}

/** Дім, до якого привʼязане сховище. null — режим без входу, тільки локально. */
let householdId: ID | null = null

/** Останнє повідомлення про невдалу відправку — щоб не сипати однаковими. */
let lastPushError = ''
let draining = false

function push(before: DB) {
  if (!householdId) return
  enqueue(before, db)
  void drain()
}

/**
 * Спорожнює чергу по одному, СТРОГО по порядку: пізніша зміна може
 * спиратись на ранішу, тож паралельна відправка переплутала б їх.
 *
 * Збій мережі зупиняє прохід — решта чекає наступної спроби. Відмова бази
 * (обмеження, права, кривий id) — ні: повтор нічого не дасть, а застрягла
 * зміна назавжди заблокувала б усі наступні й зміни партнера теж. Таку
 * викидаємо, кажемо про це людині й підтягуємо стан із бази.
 */
export async function drain(): Promise<void> {
  if (draining || !householdId) return
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return
  draining = true
  const h = householdId
  let rejected = false
  try {
    for (let item = peek(); item; item = peek()) {
      try {
        await pushDiff(item.before, item.after, h)
        await pushMembers(item.before.members, item.after.members, h, item.after.meId)
        await pushRates(item.before.rates, item.after.rates)
        drop(item.id)
        lastPushError = ''
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        if (e instanceof SyncError && e.permanent) {
          console.error('База відхилила зміну, прибираю з черги:', msg)
          drop(item.id)
          rejected = true
          continue
        }
        if (msg !== lastPushError) {
          lastPushError = msg
          console.error(`Зміни чекають на відправку (${queueSize()}):`, msg)
        }
        break
      }
    }
  } finally {
    draining = false
  }
  if (rejected) {
    toast('Одну зміну не вдалося зберегти — показую, як записано в базі', { tone: 'warn' })
    void refresh(h)
  }
}

let lastRefresh = 0

if (typeof window !== 'undefined') {
  // Мережа повернулась або вкладку знову побачили: віддати своє і взяти чуже.
  // Realtime за час сну телефона події губить, тож без цього перетягування
  // застарілий пристрій працював би поверх старого стану.
  const wake = () => {
    if (!householdId) return
    if (Date.now() - lastRefresh < 15_000) { void drain(); return }
    lastRefresh = Date.now()
    void refresh(householdId)
  }
  window.addEventListener('online', wake)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') wake()
  })
}

export function mutate(fn: (d: DB) => void) {
  const before = db
  const next: DB = structuredClone(db)
  fn(next)
  db = materialize(next)
  emit()
  push(before)
}

const BOUND_KEY = 'ff.boundTo'

let unwatch: (() => void) | null = null
let refreshTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Перетягнути все з бази поверх локального.
 *
 * Не чіпає чергу: те, що в ній лежить, ще не доїхало, і його стан
 * тут не представлений. Тому спершу спорожнюємо чергу, а вже потім
 * приймаємо чужі зміни — інакше свіжа правка партнера затерла б нашу,
 * яка просто не встигла відправитись.
 */
async function refresh(id: ID) {
  await drain()
  if (queueSize() > 0) return          // щось не доїхало — не затираємо себе
  if (householdId !== id) return       // поки тягнули, змінився дім
  try {
    const [cloud, rates] = await Promise.all([pullAll(id), pullRates()])
    db = materialize({ ...db, ...cloud, rates: { ...db.rates, ...rates } })
    emit()
  } catch (e) {
    // не вийшло — лишаємось на тому, що є; наступне пробудження спробує знову
    console.error('Не вдалось оновити дані з бази:', e instanceof Error ? e.message : e)
  }
}

/**
 * Привʼязати сховище до справжнього дому.
 *
 * Якщо браузер ще не бачив цього дому — демо-дані стираються начисто.
 * Інакше сідові витрати й задачі змішались би зі справжніми, і потім
 * не розібрати, де що. Користувач починає з порожнього, як і домовились:
 * шаблон — це конверти, створені разом із домом у базі.
 *
 * Той самий механізм спрацьовує при зміні акаунта: інший дім — інші дані.
 */
export async function bindHousehold(id: ID, members: Member[], meId: ID) {
  let bound: string | null = null
  try { bound = localStorage.getItem(BOUND_KEY) } catch { /* приватний режим */ }

  // Інший дім, ніж бачив цей браузер → демо-дані геть, щоб не змішувались
  if (bound !== id) {
    db = { ...emptyDB(), members, meId }
    clearQueue()   // черга належала попередньому дому — у новий їй не можна
    try { localStorage.setItem(BOUND_KEY, id) } catch { /* приватний режим */ }
  }

  // Спершу віддати те, що не доїхало минулої сесії. Інакше перетягування
  // затерло б власні зміни, які просто чекали в черзі на мережу.
  householdId = id

  // Підписка — ДО першого перетягування: якщо воно впаде, зміни партнера
  // однаково розбудять refresh, і дані підтягнуться, щойно мережа оживе.
  // Події збираємо в пачку: одна дія партнера — це кілька рядків у кількох
  // таблицях, і тягнути на кожен означало б десяток запитів замість одного.
  unwatch?.()
  unwatch = watchHousehold(id, () => {
    if (refreshTimer) clearTimeout(refreshTimer)
    refreshTimer = setTimeout(() => { void refresh(id) }, 400)
  })

  await drain()

  const [cloud, rates] = await Promise.all([pullAll(id), pullRates()])
  // Прийняте з бази ставимо НАПРЯМУ, без mutate: інакше відправили б назад
  // те, що щойно звідти приїхало.
  const pulled: DB = { ...db, ...cloud, members, meId, rates: { ...db.rates, ...rates } }

  // materialize міг догенерувати платежі й задачі — ось їх відправити треба
  const withGenerated = materialize(structuredClone(pulled))
  db = withGenerated
  emit()

  lastRefresh = Date.now()

  // Згенероване — через чергу, як будь-яка зміна: з повтором при збої мережі
  // і з відсіюванням того, що база відхилить.
  enqueue(pulled, withGenerated)
  void drain()
}

/**
 * Відвʼязати сховище від дому: вихід з акаунта або «покинути дім».
 * Черга й локальні дані належали тому дому — у наступний їм не можна.
 */
export function unbindHousehold() {
  unwatch?.()
  unwatch = null
  if (refreshTimer) clearTimeout(refreshTimer)
  householdId = null
  clearQueue()
  try { localStorage.removeItem(BOUND_KEY) } catch { /* приватний режим */ }
  db = materialize(emptyDB())
  emit()
}

/** Сховище привʼязане до дому в Supabase. */
export const isBound = () => householdId !== null

/**
 * Демо-дані заново — лише в локальному режимі. У привʼязаному домі seed
 * приніс би id на кшталт «e0», які база відхиляє як нечинні uuid, а справжні
 * дані в базі однаково лишились би.
 */
export function resetAll() {
  if (householdId) return
  db = materialize(seed())
  emit()
}

export function useDB(): DB {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l) },
    () => db,
    () => db,
  )
}

// function declaration, а не const: викликається з materialize() ще до цього рядка
/**
 * Стабільний ідентифікатор для того, що ГЕНЕРУЄТЬСЯ, а не створюється людиною.
 *
 * Платежі й задачі народжуються з правил на кожному пристрої окремо. З
 * випадковими id твій телефон і телефон партнера створили б для однієї
 * оренди два різні рядки — і другий розбився б об unique(plan, due_date).
 * Тому id виводиться з самого ключа: обидва пристрої отримують однаковий,
 * і повторна відправка нічого не дублює.
 */
export function stableId(seed: string): ID {
  let h1 = 0x811c9dc5, h2 = 0x01000193, h3 = 0x9e3779b9, h4 = 0x85ebca6b
  for (let i = 0; i < seed.length; i++) {
    const c = seed.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 16777619)
    h2 = Math.imul(h2 ^ c, 2246822519)
    h3 = Math.imul(h3 ^ c, 3266489917)
    h4 = Math.imul(h4 ^ c, 668265263)
  }
  const hex = (n: number) => (n >>> 0).toString(16).padStart(8, '0')
  const raw = hex(h1) + hex(h2) + hex(h3) + hex(h4)
  // форма uuid v4, щоб Postgres прийняв як uuid
  return [
    raw.slice(0, 8), raw.slice(8, 12),
    '4' + raw.slice(13, 16),
    ((parseInt(raw[16], 16) & 0x3) | 0x8).toString(16) + raw.slice(17, 20),
    raw.slice(20, 32),
  ].join('-')
}

export function uid() {
  // Справжній uuid, а не вісім випадкових символів: той самий ідентифікатор
  // має годитись і локально, і як первинний ключ у Postgres. Інакше кожен
  // створений на пристрої рядок не вставився б у базу.
  return crypto.randomUUID()
}

/* ───────────────────────── генерація ───────────────────────── */

/** Ідемпотентна: ключ (planId, dueDate). Виклик скільки завгодно разів. */
function materialize(d: DB): DB {
  const t = today()
  const from = parse(t.slice(0, 8) + '01')
  const horizon = new Date(from); horizon.setMonth(horizon.getMonth() + HORIZON_MONTHS)

  const existing = new Set(d.occurrences.filter(o => o.planId).map(o => `${o.planId}|${o.dueDate}`))

  for (const p of d.recurringPlans) {
    if (!p.active) continue
    for (const date of expandDates(p.freq, p.byMonthDay, p.byDay, p.byMonth, p.anchorDate, iso(from), iso(horizon))) {
      const k = `${p.id}|${date}`
      if (existing.has(k)) continue
      existing.add(k)
      d.occurrences.push({
        id: stableId(`occ:${p.id}:${date}`), planId: p.id, projectId: p.projectId, name: p.name,
        dueDate: date, expectedMinor: p.expectedMinor, currency: p.currency,
        status: date <= t ? 'due' : 'projected', assigneeId: p.assigneeId,
      })
    }
  }
  for (const o of d.occurrences) {
    if (o.status === 'projected' && o.dueDate <= t) o.status = 'due'
  }

  // задачі з шаблонів
  const taskKeys = new Set(d.tasks.filter(x => x.templateId).map(x => `${x.templateId}|${x.occurrenceKey}`))
  for (const tpl of d.taskTemplates) {
    if (!tpl.active) continue
    const who = tpl.rotation === 'least_loaded' ? leastLoaded(d) : tpl.defaultAssigneeId

    if (tpl.scheduleKind === 'after_completion') {
      // рівно ОДИН відкритий екземпляр → прострочення не накопичуються
      const open = d.tasks.some(x => x.templateId === tpl.id && x.status !== 'done' && x.status !== 'dropped')
      if (!open) {
        // день виконання — за місцевим календарем: slice(0, 10) дав би дату в UTC,
        // і виконане між північчю й третьою ночі за Києвом зсунулось би на день назад
        const done = tpl.lastCompletedAt ? iso(new Date(tpl.lastCompletedAt)) : t
        const due = addDays(done, tpl.intervalDays ?? 7)
        pushTask(d, tpl.id, due, tpl, who, taskKeys)
      }
    } else {
      for (const date of expandDates(tpl.freq ?? 'weekly', tpl.byMonthDay, tpl.byDay, undefined, t, t, addDays(t, TASK_HORIZON_DAYS))) {
        pushTask(d, tpl.id, date, tpl, who, taskKeys)
      }
    }
  }
  return d
}

function pushTask(d: DB, templateId: ID, due: string, tpl: DB['taskTemplates'][number], who: ID | undefined, keys: Set<string>) {
  const k = `${templateId}|${due}`
  if (keys.has(k)) return
  keys.add(k)
  d.tasks.push({
    id: stableId(`task:${templateId}:${due}`), templateId, occurrenceKey: due, title: tpl.title, area: tpl.area,
    status: 'todo', priority: 0, effort: tpl.effort, assigneeId: who,
    dueDate: due, createdBy: who ?? d.meId, createdAt: new Date().toISOString(),
  })
}

/** Вага походу в тій самій шкалі 1–3, що й effort задачі. Похідна з кількості позицій. */
function tripWeight(d: DB, tripId: ID): 1 | 2 | 3 {
  const n = d.shoppingItems.filter(i => i.tripId === tripId).length
  return n >= 13 ? 3 : n >= 5 ? 2 : 1
}

/** Товари, які ще не куплені. null — якщо в магазин іти нема за чим. */
export function shoppingPending(d: DB): { count: number; allChecked: boolean } | null {
  const inList = d.shoppingItems.filter(i => !i.tripId)
  if (!inList.length) return null
  return { count: inList.length, allChecked: inList.every(i => i.checkedAt) }
}

/** Хто менше закрив за 28 днів — самокорекція замість жорсткої черги. */
function leastLoaded(d: DB): ID | undefined {
  const since = addDays(today(), -28)
  const load = new Map<ID, number>()
  d.members.forEach(m => load.set(m.id, 0))
  const add = (id: ID | undefined, n: number) => {
    if (id && load.has(id)) load.set(id, (load.get(id) ?? 0) + n)
  }
  for (const t of d.tasks) {
    if (t.status === 'done' && t.completedBy && t.completedAt && t.completedAt.slice(0, 10) >= since) {
      add(t.completedBy, t.effort)
    } else if (t.status !== 'done' && t.status !== 'dropped' && t.assigneeId) {
      // відкриті теж вважаємо навантаженням, інакше при рівному рахунку все падає на першого
      add(t.assigneeId, t.effort)
    }
  }
  // похід у магазин і оплата рахунків — така сама робота, і досі вона не рахувалась
  for (const tr of d.trips) {
    if (tr.completedAt.slice(0, 10) >= since) add(tr.shoppedBy, tripWeight(d, tr.id))
  }
  for (const o of d.occurrences) {
    if (o.status === 'paid' && o.paidOn && o.paidOn >= since) add(o.paidBy, 1)
  }
  return [...load.entries()].sort((a, b) => a[1] - b[1])[0]?.[0]
}

function expandDates(
  freq: string, byMonthDay: number | undefined, byDay: number[] | undefined,
  byMonth: number | undefined, anchor: string, from: string, to: string,
): string[] {
  const out: string[] = []
  const a = parse(anchor)
  // план не існував до своєї дати прив'язки, тож і платежів до неї бути не може.
  // Без цього щойно створений план «5 числа» одразу народжує прострочений платіж
  // за 5 число поточного місяця.
  const push = (date: string) => { if (date >= anchor) out.push(date) }

  if (freq === 'monthly' || freq === 'yearly') {
    const day = byMonthDay ?? a.getDate()
    const cur = parse(from.slice(0, 8) + '01')
    const end = parse(to)
    while (cur <= end) {
      const m1 = cur.getMonth() + 1
      const ok = freq === 'monthly' || m1 === (byMonth ?? a.getMonth() + 1)
      if (ok) {
        const dd = clampDayOfMonth(cur.getFullYear(), m1, day)
        const date = `${cur.getFullYear()}-${String(m1).padStart(2, '0')}-${String(dd).padStart(2, '0')}`
        if (date >= from && date <= to) push(date)
      }
      cur.setMonth(cur.getMonth() + 1)
    }
  } else if (freq === 'weekly') {
    const days = byDay?.length ? byDay : [isoDow(anchor)]
    for (let d = from; d <= to; d = addDays(d, 1)) {
      if (days.includes(isoDow(d))) push(d)
    }
  } else if (freq === 'daily') {
    for (let d = from; d <= to; d = addDays(d, 1)) push(d)
  }
  return out
}

/* ───────────────────────── похідні дані ───────────────────────── */
/* Нічого з цього не зберігається — усе рахується на читанні. */

/* ─────────── проєкти: куди лягають гроші ───────────
 *
 * Два види «кишень», у яких гроші лежать: «Вільні гроші» і проєкти
 * «накопичувати». Проєкти «витрачати» й «повертати» грошей не тримають —
 * вони кажуть, НА ЩО пішло, а платять із вільних або з вибраного накопичення.
 * Тому баланс мають лише кишені, а в інших проєктів — факт проти орієнтира. */

/** Системний проєкт «Вільні гроші». У локальному режимі й до першого pull може бути відсутнім. */
export function freeProject(d: DB): Project | undefined {
  return d.projects.find(p => p.isFree && p.status !== 'archived')
}

const FREE = '__free__'

/** Кишеня, з якої або в яку йдуть гроші проєкту. */
function pocketOf(d: DB, projectId: ID | undefined): string {
  const p = projectId ? d.projects.find(x => x.id === projectId) : undefined
  if (!p || p.isFree) return FREE
  if (p.direction === 'save') return p.id
  return p.sourceProjectId ?? FREE
}

/** Зміна балансу кишень від одного запису, у базовій валюті. */
function pocketMoves(d: DB, e: DB['entries'][number]): [string, number][] {
  const v = e.amountBaseMinor
  switch (e.kind) {
    case 'income': return [[pocketOf(d, e.projectId), v]]
    case 'expense':
    case 'repay': return [[pocketOf(d, e.projectId), -v]]
    case 'transfer': return [[endOf(d, e.fromProjectId), -v], [endOf(d, e.projectId), v]]
  }
}

/** Кінець переказу: грошей можна покласти лише в накопичення, решта — вільні. */
function endOf(d: DB, projectId: ID | undefined): string {
  const p = projectId ? d.projects.find(x => x.id === projectId) : undefined
  return p && p.direction === 'save' && !p.isFree ? p.id : FREE
}

function pocketBalances(d: DB): Map<string, number> {
  const m = new Map<string, number>()
  for (const e of d.entries) {
    for (const [k, v] of pocketMoves(d, e)) m.set(k, (m.get(k) ?? 0) + v)
  }
  return m
}

/** Кінець переказу: id накопичення або `null` — «Вільні гроші». */
export function transferEnd(d: DB, projectId: ID | undefined): ID | null {
  const end = endOf(d, projectId)
  return end === FREE ? null : end
}

/**
 * Рух вільних грошей: надходження, відкладання й витрати без проєкту.
 * Витрати spend-проєктів теж беруться з вільних, але їхнє місце — у своїх
 * проєктах: інакше тут була б уся історія родини.
 */
export function freeEntries(d: DB) {
  const freeId = freeProject(d)?.id
  return d.entries.filter(e => {
    if (e.kind === 'transfer') return endOf(d, e.fromProjectId) === FREE || endOf(d, e.projectId) === FREE
    if (e.kind === 'income') return pocketOf(d, e.projectId) === FREE
    return !e.projectId || e.projectId === freeId
  }).sort((a, b) => b.occurredOn.localeCompare(a.occurredOn))
}

/** Скільки нікому не обіцяно просто зараз — баланс «Вільних грошей». */
export function freeBalance(d: DB): number {
  return pocketBalances(d).get(FREE) ?? 0
}

/** Сума підтвердження кожного оплаченого платежу в базовій валюті, із замороженим курсом. */
export function paidBaseByOccurrence(d: DB): Map<ID, number> {
  const m = new Map<ID, number>()
  for (const e of d.entries) if (e.occurrenceId) m.set(e.occurrenceId, e.amountBaseMinor)
  return m
}

/** Записи, що належать проєкту: витрати, погашення, надходження й перекази в нього або з нього. */
export function projectEntries(d: DB, projectId: ID) {
  return d.entries
    .filter(e => e.projectId === projectId || e.fromProjectId === projectId)
    .sort((a, b) => b.occurredOn.localeCompare(a.occurredOn))
}

export interface ProjectState {
  project: Project
  /** save: скільки лежить у проєкті (у валюті проєкту) */
  balance: number
  /** spend: витрачено за місяць; repay: сплачено за місяць; save: внесено за місяць */
  monthActual: number
  /** ще відкриті платежі проєкту в цьому місяці */
  monthOpen: number
  /** spend: витрачено за весь час */
  totalSpent: number
  /** save: ціль із запасом · spend: бюджет на весь час · repay: тіло */
  target?: number
  /** repay: скільки лишилось віддати */
  remaining?: number
  /** save/repay: скільки треба на місяць */
  required: number
  /** save: скільки ще відкласти цього місяця */
  toSetAside: number
  monthsLeft?: number
  /** 0..1 */
  progress: number
  /** save: чи встигаємо до дати; repay: чи закриємо до бажаної дати */
  onTrack: boolean
  /** repay: коли закриємо за такого платежу */
  payoff?: string
}

/**
 * Стан проєкту за місяць. Суми — у валюті проєкту для save/repay (баланс
 * фонду й залишок боргу не переоцінюються записом), у базовій для spend.
 */
export function projectStatus(d: DB, projectId: ID, month = monthKey(today())): ProjectState {
  const p = d.projects.find(x => x.id === projectId)!
  const inMonth = (on: string) => monthKey(on) === month

  let balance = 0, monthActual = 0, totalSpent = 0, paid = 0
  for (const e of d.entries) {
    const mine = e.projectId === projectId
    const out = e.fromProjectId === projectId
    if (!mine && !out) continue
    const own = e.currency === p.currency ? e.amountMinor : Math.round(e.amountBaseMinor / (p.currency === 'UAH' ? 1 : d.rates[p.currency]))
    if (p.direction === 'save') {
      if (e.kind === 'transfer' && mine) { balance += own; if (inMonth(e.occurredOn)) monthActual += own }
      else if (e.kind === 'transfer' && out) balance -= own
      else if (e.kind === 'income' && mine) balance += own
      else if ((e.kind === 'expense' || e.kind === 'repay') && mine) balance -= own
    } else if (p.direction === 'repay') {
      if (e.kind === 'repay' && mine) { paid += own; if (inMonth(e.occurredOn)) monthActual += own }
    } else if (mine && (e.kind === 'expense' || e.kind === 'repay')) {
      totalSpent += e.amountBaseMinor
      if (inMonth(e.occurredOn)) monthActual += e.amountBaseMinor
    }
  }

  const monthOpen = d.occurrences
    .filter(o => o.projectId === projectId && monthKey(o.dueDate) === month
      && (o.status === 'due' || o.status === 'projected'))
    .reduce((s, o) => s + (p.direction === 'spend'
      ? toBase(o.expectedMinor, o.currency, d.rates) : o.expectedMinor), 0)

  const monthsLeft = p.endsOn ? monthsUntil(p.endsOn) : undefined
  let target: number | undefined
  let remaining: number | undefined
  let required = 0, progress = 0, onTrack = true
  let payoff: string | undefined

  if (p.direction === 'save') {
    target = p.targetMinor ? Math.round(p.targetMinor * (1 + (p.bufferPct ?? 0) / 100)) : undefined
    // Від балансу на ПОЧАТОК місяця: інакше внесок цього місяця зменшував би
    // саму норму, і після внеску рядок показував би «внесено 978 з 870».
    const balanceAtStart = balance - monthActual
    required = p.monthlyMinor
      ?? (target ? Math.max(0, Math.ceil((target - balanceAtStart) / (monthsLeft ?? 1) / 100) * 100) : 0)
    progress = target ? Math.min(1, Math.max(0, balance / target)) : 0
    // Темп міряємо від початку ПОТОЧНОГО циклу: остання витрата з накопичення,
    // а якщо витрат не було — перший внесок. Інакше щойно спорожнілий після
    // виплати проєкт одразу «відстає» від внесків дворічної давнини.
    const mine = d.entries.filter(e => e.projectId === projectId || e.fromProjectId === projectId)
    const lastOut = mine.filter(e => e.kind === 'expense' || e.fromProjectId === projectId)
      .map(e => e.occurredOn).sort().pop()
    const firstIn = mine.filter(e => e.kind === 'transfer' && e.projectId === projectId)
      .map(e => e.occurredOn).sort()[0]
    const cycleStart = lastOut ?? firstIn ?? p.startsOn
    const span = cycleStart && p.endsOn ? monthsUntil(p.endsOn, cycleStart) : 0
    const elapsed = span > 0 && monthsLeft ? Math.max(0, Math.min(1, 1 - (monthsLeft - 1) / span)) : 0
    // ще жодного внеску → нічого не почалось, докоряти нема за що
    onTrack = !target || balance >= target * elapsed
  } else if (p.direction === 'repay') {
    target = p.targetMinor
    remaining = Math.max(0, (p.targetMinor ?? 0) - paid)
    required = p.monthlyMinor ?? (remaining && monthsLeft ? Math.ceil(remaining / monthsLeft / 100) * 100 : 0)
    progress = p.targetMinor ? Math.min(1, paid / p.targetMinor) : 0
    if (p.monthlyMinor && remaining > 0) {
      const dt = parse(today()); dt.setMonth(dt.getMonth() + Math.ceil(remaining / p.monthlyMinor))
      payoff = iso(dt)
    }
    onTrack = !p.endsOn || !payoff || payoff <= p.endsOn
  } else if (p.direction === 'spend') {
    target = p.targetMinor
    // факт spend-проєкту в базовій валюті — орієнтир зводимо туди ж
    const whole = !!p.targetMinor && !p.monthlyMinor
    const guide = toBase((whole ? p.targetMinor : p.monthlyMinor) ?? 0, p.currency, d.rates)
    progress = guide ? (whole ? totalSpent : monthActual) / guide : 0
  }

  const toSetAside = p.direction === 'save' ? Math.max(0, required - monthActual) : 0
  return { project: p, balance, monthActual, monthOpen, totalSpent, target, remaining, required, toSetAside, monthsLeft, progress, onTrack, payoff }
}

/** Платіж правила-надходження (зарплата): «Отримано», а не «Оплачено». */
export function isIncomeOccurrence(d: DB, o: Occurrence): boolean {
  if (!o.planId) return false
  return d.recurringPlans.find(p => p.id === o.planId)?.flow === 'in'
}

/**
 * Місяць — агрегатор, не сутність: що мало й має статися з усіма проєктами.
 * Усі суми в базовій валюті.
 */
export function monthView(d: DB, month: string) {
  const t = today()
  const current = monthKey(t)
  const live = d.projects.filter(p => p.status === 'active' && !p.isFree)
  const states = live.map(p => projectStatus(d, p.id, month))
  const base = (minor: number, c: Currency) => toBase(minor, c, d.rates)

  const income = d.entries
    .filter(e => e.kind === 'income' && monthKey(e.occurredOn) === month)
    .reduce((s, e) => s + e.amountBaseMinor, 0)

  const occ = d.occurrences.filter(o => monthKey(o.dueDate) === month)
  const open = occ.filter(o => o.status === 'due' || o.status === 'projected')
  const incomeExpected = open.filter(o => isIncomeOccurrence(d, o))
    .reduce((s, o) => s + base(o.expectedMinor, o.currency), 0)
  const billsLeft = open.filter(o => !isIncomeOccurrence(d, o))
    .reduce((s, o) => s + base(o.expectedMinor, o.currency), 0)

  const spent = d.entries
    .filter(e => (e.kind === 'expense' || e.kind === 'repay') && monthKey(e.occurredOn) === month)
    .reduce((s, e) => s + e.amountBaseMinor, 0)
  const setAside = d.entries
    .filter(e => e.kind === 'transfer' && monthKey(e.occurredOn) === month
      && d.projects.find(p => p.id === e.projectId)?.direction === 'save')
    .reduce((s, e) => s + e.amountBaseMinor, 0)

  const toSetAside = states
    .filter(s => s.project.direction === 'save')
    .reduce((sum, s) => sum + base(s.toSetAside, s.project.currency), 0)

  // Ще очікуються витрати з вільних: для кожного spend/repay без свого
  // джерела — більше з «орієнтир» і «факт + відкриті платежі», мінус факт.
  // Відкриті платежі й орієнтир не додаються двічі.
  const expectedSpend = states
    .filter(s => (s.project.direction === 'spend' || s.project.direction === 'repay') && !s.project.sourceProjectId)
    .reduce((sum, s) => {
      const actual = s.project.direction === 'spend' ? s.monthActual : base(s.monthActual, s.project.currency)
      const openB = s.project.direction === 'spend' ? s.monthOpen : base(s.monthOpen, s.project.currency)
      const guide = s.project.direction === 'repay'
        ? base(s.required, s.project.currency)
        : s.project.monthlyMinor ?? 0
      return sum + Math.max(guide, actual + openB) - actual
    }, 0)
  // Разові платежі поза проєктами з орієнтиром теж очікуються
  const looseOpen = open
    .filter(o => !isIncomeOccurrence(d, o))
    .filter(o => {
      const p = d.projects.find(x => x.id === o.projectId)
      return !p || p.isFree || p.status !== 'active'
    })
    .reduce((s, o) => s + base(o.expectedMinor, o.currency), 0)

  const freeNow = freeBalance(d)
  // Прогноз — лише для поточного місяця: для майбутніх він ігнорував би все,
  // що ще станеться до них, і показував би впевнену, але вигадану цифру
  const forecast = month === current
    ? freeNow + incomeExpected - expectedSpend - looseOpen - toSetAside
    : undefined

  return {
    states, income, incomeExpected, billsLeft, spent, setAside, toSetAside,
    freeNow, forecast,
    bills: occ.sort((a, b) => {
      const rank = (x: string) => (x === 'paid' || x === 'skipped' ? 1 : 0)
      return rank(a.status) - rank(b.status) || a.dueDate.localeCompare(b.dueDate)
    }),
  }
}

/**
 * Баланс навантаження за 28 днів. Рахує ТРИ джерела: виконані задачі,
 * походи в магазин і підтверджені платежі. shoppedBy і paidBy зберігались
 * і раніше — просто ніхто їх не читав, тож похід і оплата рахунків
 * не зараховувались нікому.
 */
export function fairness(d: DB) {
  const since = addDays(today(), -28)
  return d.members.map(m => {
    const tasks = d.tasks
      .filter(t => t.status === 'done' && t.completedBy === m.id && (t.completedAt ?? '').slice(0, 10) >= since)
      .reduce((s, t) => s + t.effort, 0)
    const trips = d.trips
      .filter(t => t.shoppedBy === m.id && t.completedAt.slice(0, 10) >= since)
      .reduce((s, t) => s + tripWeight(d, t.id), 0)
    const bills = d.occurrences
      .filter(o => o.status === 'paid' && o.paidBy === m.id && (o.paidOn ?? '') >= since)
      .length
    return {
      member: m,
      done: tasks + trips + bills,
      tasks, trips, bills,
      created: d.tasks.filter(t => t.createdBy === m.id && t.createdAt.slice(0, 10) >= since).length,
    }
  })
}

/* ───────────────────────── повідомлення ───────────────────────── */

export interface Notice {
  id: string
  text: string
  detail?: string
  at?: string            // мітка часу — лише в подій
  to: string             // куди веде тап
}

/**
 * Нічого не зберігаємо — перелік рахується на читанні (інваріант 4).
 *
 * Дві різні речі:
 *   fresh — ПОДІЇ: щось сталось, мають мітку часу, можуть бути «новими»;
 *   soon  — СТАН: що треба зробити найближчим часом. Воно не «нове», воно просто є.
 *
 * ПРАВИЛО, яке тут головне: «Ніколи не повідомляємо одному, що в другого
 * прострочено» (CLAUDE.md). Тому soon містить виключно СВОЇ справи —
 * призначені мені або вільні.
 */
export function notices(d: DB, since: string): { fresh: Notice[]; soon: Notice[] } {
  const t = today()
  const soonEdge = addDays(t, 2)
  const me = d.meId
  const name = (id?: ID) => d.members.find(m => m.id === id)?.name ?? 'Хтось'

  const fresh: Notice[] = []

  // мені щось призначили — і це зробив не я
  for (const x of d.tasks) {
    if (x.assigneeId !== me || x.createdBy === me) continue
    if (x.status === 'done' || x.status === 'dropped') continue
    if (x.createdAt <= since) continue
    // Безособове «призначено» замість «призначив/призначила»: рід із імені
    // не вгадується (Микола, Ілля), а відмінювати імена в коді не можна.
    fresh.push({
      id: `task:${x.id}`, at: x.createdAt, to: '/tasks',
      text: `Призначено вам: ${x.title}`,
      detail: name(x.createdBy),
    })
  }

  // партнер докинув у список покупок
  for (const i of d.shoppingItems) {
    if (i.tripId || i.addedBy === me || i.addedAt <= since) continue
    fresh.push({
      id: `shop:${i.id}`, at: i.addedAt, to: '/shopping',
      text: `Нове в покупках: ${i.name}${i.qty ? ' · ' + i.qty : ''}`,
      detail: name(i.addedBy),
    })
  }

  // Партнер оплатив платіж, який висів на мені. Саме для цього існує paidBy:
  // відповісти на «ти вже оплатив інтернет?» раніше, ніж його поставлять.
  // Про взаєморозрахунки мови немає — лише «вже зроблено, можна не думати».
  for (const o of d.occurrences) {
    if (o.status !== 'paid' || o.assigneeId !== me || !o.paidBy || o.paidBy === me) continue
    // Момент оплати дає лише updated_at із бази (paid_on — дата без часу).
    // Локально партнера немає, тож без нього подію просто не показуємо.
    const at = o.updatedAt
    if (!at || at <= since) continue
    fresh.push({
      id: `paid:${o.id}`, at, to: '/month',
      text: `Уже оплачено: ${o.name}`,
      detail: name(o.paidBy),
    })
  }

  fresh.sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''))

  const soon: Notice[] = []

  // мої задачі: прострочені й на найближчі дні
  for (const x of d.tasks) {
    if (x.status === 'done' || x.status === 'dropped') continue
    if (x.assigneeId && x.assigneeId !== me) continue        // чуже не показуємо
    if (!x.dueDate || x.dueDate > soonEdge) continue
    if (x.deferUntil && x.deferUntil > t) continue
    soon.push({
      id: `due:${x.id}`, to: '/tasks',
      text: x.title, detail: relativeDue(x.dueDate).label,
    })
  }

  // платежі: свої або нічиї
  for (const o of d.occurrences) {
    if (o.status !== 'due' && o.status !== 'projected') continue
    if (o.assigneeId && o.assigneeId !== me) continue
    if (o.dueDate > soonEdge) continue
    soon.push({
      id: `bill:${o.id}`, to: '/month',
      text: o.name, detail: `${relativeDue(o.dueDate).label} · ${money(o.expectedMinor, o.currency)}`,
    })
  }

  soon.sort((a, b) => a.text.localeCompare(b.text, 'uk'))
  return { fresh, soon }
}

/* ───────────────────────── дії ───────────────────────── */

/**
 * Підтвердити платіж. `false` — нічого не записано: платежу немає, він уже
 * оплачений, або суми немає (правило зі змінною сумою ще без жодної оплати).
 * Запис на 0 база відхиляє (amount_minor > 0), і одна така зміна зупинила б
 * відправку всієї черги — тож інтерфейс має спитати суму.
 */
export function confirmOccurrence(id: ID, amountMinor?: number, paidOn?: string): boolean {
  const o0 = db.occurrences.find(x => x.id === id)
  if (!o0 || o0.status === 'paid') return false
  if ((amountMinor ?? o0.expectedMinor) <= 0) return false
  mutate(d => {
    const o = d.occurrences.find(x => x.id === id)
    if (!o || o.status === 'paid') return
    const amt = amountMinor ?? o.expectedMinor
    const on = paidOn ?? today()
    const rate = o.currency === 'UAH' ? 1 : d.rates[o.currency]
    const plan = d.recurringPlans.find(p => p.id === o.planId)
    const project = d.projects.find(p => p.id === o.projectId)

    // Один платіж — один запис. Що він робить із грошима, каже проєкт:
    // надходження правила-доходу, погашення боргу або витрата. Витрата з
    // проєкту-накопичення сама зменшує його баланс — пари «витрата + списання
    // з фонду» більше немає.
    const kind: EntryKind = plan?.flow === 'in' ? 'income'
      : project?.direction === 'repay' ? 'repay'
      : 'expense'

    d.entries.push({
      id: uid(), kind, occurredOn: on, amountMinor: amt, currency: o.currency,
      rateToBase: rate, amountBaseMinor: Math.round(amt * rate),
      projectId: o.projectId, occurrenceId: o.id, note: o.name, createdBy: d.meId,
    })
    o.status = 'paid'; o.paidOn = on; o.actualMinor = amt; o.paidBy = d.meId

    // Регулярна виплата з накопичення (страховка раз на рік) завершила цикл —
    // дата цілі переїжджає на наступний такий платіж. Інакше після лютого
    // проєкт назавжди лишається з лютневою датою й вимагає весь залишок щомісяця.
    if (plan && project?.direction === 'save' && project.endsOn && kind === 'expense') {
      const next = expandDates(
        plan.freq, plan.byMonthDay, plan.byDay, plan.byMonth, plan.anchorDate,
        addDays(o.dueDate, 1), addDays(o.dueDate, 400),
      )[0]
      if (next) project.endsOn = next
    }

    // змінна сума → наступне очікування = медіана останніх шести
    if (plan?.amountMode === 'variable') {
      const past = d.occurrences
        .filter(x => x.planId === plan.id && x.status === 'paid' && x.actualMinor)
        .sort((a, b) => (b.paidOn ?? '').localeCompare(a.paidOn ?? ''))
        .slice(0, 6).map(x => x.actualMinor!)
      if (past.length) {
        past.sort((a, b) => a - b)
        plan.expectedMinor = past[Math.floor(past.length / 2)]
      }
    }
  })
  return true
}

export function skipOccurrence(id: ID) {
  mutate(d => {
    const o = d.occurrences.find(x => x.id === id)
    if (o) o.status = 'skipped'
  })
}

/**
 * Записати рух грошей. `projectId` порожній — «Вільні гроші»; для переказу
 * `fromProjectId` порожній — теж вільні.
 */
export function addEntry(input: {
  kind: EntryKind; amountMinor: number; currency: Currency
  projectId?: ID; fromProjectId?: ID; note?: string; occurredOn?: string
}): ID {
  const id = uid()
  mutate(d => {
    const rate = input.currency === 'UAH' ? 1 : d.rates[input.currency]
    d.entries.push({
      id, kind: input.kind, occurredOn: input.occurredOn ?? today(),
      amountMinor: input.amountMinor, currency: input.currency,
      rateToBase: rate, amountBaseMinor: Math.round(input.amountMinor * rate),
      projectId: input.projectId, fromProjectId: input.fromProjectId,
      note: input.note, createdBy: d.meId,
    })
  })
  return id
}

export function addTask(input: Partial<Task> & { title: string }) {
  const id = uid()
  mutate(d => {
    d.tasks.push({
      id, title: input.title, status: input.status ?? 'todo',
      priority: input.priority ?? 0, effort: input.effort ?? 1,
      assigneeId: input.assigneeId, area: input.area, dueDate: input.dueDate,
      projectId: input.projectId, notes: input.notes,
      createdBy: d.meId, createdAt: new Date().toISOString(),
    })
  })
  // Пуш — лише за ЯВНОЇ дії людини. Задачі з шаблонів генерує materialize(),
  // і будити партнера щоразу, коли черга дійшла до «винести сміття», не треба.
  if (input.assigneeId && input.assigneeId !== db.meId) {
    notifyAssigned({ id, title: input.title, assigneeId: input.assigneeId })
  }
}

export function updateTask(id: ID, patch: Partial<Task>) {
  const before = db.tasks.find(x => x.id === id)
  mutate(d => {
    const t = d.tasks.find(x => x.id === id)
    if (!t) return
    Object.assign(t, patch)
    if (patch.status === 'dropped') skipRound(d, t)
  })
  const to = patch.assigneeId
  if (before && to && to !== before.assigneeId && to !== db.meId) {
    notifyAssigned({ id, title: patch.title ?? before.title, assigneeId: to })
  }
}

export function completeTask(id: ID) {
  mutate(d => {
    const t = d.tasks.find(x => x.id === id)
    if (!t) return
    if (t.status === 'done') {
      t.status = 'todo'; t.completedAt = undefined; t.completedBy = undefined
      // Виконання «після попереднього» вже породило наступний екземпляр.
      // Скасували виконання — наступний має зникнути, інакше відкритих стає
      // два (інваріант 9), а відлік має піти від попереднього виконання.
      const tpl = t.templateId ? d.taskTemplates.find(x => x.id === t.templateId) : undefined
      if (tpl?.scheduleKind === 'after_completion') {
        d.tasks = d.tasks.filter(x => x.id === t.id || x.templateId !== tpl.id
          || x.status === 'done' || x.status === 'dropped')
        tpl.lastCompletedAt = d.tasks
          .filter(x => x.templateId === tpl.id && x.status === 'done' && x.completedAt)
          .map(x => x.completedAt!).sort().pop()
      }
      return
    }
    t.status = 'done'
    t.completedAt = new Date().toISOString()
    t.completedBy = d.meId
    if (t.templateId) {
      const tpl = d.taskTemplates.find(x => x.id === t.templateId)
      if (tpl) tpl.lastCompletedAt = t.completedAt
    }
  })
}

export function setPriority(id: ID, priority: Priority) { updateTask(id, { priority }) }
export function setAssignee(id: ID, assigneeId?: ID) { updateTask(id, { assigneeId }) }

export function addShoppingItem(name: string, opts: { qty?: string; category?: string } = {}) {
  mutate(d => {
    const prev = d.shoppingItems.find(i => i.name.toLowerCase() === name.toLowerCase() && i.category)
    d.shoppingItems.push({
      id: uid(), name, qty: opts.qty, category: opts.category ?? prev?.category ?? 'Інше',
      addedBy: d.meId, addedAt: new Date().toISOString(),
    })
  })
}

export function toggleShoppingItem(id: ID) {
  mutate(d => {
    const i = d.shoppingItems.find(x => x.id === id)
    if (!i) return
    if (i.checkedAt) { i.checkedAt = undefined; i.checkedBy = undefined }
    else { i.checkedAt = new Date().toISOString(); i.checkedBy = d.meId }
  })
}

export function removeShoppingItem(id: ID) {
  mutate(d => { d.shoppingItems = d.shoppingItems.filter(x => x.id !== id) })
}

/** Один чек → одна витрата. Ціна кожного товару не питається ніколи. */
export function finishShopping(totalMinor: number, projectId: ID | undefined, store?: string) {
  mutate(d => {
    const tripId = uid()
    d.trips.push({ id: tripId, store, shoppedBy: d.meId, completedAt: new Date().toISOString(), totalMinor, currency: 'UAH', projectId })
    d.entries.push({
      id: uid(), kind: 'expense', occurredOn: today(), amountMinor: totalMinor, currency: 'UAH',
      rateToBase: 1, amountBaseMinor: totalMinor, projectId, tripId,
      note: store || 'Покупки', createdBy: d.meId,
    })
    // Не видаляємо, а привʼязуємо до походу — так само, як finish_shopping у sql/.
    // Зі списку вони зникають (список фільтрує !tripId), а кількість позицій
    // лишається похідною: інваріант 4, нічого денормалізованого не зберігаємо.
    for (const i of d.shoppingItems) if (i.checkedAt && !i.tripId) i.tripId = tripId
  })
}

export function upcomingOccurrences(d: DB, days = 7): Occurrence[] {
  const to = addDays(today(), days)
  return d.occurrences
    .filter(o => (o.status === 'due' || o.status === 'projected') && o.dueDate <= to)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
}

/* ═══════════════════ налаштування: сім'я і курси ═══════════════════ */

/** Хто зараз за кермом. Без цього всі дії пишуться на одну людину. */
export function setMe(id: ID) {
  mutate(d => { if (d.members.some(m => m.id === id)) d.meId = id })
}


export function updateMember(id: ID, patch: Partial<Member>) {
  mutate(d => { const m = d.members.find(x => x.id === id); if (m) Object.assign(m, patch) })
}

export function setRates(patch: Partial<Rates>) {
  mutate(d => { Object.assign(d.rates, patch) })
}

/* ═══════════════════ проєкти ═══════════════════ */

export function addProject(input: Omit<Project, 'id' | 'sortOrder' | 'status'> & { status?: ProjectStatus; sortOrder?: number }): ID {
  const id = uid()
  mutate(d => {
    const sortOrder = input.sortOrder ?? Math.max(0, ...d.projects.map(p => p.sortOrder)) + 10
    d.projects.push({ ...input, id, status: input.status ?? 'active', sortOrder, isFree: undefined })
  })
  return id
}

export function updateProject(id: ID, patch: Partial<Omit<Project, 'id' | 'isFree'>>) {
  mutate(d => {
    const p = d.projects.find(x => x.id === id)
    if (!p) return
    Object.assign(p, patch)
    // «Вільні гроші» лишаються системними: напрям і статус не міняються
    if (p.isFree) { p.direction = 'none'; p.status = 'active' }
  })
}

/**
 * Завершити, архівувати або повернути проєкт. Проєкти не видаляються:
 * на них посилаються записи за минуле. Майбутні неоплачені платежі
 * неактивного проєкту прибираються, правила вимикаються — історія лишається.
 */
export function setProjectStatus(id: ID, status: ProjectStatus) {
  mutate(d => {
    const p = d.projects.find(x => x.id === id)
    if (!p || p.isFree) return
    p.status = status
    if (status === 'active') return
    const t = today()
    for (const r of d.recurringPlans) if (r.projectId === id) r.active = false
    d.occurrences = d.occurrences.filter(o =>
      o.projectId !== id || o.status === 'paid' || o.status === 'skipped' || o.dueDate < t)
  })
}

export function reorderProject(id: ID, sortOrder: number) {
  updateProject(id, { sortOrder })
}

/** Поповнити накопичення: переказ із вільних (або з іншого накопичення). Не витрата. */
export function fundProject(projectId: ID, amountMinor: number, fromProjectId?: ID, note?: string): ID | undefined {
  const p = db.projects.find(x => x.id === projectId)
  if (!p || amountMinor <= 0) return undefined
  return addEntry({ kind: 'transfer', amountMinor, currency: p.currency, projectId, fromProjectId, note })
}

/** Витрата на проєкт: для накопичення зменшує його баланс, для решти — з вільних або джерела. */
export function spendOnProject(projectId: ID | undefined, amountMinor: number, note?: string, currency?: Currency): ID | undefined {
  const p = projectId ? db.projects.find(x => x.id === projectId) : undefined
  if (amountMinor <= 0) return undefined
  return addEntry({
    kind: p?.direction === 'repay' ? 'repay' : 'expense',
    amountMinor, currency: currency ?? p?.currency ?? 'UAH', projectId, note,
  })
}

/* ═══════════════════ регулярні платежі ═══════════════════ */

export function addRecurringPlan(input: Omit<RecurringPlan, 'id'>) {
  mutate(d => { d.recurringPlans.push({ ...input, id: uid() }) })
}

export function updateRecurringPlan(id: ID, patch: Partial<RecurringPlan>) {
  mutate(d => {
    const p = d.recurringPlans.find(x => x.id === id)
    if (!p) return
    const reschedules = ['freq', 'byMonthDay', 'byDay', 'byMonth', 'anchorDate'].some(k => k in patch)
    Object.assign(p, patch)
    // розклад змінився → прибираємо ще не оплачені майбутні, materialize() згенерує заново
    if (reschedules) {
      const t = today()
      d.occurrences = d.occurrences.filter(o =>
        o.planId !== id || o.status === 'paid' || o.status === 'skipped' || o.dueDate < t)
    }
  })
}

/** План вимикаємо і прибираємо його майбутні неоплачені платежі. Історію лишаємо. */
export function removeRecurringPlan(id: ID) {
  mutate(d => {
    const t = today()
    d.recurringPlans = d.recurringPlans.filter(p => p.id !== id)
    d.occurrences = d.occurrences.filter(o =>
      o.planId !== id || o.status === 'paid' || o.status === 'skipped' || o.dueDate < t)
  })
}

/* ═══════════════════ шаблони побутових задач ═══════════════════ */

export function addTaskTemplate(input: Omit<TaskTemplate, 'id'>) {
  mutate(d => { d.taskTemplates.push({ ...input, id: uid() }) })
}

export function updateTaskTemplate(id: ID, patch: Partial<TaskTemplate>) {
  mutate(d => { const t = d.taskTemplates.find(x => x.id === id); if (t) Object.assign(t, patch) })
}

/** Шаблон прибираємо разом із його ще не виконаними екземплярами. */
export function removeTaskTemplate(id: ID) {
  mutate(d => {
    d.taskTemplates = d.taskTemplates.filter(t => t.id !== id)
    d.tasks = d.tasks.filter(t => t.templateId !== id || t.status === 'done')
  })
}

/* ═══════════════════ записи: правка і видалення ═══════════════════ */

/** Сума/валюта змінились → курс перезаморожуємо на СЬОГОДНІ, решта полів як є. */
export function updateEntry(id: ID, patch: Partial<{
  amountMinor: number; currency: Currency; projectId: ID | undefined; note: string; occurredOn: string
}>) {
  mutate(d => {
    const e = d.entries.find(x => x.id === id)
    if (!e) return
    const currencyChanged = patch.currency != null && patch.currency !== e.currency
    Object.assign(e, patch)
    // Курс перезаморожуємо лише зі зміною валюти: виправлена сума — це та сама
    // подія того самого дня, і курс її дня лишається її курсом (інваріант 2).
    if (currencyChanged) e.rateToBase = e.currency === 'UAH' ? 1 : d.rates[e.currency]
    if (patch.amountMinor != null || currencyChanged) {
      e.amountBaseMinor = Math.round(e.amountMinor * e.rateToBase)
    }
    // Витрата на погашення боргу й навпаки: вид іде за проєктом
    if ('projectId' in patch && (e.kind === 'expense' || e.kind === 'repay')) {
      const p = d.projects.find(x => x.id === e.projectId)
      e.kind = p?.direction === 'repay' ? 'repay' : 'expense'
    }
    // Запис підтверджує платіж → факт платежу йде за ним
    if (e.occurrenceId) {
      const o = d.occurrences.find(x => x.id === e.occurrenceId)
      if (o) {
        o.actualMinor = e.amountMinor
        if (patch.occurredOn) o.paidOn = patch.occurredOn
      }
    }
  })
}

/** Видаляє запис. Якщо він був підтвердженням платежу — платіж повертається в «до оплати». */
export function removeEntry(id: ID) {
  mutate(d => {
    const e = d.entries.find(x => x.id === id)
    if (!e) return
    if (e.occurrenceId) {
      const oid = e.occurrenceId
      d.entries = d.entries.filter(x => x.occurrenceId !== oid)
      const o = d.occurrences.find(x => x.id === oid)
      if (o) {
        o.status = o.dueDate <= today() ? 'due' : 'projected'
        o.paidOn = undefined; o.actualMinor = undefined; o.paidBy = undefined
      }
      return
    }
    d.entries = d.entries.filter(x => x.id !== id)
  })
}

/* ═══════════════════ платежі ═══════════════════ */

/** Разовий платіж без регулярного плану. */
export function addOccurrence(input: {
  projectId: ID; name: string; dueDate: string; expectedMinor: number
  currency?: Currency; assigneeId?: ID; note?: string
}) {
  mutate(d => {
    d.occurrences.push({
      id: uid(), projectId: input.projectId, name: input.name, dueDate: input.dueDate,
      expectedMinor: input.expectedMinor, currency: input.currency ?? 'UAH',
      status: input.dueDate <= today() ? 'due' : 'projected',
      assigneeId: input.assigneeId, note: input.note,
    })
  })
}

/** Помилково підтвердили — відкотити разом зі створеними записами. */
export function unconfirmOccurrence(id: ID) {
  mutate(d => {
    const o = d.occurrences.find(x => x.id === id)
    if (!o) return
    d.entries = d.entries.filter(e => e.occurrenceId !== id)
    o.status = o.dueDate <= today() ? 'due' : 'projected'
    o.paidOn = undefined; o.actualMinor = undefined; o.paidBy = undefined
  })
}


/* ═══════════════════ покупки: правка ═══════════════════ */

export function updateShoppingItem(id: ID, patch: Partial<{ name: string; qty: string; category: string }>) {
  mutate(d => { const i = d.shoppingItems.find(x => x.id === id); if (i) Object.assign(i, patch) })
}

/* ═══════════════════ задачі: справжнє видалення ═══════════════════ */

export function deleteTask(id: ID) {
  mutate(d => {
    const t = d.tasks.find(x => x.id === id)
    // Екземпляр повторюваної задачі фізично не видаляємо: materialize() у ту
    // саму мить згенерував би його знову з тим самим id. «Видалити цей раз» —
    // це прибрати його, і ключ дати лишається зайнятим.
    if (t?.templateId) {
      t.status = 'dropped'
      skipRound(d, t)
      d.tasks = d.tasks.filter(x => x.parentId !== id)
      return
    }
    d.tasks = d.tasks.filter(x => x.id !== id && x.parentId !== id)
  })
}

/**
 * Прибраний екземпляр задачі «через N днів після виконання» — це пропущений
 * раз, а не кінець шаблону. Без цього наступна дата збігалась би з датою
 * прибраного екземпляра, її ключ зайнятий, і шаблон більше ніколи нічого
 * не створив би.
 */
function skipRound(d: DB, t: Task) {
  const tpl = t.templateId ? d.taskTemplates.find(x => x.id === t.templateId) : undefined
  if (tpl?.scheduleKind === 'after_completion') tpl.lastCompletedAt = new Date().toISOString()
}
