/** Смужка виконання. Перевищення — бурштинове (`warn`), ніколи не червоне. */
export function Progress({ value, tone = 'accent', height = 6 }: {
  value: number; tone?: 'accent' | 'warn' | 'neutral'; height?: number
}) {
  const c = tone === 'warn' ? 'var(--c-warn)' : tone === 'neutral' ? 'var(--c-line2)' : 'var(--c-accent)'
  return (
    <div className="w-full rounded-full bg-surface2 overflow-hidden" style={{ height }}>
      <div className="h-full rounded-full transition-[width] duration-300"
           style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%`, background: c }} />
    </div>
  )
}
