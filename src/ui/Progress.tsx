/**
 * Смужка виконання. Перевищення — бурштинове (`warn`), ніколи не червоне.
 *
 * `pending` — частка, яка вже розписана, але ще не сталася: автоматичні платежі
 * місяця. Блідий сегмент одразу за фактом показує, скільки з плану вже зайнято
 * і чіпати його не варто.
 */
export function Progress({ value, pending = 0, tone = 'accent', height = 6 }: {
  value: number; pending?: number; tone?: 'accent' | 'warn' | 'neutral'; height?: number
}) {
  const c = tone === 'warn' ? 'var(--c-warn)' : tone === 'neutral' ? 'var(--c-line2)' : 'var(--c-accent)'
  const v = Math.max(0, Math.min(1, value))
  const p = Math.max(0, Math.min(1 - v, pending))
  return (
    <div className="w-full rounded-full bg-surface2 overflow-hidden flex" style={{ height }}>
      <div className="h-full transition-[width] duration-300" style={{ width: `${v * 100}%`, background: c }} />
      {p > 0 && (
        // штриховка, а не просто блідий колір: суцільна смуга на всю ширину
        // читалась би як «уже виконано», а тут нічого ще не сталося
        <div className="h-full transition-[width] duration-300"
             style={{
               width: `${p * 100}%`,
               backgroundImage: `repeating-linear-gradient(135deg,`
                 + ` color-mix(in srgb, ${c} 45%, transparent) 0 3px, transparent 3px 6px)`,
             }} />
      )}
    </div>
  )
}
