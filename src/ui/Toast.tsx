import { useSyncExternalStore } from 'react'
import { Icon } from './Icon'

/**
 * Тости. Модульне сховище, а не контекст: toast() має викликатись
 * із будь-якої дії, включно з тими, що живуть у src/data/store.ts,
 * без обгортання половини застосунку в провайдер.
 *
 * Тон: `info` за замовчуванням, `warn` для попереджень. Червоного немає
 * взагалі — за CLAUDE.md перевищення й прострочення бурштинові, а тост
 * не та поверхня, щоб уводити новий сигнал тривоги.
 */
export type ToastTone = 'info' | 'warn'
export interface Toast {
  id: number
  text: string
  tone: ToastTone
  action?: { label: string; run: () => void }
}

const LIFE_MS = 4000
let items: Toast[] = []
let seq = 0
const listeners = new Set<() => void>()

function emit() {
  items = [...items]
  listeners.forEach(l => l())
}

export function toast(text: string, opts: { tone?: ToastTone; action?: Toast['action'] } = {}) {
  const id = ++seq
  items.push({ id, text, tone: opts.tone ?? 'info', action: opts.action })
  // більше трьох одночасно — це вже не підказка, а шум
  if (items.length > 3) items = items.slice(-3)
  emit()
  setTimeout(() => dismissToast(id), LIFE_MS)
  return id
}

export function dismissToast(id: number) {
  const next = items.filter(t => t.id !== id)
  if (next.length === items.length) return
  items = next
  emit()
}

function useToasts(): Toast[] {
  return useSyncExternalStore(
    l => { listeners.add(l); return () => listeners.delete(l) },
    () => items,
    () => items,
  )
}

/** Рендериться один раз у App. Над таб-баром на мобільному, у куті на десктопі. */
export function Toaster() {
  const list = useToasts()
  if (!list.length) return null

  return (
    <div aria-live="polite" aria-atomic="false"
      className="fixed z-50 inset-x-3 bottom-[76px] sm:inset-x-auto sm:right-4 sm:bottom-4 sm:w-[340px] flex flex-col gap-2 pointer-events-none">
      {list.map(t => (
        <div key={t.id}
          className={`toast-in pointer-events-auto flex items-center gap-2.5 rounded-lg border px-3 py-2.5 shadow-lg backdrop-blur ${
            t.tone === 'warn'
              ? 'border-warn/40 bg-warnSoft text-ink'
              : 'border-line bg-surface text-ink'}`}>
          <span className={`shrink-0 ${t.tone === 'warn' ? 'text-warn' : 'text-accent'}`}>
            {t.tone === 'warn' ? Icon.clock(16) : Icon.check(16)}
          </span>
          <span className="flex-1 text-[13.5px] leading-snug">{t.text}</span>
          {t.action && (
            <button onClick={() => { t.action!.run(); dismissToast(t.id) }}
              className="shrink-0 text-[13px] font-medium text-accent px-1">
              {t.action.label}
            </button>
          )}
          <button onClick={() => dismissToast(t.id)} aria-label="Закрити"
            className="shrink-0 text-faint hover:text-ink p-0.5">
            {Icon.x(14)}
          </button>
        </div>
      ))}
    </div>
  )
}
