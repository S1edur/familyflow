import { useState } from 'react'
import { Btn, Empty, Icon, Progress, Sheet, Tabs } from '../components/ui'
import {
  useDB, envelopeMonth, monthSummary, setPlanned, confirmOccurrence, skipOccurrence,
} from '../data/store'
import { money, parseAmount } from '../lib/money'
import { addMonths, monthKey, monthTitle, shortDate, thisMonth, today } from '../lib/dates'
import type { Occurrence } from '../data/types'

export default function Month() {
  const db = useDB()
  const [month, setMonth] = useState(thisMonth())
  const [tab, setTab] = useState<'plan' | 'bills'>('plan')
  const rows = envelopeMonth(db, month)
  const sum = monthSummary(db, month)

  const bills = db.occurrences
    .filter(o => monthKey(o.dueDate) === month)
    .sort((a, b) => {
      const rank = (s: string) => (s === 'paid' || s === 'skipped' ? 1 : 0)
      return rank(a.status) - rank(b.status) || a.dueDate.localeCompare(b.dueDate)
    })
  const left = bills.filter(b => b.status === 'due' || b.status === 'projected').length

  return (
    <div className="max-w-[860px] mx-auto">
      <header className="px-4 pt-5 pb-3 sm:px-6">
        <div className="flex items-center gap-1 mb-3">
          <button onClick={() => setMonth(m => addMonths(m, -1))}
            className="h-8 w-8 grid place-items-center rounded-lg text-muted hover:bg-surface2 rotate-180">{Icon.chev(16)}</button>
          <h1 className="text-[22px] font-semibold tracking-tight min-w-[140px] text-center">{monthTitle(month)}</h1>
          <button onClick={() => setMonth(m => addMonths(m, 1))}
            className="h-8 w-8 grid place-items-center rounded-lg text-muted hover:bg-surface2">{Icon.chev(16)}</button>
          {month !== thisMonth() && (
            <button onClick={() => setMonth(thisMonth())} className="ml-2 text-[12.5px] text-accent">цей місяць</button>
          )}
        </div>

        <div className="rounded-xl border border-line bg-surface p-4">
          <div className="text-[12px] uppercase tracking-wider text-faint">Вільно до кінця місяця</div>
          <div className={`text-[30px] font-semibold num tracking-tight ${sum.free < 0 ? 'text-warn' : ''}`}>
            {money(sum.free)}
          </div>
          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2 mt-3 pt-3 border-t border-line text-[13px]">
            <Stat label="Дохід" value={money(sum.income)} />
            <Stat label="Ще платити" value={money(sum.obligationsLeft)} />
            <Stat label="У фонди" value={money(sum.fundsRequired)} />
            <Stat label="Витрачено" value={money(sum.spentVariable)} />
          </dl>
        </div>
      </header>

      <div className="px-4 sm:px-6">
        <Tabs value={tab} onChange={setTab} items={[
          { value: 'plan', label: 'План' },
          { value: 'bills', label: 'Платежі', badge: left },
        ]} />
      </div>

      {tab === 'plan' ? (
        <ul className="mt-3 border-y border-line divide-y divide-line bg-surface">
          {rows.map(r => (
            <li key={r.envelope.id} className="px-4 sm:px-6 py-2.5">
              <div className="flex items-center gap-3">
                <span className="flex-1 text-[14px] truncate">{r.envelope.name}</span>
                <span className="text-[13px] num text-muted">{money(r.actual)}</span>
                <span className="text-faint text-[13px]">/</span>
                <PlanInput value={r.planned} onCommit={v => setPlanned(r.envelope.id, month, v)} />
              </div>
              <div className="mt-1.5">
                <Progress value={r.planned ? r.actual / r.planned : 0}
                  tone={r.planned && r.actual > r.planned ? 'warn' : 'accent'} height={4} />
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="mt-3 border-y border-line divide-y divide-line bg-surface">
          {bills.map(b => <BillRow key={b.id} o={b} />)}
          {!bills.length && <Empty>Платежів цього місяця немає</Empty>}
        </ul>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11.5px] text-faint">{label}</dt>
      <dd className="num">{value}</dd>
    </div>
  )
}

function PlanInput({ value, onCommit }: { value: number; onCommit: (v: number) => void }) {
  const [raw, setRaw] = useState<string | null>(null)
  const shown = raw ?? (value ? String(value / 100) : '')
  return (
    <input
      value={shown}
      onChange={e => setRaw(e.target.value)}
      onFocus={e => e.currentTarget.select()}
      onBlur={() => { if (raw !== null) { onCommit(parseAmount(raw) ?? 0); setRaw(null) } }}
      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
      inputMode="decimal" placeholder="—"
      className="w-[92px] h-8 px-2 text-right text-[13px] num rounded-md border border-transparent hover:border-line focus:border-accent bg-transparent outline-none"
    />
  )
}

function BillRow({ o }: { o: Occurrence }) {
  const db = useDB()
  const [editing, setEditing] = useState(false)
  const [raw, setRaw] = useState('')
  const assignee = db.members.find(m => m.id === o.assigneeId)
  const settled = o.status === 'paid' || o.status === 'skipped'
  const overdue = o.status === 'due' && o.dueDate < today()

  return (
    <li className="px-4 sm:px-6 py-2.5">
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className={`text-[14px] truncate ${settled ? 'text-faint line-through' : ''}`}>{o.name}</div>
          <div className="text-[12px] text-faint num">
            {shortDate(o.dueDate)}
            {overdue && <span className="text-warn"> · прострочено</span>}
            {o.status === 'paid' && <span> · оплачено {money(o.actualMinor ?? 0)}</span>}
            {o.status === 'skipped' && <span> · пропущено</span>}
            {assignee && !settled && <span> · {assignee.name}</span>}
          </div>
        </div>
        {!settled && <span className="text-[14px] num text-muted shrink-0">{money(o.expectedMinor, o.currency)}</span>}
      </div>

      {!settled && (
        <div className="flex gap-1.5 mt-2">
          <Btn variant="primary" onClick={() => confirmOccurrence(o.id)}>Оплачено</Btn>
          <Btn onClick={() => { setEditing(true); setRaw(String(o.expectedMinor / 100)) }}>Інша сума</Btn>
          <Btn variant="quiet" onClick={() => skipOccurrence(o.id)}>Пропустити</Btn>
        </div>
      )}

      <Sheet open={editing} onClose={() => setEditing(false)} title={o.name}>
        <div className="text-center py-4">
          <input autoFocus value={raw} onChange={e => setRaw(e.target.value)} inputMode="decimal"
            className="w-full text-center text-[32px] font-semibold num bg-transparent outline-none" />
          <div className="text-[12.5px] text-faint mt-1">очікували {money(o.expectedMinor, o.currency)}</div>
        </div>
        <Btn variant="primary" full disabled={!parseAmount(raw)}
          onClick={() => { const m = parseAmount(raw); if (m) { confirmOccurrence(o.id, m); setEditing(false) } }}>
          Записати як оплачене
        </Btn>
      </Sheet>
    </li>
  )
}
