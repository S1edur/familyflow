import type { DB } from './types'
import { addDays, iso, today } from '../lib/dates'

const ME = 'm1'
const HER = 'm2'
const t = today()
const y = new Date().getFullYear()

/**
 * Порожній старт для справжнього дому. Демо-дані (seed) лишаються тільки
 * для режиму без входу — офлайнової однофайлової збірки.
 * Конверти сюди не кладемо: їх створює create_household у базі.
 */
export function emptyDB(): DB {
  return {
    meId: ME,
    rates: { USD: 41.6, EUR: 45.1 },
    members: [],
    envelopes: [], planLines: [], recurringPlans: [], occurrences: [], entries: [],
    funds: [], debts: [], taskTemplates: [], tasks: [], shoppingItems: [], trips: [],
  }
}

export function seed(): DB {
  return {
    meId: ME,
    rates: { USD: 41.6, EUR: 45.1 },
    members: [
      { id: ME,  name: 'Денис', initials: 'Д', color: '#0F6B5C' },
      { id: HER, name: 'Іра',   initials: 'І', color: '#8F5514' },
    ],
    envelopes: [
      { id: 'e0',  name: 'Дохід',              kind: 'income',   sortOrder: 0 },
      { id: 'e1',  name: 'Оренда',             kind: 'fixed',    sortOrder: 10 },
      { id: 'e2',  name: 'Комуналка',          kind: 'fixed',    sortOrder: 20 },
      { id: 'e3',  name: 'Зв’язок та інтернет',kind: 'fixed',    sortOrder: 30 },
      { id: 'e4',  name: 'Підписки',           kind: 'fixed',    sortOrder: 40 },
      { id: 'e5',  name: 'Продукти',           kind: 'variable', sortOrder: 50 },
      { id: 'e6',  name: 'Транспорт',          kind: 'variable', sortOrder: 60 },
      { id: 'e7',  name: 'Дім і побут',        kind: 'variable', sortOrder: 70 },
      { id: 'e8',  name: 'Здоров’я',           kind: 'variable', sortOrder: 80 },
      { id: 'e9',  name: 'Розваги',            kind: 'variable', sortOrder: 90 },
      { id: 'e10', name: 'Кишенькові — Денис', kind: 'personal', ownerId: ME,  sortOrder: 100 },
      { id: 'e11', name: 'Кишенькові — Іра',   kind: 'personal', ownerId: HER, sortOrder: 110 },
      { id: 'e12', name: 'Нерегулярне',        kind: 'sinking',  sortOrder: 120 },
      { id: 'e13', name: 'Накопичення',        kind: 'savings',  sortOrder: 130 },
      { id: 'e14', name: 'Борги',              kind: 'debt',     sortOrder: 140 },
    ],
    planLines: [
      { envelopeId: 'e0',  month: mk(0), plannedMinor: 9_200_000 },
      { envelopeId: 'e1',  month: mk(0), plannedMinor: 2_500_000 },
      { envelopeId: 'e2',  month: mk(0), plannedMinor:   180_000 },
      { envelopeId: 'e3',  month: mk(0), plannedMinor:    80_000 },
      { envelopeId: 'e4',  month: mk(0), plannedMinor:    45_000 },
      { envelopeId: 'e5',  month: mk(0), plannedMinor: 1_800_000 },
      { envelopeId: 'e6',  month: mk(0), plannedMinor:   600_000 },
      { envelopeId: 'e7',  month: mk(0), plannedMinor:   400_000 },
      { envelopeId: 'e8',  month: mk(0), plannedMinor:   300_000 },
      { envelopeId: 'e9',  month: mk(0), plannedMinor:   500_000 },
      { envelopeId: 'e10', month: mk(0), plannedMinor:   400_000 },
      { envelopeId: 'e11', month: mk(0), plannedMinor:   400_000 },
    ],
    recurringPlans: [
      { id: 'r0', name: 'Зарплата',      envelopeId: 'e0', expectedMinor: 9_200_000, currency: 'UAH', amountMode: 'fixed',    freq: 'monthly', byMonthDay: 1,  anchorDate: `${mk(1)}-01`, assigneeId: ME,  active: true },
      { id: 'r1', name: 'Оренда',        envelopeId: 'e1', expectedMinor: 2_500_000, currency: 'UAH', amountMode: 'fixed',    freq: 'monthly', byMonthDay: 5,  anchorDate: `${y}-01-05`, assigneeId: ME,  active: true },
      { id: 'r2', name: 'Комуналка',     envelopeId: 'e2', expectedMinor:   180_000, currency: 'UAH', amountMode: 'variable', freq: 'monthly', byMonthDay: 20, anchorDate: `${y}-01-20`, assigneeId: HER, active: true },
      { id: 'r3', name: 'Інтернет',      envelopeId: 'e3', expectedMinor:    50_000, currency: 'UAH', amountMode: 'fixed',    freq: 'monthly', byMonthDay: 10, anchorDate: `${y}-01-10`, assigneeId: ME,  active: true },
      { id: 'r4', name: 'Мобільний ×2',  envelopeId: 'e3', expectedMinor:    30_000, currency: 'UAH', amountMode: 'fixed',    freq: 'monthly', byMonthDay: 12, anchorDate: `${y}-01-12`, active: true },
      { id: 'r5', name: 'Підписки',      envelopeId: 'e4', expectedMinor:    45_000, currency: 'UAH', amountMode: 'fixed',    freq: 'monthly', byMonthDay: 3,  anchorDate: `${y}-01-03`, assigneeId: ME,  active: true },
      { id: 'r6', name: 'Спортзал Іра',  envelopeId: 'e8', expectedMinor:    90_000, currency: 'UAH', amountMode: 'fixed',    freq: 'monthly', byMonthDay: 8,  anchorDate: `${y}-01-08`, assigneeId: HER, active: true },
      { id: 'r7', name: 'Страховка авто',envelopeId: 'e12',expectedMinor: 1_400_000, currency: 'UAH', amountMode: 'fixed',    freq: 'yearly',  byMonth: 2, byMonthDay: 12, anchorDate: `${y}-02-12`, fundId: 'f1', active: true },
      { id: 'r8', name: 'Платіж батькам',envelopeId: 'e14',expectedMinor:   500_000, currency: 'UAH', amountMode: 'fixed',    freq: 'monthly', byMonthDay: 25, anchorDate: `${y}-01-25`, assigneeId: ME,  debtId: 'd1', active: true },
    ],
    occurrences: [],
    entries: [
      entry('en1', 'expense', addDays(t, -12), 1_650_00, 'e5', 'Сільпо'),
      entry('en2', 'expense', addDays(t, -8),  2_140_00, 'e5', 'АТБ, великий закуп'),
      entry('en3', 'expense', addDays(t, -5),  1_200_00, 'e6', 'Заправка'),
      entry('en4', 'expense', addDays(t, -3),    380_00, 'e9', 'Кава з Ірою'),
      entry('en5', 'expense', addDays(t, -2),    950_00, 'e7', 'Лампочки і фільтр'),
      { id: 'en6', kind: 'income', occurredOn: `${mk(0)}-01`, amountMinor: 9_200_000, currency: 'UAH', rateToBase: 1, amountBaseMinor: 9_200_000, envelopeId: 'e0', note: 'Дохід за місяць', createdBy: ME },
      { id: 'en7', kind: 'fund_in', occurredOn: addDays(t, -14), amountMinor: 300_000, currency: 'UAH', rateToBase: 1, amountBaseMinor: 300_000, fundId: 'f1', createdBy: ME },
      { id: 'en8', kind: 'fund_in', occurredOn: addDays(t, -14), amountMinor: 200_000, currency: 'UAH', rateToBase: 1, amountBaseMinor: 200_000, fundId: 'f4', createdBy: HER },
      { id: 'en9', kind: 'debt_payment', occurredOn: addDays(t, -40), amountMinor: 500_000, currency: 'UAH', rateToBase: 1, amountBaseMinor: 500_000, debtId: 'd1', createdBy: ME },
      { id: 'en10', kind: 'debt_payment', occurredOn: addDays(t, -10), amountMinor: 500_000, currency: 'UAH', rateToBase: 1, amountBaseMinor: 500_000, debtId: 'd1', createdBy: ME },
    ],
    funds: [
      { id: 'f1', name: 'Страховка авто', kind: 'sinking',   currency: 'UAH', targetMinor: 1_400_000, dueDate: `${y + 1}-02-12`, linkedPlanId: 'r7', bufferPct: 5,  priority: 10 },
      { id: 'f2', name: 'ТО авто',        kind: 'sinking',   currency: 'UAH', targetMinor:   800_000, dueDate: `${y + 1}-05-01`, bufferPct: 10, priority: 20 },
      { id: 'f3', name: 'Подарунки',      kind: 'sinking',   currency: 'UAH', targetMinor:   600_000, dueDate: `${y}-12-20`,     priority: 30 },
      { id: 'f4', name: 'Відпустка',      kind: 'goal',      currency: 'UAH', targetMinor: 5_000_000, dueDate: `${y + 1}-07-01`, bufferPct: 5,  priority: 40 },
      { id: 'f5', name: 'Подушка',        kind: 'emergency', currency: 'USD', monthlyFixedMinor: 10_000, priority: 50 },
    ],
    debts: [
      { id: 'd1', name: 'Позика в батьків', counterparty: 'Батьки', principalMinor: 6_000_000, currency: 'UAH', monthlyPaymentMinor: 500_000, openedOn: `${y}-03-01` },
    ],
    taskTemplates: [
      { id: 'tt1', title: 'Пропилососити',      area: 'Дім', effort: 2, scheduleKind: 'after_completion', intervalDays: 7,  rotation: 'least_loaded', active: true, lastCompletedAt: addDays(t, -6) },
      { id: 'tt2', title: 'Змінити постіль',    area: 'Дім', effort: 2, scheduleKind: 'after_completion', intervalDays: 14, rotation: 'least_loaded', active: true, lastCompletedAt: addDays(t, -13) },
      { id: 'tt3', title: 'Полити квіти',       area: 'Дім', effort: 1, scheduleKind: 'after_completion', intervalDays: 4,  rotation: 'least_loaded', active: true, lastCompletedAt: addDays(t, -4) },
      { id: 'tt4', title: 'Винести сміття',     area: 'Дім', effort: 1, scheduleKind: 'fixed', freq: 'weekly', byDay: [2, 5], rotation: 'least_loaded', active: true },
      { id: 'tt5', title: 'Помити холодильник', area: 'Дім', effort: 3, scheduleKind: 'after_completion', intervalDays: 60, rotation: 'least_loaded', active: true, lastCompletedAt: addDays(t, -55) },
    ],
    tasks: [
      task('t1', 'Записати авто на ТО',        { priority: 2, assigneeId: ME,  area: 'Авто',  dueDate: addDays(t, 3), effort: 1 }),
      task('t2', 'Продовжити страховку',        { priority: 1, assigneeId: ME,  area: 'Авто',  dueDate: addDays(t, 1), effort: 2 }),
      task('t3', 'Забрати посилку з відділення',{ priority: 3, assigneeId: HER, area: 'Адмін', dueDate: t,            effort: 1 }),
      task('t4', 'Розібрати комору',            { priority: 4, area: 'Дім', effort: 3 }),
      task('t5', 'Знайти майстра для крана',    { priority: 2, area: 'Дім', dueDate: addDays(t, 5), effort: 1 }),
      task('t6', 'Порахувати бюджет на відпустку', { priority: 3, assigneeId: HER, area: 'Гроші', effort: 2, status: 'doing' }),
      task('t7', 'Замовити фільтр для води',    { priority: 0, area: 'Дім', effort: 1, status: 'backlog' }),
      task('t8', 'Оновити документи на авто',   { priority: 0, area: 'Авто', effort: 2, status: 'backlog', deferUntil: addDays(t, 40) }),
    ],
    shoppingItems: [
      shop('s1', 'Молоко', '2 л', 'Молочне', ME),
      shop('s2', 'Хліб', undefined, 'Випічка', HER),
      shop('s3', 'Кава в зернах', '1 кг', 'Бакалія', ME),
      shop('s4', 'Яйця', '10 шт', 'Молочне', HER),
      shop('s5', 'Помідори', undefined, 'Овочі', HER),
      shop('s6', 'Пральний порошок', undefined, 'Побутове', ME),
    ],
    trips: [],
  }
}

function mk(offset: number) {
  const d = new Date()
  d.setMonth(d.getMonth() + offset)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function entry(id: string, kind: 'expense', on: string, minor: number, envelopeId: string, note?: string) {
  return { id, kind, occurredOn: on, amountMinor: minor, currency: 'UAH' as const, rateToBase: 1, amountBaseMinor: minor, envelopeId, note, createdBy: ME }
}

function task(id: string, title: string, rest: Partial<DB['tasks'][number]>): DB['tasks'][number] {
  return {
    id, title, status: 'todo', priority: 0, effort: 1,
    createdBy: rest.assigneeId ?? ME, createdAt: iso(new Date()),
    ...rest,
  } as DB['tasks'][number]
}

function shop(id: string, name: string, qty: string | undefined, category: string, by: string) {
  return { id, name, qty, category, addedBy: by, addedAt: new Date().toISOString() }
}
