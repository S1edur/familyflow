import type { ReactNode } from 'react'
import { Icon } from './Icon'
import type { Link, LinkIcon } from '../data/links'
import { money } from '../lib/money'

/**
 * Звʼязки між сутностями — один вигляд на весь застосунок.
 *
 * Правило: якщо дві речі повʼязані, звʼязок видно з обох боків і з обох боків
 * він КЛІКАБЕЛЬНИЙ. Список, який лише показує назву фонду, змушує людину
 * шукати той фонд руками — це і є розрив, який ми прибираємо.
 */

const GLYPH: Record<LinkIcon, (s?: number) => ReactNode> = {
  piggy: Icon.piggy,
  wallet: Icon.wallet,
  list: Icon.list,
  clock: Icon.clock,
  cart: Icon.cart,
  check: Icon.check,
}

/** Блок звʼязків: заголовок, підсумок праворуч, рядки, дії внизу. */
export function LinkGroup({ title, summary, hint, children, actions }: {
  title: string
  summary?: ReactNode
  hint?: ReactNode
  children?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="rounded-xl border border-line bg-surface2/40 p-3 mb-4">
      <div className="flex items-baseline justify-between gap-2 px-1">
        <div className="text-[11.5px] uppercase tracking-wider text-faint">{title}</div>
        {summary && <div className="text-[12.5px] num text-muted shrink-0">{summary}</div>}
      </div>
      {children && <div className="mt-2 space-y-1">{children}</div>}
      {hint && <p className="px-1 mt-2 text-[12px] text-faint leading-snug">{hint}</p>}
      {actions && <div className="mt-2 flex flex-wrap gap-1.5">{actions}</div>}
    </div>
  )
}

/**
 * Рядок звʼязку. `onOpen` веде на ту сутність — і це головне: звідси можна
 * піти туди, де звʼязок налаштовується, не шукаючи його по екранах.
 */
export function LinkRow({ link, onOpen, right }: {
  link: Link
  onOpen?: () => void
  right?: ReactNode
}) {
  const amount = link.amountMinor !== undefined
    ? money(link.amountMinor, link.currency)
    : undefined

  return (
    <button type="button" onClick={onOpen} disabled={!onOpen}
      className={`w-full flex items-center gap-2.5 text-left rounded-lg px-2 py-1.5 transition-colors ${
        onOpen ? 'hover:bg-surface cursor-pointer' : 'cursor-default'}`}>
      <span className="shrink-0 text-faint">{GLYPH[link.icon](15)}</span>
      <span className="flex-1 min-w-0">
        <span className="block text-[13.5px] truncate">{link.title}</span>
        {link.note && <span className="block text-[11.5px] text-faint truncate">{link.note}</span>}
      </span>
      {right ?? (amount && <span className="shrink-0 text-[13px] num text-muted">{amount}</span>)}
      {onOpen && <span className="shrink-0 text-faint">{Icon.chev(14)}</span>}
    </button>
  )
}

/** Пунктирна кнопка «привʼязати ще» — виглядає як місце, куди щось стане. */
export function AttachButton({ onClick, children, icon = 'plus' }: {
  onClick: () => void
  children: ReactNode
  /** `pencil` для «змінити»: плюс на зміні наявного звʼязку читається як «додати ще один». */
  icon?: 'plus' | 'pencil'
}) {
  return (
    <button type="button" onClick={onClick}
      className="inline-flex items-center gap-1 h-8 px-2.5 rounded-lg border border-dashed border-line2
                 text-[12.5px] text-muted hover:text-ink hover:border-accent hover:bg-surface transition-colors">
      {icon === 'pencil' ? Icon.pencil(13) : Icon.plus(14)}{children}
    </button>
  )
}

/**
 * Інлайнова згадка іншої сутності. Скрізь, де в тексті рядка зʼявляється назва
 * конверта, фонду чи боргу, вона має вести туди — інакше людина читає назву
 * і йде шукати її руками через меню.
 */
export function LinkChip({ icon, children, onClick, tone = 'neutral' }: {
  icon?: LinkIcon
  children: ReactNode
  onClick: () => void
  tone?: 'neutral' | 'accent'
}) {
  const v = tone === 'accent'
    ? 'border-transparent bg-accentSoft text-accentInk hover:bg-accent hover:text-white'
    : 'border-line text-faint hover:text-ink hover:border-line2'
  return (
    <button type="button" onClick={e => { e.stopPropagation(); onClick() }}
      className={`inline-flex items-center gap-1 shrink-0 px-1.5 py-0.5 rounded border text-[11.5px] transition-colors ${v}`}>
      {icon && GLYPH[icon](11)}
      {children}
    </button>
  )
}
