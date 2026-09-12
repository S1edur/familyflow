import { useLocation, useNavigate } from 'react-router-dom'
import { Avatar, Icon } from '../ui'
import { useDB, setMe } from '../data/store'

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
    </header>
  )
}
