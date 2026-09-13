import { Link } from 'react-router-dom'
import { Avatar, Icon, Rows, SectionTitle } from '../ui'
import { useDB, setMe } from '../data/store'
import { AccountCard } from '../components/AccountCard'

/**
 * «Ще» — це хаб навігації, а не місце, де налаштовують сутності.
 * Конверти редагуються в «Місяці», фонди на «Фондах», борги на «Боргах»,
 * шаблони на «Задачах». Тут лише те, що не має свого екрана,
 * і вхід до розділів, яких немає в таб-барі.
 */
const SCREENS = [
  { to: '/envelopes', label: 'Конверти', hint: 'Скільки на що цього місяця', icon: Icon.wallet },
  { to: '/bills',     label: 'Платежі',  hint: 'Чекліст місяця і регулярні правила', icon: Icon.clock },
  { to: '/funds',   label: 'Фонди',   hint: 'Цілі й скільки відкладати щомісяця',   icon: Icon.piggy },
  { to: '/debts',   label: 'Борги',   hint: 'Залишок, платежі, дата закриття',      icon: Icon.list },
  { to: '/history', label: 'Історія', hint: 'Усі записи, з правкою і видаленням',   icon: Icon.clock },
]

export default function Settings() {
  const db = useDB()

  return (
    <div className="max-w-[760px] mx-auto">
      <AccountCard />

      <SectionTitle>Зараз записує</SectionTitle>
      <div className="px-4 sm:px-6">
        <div className="flex gap-1.5">
          {db.members.map(m => (
            <button key={m.id} onClick={() => setMe(m.id)}
              aria-pressed={db.meId === m.id}
              className={`inline-flex items-center gap-2 h-10 px-3 rounded-lg border text-[14px] transition-colors ${
                db.meId === m.id ? 'border-accent text-accent bg-accentSoft' : 'border-line text-muted hover:bg-surface2'}`}>
              <Avatar member={m} size={20} />{m.name}
            </button>
          ))}
        </div>
        <p className="text-[12.5px] text-faint mt-2 leading-snug">
          Витрати, виконані задачі й куплене записуються на вибраного. Той самий
          перемикач є у верхній панелі.
        </p>
      </div>

      <SectionTitle>Розділи</SectionTitle>
      <Rows>
        {SCREENS.map(s => (
          <li key={s.to}>
            <Link to={s.to} className="flex items-center gap-3 px-4 sm:px-6 py-3 hover:bg-surface2/60 transition-colors">
              <span className="text-faint shrink-0">{s.icon(18)}</span>
              <div className="flex-1 min-w-0">
                <div className="text-[14px]">{s.label}</div>
                <div className="text-[12.5px] text-faint">{s.hint}</div>
              </div>
              <span className="text-faint shrink-0">{Icon.chev(16)}</span>
            </Link>
          </li>
        ))}
      </Rows>

      <SectionTitle>Налаштування</SectionTitle>
      <Rows>
        <li>
          <Link to="/settings/family" className="flex items-center gap-3 px-4 sm:px-6 py-3 hover:bg-surface2/60 transition-colors">
            <span className="text-faint shrink-0">{Icon.gear(18)}</span>
            <div className="flex-1 min-w-0">
              <div className="text-[14px]">Сім'я і валюти</div>
              <div className="text-[12.5px] text-faint">Учасники, кольори, курси, скидання даних</div>
            </div>
            <span className="text-faint shrink-0">{Icon.chev(16)}</span>
          </Link>
        </li>
      </Rows>

      <p className="px-4 sm:px-6 mt-4 text-[12.5px] text-faint leading-snug">
        Конверти й регулярні платежі редагуються в «Місяці», фонди — на «Фондах»,
        борги — на «Боргах», повторювані побутові задачі — на «Задачах».
        Там, де їх видно.
      </p>
    </div>
  )
}
