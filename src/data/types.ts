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

export type TaskStatus = 'backlog' | 'todo' | 'doing' | 'done' | 'dropped'
export type Priority = 0 | 1 | 2 | 3 | 4 // 0 = не проставлений, сортується ОСТАННІМ
export type OccurrenceStatus = 'projected' | 'due' | 'paid' | 'skipped'

/**
 * Рух грошей. Лише expense і repay — справжні витрати родини;
 * transfer — перекладання між власними кишенями, не витрата.
 */
export type EntryKind = 'income' | 'expense' | 'transfer' | 'repay'

/** Що проєкт робить із грошима. `none` — проєкт лише із задачами. */
export type ProjectDirection = 'spend' | 'save' | 'repay' | 'none'
export type ProjectStatus = 'active' | 'done' | 'archived'

export interface Member {
  id: ID
  name: string
  color: string
  initials: string
}

/**
 * Проєкт — єдина сутність замість конверта, фонду й боргу.
 * Різниця між ними — налаштування, а не тип. Баланс, прогрес і «треба
 * відкласти» рахуються із записів на читанні (інваріант 4).
 */
export interface Project extends Synced {
  id: ID
  name: string
  description?: string
  direction: ProjectDirection
  status: ProjectStatus
  /** Системний «Вільні гроші»: рівно один на дім, не видаляється. */
  isFree?: boolean
  currency: Currency
  startsOn?: string
  /** Порожнє — безстроковий. */
  endsOn?: string
  /** save: зібрати · spend: бюджет на весь час · repay: тіло боргу */
  targetMinor?: number
  /** spend: орієнтир на місяць · save: фіксований внесок · repay: платіж на місяць */
  monthlyMinor?: number
  bufferPct?: number
  counterparty?: string
  /** spend/repay: з якого накопичення платимо. Порожнє — з вільних. */
  sourceProjectId?: ID
  ownerId?: ID
  sortOrder: number
  pinned?: boolean
}

export type Freq = 'monthly' | 'weekly' | 'yearly' | 'daily'

export interface RecurringPlan extends Synced {
  id: ID
  name: string
  projectId: ID
  /** in — надходження (зарплата), out — платіж. Ефект оплати визначає проєкт. */
  flow: 'in' | 'out'
  expectedMinor: number
  currency: Currency
  amountMode: 'fixed' | 'variable'
  freq: Freq
  byMonthDay?: number
  byDay?: number[]      // 1=Пн .. 7=Нд
  byMonth?: number
  anchorDate: string    // ISO date
  assigneeId?: ID
  active: boolean
}

export interface Occurrence extends Synced {
  id: ID
  planId?: ID
  projectId: ID
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

export interface Entry extends Synced {
  id: ID
  kind: EntryKind
  occurredOn: string
  amountMinor: number
  currency: Currency
  rateToBase: number     // заморожений на момент запису
  amountBaseMinor: number
  /** income/transfer: куди · expense/repay: на який проєкт. Порожнє — «Вільні гроші». */
  projectId?: ID
  /** transfer: звідки. Порожнє — «Вільні гроші». */
  fromProjectId?: ID
  occurrenceId?: ID
  tripId?: ID
  note?: string
  createdBy: ID
}

export interface TaskTemplate extends Synced {
  id: ID
  title: string
  area?: string
  projectId?: ID
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
  projectId?: ID        // undefined = побут, без проєкту
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
  projectId?: ID
}

export interface Rates { USD: number; EUR: number }

export interface DB {
  members: Member[]
  projects: Project[]
  recurringPlans: RecurringPlan[]
  occurrences: Occurrence[]
  entries: Entry[]
  taskTemplates: TaskTemplate[]
  tasks: Task[]
  shoppingItems: ShoppingItem[]
  trips: Trip[]
  rates: Rates
  meId: ID
}
