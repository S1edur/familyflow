import type { ReactNode, KeyboardEvent } from 'react'

/** Порожній стан. Пояснює, що тут буде, і дає одну дію — не порожня сітка. */
export function Empty({ children }: { children: ReactNode }) {
  return <div className="py-10 text-center text-[13.5px] text-faint">{children}</div>
}

/** Заголовок секції, за потреби — дія праворуч. */
export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between px-4 sm:px-0 mb-2 mt-6 first:mt-0">
      <h2 className="text-[12px] uppercase tracking-wider text-faint font-medium">{children}</h2>
      {right}
    </div>
  )
}

/** Картка з рамкою — підсумок, блок форми, зведення. */
export function Card({ children, className = '', padded = true }: {
  children: ReactNode; className?: string; padded?: boolean
}) {
  return (
    <div className={`rounded-xl border border-line bg-surface ${padded ? 'p-4' : ''} ${className}`}>
      {children}
    </div>
  )
}

/** Рядок списку зі сталою висотою і полями екрана. За замовчуванням — `li`. */
export function ListRow({ children, as = 'li', onClick, className = '' }: {
  children: ReactNode; as?: 'li' | 'div'; onClick?: () => void; className?: string
}) {
  const cls = `flex items-center gap-2.5 px-4 sm:px-6 h-11 ${onClick ? 'cursor-pointer hover:bg-surface2 transition-colors' : ''} ${className}`

  // клікабельний рядок має бути доступним з клавіатури, інакше екран
  // працює тільки мишею: роль, фокус і Enter/Пробіл як у кнопки
  const interactive = onClick
    ? {
        onClick,
        role: 'button' as const,
        tabIndex: 0,
        onKeyDown: (e: KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() }
        },
      }
    : {}

  if (as === 'div') return <div className={cls} {...interactive}>{children}</div>
  return <li className={cls} {...interactive}>{children}</li>
}

/** Підпис + число. Число завжди `num`, символ валюти вже всередині рядка. */
export function Stat({ label, value, tone = 'default' }: {
  label: string; value: ReactNode; tone?: 'default' | 'warn' | 'muted'
}) {
  const c = tone === 'warn' ? 'text-warn' : tone === 'muted' ? 'text-muted' : ''
  return (
    <div>
      <dt className="text-[11.5px] text-faint">{label}</dt>
      <dd className={`num ${c}`}>{value}</dd>
    </div>
  )
}
