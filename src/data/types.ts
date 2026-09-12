// Типи дзеркалять майбутню схему Postgres. Коли підключимо Supabase,
// зміниться тільки шар доступу — ці форми лишаються.

export type ID = string
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

export interface Envelope {
  id: ID
  name: string
  kind: EnvelopeKind
  ownerId?: ID          // не порожнє => особистий конверт
  sortOrder: number
  archived?: boolean
}

export interface PlanLine {
  envelopeId: ID
  month: string         // '2026-09'
  plannedMinor: number
}

export type Freq = 'monthly' | 'weekly' | 'yearly' | 'daily'

export interface RecurringPlan {
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
  active: boolean
}

export interface Occurrence {
  id: ID
  planId?: ID
  envelopeId: ID
  name: string
  dueDate: string       // ISO date
  expectedMinor: number
  currency: Currency
  status: OccurrenceStatus
  assigneeId?: ID
  paidOn?: string
  actualMinor?: number
  paidBy?: ID
  note?: string
}

export interface Entry {
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

export interface Fund {
  id: ID
  name: string
  kind: FundKind
  currency: Currency
  targetMinor?: number
  dueDate?: string
  monthlyFixedMinor?: number
  bufferPct?: number
  linkedPlanId?: ID
  priority: number
  archived?: boolean
}

export interface Debt {
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

export interface TaskTemplate {
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

export interface Task {
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

export interface ShoppingItem {
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

export interface Trip {
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
