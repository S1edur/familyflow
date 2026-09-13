import type { ReactNode } from 'react'
import { Icon, useSheet } from '../ui'
import { addMonths, monthTitle, thisMonth } from '../lib/dates'

/**
 * Місяць живе в адресі (`?m=2026-09`), як і відкриті листи.
 *
 * Інакше посилання «відкрий цей конверт» завжди приводило б у поточний місяць,
 * а перехід між «Конвертами» і «Платежами» скидав би вибраний.
 */
export function useMonth() {
  const [param, set] = useSheet('m')
  const month = param && /^\d{4}-\d{2}$/.test(param) ? param : thisMonth()
  const setMonth = (m: string) => set(m === thisMonth() ? null : m)
  return [month, setMonth] as const
}

/** Перемикач місяця. Назву екрана несе топ-бар, тому тут не h1. */
export function MonthBar({ month, onChange, right }: {
  month: string
  onChange: (m: string) => void
  right?: ReactNode
}) {
  return (
    <div className="flex items-center gap-1 mb-3">
      <button onClick={() => onChange(addMonths(month, -1))}
        aria-label="Попередній місяць"
        className="h-8 w-8 grid place-items-center rounded-lg text-muted hover:bg-surface2 rotate-180">
        {Icon.chev(16)}
      </button>
      <div className="text-[22px] font-semibold tracking-tight min-w-[140px] text-center">{monthTitle(month)}</div>
      <button onClick={() => onChange(addMonths(month, 1))}
        aria-label="Наступний місяць"
        className="h-8 w-8 grid place-items-center rounded-lg text-muted hover:bg-surface2">
        {Icon.chev(16)}
      </button>
      {month !== thisMonth() && (
        <button onClick={() => onChange(thisMonth())} className="ml-2 text-[12.5px] text-accent">цей місяць</button>
      )}
      {right && <div className="ml-auto">{right}</div>}
    </div>
  )
}
