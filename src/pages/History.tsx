import { useMemo, useState } from 'react'
import {
  Avatar, Badge, Btn, ConfirmButton, DateInput, Empty, Field, FormActions,
  Icon, Input, MoneyInput, Segmented, Select, Sheet, Stat, Tabs,
} from '../ui'
import { useDB, updateEntry, removeEntry } from '../data/store'
import { money, SYMBOL } from '../lib/money'
import { addMonths, longDate, monthKey, monthTitle, thisMonth } from '../lib/dates'
import type { Currency, DB, Entry, EntryKind } from '../data/types'

type KindFilter = 'all' | EntryKind

const KIND_LABEL: Record<EntryKind, string> = {
  expense: 'Витрата',
  income: 'Дохід',
  fund_in: 'У фонд',
  fund_out: 'З фонду',
  debt_payment: 'Борг',
}

/** Дохід і внесок у фонд — гроші, що прийшли або відкладені: акцент. Решта — нейтрально. */
const KIND_TONE: Record<EntryKind, 'neutral' | 'accent'> = {
  expense: 'neutral', income: 'accent', fund_in: 'accent', fund_out: 'neutral', debt_payment: 'neutral',
}

const PLUS: EntryKind[] = ['income', 'fund_in']

/** Куди належить запис: конверт, фонд або борг. */
function targetName(db: DB, e: Entry): string | undefined {
  if (e.envelopeId) return db.envelopes.find(x => x.id === e.envelopeId)?.name
  if (e.fundId) return db.funds.find(x => x.id === e.fundId)?.name
  if (e.debtId) return db.debts.find(x => x.id === e.debtId)?.name
  return undefined
}

export default function History() {
  const db = useDB()
  const [month, setMonth] = useState(thisMonth())
  const [kind, setKind] = useState<KindFilter>('all')
  const [envelopeId, setEnvelopeId] = useState('')
  const [editId, setEditId] = useState<string | null>(null)

  const envelopes = db.envelopes.filter(e => !e.archived).sort((a, b) => a.sortOrder - b.sortOrder)

  // найновіші вгорі; у межах дня — новіші записи першими
  const inMonth = useMemo(() => {
    return db.entries
      .map((e, i) => ({ e, i }))
      .filter(x => monthKey(x.e.occurredOn) === month)
      .sort((a, b) => b.e.occurredOn.localeCompare(a.e.occurredOn) || b.i - a.i)
      .map(x => x.e)
  }, [db.entries, month])

  const shown = inMonth.filter(e =>
    (kind === 'all' || e.kind === kind) &&
    (!envelopeId || e.envelopeId === envelopeId))

  const spent = shown.filter(e => !PLUS.includes(e.kind)).reduce((s, e) => s + e.amountBaseMinor, 0)
  const got = shown.filter(e => PLUS.includes(e.kind)).reduce((s, e) => s + e.amountBaseMinor, 0)

  // згрупувати за днями, порядок уже правильний
  const days: { date: string; items: Entry[] }[] = []
  for (const e of shown) {
    const last = days[days.length - 1]
    if (last && last.date === e.occurredOn) last.items.push(e)
    else days.push({ date: e.occurredOn, items: [e] })
  }

  const counts = (k: EntryKind) => inMonth.filter(e => e.kind === k).length
  const filtered = kind !== 'all' || !!envelopeId
  const lastMonthWithEntries = db.entries.length
    ? db.entries.map(e => monthKey(e.occurredOn)).sort().at(-1)!
    : undefined

  const editing = editId ? db.entries.find(e => e.id === editId) : undefined

  return (
    <div className="max-w-[760px] mx-auto">
      <header className="px-4 pt-5 pb-3 sm:px-6">
        <div className="flex items-center gap-1 mb-3">
          <button onClick={() => setMonth(m => addMonths(m, -1))} aria-label="Попередній місяць"
            className="h-8 w-8 grid place-items-center rounded-lg text-muted hover:bg-surface2 rotate-180">{Icon.chev(16)}</button>
          <h1 className="text-[22px] font-semibold tracking-tight min-w-[140px] text-center">{monthTitle(month)}</h1>
          <button onClick={() => setMonth(m => addMonths(m, 1))} aria-label="Наступний місяць"
            className="h-8 w-8 grid place-items-center rounded-lg text-muted hover:bg-surface2">{Icon.chev(16)}</button>
          {month !== thisMonth() && (
            <button onClick={() => setMonth(thisMonth())} className="ml-2 text-[12.5px] text-accent">цей місяць</button>
          )}
        </div>

        <div className="rounded-xl border border-line bg-surface p-4">
          <div className="text-[12px] uppercase tracking-wider text-faint">
            {filtered ? 'За вибраним фільтром' : 'За місяць'}
          </div>
          <dl className="grid grid-cols-3 gap-x-4 gap-y-2 mt-2 text-[13px]">
            <Stat label="Витрачено" value={money(spent)} />
            <Stat label="Надійшло і відкладено" value={money(got)} />
            <Stat label="Записів" value={shown.length} tone="muted" />
          </dl>
        </div>
      </header>

      <div className="px-4 sm:px-6">
        <Tabs value={kind} onChange={setKind} items={[
          { value: 'all', label: 'Усі', badge: inMonth.length },
          { value: 'expense', label: 'Витрати', badge: counts('expense') },
          { value: 'income', label: 'Доходи', badge: counts('income') },
          { value: 'fund_in', label: 'У фонди', badge: counts('fund_in') },
          { value: 'fund_out', label: 'З фондів', badge: counts('fund_out') },
          { value: 'debt_payment', label: 'Борги', badge: counts('debt_payment') },
        ]} />
        <div className="mt-2 flex items-center gap-2">
          <div className="flex-1">
            <Select value={envelopeId} onChange={setEnvelopeId} placeholder="Усі конверти"
              options={envelopes.map(e => ({ value: e.id, label: e.name }))} />
          </div>
          {filtered && (
            <Btn variant="quiet" onClick={() => { setKind('all'); setEnvelopeId('') }}>Скинути</Btn>
          )}
        </div>
      </div>

      {days.length === 0 ? (
        <Empty>
          <p className="max-w-[420px] mx-auto">
            {filtered
              ? 'За цим фільтром записів немає. Тут показуються витрати, доходи, внески у фонди й платежі по боргах.'
              : 'Тут з’являється кожен запис — витрати, доходи, внески у фонди й платежі по боргах. Будь-який можна виправити або видалити.'}
          </p>
          <div className="mt-3">
            {filtered
              ? <Btn onClick={() => { setKind('all'); setEnvelopeId('') }}>Показати всі записи</Btn>
              : lastMonthWithEntries && lastMonthWithEntries !== month
                ? <Btn onClick={() => setMonth(lastMonthWithEntries)}>
                    Перейти до {monthTitle(lastMonthWithEntries).toLowerCase()}
                  </Btn>
                : null}
          </div>
        </Empty>
      ) : (
        <div className="mt-3">
          {days.map(d => (
            <section key={d.date}>
              <h2 className="px-4 sm:px-6 pt-4 pb-1 text-[12px] uppercase tracking-wider text-faint font-medium">
                {longDate(d.date)}
              </h2>
              <ul className="border-y border-line divide-y divide-line bg-surface">
                {d.items.map(e => (
                  <EntryRow key={e.id} db={db} entry={e} onOpen={() => setEditId(e.id)} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      <Sheet open={!!editing} onClose={() => setEditId(null)} title="Запис">
        {editing && <EditEntry key={editing.id} db={db} entry={editing} onClose={() => setEditId(null)} />}
      </Sheet>
    </div>
  )
}

function EntryRow({ db, entry, onOpen }: { db: DB; entry: Entry; onOpen: () => void }) {
  const who = db.members.find(m => m.id === entry.createdBy)
  const target = targetName(db, entry)
  const foreign = entry.currency !== 'UAH'
  const plus = PLUS.includes(entry.kind)

  return (
    <li>
      <button onClick={onOpen}
        className="w-full text-left px-4 sm:px-6 py-2.5 hover:bg-surface2 transition-colors">
        <div className="flex items-baseline gap-2.5">
          <span className="flex-1 min-w-0 text-[14px] truncate">
            {entry.note || target || KIND_LABEL[entry.kind]}
          </span>
          <span className={`text-[14px] num shrink-0 ${plus ? 'text-accentInk' : ''}`}>
            {money(entry.amountMinor, entry.currency, plus ? { sign: true } : {})}
          </span>
        </div>
        <div className="flex items-center gap-1.5 mt-1 text-[12px] text-faint">
          <Badge tone={KIND_TONE[entry.kind]}>{KIND_LABEL[entry.kind]}</Badge>
          {target && <span className="truncate">{target}</span>}
          {entry.occurrenceId && <Badge>платіж</Badge>}
          {entry.tripId && <Badge>покупки</Badge>}
          {foreign && (
            <span className="num shrink-0">
              курс {entry.rateToBase} → {money(entry.amountBaseMinor)}
            </span>
          )}
          <span className="flex-1" />
          <Avatar member={who} size={18} />
        </div>
      </button>
    </li>
  )
}

function EditEntry({ db, entry, onClose }: { db: DB; entry: Entry; onClose: () => void }) {
  const [amountMinor, setAmountMinor] = useState(entry.amountMinor)
  const [currency, setCurrency] = useState<Currency>(entry.currency)
  const [envelopeId, setEnvelopeId] = useState(entry.envelopeId ?? '')
  const [note, setNote] = useState(entry.note ?? '')
  const [occurredOn, setOccurredOn] = useState<string | undefined>(entry.occurredOn)

  const target = targetName(db, entry)
  const occurrence = entry.occurrenceId ? db.occurrences.find(o => o.id === entry.occurrenceId) : undefined
  // конверт редагуємо лише там, де він є: запис фонду чи боргу належить фонду або боргу
  // архівний конверт лишається у списку, поки на нього дивиться цей запис,
  // інакше нативний select мовчки перекинув би запис на перший варіант
  const envelopes = db.envelopes
    .filter(e => (!e.archived || e.id === entry.envelopeId)
      && (entry.kind === 'income' ? e.kind === 'income' : e.kind !== 'income'))
    .sort((a, b) => a.sortOrder - b.sortOrder)
  const changesRate = amountMinor !== entry.amountMinor || currency !== entry.currency

  const save = () => {
    if (!amountMinor) return
    updateEntry(entry.id, {
      amountMinor,
      currency,
      ...(entry.envelopeId && envelopeId ? { envelopeId } : {}),
      note: note.trim(),
      ...(occurredOn ? { occurredOn } : {}),
    })
    onClose()
  }

  return (
    <div>
      <div className="flex items-center gap-1.5 mb-3">
        <Badge tone={KIND_TONE[entry.kind]}>{KIND_LABEL[entry.kind]}</Badge>
        {target && !entry.envelopeId && <span className="text-[12.5px] text-muted">{target}</span>}
        {entry.tripId && <Badge>покупки</Badge>}
      </div>

      <Field label="Сума" htmlFor="e-amount">
        <MoneyInput id="e-amount" valueMinor={amountMinor} onChange={setAmountMinor} currency={currency} size="lg" />
      </Field>

      <Field label="Валюта"
        hint={entry.currency !== 'UAH'
          ? `Курс ${entry.rateToBase} зафіксовано в момент запису — ${money(entry.amountMinor, entry.currency)} це ${money(entry.amountBaseMinor)}. Історія не перераховується за сьогоднішнім курсом.`
          : undefined}>
        <Segmented value={currency} onChange={setCurrency} label="Валюта" items={
          (['UAH', 'USD', 'EUR'] as Currency[]).map(c => ({ value: c, label: `${c} ${SYMBOL[c]}` }))
        } />
      </Field>

      {changesRate && currency !== 'UAH' && (
        <div className="text-[12px] text-warn -mt-1 mb-3">
          Сума або валюта змінилась — курс перезаморозиться за сьогоднішнім ({db.rates[currency]}):
          {' '}<span className="num">{money(Math.round(amountMinor * db.rates[currency]))}</span>.
        </div>
      )}

      {entry.envelopeId && (
        <Field label="Конверт" htmlFor="e-env">
          <Select id="e-env" value={envelopeId} onChange={setEnvelopeId}
            options={envelopes.map(e => ({ value: e.id, label: e.name }))} />
        </Field>
      )}

      <Field label="Нотатка" htmlFor="e-note">
        <Input id="e-note" value={note} onChange={setNote} placeholder="Необов’язково" onEnter={save} />
      </Field>

      <Field label="Дата" htmlFor="e-date">
        <DateInput id="e-date" value={occurredOn} onChange={setOccurredOn} />
      </Field>

      {occurrence && (
        <div className="rounded-lg border border-line bg-warnSoft p-3 text-[12.5px] text-warn">
          Цей запис підтверджує платіж «{occurrence.name}».
          Видалення поверне платіж у стан «до оплати» і прибере пов’язане списання з фонду. Це навмисно.
        </div>
      )}

      <FormActions
        onSubmit={save}
        onCancel={onClose}
        disabled={!amountMinor}
        destructive={
          <ConfirmButton onConfirm={() => { removeEntry(entry.id); onClose() }}>
            Видалити
          </ConfirmButton>
        }
      />
    </div>
  )
}
