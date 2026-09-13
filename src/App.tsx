import { useState } from 'react'
import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom'
import { Avatar, Icon, Toaster } from './ui'
import { QuickAdd } from './components/QuickAdd'
import Welcome from './pages/Welcome'
import Onboarding from './pages/Onboarding'
import { TopBar } from './components/TopBar'
import { useDB, setMe } from './data/store'
import { useAuth, useHousehold } from './data/auth'
import Today from './pages/Today'
import Tasks from './pages/Tasks'
import Projects from './pages/Projects'
import Project from './pages/Project'
import Month from './pages/Month'
import Shopping from './pages/Shopping'
import History from './pages/History'
import Settings from './pages/Settings'
import SettingsFamily from './pages/SettingsFamily'

const NAV = [
  { to: '/',         label: 'Сьогодні', icon: Icon.home },
  { to: '/tasks',    label: 'Задачі',   icon: Icon.check },
  { to: '/projects', label: 'Проєкти',  icon: Icon.piggy },
  { to: '/month',    label: 'Місяць',   icon: Icon.calendar },
  { to: '/shopping', label: 'Покупки',  icon: Icon.cart },
]

/**
 * Мобільний таб-бар: рівно пʼять пунктів, «Витрата» рівно в центрі.
 * Сім пунктів на 375px дають 53px на кожен — підписи не вміщуються,
 * тому Місяць, Покупки й Історія живуть у «Ще» та в боковій панелі на десктопі.
 */
const TABS = [
  { to: '/',         label: 'Сьогодні', icon: Icon.home },
  { to: '/tasks',    label: 'Задачі',   icon: Icon.check },
  { to: '/projects', label: 'Проєкти',  icon: Icon.piggy },
  { to: '/settings', label: 'Ще',       icon: Icon.gear },
]

/** Екрани, що відкриваються через «Ще»: на них підсвічуємо «Ще», інакше таб-бар порожній. */
const MORE_PATHS = ['/month', '/shopping', '/history']

const SECONDARY = [
  { to: '/history',  label: 'Історія',      icon: Icon.clock },
  { to: '/settings', label: 'Налаштування', icon: Icon.gear },
]

function Tab({ n, path, cart }: {
  n: { to: string; label: string; icon: (s?: number) => React.ReactNode }
  path: string; cart: number
}) {
  const active = n.to === '/' ? path === '/'
    : n.to === '/settings' ? path.startsWith(n.to) || MORE_PATHS.some(p => path.startsWith(p))
    : path.startsWith(n.to)
  return (
    <NavLink to={n.to} end={n.to === '/'}
      className={`flex flex-col items-center gap-0.5 py-2 text-[10.5px] ${active ? 'text-accent' : 'text-faint'}`}>
      <span className="relative">
        {n.icon(21)}
        {n.to === '/shopping' && cart > 0 &&
          <span className="absolute -top-1 -right-2 min-w-4 h-4 px-1 rounded-full bg-accent text-white text-[9px] grid place-items-center num">{cart}</span>}
      </span>
      {n.label}
    </NavLink>
  )
}

/**
 * Старі адреси моделі «конверти, фонди, борги». Вибраний місяць (?m=)
 * переносимо, решту параметрів — ні: вони вказували на сутності, яких більше немає.
 */
function Legacy({ to }: { to: string }) {
  const { search } = useLocation()
  const m = new URLSearchParams(search).get('m')
  return <Navigate replace to={m && to === '/month' ? `/month?m=${m}` : to} />
}

export default function App() {
  const auth = useAuth()
  const household = useHousehold()

  // Без ключів застосунок працює як раніше, на локальних даних — це режим
  // офлайнової однофайлової збірки, а не помилка налаштування.
  if (auth.status === 'loading' || (auth.status === 'in' && household === undefined)) {
    return <div className="min-h-full grid place-items-center text-[13px] text-faint">Хвилинку…</div>
  }
  if (auth.status === 'anon') return <Welcome />
  if (auth.status === 'in' && household === null) return <Onboarding />

  return <Shell />
}

function Shell() {
  const db = useDB()
  const [quick, setQuick] = useState(false)
  const loc = useLocation()
  const [dark, setDark] = useState(document.documentElement.classList.contains('dark'))

  const toggleTheme = () => {
    const next = !dark
    setDark(next)
    document.documentElement.classList.toggle('dark', next)
    localStorage.setItem('ff.theme', next ? 'dark' : 'light')
  }

  const cart = db.shoppingItems.filter(i => !i.checkedAt).length

  return (
    <div className="min-h-full flex">
      {/* десктоп: бокова панель */}
      <aside className="hidden sm:flex flex-col w-[212px] shrink-0 border-r border-line px-3 py-4 gap-1">
        <div className="px-2 pb-4">
          <div className="text-[15px] font-semibold tracking-tight">Family Flow</div>
          <div className="flex items-center gap-1 mt-1.5">
            {db.members.map(m => (
              <button key={m.id} onClick={() => setMe(m.id)} title={`Записувати як ${m.name}`}
                className={`inline-flex items-center gap-1.5 h-7 pl-0.5 pr-2 rounded-full border transition-colors ${
                  db.meId === m.id ? 'border-accent bg-accentSoft text-accentInk' : 'border-transparent text-faint hover:bg-surface2'}`}>
                <Avatar member={m} size={20} />
                <span className="text-[11.5px]">{m.name}</span>
              </button>
            ))}
          </div>
        </div>
        {NAV.map(n => (
          <NavLink key={n.to} to={n.to} end={n.to === '/'}
            className={({ isActive }) => `flex items-center gap-2.5 h-9 px-2 rounded-lg text-[14px] transition-colors ${
              isActive ? 'bg-surface2 text-ink font-medium' : 'text-muted hover:text-ink hover:bg-surface2/60'}`}>
            <span className="shrink-0">{n.icon(18)}</span>{n.label}
            {n.to === '/shopping' && cart > 0 && <span className="ml-auto text-[12px] text-faint num">{cart}</span>}
          </NavLink>
        ))}
        {SECONDARY.map(n => (
          <NavLink key={n.to} to={n.to}
            className={({ isActive }) => `flex items-center gap-2.5 h-9 px-2 rounded-lg text-[14px] transition-colors ${
              isActive ? 'bg-surface2 text-ink font-medium' : 'text-muted hover:text-ink hover:bg-surface2/60'}`}>
            <span className="shrink-0">{n.icon(18)}</span>{n.label}
          </NavLink>
        ))}

        <div className="mt-auto flex items-center gap-1 px-1">
          <button onClick={toggleTheme} className="h-9 w-9 grid place-items-center rounded-lg text-muted hover:bg-surface2"
                  aria-label="Тема">{dark ? Icon.sun(17) : Icon.moon(17)}</button>
          <button onClick={() => setQuick(true)}
            className="flex-1 h-9 rounded-lg bg-accent text-white text-[13.5px] font-medium flex items-center justify-center gap-1.5">
            {Icon.plus(16)} Витрата
          </button>
        </div>
      </aside>

      {/* контент */}
      <main className="flex-1 min-w-0 pb-24 sm:pb-8">
        <TopBar />
        <Routes>
          <Route path="/" element={<Today onQuickAdd={() => setQuick(true)} />} />
          <Route path="/tasks" element={<Tasks />} />
          {/* той самий список покупок, але як крок із задачі: своя назва і слід назад */}
          <Route path="/tasks/shopping" element={<Shopping />} />
          <Route path="/projects" element={<Projects />} />
          <Route path="/projects/:id" element={<Project />} />
          <Route path="/month" element={<Month />} />
          {/* «Місяць» розʼїхався на два екрани — старі посилання ведемо далі */}
          <Route path="/shopping" element={<Shopping />} />
          {/* старі адреси */}
          <Route path="/envelopes" element={<Legacy to="/month" />} />
          <Route path="/bills" element={<Legacy to="/month" />} />
          <Route path="/funds" element={<Legacy to="/projects" />} />
          <Route path="/debts" element={<Legacy to="/projects" />} />
          <Route path="/history" element={<History />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/settings/family" element={<SettingsFamily />} />
        </Routes>
      </main>

      {/* мобільний таб-бар */}
      <nav className="sm:hidden fixed bottom-0 inset-x-0 z-40 bg-surface/95 backdrop-blur border-t border-line safe-b">
        <div className="grid grid-cols-5">
          {TABS.slice(0, 2).map(n => <Tab key={n.to} n={n} path={loc.pathname} cart={cart} />)}

          {/* «Витрата» — не посилання, а дія: відкриває лист швидкого запису */}
          <button onClick={() => setQuick(true)} aria-label="Записати витрату"
            className="flex flex-col items-center gap-0.5 py-2 text-[10.5px] text-accent">
            <span className="grid place-items-center h-[21px] w-[21px] rounded-full bg-accent text-white">
              {Icon.plus(15)}
            </span>
            Витрата
          </button>

          {TABS.slice(2).map(n => <Tab key={n.to} n={n} path={loc.pathname} cart={cart} />)}
        </div>
      </nav>

      <QuickAdd open={quick} onClose={() => setQuick(false)} />
      <Toaster />
    </div>
  )
}
