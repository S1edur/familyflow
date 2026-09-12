import { useEffect, useRef, type ReactNode } from 'react'
import type { Member, Priority } from '../data/types'

/* ── іконки ─────────────────────────────────────────────── */
const S = (p: { d: string; size?: number; fill?: boolean }) => (
  <svg width={p.size ?? 20} height={p.size ?? 20} viewBox="0 0 24 24"
       fill={p.fill ? 'currentColor' : 'none'} stroke="currentColor"
       strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={p.d} />
  </svg>
)
export const Icon = {
  home:  (s?: number) => <S size={s} d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
  check: (s?: number) => <S size={s} d="M4 12.5 9 17.5 20 6.5" />,
  list:  (s?: number) => <S size={s} d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" />,
  wallet:(s?: number) => <S size={s} d="M3 7.5A2.5 2.5 0 0 1 5.5 5H18a1 1 0 0 1 1 1v1.5M3 7.5V18a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-3M3 7.5h17a1 1 0 0 1 1 1V15m0 0h-4a1.5 1.5 0 0 1 0-3h4" />,
  cart:  (s?: number) => <S size={s} d="M3 4h2l2.2 10.4a1 1 0 0 0 1 .8h8.3a1 1 0 0 0 1-.75L19.5 8H6M9 20h.01M17 20h.01" />,
  piggy: (s?: number) => <S size={s} d="M4 12a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v2a3 3 0 0 1-3 3v2h-3v-2H10v2H7v-2a3 3 0 0 1-3-3zM2 11v2M15 10h.01" />,
  plus:  (s?: number) => <S size={s} d="M12 5v14M5 12h14" />,
  x:     (s?: number) => <S size={s} d="M6 6l12 12M18 6L6 18" />,
  chev:  (s?: number) => <S size={s} d="M9 6l6 6-6 6" />,
  more:  (s?: number) => <S size={s} d="M5 12h.01M12 12h.01M19 12h.01" />,
  sun:   (s?: number) => <S size={s} d="M12 4V2M12 22v-2M4 12H2M22 12h-2M5.6 5.6 4.2 4.2M19.8 19.8l-1.4-1.4M18.4 5.6l1.4-1.4M4.2 19.8l1.4-1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0z" />,
  moon:  (s?: number) => <S size={s} d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" />,
  image: (s?: number) => <S size={s} d="M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM3 16l5-4 4 3 3-2 6 5M9 9.5h.01" />,
}

/* ── аватар ─────────────────────────────────────────────── */
export function Avatar({ member, size = 22 }: { member?: Member; size?: number }) {
  if (!member) {
    return (
      <span className="inline-flex items-center justify-center rounded-full border border-dashed border-line2 text-faint"
            style={{ width: size, height: size, fontSize: size * 0.5 }} title="Вільна">?</span>
    )
  }
  return (
    <span className="inline-flex items-center justify-center rounded-full text-white font-medium"
          style={{ width: size, height: size, background: member.color, fontSize: size * 0.48 }}
          title={member.name}>{member.initials}</span>
  )
}

/* ── пріоритет ──────────────────────────────────────────── */
const P_LABEL: Record<Priority, string> = { 0: 'Без пріоритету', 1: 'Терміново', 2: 'Високий', 3: 'Середній', 4: 'Низький' }
const P_VAR: Record<Priority, string> = { 0: '--c-p4', 1: '--c-p1', 2: '--c-p2', 3: '--c-p3', 4: '--c-p4' }

export function PriorityMark({ p, size = 14 }: { p: Priority; size?: number }) {
  const color = `var(${P_VAR[p]})`
  if (p === 0) {
    return <svg width={size} height={size} viewBox="0 0 14 14" aria-label={P_LABEL[0]}>
      <rect x="1" y="9" width="3" height="4" rx="1" fill="var(--c-line2)" />
      <rect x="5.5" y="9" width="3" height="4" rx="1" fill="var(--c-line2)" />
      <rect x="10" y="9" width="3" height="4" rx="1" fill="var(--c-line2)" />
    </svg>
  }
  if (p === 1) {
    return <svg width={size} height={size} viewBox="0 0 14 14" aria-label={P_LABEL[1]}>
      <rect x="1" y="1" width="12" height="12" rx="3" fill={color} />
      <rect x="6.4" y="3.6" width="1.2" height="4.4" rx=".6" fill="#fff" />
      <rect x="6.4" y="9.2" width="1.2" height="1.4" rx=".6" fill="#fff" />
    </svg>
  }
  const bars = p === 2 ? 3 : p === 3 ? 2 : 1
  return <svg width={size} height={size} viewBox="0 0 14 14" aria-label={P_LABEL[p]}>
    {[0, 1, 2].map(i => (
      <rect key={i} x={1 + i * 4.5} y={11 - (i + 1) * 3} width="3" height={(i + 1) * 3 + 2} rx="1"
            fill={i < bars ? color : 'var(--c-line2)'} />
    ))}
  </svg>
}
export const priorityLabel = (p: Priority) => P_LABEL[p]

/* ── прогрес ────────────────────────────────────────────── */
export function Progress({ value, tone = 'accent', height = 6 }: { value: number; tone?: 'accent' | 'warn' | 'neutral'; height?: number }) {
  const c = tone === 'warn' ? 'var(--c-warn)' : tone === 'neutral' ? 'var(--c-line2)' : 'var(--c-accent)'
  return (
    <div className="w-full rounded-full bg-surface2 overflow-hidden" style={{ height }}>
      <div className="h-full rounded-full transition-[width] duration-300"
           style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%`, background: c }} />
    </div>
  )
}

/* ── нижній лист ────────────────────────────────────────── */
export function Sheet({ open, onClose, title, children }: {
  open: boolean; onClose: () => void; title?: string; children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = '' }
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center fade-in"
         onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="absolute inset-0 bg-black/35" />
      <div ref={ref} role="dialog" aria-modal
           className="sheet-enter relative w-full sm:w-[420px] bg-surface border-t sm:border border-line sm:rounded-xl rounded-t-2xl shadow-xl max-h-[92vh] overflow-y-auto safe-b">
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <div className="text-[15px] font-semibold">{title}</div>
          <button onClick={onClose} className="text-faint hover:text-ink p-1 -mr-1" aria-label="Закрити">{Icon.x(18)}</button>
        </div>
        <div className="px-4 pb-4">{children}</div>
      </div>
    </div>
  )
}

/* ── кнопки ─────────────────────────────────────────────── */
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

export function Tabs<T extends string>({ value, onChange, items }: {
  value: T; onChange: (v: T) => void; items: { value: T; label: string; badge?: number }[]
}) {
  return (
    <div className="flex gap-1 overflow-x-auto -mx-1 px-1">
      {items.map(it => (
        <button key={it.value} onClick={() => onChange(it.value)}
          className={`shrink-0 h-8 px-3 rounded-lg text-[13.5px] font-medium transition-colors ${
            value === it.value ? 'bg-surface2 text-ink' : 'text-muted hover:text-ink'}`}>
          {it.label}
          {it.badge != null && it.badge > 0 && <span className="ml-1.5 text-faint num">{it.badge}</span>}
        </button>
      ))}
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="py-10 text-center text-[13.5px] text-faint">{children}</div>
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between px-4 sm:px-0 mb-2 mt-6 first:mt-0">
      <h2 className="text-[12px] uppercase tracking-wider text-faint font-medium">{children}</h2>
      {right}
    </div>
  )
}
