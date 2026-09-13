/**
 * Перші кроки нового дому.
 *
 * Новий дім отримує лише «Вільні гроші» й стартові проєкти — решта екранів порожня. Порожній
 * стан на кожному екрані пояснює свій екран, але не каже, З ЧОГО почати.
 * Тут — короткий шлях, після якого застосунок починає працювати сам:
 * вільні гроші мають початкову суму, місяць рахується наперед із доходу й платежів,
 * задачі чергуються.
 *
 * Прогрес не зберігається (інваріант 4): крок виконаний, коли в даних уже
 * є те, до чого він веде. Видалили всі правила — крок знову відкритий, і це
 * правильно.
 */
import type { DB } from './types'
import { newRuleRoute } from './links'
import { freeProject } from './store'

export interface SetupStep {
  key: string
  title: string
  hint: string
  action: string
  to: string
  done: boolean
}

export function setupSteps(d: DB): SetupStep[] {
  const free = freeProject(d)
  const hasStart = d.entries.some(e => e.kind === 'income')
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
      key: 'start',
      title: 'Скільки грошей зараз',
      hint: 'Одна сума — те, що є на картках і готівкою. З неї починаються «Вільні гроші».',
      action: 'Вписати',
      to: free ? `/projects/${free.id}?start=1` : '/projects',
      done: hasStart,
    },
    {
      key: 'income',
      title: 'Додайте дохід',
      hint: 'Зарплата як регулярне надходження — щоб місяць рахувався наперед.',
      action: 'Додати',
      to: free ? newRuleRoute(free.id) + '&flow=in' : '/projects',
      done: d.recurringPlans.some(p => p.flow === 'in'),
    },
    {
      key: 'projects',
      title: 'Розкладіть витрати по проєктах',
      hint: 'Житло, продукти, транспорт — орієнтир на місяць і регулярні платежі.',
      action: 'Відкрити',
      to: '/projects',
      done: d.projects.some(p => !p.isFree && p.direction === 'spend' && p.status === 'active'
        && (!!p.monthlyMinor || d.recurringPlans.some(r => r.projectId === p.id && r.flow === 'out'))),
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

/** Без доходу й стартового залишку «вільні» не мають сенсу як число. */
export function hasIncome(d: DB): boolean {
  return d.entries.some(e => e.kind === 'income') || d.recurringPlans.some(p => p.flow === 'in')
}
