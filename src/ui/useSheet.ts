import { useSearchParams } from 'react-router-dom'

/**
 * Відкритий лист живе в адресі: `?env=<id>`, `?fund=new`, `?tab=bills&rule=<id>`.
 *
 * Через це на конверт, фонд, борг чи правило можна послатися з будь-якого
 * екрана — саме цього бракувало, коли звʼязок було видно, а перейти по ньому
 * не можна. Заодно «назад» на телефоні закриває лист, а не весь екран.
 *
 * `replace: true` навмисно: відкриття листа не має засмічувати історію.
 */
export function useSheet(key: string) {
  const [params, setParams] = useSearchParams()

  const patch = (updates: Record<string, string | null>) => setParams(prev => {
    const next = new URLSearchParams(prev)
    for (const [k, v] of Object.entries(updates)) {
      if (v === null) next.delete(k)
      else next.set(k, v)
    }
    return next
  }, { replace: true })

  const set = (v: string | null, also: Record<string, string | null> = {}) =>
    patch({ [key]: v, ...also })

  return [params.get(key), set, patch] as const
}
