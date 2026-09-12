import type { Member } from '../data/types'

/** Кружок учасника. Без member — «вільна» задача. */
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
