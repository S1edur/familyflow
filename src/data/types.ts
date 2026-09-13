// Типи дзеркалять схему Postgres (sql/). Відповідність колонок тримає
// src/data/cloud-map.ts, і збірка звіряє її зі схемою (scripts/check-columns.mjs).

export type ID = string

/**
 * Поля синхронізації. Дзеркалять sql/07_sync.sql.
 *
 * Необовʼязкові навмисно: у локальному режимі без входу їх немає.
 *
 * updatedAt — ставить тригер у базі; клієнт лише читає (зараз — для платежів,
 *   як момент оплати в сповіщеннях). Конфлікти вирішує не він, а те, що
 *   синхронізація шле тільки змінені колонки (src/data/sync.ts).
 * deletedAt — мітка видалення в базі; локально видалений рядок просто зникає
 *   з масиву, а sync.ts перетворює це на мітку.
 */
export interface Synced {
  updatedAt?: string
  deletedAt?: string
}
export type Currency = 'UAH' | 'USD' | 'EUR'

export type EnvelopeKind =
  | 'income' | 'fixed' | 'variable' | 'sinking' | 'savings' | 'debt' | 'personal'

export type TaskStatus = 'backlog' | 'todo' | 'doing' | 'done' | 'dropped'
export type Priority = 0 | 1 | 2 | 3 | 4 // 0 = не проставлений, сортується ОСТАННІМ
export type OccurrenceStatus = 'projected' | 'due' | 'paid' | 'skipped'
export type FundKind = 'sinking' | 'goal' | 'emergency' | 'buffer'
export type EntryKind =
  | 'expense' | 'income' | 'fund_in' | 'fund_out' | 'debt_payment'

export interface Member {
  id: ID
  name: string
  color: string
  initials: string
}

export interface Envelope extends Synced {
  id: ID
  name: string
  kind: EnvelopeKind
  ownerId?: ID          // не порожнє => особистий конверт
  sortOrder: number
  archived?: boolean
}

export interface PlanLine extends Synced {
  envelopeId: ID
  month: string         // '2026-09'
  plannedMinor: number
}

export type Freq = 'monthly' | 'weekly' | 'yearly' | 'daily'

export interface RecurringPlan extends Synced {
  id: ID
  name: string
  envelopeId: ID
  expectedMinor: number
  currency: Currency
  amountMode: 'fixed' | 'variable'
  freq: Freq
  byMonthDay?: number
  byDay?: number[]      // 1=Пн .. 7=Нд
  byMonth?: number
  anchorDate: string    // ISO date
  assigneeId?: ID
  fundId?: ID           // фонд, який фінансує цей платіж
  debtId?: ID           // борг, який цей платіж гасить
  active: boolean
}

export interface Occurrence extends Synced {
  id: ID
  planId?: ID
  envelopeId: ID
  name: string
  dueDate: string       // ISO date
  expectedMinor: number
  currency: Currency
  status: OccurrenceStatus
  fundId?: ID           // фонд, який цей платіж ПОПОВНЮЄ (протилежне до RecurringPlan.fundId)
  assigneeId?: ID
  paidOn?: string
  actualMinor?: number
  paidBy?: ID
  note?: string
}

export interface Entry extends Synced {
  id: ID
  kind: EntryKind
  occurredOn: string
  amountMinor: number
  currency: Currency
  rateToBase: number     // заморожений на момент запису
  amountBaseMinor: number
  envelopeId?: ID
  fundId?: ID
  debtId?: ID
  occurrenceId?: ID
  tripId?: ID
  note?: string
  createdBy: ID
}

export interface Fund extends Synced {
  id: ID
  name: string
  kind: FundKind
  currency: Currency
  targetMinor?: number
  dueDate?: string
  monthlyFixedMinor?: number
  bufferPct?: number
  linkedPlanId?: ID
  envelopeId?: ID       // конверт, до якого належить внесок; порожній => не нагадуємо
  contributionDay?: number  // число місяця для нагадування, за замовчуванням 1
  priority: number
  archived?: boolean
}

export interface Debt extends Synced {
  id: ID
  name: string
  counterparty?: string
  principalMinor: number
  currency: Currency
  monthlyPaymentMinor?: number
  targetDate?: string
  openedOn: string
  closedOn?: string
}

export interface TaskTemplate extends Synced {
  id: ID
  title: string
  area?: string
  effort: 1 | 2 | 3
  scheduleKind: 'fixed' | 'after_completion'
  freq?: Freq
  byDay?: number[]
  byMonthDay?: number
  intervalDays?: number
  lastCompletedAt?: string
  rotation: 'none' | 'fixed' | 'least_loaded'
  defaultAssigneeId?: ID
  active: boolean
}

export interface Task extends Synced {
  id: ID
  templateId?: ID
  occurrenceKey?: string
  title: string
  notes?: string
  status: TaskStatus
  priority: Priority
  assigneeId?: ID       // undefined = вільна, хто візьме
  area?: string
  dueDate?: string
  deferUntil?: string
  effort: 1 | 2 | 3
  parentId?: ID
  createdBy: ID
  createdAt: string
  completedAt?: string
  completedBy?: ID
}

export interface ShoppingItem extends Synced {
  id: ID
  name: string
  qty?: string
  category?: string
  addedBy: ID
  addedAt: string
  checkedAt?: string
  checkedBy?: ID
  tripId?: ID
}

export interface Trip extends Synced {
  id: ID
  store?: string
  shoppedBy: ID
  completedAt: string
  totalMinor: number
  currency: Currency
}

export interface Rates { USD: number; EUR: number }

export interface DB {
  members: Member[]
  envelopes: Envelope[]
  planLines: PlanLine[]
  recurringPlans: RecurringPlan[]
  occurrences: Occurrence[]
  entries: Entry[]
  funds: Fund[]
  debts: Debt[]
  taskTemplates: TaskTemplate[]
  tasks: Task[]
  shoppingItems: ShoppingItem[]
  trips: Trip[]
  rates: Rates
  meId: ID
}
