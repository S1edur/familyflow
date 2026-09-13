import { useSyncExternalStore } from 'react'
import type {
  DB, Occurrence, Task, Currency, EntryKind, ID, Priority,
  Envelope, EnvelopeKind, Fund, Debt, RecurringPlan, TaskTemplate, Member, Rates,
} from './types'
import { emptyDB, seed } from './seed'
import {
  addDays, clampDayOfMonth, iso, isoDow, monthKey, monthsUntil, parse, relativeDue, today,
} from '../lib/dates'
import { money, toBase } from '../lib/money'
import { pullAll, pullRates, pushDiff, pushMembers, pushRates, watchHousehold } from './sync'
import { drop, enqueue, peek, queueSize, clearQueue } from './queue'

const KEY = 'familyflow.v1'
const HORIZON_MONTHS = 13
const TASK_HORIZON_DAYS = 7

let db: DB = init()
const listeners = new Set<() => void>()

function init(): DB {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return materialize(JSON.parse(raw) as DB)
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
 * Перший невдалий елемент зупиняє прохід — решта чекає наступної спроби.
 */
export async function drain(): Promise<void> {
  if (draining || !householdId) return
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return
  draining = true
  const h = householdId
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
}

if (typeof window !== 'undefined') {
  // мережа повернулась або вкладку знову побачили — пробуємо ще раз
  window.addEventListener('online', () => void drain())
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void drain()
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
  const [cloud, rates] = await Promise.all([pullAll(id), pullRates()])
  db = materialize({ ...db, ...cloud, rates: { ...db.rates, ...rates } })
  emit()
}

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
  await drain()

  const [cloud, rates] = await Promise.all([pullAll(id), pullRates()])
  // Прийняте з бази ставимо НАПРЯМУ, без mutate: інакше відправили б назад
  // те, що щойно звідти приїхало.
  const pulled: DB = { ...db, ...cloud, members, meId, rates: { ...db.rates, ...rates } }

  // materialize міг догенерувати платежі й задачі — ось їх відправити треба
  const withGenerated = materialize(structuredClone(pulled))
  db = withGenerated
  emit()

  // Зміни партнера приходять самі. Події збираємо в пачку: одна дія
  // партнера — це кілька рядків у кількох таблицях, і тягнути на кожен
  // означало б десяток запитів замість одного.
  unwatch?.()
  unwatch = watchHousehold(id, () => {
    if (refreshTimer) clearTimeout(refreshTimer)
    refreshTimer = setTimeout(() => { void refresh(id) }, 400)
  })

  await pushDiff(pulled, withGenerated, id).catch((e: unknown) => {
    console.error('Не вдалось відправити згенероване:', e instanceof Error ? e.message : e)
  })
}

export function resetAll() {
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

export const getDB = () => db
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
        id: stableId(`occ:${p.id}:${date}`), planId: p.id, envelopeId: p.envelopeId, name: p.name,
        dueDate: date, expectedMinor: p.expectedMinor, currency: p.currency,
        status: date <= t ? 'due' : 'projected', assigneeId: p.assigneeId,
      })
    }
  }
  for (const o of d.occurrences) {
    if (o.status === 'projected' && o.dueDate <= t) o.status = 'due'
  }

  // Внески у фонди — такі самі платежі, як рахунки.
  // Сума ПОХІДНА: fundStatus рахує її щомісяця заново, бо вона залежить від
  // того, скільки вже зібрано і скільки місяців лишилось. Тому перезаписуємо
  // очікування на ще не підтверджених — інакше в чеклісті висіла б цифра,
  // порахована місяць тому.
  for (const f of d.funds) {
    if (f.archived || !f.envelopeId) continue
    const day = f.contributionDay ?? 1
    const cur = parse(t.slice(0, 8) + '01')
    for (let i = 0; i < HORIZON_MONTHS; i++) {
      const y = cur.getFullYear(), m1 = cur.getMonth() + 1
      const dd = clampDayOfMonth(y, m1, day)
      const date = `${y}-${String(m1).padStart(2, '0')}-${String(dd).padStart(2, '0')}`
      const id = stableId(`fund:${f.id}:${date}`)
      const existing = d.occurrences.find(o => o.id === id)
      const required = fundStatus(d, f.id).required

      if (!existing) {
        if (required > 0) {
          d.occurrences.push({
            id, envelopeId: f.envelopeId, fundId: f.id, name: f.name,
            dueDate: date, expectedMinor: required, currency: f.currency,
            status: date <= t ? 'due' : 'projected',
          })
        }
      } else if (existing.status !== 'paid' && existing.status !== 'skipped') {
        existing.expectedMinor = required
      }
      cur.setMonth(cur.getMonth() + 1)
    }
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
        const due = addDays(tpl.lastCompletedAt?.slice(0, 10) ?? t, tpl.intervalDays ?? 7)
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
export function tripWeight(d: DB, tripId: ID): 1 | 2 | 3 {
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

export function envelopeMonth(d: DB, month: string) {
  return d.envelopes
    .filter(e => !e.archived && e.kind !== 'income')
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map(e => {
      const planned = d.planLines.find(p => p.envelopeId === e.id && p.month === month)?.plannedMinor ?? 0
      // debt_payment теж витрата місяця: гроші пішли з рахунку. Той самий запис
      // паралельно читається як виплата по боргу — дублювання немає.
      const actual = d.entries
        .filter(x => (x.kind === 'expense' || x.kind === 'debt_payment')
          && x.envelopeId === e.id && monthKey(x.occurredOn) === month)
        .reduce((s, x) => s + x.amountBaseMinor, 0)
      return { envelope: e, planned, actual, remaining: planned - actual }
    })
}

export function fundBalance(d: DB, fundId: ID) {
  return d.entries.reduce((s, e) => {
    if (e.fundId !== fundId) return s
    if (e.kind === 'fund_in') return s + e.amountMinor
    if (e.kind === 'fund_out') return s - e.amountMinor
    return s
  }, 0)
}

export function fundStatus(d: DB, fundId: ID) {
  const f = d.funds.find(x => x.id === fundId)!
  const balance = fundBalance(d, fundId)
  const target = f.targetMinor ? Math.round(f.targetMinor * (1 + (f.bufferPct ?? 0) / 100)) : undefined
  const monthsLeft = monthsUntil(f.dueDate)
  const required = f.monthlyFixedMinor
    ?? (target ? Math.max(0, Math.ceil((target - balance) / monthsLeft / 100) * 100) : 0)
  const progress = target ? Math.min(1, balance / target) : 0
  // Скільки мало б бути зібрано на цей момент.
  // Початок накопичення беремо з ПЕРШОГО внеску, а не вигадуємо.
  // У Fund немає дати старту, і раніше тут припускалося, що фонд почали рівно
  // 12 місяців тому — через що щойно створений фонд одразу отримував «відстаємо».
  const mine = d.entries.filter(e => e.fundId === fundId)
  // Початок ПОТОЧНОГО циклу: остання виплата, а якщо виплат ще не було —
  // найперший внесок. Інакше після виплати цикл міряється від внеску
  // дворічної давнини, і щойно спорожнілий фонд одразу «відстає».
  const lastOut = mine.filter(e => e.kind === 'fund_out').map(e => e.occurredOn).sort().pop()
  const firstIn = mine.filter(e => e.kind === 'fund_in').map(e => e.occurredOn).sort()[0]
  const cycleStart = lastOut ?? firstIn
  const span = cycleStart && f.dueDate ? monthsUntil(f.dueDate, cycleStart) : 0
  const elapsed = span > 0 ? Math.max(0, Math.min(1, 1 - (monthsLeft - 1) / span)) : 0
  // ще жодного внеску → нічого не почалось, докоряти нема за що
  const onTrack = !target || balance >= target * elapsed
  return { fund: f, balance, target, monthsLeft, required, progress, onTrack }
}

/** Конверт, до якого належать виплати боргів. Похідний: у Debt немає посилання на конверт. */
export function debtEnvelopeId(d: DB): ID | undefined {
  return d.envelopes.find(e => e.kind === 'debt' && !e.archived)?.id
}

export function debtStatus(d: DB, debtId: ID) {
  const debt = d.debts.find(x => x.id === debtId)!
  const paid = d.entries
    .filter(e => e.debtId === debtId && e.kind === 'debt_payment')
    .reduce((s, e) => s + e.amountMinor, 0)
  const remaining = Math.max(0, debt.principalMinor - paid)
  const progress = debt.principalMinor ? paid / debt.principalMinor : 0
  let payoff: string | undefined
  if (debt.monthlyPaymentMinor && remaining > 0) {
    const months = Math.ceil(remaining / debt.monthlyPaymentMinor)
    const dt = new Date(); dt.setMonth(dt.getMonth() + months)
    payoff = iso(dt)
  }
  return { debt, paid, remaining, progress, payoff }
}

export function monthSummary(d: DB, month: string) {
  const income = d.entries
    .filter(e => e.kind === 'income' && monthKey(e.occurredOn) === month)
    .reduce((s, e) => s + e.amountBaseMinor, 0)

  const incomeEnvelopes = new Set(d.envelopes.filter(e => e.kind === 'income').map(e => e.id))
  // платіж у дохідний конверт — це надходження, а не зобовʼязання:
  // віднімати його від «вільно» означало б рахувати зарплату витратою
  const monthOccurrences = d.occurrences
    .filter(o => monthKey(o.dueDate) === month && !incomeEnvelopes.has(o.envelopeId))

  /** Очікувані, ще не підтверджені надходження цього місяця. */
  const incomeExpected = d.occurrences
    .filter(o => monthKey(o.dueDate) === month && incomeEnvelopes.has(o.envelopeId)
      && (o.status === 'due' || o.status === 'projected'))
    .reduce((s, o) => s + o.expectedMinor, 0)

  const obligationsLeft = monthOccurrences
    .filter(o => o.status === 'due' || o.status === 'projected')
    .reduce((s, o) => s + o.expectedMinor, 0)

  // у «вільно» входять і вже оплачені: гроші пішли з рахунку, і рівняння
  // не має про це забувати, інакше підтвердження платежу ЗБІЛЬШУЄ вільне
  const obligationsAll = monthOccurrences
    .filter(o => o.status !== 'skipped')
    .reduce((s, o) => s + (o.status === 'paid' ? (o.actualMinor ?? o.expectedMinor) : o.expectedMinor), 0)

  // Фонди з конвертом уже породили платежі й сидять в obligationsAll —
  // рахувати їх ще й тут означало б відняти двічі. Окремим рядком лишаються
  // тільки ті, що не автоматизовані.
  const fundsRequired = d.funds
    .filter(f => !f.archived && !f.envelopeId)
    .reduce((s, f) => s + fundStatus(d, f.id).required, 0)

  const spentVariable = d.entries
    .filter(e => (e.kind === 'expense' || e.kind === 'debt_payment')
      && monthKey(e.occurredOn) === month && !e.occurrenceId)
    .reduce((s, e) => s + e.amountBaseMinor, 0)

  const obligationsPaid = obligationsAll - obligationsLeft
  // Симетрія: зобовʼязання рахуються очікуваними (неоплачені теж віднімаються),
  // тож і дохід має рахуватись очікуваним. Інакше будь-який майбутній місяць
  // виглядає катастрофою просто тому, що зарплату ще не підтвердили.
  const free = income + incomeExpected - obligationsAll - fundsRequired - spentVariable
  return { income, incomeExpected, obligationsLeft, obligationsPaid, fundsRequired, spentVariable, free }
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

export function confirmOccurrence(id: ID, amountMinor?: number, paidOn?: string) {
  mutate(d => {
    const o = d.occurrences.find(x => x.id === id)
    if (!o || o.status === 'paid') return
    const amt = amountMinor ?? o.expectedMinor
    const on = paidOn ?? today()
    const rate = o.currency === 'UAH' ? 1 : d.rates[o.currency]

    const plan0 = d.recurringPlans.find(p => p.id === o.planId)

    // Платіж, що гасить борг, — це ОДИН запис debt_payment, який несе і конверт,
    // і борг. debtStatus читає його як виплату, envelopeMonth — як витрату місяця.
    // Два окремі записи про одну подію довелось би тримати в синхроні при
    // кожній правці й видаленні.
    const entryId = uid()
    d.entries.push({
      id: entryId,
      // Конверт уже каже, відтік це чи надходження — окреме поле в плані зайве.
      // Тип руху грошей визначає те, з чим платіж повʼязаний. Одне правило
      // на всі випадки: поповнення фонду, гасіння боргу, дохід, витрата.
      kind: o.fundId ? 'fund_in'
        : plan0?.debtId ? 'debt_payment'
        : d.envelopes.find(e => e.id === o.envelopeId)?.kind === 'income' ? 'income'
        : 'expense',
      occurredOn: on, amountMinor: amt, currency: o.currency,
      rateToBase: rate, amountBaseMinor: Math.round(amt * rate),
      envelopeId: o.envelopeId, debtId: plan0?.debtId, fundId: o.fundId,
      occurrenceId: o.id, note: o.name, createdBy: d.meId,
    })
    o.status = 'paid'; o.paidOn = on; o.actualMinor = amt; o.paidBy = d.meId

    // фінансується фондом → списуємо з фонду, а не рахуємо витрату двічі
    const plan = plan0
    if (plan?.fundId) {
      d.entries.push({
        id: uid(), kind: 'fund_out', occurredOn: on, amountMinor: amt, currency: o.currency,
        rateToBase: rate, amountBaseMinor: Math.round(amt * rate),
        fundId: plan.fundId, occurrenceId: o.id, note: o.name, createdBy: d.meId,
      })

      // Фонд відпрацював цикл — переносимо ціль на наступний платіж цього плану.
      // Без цього страховка, оплачена в лютому, назавжди лишає фонду лютневу
      // дату: monthsUntil затискається в 1, і фонд щомісяця вимагає весь
      // залишок цілі, а «відстаємо» не згасає ніколи.
      // sql/ робить те саме через funds.on_payout = 'refill'.
      const fund = d.funds.find(x => x.id === plan.fundId)
      if (fund?.dueDate) {
        // Рахуємо з РОЗКЛАДУ, а не з уже згенерованих платежів: горизонт
        // генерації 13 місяців, тож у річного плану наступної дати там
        // просто немає — а саме річні фонди це й стосується найбільше.
        const next = expandDates(
          plan.freq, plan.byMonthDay, plan.byDay, plan.byMonth, plan.anchorDate,
          addDays(o.dueDate, 1), addDays(o.dueDate, 400),
        )[0]
        if (next) fund.dueDate = next
      }
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
}

/** Платіж у дохідний конверт — це надходження: «Отримано», а не «Оплачено». */
export function isIncomeOccurrence(d: DB, o: Occurrence): boolean {
  return d.envelopes.find(e => e.id === o.envelopeId)?.kind === 'income'
}

export function skipOccurrence(id: ID) {
  mutate(d => {
    const o = d.occurrences.find(x => x.id === id)
    if (o) o.status = 'skipped'
  })
}

export function addEntry(input: {
  kind: EntryKind; amountMinor: number; currency: Currency
  envelopeId?: ID; fundId?: ID; debtId?: ID; note?: string; occurredOn?: string
}) {
  mutate(d => {
    const rate = input.currency === 'UAH' ? 1 : d.rates[input.currency]
    d.entries.push({
      id: uid(), kind: input.kind, occurredOn: input.occurredOn ?? today(),
      amountMinor: input.amountMinor, currency: input.currency,
      rateToBase: rate, amountBaseMinor: toBase(input.amountMinor, input.currency, d.rates),
      envelopeId: input.envelopeId, fundId: input.fundId, debtId: input.debtId,
      note: input.note, createdBy: d.meId,
    })
  })
}

export function setPlanned(envelopeId: ID, month: string, plannedMinor: number) {
  mutate(d => {
    const line = d.planLines.find(p => p.envelopeId === envelopeId && p.month === month)
    if (line) line.plannedMinor = plannedMinor
    else d.planLines.push({ envelopeId, month, plannedMinor })
  })
}

export function addTask(input: Partial<Task> & { title: string }) {
  mutate(d => {
    d.tasks.push({
      id: uid(), title: input.title, status: input.status ?? 'todo',
      priority: input.priority ?? 0, effort: input.effort ?? 1,
      assigneeId: input.assigneeId, area: input.area, dueDate: input.dueDate,
      createdBy: d.meId, createdAt: new Date().toISOString(),
    })
  })
}

export function updateTask(id: ID, patch: Partial<Task>) {
  mutate(d => {
    const t = d.tasks.find(x => x.id === id)
    if (t) Object.assign(t, patch)
  })
}

export function completeTask(id: ID) {
  mutate(d => {
    const t = d.tasks.find(x => x.id === id)
    if (!t) return
    if (t.status === 'done') {
      t.status = 'todo'; t.completedAt = undefined; t.completedBy = undefined
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
export function finishShopping(totalMinor: number, envelopeId: ID, store?: string) {
  mutate(d => {
    const tripId = uid()
    d.trips.push({ id: tripId, store, shoppedBy: d.meId, completedAt: new Date().toISOString(), totalMinor, currency: 'UAH' })
    d.entries.push({
      id: uid(), kind: 'expense', occurredOn: today(), amountMinor: totalMinor, currency: 'UAH',
      rateToBase: 1, amountBaseMinor: totalMinor, envelopeId, tripId,
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

export function addMember(input: { name: string; color: string; initials?: string }) {
  mutate(d => {
    d.members.push({
      id: uid(), name: input.name, color: input.color,
      initials: input.initials || input.name.slice(0, 1).toUpperCase(),
    })
  })
}

export function updateMember(id: ID, patch: Partial<Member>) {
  mutate(d => { const m = d.members.find(x => x.id === id); if (m) Object.assign(m, patch) })
}

export function setRates(patch: Partial<Rates>) {
  mutate(d => { Object.assign(d.rates, patch) })
}

/* ═══════════════════ конверти ═══════════════════ */

export function addEnvelope(input: { name: string; kind: EnvelopeKind; ownerId?: ID }) {
  mutate(d => {
    const sortOrder = Math.max(0, ...d.envelopes.map(e => e.sortOrder)) + 10
    d.envelopes.push({ id: uid(), name: input.name, kind: input.kind, ownerId: input.ownerId, sortOrder })
  })
}

export function updateEnvelope(id: ID, patch: Partial<Envelope>) {
  mutate(d => { const e = d.envelopes.find(x => x.id === id); if (e) Object.assign(e, patch) })
}

/** Конверт не видаляємо — на нього дивляться історичні записи. Архівуємо. */
export function archiveEnvelope(id: ID, archived = true) {
  mutate(d => { const e = d.envelopes.find(x => x.id === id); if (e) e.archived = archived })
}

export function reorderEnvelope(id: ID, sortOrder: number) {
  mutate(d => { const e = d.envelopes.find(x => x.id === id); if (e) e.sortOrder = sortOrder })
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

/* ═══════════════════ фонди ═══════════════════ */

export function addFund(input: Omit<Fund, 'id' | 'priority'> & { priority?: number }) {
  mutate(d => {
    const priority = input.priority ?? Math.max(0, ...d.funds.map(f => f.priority)) + 10
    d.funds.push({ ...input, priority, id: uid() })
  })
}

export function updateFund(id: ID, patch: Partial<Fund>) {
  mutate(d => { const f = d.funds.find(x => x.id === id); if (f) Object.assign(f, patch) })
}

export function archiveFund(id: ID, archived = true) {
  mutate(d => { const f = d.funds.find(x => x.id === id); if (f) f.archived = archived })
}

/** Витрата з фонду напряму (не через прив'язаний регулярний платіж). */
export function spendFromFund(fundId: ID, amountMinor: number, note?: string) {
  mutate(d => {
    const f = d.funds.find(x => x.id === fundId)
    if (!f) return
    const rate = f.currency === 'UAH' ? 1 : d.rates[f.currency]
    d.entries.push({
      id: uid(), kind: 'fund_out', occurredOn: today(), amountMinor, currency: f.currency,
      rateToBase: rate, amountBaseMinor: Math.round(amountMinor * rate),
      fundId, note, createdBy: d.meId,
    })
  })
}

/* ═══════════════════ борги ═══════════════════ */

export function addDebt(input: Omit<Debt, 'id' | 'openedOn'> & { openedOn?: string }) {
  mutate(d => { d.debts.push({ ...input, openedOn: input.openedOn ?? today(), id: uid() }) })
}

export function updateDebt(id: ID, patch: Partial<Debt>) {
  mutate(d => { const x = d.debts.find(y => y.id === id); if (x) Object.assign(x, patch) })
}

export function closeDebt(id: ID, closedOn?: string) {
  mutate(d => { const x = d.debts.find(y => y.id === id); if (x) x.closedOn = closedOn ?? today() })
}

export function reopenDebt(id: ID) {
  mutate(d => { const x = d.debts.find(y => y.id === id); if (x) x.closedOn = undefined })
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
  amountMinor: number; currency: Currency; envelopeId: ID; note: string; occurredOn: string
}>) {
  mutate(d => {
    const e = d.entries.find(x => x.id === id)
    if (!e) return
    Object.assign(e, patch)
    if (patch.amountMinor != null || patch.currency != null) {
      e.rateToBase = e.currency === 'UAH' ? 1 : d.rates[e.currency]
      e.amountBaseMinor = Math.round(e.amountMinor * e.rateToBase)
    }
    // запис належить платежу → тримаємо факт по платежу в синхроні
    if (e.occurrenceId && e.kind === 'expense') {
      const o = d.occurrences.find(x => x.id === e.occurrenceId)
      if (o) o.actualMinor = e.amountMinor
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
      d.entries = d.entries.filter(x => x.occurrenceId !== oid)   // разом із fund_out
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
  envelopeId: ID; name: string; dueDate: string; expectedMinor: number
  currency?: Currency; assigneeId?: ID; note?: string
}) {
  mutate(d => {
    d.occurrences.push({
      id: uid(), envelopeId: input.envelopeId, name: input.name, dueDate: input.dueDate,
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

export function unskipOccurrence(id: ID) {
  mutate(d => {
    const o = d.occurrences.find(x => x.id === id)
    if (o && o.status === 'skipped') o.status = o.dueDate <= today() ? 'due' : 'projected'
  })
}

/* ═══════════════════ покупки: правка ═══════════════════ */

export function updateShoppingItem(id: ID, patch: Partial<{ name: string; qty: string; category: string }>) {
  mutate(d => { const i = d.shoppingItems.find(x => x.id === id); if (i) Object.assign(i, patch) })
}

/* ═══════════════════ задачі: справжнє видалення ═══════════════════ */

export function deleteTask(id: ID) {
  mutate(d => { d.tasks = d.tasks.filter(t => t.id !== id && t.parentId !== id) })
}
