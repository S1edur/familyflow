/**
 * Перші кроки нового дому.
 *
 * Новий дім отримує лише стартові конверти — решта екранів порожня. Порожній
 * стан на кожному екрані пояснює свій екран, але не каже, З ЧОГО почати.
 * Тут — короткий шлях, після якого застосунок починає працювати сам:
 * чекліст місяця заповнюється правилами, «вільно» рахується з доходу,
 * задачі чергуються.
 *
 * Прогрес не зберігається (інваріант 4): крок виконаний, коли в даних уже
 * є те, до чого він веде. Видалили всі правила — крок знову відкритий, і це
 * правильно.
 */
import type { DB } from './types'
import { newRuleRoute } from './links'
import { thisMonth } from '../lib/dates'

export interface SetupStep {
  key: string
  title: string
  hint: string
  action: string
  to: string
  done: boolean
}

export function setupSteps(d: DB): SetupStep[] {
  const income = d.envelopes.find(e => e.kind === 'income' && !e.archived)
  const incomeIds = new Set(d.envelopes.filter(e => e.kind === 'income').map(e => e.id))
  const month = thisMonth()

  return [
    {
      key: 'partner',
      title: 'Покличте партнера',
      hint: 'Усе спільне: обидва бачать і редагують. Код живе 14 днів.',
      action: 'Запросити',
      to: '/settings/family',
      done: d.members.length >= 2,
    },
    {
      key: 'income',
      title: 'Додайте дохід',
      hint: 'Зарплата як регулярне правило — з неї рахується, скільки вільно.',
      action: 'Додати',
      to: newRuleRoute({ envelopeId: income?.id }),
      done: d.recurringPlans.some(p => incomeIds.has(p.envelopeId)),
    },
    {
      key: 'bills',
      title: 'Регулярні платежі',
      hint: 'Оренда, комуналка, підписки — чекліст місяця заповниться сам.',
      action: 'Додати',
      to: newRuleRoute(),
      done: d.recurringPlans.some(p => !incomeIds.has(p.envelopeId)),
    },
    {
      key: 'plan',
      title: 'Розпишіть місяць',
      hint: 'Скільки на продукти, транспорт, розваги. Факт підтягнеться з витрат.',
      action: 'Відкрити',
      to: '/envelopes',
      done: d.planLines.some(l => l.month === month && l.plannedMinor > 0),
    },
    {
      key: 'chores',
      title: 'Побутові задачі',
      hint: 'Прибирання, сміття, полив — повторюються й чергуються самі.',
      action: 'Відкрити',
      to: '/tasks',
      done: d.taskTemplates.length > 0,
    },
  ]
}

/** Дім ще налаштовується: без доходу «вільно» не має сенсу показувати числом. */
export function hasIncome(d: DB): boolean {
  const incomeIds = new Set(d.envelopes.filter(e => e.kind === 'income').map(e => e.id))
  return d.recurringPlans.some(p => incomeIds.has(p.envelopeId))
    || d.entries.some(e => e.kind === 'income')
}
