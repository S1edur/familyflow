import { Link } from 'react-router-dom'
import { Avatar, Icon, SectionTitle } from '../components/ui'
import { useDB, setMe } from '../data/store'

const SECTIONS = [
  { to: '/settings/envelopes', label: 'Конверти',          hint: 'Куди розкладаються гроші' },
  { to: '/settings/plans',     label: 'Регулярні платежі', hint: 'Що і якого числа платимо' },
  { to: '/settings/funds',     label: 'Фонди',             hint: 'Цілі й скільки відкладати' },
  { to: '/settings/debts',     label: 'Борги',             hint: 'Кому, скільки, до коли' },
  { to: '/settings/chores',    label: 'Побутові задачі',   hint: 'Що повторюється і як часто' },
  { to: '/settings/family',    label: "Сім'я і валюти",    hint: 'Учасники і курси' },
]

export default function Settings() {
  const db = useDB()

  return (
    <div className="max-w-[760px] mx-auto">
      <header className="px-4 pt-5 pb-3 sm:px-6">
        <h1 className="text-[22px] font-semibold tracking-tight">Налаштування</h1>
      </header>

      <SectionTitle>Зараз записує</SectionTitle>
      <div className="px-4 sm:px-6">
        <div className="flex gap-1.5">
          {db.members.map(m => (
            <button key={m.id} onClick={() => setMe(m.id)}
              className={`inline-flex items-center gap-2 h-10 px-3 rounded-lg border text-[14px] transition-colors ${
                db.meId === m.id ? 'border-accent text-accent bg-accentSoft' : 'border-line text-muted hover:bg-surface2'}`}>
              <Avatar member={m} size={20} />{m.name}
            </button>
          ))}
        </div>
        <p className="text-[12.5px] text-faint mt-2">
          Витрати, виконані задачі й куплене записуються на того, хто вибраний тут.
        </p>
      </div>

      <SectionTitle>Що налаштувати</SectionTitle>
      <ul className="border-y border-line divide-y divide-line bg-surface">
        {SECTIONS.map(s => (
          <li key={s.to}>
            <Link to={s.to} className="flex items-center gap-3 px-4 sm:px-6 py-3 hover:bg-surface2/60 transition-colors">
              <div className="flex-1 min-w-0">
                <div className="text-[14px]">{s.label}</div>
                <div className="text-[12.5px] text-faint">{s.hint}</div>
              </div>
              <span className="text-faint shrink-0">{Icon.chev(16)}</span>
            </Link>
          </li>
        ))}
      </ul>

      <SectionTitle>Ще</SectionTitle>
      <ul className="border-y border-line divide-y divide-line bg-surface">
        <li>
          <Link to="/history" className="flex items-center gap-3 px-4 sm:px-6 py-3 hover:bg-surface2/60 transition-colors">
            <span className="text-faint shrink-0">{Icon.clock(18)}</span>
            <span className="flex-1 text-[14px]">Історія витрат</span>
            <span className="text-faint shrink-0">{Icon.chev(16)}</span>
          </Link>
        </li>
        <li>
          <Link to="/debts" className="flex items-center gap-3 px-4 sm:px-6 py-3 hover:bg-surface2/60 transition-colors">
            <span className="text-faint shrink-0">{Icon.list(18)}</span>
            <span className="flex-1 text-[14px]">Борги</span>
            <span className="text-faint shrink-0">{Icon.chev(16)}</span>
          </Link>
        </li>
      </ul>
    </div>
  )
}
