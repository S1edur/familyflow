import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Badge, Btn, ConfirmButton, DateInput, Empty, Field, FormActions, Icon, IconButton, Input,
  LinkChip, MoneyInput, OptionalFields, Pill, Rows, SectionTitle, Segmented, Select, Sheet, Switch,
  useSheet,
} from '../ui'
import { MonthBar, useMonth } from '../components/MonthBar'
import {
  useDB, confirmOccurrence, skipOccurrence, unconfirmOccurrence, addOccurrence,
  addRecurringPlan, updateRecurringPlan, removeRecurringPlan, isIncomeOccurrence,
} from '../data/store'
import {
  DOW, debtRoute, envelopeRoute, fundRoute, nextDue, ruleRoute, ruleText,
} from '../data/links'
import { money, parseAmount } from '../lib/money'
import {
  clampDayOfMonth, iso, isoDow, longDate, monthKey, monthTitle, parse,
  relativeDue, shortDate, thisMonth, today,
} from '../lib/dates'
import type { Currency, DB, Freq, ID, Occurrence, RecurringPlan } from '../data/types'

/* ═══════════════════ правила: людська мова ═══════════════════ */

const FREQ_ITEMS: { value: Freq; label: string }[] = [
  { value: 'monthly', label: 'Щомісяця' },
  { value: 'weekly', label: 'Щотижня' },
  { value: 'yearly', label: 'Щороку' },
  { value: 'daily', label: 'Щодня' },
]

/** 29–31 числа: у коротких місяцях платіж з'їжджає на останній день. */
function shortMonthNote(freq: Freq, day: number) {
  if (freq !== 'monthly' && freq !== 'yearly') return undefined
  if (day <= 28) return undefined
  return freq === 'monthly'
    ? 'У коротких місяцях платіж стане останнім днем місяця.'
    : 'Якщо такого числа немає — останній день місяця.'
}

/* ═══════════════════ екран ═══════════════════ */

/**
 * Чекліст платежів місяця і правила, які його наповнюють.
 *
 * Окремо від конвертів навмисно: конверт — це рішення «скільки на що»,
 * а платіж — підтвердження «це сталося». Змішані в одному екрані, вони
 * читались як один довгий список із двома різними способами взаємодії.
 */
export default function Bills() {
  const db = useDB()
  const [month, setMonth] = useMonth()

  const bills = useMemo(() => db.occurrences
    .filter(o => monthKey(o.dueDate) === month)
    .sort((a, b) => {
      const rank = (s: string) => (s === 'paid' || s === 'skipped' ? 1 : 0)
      return rank(a.status) - rank(b.status) || a.dueDate.localeCompare(b.dueDate)
    }), [db.occurrences, month])

  const left = bills.filter(b => b.status === 'due' || b.status === 'projected')
  const leftMinor = left.reduce((s, o) => s + o.expectedMinor, 0)

  return (
    <div className="max-w-[980px] mx-auto pb-10">
      <header className="px-4 pt-3 pb-1 sm:px-6">
        <MonthBar month={month} onChange={setMonth} right={
          <span className="text-[12.5px] num text-muted">
            {left.length
              ? <>лишилось <span className="text-ink">{left.length}</span> на <span className="text-ink">{money(leftMinor)}</span></>
              : 'усе закрито'}
          </span>
        } />
      </header>

      <BillsTab db={db} month={month} bills={bills} />
    </div>
  )
}

function BillsTab({ db, month, bills }: { db: DB; month: string; bills: Occurrence[] }) {
  const [ruleParam, setRuleParam] = useSheet('rule')
  const [envParam] = useSheet('env')
  const [debtParam] = useSheet('debt')
  const rule: RecurringPlan | 'new' | null = ruleParam === 'new'
    ? 'new'
    : ruleParam ? (db.recurringPlans.find(p => p.id === ruleParam) ?? null) : null
  // закриваючи лист, прибираємо й підказки, з яких він відкрився
  const setRule = (v: RecurringPlan | 'new' | null) =>
    setRuleParam(v === null ? null : v === 'new' ? 'new' : v.id, { env: null, debt: null })
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
            <Rows>
              {bills.map(b => <BillRow key={b.id} db={db} o={b} />)}
            </Rows>
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
            <Rows>
              {active.map(p => <RuleRow key={p.id} db={db} p={p} onEdit={() => setRule(p)} />)}
            </Rows>
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
              <Rows>
                {inactive.map(p => <RuleRow key={p.id} db={db} p={p} onEdit={() => setRule(p)} />)}
              </Rows>
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
            presetEnvelopeId={rule === 'new' ? (envParam ?? undefined) : undefined}
            presetDebtId={rule === 'new' ? (debtParam ?? undefined) : undefined}
            onDone={() => setRule(null)} />
        )}
      </Sheet>

      <Sheet open={oneOff} onClose={() => setOneOff(false)} title="Разовий платіж">
        {oneOff && <OneOffForm db={db} month={month} onDone={() => setOneOff(false)} />}
      </Sheet>
    </div>
  )
}

/**
 * Рядок чекліста. Головна дія одна — квадрат ліворуч, як у задачах: тап і
 * платіж оплачено. «Інша сума» й «Пропустити» потрібні рідко, тож живуть
 * за «⋯»: три кнопки під кожним із десяти платежів робили з чекліста стіну.
 */
function BillRow({ db, o }: { db: DB; o: Occurrence }) {
  const nav = useNavigate()
  const [more, setMore] = useState(false)
  const [editing, setEditing] = useState(false)
  const [raw, setRaw] = useState('')
  const assignee = db.members.find(m => m.id === o.assigneeId)
  const plan = o.planId ? db.recurringPlans.find(p => p.id === o.planId) : undefined
  const fund = o.fundId ? db.funds.find(f => f.id === o.fundId) : undefined
  const envelope = db.envelopes.find(e => e.id === o.envelopeId)
  const paid = o.status === 'paid'
  const settled = paid || o.status === 'skipped'
  const overdue = o.status === 'due' && o.dueDate < today()
  const doneLabel = isIncomeOccurrence(db, o) ? 'Отримано' : 'Оплачено'

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
          <button onClick={() => confirmOccurrence(o.id)}
            aria-label={`${doneLabel}: ${o.name}`} title={doneLabel}
            className="mt-0.5 shrink-0 h-5 w-5 rounded-[6px] border border-line2 hover:border-accent hover:bg-accentSoft transition-colors" />
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-3">
            <span className={`flex-1 min-w-0 text-[14px] truncate ${settled ? 'text-faint line-through' : ''}`}>{o.name}</span>
            <span className={`shrink-0 text-[14px] num ${settled ? 'text-faint' : 'text-muted'}`}>
              {money(paid ? o.actualMinor ?? o.expectedMinor : o.expectedMinor, o.currency)}
            </span>
          </div>
          <div className="text-[12px] text-faint num">
            {shortDate(o.dueDate)}
            {overdue && <span className="text-warn"> · прострочено</span>}
            {paid && <span> · оплачено</span>}
            {o.status === 'skipped' && <span> · пропущено</span>}
            {assignee && !settled && <span> · {assignee.name}</span>}
          </div>

          {!settled && (envelope || fund || plan) && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {/* звідки цей платіж узявся і куди лягає — одним тапом, без пошуку по екранах */}
              {fund
                ? <LinkChip icon="piggy" tone="accent" onClick={() => nav(fundRoute(fund.id))}>
                    внесок у «{fund.name}»
                  </LinkChip>
                : plan && <LinkChip icon="clock" onClick={() => nav(ruleRoute(plan.id))}>{ruleText(plan)}</LinkChip>}
              {envelope && (
                <LinkChip icon="wallet" onClick={() => nav(envelopeRoute(envelope.id))}>{envelope.name}</LinkChip>
              )}
            </div>
          )}

          {more && !settled && (
            <div className="flex gap-1.5 mt-2">
              <Btn onClick={() => { setEditing(true); setRaw(String(o.expectedMinor / 100)); setMore(false) }}>Інша сума</Btn>
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
        <div className="text-center py-4">
          <input autoFocus value={raw} onChange={e => setRaw(e.target.value)} inputMode="decimal"
            aria-label="Фактична сума"
            className="w-full text-center text-[32px] font-semibold num bg-transparent outline-none" />
          <div className="text-[12.5px] text-faint mt-1">очікували {money(o.expectedMinor, o.currency)}</div>
        </div>
        <Btn variant="primary" full disabled={!parseAmount(raw)}
          onClick={() => { const m = parseAmount(raw); if (m) { confirmOccurrence(o.id, m); setEditing(false) } }}>
          Записати як {doneLabel.toLowerCase()}
        </Btn>
      </Sheet>
    </li>
  )
}

/**
 * Рядок правила. Назви конверта, фонду й боргу — не текст, а переходи:
 * прочитавши «гасить Кредит», звідси можна одразу піти в той борг.
 */
function RuleRow({ db, p, onEdit }: { db: DB; p: RecurringPlan; onEdit: () => void }) {
  const nav = useNavigate()
  const next = nextDue(db, p.id)
  const assignee = db.members.find(m => m.id === p.assigneeId)
  const fund = db.funds.find(f => f.id === p.fundId)
  const debt = db.debts.find(x => x.id === p.debtId)
  const envelope = db.envelopes.find(e => e.id === p.envelopeId)
  const rel = next ? relativeDue(next.dueDate) : undefined
  const overdue = rel?.tone === 'over'

  return (
    <li className="px-4 sm:px-6 py-2.5">
      <button type="button" onClick={onEdit} className="w-full text-left">
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
          {assignee && <span>{assignee.name}</span>}
          {p.amountMode === 'variable' && <Badge>сума плаває</Badge>}
          {!p.active && <Badge tone="warn">вимкнено</Badge>}
        </div>
      </button>

      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {envelope && (
          <LinkChip icon="wallet" onClick={() => nav(envelopeRoute(envelope.id))}>{envelope.name}</LinkChip>
        )}
        {fund && (
          <LinkChip icon="piggy" tone="accent" onClick={() => nav(fundRoute(fund.id))}>
            з фонду «{fund.name}»
          </LinkChip>
        )}
        {debt && (
          <LinkChip icon="list" tone="accent" onClick={() => nav(debtRoute(debt.id))}>
            гасить «{debt.name}»
          </LinkChip>
        )}
      </div>
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

function RuleForm({ db, editing, presetEnvelopeId, presetDebtId, onDone }: {
  db: DB; editing: RecurringPlan | null
  presetEnvelopeId?: ID; presetDebtId?: ID
  onDone: () => void
}) {
  // Правило, заведене з конверта або з боргу, уже знає, звідки прийшло —
  // людина щойно там була, питати вдруге немає про що.
  const preset = presetDebtId ? db.debts.find(x => x.id === presetDebtId) : undefined
  const [draft, setDraft] = useState<Draft>(() => editing
    ? toDraft(editing)
    : {
        ...emptyDraft(),
        envelopeId: presetEnvelopeId ?? '',
        debtId: presetDebtId ?? '',
        name: preset ? preset.name : '',
        currency: preset ? preset.currency : 'UAH',
        expectedMinor: preset?.monthlyPaymentMinor ?? 0,
      })
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft(d => ({ ...d, [k]: v }))
  const [initialAnchor] = useState(draft.anchorDate)

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

      <Field label="Очікувана сума" htmlFor="plan-amount">
        <MoneyInput id="plan-amount" valueMinor={draft.expectedMinor} currency={draft.currency}
          onChange={v => set('expectedMinor', v)} />
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

      {/* Обовʼязкове вище: що, куди, скільки і коли. Решта потрібна одиницям
          правил — тож це кнопки «додати», а не шість порожніх полів поспіль. */}
      <OptionalFields items={[
        { key: 'who', label: 'Хто платить', filled: !!draft.assigneeId,
          clear: () => set('assigneeId', ''),
          render: remove => (
            <Field label="Хто платить" htmlFor="plan-who" onRemove={remove}
              hint="Щоб було кого спитати «ти вже оплатив?». Взаєморозрахунків немає.">
              <Select id="plan-who" value={draft.assigneeId} placeholder="Будь-хто"
                options={db.members.map(m => ({ value: m.id, label: m.name }))}
                onChange={v => set('assigneeId', v)} />
            </Field>
          ) },
        // стала сума — типовий випадок, тож перемикач зʼявляється лише на вимогу
        { key: 'mode', label: 'Сума плаває', filled: draft.amountMode !== 'fixed',
          clear: () => set('amountMode', 'fixed'),
          render: remove => (
            <Field label="Сума" onRemove={remove}
              hint={draft.amountMode === 'fixed'
                ? 'Стала: щоразу однакова, як оренда чи підписка.'
                : 'Плаваюча: очікування саме оновиться по медіані останніх шести оплат.'}>
              <Segmented<'fixed' | 'variable'> label="Режим суми" full value={draft.amountMode}
                onChange={v => set('amountMode', v)}
                items={[{ value: 'fixed', label: 'Стала' }, { value: 'variable', label: 'Плаваюча' }]} />
            </Field>
          ) },
        ...(funds.length ? [{ key: 'fund', label: 'Із фонду', filled: !!draft.fundId,
          clear: () => set('fundId', ''),
          render: (remove?: () => void) => (
            <Field label="Фонд-джерело" htmlFor="plan-fund" onRemove={remove}
              hint="Оплата спише гроші з фонду — це не друга витрата.">
              <Select id="plan-fund" value={draft.fundId} placeholder="Без фонду"
                options={funds.map(f => ({ value: f.id, label: f.name }))}
                onChange={v => set('fundId', v)} />
            </Field>
          ) }] : []),
        ...(debts.length ? [{ key: 'debt', label: 'Гасить борг', filled: !!draft.debtId,
          clear: () => set('debtId', ''),
          render: (remove?: () => void) => (
            <Field label="Гасить борг" htmlFor="plan-debt" onRemove={remove}
              hint="Підтвердження платежу зменшить борг — це один запис, а не друга витрата.">
              <Select id="plan-debt" value={draft.debtId} placeholder="Без боргу"
                options={debts.map(x => ({ value: x.id, label: x.name }))}
                onChange={v => set('debtId', v)} />
            </Field>
          ) }] : []),
        { key: 'currency', label: 'Валюта', filled: draft.currency !== 'UAH',
          clear: () => set('currency', 'UAH'),
          render: remove => (
            <Field label="Валюта" onRemove={remove}>
              <Segmented<Currency> label="Валюта" full value={draft.currency}
                onChange={v => set('currency', v)}
                items={[{ value: 'UAH', label: '₴ гривня' }, { value: 'USD', label: '$ долар' }, { value: 'EUR', label: '€ євро' }]} />
            </Field>
          ) },
        // Дата привʼязки має початкове значення, тож «заповнена» вона лише тоді,
        // коли її свідомо змінили в цій формі.
        { key: 'anchor', label: 'Діє з дати', filled: draft.anchorDate !== initialAnchor,
          clear: () => set('anchorDate', initialAnchor),
          render: remove => (
            <Field label="Дата прив’язки" htmlFor="plan-anchor" onRemove={remove}
              hint="З якої дати діє правило. Якщо день не вибрано — він береться звідси.">
              <DateInput id="plan-anchor" value={draft.anchorDate}
                onChange={v => set('anchorDate', v ?? today())} />
            </Field>
          ) },
      ]} />

      {/* для нового правила «активне» завжди так — перемикач там лише шум */}
      {editing && (
        <div className="border-t border-line pt-2 mt-1">
          <Switch checked={draft.active} onChange={v => set('active', v)}
            label="Правило активне"
            hint={draft.active
              ? 'Створює платежі наперед на рік.'
              : 'Майбутні неоплачені платежі приберемо, історію лишимо.'} />
        </div>
      )}

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

      <Field label="Сума" htmlFor="one-amount">
        <MoneyInput id="one-amount" valueMinor={expectedMinor} currency={currency}
          onChange={setExpectedMinor} />
      </Field>

      <Field label="Дата" htmlFor="one-date"
        hint={`Платіж стане в чекліст на ${monthTitle(monthKey(dueDate)).toLowerCase()}.`}>
        <DateInput id="one-date" value={dueDate} onChange={v => setDueDate(v ?? today())} />
      </Field>

      <OptionalFields items={[
        { key: 'who', label: 'Хто платить', filled: !!assigneeId, clear: () => setAssigneeId(''),
          render: remove => (
            <Field label="Хто платить" htmlFor="one-who" onRemove={remove}>
              <Select id="one-who" value={assigneeId} placeholder="Будь-хто"
                options={db.members.map(m => ({ value: m.id, label: m.name }))}
                onChange={setAssigneeId} />
            </Field>
          ) },
        { key: 'currency', label: 'Валюта', filled: currency !== 'UAH', clear: () => setCurrency('UAH'),
          render: remove => (
            <Field label="Валюта" onRemove={remove}>
              <Segmented<Currency> label="Валюта" full value={currency} onChange={setCurrency}
                items={[{ value: 'UAH', label: '₴ гривня' }, { value: 'USD', label: '$ долар' }, { value: 'EUR', label: '€ євро' }]} />
            </Field>
          ) },
      ]} />

      <FormActions onSubmit={submit} onCancel={onDone} disabled={invalid} submitLabel="Додати" />

      <p className="text-[12px] text-faint mt-2">
        Разовий платіж не створює правила: він з’явиться лише в цьому місяці.
      </p>
    </div>
  )
}
