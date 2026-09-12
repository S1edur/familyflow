import { useState } from 'react'
import {
  Badge, Btn, Card, ConfirmButton, DateInput, Empty, Field, FormActions, Icon, Input,
  MoneyInput, Pill, SectionTitle, Segmented, Select, Sheet, Stat, Switch,
} from '../ui'
import { useDB, addRecurringPlan, updateRecurringPlan, removeRecurringPlan } from '../data/store'
import { money, toBase } from '../lib/money'
import {
  clampDayOfMonth, iso, isoDow, longDate, monthKey, monthTitle, parse, relativeDue,
  shortDate, thisMonth, today,
} from '../lib/dates'
import type { Currency, DB, Freq, RecurringPlan } from '../data/types'

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
  active: boolean
}

function emptyDraft(): Draft {
  const t = today()
  const d = parse(t)
  return {
    name: '', envelopeId: '', expectedMinor: 0, currency: 'UAH', amountMode: 'fixed',
    freq: 'monthly', byMonthDay: d.getDate(), byDay: [isoDow(t)], byMonth: d.getMonth() + 1,
    anchorDate: t, assigneeId: '', fundId: '', active: true,
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
    assigneeId: p.assigneeId ?? '', fundId: p.fundId ?? '', active: p.active,
  }
}

export default function SettingsPlans() {
  const db = useDB()
  const [editing, setEditing] = useState<RecurringPlan | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)

  const active = db.recurringPlans.filter(p => p.active)
  const inactive = db.recurringPlans.filter(p => !p.active)

  const groups = (() => {
    const byEnvelope = db.envelopes
      .filter(e => !e.archived)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map(e => ({
        key: e.id,
        title: e.name,
        plans: active.filter(p => p.envelopeId === e.id),
      }))
    const known = new Set(db.envelopes.filter(e => !e.archived).map(e => e.id))
    const rest = active.filter(p => !known.has(p.envelopeId))
    const all = [...byEnvelope, ...(rest.length ? [{ key: '__rest', title: 'Без активного конверта', plans: rest }] : [])]
    return all
      .filter(g => g.plans.length)
      .map(g => ({
        ...g,
        plans: [...g.plans].sort((a, b) => {
          const da = nextDue(db, a.id)?.dueDate ?? '9999'
          const dbb = nextDue(db, b.id)?.dueDate ?? '9999'
          return da.localeCompare(dbb) || a.name.localeCompare(b.name, 'uk')
        }),
      }))
  })()

  // скільки ці плани просять цього місяця — похідне, ніде не зберігається
  const monthTotal = db.occurrences
    .filter(o => o.planId && monthKey(o.dueDate) === thisMonth() && o.status !== 'skipped')
    .filter(o => active.some(p => p.id === o.planId))
    .reduce((s, o) => s + toBase(o.expectedMinor, o.currency, db.rates), 0)

  const open = (p: RecurringPlan | null) => {
    setEditing(p)
    setDraft(p ? toDraft(p) : emptyDraft())
  }
  const close = () => { setEditing(null); setDraft(null) }

  return (
    <div className="max-w-[760px] mx-auto pb-10">
      <header className="px-4 pt-5 pb-3 sm:px-6">
        <div className="flex items-center gap-3">
          <h1 className="flex-1 text-[22px] font-semibold tracking-tight">Регулярні платежі</h1>
          {!!db.recurringPlans.length && (
            <Btn variant="ghost" onClick={() => open(null)}>{Icon.plus(16)} Додати</Btn>
          )}
        </div>
        <p className="text-[13px] text-faint mt-1">
          Правило тут — джерело розкладу. Платежі в «Місяці» з нього і беруться.
        </p>

        {!!db.recurringPlans.length && (
          <Card className="mt-3">
            <dl className="grid grid-cols-2 gap-4">
              <Stat label="Активних правил" value={<span>{active.length}</span>} />
              <Stat label="Цього місяця за правилами" value={money(monthTotal)} />
            </dl>
          </Card>
        )}
      </header>

      {!db.recurringPlans.length ? (
        <Empty>
          <div className="max-w-[380px] mx-auto">
            <p>
              Тут живе розклад: оренда 5 числа, інтернет 10 числа, страховка раз на рік.
              Кожне правило саме створює платежі в «Місяці» — нічого не треба заводити руками.
            </p>
            <div className="mt-4">
              <Btn variant="primary" onClick={() => open(null)}>{Icon.plus(16)} Додати правило</Btn>
            </div>
          </div>
        </Empty>
      ) : (
        <div className="px-4 sm:px-6 mt-1">
          {groups.map(g => (
            <section key={g.key}>
              <SectionTitle>{g.title}</SectionTitle>
              <ul className="rounded-xl border border-line bg-surface divide-y divide-line overflow-hidden">
                {g.plans.map(p => <PlanRow key={p.id} db={db} p={p} onEdit={() => open(p)} />)}
              </ul>
            </section>
          ))}

          {!!inactive.length && (
            <section>
              <SectionTitle>Вимкнені</SectionTitle>
              <ul className="rounded-xl border border-line bg-surface divide-y divide-line overflow-hidden">
                {inactive.map(p => <PlanRow key={p.id} db={db} p={p} onEdit={() => open(p)} />)}
              </ul>
              <p className="text-[12px] text-faint mt-2">
                Вимкнене правило не створює нових платежів. Історія оплачених лишається.
              </p>
            </section>
          )}
        </div>
      )}

      <Sheet open={!!draft} onClose={close} title={editing ? editing.name : 'Нове правило'}>
        {draft && (
          <PlanForm
            db={db} draft={draft} setDraft={setDraft} editing={editing}
            onDone={close}
          />
        )}
      </Sheet>
    </div>
  )
}

function PlanRow({ db, p, onEdit }: { db: DB; p: RecurringPlan; onEdit: () => void }) {
  const next = nextDue(db, p.id)
  const assignee = db.members.find(m => m.id === p.assigneeId)
  const fund = db.funds.find(f => f.id === p.fundId)
  const rel = next ? relativeDue(next.dueDate) : undefined
  const overdue = rel?.tone === 'over'

  return (
    <li>
      <button type="button" onClick={onEdit}
        className="w-full text-left px-4 py-2.5 hover:bg-surface2 transition-colors">
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
          {fund && <Badge tone="accent">з фонду «{fund.name}»</Badge>}
          {!p.active && <Badge tone="warn">вимкнено</Badge>}
        </div>
      </button>
    </li>
  )
}

function PlanForm({ db, draft, setDraft, editing, onDone }: {
  db: DB
  draft: Draft
  setDraft: (d: Draft | null) => void
  editing: RecurringPlan | null
  onDone: () => void
}) {
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft({ ...draft, [k]: v })

  const envelopes = db.envelopes
    .filter(e => !e.archived && e.kind !== 'income')
    .sort((a, b) => a.sortOrder - b.sortOrder)
  const funds = db.funds.filter(f => !f.archived)

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
      active: draft.active,
    }
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
