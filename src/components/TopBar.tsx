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
  '/settings/envelopes': 'Конверти',
  '/settings/plans': 'Регулярні платежі',
  '/settings/funds': 'Фонди',
  '/settings/debts': 'Борги',
  '/settings/chores': 'Побутові задачі',
  '/settings/family': "Сім'я і валюти",
}

export function TopBar() {
  const db = useDB()
  const nav = useNavigate()
  const { pathname } = useLocation()

  const title = TITLES[pathname] ?? 'Family Flow'
  // вкладені розділи: з таб-бара назад не повернешся, тож шеврон тут обовʼязковий
  const nested = pathname.startsWith('/settings/')

  return (
    <header className="sticky top-0 z-30 bg-bg/85 backdrop-blur border-b border-line">
      <div className="h-12 px-2 sm:px-4 flex items-center gap-1">
        {nested && (
          <button onClick={() => nav('/settings')} aria-label="Назад до «Ще»"
            className="h-9 w-9 shrink-0 grid place-items-center rounded-lg text-muted hover:bg-surface2 rotate-180">
            {Icon.chev(18)}
          </button>
        )}
        <h1 className={`flex-1 min-w-0 truncate text-[17px] font-semibold tight ${nested ? '' : 'pl-2'}`}>
          {title}
        </h1>

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
