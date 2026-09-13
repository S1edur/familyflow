import { useEffect, useRef, type ReactNode } from 'react'
import { Icon } from './Icon'

/** Нижній лист на телефоні, діалог на десктопі. Esc і клік по підкладці закривають. */
export function Sheet({ open, onClose, title, children }: {
  open: boolean; onClose: () => void; title?: string; children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = '' }
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center fade-in"
         onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="absolute inset-0 bg-black/35" />
      <div ref={ref} role="dialog" aria-modal
           className="sheet-enter relative w-full sm:w-[460px] bg-surface border-t sm:border border-line sm:rounded-xl rounded-t-2xl shadow-xl max-h-[92vh] overflow-y-auto safe-b">
        <div className="flex items-center justify-between px-4 sm:px-5 pt-4 pb-2">
          <div className="text-[15px] font-semibold">{title}</div>
          <button onClick={onClose} className="text-faint hover:text-ink p-1 -mr-1" aria-label="Закрити">{Icon.x(18)}</button>
        </div>
        <div className="px-4 sm:px-5 pb-4 sm:pb-5">{children}</div>
      </div>
    </div>
  )
}
