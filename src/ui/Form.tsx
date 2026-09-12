import { useState, type ReactNode } from 'react'
import { Icon } from './Icon'
import { SYMBOL, money, parseAmount } from '../lib/money'
import type { Currency } from '../data/types'

/** Спільний вигляд контролів: висота 40, рамка line, фокус — accent. */
export const fieldClass =
  'w-full h-10 px-3 rounded-lg border border-line bg-surface text-[14px] text-ink ' +
  'outline-none placeholder:text-faint focus:border-accent transition-colors disabled:opacity-40'

/**
 * Підпис + контрол + підказка або помилка.
 * Помилка бурштинова: червоне лишаємо тільки для руйнівних дій.
 */
export function Field({ label, children, hint, error, htmlFor }: {
  label: string; children: ReactNode; hint?: string; error?: string; htmlFor?: string
}) {
  return (
    <div className="mb-3">
      <label htmlFor={htmlFor} className="block text-[11.5px] uppercase tracking-wider text-faint mb-1.5">{label}</label>
      {children}
      {error
        ? <div className="text-[12px] text-warn mt-1">{error}</div>
        : hint ? <div className="text-[12px] text-faint mt-1">{hint}</div> : null}
    </div>
  )
}

/** Однорядковий текст. */
export function Input({ value, onChange, placeholder, id, type = 'text', disabled, autoFocus, inputMode, onEnter, align = 'left' }: {
  value: string; onChange: (v: string) => void
  placeholder?: string; id?: string; type?: 'text' | 'search' | 'url' | 'tel'
  disabled?: boolean; autoFocus?: boolean
  inputMode?: 'text' | 'decimal' | 'numeric'
  onEnter?: () => void; align?: 'left' | 'right'
}) {
  return (
    <input id={id} type={type} value={value} disabled={disabled} autoFocus={autoFocus}
      placeholder={placeholder} inputMode={inputMode}
      onChange={e => onChange(e.target.value)}
      onKeyDown={e => { if (e.key === 'Enter' && onEnter) onEnter() }}
      className={`${fieldClass} ${align === 'right' ? 'text-right num' : ''}`} />
  )
}

/** Багаторядковий текст: нотатка, опис. */
export function Textarea({ value, onChange, placeholder, id, rows = 3, disabled }: {
  value: string; onChange: (v: string) => void
  placeholder?: string; id?: string; rows?: number; disabled?: boolean
}) {
  return (
    <textarea id={id} value={value} rows={rows} disabled={disabled} placeholder={placeholder}
      onChange={e => onChange(e.target.value)}
      className={`${fieldClass} h-auto py-2 resize-y leading-snug`} />
  )
}

/** Нативний select під виглядом наявних полів. Для довгих списків — конверти, фонди, учасники. */
export function Select<T extends string>({ value, onChange, options, id, disabled, placeholder }: {
  value: T | ''; onChange: (v: T) => void
  options: { value: T; label: string }[]
  id?: string; disabled?: boolean; placeholder?: string
}) {
  return (
    <div className="relative">
      <select id={id} value={value} disabled={disabled}
        onChange={e => onChange(e.target.value as T)}
        className={`${fieldClass} appearance-none pr-9 ${value === '' ? 'text-faint' : ''}`}>
        {placeholder != null && <option value="">{placeholder}</option>}
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rotate-90 text-faint">
        {Icon.chev(14)}
      </span>
    </div>
  )
}

/**
 * Гроші в копійках. `valueMinor` — ціле, `onChange` віддає ціле.
 * Форматуємо тільки коли поле не в фокусі; у стані — завжди копійки.
 * Порожнє поле = 0.
 */
export function MoneyInput({ valueMinor, onChange, currency = 'UAH', id, placeholder = '0', disabled, autoFocus, size = 'md' }: {
  valueMinor: number; onChange: (minor: number) => void
  currency?: Currency; id?: string; placeholder?: string
  disabled?: boolean; autoFocus?: boolean; size?: 'md' | 'lg'
}) {
  const [raw, setRaw] = useState<string | null>(null)
  const shown = raw ?? (valueMinor ? plain(valueMinor, currency) : '')
  const big = size === 'lg'

  return (
    <div className="relative">
      <input id={id} value={shown} disabled={disabled} autoFocus={autoFocus}
        inputMode="decimal" placeholder={placeholder}
        onFocus={e => e.currentTarget.select()}
        onChange={e => {
          const next = e.target.value
          setRaw(next)
          if (!next.trim()) { onChange(0); return }
          const minor = parseAmount(next)
          if (minor != null) onChange(minor)
        }}
        onBlur={() => setRaw(null)}
        onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
        className={`${fieldClass} text-right num ${big ? 'h-14 text-[26px] font-semibold pr-10' : 'pr-8'}`} />
      <span className={`pointer-events-none absolute top-1/2 -translate-y-1/2 text-faint ${big ? 'right-3 text-[20px]' : 'right-3 text-[14px]'}`}>
        {SYMBOL[currency]}
      </span>
    </div>
  )
}

/** '25 000,50' — те саме форматування, що й `money`, але без символа валюти. */
function plain(minor: number, currency: Currency) {
  const s = money(minor, currency)
  return s.slice(0, s.length - SYMBOL[currency].length).trim()
}

/** Дата в ISO `YYYY-MM-DD`. Порожнє значення — `undefined`. */
export function DateInput({ value, onChange, id, disabled, min, max }: {
  value?: string; onChange: (iso: string | undefined) => void
  id?: string; disabled?: boolean; min?: string; max?: string
}) {
  return (
    <input id={id} type="date" value={value ?? ''} disabled={disabled} min={min} max={max}
      onChange={e => onChange(e.target.value || undefined)}
      className={`${fieldClass} num`} />
  )
}

/** Вмикач для булевих полів: `active`, `archived`. Підпис ліворуч, стан праворуч. */
export function Switch({ checked, onChange, label, hint, disabled }: {
  checked: boolean; onChange: (v: boolean) => void
  label: string; hint?: string; disabled?: boolean
}) {
  return (
    <button type="button" role="switch" aria-checked={checked} disabled={disabled}
      onClick={() => onChange(!checked)}
      className="w-full flex items-center gap-3 text-left py-1.5 disabled:opacity-40">
      <span className="flex-1 min-w-0">
        <span className="block text-[14px]">{label}</span>
        {hint && <span className="block text-[12px] text-faint">{hint}</span>}
      </span>
      <span className={`shrink-0 w-[42px] h-[24px] rounded-full p-0.5 transition-colors ${checked ? 'bg-accent' : 'bg-surface2 border border-line'}`}>
        <span className={`block w-[20px] h-[20px] rounded-full bg-surface shadow-sm transition-transform ${checked ? 'translate-x-[18px]' : ''}`}
              style={checked ? undefined : { background: 'var(--c-line2)' }} />
      </span>
    </button>
  )
}
