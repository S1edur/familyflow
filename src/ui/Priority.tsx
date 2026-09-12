import type { Priority } from '../data/types'

const P_LABEL: Record<Priority, string> = { 0: 'Без пріоритету', 1: 'Терміново', 2: 'Високий', 3: 'Середній', 4: 'Низький' }
const P_VAR: Record<Priority, string> = { 0: '--c-p4', 1: '--c-p1', 2: '--c-p2', 3: '--c-p3', 4: '--c-p4' }

/** Стовпчики пріоритету. 0 — «не проставлений», сірий і сортується останнім. */
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
