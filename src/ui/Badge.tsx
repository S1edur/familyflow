import type { ReactNode } from 'react'

/** Статична мітка: статус, тег, лічильник. Перевищення і прострочення — `warn`. */
export function Badge({ children, tone = 'neutral' }: {
  children: ReactNode; tone?: 'neutral' | 'accent' | 'warn' | 'stop'
}) {
  const v = {
    neutral: 'border-line text-faint',
    accent: 'border-transparent bg-accentSoft text-accentInk',
    warn: 'border-transparent bg-warnSoft text-warn',
    stop: 'border-transparent bg-stopSoft text-stop',
  }[tone]
  return (
    <span className={`inline-flex items-center gap-1 shrink-0 px-1.5 py-0.5 rounded border text-[11.5px] ${v}`}>
      {children}
    </span>
  )
}

/** Клікабельний варіант вибору: статус, пріоритет, виконавець. Один тап замість форми. */
export function Pill({ active, onClick, children, disabled, title }: {
  active?: boolean; onClick: () => void; children: ReactNode; disabled?: boolean; title?: string
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={title} aria-pressed={!!active}
      className={`inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-[13px] border transition-colors disabled:opacity-40 ${
        active ? 'border-accent text-accent bg-accentSoft' : 'border-line text-muted hover:bg-surface2'}`}>
      {children}
    </button>
  )
}
