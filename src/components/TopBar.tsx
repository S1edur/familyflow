import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Avatar, Empty, Icon, SectionTitle, Sheet, toast } from '../ui'
import { useDB, setMe, notices } from '../data/store'
import { readSeenAt, writeSeenAt } from '../lib/prefs'
import { usePendingCount } from '../data/queue'
import { drain } from '../data/store'

/**
 * Назви екранів живуть тут, а не в самих сторінках: топ-бар забрав заголовки,
 * тож джерело правди має бути одне.
 */
const TITLES: Record<string, string> = {
  '/': 'Сьогодні',
  '/tasks': 'Задачі',
  '/month': 'Місяць',
  '/shopping': 'Покупки',
  '/funds': 'Фонди і цілі',
  '/debts': 'Борги',
  '/history': 'Історія',
  '/settings': 'Ще',
  '/settings/family': "Сім'я і валюти",
  '/tasks/shopping': 'Сходити в магазин',
}

/**
 * Слід навігації. Таб-бар не має «назад», тож для екранів, у які заходять
 * із іншого екрана, батько показується чіпсом ліворуч від назви.
 */
const TRAIL: Record<string, { to: string; label: string }> = {
  '/tasks/shopping': { to: '/tasks', label: 'Задачі' },
  '/settings/family': { to: '/settings', label: 'Ще' },
}

export function TopBar() {
  const db = useDB()
  const nav = useNavigate()
  const { pathname } = useLocation()

  const title = TITLES[pathname] ?? 'Family Flow'
  const parent = TRAIL[pathname]

  const pending = usePendingCount()
  const [open, setOpen] = useState(false)
  const [seenAt, setSeenAt] = useState(readSeenAt)
  const { fresh, soon } = notices(db, seenAt)

  // Тост на подію, що зʼявилась поки застосунок відкритий. Показуємо лише
  // те, чого ще не показували — інакше кожен рендер сипав би тими самими.
  const shown = useRef<Set<string> | null>(null)
  useEffect(() => {
    if (shown.current === null) {           // перший рендер: не кричимо про накопичене
      shown.current = new Set(fresh.map(f => f.id))
      return
    }
    for (const f of fresh) {
      if (shown.current.has(f.id)) continue
      shown.current.add(f.id)
      toast(f.text, { action: { label: 'Глянути', run: () => nav(f.to) } })
    }
  }, [fresh, nav])

  const openPanel = () => setOpen(true)
  const closePanel = () => {
    setOpen(false)
    const now = new Date().toISOString()
    writeSeenAt(now); setSeenAt(now)
  }

  return (
    <header className="sticky top-0 z-30 bg-bg/85 backdrop-blur border-b border-line">
      <div className="h-12 px-2 sm:px-4 flex items-center gap-1 min-w-0">
        {parent ? (
          <nav aria-label="Навігація" className="flex items-center gap-1 min-w-0">
            <button onClick={() => nav(parent.to)}
              className="shrink-0 inline-flex items-center gap-1 h-7 pl-1.5 pr-2.5 rounded-full bg-surface2 text-[12.5px] text-muted hover:text-ink transition-colors">
              <span className="rotate-180 text-faint">{Icon.chev(13)}</span>
              {parent.label}
            </button>
            <span className="shrink-0 text-faint text-[13px]" aria-hidden>›</span>
            <h1 className="min-w-0 truncate text-[17px] font-semibold tight">{title}</h1>
          </nav>
        ) : (
          <h1 className="min-w-0 truncate text-[17px] font-semibold tight pl-2">{title}</h1>
        )}
        <span className="flex-1" />

        {/* Черга не має бути чорною скринькою: якщо зміни не доїхали,
            це видно, і тап пробує ще раз. */}
        {pending > 0 && (
          <button onClick={() => void drain()}
            aria-label={`${pending} змін чекає на відправку, натисніть щоб спробувати ще раз`}
            title="Зміни ще не відправлені. Натисніть, щоб спробувати ще раз."
            className="shrink-0 inline-flex items-center gap-1 h-7 px-2 rounded-full bg-warnSoft text-warn text-[11.5px]">
            {Icon.clock(13)}<span className="num">{pending}</span>
          </button>
        )}

        <button onClick={openPanel} aria-label={fresh.length ? `Повідомлення, нових ${fresh.length}` : 'Повідомлення'}
          className="relative h-9 w-9 shrink-0 grid place-items-center rounded-lg text-muted hover:bg-surface2">
          {Icon.bell(18)}
          {fresh.length > 0 && (
            <span className="absolute top-1.5 right-1.5 min-w-[15px] h-[15px] px-1 rounded-full bg-accent text-white text-[9.5px] grid place-items-center num">
              {fresh.length}
            </span>
          )}
        </button>

        {/* перемикач учасника: на десктопі він уже є в боковій панелі */}
        <div className="sm:hidden flex items-center gap-0.5 shrink-0">
          {db.members.map(m => (
            <button key={m.id} onClick={() => setMe(m.id)}
              aria-label={`Записувати як ${m.name}`}
              aria-pressed={db.meId === m.id}
              className={`p-1 rounded-full transition-opacity ${
                db.meId === m.id ? 'ring-2 ring-accent' : 'opacity-40'}`}>
              <Avatar member={m} size={22} />
            </button>
          ))}
        </div>
      </div>

      <Sheet open={open} onClose={closePanel} title="Повідомлення">
        {!fresh.length && !soon.length && (
          <Empty>Нічого нового. І нічого термінового — теж добре.</Empty>
        )}

        {fresh.length > 0 && <>
          <SectionTitle>Нове</SectionTitle>
          <ul className="divide-y divide-line">
            {fresh.map(n => (
              <li key={n.id}>
                <button onClick={() => { closePanel(); nav(n.to) }}
                  className="w-full text-left py-2.5 flex items-center gap-2">
                  <span className="flex-1 min-w-0 text-[14px]">{n.text}
                    {n.detail && <span className="text-faint"> · {n.detail}</span>}
                  </span>
                  <span className="text-faint shrink-0">{Icon.chev(15)}</span>
                </button>
              </li>
            ))}
          </ul>
        </>}

        {soon.length > 0 && <>
          <SectionTitle>Найближчим часом</SectionTitle>
          <ul className="divide-y divide-line">
            {soon.map(n => (
              <li key={n.id}>
                <button onClick={() => { closePanel(); nav(n.to) }}
                  className="w-full text-left py-2.5 flex items-center gap-2">
                  <span className="flex-1 min-w-0 text-[14px] truncate">{n.text}</span>
                  {n.detail && <span className="shrink-0 text-[12.5px] text-faint num">{n.detail}</span>}
                  <span className="text-faint shrink-0">{Icon.chev(15)}</span>
                </button>
              </li>
            ))}
          </ul>
          <p className="text-[12px] text-faint mt-3 leading-snug">
            Тут лише ваші справи. Про чуже прострочене застосунок не повідомляє.
          </p>
        </>}
      </Sheet>
    </header>
  )
}
