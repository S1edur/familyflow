import { useState } from 'react'
import { NavLink, Route, Routes, useLocation } from 'react-router-dom'
import { Icon } from './components/ui'
import { QuickAdd } from './components/QuickAdd'
import { useDB } from './data/store'
import Today from './pages/Today'
import Tasks from './pages/Tasks'
import Month from './pages/Month'
import Shopping from './pages/Shopping'
import Funds from './pages/Funds'
import Debts from './pages/Debts'

const NAV = [
  { to: '/',         label: 'Сьогодні', icon: Icon.home },
  { to: '/tasks',    label: 'Задачі',   icon: Icon.check },
  { to: '/month',    label: 'Місяць',   icon: Icon.wallet },
  { to: '/shopping', label: 'Покупки',  icon: Icon.cart },
  { to: '/funds',    label: 'Фонди',    icon: Icon.piggy },
]

export default function App() {
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
          <div className="text-[12px] text-faint">
            {db.members.map(m => m.name).join(' і ')}
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
        <NavLink to="/debts"
          className={({ isActive }) => `flex items-center gap-2.5 h-9 px-2 rounded-lg text-[14px] transition-colors ${
            isActive ? 'bg-surface2 text-ink font-medium' : 'text-muted hover:text-ink hover:bg-surface2/60'}`}>
          <span className="shrink-0">{Icon.list(18)}</span>Борги
        </NavLink>

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
      <main className="flex-1 min-w-0 pb-32 sm:pb-8">
        <Routes>
          <Route path="/" element={<Today onQuickAdd={() => setQuick(true)} />} />
          <Route path="/tasks" element={<Tasks />} />
          <Route path="/month" element={<Month />} />
          <Route path="/shopping" element={<Shopping />} />
          <Route path="/funds" element={<Funds />} />
          <Route path="/debts" element={<Debts />} />
        </Routes>
      </main>

      {/* мобільний таб-бар */}
      <nav className="sm:hidden fixed bottom-0 inset-x-0 z-40 bg-surface/95 backdrop-blur border-t border-line safe-b">
        <div className="grid grid-cols-5">
          {NAV.map(n => {
            const active = n.to === '/' ? loc.pathname === '/' : loc.pathname.startsWith(n.to)
            return (
              <NavLink key={n.to} to={n.to} end={n.to === '/'}
                className={`flex flex-col items-center gap-0.5 py-2 text-[10.5px] ${active ? 'text-accent' : 'text-faint'}`}>
                <span className="relative">
                  {n.icon(21)}
                  {n.to === '/shopping' && cart > 0 &&
                    <span className="absolute -top-1 -right-2 min-w-4 h-4 px-1 rounded-full bg-accent text-white text-[9px] grid place-items-center num">{cart}</span>}
                </span>
                {n.label}
              </NavLink>
            )
          })}
        </div>
      </nav>

      {/* плаваюча кнопка на мобільному */}
      <button onClick={() => setQuick(true)} aria-label="Додати витрату"
        className="sm:hidden fixed left-4 bottom-[88px] z-40 p-3.5 rounded-full bg-accent text-white shadow-lg ring-4 ring-bg">
        {Icon.plus(22)}
      </button>

      <QuickAdd open={quick} onClose={() => setQuick(false)} />
    </div>
  )
}
