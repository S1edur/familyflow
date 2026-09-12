/** Вкладки екрана. `badge` показуємо тільки коли > 0. */
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

/** Перемикач 2–4 взаємовиключних варіантів усередині форми. Не вкладки екрана. */
export function Segmented<T extends string>({ value, onChange, items, full, label }: {
  value: T; onChange: (v: T) => void; items: { value: T; label: string }[]
  full?: boolean; label?: string
}) {
  return (
    <div role="radiogroup" aria-label={label}
         className={`inline-flex p-0.5 rounded-lg bg-surface2 ${full ? 'w-full' : ''}`}>
      {items.map(it => (
        <button key={it.value} type="button" role="radio" aria-checked={value === it.value}
          onClick={() => onChange(it.value)}
          className={`h-8 px-3 rounded-[7px] text-[13.5px] font-medium transition-colors ${full ? 'flex-1' : ''} ${
            value === it.value ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink'}`}>
          {it.label}
        </button>
      ))}
    </div>
  )
}
