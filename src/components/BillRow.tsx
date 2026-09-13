import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Btn, Icon, IconButton, LinkChip, Sheet, toast } from '../ui'
import {
  useDB, confirmOccurrence, skipOccurrence, unconfirmOccurrence, isIncomeOccurrence,
} from '../data/store'
import { projectRoute, ruleRoute, ruleText } from '../data/links'
import { money, parseAmount } from '../lib/money'
import { relativeDue, shortDate, today } from '../lib/dates'
import type { DB, Occurrence } from '../data/types'

/** «Оплачено» чи «Отримано» — залежить від конверта, а не від знаку суми. */
export function doneLabel(db: DB, o: Occurrence) {
  return isIncomeOccurrence(db, o) ? 'Отримано' : 'Оплачено'
}

/**
 * Підтвердити платіж і показати тост зі скасуванням. Один шлях на весь
 * застосунок: оптимістично й без діалогу «ви впевнені?» — помилка
 * виправляється кнопкою в тості, а не підтвердженням наперед.
 *
 * `false` — суми немає (очікувана 0, іншу не передали): store нічого не
 * записав, і викликач має спитати суму.
 */
export function payBill(db: DB, o: Occurrence, amountMinor?: number): boolean {
  if (!confirmOccurrence(o.id, amountMinor)) return false
  toast(`${doneLabel(db, o)}: ${o.name}`, {
    action: { label: 'Скасувати', run: () => unconfirmOccurrence(o.id) },
  })
  return true
}

/** Введення фактичної суми. Окремо від листа — щоб лист платежу в «Задачах» міг вбудувати його в себе. */
export function AmountForm({ o, onDone }: { o: Occurrence; onDone: () => void }) {
  const db = useDB()
  const [raw, setRaw] = useState(o.expectedMinor ? String(o.expectedMinor / 100).replace('.', ',') : '')
  const amount = parseAmount(raw)
  const submit = () => { if (amount && payBill(db, o, amount)) onDone() }

  return (
    <div>
      <div className="text-center py-4">
        <input autoFocus value={raw} onChange={e => setRaw(e.target.value)} inputMode="decimal"
          onKeyDown={e => { if (e.key === 'Enter') submit() }}
          aria-label="Фактична сума" placeholder="0"
          className="w-full text-center text-[32px] font-semibold num bg-transparent outline-none placeholder:text-faint" />
        <div className="text-[12.5px] text-faint mt-1">
          {o.expectedMinor ? `очікували ${money(o.expectedMinor, o.currency)}` : 'сума не задана в правилі'}
        </div>
      </div>
      <Btn variant="primary" full disabled={!amount} onClick={submit}>
        Записати як {doneLabel(db, o).toLowerCase()}
      </Btn>
    </div>
  )
}

/**
 * Рядок платежу — один на весь застосунок («Платежі», «Сьогодні», «Задачі»).
 *
 * Головна дія одна — квадрат ліворуч: тап і платіж оплачено, повторний тап
 * по оплаченому скасовує. «Інша сума» й «Пропустити» потрібні рідко, тож
 * живуть за «⋯»: три кнопки під кожним платежем робили зі списку стіну.
 *
 * `compact` — без чіпів звʼязків і з відносною датою («через 3 дн.»): для
 * списків, де платіж лише один із рядків. `onOpen` робить назву кнопкою.
 */
export function BillRow({ o, compact = false, onOpen }: {
  o: Occurrence
  compact?: boolean
  onOpen?: () => void
}) {
  const db = useDB()
  const nav = useNavigate()
  const [more, setMore] = useState(false)
  const [editing, setEditing] = useState(false)
  const assignee = db.members.find(m => m.id === o.assigneeId)
  const plan = o.planId ? db.recurringPlans.find(p => p.id === o.planId) : undefined
  const project = db.projects.find(p => p.id === o.projectId)
  const paid = o.status === 'paid'
  const settled = paid || o.status === 'skipped'
  const overdue = !settled && o.dueDate < today()
  const label = doneLabel(db, o)
  const due = relativeDue(o.dueDate)

  const pay = () => { if (!payBill(db, o)) setEditing(true) }

  const nameCls = `text-[14px] truncate ${settled ? 'text-faint line-through' : ''}`

  return (
    <li className="px-4 sm:px-6 py-2.5">
      <div className="flex items-start gap-3">
        {settled ? (
          <button onClick={() => unconfirmOccurrence(o.id)}
            aria-label={`Повернути в неоплачені: ${o.name}`} title="Повернути в неоплачені"
            className={`mt-0.5 shrink-0 h-5 w-5 rounded-[6px] border grid place-items-center transition-colors ${
              paid ? 'bg-accent border-accent text-white' : 'border-line2 text-faint'}`}>
            {paid ? Icon.check(13) : '—'}
          </button>
        ) : (
          <button onClick={pay}
            aria-label={`${label}: ${o.name}`} title={label}
            className="mt-0.5 shrink-0 h-5 w-5 rounded-[6px] border border-line2 hover:border-accent hover:bg-accentSoft transition-colors" />
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-3">
            {onOpen
              ? <button type="button" onClick={onOpen} className={`flex-1 min-w-0 text-left ${nameCls}`}>{o.name}</button>
              : <span className={`flex-1 min-w-0 ${nameCls}`}>{o.name}</span>}
            <span className={`shrink-0 text-[14px] num ${settled ? 'text-faint' : 'text-muted'}`}>
              {money(paid ? o.actualMinor ?? o.expectedMinor : o.expectedMinor, o.currency)}
            </span>
          </div>
          <div className="text-[12px] text-faint num">
            {compact && !settled
              // прострочення бурштинове, не червоне — CLAUDE.md, правила інтерфейсу
              ? <span className={overdue || due.tone === 'today' ? 'text-warn' : ''}>{due.label}</span>
              : <>
                  {shortDate(settled ? o.paidOn ?? o.dueDate : o.dueDate)}
                  {overdue && <span className="text-warn"> · прострочено</span>}
                </>}
            {paid && <span> · {label.toLowerCase()}</span>}
            {o.status === 'skipped' && <span> · пропущено</span>}
            {assignee && !settled && <span> · {assignee.name}</span>}
          </div>

          {!compact && !settled && (project || plan) && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {/* звідки цей платіж узявся і до якого проєкту належить — одним тапом */}
              {plan && <LinkChip icon="clock" onClick={() => nav(ruleRoute(plan))}>{ruleText(plan)}</LinkChip>}
              {project && !project.isFree && (
                <LinkChip icon={project.direction === 'save' ? 'piggy' : project.direction === 'repay' ? 'list' : 'wallet'}
                  tone={project.direction === 'save' || project.direction === 'repay' ? 'accent' : 'neutral'}
                  onClick={() => nav(projectRoute(project.id))}>
                  {project.name}
                </LinkChip>
              )}
            </div>
          )}

          {more && !settled && (
            <div className="flex gap-1.5 mt-2">
              <Btn onClick={() => { setEditing(true); setMore(false) }}>Інша сума</Btn>
              <Btn variant="quiet" onClick={() => { skipOccurrence(o.id); setMore(false) }}>Пропустити</Btn>
            </div>
          )}
        </div>

        {!settled && (
          <span className="shrink-0 -mt-1 -mr-2">
            <IconButton label={`Ще дії: ${o.name}`} onClick={() => setMore(v => !v)}>{Icon.more(16)}</IconButton>
          </span>
        )}
      </div>

      <Sheet open={editing} onClose={() => setEditing(false)} title={o.name}>
        {editing && <AmountForm o={o} onDone={() => setEditing(false)} />}
      </Sheet>
    </li>
  )
}
