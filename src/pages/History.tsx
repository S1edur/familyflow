import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Avatar, Badge, Btn, ConfirmButton, DateInput, Empty, Field, FormActions,
  Icon, Input, LinkChip, MoneyInput, Segmented, Select, Sheet, Stat, Tabs, Rows,
} from '../ui'
import { useDB, updateEntry, removeEntry, freeProject } from '../data/store'
import { payableProjects } from '../components/RuleForm'
import { projectRoute } from '../data/links'
import { money, SYMBOL } from '../lib/money'
import { addMonths, longDate, monthKey, monthTitle, thisMonth } from '../lib/dates'
import type { Currency, DB, Entry, EntryKind, ID } from '../data/types'

type KindFilter = 'all' | EntryKind

const KIND_LABEL: Record<EntryKind, string> = {
  income: 'Надходження',
  expense: 'Витрата',
  transfer: 'Переказ',
  repay: 'Погашення',
}

/** Надходження — гроші, що прийшли: акцент. Решта — нейтрально. */
const KIND_TONE: Record<EntryKind, 'neutral' | 'accent'> = {
  income: 'accent', expense: 'neutral', transfer: 'neutral', repay: 'neutral',
}

/** Справжні витрати родини. Переказ — перекладання між своїми кишенями, не витрата. */
const isSpend = (k: EntryKind) => k === 'expense' || k === 'repay'

const FREE_KEY = '__free__'
const FREE_NAME = 'Вільні гроші'

/** Порожній id і системний проєкт — одна й та сама кишеня «Вільні гроші». */
function projectKey(db: DB, id: ID | undefined): string {
  return !id || id === freeProject(db)?.id ? FREE_KEY : id
}

function projectName(db: DB, id: ID | undefined): string | undefined {
  if (projectKey(db, id) === FREE_KEY) return FREE_NAME
  return db.projects.find(p => p.id === id)?.name
}

/** Куди належить запис; для переказу — «звідки → куди». */
function targetName(db: DB, e: Entry): string | undefined {
  if (e.kind === 'transfer') {
    return `${projectName(db, e.fromProjectId) ?? '—'} → ${projectName(db, e.projectId) ?? '—'}`
  }
  return projectName(db, e.projectId)
}

/** Знак суми: + надходження, − витрата й погашення, переказ без знака. */
function amountText(e: Entry): string {
  const m = money(e.amountMinor, e.currency)
  if (e.kind === 'income') return money(e.amountMinor, e.currency, { sign: true })
  if (e.kind === 'transfer') return `⇄ ${m}`
  return `−${m}`
}

export default function History() {
  const db = useDB()
  const [month, setMonth] = useState(thisMonth())
  const [kind, setKind] = useState<KindFilter>('all')
  const [projectFilter, setProjectFilter] = useState('')
  const [editId, setEditId] = useState<string | null>(null)

  // «Вільні гроші» першими, далі активні й завершені; архівні у фільтрі лише шумлять
  const filterOptions = [
    { value: FREE_KEY, label: FREE_NAME },
    ...db.projects
      .filter(p => !p.isFree && p.status !== 'archived')
      .sort((a, b) => Number(a.status !== 'active') - Number(b.status !== 'active') || a.sortOrder - b.sortOrder)
      .map(p => ({ value: p.id, label: p.status === 'active' ? p.name : `${p.name} · завершений` })),
  ]

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
    (!projectFilter || projectKey(db, e.projectId) === projectFilter
      || (e.kind === 'transfer' && projectKey(db, e.fromProjectId) === projectFilter)))

  const spent = shown.filter(e => isSpend(e.kind)).reduce((s, e) => s + e.amountBaseMinor, 0)
  const got = shown.filter(e => e.kind === 'income').reduce((s, e) => s + e.amountBaseMinor, 0)

  // згрупувати за днями, порядок уже правильний
  const days: { date: string; items: Entry[] }[] = []
  for (const e of shown) {
    const last = days[days.length - 1]
    if (last && last.date === e.occurredOn) last.items.push(e)
    else days.push({ date: e.occurredOn, items: [e] })
  }

  const counts = (k: EntryKind) => inMonth.filter(e => e.kind === k).length
  const filtered = kind !== 'all' || !!projectFilter
  const lastMonthWithEntries = db.entries.length
    ? db.entries.map(e => monthKey(e.occurredOn)).sort().at(-1)!
    : undefined

  const editing = editId ? db.entries.find(e => e.id === editId) : undefined

  return (
    <div className="max-w-[760px] mx-auto">
      <header className="px-4 pt-3 pb-3 sm:px-6">
        <div className="flex items-center gap-1 mb-3">
          <button onClick={() => setMonth(m => addMonths(m, -1))} aria-label="Попередній місяць"
            className="h-8 w-8 grid place-items-center rounded-lg text-muted hover:bg-surface2 rotate-180">{Icon.chev(16)}</button>
          {/* не h1: назву екрана несе топ-бар, це перемикач місяця */}
          <div className="text-[22px] font-semibold tracking-tight min-w-[140px] text-center">{monthTitle(month)}</div>
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
            <Stat label="Надійшло" value={money(got)} />
            <Stat label="Записів" value={shown.length} tone="muted" />
          </dl>
        </div>
      </header>

      <div className="px-4 sm:px-6">
        <Tabs value={kind} onChange={setKind} items={[
          { value: 'all', label: 'Усі', badge: inMonth.length },
          { value: 'expense', label: 'Витрати', badge: counts('expense') },
          { value: 'income', label: 'Надходження', badge: counts('income') },
          { value: 'transfer', label: 'Перекази', badge: counts('transfer') },
          { value: 'repay', label: 'Погашення', badge: counts('repay') },
        ]} />
        <div className="mt-2 flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <Select value={projectFilter} onChange={setProjectFilter} placeholder="Усі проєкти"
              options={filterOptions} />
          </div>
          {filtered && (
            <Btn variant="quiet" onClick={() => { setKind('all'); setProjectFilter('') }}>Скинути</Btn>
          )}
        </div>
      </div>

      {days.length === 0 ? (
        <Empty>
          <p className="max-w-[420px] mx-auto">
            {filtered
              ? 'За цим фільтром записів немає. Тут показуються витрати, надходження, перекази між проєктами й погашення боргів.'
              : 'Тут з’являється кожен запис — витрати, надходження, перекази між проєктами й погашення боргів. Будь-який можна виправити або видалити.'}
          </p>
          <div className="mt-3">
            {filtered
              ? <Btn onClick={() => { setKind('all'); setProjectFilter('') }}>Показати всі записи</Btn>
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
              <Rows>
                {d.items.map(e => (
                  <EntryRow key={e.id} db={db} entry={e} onOpen={() => setEditId(e.id)} />
                ))}
              </Rows>
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
  const plus = entry.kind === 'income'

  return (
    <li>
      <button onClick={onOpen}
        className="w-full text-left px-4 sm:px-6 py-2.5 hover:bg-surface2 transition-colors">
        <div className="flex items-baseline gap-2.5">
          <span className="flex-1 min-w-0 text-[14px] truncate">
            {entry.note || target || KIND_LABEL[entry.kind]}
          </span>
          <span className={`text-[14px] num shrink-0 ${plus ? 'text-accentInk' : ''}`}>
            {amountText(entry)}
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
  const navigate = useNavigate()
  const [amountMinor, setAmountMinor] = useState(entry.amountMinor)
  const [currency, setCurrency] = useState<Currency>(entry.currency)
  const initialProject = projectKey(db, entry.projectId) === FREE_KEY ? '' : entry.projectId ?? ''
  const [projectId, setProjectId] = useState(initialProject)
  const [note, setNote] = useState(entry.note ?? '')
  const [occurredOn, setOccurredOn] = useState<string | undefined>(entry.occurredOn)

  const target = targetName(db, entry)
  const occurrence = entry.occurrenceId ? db.occurrences.find(o => o.id === entry.occurrenceId) : undefined
  // Проєкт міняємо лише у витрати й погашення: надходження завжди у вільні,
  // а переказ — окрема пара «звідки → куди», яку простіше видалити й зробити заново.
  const canMove = isSpend(entry.kind)
  // завершений проєкт лишається у списку, поки на нього дивиться цей запис,
  // інакше нативний select мовчки перекинув би запис на перший варіант
  const current = db.projects.find(p => p.id === initialProject)
  const payable = payableProjects(db).filter(p => p.direction !== 'none')
  const options = [...(current && !payable.includes(current) ? [current] : []), ...payable]
    .map(p => ({ value: p.id, label: p.name }))
  const changesRate = amountMinor !== entry.amountMinor || currency !== entry.currency
  // посилання на проєкт запису — звʼязок має бути клікабельним з обох боків
  const linked = entry.kind === 'transfer'
    ? [entry.fromProjectId, entry.projectId]
    : [entry.projectId]
  const linkedProjects = linked
    .map(id => (id ? db.projects.find(p => p.id === id && !p.isFree) : undefined))
    .filter((p): p is NonNullable<typeof p> => !!p)

  const save = () => {
    if (!amountMinor) return
    updateEntry(entry.id, {
      amountMinor,
      currency,
      ...(canMove && projectId !== initialProject ? { projectId: projectId || undefined } : {}),
      note: note.trim(),
      ...(occurredOn ? { occurredOn } : {}),
    })
    onClose()
  }

  return (
    <div>
      <div className="flex items-center gap-1.5 mb-3 flex-wrap">
        <Badge tone={KIND_TONE[entry.kind]}>{KIND_LABEL[entry.kind]}</Badge>
        {target && !canMove && <span className="text-[12.5px] text-muted">{target}</span>}
        {entry.tripId && <Badge>покупки</Badge>}
        {linkedProjects.map(p => (
          <LinkChip key={p.id} icon={p.direction === 'save' ? 'piggy' : p.direction === 'repay' ? 'list' : 'wallet'}
            onClick={() => { onClose(); navigate(projectRoute(p.id)) }}>
            {p.name}
          </LinkChip>
        ))}
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

      {canMove && (
        <Field label="Проєкт" htmlFor="e-project"
          hint={projectId ? undefined : 'Без проєкту витрата лягає у «Вільні гроші».'}>
          <Select id="e-project" value={projectId} onChange={setProjectId} placeholder="Без проєкту"
            options={options} />
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
          Видалення поверне платіж у стан «до оплати». Це навмисно.
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
