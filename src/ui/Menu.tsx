import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './Icon'

export type MenuOption<T extends string | number> = { value: T; label: string; icon?: ReactNode }

const GAP = 4     // між тригером і меню
const MARGIN = 8  // мінімальний відступ від краю вікна

/**
 * Одна компактна властивість (статус, пріоритет, виконавець) — чип, що відкриває
 * маленьке меню вибору. Замінює блок пілюль: у листі лишається один рядок чипів
 * замість пів екрана варіантів, які потрібні лише в момент зміни.
 *
 * Меню `position: fixed` за `getBoundingClientRect()` тригера і рендериться
 * порталом у body: лист має `overflow-y-auto`, тож absolute-меню всередині
 * обрізалося б його краєм.
 */
export function PropertyMenu<T extends string | number>({ label, value, options, onChange, placeholder }: {
  label: string
  value: T
  options: MenuOption<T>[]
  onChange: (v: T) => void
  placeholder?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [pos, setPos] = useState<CSSProperties | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const id = useId()
  const current = options.find(o => o.value === value)

  const show = () => {
    setActive(Math.max(0, options.findIndex(o => o.value === value)))
    setPos(null)
    setOpen(true)
  }
  const close = (refocus: boolean) => {
    setOpen(false)
    if (refocus) triggerRef.current?.focus()
  }
  const pick = (v: T) => {
    close(true)
    if (v !== value) onChange(v)
  }

  // Міряємо до відмальовки, щоб меню не блимало в куті екрана.
  useLayoutEffect(() => {
    if (!open) return
    const t = triggerRef.current, m = menuRef.current
    if (!t || !m) return
    const r = t.getBoundingClientRect()
    const w = m.offsetWidth, h = m.offsetHeight
    const below = window.innerHeight - r.bottom - GAP - MARGIN
    const above = r.top - GAP - MARGIN
    const up = h > below && above > below
    const maxHeight = up ? above : below
    const top = up ? r.top - GAP - Math.min(h, maxHeight) : r.bottom + GAP
    const left = Math.max(MARGIN, Math.min(r.left, window.innerWidth - w - MARGIN))
    setPos({ top, left, maxHeight })
    m.focus({ preventScroll: true })
  }, [open])

  useEffect(() => {
    if (!open) return
    const inside = (n: EventTarget | null) =>
      n instanceof Node && (!!menuRef.current?.contains(n) || !!triggerRef.current?.contains(n))

    const onDown = (e: PointerEvent) => { if (!inside(e.target)) close(false) }
    // window + capture спрацьовує раніше за keydown листа на document,
    // тож Escape закриває тільки меню, а не весь лист.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(true) }
      else if (e.key === 'Tab') close(false)
    }
    // Позиція fixed не їде разом зі скролом листа — простіше закрити, ніж доганяти.
    const onScroll = (e: Event) => { if (!(e.target instanceof Node && menuRef.current?.contains(e.target))) close(false) }
    const onResize = () => close(false)

    document.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
    }
  }, [open])

  const onMenuKey = (e: ReactKeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => (i + 1) % options.length) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => (i - 1 + options.length) % options.length) }
    else if (e.key === 'Home') { e.preventDefault(); setActive(0) }
    else if (e.key === 'End') { e.preventDefault(); setActive(options.length - 1) }
    else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      const o = options[active]
      if (o) pick(o.value)
    }
  }

  useEffect(() => {
    if (open) document.getElementById(`${id}-${active}`)?.scrollIntoView({ block: 'nearest' })
  }, [open, active, id])

  return (
    <>
      <button ref={triggerRef} type="button"
        aria-haspopup="menu" aria-expanded={open} aria-controls={open ? `${id}-menu` : undefined}
        aria-label={`${label}: ${current?.label ?? (typeof placeholder === 'string' ? placeholder : 'не задано')}`}
        onClick={() => (open ? close(false) : show())}
        onKeyDown={e => { if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !open) { e.preventDefault(); show() } }}
        className={`inline-flex items-center gap-1.5 h-7 px-2 rounded-lg border border-line text-[13px] whitespace-nowrap
          hover:bg-surface2 outline-none focus-visible:border-accent ${open ? 'bg-surface2' : ''}
          ${current ? 'text-ink' : 'text-muted'}`}>
        {current
          ? <>{current.icon && <span className="inline-flex shrink-0">{current.icon}</span>}{current.label}</>
          : placeholder ?? label}
      </button>

      {open && createPortal(
        <div ref={menuRef} id={`${id}-menu`} role="menu" aria-label={label} tabIndex={-1}
          aria-activedescendant={`${id}-${active}`}
          onKeyDown={onMenuKey}
          style={pos ?? { top: 0, left: 0, visibility: 'hidden' }}
          className="fixed z-[60] min-w-[180px] max-w-[calc(100vw-16px)] overflow-y-auto p-1
            rounded-lg border border-line bg-surface shadow-xl outline-none">
          {options.map((o, i) => {
            const checked = o.value === value
            return (
              <div key={String(o.value)} id={`${id}-${i}`} role="menuitemradio" aria-checked={checked}
                onMouseMove={() => setActive(i)}
                onClick={() => pick(o.value)}
                className={`flex items-center gap-2 h-9 px-2 rounded-md text-[13px] cursor-pointer select-none
                  ${i === active ? 'bg-surface2' : ''}`}>
                {o.icon && <span className="inline-flex w-4 justify-center shrink-0">{o.icon}</span>}
                <span className="flex-1 truncate">{o.label}</span>
                <span className={`shrink-0 text-accent ${checked ? '' : 'invisible'}`}>{Icon.check(14)}</span>
              </div>
            )
          })}
        </div>,
        document.body,
      )}
    </>
  )
}
