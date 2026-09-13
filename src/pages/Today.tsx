import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Btn, Empty, Icon, PriorityMark, Rows } from '../ui'
import { useDB, monthSummary, completeTask, confirmOccurrence, upcomingOccurrences, fundBalance, debtStatus, shoppingPending, isIncomeOccurrence } from '../data/store'
import { hasIncome, setupSteps } from '../data/setup'
import { newRuleRoute } from '../data/links'
import { money, moneyShort } from '../lib/money'
import { longDate, relativeDue, thisMonth, today } from '../lib/dates'
import { readPinShopping, readSetupHidden, writeSetupHidden } from '../lib/prefs'
import type { Occurrence } from '../data/types'

export default function Today({ onQuickAdd }: { onQuickAdd: () => void }) {
  const db = useDB()
  const sum = monthSummary(db, thisMonth())
  const t = today()

  const mine = db.tasks
    .filter(x => x.status !== 'done' && x.status !== 'dropped'
      && (!x.deferUntil || x.deferUntil <= t)
      && (x.assigneeId === db.meId || !x.assigneeId)
      && (!x.dueDate || x.dueDate <= t))
    .sort((a, b) => (a.priority === 0 ? 9 : a.priority) - (b.priority === 0 ? 9 : b.priority))

  const all = upcomingOccurrences(db, 7)
  const overdue = all.filter(o => o.dueDate < t)
  const soon = all.filter(o => o.dueDate >= t)
  const cart = db.shoppingItems.filter(i => !i.checkedAt && !i.tripId).length
  // закріплення керується на екрані «Задачі»; тут лише поважаємо вибір
  const pending = shoppingPending(db)
  const shopRow = pending && readPinShopping() ? pending : null
  const fundsTotal = db.funds.reduce((s, f) => s + fundBalance(db, f.id), 0)
  const debtLeft = db.debts.filter(d => !d.closedOn).reduce((s, d) => s + debtStatus(db, d.id).remaining, 0)

  return (
    <div className="max-w-[760px] mx-auto">
      <header className="px-4 pt-3 pb-4 sm:px-6">
        <div className="text-[12.5px] text-faint">{longDate(t)}</div>
      </header>

      <SetupCard />

      <section className="px-4 sm:px-6">
        {hasIncome(db) ? (
          <Link to="/envelopes" className="block rounded-xl border border-line bg-surface p-4 hover:border-line2 transition-colors">
            <div className="text-[12px] uppercase tracking-wider text-faint">Вільно цього місяця</div>
            <div className={`text-[30px] font-semibold num tracking-tight ${sum.free < 0 ? 'text-warn' : ''}`}>{money(sum.free)}</div>
            <div className="text-[12.5px] text-faint mt-1 num">
              ще платити {money(sum.obligationsLeft)} · у фонди {money(sum.fundsRequired)}
            </div>
          </Link>
        ) : (
          // Без доходу «вільно 0 ₴» — не число, а шум: воно нічого не каже
          // і виглядає як «грошей немає». Замість нього — що зробити.
          <Link to={newRuleRoute({ envelopeId: db.envelopes.find(e => e.kind === 'income')?.id })}
            className="block rounded-xl border border-dashed border-line2 bg-surface p-4 hover:border-accent transition-colors">
            <div className="text-[12px] uppercase tracking-wider text-faint">Вільно цього місяця</div>
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
            {overdue.map(o => <BillRow key={o.id} o={o} />)}
          </Rows>
        </section>
      )}

      <section className="mt-6">
        <div className="px-4 sm:px-6 mb-1 flex items-baseline justify-between">
          <h2 className="text-[12px] uppercase tracking-wider text-faint font-medium">Найближчі сім днів</h2>
          <Link to="/bills" className="text-[12.5px] text-accent">платежі</Link>
        </div>
        {soon.length ? (
          <Rows>
            {soon.map(o => <BillRow key={o.id} o={o} />)}
          </Rows>
        ) : <Empty>Найближчим тижнем платежів немає</Empty>}
      </section>

      <section className="px-4 sm:px-6 mt-6 grid grid-cols-3 gap-2">
        <Tile to="/funds" label="У фондах" value={moneyShort(fundsTotal)} />
        <Tile to="/debts" label="Борг" value={moneyShort(debtLeft)} />
        <Tile to="/shopping" label="У списку" value={String(cart)} />
      </section>

      <div className="px-4 sm:px-6 mt-6 hidden sm:block">
        <Btn onClick={onQuickAdd}>{Icon.plus(16)} Записати витрату</Btn>
      </div>
    </div>
  )
}


function Tile({ to, label, value }: { to: string; label: string; value: string }) {
  return (
    <Link to={to} className="rounded-xl border border-line bg-surface px-3 py-2.5 min-h-[62px] flex flex-col justify-between hover:border-line2 transition-colors">
      <div className="text-[11px] text-faint leading-tight">{label}</div>
      <div className="text-[14.5px] font-medium num leading-tight">{value}</div>
    </Link>
  )
}

/** Той самий рядок, що в «Платежах»: квадрат ліворуч — одна дія, один тап. */
function BillRow({ o }: { o: Occurrence }) {
  const db = useDB()
  const who = db.members.find(m => m.id === o.assigneeId)
  const due = relativeDue(o.dueDate)
  const label = isIncomeOccurrence(db, o) ? 'Отримано' : 'Оплачено'
  return (
    <li className="flex items-center gap-2.5 px-4 sm:px-6 py-2.5">
      <button onClick={() => confirmOccurrence(o.id)} aria-label={`${label}: ${o.name}`} title={label}
        className="shrink-0 h-[18px] w-[18px] rounded-[5px] border border-line2 hover:border-accent hover:bg-accentSoft transition-colors" />
      <div className="flex-1 min-w-0">
        <div className="text-[14px] truncate">{o.name}</div>
        <div className={`text-[12px] num ${due.tone === 'over' ? 'text-warn' : 'text-faint'}`}>
          {due.label}{who && <span className="text-faint"> · {who.name}</span>}
        </div>
      </div>
      <span className="text-[14px] num text-muted shrink-0">{money(o.expectedMinor, o.currency)}</span>
    </li>
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
