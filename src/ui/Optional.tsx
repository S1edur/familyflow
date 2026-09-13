import { useEffect, useState, type ReactNode } from 'react'
import { AttachButton } from './Links'

/**
 * Необовʼязкові поля форми.
 *
 * Форма, де всі можливості розкладені порожніми полями, читається як список
 * обовʼязків: людина бачить десять інпутів і не розуміє, які з них треба їй.
 * Тому порожнє необовʼязкове поле — це не поле, а кнопка «додати».
 *
 * Правило: поле показується, якщо в ньому щось є (`filled`) або його додали.
 * Щойно поле стало видимим, воно лишається до хрестика або до розмонтування
 * форми — навіть коли текст стерли, щоб вписати заново: інакше поле зникло б
 * разом із фокусом посеред набору. Хрестик — `render` отримує цю дію і віддає
 * її в `Field onRemove`.
 *
 * Обовʼязкові поля сюди не кладемо: назва, сума, конверт — це те, без чого
 * сутність не існує, вони завжди видимі.
 */
export interface OptionalItem {
  key: string
  /** Підпис на кнопці «додати». Зазвичай збігається з підписом поля. */
  label: string
  /** У полі вже щось є — тоді воно видиме завжди. */
  filled: boolean
  /** Скинути значення. Без нього поле не згортається назад. */
  clear?: () => void
  render: (remove?: () => void) => ReactNode
}

export function OptionalFields({ items, label = 'Додати' }: {
  items: OptionalItem[]
  label?: string
}) {
  const [open, setOpen] = useState<string[]>([])

  // Заповнене поле запамʼятовуємо як відкрите: коли його очистять, `filled`
  // стане false, але поле має лишитись на місці.
  const filledKeys = items.filter(i => i.filled).map(i => i.key).join('\n')
  useEffect(() => {
    if (!filledKeys) return
    const keys = filledKeys.split('\n')
    setOpen(o => (keys.every(k => o.includes(k)) ? o : [...o, ...keys.filter(k => !o.includes(k))]))
  }, [filledKeys])

  const hide = (it: OptionalItem) => {
    it.clear?.()
    setOpen(o => o.filter(k => k !== it.key))
  }

  const shown = items.filter(i => i.filled || open.includes(i.key))
  const rest = items.filter(i => !i.filled && !open.includes(i.key))

  return (
    <>
      {shown.map(i => (
        <div key={i.key}>{i.render(i.clear ? () => hide(i) : undefined)}</div>
      ))}

      {rest.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          <span className="text-[11.5px] uppercase tracking-wider text-faint mr-0.5">{label}</span>
          {rest.map(i => (
            <AttachButton key={i.key} onClick={() => setOpen(o => [...o, i.key])}>
              {i.label}
            </AttachButton>
          ))}
        </div>
      )}
    </>
  )
}
