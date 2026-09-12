import { useSyncExternalStore } from 'react'
import type { DB, Occurrence, Task, Currency, EntryKind, ID, Priority } from './types'
import { seed } from './seed'
import {
  addDays, clampDayOfMonth, iso, isoDow, monthKey, monthsUntil, parse, today,
} from '../lib/dates'
import { toBase } from '../lib/money'

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

export function mutate(fn: (d: DB) => void) {
  const next: DB = structuredClone(db)
  fn(next)
  db = materialize(next)
  emit()
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
export function uid() { return Math.random().toString(36).slice(2, 10) }

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
        id: uid(), planId: p.id, envelopeId: p.envelopeId, name: p.name,
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
    id: uid(), templateId, occurrenceKey: due, title: tpl.title, area: tpl.area,
    status: 'todo', priority: 0, effort: tpl.effort, assigneeId: who,
    dueDate: due, createdBy: who ?? d.meId, createdAt: new Date().toISOString(),
  })
}

/** Хто менше закрив за 28 днів — самокорекція замість жорсткої черги. */
function leastLoaded(d: DB): ID | undefined {
  const since = addDays(today(), -28)
  const load = new Map<ID, number>()
  d.members.forEach(m => load.set(m.id, 0))
  for (const t of d.tasks) {
    if (t.status === 'done' && t.completedBy && t.completedAt && t.completedAt.slice(0, 10) >= since) {
      load.set(t.completedBy, (load.get(t.completedBy) ?? 0) + t.effort)
    } else if (t.status !== 'done' && t.status !== 'dropped' && t.assigneeId) {
      // відкриті теж вважаємо навантаженням, інакше при рівному рахунку все падає на першого
      load.set(t.assigneeId, (load.get(t.assigneeId) ?? 0) + t.effort)
    }
  }
  return [...load.entries()].sort((a, b) => a[1] - b[1])[0]?.[0]
}

function expandDates(
  freq: string, byMonthDay: number | undefined, byDay: number[] | undefined,
  byMonth: number | undefined, anchor: string, from: string, to: string,
): string[] {
  const out: string[] = []
  const a = parse(anchor)

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
        if (date >= from && date <= to) out.push(date)
      }
      cur.setMonth(cur.getMonth() + 1)
    }
  } else if (freq === 'weekly') {
    const days = byDay?.length ? byDay : [isoDow(anchor)]
    for (let d = from; d <= to; d = addDays(d, 1)) {
      if (days.includes(isoDow(d))) out.push(d)
    }
  } else if (freq === 'daily') {
    for (let d = from; d <= to; d = addDays(d, 1)) out.push(d)
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
      const actual = d.entries
        .filter(x => x.kind === 'expense' && x.envelopeId === e.id && monthKey(x.occurredOn) === month)
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
  // на графіку часу: скільки мало б бути зібрано на цей момент
  const elapsed = f.dueDate && target
    ? Math.max(0, Math.min(1, 1 - (monthsLeft - 1) / Math.max(1, monthsUntil(f.dueDate, iso(new Date(new Date().setMonth(new Date().getMonth() - 12)))))))
    : 0
  const onTrack = !target || balance >= target * elapsed
  return { fund: f, balance, target, monthsLeft, required, progress, onTrack }
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

  const obligationsLeft = d.occurrences
    .filter(o => monthKey(o.dueDate) === month && (o.status === 'due' || o.status === 'projected'))
    .reduce((s, o) => s + o.expectedMinor, 0)

  const fundsRequired = d.funds
    .filter(f => !f.archived)
    .reduce((s, f) => s + fundStatus(d, f.id).required, 0)

  const spentVariable = d.entries
    .filter(e => e.kind === 'expense' && monthKey(e.occurredOn) === month && !e.occurrenceId)
    .reduce((s, e) => s + e.amountBaseMinor, 0)

  const free = income - obligationsLeft - fundsRequired - spentVariable
  return { income, obligationsLeft, fundsRequired, spentVariable, free }
}

export function fairness(d: DB) {
  const since = addDays(today(), -28)
  return d.members.map(m => ({
    member: m,
    done: d.tasks.filter(t => t.status === 'done' && t.completedBy === m.id && (t.completedAt ?? '') .slice(0, 10) >= since)
      .reduce((s, t) => s + t.effort, 0),
    created: d.tasks.filter(t => t.createdBy === m.id && t.createdAt.slice(0, 10) >= since).length,
  }))
}

/* ───────────────────────── дії ───────────────────────── */

export function confirmOccurrence(id: ID, amountMinor?: number, paidOn?: string) {
  mutate(d => {
    const o = d.occurrences.find(x => x.id === id)
    if (!o || o.status === 'paid') return
    const amt = amountMinor ?? o.expectedMinor
    const on = paidOn ?? today()
    const rate = o.currency === 'UAH' ? 1 : d.rates[o.currency]

    const entryId = uid()
    d.entries.push({
      id: entryId, kind: 'expense', occurredOn: on, amountMinor: amt, currency: o.currency,
      rateToBase: rate, amountBaseMinor: Math.round(amt * rate),
      envelopeId: o.envelopeId, occurrenceId: o.id, note: o.name, createdBy: d.meId,
    })
    o.status = 'paid'; o.paidOn = on; o.actualMinor = amt; o.paidBy = d.meId

    // фінансується фондом → списуємо з фонду, а не рахуємо витрату двічі
    const plan = d.recurringPlans.find(p => p.id === o.planId)
    if (plan?.fundId) {
      d.entries.push({
        id: uid(), kind: 'fund_out', occurredOn: on, amountMinor: amt, currency: o.currency,
        rateToBase: rate, amountBaseMinor: Math.round(amt * rate),
        fundId: plan.fundId, occurrenceId: o.id, note: o.name, createdBy: d.meId,
      })
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

export function addShoppingItem(name: string, category?: string) {
  mutate(d => {
    const prev = d.shoppingItems.find(i => i.name.toLowerCase() === name.toLowerCase() && i.category)
    d.shoppingItems.push({
      id: uid(), name, category: category ?? prev?.category ?? 'Інше',
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
    d.shoppingItems = d.shoppingItems.filter(i => !i.checkedAt)
  })
}

export function upcomingOccurrences(d: DB, days = 7): Occurrence[] {
  const to = addDays(today(), days)
  return d.occurrences
    .filter(o => (o.status === 'due' || o.status === 'projected') && o.dueDate <= to)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
}
