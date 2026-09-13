import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './Icon'

// Скільки листів зараз відкрито. Один закрився, інший ще ні — скрол `body`
// має лишатись заблокованим, тож відновлюємо його лише коли лічильник дійшов до нуля.
let openSheets = 0
let savedOverflow = ''

function lockScroll() {
  if (openSheets++ === 0) {
    savedOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
  }
}

function unlockScroll() {
  if (--openSheets <= 0) {
    openSheets = 0
    document.body.style.overflow = savedOverflow
  }
}

/**
 * Нижній лист на телефоні, діалог на десктопі. Esc і клік по підкладці закривають.
 *
 * Рендериться порталом у `body`: предок із `backdrop-filter` (sticky-хедер)
 * стає контейнером для `position: fixed`, і лист виїжджав би за верх екрана.
 */
export function Sheet({ open, onClose, title, children }: {
  open: boolean; onClose: () => void; title?: string; children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const titleId = useId()
  // onClose часто інлайнова стрілка — через ref ефект не перезапускається
  // на кожному рендері й не смикає фокус
  const closeRef = useRef(onClose)
  useEffect(() => { closeRef.current = onClose })

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRef.current() }
    document.addEventListener('keydown', onKey)
    lockScroll()
    return () => { document.removeEventListener('keydown', onKey); unlockScroll() }
  }, [open])

  useEffect(() => {
    if (!open) return
    const prev = document.activeElement as HTMLElement | null
    // autoFocus поля всередині вже спрацював — не забираємо в нього фокус
    if (!ref.current?.contains(document.activeElement)) ref.current?.focus()
    return () => {
      if (prev && prev.isConnected && typeof prev.focus === 'function') prev.focus()
    }
  }, [open])

  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center fade-in"
         onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="absolute inset-0 bg-black/35" />
      <div ref={ref} role="dialog" aria-modal tabIndex={-1}
           aria-labelledby={title ? titleId : undefined}
           className="sheet-enter relative w-full sm:w-[460px] bg-surface border-t sm:border border-line sm:rounded-xl rounded-t-2xl shadow-xl max-h-[92vh] overflow-y-auto safe-b outline-none">
        <div className="flex items-center justify-between px-4 sm:px-5 pt-4 pb-2">
          <div id={titleId} className="text-[15px] font-semibold">{title}</div>
          <button onClick={onClose} className="text-faint hover:text-ink p-1 -mr-1" aria-label="Закрити">{Icon.x(18)}</button>
        </div>
        <div className="px-4 sm:px-5 pb-4 sm:pb-5">{children}</div>
      </div>
    </div>,
    document.body,
  )
}
