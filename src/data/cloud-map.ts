import type {
  DB, Debt, Entry, Envelope, Fund, Occurrence, PlanLine,
  RecurringPlan, ShoppingItem, Task, TaskTemplate, Trip,
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
  /** Ключ рядка. У всіх, крім planLines, це id. */
  idOf?: (x: any) => string
  /** Конфлікт-таргет для upsert, якщо ключ не id. */
  onConflict?: string
}

const nn = <T>(v: T | null | undefined): T | undefined => (v ?? undefined)

export const ENVELOPES: Entity<'envelopes'> = {
  key: 'envelopes', table: 'envelopes',
  columns: 'id, name, kind, owner_id, sort_order, is_archived',
  toRow: (e: Envelope, h) => ({
    id: e.id, household_id: h, name: e.name, kind: e.kind,
    owner_id: e.ownerId ?? null, sort_order: e.sortOrder, is_archived: !!e.archived,
  }),
  fromRow: (r): Envelope => ({
    id: r.id, name: r.name, kind: r.kind, ownerId: nn(r.owner_id),
    sortOrder: r.sort_order, archived: r.is_archived || undefined,
  }),
}

export const PLAN_LINES: Entity<'planLines'> = {
  key: 'planLines', table: 'plan_lines',
  columns: 'envelope_id, period_month, planned_minor',
  // у plan_lines немає id — ключ складений
  idOf: (p: PlanLine) => `${p.envelopeId}|${p.month}`,
  onConflict: 'envelope_id,period_month',
  toRow: (p: PlanLine, h) => ({
    household_id: h, envelope_id: p.envelopeId,
    period_month: p.month + '-01', planned_minor: p.plannedMinor,
  }),
  fromRow: (r): PlanLine => ({
    envelopeId: r.envelope_id, month: String(r.period_month).slice(0, 7),
    plannedMinor: r.planned_minor,
  }),
}

export const RECURRING: Entity<'recurringPlans'> = {
  key: 'recurringPlans', table: 'recurring_plans',
  columns: 'id, name, envelope_id, expected_amount_minor, currency, amount_mode, freq, bymonthday, byday, bymonth, anchor_date, assignee_id, fund_id, debt_id, is_active',
  toRow: (p: RecurringPlan, h) => ({
    id: p.id, household_id: h, name: p.name, envelope_id: p.envelopeId,
    expected_amount_minor: p.expectedMinor, currency: p.currency,
    amount_mode: p.amountMode, freq: p.freq,
    bymonthday: p.byMonthDay ?? null, byday: p.byDay ?? null, bymonth: p.byMonth ?? null,
    anchor_date: p.anchorDate, assignee_id: p.assigneeId ?? null,
    fund_id: p.fundId ?? null, debt_id: p.debtId ?? null, is_active: p.active,
  }),
  fromRow: (r): RecurringPlan => ({
    id: r.id, name: r.name, envelopeId: r.envelope_id,
    expectedMinor: r.expected_amount_minor, currency: r.currency,
    amountMode: r.amount_mode, freq: r.freq,
    byMonthDay: nn(r.bymonthday), byDay: nn(r.byday), byMonth: nn(r.bymonth),
    anchorDate: String(r.anchor_date).slice(0, 10), assigneeId: nn(r.assignee_id),
    fundId: nn(r.fund_id), debtId: nn(r.debt_id), active: r.is_active,
  }),
}

export const OCCURRENCES: Entity<'occurrences'> = {
  key: 'occurrences', table: 'occurrences',
  columns: 'id, recurring_plan_id, envelope_id, name, due_date, expected_amount_minor, currency, status, assignee_id, paid_on, actual_amount_minor, paid_by, note',
  toRow: (o: Occurrence, h) => ({
    id: o.id, household_id: h, recurring_plan_id: o.planId ?? null,
    envelope_id: o.envelopeId, name: o.name, due_date: o.dueDate,
    expected_amount_minor: o.expectedMinor, currency: o.currency, status: o.status,
    assignee_id: o.assigneeId ?? null, paid_on: o.paidOn ?? null,
    actual_amount_minor: o.actualMinor ?? null, paid_by: o.paidBy ?? null, note: o.note ?? null,
  }),
  fromRow: (r): Occurrence => ({
    id: r.id, planId: nn(r.recurring_plan_id), envelopeId: r.envelope_id, name: r.name,
    dueDate: String(r.due_date).slice(0, 10), expectedMinor: r.expected_amount_minor,
    currency: r.currency, status: r.status, assigneeId: nn(r.assignee_id),
    paidOn: r.paid_on ? String(r.paid_on).slice(0, 10) : undefined,
    actualMinor: nn(r.actual_amount_minor), paidBy: nn(r.paid_by), note: nn(r.note),
  }),
}

export const ENTRIES: Entity<'entries'> = {
  key: 'entries', table: 'entries',
  columns: 'id, kind, occurred_on, amount_minor, currency, fx_rate_to_base, amount_base_minor, envelope_id, fund_id, debt_id, occurrence_id, trip_id, note, created_by',
  toRow: (e: Entry, h) => ({
    id: e.id, household_id: h, kind: e.kind, occurred_on: e.occurredOn,
    amount_minor: e.amountMinor, currency: e.currency,
    fx_rate_to_base: e.rateToBase, amount_base_minor: e.amountBaseMinor,
    envelope_id: e.envelopeId ?? null, fund_id: e.fundId ?? null, debt_id: e.debtId ?? null,
    occurrence_id: e.occurrenceId ?? null, trip_id: e.tripId ?? null,
    note: e.note ?? null, created_by: e.createdBy,
  }),
  fromRow: (r): Entry => ({
    id: r.id, kind: r.kind, occurredOn: String(r.occurred_on).slice(0, 10),
    amountMinor: r.amount_minor, currency: r.currency,
    rateToBase: Number(r.fx_rate_to_base), amountBaseMinor: r.amount_base_minor,
    envelopeId: nn(r.envelope_id), fundId: nn(r.fund_id), debtId: nn(r.debt_id),
    occurrenceId: nn(r.occurrence_id), tripId: nn(r.trip_id),
    note: nn(r.note), createdBy: r.created_by,
  }),
}

export const FUNDS: Entity<'funds'> = {
  key: 'funds', table: 'funds',
  columns: 'id, name, kind, currency, target_amount_minor, due_date, monthly_fixed_minor, buffer_pct, linked_recurring_plan_id, priority, is_archived',
  toRow: (f: Fund, h) => ({
    id: f.id, household_id: h, name: f.name, kind: f.kind, currency: f.currency,
    target_amount_minor: f.targetMinor ?? null, due_date: f.dueDate ?? null,
    monthly_fixed_minor: f.monthlyFixedMinor ?? null, buffer_pct: f.bufferPct ?? 0,
    linked_recurring_plan_id: f.linkedPlanId ?? null, priority: f.priority, is_archived: !!f.archived,
  }),
  fromRow: (r): Fund => ({
    id: r.id, name: r.name, kind: r.kind, currency: r.currency,
    targetMinor: nn(r.target_amount_minor),
    dueDate: r.due_date ? String(r.due_date).slice(0, 10) : undefined,
    monthlyFixedMinor: nn(r.monthly_fixed_minor), bufferPct: nn(r.buffer_pct),
    linkedPlanId: nn(r.linked_recurring_plan_id), priority: r.priority,
    archived: r.is_archived || undefined,
  }),
}

export const DEBTS: Entity<'debts'> = {
  key: 'debts', table: 'debts',
  columns: 'id, name, counterparty, principal_minor, currency, monthly_payment_minor, target_date, opened_on, closed_on',
  toRow: (d: Debt, h) => ({
    id: d.id, household_id: h, name: d.name, counterparty: d.counterparty ?? null,
    principal_minor: d.principalMinor, currency: d.currency,
    monthly_payment_minor: d.monthlyPaymentMinor ?? null,
    target_date: d.targetDate ?? null, opened_on: d.openedOn, closed_on: d.closedOn ?? null,
  }),
  fromRow: (r): Debt => ({
    id: r.id, name: r.name, counterparty: nn(r.counterparty),
    principalMinor: r.principal_minor, currency: r.currency,
    monthlyPaymentMinor: nn(r.monthly_payment_minor),
    targetDate: r.target_date ? String(r.target_date).slice(0, 10) : undefined,
    openedOn: String(r.opened_on).slice(0, 10),
    closedOn: r.closed_on ? String(r.closed_on).slice(0, 10) : undefined,
  }),
}

export const TEMPLATES: Entity<'taskTemplates'> = {
  key: 'taskTemplates', table: 'task_templates',
  columns: 'id, title, area, effort, schedule_kind, freq, byday, bymonthday, interval_days, last_completed_at, rotation, default_assignee_id, is_active',
  toRow: (t: TaskTemplate, h) => ({
    id: t.id, household_id: h, title: t.title, area: t.area ?? null, effort: t.effort,
    schedule_kind: t.scheduleKind, freq: t.freq ?? null, byday: t.byDay ?? null,
    bymonthday: t.byMonthDay ?? null, interval_days: t.intervalDays ?? null,
    last_completed_at: t.lastCompletedAt ?? null, rotation: t.rotation,
    default_assignee_id: t.defaultAssigneeId ?? null, is_active: t.active,
  }),
  fromRow: (r): TaskTemplate => ({
    id: r.id, title: r.title, area: nn(r.area), effort: r.effort,
    scheduleKind: r.schedule_kind, freq: nn(r.freq), byDay: nn(r.byday),
    byMonthDay: nn(r.bymonthday), intervalDays: nn(r.interval_days),
    lastCompletedAt: nn(r.last_completed_at), rotation: r.rotation,
    defaultAssigneeId: nn(r.default_assignee_id), active: r.is_active,
  }),
}

export const TASKS: Entity<'tasks'> = {
  key: 'tasks', table: 'tasks',
  columns: 'id, template_id, occurrence_key, title, notes, status, priority, assignee_id, area, due_date, defer_until, effort, parent_id, created_by, created_at, completed_at, completed_by',
  toRow: (t: Task, h) => ({
    id: t.id, household_id: h, template_id: t.templateId ?? null,
    occurrence_key: t.occurrenceKey ?? null, title: t.title, notes: t.notes ?? null,
    status: t.status, priority: t.priority, assignee_id: t.assigneeId ?? null,
    area: t.area ?? null, due_date: t.dueDate ?? null, defer_until: t.deferUntil ?? null,
    effort: t.effort, parent_id: t.parentId ?? null, created_by: t.createdBy,
    created_at: t.createdAt, completed_at: t.completedAt ?? null,
    completed_by: t.completedBy ?? null,
  }),
  fromRow: (r): Task => ({
    id: r.id, templateId: nn(r.template_id), occurrenceKey: nn(r.occurrence_key),
    title: r.title, notes: nn(r.notes), status: r.status, priority: r.priority,
    assigneeId: nn(r.assignee_id), area: nn(r.area),
    dueDate: r.due_date ? String(r.due_date).slice(0, 10) : undefined,
    deferUntil: r.defer_until ? String(r.defer_until).slice(0, 10) : undefined,
    effort: r.effort, parentId: nn(r.parent_id), createdBy: r.created_by,
    createdAt: r.created_at, completedAt: nn(r.completed_at), completedBy: nn(r.completed_by),
  }),
}

export const TRIPS: Entity<'trips'> = {
  key: 'trips', table: 'shopping_trips',
  columns: 'id, store, shopped_by, completed_at, total_minor, currency',
  toRow: (t: Trip, h) => ({
    id: t.id, household_id: h, store: t.store ?? null, shopped_by: t.shoppedBy,
    completed_at: t.completedAt, total_minor: t.totalMinor, currency: t.currency,
  }),
  fromRow: (r): Trip => ({
    id: r.id, store: nn(r.store), shoppedBy: r.shopped_by,
    completedAt: r.completed_at, totalMinor: r.total_minor, currency: r.currency,
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
 * Конверти → плани → платежі → записи. Походи перед товарами.
 */
export const ENTITIES = [
  ENVELOPES, PLAN_LINES, FUNDS, DEBTS, RECURRING, OCCURRENCES, ENTRIES,
  TEMPLATES, TASKS, TRIPS, SHOPPING,
] as const
