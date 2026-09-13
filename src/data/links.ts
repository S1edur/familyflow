/**
 * Звʼязки між сутностями й маршрути до них.
 *
 * У моделі «усе проєкти» граф простий: задача, правило, платіж і запис
 * посилаються на проєкт. Тут — як описати правило людською мовою і куди
 * вести, коли людина тапає по згадці іншої сутності.
 */
import type { Currency, DB, ID, RecurringPlan } from './types'
import { clampDayOfMonth, iso, isoDow, longDate, parse } from '../lib/dates'

/* ───────────────────── правило людською мовою ───────────────────── */

/* Дні тижня — це текст інтерфейсу, а не робота з датами:
   номер дня завжди дає isoDow() з lib/dates (1=Пн .. 7=Нд). */
export const DOW = [
  { n: 1, short: 'Пн', every: 'щопонеділка' },
  { n: 2, short: 'Вт', every: 'щовівторка' },
  { n: 3, short: 'Ср', every: 'щосереди' },
  { n: 4, short: 'Чт', every: 'щочетверга' },
  { n: 5, short: 'Пт', every: 'щоп’ятниці' },
  { n: 6, short: 'Сб', every: 'щосуботи' },
  { n: 7, short: 'Нд', every: 'щонеділі' },
]

function joinUa(parts: string[]) {
  if (parts.length <= 1) return parts[0] ?? ''
  return parts.slice(0, -1).join(', ') + ' і ' + parts[parts.length - 1]
}

/** Правило людською мовою — головне, що має бути видно в рядку. */
export function ruleText(p: RecurringPlan): string {
  const a = parse(p.anchorDate)

  if (p.freq === 'daily') return 'щодня'

  if (p.freq === 'weekly') {
    const days = [...(p.byDay?.length ? p.byDay : [isoDow(p.anchorDate)])].sort((x, y) => x - y)
    if (days.length >= 7) return 'щодня'
    return joinUa(days.map(n => DOW.find(d => d.n === n)?.every ?? ''))
  }

  if (p.freq === 'yearly') {
    const m1 = p.byMonth ?? a.getMonth() + 1
    const year = a.getFullYear()
    const day = clampDayOfMonth(year, m1, p.byMonthDay ?? a.getDate())
    // longDate → «12 лютого, пн»; для правила день тижня зайвий
    return `${longDate(iso(new Date(year, m1 - 1, day))).split(',')[0]} щороку`
  }

  return `${p.byMonthDay ?? a.getDate()} числа щомісяця`
}

/** Найближчий ще не оплачений платіж цього плану. Рахується на читанні. */
export function nextDue(d: DB, planId: string) {
  return d.occurrences
    .filter(o => o.planId === planId && (o.status === 'due' || o.status === 'projected'))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0]
}

/* ───────────────────── маршрути ───────────────────── */

export const projectRoute = (id: ID) => `/projects/${id}`
/** Правило відкривається на сторінці свого проєкту. */
export const ruleRoute = (plan: Pick<RecurringPlan, 'id' | 'projectId'>) =>
  `/projects/${plan.projectId}?tab=bills&rule=${plan.id}`
/** Нове правило в проєкті. */
export const newRuleRoute = (projectId: ID) => `/projects/${projectId}?tab=bills&rule=new`
export const monthRoute = (month?: string) => month ? `/month?m=${month}` : '/month'

/* ───────────────────── звʼязок як рядок інтерфейсу ───────────────────── */

export type LinkIcon = 'piggy' | 'wallet' | 'list' | 'clock' | 'cart' | 'check'

/** Один звʼязок: що це, як називається, скільки просить і куди веде. */
export interface Link {
  key: string
  kind: 'project' | 'plan'
  id: ID
  icon: LinkIcon
  title: string
  note?: string
  amountMinor?: number
  currency?: Currency
  to: string
}

export function planLink(p: RecurringPlan): Link {
  return {
    key: `plan:${p.id}`, kind: 'plan', id: p.id, icon: 'clock',
    title: p.name, note: ruleText(p),
    amountMinor: p.expectedMinor, currency: p.currency,
    to: ruleRoute(p),
  }
}

/** Правила проєкту, найближчі першими. */
export function projectPlans(d: DB, projectId: ID): RecurringPlan[] {
  return d.recurringPlans
    .filter(p => p.projectId === projectId)
    .sort((a, b) => (nextDue(d, a.id)?.dueDate ?? '9999').localeCompare(nextDue(d, b.id)?.dueDate ?? '9999')
      || a.name.localeCompare(b.name, 'uk'))
}
