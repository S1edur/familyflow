import type {
  DB, Entry, Occurrence, Project, RecurringPlan, ShoppingItem, Task, TaskTemplate, Trip,
} from './types'

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>

/**
 * Опис однієї сутності: як вона зветься в базі, які колонки читати,
 * і як перекладати в обидва боки.
 *
 * Декларативно навмисно: щоб додати сутність, треба додати запис, а не
 * писати ще один шматок логіки синхронізації.
 */
export interface Entity<K extends keyof DB> {
  key: K
  table: string
  columns: string
  toRow: (x: any, householdId: string) => Row
  fromRow: (r: Row) => any
  /** Ключ рядка, якщо це не id. */
  idOf?: (x: any) => string
  /** Конфлікт-таргет для upsert, якщо ключ не id. */
  onConflict?: string
}

const nn = <T>(v: T | null | undefined): T | undefined => (v ?? undefined)

const date = (v: unknown) => (v ? String(v).slice(0, 10) : undefined)

export const PROJECTS: Entity<'projects'> = {
  key: 'projects', table: 'projects',
  columns: 'id, name, description, direction, status, is_free, currency, starts_on, ends_on, target_minor, monthly_minor, buffer_pct, counterparty, source_project_id, owner_id, sort_order, pinned',
  toRow: (p: Project, h) => ({
    id: p.id, household_id: h, name: p.name, description: p.description ?? null,
    direction: p.direction, status: p.status, is_free: !!p.isFree, currency: p.currency,
    starts_on: p.startsOn ?? null, ends_on: p.endsOn ?? null,
    target_minor: p.targetMinor ?? null, monthly_minor: p.monthlyMinor ?? null,
    buffer_pct: p.bufferPct ?? null, counterparty: p.counterparty ?? null,
    source_project_id: p.sourceProjectId ?? null, owner_id: p.ownerId ?? null,
    sort_order: p.sortOrder, pinned: !!p.pinned,
  }),
  fromRow: (r): Project => ({
    id: r.id, name: r.name, description: nn(r.description),
    direction: r.direction, status: r.status, isFree: r.is_free || undefined, currency: r.currency,
    startsOn: date(r.starts_on), endsOn: date(r.ends_on),
    targetMinor: nn(r.target_minor), monthlyMinor: nn(r.monthly_minor),
    bufferPct: r.buffer_pct == null ? undefined : Number(r.buffer_pct),
    counterparty: nn(r.counterparty), sourceProjectId: nn(r.source_project_id),
    ownerId: nn(r.owner_id), sortOrder: r.sort_order, pinned: r.pinned || undefined,
  }),
}

export const RECURRING: Entity<'recurringPlans'> = {
  key: 'recurringPlans', table: 'recurring_plans',
  columns: 'id, name, project_id, flow, expected_amount_minor, currency, amount_mode, freq, bymonthday, byday, bymonth, anchor_date, assignee_id, is_active',
  toRow: (p: RecurringPlan, h) => ({
    id: p.id, household_id: h, name: p.name, project_id: p.projectId, flow: p.flow,
    expected_amount_minor: p.expectedMinor, currency: p.currency, amount_mode: p.amountMode,
    freq: p.freq, bymonthday: p.byMonthDay ?? null, byday: p.byDay ?? null, bymonth: p.byMonth ?? null,
    anchor_date: p.anchorDate, assignee_id: p.assigneeId ?? null, is_active: p.active,
  }),
  fromRow: (r): RecurringPlan => ({
    id: r.id, name: r.name, projectId: r.project_id, flow: r.flow ?? 'out',
    expectedMinor: r.expected_amount_minor, currency: r.currency, amountMode: r.amount_mode,
    freq: r.freq, byMonthDay: nn(r.bymonthday), byDay: nn(r.byday), byMonth: nn(r.bymonth),
    anchorDate: String(r.anchor_date).slice(0, 10), assigneeId: nn(r.assignee_id), active: r.is_active,
  }),
}

// updated_at лише читаємо (ставить тригер): момент оплати для «уже оплачено»
export const OCCURRENCES: Entity<'occurrences'> = {
  key: 'occurrences', table: 'occurrences',
  columns: 'id, recurring_plan_id, project_id, name, due_date, expected_amount_minor, currency, status, assignee_id, paid_on, actual_amount_minor, paid_by, note, updated_at',
  toRow: (o: Occurrence, h) => ({
    id: o.id, household_id: h, recurring_plan_id: o.planId ?? null, project_id: o.projectId,
    name: o.name, due_date: o.dueDate, expected_amount_minor: o.expectedMinor, currency: o.currency,
    status: o.status, assignee_id: o.assigneeId ?? null, paid_on: o.paidOn ?? null,
    actual_amount_minor: o.actualMinor ?? null, paid_by: o.paidBy ?? null, note: o.note ?? null,
  }),
  fromRow: (r): Occurrence => ({
    id: r.id, planId: nn(r.recurring_plan_id), projectId: r.project_id, name: r.name,
    dueDate: String(r.due_date).slice(0, 10), expectedMinor: r.expected_amount_minor,
    currency: r.currency, status: r.status, assigneeId: nn(r.assignee_id),
    paidOn: date(r.paid_on), actualMinor: nn(r.actual_amount_minor), paidBy: nn(r.paid_by),
    note: nn(r.note), updatedAt: nn(r.updated_at),
  }),
}

export const ENTRIES: Entity<'entries'> = {
  key: 'entries', table: 'entries',
  columns: 'id, kind, occurred_on, amount_minor, currency, fx_rate_to_base, amount_base_minor, project_id, from_project_id, occurrence_id, trip_id, note, created_by',
  toRow: (e: Entry, h) => ({
    id: e.id, household_id: h, kind: e.kind, occurred_on: e.occurredOn,
    amount_minor: e.amountMinor, currency: e.currency, fx_rate_to_base: e.rateToBase,
    amount_base_minor: e.amountBaseMinor, project_id: e.projectId ?? null,
    from_project_id: e.fromProjectId ?? null, occurrence_id: e.occurrenceId ?? null,
    trip_id: e.tripId ?? null, note: e.note ?? null, created_by: e.createdBy,
  }),
  fromRow: (r): Entry => ({
    id: r.id, kind: r.kind, occurredOn: String(r.occurred_on).slice(0, 10),
    amountMinor: r.amount_minor, currency: r.currency, rateToBase: Number(r.fx_rate_to_base),
    amountBaseMinor: r.amount_base_minor, projectId: nn(r.project_id),
    fromProjectId: nn(r.from_project_id), occurrenceId: nn(r.occurrence_id),
    tripId: nn(r.trip_id), note: nn(r.note), createdBy: r.created_by,
  }),
}

export const TEMPLATES: Entity<'taskTemplates'> = {
  key: 'taskTemplates', table: 'task_templates',
  columns: 'id, title, area, project_id, effort, schedule_kind, freq, byday, bymonthday, interval_days, last_completed_at, rotation, default_assignee_id, is_active',
  toRow: (t: TaskTemplate, h) => ({
    id: t.id, household_id: h, title: t.title, area: t.area ?? null,
    project_id: t.projectId ?? null, effort: t.effort,
    schedule_kind: t.scheduleKind, freq: t.freq ?? null, byday: t.byDay ?? null,
    bymonthday: t.byMonthDay ?? null, interval_days: t.intervalDays ?? null,
    last_completed_at: t.lastCompletedAt ?? null, rotation: t.rotation,
    default_assignee_id: t.defaultAssigneeId ?? null, is_active: t.active,
  }),
  fromRow: (r): TaskTemplate => ({
    id: r.id, title: r.title, area: nn(r.area), projectId: nn(r.project_id), effort: r.effort,
    scheduleKind: r.schedule_kind, freq: nn(r.freq), byDay: nn(r.byday),
    byMonthDay: nn(r.bymonthday), intervalDays: nn(r.interval_days),
    lastCompletedAt: nn(r.last_completed_at), rotation: r.rotation,
    defaultAssigneeId: nn(r.default_assignee_id), active: r.is_active,
  }),
}

export const TASKS: Entity<'tasks'> = {
  key: 'tasks', table: 'tasks',
  columns: 'id, template_id, occurrence_key, title, notes, status, priority, assignee_id, area, project_id, due_date, defer_until, effort, parent_id, created_by, created_at, completed_at, completed_by',
  toRow: (t: Task, h) => ({
    id: t.id, household_id: h, template_id: t.templateId ?? null,
    occurrence_key: t.occurrenceKey ?? null, title: t.title, notes: t.notes ?? null,
    status: t.status, priority: t.priority, assignee_id: t.assigneeId ?? null,
    area: t.area ?? null, project_id: t.projectId ?? null,
    due_date: t.dueDate ?? null, defer_until: t.deferUntil ?? null,
    effort: t.effort, parent_id: t.parentId ?? null, created_by: t.createdBy,
    created_at: t.createdAt, completed_at: t.completedAt ?? null,
    completed_by: t.completedBy ?? null,
  }),
  fromRow: (r): Task => ({
    id: r.id, templateId: nn(r.template_id), occurrenceKey: nn(r.occurrence_key),
    title: r.title, notes: nn(r.notes), status: r.status, priority: r.priority,
    assigneeId: nn(r.assignee_id), area: nn(r.area), projectId: nn(r.project_id),
    dueDate: r.due_date ? String(r.due_date).slice(0, 10) : undefined,
    deferUntil: r.defer_until ? String(r.defer_until).slice(0, 10) : undefined,
    effort: r.effort, parentId: nn(r.parent_id), createdBy: r.created_by,
    createdAt: r.created_at, completedAt: nn(r.completed_at), completedBy: nn(r.completed_by),
  }),
}

export const TRIPS: Entity<'trips'> = {
  key: 'trips', table: 'shopping_trips',
  columns: 'id, store, shopped_by, completed_at, total_minor, currency, project_id',
  toRow: (t: Trip, h) => ({
    id: t.id, household_id: h, store: t.store ?? null, shopped_by: t.shoppedBy,
    completed_at: t.completedAt, total_minor: t.totalMinor, currency: t.currency,
    project_id: t.projectId ?? null,
  }),
  fromRow: (r): Trip => ({
    id: r.id, store: nn(r.store), shoppedBy: r.shopped_by,
    completedAt: r.completed_at, totalMinor: r.total_minor, currency: r.currency,
    projectId: nn(r.project_id),
  }),
}

export const SHOPPING: Entity<'shoppingItems'> = {
  key: 'shoppingItems', table: 'shopping_items',
  columns: 'id, name, qty, category, added_by, added_at, checked_at, checked_by, trip_id',
  toRow: (i: ShoppingItem, h) => ({
    id: i.id, household_id: h, name: i.name, qty: i.qty ?? null,
    category: i.category ?? null, added_by: i.addedBy, added_at: i.addedAt,
    checked_at: i.checkedAt ?? null, checked_by: i.checkedBy ?? null,
    trip_id: i.tripId ?? null,
  }),
  fromRow: (r): ShoppingItem => ({
    id: r.id, name: r.name, qty: nn(r.qty), category: nn(r.category),
    addedBy: r.added_by, addedAt: r.added_at,
    checkedAt: nn(r.checked_at), checkedBy: nn(r.checked_by), tripId: nn(r.trip_id),
  }),
}

/**
 * Порядок важливий: батьки перед дітьми, бо зовнішні ключі.
 * Проєкти → правила → платежі → записи. Походи перед товарами.
 */
export const ENTITIES = [
  PROJECTS, RECURRING, OCCURRENCES, TEMPLATES, TASKS, TRIPS, ENTRIES, SHOPPING,
] as const
