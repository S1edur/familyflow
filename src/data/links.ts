/**
 * Звʼязки між сутностями — один опис графа на весь застосунок.
 *
 * До цього кожен екран знав свій шматок: фонд знав про конверт, конверт не знав
 * про фонд, борг не знав ні про що. Через це налаштування одного звʼязку жило
 * там, де його завели, а не там, де його шукають. Тут граф описаний один раз,
 * і будь-який екран питає його з свого боку.
 *
 * Нічого не зберігається (інваріант 4): усе рахується на читанні з наявних полів.
 * Нових колонок у базі це не потребує — звʼязки вже є в даних:
 * `Fund.envelopeId`, `RecurringPlan.envelopeId`, `RecurringPlan.debtId`,
 * `RecurringPlan.fundId`, `Occurrence.fundId`.
 */
import type { Currency, DB, Fund, ID, RecurringPlan } from './types'
import { debtEnvelopeId, debtStatus, fundStatus } from './store'
import { clampDayOfMonth, iso, isoDow, longDate, monthKey, parse, today } from '../lib/dates'
import { toBase } from '../lib/money'

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

/* ───────────────────── звʼязок як рядок інтерфейсу ───────────────────── */

export type LinkIcon = 'piggy' | 'wallet' | 'list' | 'clock' | 'cart' | 'check'

/** Один звʼязок: що це, як називається, скільки просить і куди веде. */
export interface Link {
  key: string
  kind: 'fund' | 'plan' | 'debt' | 'envelope'
  id: ID
  icon: LinkIcon
  title: string
  /** Коли і як часто — людською мовою. */
  note?: string
  amountMinor?: number
  currency?: Currency
  /** Маршрут, який відкриває цю сутність на її екрані. */
  to: string
}

export const envelopeRoute = (id: ID) => `/month?env=${id}`
export const fundRoute = (id: ID) => `/funds?fund=${id}`
export const debtRoute = (id: ID) => `/debts?debt=${id}`
export const ruleRoute = (id: ID) => `/month?tab=bills&rule=${id}`

const dayText = (day: number) => `${day} числа щомісяця`

function fundLink(d: DB, f: Fund): Link {
  return {
    key: `fund:${f.id}`, kind: 'fund', id: f.id, icon: 'piggy',
    title: f.name,
    note: f.envelopeId ? dayText(f.contributionDay ?? 1) : 'без нагадування',
    amountMinor: fundStatus(d, f.id).required,
    currency: f.currency,
    to: fundRoute(f.id),
  }
}

function planLink(p: RecurringPlan): Link {
  return {
    key: `plan:${p.id}`, kind: 'plan', id: p.id, icon: 'clock',
    title: p.name,
    note: ruleText(p),
    amountMinor: p.expectedMinor,
    currency: p.currency,
    to: ruleRoute(p.id),
  }
}

/**
 * Що САМО кладе гроші в конверт.
 *
 * Це відповідь на «чим конверт відрізняється від фонду й боргу»: конверт
 * не робить нічого сам, він ПРИЙМАЄ. Фонд, борг і регулярне правило —
 * джерела, які щомісяця в нього щось кладуть.
 */
export function envelopeSources(d: DB, envelopeId: ID): Link[] {
  const funds = d.funds
    .filter(f => !f.archived && f.envelopeId === envelopeId)
    .map(f => fundLink(d, f))

  const plans = d.recurringPlans
    .filter(p => p.active && p.envelopeId === envelopeId)
    .map(planLink)

  // Борг потрапляє в конверт двома шляхами: через регулярне правило з debtId
  // (уже в plans) або просто тому, що це конверт боргів.
  const throughPlan = new Set(plans.map(p => p.id))
  const debts = debtEnvelopeId(d) === envelopeId
    ? d.debts
        .filter(x => !x.closedOn && !d.recurringPlans.some(p =>
          p.active && p.debtId === x.id && throughPlan.has(p.id)))
        .map<Link>(x => ({
          key: `debt:${x.id}`, kind: 'debt', id: x.id, icon: 'list',
          title: x.name,
          note: x.monthlyPaymentMinor ? 'платимо вручну' : 'без щомісячного платежу',
          amountMinor: x.monthlyPaymentMinor || debtStatus(d, x.id).remaining,
          currency: x.currency,
          to: debtRoute(x.id),
        }))
    : []

  return [...funds, ...plans, ...debts]
}

/**
 * Скільки конверт просить цього місяця. Ділимо на автоматичне (платежі, які
 * створилися самі) і вже закрите — щоб у плані було видно, яка частина суми
 * узагалі не в руках людини.
 */
export function envelopeAsk(d: DB, envelopeId: ID, month: string) {
  let open = 0, paid = 0
  for (const o of d.occurrences) {
    if (o.envelopeId !== envelopeId || monthKey(o.dueDate) !== month) continue
    const base = toBase(o.actualMinor ?? o.expectedMinor, o.currency, d.rates)
    if (o.status === 'paid') paid += base
    else if (o.status === 'due' || o.status === 'projected') open += base
  }
  return { open, paid, auto: open + paid }
}

/** Фонди, які ще нікуди не привʼязані — кандидати на привʼязку до конверта. */
export function unlinkedFunds(d: DB): Fund[] {
  return d.funds.filter(f => !f.archived && !f.envelopeId)
}

/* ───────────────────── погляд з іншого боку ───────────────────── */

/** Куди фонд надсилає нагадування і що з цього вийшло цього місяця. */
export function fundLinks(d: DB, fundId: ID): Link[] {
  const f = d.funds.find(x => x.id === fundId)
  if (!f) return []
  const out: Link[] = []

  const env = f.envelopeId ? d.envelopes.find(e => e.id === f.envelopeId) : undefined
  if (env) {
    out.push({
      key: `env:${env.id}`, kind: 'envelope', id: env.id, icon: 'wallet',
      title: env.name,
      note: `внесок ${dayText(f.contributionDay ?? 1)}`,
      amountMinor: fundStatus(d, f.id).required,
      currency: f.currency,
      to: envelopeRoute(env.id),
    })
  }

  // Правило, яке цей фонд фінансує: фонд збирає — правило витрачає.
  for (const p of d.recurringPlans.filter(p => p.active && p.fundId === f.id)) {
    out.push({ ...planLink(p), note: `звідси платимо · ${ruleText(p)}` })
  }

  return out
}

/** Чим гаситься борг: правило, конверт. */
export function debtLinks(d: DB, debtId: ID): Link[] {
  const out: Link[] = []

  for (const p of d.recurringPlans.filter(p => p.active && p.debtId === debtId)) {
    out.push(planLink(p))
  }

  const envId = debtEnvelopeId(d)
  const env = envId ? d.envelopes.find(e => e.id === envId) : undefined
  if (env) {
    out.push({
      key: `env:${env.id}`, kind: 'envelope', id: env.id, icon: 'wallet',
      title: env.name,
      note: 'виплати лягають у цей конверт',
      to: envelopeRoute(env.id),
    })
  }

  return out
}

/** Найближчий автоматичний платіж по конверту — для підказки «наступне». */
export function nextForEnvelope(d: DB, envelopeId: ID) {
  const t = today()
  return d.occurrences
    .filter(o => o.envelopeId === envelopeId && o.dueDate >= t
      && (o.status === 'due' || o.status === 'projected'))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0]
}
