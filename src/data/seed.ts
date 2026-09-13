import type { DB } from './types'
import { addDays, iso, today } from '../lib/dates'

const ME = 'm1'
/** Системний «Вільні гроші» в демо. У справжньому домі id дає база. */
const FREE = 'free'
const HER = 'm2'
const t = today()
const y = new Date().getFullYear()

/**
 * Порожній старт для справжнього дому. Демо-дані (seed) лишаються тільки
 * для режиму без входу — офлайнової однофайлової збірки.
 * Проєкти сюди не кладемо: «Вільні гроші» й стартові створює create_household у базі.
 */
export function emptyDB(): DB {
  return {
    meId: ME,
    rates: { USD: 41.6, EUR: 45.1 },
    members: [],
    projects: [], recurringPlans: [], occurrences: [], entries: [],
    taskTemplates: [], tasks: [], shoppingItems: [], trips: [],
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
    projects: [
      { id: FREE, name: 'Вільні гроші', direction: 'none', status: 'active', isFree: true, currency: 'UAH', sortOrder: 0 },

      { id: 'p1',  name: 'Житло',              direction: 'spend', status: 'active', currency: 'UAH', monthlyMinor: 2_680_000, sortOrder: 10, pinned: true },
      { id: 'p2',  name: 'Звʼязок і підписки', direction: 'spend', status: 'active', currency: 'UAH', monthlyMinor:   125_000, sortOrder: 20 },
      { id: 'p3',  name: 'Продукти',           direction: 'spend', status: 'active', currency: 'UAH', monthlyMinor: 1_800_000, sortOrder: 30, pinned: true },
      { id: 'p4',  name: 'Транспорт',          direction: 'spend', status: 'active', currency: 'UAH', monthlyMinor:   600_000, sortOrder: 40 },
      { id: 'p5',  name: 'Дім і побут',        direction: 'spend', status: 'active', currency: 'UAH', monthlyMinor:   400_000, sortOrder: 50 },
      { id: 'p6',  name: 'Здоровʼя',           direction: 'spend', status: 'active', currency: 'UAH', monthlyMinor:   300_000, sortOrder: 60 },
      { id: 'p7',  name: 'Розваги',            direction: 'spend', status: 'active', currency: 'UAH', monthlyMinor:   500_000, sortOrder: 70 },
      { id: 'p8',  name: 'Кишенькові — Денис', direction: 'spend', status: 'active', currency: 'UAH', monthlyMinor:   400_000, ownerId: ME,  sortOrder: 80 },
      { id: 'p9',  name: 'Кишенькові — Іра',   direction: 'spend', status: 'active', currency: 'UAH', monthlyMinor:   400_000, ownerId: HER, sortOrder: 90 },
      { id: 'p10', name: 'Ремонт кухні',       direction: 'spend', status: 'active', currency: 'UAH', targetMinor: 20_000_000, endsOn: `${y + 1}-09-01`,
        description: 'Нова кухня: плитка, меблі, заміна крана.', sortOrder: 100 },

      { id: 'f1', name: 'Страховка авто', direction: 'save', status: 'active', currency: 'UAH', targetMinor: 1_400_000, endsOn: `${y + 1}-02-12`, bufferPct: 5,  sortOrder: 200 },
      { id: 'f2', name: 'ТО авто',        direction: 'save', status: 'active', currency: 'UAH', targetMinor:   800_000, endsOn: `${y + 1}-05-01`, bufferPct: 10, sortOrder: 210 },
      { id: 'f4', name: 'Відпустка',      direction: 'save', status: 'active', currency: 'UAH', targetMinor: 5_000_000, endsOn: `${y + 1}-07-01`, bufferPct: 5,
        description: 'Два тижні на морі влітку.', sortOrder: 220, pinned: true },
      { id: 'f5', name: 'Подушка',        direction: 'save', status: 'active', currency: 'USD', monthlyMinor: 10_000, sortOrder: 230 },

      { id: 'd1', name: 'Позика в батьків', direction: 'repay', status: 'active', currency: 'UAH', counterparty: 'Батьки',
        targetMinor: 6_000_000, monthlyMinor: 500_000, startsOn: `${y}-03-01`, sortOrder: 300 },

      { id: 'x1', name: 'Документи на авто', direction: 'none', status: 'active', currency: 'UAH', endsOn: addDays(t, 60),
        description: 'Переоформити техпаспорт і страховку на нову адресу.', sortOrder: 400 },
    ],
    recurringPlans: [
      { id: 'r0', name: 'Зарплата',       projectId: FREE, flow: 'in',  expectedMinor: 9_200_000, currency: 'UAH', amountMode: 'fixed',    freq: 'monthly', byMonthDay: 1,  anchorDate: `${mk(1)}-01`, assigneeId: ME,  active: true },
      { id: 'r1', name: 'Оренда',         projectId: 'p1', flow: 'out', expectedMinor: 2_500_000, currency: 'UAH', amountMode: 'fixed',    freq: 'monthly', byMonthDay: 5,  anchorDate: `${y}-01-05`, assigneeId: ME,  active: true },
      { id: 'r2', name: 'Комуналка',      projectId: 'p1', flow: 'out', expectedMinor:   180_000, currency: 'UAH', amountMode: 'variable', freq: 'monthly', byMonthDay: 20, anchorDate: `${y}-01-20`, assigneeId: HER, active: true },
      { id: 'r3', name: 'Інтернет',       projectId: 'p2', flow: 'out', expectedMinor:    50_000, currency: 'UAH', amountMode: 'fixed',    freq: 'monthly', byMonthDay: 10, anchorDate: `${y}-01-10`, assigneeId: ME,  active: true },
      { id: 'r4', name: 'Мобільний ×2',   projectId: 'p2', flow: 'out', expectedMinor:    30_000, currency: 'UAH', amountMode: 'fixed',    freq: 'monthly', byMonthDay: 12, anchorDate: `${y}-01-12`, active: true },
      { id: 'r5', name: 'Підписки',       projectId: 'p2', flow: 'out', expectedMinor:    45_000, currency: 'UAH', amountMode: 'fixed',    freq: 'monthly', byMonthDay: 3,  anchorDate: `${y}-01-03`, assigneeId: ME,  active: true },
      { id: 'r6', name: 'Спортзал Іра',   projectId: 'p6', flow: 'out', expectedMinor:    90_000, currency: 'UAH', amountMode: 'fixed',    freq: 'monthly', byMonthDay: 8,  anchorDate: `${y}-01-08`, assigneeId: HER, active: true },
      { id: 'r7', name: 'Страховка авто', projectId: 'f1', flow: 'out', expectedMinor: 1_400_000, currency: 'UAH', amountMode: 'fixed',    freq: 'yearly',  byMonth: 2, byMonthDay: 12, anchorDate: `${y}-02-12`, active: true },
      { id: 'r8', name: 'Платіж батькам', projectId: 'd1', flow: 'out', expectedMinor:   500_000, currency: 'UAH', amountMode: 'fixed',    freq: 'monthly', byMonthDay: 25, anchorDate: `${y}-01-25`, assigneeId: ME,  active: true },
    ],
    occurrences: [],
    entries: [
      money_('en0', 'income',   addDays(t, -45), 6_500_000, { projectId: FREE, note: 'Стартовий залишок' }),
      money_('en6', 'income',   `${mk(0)}-01`,   9_200_000, { projectId: FREE, note: 'Зарплата' }),
      money_('en1', 'expense',  addDays(t, -12),   165_000, { projectId: 'p3', note: 'Сільпо' }),
      money_('en2', 'expense',  addDays(t, -8),    214_000, { projectId: 'p3', note: 'АТБ, великий закуп' }),
      money_('en3', 'expense',  addDays(t, -5),    120_000, { projectId: 'p4', note: 'Заправка' }),
      money_('en4', 'expense',  addDays(t, -3),     38_000, { projectId: 'p7', note: 'Кава з Ірою' }),
      money_('en5', 'expense',  addDays(t, -2),     95_000, { projectId: 'p5', note: 'Лампочки і фільтр' }),
      money_('en11', 'expense', addDays(t, -20), 3_800_000, { projectId: 'p10', note: 'Плитка' }),
      money_('en7', 'transfer', addDays(t, -14),   300_000, { projectId: 'f1', createdBy: ME }),
      money_('en8', 'transfer', addDays(t, -14),   200_000, { projectId: 'f4', createdBy: HER }),
      money_('en9', 'repay',    addDays(t, -40),   500_000, { projectId: 'd1' }),
      money_('en10', 'repay',   addDays(t, -70),   500_000, { projectId: 'd1' }),
    ],
    taskTemplates: [
      { id: 'tt1', title: 'Пропилососити',      area: 'Дім', effort: 2, scheduleKind: 'after_completion', intervalDays: 7,  rotation: 'least_loaded', active: true, lastCompletedAt: addDays(t, -6) },
      { id: 'tt2', title: 'Змінити постіль',    area: 'Дім', effort: 2, scheduleKind: 'after_completion', intervalDays: 14, rotation: 'least_loaded', active: true, lastCompletedAt: addDays(t, -13) },
      { id: 'tt3', title: 'Полити квіти',       area: 'Дім', effort: 1, scheduleKind: 'after_completion', intervalDays: 4,  rotation: 'least_loaded', active: true, lastCompletedAt: addDays(t, -4) },
      { id: 'tt4', title: 'Винести сміття',     area: 'Дім', effort: 1, scheduleKind: 'fixed', freq: 'weekly', byDay: [2, 5], rotation: 'least_loaded', active: true },
      { id: 'tt5', title: 'Помити холодильник', area: 'Дім', effort: 3, scheduleKind: 'after_completion', intervalDays: 60, rotation: 'least_loaded', active: true, lastCompletedAt: addDays(t, -55) },
    ],
    tasks: [
      task('t1', 'Записати авто на ТО',        { priority: 2, assigneeId: ME,  area: 'Авто',  dueDate: addDays(t, 3), effort: 1, projectId: 'x1' }),
      task('t2', 'Продовжити страховку',        { priority: 1, assigneeId: ME,  area: 'Авто',  dueDate: addDays(t, 1), effort: 2, projectId: 'x1' }),
      task('t3', 'Забрати посилку з відділення',{ priority: 3, assigneeId: HER, area: 'Адмін', dueDate: t,            effort: 1 }),
      task('t4', 'Розібрати комору',            { priority: 4, area: 'Дім', effort: 3 }),
      task('t5', 'Знайти майстра для крана',    { priority: 2, area: 'Дім', dueDate: addDays(t, 5), effort: 1, projectId: 'p10' }),
      task('t6', 'Порахувати бюджет на відпустку', { priority: 3, assigneeId: HER, area: 'Гроші', effort: 2, status: 'doing', projectId: 'f4' }),
      task('t7', 'Замовити фільтр для води',    { priority: 0, area: 'Дім', effort: 1, status: 'backlog' }),
      task('t8', 'Оновити документи на авто',   { priority: 0, area: 'Авто', effort: 2, status: 'backlog', deferUntil: addDays(t, 40), projectId: 'x1' }),
      task('t9', 'Вибрати меблі',               { priority: 2, assigneeId: HER, effort: 2, projectId: 'p10' }),
      task('t10', 'Замовити плитку',            { status: 'done', effort: 1, projectId: 'p10', completedAt: new Date(Date.now() - 20 * 864e5).toISOString(), completedBy: ME }),
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

function money_(id: string, kind: DB['entries'][number]['kind'], on: string, minor: number,
  rest: Partial<DB['entries'][number]> = {}): DB['entries'][number] {
  return { id, kind, occurredOn: on, amountMinor: minor, currency: 'UAH', rateToBase: 1, amountBaseMinor: minor, createdBy: ME, ...rest }
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
