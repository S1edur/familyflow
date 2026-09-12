import { useMemo, useState } from 'react'
import {
  Badge, Btn, Card, ConfirmButton, DateInput, Empty, Field, FormActions, Icon, IconButton,
  Input, ListRow, MoneyInput, Pill, Progress, SectionTitle, Segmented, Select, Sheet,
  Stat, Switch, Tabs,
} from '../ui'
import {
  useDB, envelopeMonth, monthSummary, setPlanned,
  confirmOccurrence, skipOccurrence, unconfirmOccurrence, addOccurrence,
  addEnvelope, updateEnvelope, archiveEnvelope, reorderEnvelope,
  addRecurringPlan, updateRecurringPlan, removeRecurringPlan,
} from '../data/store'
import { money, parseAmount } from '../lib/money'
import {
  addMonths, clampDayOfMonth, iso, isoDow, longDate, monthKey, monthTitle, parse,
  relativeDue, shortDate, thisMonth, today,
} from '../lib/dates'
import type {
  Currency, DB, Envelope, EnvelopeKind, Freq, ID, Occurrence, RecurringPlan,
} from '../data/types'

/* ═══════════════════ конверти: довідники і похідне ═══════════════════ */

/* Порядок груп: спершу звідки гроші приходять, далі куди йдуть. */
const KINDS: { value: EnvelopeKind; label: string; hint: string }[] = [
  { value: 'income',   label: 'Дохід',        hint: 'Зарплата, підробіток — те, що приходить' },
  { value: 'fixed',    label: 'Постійні',     hint: 'Оренда, комуналка, підписки — щомісяця те саме' },
  { value: 'variable', label: 'Змінні',       hint: 'Їжа, транспорт, дрібниці — сума плаває' },
  { value: 'sinking',  label: 'Накопичувальні', hint: 'Відкладаємо потроху на майбутню велику витрату' },
  { value: 'savings',  label: 'Заощадження',  hint: 'Подушка і довгі цілі' },
  { value: 'debt',     label: 'Борги',        hint: 'Платежі за кредитами і позиками' },
  { value: 'personal', label: 'Особисті',     hint: 'Особисті гроші одного з нас' },
]
const KIND_HINT = Object.fromEntries(KINDS.map(k => [k.value, k.hint])) as Record<EnvelopeKind, string>

interface Usage { entries: number; occurrences: number; plans: number; planLines: number; total: number }

/** Скільки всього дивиться на конверт. Рахуємо на читанні, не зберігаємо. */
function usageOf(db: DB, id: ID): Usage {
  const entries = db.entries.filter(e => e.envelopeId === id).length
  const occurrences = db.occurrences.filter(o => o.envelopeId === id).length
  const plans = db.recurringPlans.filter(p => p.envelopeId === id).length
  const planLines = db.planLines.filter(l => l.envelopeId === id && l.plannedMinor !== 0).length
  return { entries, occurrences, plans, planLines, total: entries + occurrences + plans + planLines }
}

function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10, m100 = n % 100
  if (m10 === 1 && m100 !== 11) return one
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few
  return many
}

function usageLabel(u: Usage) {
  return u.total ? `${u.total} ${plural(u.total, 'запис', 'записи', 'записів')}` : 'порожній'
}

function usageTitle(u: Usage) {
  const parts: string[] = []
  if (u.entries) parts.push(`витрат і доходів: ${u.entries}`)
  if (u.occurrences) parts.push(`платежів: ${u.occurrences}`)
  if (u.plans) parts.push(`регулярних: ${u.plans}`)
  if (u.planLines) parts.push(`планів місяця: ${u.planLines}`)
  return parts.length ? parts.join(', ') : 'На цей конверт ще нічого не записано'
}

const byOrder = (a: Envelope, b: Envelope) =>
  a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'uk')

/** Строго зростаючі позиції з наявних — щоб обмін місцями спрацював і на однакових sortOrder. */
function slots(values: number[]) {
  let prev = -Infinity
  return values.map(v => { const next = v > prev ? v : prev + 1; prev = next; return next })
}

/** Обмін місцями із сусідом усередині своєї групи. */
function swap(list: Envelope[], i: number, dir: -1 | 1) {
  const j = i + dir
  if (i < 0 || j < 0 || j >= list.length) return
  const positions = slots(list.map(e => e.sortOrder))
  const next = list.slice()
  next[i] = list[j]
  next[j] = list[i]
  next.forEach((e, k) => { if (e.sortOrder !== positions[k]) reorderEnvelope(e.id, positions[k]) })
}

/* ═══════════════════ правила: людська мова ═══════════════════ */

/* Дні тижня — це текст інтерфейсу, а не робота з датами:
   номер дня завжди дає isoDow() з lib/dates (1=Пн .. 7=Нд). */
const DOW = [
  { n: 1, short: 'Пн', every: 'щопонеділка' },
  { n: 2, short: 'Вт', every: 'щовівторка' },
  { n: 3, short: 'Ср', every: 'щосереди' },
  { n: 4, short: 'Чт', every: 'щочетверга' },
  { n: 5, short: 'Пт', every: 'щоп’ятниці' },
  { n: 6, short: 'Сб', every: 'щосуботи' },
  { n: 7, short: 'Нд', every: 'щонеділі' },
]

const FREQ_ITEMS: { value: Freq; label: string }[] = [
  { value: 'monthly', label: 'Щомісяця' },
  { value: 'weekly', label: 'Щотижня' },
  { value: 'yearly', label: 'Щороку' },
  { value: 'daily', label: 'Щодня' },
]

function joinUa(parts: string[]) {
  if (parts.length <= 1) return parts[0] ?? ''
  return parts.slice(0, -1).join(', ') + ' і ' + parts[parts.length - 1]
}

/** Правило людською мовою — головне, що має бути видно в рядку. */
function ruleText(p: RecurringPlan): string {
  const a = parse(p.anchorDate)

  if (p.freq === 'daily') return 'щодня'

  if (p.freq === 'weekly') {
    const days = [...(p.byDay?.length ? p.byDay : [isoDow(p.anchorDate)])].sort((x, y) => x - y)
    if (days.length >= 7) return 'щодня'
    return joinUa(days.map(n => DOW.find(d => d.n === n)?.every ?? ''))
  }

  if (p.freq === 'yearly') {
    const m1 = p.byMonth ?? a.getMonth() + 1
    const year = a.getFullYear()
    const day = clampDayOfMonth(year, m1, p.byMonthDay ?? a.getDate())
    // longDate → «12 лютого, пн»; для правила день тижня зайвий
    return `${longDate(iso(new Date(year, m1 - 1, day))).split(',')[0]} щороку`
  }

  return `${p.byMonthDay ?? a.getDate()} числа щомісяця`
}

/** 29–31 числа: у коротких місяцях платіж з'їжджає на останній день. */
function shortMonthNote(freq: Freq, day: number) {
  if (freq !== 'monthly' && freq !== 'yearly') return undefined
  if (day <= 28) return undefined
  return freq === 'monthly'
    ? 'У коротких місяцях платіж стане останнім днем місяця.'
    : 'Якщо такого числа немає — останній день місяця.'
}

/** Найближчий ще не оплачений платіж цього плану. Рахується на читанні. */
function nextDue(db: DB, planId: string) {
  return db.occurrences
    .filter(o => o.planId === planId && (o.status === 'due' || o.status === 'projected'))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0]
}

/* ═══════════════════ екран ═══════════════════ */

export default function Month() {
  const db = useDB()
  const [month, setMonth] = useState(thisMonth())
  const [tab, setTab] = useState<'plan' | 'bills'>('plan')
  const sum = monthSummary(db, month)

  const bills = useMemo(() => db.occurrences
    .filter(o => monthKey(o.dueDate) === month)
    .sort((a, b) => {
      const rank = (s: string) => (s === 'paid' || s === 'skipped' ? 1 : 0)
      return rank(a.status) - rank(b.status) || a.dueDate.localeCompare(b.dueDate)
    }), [db.occurrences, month])
  const left = bills.filter(b => b.status === 'due' || b.status === 'projected').length

  return (
    <div className="max-w-[860px] mx-auto pb-10">
      <header className="px-4 pt-3 pb-3 sm:px-6">
        <div className="flex items-center gap-1 mb-3">
          <button onClick={() => setMonth(m => addMonths(m, -1))}
            aria-label="Попередній місяць"
            className="h-8 w-8 grid place-items-center rounded-lg text-muted hover:bg-surface2 rotate-180">{Icon.chev(16)}</button>
          {/* не h1: назву екрана несе топ-бар, це перемикач місяця */}
          <div className="text-[22px] font-semibold tracking-tight min-w-[140px] text-center">{monthTitle(month)}</div>
          <button onClick={() => setMonth(m => addMonths(m, 1))}
            aria-label="Наступний місяць"
            className="h-8 w-8 grid place-items-center rounded-lg text-muted hover:bg-surface2">{Icon.chev(16)}</button>
          {month !== thisMonth() && (
            <button onClick={() => setMonth(thisMonth())} className="ml-2 text-[12.5px] text-accent">цей місяць</button>
          )}
        </div>

        <Card>
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
        </Card>
      </header>

      <div className="px-4 sm:px-6">
        <Tabs value={tab} onChange={setTab} items={[
          { value: 'plan', label: 'План' },
          { value: 'bills', label: 'Платежі', badge: left },
        ]} />
      </div>

      {tab === 'plan'
        ? <PlanTab db={db} month={month} />
        : <BillsTab db={db} month={month} bills={bills} />}
    </div>
  )
}

/* ═══════════════════ вкладка «План» ═══════════════════ */

function PlanTab({ db, month }: { db: DB; month: string }) {
  const [editing, setEditing] = useState<Envelope | 'new' | null>(null)
  const [reordering, setReordering] = useState(false)
  const [showArchived, setShowArchived] = useState(false)

  // рядки плану: конверти витрат, факт проти плану — усе похідне
  const rows = envelopeMonth(db, month)
  const income = useMemo(
    () => db.envelopes.filter(e => !e.archived && e.kind === 'income').sort(byOrder),
    [db.envelopes])
  const archived = useMemo(
    () => db.envelopes.filter(e => e.archived).sort(byOrder),
    [db.envelopes])

  const groups = KINDS
    .filter(k => k.value !== 'income')
    .map(k => ({ ...k, rows: rows.filter(r => r.envelope.kind === k.value) }))
    .filter(g => g.rows.length > 0)

  return (
    <div className="mt-3">
      <div className="px-4 sm:px-6 flex flex-wrap items-center gap-2">
        <p className="flex-1 min-w-[180px] text-[12.5px] text-faint">
          {reordering
            ? 'Стрілки міняють порядок усередині групи.'
            : 'Планова сума правиться в рядку. Назва відкриває конверт.'}
        </p>
        <Pill active={reordering} onClick={() => setReordering(v => !v)}
          title="Показати стрілки порядку">Порядок</Pill>
        <Btn variant="ghost" onClick={() => setEditing('new')}>{Icon.plus(16)} Конверт</Btn>
      </div>

      {!rows.length && (
        <Empty>
          <div className="max-w-[380px] mx-auto">
            <p>
              Конверт — це куди лягає витрата: «Їжа», «Комуналка», «Авто».
              З них збирається план місяця, а факт підтягується з витрат сам.
            </p>
            <div className="mt-4">
              <Btn variant="primary" onClick={() => setEditing('new')}>{Icon.plus(16)} Створити конверт</Btn>
            </div>
          </div>
        </Empty>
      )}

      {groups.map(g => {
        const list = g.rows.map(r => r.envelope)
        return (
          <section key={g.value}>
            <div className="sm:px-6"><SectionTitle>{g.label}</SectionTitle></div>
            <ul className="border-y border-line divide-y divide-line bg-surface">
              {g.rows.map((r, i) => (
                <PlanRow key={r.envelope.id}
                  env={r.envelope}
                  planned={r.planned}
                  actual={r.actual}
                  ownerName={db.members.find(m => m.id === r.envelope.ownerId)?.name}
                  reordering={reordering}
                  onCommit={v => setPlanned(r.envelope.id, month, v)}
                  onOpen={() => setEditing(r.envelope)}
                  onUp={i > 0 ? () => swap(list, i, -1) : undefined}
                  onDown={i < list.length - 1 ? () => swap(list, i, 1) : undefined} />
              ))}
            </ul>
          </section>
        )
      })}

      {income.length > 0 && (
        <section>
          <div className="sm:px-6"><SectionTitle>Дохід</SectionTitle></div>
          <ul className="border-y border-line divide-y divide-line bg-surface">
            {income.map(e => (
              <ListRow key={e.id} onClick={() => setEditing(e)}>
                <span className="flex-1 truncate text-[14px]">{e.name}</span>
                <span className="text-[12px] num text-faint shrink-0" title={usageTitle(usageOf(db, e.id))}>
                  {usageLabel(usageOf(db, e.id))}
                </span>
              </ListRow>
            ))}
          </ul>
          <p className="px-4 sm:px-6 mt-2 text-[12px] text-faint">
            Дохід не планується по конвертах — він у зведенні вище.
          </p>
        </section>
      )}

      {archived.length > 0 && (
        <section className="mt-6">
          <button onClick={() => setShowArchived(v => !v)}
            aria-expanded={showArchived}
            className="w-full flex items-center gap-2 px-4 sm:px-6 py-2.5 text-[12px] uppercase tracking-wider text-faint hover:text-muted">
            <span className={showArchived ? 'rotate-90 transition-transform' : 'transition-transform'}>{Icon.chev(14)}</span>
            Архів
            <span className="num">{archived.length}</span>
          </button>
          {showArchived && (
            <ul className="border-y border-line divide-y divide-line bg-surface">
              {archived.map(e => (
                <ListRow key={e.id} onClick={() => setEditing(e)}>
                  <span className="flex-1 truncate text-[14px] text-muted">{e.name}</span>
                  <span className="text-[12px] num text-faint shrink-0" title={usageTitle(usageOf(db, e.id))}>
                    {usageLabel(usageOf(db, e.id))}
                  </span>
                  <span className="shrink-0" onClick={ev => ev.stopPropagation()}>
                    <Btn variant="quiet" onClick={() => archiveEnvelope(e.id, false)}>Повернути</Btn>
                  </span>
                </ListRow>
              ))}
            </ul>
          )}
        </section>
      )}

      <p className="px-4 sm:px-6 mt-4 text-[12px] text-faint">
        Конверти не видаляються: на них посилаються записи за минулі місяці.
        Зайвий — в архів, історія залишиться цілою.
      </p>

      <Sheet open={editing !== null} onClose={() => setEditing(null)}
        title={editing === 'new' ? 'Новий конверт' : editing ? editing.name : ''}>
        {editing !== null && (
          <EnvelopeForm
            key={editing === 'new' ? 'new' : editing.id}
            env={editing === 'new' ? null : editing}
            db={db}
            onDone={() => setEditing(null)} />
        )}
      </Sheet>
    </div>
  )
}

function PlanRow({ env, planned, actual, ownerName, reordering, onCommit, onOpen, onUp, onDown }: {
  env: Envelope; planned: number; actual: number; ownerName?: string
  reordering: boolean
  onCommit: (v: number) => void
  onOpen: () => void
  onUp?: () => void
  onDown?: () => void
}) {
  return (
    <li className="px-4 sm:px-6 py-2.5">
      <div className="flex items-center gap-3">
        <button type="button" onClick={onOpen}
          className="flex-1 min-w-0 flex items-center gap-2 text-left rounded-md hover:text-accent transition-colors">
          <span className="text-[14px] truncate">{env.name}</span>
          {ownerName && <Badge>{ownerName}</Badge>}
        </button>

        {reordering ? (
          <span className="flex items-center shrink-0">
            <IconButton label={`Вище: ${env.name}`} disabled={!onUp} onClick={onUp}>
              <span className="-rotate-90 block">{Icon.chev(16)}</span>
            </IconButton>
            <IconButton label={`Нижче: ${env.name}`} disabled={!onDown} onClick={onDown}>
              <span className="rotate-90 block">{Icon.chev(16)}</span>
            </IconButton>
          </span>
        ) : (
          <>
            <span className="text-[13px] num text-muted">{money(actual)}</span>
            <span className="text-faint text-[13px]">/</span>
            <PlanInput value={planned} onCommit={onCommit} />
          </>
        )}
      </div>

      {!reordering && (
        <div className="mt-1.5">
          <Progress value={planned ? actual / planned : 0}
            tone={planned && actual > planned ? 'warn' : 'accent'} height={4} />
        </div>
      )}
    </li>
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
      inputMode="decimal" placeholder="—" aria-label="План на місяць"
      className="w-[92px] h-8 px-2 text-right text-[13px] num rounded-md border border-transparent hover:border-line focus:border-accent bg-transparent outline-none"
    />
  )
}

function EnvelopeForm({ env, db, onDone }: { env: Envelope | null; db: DB; onDone: () => void }) {
  const [name, setName] = useState(env?.name ?? '')
  const [kind, setKind] = useState<EnvelopeKind>(env?.kind ?? 'variable')
  const [ownerId, setOwnerId] = useState<ID | ''>(env?.ownerId ?? '')
  const [archived, setArchived] = useState(!!env?.archived)

  const trimmed = name.trim()
  const duplicate = db.envelopes.some(e =>
    e.id !== env?.id && !e.archived && e.name.trim().toLowerCase() === trimmed.toLowerCase())
  const needsOwner = kind === 'personal' && !ownerId
  const canSave = !!trimmed && !duplicate && !needsOwner

  const usage = env ? usageOf(db, env.id) : null

  const save = () => {
    if (!canSave) return
    const owner = kind === 'personal' ? (ownerId || undefined) : undefined
    if (env) {
      updateEnvelope(env.id, { name: trimmed, kind, ownerId: owner })
      if (archived !== !!env.archived) archiveEnvelope(env.id, archived)
    } else {
      addEnvelope({ name: trimmed, kind, ownerId: owner })
    }
    onDone()
  }

  return (
    <div>
      <Field label="Назва" htmlFor="env-name"
        error={duplicate ? 'Конверт з такою назвою вже є' : undefined}
        hint={duplicate ? undefined : 'Коротко, як у житті: «Їжа», «Комуналка», «Авто»'}>
        <Input id="env-name" value={name} onChange={setName} autoFocus
          placeholder="Назва конверта" onEnter={save} />
      </Field>

      <Field label="Тип" htmlFor="env-kind" hint={KIND_HINT[kind]}>
        <Select id="env-kind" value={kind}
          onChange={k => { setKind(k); if (k !== 'personal') setOwnerId('') }}
          options={KINDS.map(k => ({ value: k.value, label: k.label }))} />
      </Field>

      {kind === 'personal' && (
        <Field label="Власник" htmlFor="env-owner"
          error={needsOwner ? 'Особистий конверт належить комусь одному' : undefined}>
          <Select<ID> id="env-owner" value={ownerId} onChange={setOwnerId} placeholder="Вибрати"
            options={db.members.map(m => ({ value: m.id, label: m.name }))} />
        </Field>
      )}

      {env && (
        <>
          <Card className="mt-1 text-[12.5px] text-muted">
            <div className="text-ink">
              На конверт посилається <span className="num">{usage!.total}</span>{' '}
              {plural(usage!.total, 'запис', 'записи', 'записів')}
            </div>
            <p className="mt-1">
              {usage!.total
                ? `${usageTitle(usage!)}. Архів прибирає конверт зі списків і нових витрат — записи залишаються на місці.`
                : 'Поки що нічого. Архів прибирає конверт зі списків, видалення немає навмисно.'}
            </p>
          </Card>
          <div className="mt-2">
            <Switch checked={archived} onChange={setArchived} label="В архіві"
              hint="Не показується в плані місяця й у швидкому записі" />
          </div>
        </>
      )}

      <FormActions onSubmit={save} onCancel={onDone} disabled={!canSave}
        submitLabel={env ? 'Зберегти' : 'Створити'} />
    </div>
  )
}

/* ═══════════════════ вкладка «Платежі» ═══════════════════ */

function BillsTab({ db, month, bills }: { db: DB; month: string; bills: Occurrence[] }) {
  const [rule, setRule] = useState<RecurringPlan | 'new' | null>(null)
  const [oneOff, setOneOff] = useState(false)

  const active = useMemo(() => db.recurringPlans.filter(p => p.active).sort((a, b) => {
    const da = nextDue(db, a.id)?.dueDate ?? '9999'
    const dbb = nextDue(db, b.id)?.dueDate ?? '9999'
    return da.localeCompare(dbb) || a.name.localeCompare(b.name, 'uk')
  }), [db])
  const inactive = db.recurringPlans.filter(p => !p.active)

  // нічого немає взагалі — один порожній стан з однією дією, а не два поспіль
  const bare = !bills.length && !db.recurringPlans.length

  return (
    <div className="mt-3">
      {bare ? (
        <Empty>
          <div className="max-w-[380px] mx-auto">
            <p>
              Тут живе розклад: оренда 5 числа, інтернет 10 числа, страховка раз на рік.
              Правило саме створює платежі на місяць — руками нічого заводити не треба.
            </p>
            <div className="mt-4">
              <Btn variant="primary" onClick={() => setRule('new')}>{Icon.plus(16)} Додати правило</Btn>
            </div>
          </div>
        </Empty>
      ) : (
        <>
          <div className="sm:px-6">
            <SectionTitle right={
              <Btn variant="ghost" onClick={() => setOneOff(true)}>{Icon.plus(16)} Разовий</Btn>
            }>Чекліст місяця</SectionTitle>
          </div>

          {bills.length ? (
            <ul className="border-y border-line divide-y divide-line bg-surface">
              {bills.map(b => <BillRow key={b.id} db={db} o={b} />)}
            </ul>
          ) : (
            <Empty>
              <div className="max-w-[380px] mx-auto">
                <p>На {monthTitle(month).toLowerCase()} правила нічого не створили.</p>
                <div className="mt-4">
                  <Btn variant="primary" onClick={() => setOneOff(true)}>{Icon.plus(16)} Разовий платіж</Btn>
                </div>
              </div>
            </Empty>
          )}

          <div className="sm:px-6">
            <SectionTitle right={
              <Btn variant="ghost" onClick={() => setRule('new')}>{Icon.plus(16)} Правило</Btn>
            }>Правила</SectionTitle>
          </div>

          {active.length ? (
            <ul className="border-y border-line divide-y divide-line bg-surface">
              {active.map(p => <RuleRow key={p.id} db={db} p={p} onEdit={() => setRule(p)} />)}
            </ul>
          ) : (
            <p className="px-4 sm:px-6 text-[12.5px] text-faint">
              Активних правил немає — платежі цього місяця заведені руками.
            </p>
          )}

          <p className="px-4 sm:px-6 mt-2 text-[12px] text-faint">
            Правило — джерело розкладу: платежі в чеклісті беруться з нього.
          </p>

          {!!inactive.length && (
            <>
              <div className="sm:px-6"><SectionTitle>Вимкнені</SectionTitle></div>
              <ul className="border-y border-line divide-y divide-line bg-surface">
                {inactive.map(p => <RuleRow key={p.id} db={db} p={p} onEdit={() => setRule(p)} />)}
              </ul>
              <p className="px-4 sm:px-6 mt-2 text-[12px] text-faint">
                Вимкнене правило не створює нових платежів. Історія оплачених лишається.
              </p>
            </>
          )}
        </>
      )}

      <Sheet open={rule !== null} onClose={() => setRule(null)}
        title={rule === 'new' ? 'Нове правило' : rule ? rule.name : ''}>
        {rule !== null && (
          <RuleForm
            key={rule === 'new' ? 'new' : rule.id}
            db={db}
            editing={rule === 'new' ? null : rule}
            onDone={() => setRule(null)} />
        )}
      </Sheet>

      <Sheet open={oneOff} onClose={() => setOneOff(false)} title="Разовий платіж">
        {oneOff && <OneOffForm db={db} month={month} onDone={() => setOneOff(false)} />}
      </Sheet>
    </div>
  )
}

function BillRow({ db, o }: { db: DB; o: Occurrence }) {
  const [editing, setEditing] = useState(false)
  const [raw, setRaw] = useState('')
  const assignee = db.members.find(m => m.id === o.assigneeId)
  const plan = o.planId ? db.recurringPlans.find(p => p.id === o.planId) : undefined
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
            {/* правило поруч із датою: інакше чекліст читається як випадкові числа */}
            {plan && !settled && <span> · {ruleText(plan)}</span>}
          </div>
        </div>
        {!settled && <span className="text-[14px] num text-muted shrink-0">{money(o.expectedMinor, o.currency)}</span>}
        {settled && (
          <span className="shrink-0">
            <IconButton label={`Повернути в неоплачені: ${o.name}`} onClick={() => unconfirmOccurrence(o.id)}>
              {Icon.x(16)}
            </IconButton>
          </span>
        )}
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
            aria-label="Фактична сума"
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

function RuleRow({ db, p, onEdit }: { db: DB; p: RecurringPlan; onEdit: () => void }) {
  const next = nextDue(db, p.id)
  const assignee = db.members.find(m => m.id === p.assigneeId)
  const fund = db.funds.find(f => f.id === p.fundId)
  const debt = db.debts.find(x => x.id === p.debtId)
  const envelope = db.envelopes.find(e => e.id === p.envelopeId)
  const rel = next ? relativeDue(next.dueDate) : undefined
  const overdue = rel?.tone === 'over'

  return (
    <li>
      <button type="button" onClick={onEdit}
        className="w-full text-left px-4 sm:px-6 py-2.5 hover:bg-surface2 transition-colors">
        <div className="flex items-baseline gap-3">
          <span className={`flex-1 min-w-0 text-[14px] truncate ${p.active ? '' : 'text-muted'}`}>{p.name}</span>
          <span className="shrink-0 text-[14px] num text-muted">{money(p.expectedMinor, p.currency)}</span>
        </div>

        {/* правило — найважливіший рядок екрана */}
        <div className="mt-0.5 text-[13px]">{ruleText(p)}</div>

        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-faint">
          {p.active && next && (
            <span className={`num ${overdue ? 'text-warn' : ''}`}>
              {overdue
                ? `прострочено з ${shortDate(next.dueDate)}`
                // для дат далі тижня relativeDue() повертає той самий shortDate — не дублюємо
                : rel?.tone === 'later'
                  ? `далі ${shortDate(next.dueDate)}`
                  : `далі ${shortDate(next.dueDate)} · ${rel?.label}`}
            </span>
          )}
          {p.active && !next && <span className="text-warn">майбутніх платежів немає</span>}
          {envelope && <span>{envelope.name}</span>}
          {assignee && <span>{assignee.name}</span>}
          {p.amountMode === 'variable' && <Badge>сума плаває</Badge>}
          {fund && <Badge tone="accent">з фонду «{fund.name}»</Badge>}
          {debt && <Badge tone="accent">гасить «{debt.name}»</Badge>}
          {!p.active && <Badge tone="warn">вимкнено</Badge>}
        </div>
      </button>
    </li>
  )
}

type Draft = {
  name: string
  envelopeId: string
  expectedMinor: number
  currency: Currency
  amountMode: 'fixed' | 'variable'
  freq: Freq
  byMonthDay: number
  byDay: number[]
  byMonth: number
  anchorDate: string
  assigneeId: string
  fundId: string
  debtId: string
  active: boolean
}

function emptyDraft(): Draft {
  const t = today()
  const d = parse(t)
  return {
    name: '', envelopeId: '', expectedMinor: 0, currency: 'UAH', amountMode: 'fixed',
    freq: 'monthly', byMonthDay: d.getDate(), byDay: [isoDow(t)], byMonth: d.getMonth() + 1,
    anchorDate: t, assigneeId: '', fundId: '', debtId: '', active: true,
  }
}

function toDraft(p: RecurringPlan): Draft {
  const a = parse(p.anchorDate)
  return {
    name: p.name, envelopeId: p.envelopeId, expectedMinor: p.expectedMinor, currency: p.currency,
    amountMode: p.amountMode, freq: p.freq,
    byMonthDay: p.byMonthDay ?? a.getDate(),
    byDay: p.byDay?.length ? [...p.byDay] : [isoDow(p.anchorDate)],
    byMonth: p.byMonth ?? a.getMonth() + 1,
    anchorDate: p.anchorDate,
    assigneeId: p.assigneeId ?? '', fundId: p.fundId ?? '', debtId: p.debtId ?? '',
    active: p.active,
  }
}

function RuleForm({ db, editing, onDone }: { db: DB; editing: RecurringPlan | null; onDone: () => void }) {
  const [draft, setDraft] = useState<Draft>(() => editing ? toDraft(editing) : emptyDraft())
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft(d => ({ ...d, [k]: v }))

  const envelopes = db.envelopes
    .filter(e => !e.archived && e.kind !== 'income')
    .sort((a, b) => a.sortOrder - b.sortOrder)
  const funds = db.funds.filter(f => !f.archived)
  const debts = db.debts.filter(x => !x.closedOn || x.id === draft.debtId)

  const year = Number(thisMonth().slice(0, 4))
  const monthOptions = Array.from({ length: 12 }, (_, i) => ({
    value: String(i + 1),
    label: monthTitle(`${year}-${String(i + 1).padStart(2, '0')}`),
  }))
  const dayOptions = Array.from({ length: 31 }, (_, i) => ({ value: String(i + 1), label: `${i + 1} числа` }))

  const preview: RecurringPlan = {
    id: editing?.id ?? 'preview',
    name: draft.name, envelopeId: draft.envelopeId, expectedMinor: draft.expectedMinor,
    currency: draft.currency, amountMode: draft.amountMode, freq: draft.freq,
    byMonthDay: draft.byMonthDay, byDay: draft.byDay, byMonth: draft.byMonth,
    anchorDate: draft.anchorDate, active: draft.active,
  }

  const invalid =
    !draft.name.trim() ||
    !draft.envelopeId ||
    (draft.amountMode === 'fixed' && draft.expectedMinor <= 0)

  const submit = () => {
    if (invalid) return
    const payload: Omit<RecurringPlan, 'id'> = {
      name: draft.name.trim(),
      envelopeId: draft.envelopeId,
      expectedMinor: draft.expectedMinor,
      currency: draft.currency,
      amountMode: draft.amountMode,
      freq: draft.freq,
      byMonthDay: draft.freq === 'monthly' || draft.freq === 'yearly' ? draft.byMonthDay : undefined,
      byDay: draft.freq === 'weekly' && draft.byDay.length ? [...draft.byDay].sort((a, b) => a - b) : undefined,
      byMonth: draft.freq === 'yearly' ? draft.byMonth : undefined,
      anchorDate: draft.anchorDate,
      assigneeId: draft.assigneeId || undefined,
      fundId: draft.fundId || undefined,
      debtId: draft.debtId || undefined,
      active: draft.active,
    }
    // майбутні платежі перегенерує store — руками occurrences не чіпаємо
    if (editing) updateRecurringPlan(editing.id, payload)
    else addRecurringPlan(payload)
    onDone()
  }

  const note = shortMonthNote(draft.freq, draft.byMonthDay)

  return (
    <div>
      <div className="rounded-lg bg-surface2 px-3 py-2 mb-3">
        <div className="text-[11.5px] uppercase tracking-wider text-faint">Правило</div>
        <div className="text-[14px]">{ruleText(preview)}</div>
      </div>

      <Field label="Назва" htmlFor="plan-name">
        <Input id="plan-name" value={draft.name} onChange={v => set('name', v)}
          placeholder="Оренда" autoFocus={!editing} onEnter={submit} />
      </Field>

      <Field label="Конверт" htmlFor="plan-env"
        hint="Витрата за цим платежем піде в цей конверт.">
        <Select id="plan-env" value={draft.envelopeId} placeholder="Оберіть конверт"
          options={envelopes.map(e => ({ value: e.id, label: e.name }))}
          onChange={v => set('envelopeId', v)} />
      </Field>

      <div className="grid grid-cols-[1fr_auto] gap-3">
        <Field label="Очікувана сума" htmlFor="plan-amount">
          <MoneyInput id="plan-amount" valueMinor={draft.expectedMinor} currency={draft.currency}
            onChange={v => set('expectedMinor', v)} />
        </Field>
        <Field label="Валюта">
          <Segmented<Currency> label="Валюта" value={draft.currency}
            onChange={v => set('currency', v)}
            items={[{ value: 'UAH', label: 'UAH' }, { value: 'USD', label: 'USD' }, { value: 'EUR', label: 'EUR' }]} />
        </Field>
      </div>

      <Field label="Сума"
        hint={draft.amountMode === 'fixed'
          ? 'Стала: щоразу однакова, як оренда чи підписка.'
          : 'Плаваюча: очікування саме оновиться по медіані останніх шести оплат.'}>
        <Segmented<'fixed' | 'variable'> label="Режим суми" full value={draft.amountMode}
          onChange={v => set('amountMode', v)}
          items={[{ value: 'fixed', label: 'Стала' }, { value: 'variable', label: 'Плаваюча' }]} />
      </Field>

      <Field label="Періодичність">
        <Segmented<Freq> label="Періодичність" full value={draft.freq}
          onChange={v => set('freq', v)} items={FREQ_ITEMS} />
      </Field>

      {draft.freq === 'monthly' && (
        <Field label="День місяця" htmlFor="plan-day" hint={note}>
          <Select id="plan-day" value={String(draft.byMonthDay)} options={dayOptions}
            onChange={v => set('byMonthDay', Number(v))} />
        </Field>
      )}

      {draft.freq === 'weekly' && (
        <Field label="Дні тижня"
          hint={draft.byDay.length ? undefined : 'Нічого не вибрано — візьмемо день тижня з дати прив’язки.'}>
          <div className="flex flex-wrap gap-1.5">
            {DOW.map(d => (
              <Pill key={d.n} active={draft.byDay.includes(d.n)} title={d.every}
                onClick={() => set('byDay', draft.byDay.includes(d.n)
                  ? draft.byDay.filter(x => x !== d.n)
                  : [...draft.byDay, d.n])}>
                {d.short}
              </Pill>
            ))}
          </div>
        </Field>
      )}

      {draft.freq === 'yearly' && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Місяць" htmlFor="plan-month">
            <Select id="plan-month" value={String(draft.byMonth)} options={monthOptions}
              onChange={v => set('byMonth', Number(v))} />
          </Field>
          <Field label="Число" htmlFor="plan-day-y" hint={note}>
            <Select id="plan-day-y" value={String(draft.byMonthDay)} options={dayOptions}
              onChange={v => set('byMonthDay', Number(v))} />
          </Field>
        </div>
      )}

      <Field label="Дата прив’язки" htmlFor="plan-anchor"
        hint="З якої дати діє правило. Якщо день не вибрано — він береться звідси.">
        <DateInput id="plan-anchor" value={draft.anchorDate}
          onChange={v => set('anchorDate', v ?? today())} />
      </Field>

      <Field label="Хто платить" htmlFor="plan-who"
        hint="Щоб було кого спитати «ти вже оплатив?». Взаєморозрахунків немає.">
        <Select id="plan-who" value={draft.assigneeId} placeholder="Будь-хто"
          options={db.members.map(m => ({ value: m.id, label: m.name }))}
          onChange={v => set('assigneeId', v)} />
      </Field>

      {!!funds.length && (
        <Field label="Фонд-джерело" htmlFor="plan-fund"
          hint="Необов’язково. Оплата спише гроші з фонду — це не друга витрата.">
          <Select id="plan-fund" value={draft.fundId} placeholder="Без фонду"
            options={funds.map(f => ({ value: f.id, label: f.name }))}
            onChange={v => set('fundId', v)} />
        </Field>
      )}

      {!!debts.length && (
        <Field label="Гасить борг" htmlFor="plan-debt"
          hint="Необов’язково. Підтвердження платежу зменшить борг — це один запис, а не друга витрата.">
          <Select id="plan-debt" value={draft.debtId} placeholder="Без боргу"
            options={debts.map(x => ({ value: x.id, label: x.name }))}
            onChange={v => set('debtId', v)} />
        </Field>
      )}

      <div className="border-t border-line pt-2 mt-1">
        <Switch checked={draft.active} onChange={v => set('active', v)}
          label="Правило активне"
          hint={draft.active
            ? 'Створює платежі наперед на рік.'
            : 'Майбутні неоплачені платежі приберемо, історію лишимо.'} />
      </div>

      <FormActions
        onSubmit={submit}
        onCancel={onDone}
        disabled={invalid}
        submitLabel={editing ? 'Зберегти' : 'Додати'}
        destructive={editing
          ? <ConfirmButton onConfirm={() => { removeRecurringPlan(editing.id); onDone() }}>
              Видалити
            </ConfirmButton>
          : undefined}
      />

      {editing && (
        <p className="text-[12px] text-faint mt-2">
          Видалення прибирає лише майбутні неоплачені платежі. Оплачені й пропущені лишаються
          в історії місяців — цифри за минуле не змінюються.
        </p>
      )}
    </div>
  )
}

/** Платіж без правила: живе тільки в чеклісті свого місяця. */
function OneOffForm({ db, month, onDone }: { db: DB; month: string; onDone: () => void }) {
  const [name, setName] = useState('')
  const [envelopeId, setEnvelopeId] = useState('')
  const [expectedMinor, setExpectedMinor] = useState(0)
  const [currency, setCurrency] = useState<Currency>('UAH')
  const [dueDate, setDueDate] = useState(month === thisMonth() ? today() : `${month}-01`)
  const [assigneeId, setAssigneeId] = useState('')

  const envelopes = db.envelopes
    .filter(e => !e.archived && e.kind !== 'income')
    .sort((a, b) => a.sortOrder - b.sortOrder)

  const invalid = !name.trim() || !envelopeId || expectedMinor <= 0

  const submit = () => {
    if (invalid) return
    addOccurrence({
      envelopeId, name: name.trim(), dueDate, expectedMinor, currency,
      assigneeId: assigneeId || undefined,
    })
    onDone()
  }

  return (
    <div>
      <Field label="Назва" htmlFor="one-name">
        <Input id="one-name" value={name} onChange={setName} autoFocus
          placeholder="Техогляд" onEnter={submit} />
      </Field>

      <Field label="Конверт" htmlFor="one-env">
        <Select id="one-env" value={envelopeId} placeholder="Оберіть конверт"
          options={envelopes.map(e => ({ value: e.id, label: e.name }))}
          onChange={setEnvelopeId} />
      </Field>

      <div className="grid grid-cols-[1fr_auto] gap-3">
        <Field label="Сума" htmlFor="one-amount">
          <MoneyInput id="one-amount" valueMinor={expectedMinor} currency={currency}
            onChange={setExpectedMinor} />
        </Field>
        <Field label="Валюта">
          <Segmented<Currency> label="Валюта" value={currency} onChange={setCurrency}
            items={[{ value: 'UAH', label: 'UAH' }, { value: 'USD', label: 'USD' }, { value: 'EUR', label: 'EUR' }]} />
        </Field>
      </div>

      <Field label="Дата" htmlFor="one-date"
        hint={`Платіж стане в чекліст на ${monthTitle(monthKey(dueDate)).toLowerCase()}.`}>
        <DateInput id="one-date" value={dueDate} onChange={v => setDueDate(v ?? today())} />
      </Field>

      <Field label="Хто платить" htmlFor="one-who">
        <Select id="one-who" value={assigneeId} placeholder="Будь-хто"
          options={db.members.map(m => ({ value: m.id, label: m.name }))}
          onChange={setAssigneeId} />
      </Field>

      <FormActions onSubmit={submit} onCancel={onDone} disabled={invalid} submitLabel="Додати" />

      <p className="text-[12px] text-faint mt-2">
        Разовий платіж не створює правила: він з’явиться лише в цьому місяці.
      </p>
    </div>
  )
}
