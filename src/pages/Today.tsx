import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Btn, Empty, Icon, PriorityMark, Progress, Rows } from '../ui'
import { BillRow } from '../components/BillRow'
import {
  useDB, monthView, completeTask, upcomingOccurrences, shoppingPending, projectStatus, freeProject,
} from '../data/store'
import { hasIncome, setupSteps } from '../data/setup'
import { projectRoute } from '../data/links'
import { money, moneyShort } from '../lib/money'
import { longDate, relativeDue, thisMonth, today } from '../lib/dates'
import { readPinShopping, readSetupHidden, writeSetupHidden } from '../lib/prefs'
import type { DB } from '../data/types'

export default function Today({ onQuickAdd }: { onQuickAdd: () => void }) {
  const db = useDB()
  const view = monthView(db, thisMonth())
  const t = today()

  const mine = db.tasks
    .filter(x => x.status !== 'done' && x.status !== 'dropped'
      && (!x.deferUntil || x.deferUntil <= t)
      && (x.assigneeId === db.meId || !x.assigneeId)
      && (!x.dueDate || x.dueDate <= t))
    .sort((a, b) => (a.priority === 0 ? 9 : a.priority) - (b.priority === 0 ? 9 : b.priority))

  // Чужий платіж тут — це повідомлення «у другого прострочено», якого
  // CLAUDE.md не дозволяє. Вільні (без виконавця) — спільні, їх показуємо.
  const all = upcomingOccurrences(db, 7).filter(o => !o.assigneeId || o.assigneeId === db.meId)
  const overdue = all.filter(o => o.dueDate < t)
  const soon = all.filter(o => o.dueDate >= t)
  const cart = db.shoppingItems.filter(i => !i.checkedAt && !i.tripId).length
  // закріплення керується на екрані «Задачі»; тут лише поважаємо вибір
  const pending = shoppingPending(db)
  const shopRow = pending && readPinShopping() ? pending : null
  const free = freeProject(db)
  // monthView зводить «відкласти» до гривні за сьогоднішнім курсом —
  // якщо серед внесків є валютні, сума приблизна (інваріант 3).
  const setAsideApprox = view.states.some(s => s.project.direction === 'save'
    && s.project.currency !== 'UAH' && s.toSetAside > 0) ? '≈ ' : ''
  const incomeStep = setupSteps(db).find(s => s.key === 'income')

  return (
    <div className="max-w-[760px] mx-auto">
      <header className="px-4 pt-3 pb-4 sm:px-6">
        <div className="text-[12.5px] text-faint">{longDate(t)}</div>
      </header>

      <SetupCard />

      <section className="px-4 sm:px-6">
        {hasIncome(db) ? (
          <Link to="/month" className="block rounded-xl border border-line bg-surface p-4 hover:border-line2 transition-colors">
            <div className="text-[12px] uppercase tracking-wider text-faint">Вільні зараз</div>
            <div className={`text-[30px] font-semibold num tracking-tight ${view.freeNow < 0 ? 'text-warn' : ''}`}>{money(view.freeNow)}</div>
            {view.forecast !== undefined && (
              <div className="text-[12.5px] text-faint mt-1 num">
                прогноз на кінець місяця{' '}
                <span className={view.forecast < 0 ? 'text-warn' : 'text-muted'}>{money(view.forecast)}</span>
              </div>
            )}
          </Link>
        ) : (
          // Без доходу «вільні 0 ₴» — не число, а шум: воно нічого не каже
          // і виглядає як «грошей немає». Замість нього — що зробити.
          <Link to={incomeStep?.to ?? '/projects'}
            className="block rounded-xl border border-dashed border-line2 bg-surface p-4 hover:border-accent transition-colors">
            <div className="text-[12px] uppercase tracking-wider text-faint">Вільні гроші</div>
            <div className="text-[14px] mt-1">Додайте дохід — і тут зʼявиться, скільки лишається після платежів.</div>
            <div className="text-[12.5px] text-accent mt-2">Додати зарплату</div>
          </Link>
        )}
      </section>

      <section className="mt-6">
        <div className="px-4 sm:px-6 mb-1 flex items-baseline justify-between">
          <h2 className="text-[12px] uppercase tracking-wider text-faint font-medium">Мої задачі</h2>
          <Link to="/tasks" className="text-[12.5px] text-accent">усі</Link>
        </div>
        {mine.length || shopRow ? (
          <Rows>
            {shopRow && (
              <li className="flex items-center gap-2.5 px-4 sm:px-6 h-11">
                <Link to="/shopping" aria-label="Відкрити покупки"
                  className="shrink-0 h-[18px] w-[18px] rounded-[5px] border border-line2 hover:border-accent" />
                <span className="shrink-0 text-faint">{Icon.cart(15)}</span>
                <Link to="/shopping" className="flex-1 min-w-0 text-[14px] truncate">Сходити в магазин</Link>
                {shopRow.allChecked
                  ? <span className="shrink-0 text-[12px] text-accent">є сума з чека?</span>
                  : <span className="shrink-0 text-[12.5px] text-faint num">{shopRow.count}</span>}
              </li>
            )}
            {mine.slice(0, 8).map(x => {
              const due = x.dueDate ? relativeDue(x.dueDate) : null
              return (
                <li key={x.id} className="flex items-center gap-2.5 px-4 sm:px-6 h-11">
                  <button onClick={() => completeTask(x.id)} aria-label="Виконано"
                    className="shrink-0 h-[18px] w-[18px] rounded-[5px] border border-line2 hover:border-accent" />
                  <PriorityMark p={x.priority} />
                  <span className="flex-1 text-[14px] truncate">{x.title}</span>
                  {!x.assigneeId && <span className="text-[11px] text-faint border border-dashed border-line2 rounded px-1.5">вільна</span>}
                  {/* прострочення бурштинове, не червоне — CLAUDE.md, правила інтерфейсу */}
                  {due && <span className={`text-[12px] num ${due.tone === 'over' ? 'text-warn font-medium' : due.tone === 'today' ? 'text-warn' : 'text-faint'}`}>{due.label}</span>}
                </li>
              )
            })}
          </Rows>
        ) : <Empty>На сьогодні нічого. Можна видихнути.</Empty>}
      </section>

      {overdue.length > 0 && (
        <section className="mt-6">
          <div className="px-4 sm:px-6 mb-1">
            <h2 className="text-[12px] uppercase tracking-wider text-warn font-medium">
              Прострочені <span className="num">{overdue.length}</span>
            </h2>
          </div>
          <Rows>
            {overdue.map(o => <BillRow key={o.id} o={o} compact />)}
          </Rows>
        </section>
      )}

      <section className="mt-6">
        <div className="px-4 sm:px-6 mb-1 flex items-baseline justify-between">
          <h2 className="text-[12px] uppercase tracking-wider text-faint font-medium">Найближчі сім днів</h2>
          <Link to="/month" className="text-[12.5px] text-accent">платежі</Link>
        </div>
        {soon.length ? (
          <Rows>
            {soon.map(o => <BillRow key={o.id} o={o} compact />)}
          </Rows>
        ) : <Empty>Найближчим тижнем платежів немає</Empty>}
      </section>

      <Goals db={db} />

      <section className="px-4 sm:px-6 mt-6 grid grid-cols-3 gap-2">
        <Tile to={free ? projectRoute(free.id) : '/projects'} label="Вільні" value={moneyShort(view.freeNow)} warn={view.freeNow < 0} />
        <Tile to="/month" label="Відкласти" value={setAsideApprox + moneyShort(view.toSetAside)} />
        <Tile to="/shopping" label="У списку" value={String(cart)} />
      </section>

      <div className="px-4 sm:px-6 mt-6 hidden sm:block">
        <Btn onClick={onQuickAdd}>{Icon.plus(16)} Записати витрату</Btn>
      </div>
    </div>
  )
}

/** «33 000 / 60 000 ₴» — символ валюти один раз, в кінці. */
function pair(a: number, b: number, c: DB['projects'][number]['currency']) {
  return `${money(a, c).replace(/\s*[₴$€]$/, '')} / ${money(b, c)}`
}

/**
 * Рух до цілей: накопичення й борги, закріплені першими. Лише чотири —
 * решта живе в «Проєктах»; тут це нагадування, а не список.
 */
function Goals({ db }: { db: DB }) {
  const nav = useNavigate()
  const goals = db.projects
    .filter(p => !p.isFree && p.status === 'active' && (p.direction === 'save' || p.direction === 'repay'))
    .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || a.sortOrder - b.sortOrder)
    .slice(0, 4)
    .map(p => projectStatus(db, p.id))
  if (!goals.length) return null

  return (
    <section className="mt-6">
      <div className="px-4 sm:px-6 mb-1 flex items-baseline justify-between">
        <h2 className="text-[12px] uppercase tracking-wider text-faint font-medium">Рух до цілей</h2>
        <Link to="/projects" className="text-[12.5px] text-accent">проєкти</Link>
      </div>
      <Rows>
        {goals.map(s => {
          const p = s.project
          const c = p.currency
          const save = p.direction === 'save'
          // для боргу «цього місяця ще» — те саме «треба», що й «відкласти» для накопичення
          const ask = save ? s.toSetAside : Math.max(0, s.required - s.monthActual)
          const figure = save
            ? (s.target ? pair(s.balance, s.target, c) : money(s.balance, c))
            : s.remaining !== undefined ? `лишилось ${money(s.remaining, c)}` : money(s.monthActual, c)
          return (
            <li key={p.id}>
              <button type="button" onClick={() => nav(projectRoute(p.id))}
                className="w-full text-left px-4 sm:px-6 py-2.5 hover:bg-surface2 transition-colors">
                <div className="flex items-baseline gap-3">
                  <span className="flex-1 min-w-0 text-[14px] truncate">{p.name}</span>
                  <span className="shrink-0 text-[13px] num text-muted">{figure}</span>
                </div>
                {(s.target ?? 0) > 0 && (
                  <div className="mt-1.5"><Progress value={s.progress} height={4} /></div>
                )}
                {ask > 0 && (
                  <div className="mt-1 text-[11.5px] text-faint num">
                    {save ? 'відкласти ще' : 'цього місяця ще'} {money(ask, c)}
                  </div>
                )}
              </button>
            </li>
          )
        })}
      </Rows>
    </section>
  )
}

function Tile({ to, label, value, warn }: { to: string; label: string; value: string; warn?: boolean }) {
  return (
    <Link to={to} className="rounded-xl border border-line bg-surface px-3 py-2.5 min-h-[62px] flex flex-col justify-between hover:border-line2 transition-colors">
      <div className="text-[11px] text-faint leading-tight">{label}</div>
      <div className={`text-[14.5px] font-medium num leading-tight ${warn ? 'text-warn' : ''}`}>{value}</div>
    </Link>
  )
}

/**
 * Перші кроки нового дому. Зникає сама, коли все зроблено, або назавжди —
 * хрестиком (це вибір перегляду конкретної людини, а не дані дому).
 */
function SetupCard() {
  const db = useDB()
  const [hidden, setHidden] = useState(readSetupHidden)
  const steps = setupSteps(db)
  const done = steps.filter(s => s.done).length
  if (hidden || done === steps.length) return null
  const next = steps.find(s => !s.done)

  return (
    <section className="px-4 sm:px-6 mb-4">
      <div className="rounded-xl border border-line bg-surface p-4">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="text-[15px] font-semibold">Налаштуймо дім</div>
            <div className="text-[12.5px] text-faint mt-0.5 num">
              {done} з {steps.length} · далі застосунок працюватиме сам
            </div>
          </div>
          <button onClick={() => { writeSetupHidden(true); setHidden(true) }}
            aria-label="Сховати перші кроки" title="Сховати"
            className="shrink-0 -mr-1 -mt-1 p-1 text-faint hover:text-ink">{Icon.x(16)}</button>
        </div>

        <div className="mt-3 h-1 rounded-full bg-surface2 overflow-hidden">
          <div className="h-full bg-accent transition-[width] duration-300" style={{ width: `${done / steps.length * 100}%` }} />
        </div>

        <ol className="mt-3 space-y-1">
          {steps.map(s => (
            <li key={s.key}>
              <Link to={s.to}
                className={`flex items-start gap-2.5 rounded-lg px-2 py-2 -mx-2 transition-colors ${
                  s.done ? '' : 'hover:bg-surface2'} ${s === next ? 'bg-surface2/60' : ''}`}>
                <span className={`mt-0.5 shrink-0 h-[18px] w-[18px] rounded-full border grid place-items-center ${
                  s.done ? 'bg-accent border-accent text-white' : 'border-line2'}`}>
                  {s.done && Icon.check(11)}
                </span>
                <span className="flex-1 min-w-0">
                  <span className={`block text-[14px] ${s.done ? 'text-faint line-through' : ''}`}>{s.title}</span>
                  {s === next && <span className="block text-[12.5px] text-muted leading-snug mt-0.5">{s.hint}</span>}
                </span>
                {!s.done && <span className="shrink-0 text-[12.5px] text-accent mt-0.5">{s.action}</span>}
              </Link>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}
