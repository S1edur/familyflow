import { useEffect, useState, type ReactNode } from 'react'

/** Основна кнопка. `danger` — єдине місце, де застосунок червоніє. */
export function Btn({ children, onClick, variant = 'ghost', full, disabled, type }: {
  children: ReactNode; onClick?: () => void
  variant?: 'primary' | 'ghost' | 'quiet' | 'danger'; full?: boolean; disabled?: boolean
  type?: 'button' | 'submit'
}) {
  const base = 'inline-flex items-center justify-center gap-1.5 rounded-lg text-[14px] font-medium px-3 h-10 transition-colors disabled:opacity-40'
  const v = {
    primary: 'bg-accent text-white hover:opacity-90',
    ghost: 'border border-line hover:bg-surface2',
    quiet: 'text-muted hover:text-ink hover:bg-surface2',
    danger: 'text-stop hover:bg-stopSoft',
  }[variant]
  return <button type={type ?? 'button'} onClick={onClick} disabled={disabled}
                 className={`${base} ${v} ${full ? 'w-full' : ''}`}>{children}</button>
}

/** Квадратна кнопка з однією іконкою. `label` обов'язковий — це aria-label і title. */
export function IconButton({ children, label, onClick, size = 32, tone = 'quiet', disabled }: {
  children: ReactNode; label: string; onClick?: () => void
  size?: number; tone?: 'quiet' | 'ghost' | 'accent' | 'danger'; disabled?: boolean
}) {
  const v = {
    quiet: 'text-muted hover:text-ink hover:bg-surface2',
    ghost: 'border border-line text-muted hover:text-ink hover:bg-surface2',
    accent: 'text-accent hover:bg-accentSoft',
    danger: 'text-stop hover:bg-stopSoft',
  }[tone]
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={label} title={label}
            style={{ width: size, height: size }}
            className={`shrink-0 grid place-items-center rounded-lg transition-colors disabled:opacity-40 ${v}`}>
      {children}
    </button>
  )
}

/**
 * Руйнівна дія у два кроки, без `window.confirm`.
 * Перший тап озброює кнопку, другий виконує. Само роззброюється через 4 с.
 */
export function ConfirmButton({ children, confirmLabel = 'Точно?', onConfirm, full, disabled, variant = 'danger' }: {
  children: ReactNode; confirmLabel?: string; onConfirm: () => void
  full?: boolean; disabled?: boolean; variant?: 'danger' | 'quiet'
}) {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const t = setTimeout(() => setArmed(false), 4000)
    return () => clearTimeout(t)
  }, [armed])

  const base = 'inline-flex items-center justify-center gap-1.5 rounded-lg text-[14px] font-medium px-3 h-10 transition-colors disabled:opacity-40'
  const idle = variant === 'danger' ? 'text-stop hover:bg-stopSoft' : 'text-muted hover:text-ink hover:bg-surface2'
  const hot = 'bg-stop text-white hover:opacity-90'
  return (
    <button type="button" disabled={disabled} onBlur={() => setArmed(false)}
      aria-live="polite"
      onClick={() => { if (armed) { setArmed(false); onConfirm() } else setArmed(true) }}
      className={`${base} ${armed ? hot : idle} ${full ? 'w-full' : ''}`}>
      {armed ? confirmLabel : children}
    </button>
  )
}

/** Ряд дій форми: праворуч «Зберегти», ліворуч «Скасувати», за потреби — руйнівна дія скраю. */
export function FormActions({ onSubmit, onCancel, submitLabel = 'Зберегти', cancelLabel = 'Скасувати', disabled, destructive }: {
  onSubmit?: () => void; onCancel?: () => void
  submitLabel?: string; cancelLabel?: string; disabled?: boolean; destructive?: ReactNode
}) {
  return (
    <div className="flex items-center gap-2 mt-4">
      {destructive}
      <div className="flex-1" />
      {onCancel && <Btn variant="quiet" onClick={onCancel}>{cancelLabel}</Btn>}
      <Btn variant="primary" type={onSubmit ? 'button' : 'submit'} onClick={onSubmit} disabled={disabled}>
        {submitLabel}
      </Btn>
    </div>
  )
}
