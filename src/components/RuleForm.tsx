import { useState } from 'react'
import {
  ConfirmButton, DateInput, Field, FormActions, Input, MoneyInput, OptionalFields, Pill,
  Segmented, Select, Switch,
} from '../ui'
import {
  addOccurrence, addRecurringPlan, freeProject, removeRecurringPlan, updateRecurringPlan,
} from '../data/store'
import { DOW, ruleText } from '../data/links'
import { isoDow, monthKey, monthTitle, parse, thisMonth, today } from '../lib/dates'
import type { Currency, DB, Freq, ID, Project, RecurringPlan } from '../data/types'

const FREQ_ITEMS: { value: Freq; label: string }[] = [
  { value: 'monthly', label: 'Щомісяця' },
  { value: 'weekly', label: 'Щотижня' },
  { value: 'yearly', label: 'Щороку' },
  { value: 'daily', label: 'Щодня' },
]

const CURRENCIES: { value: Currency; label: string }[] = [
  { value: 'UAH', label: '₴ гривня' }, { value: 'USD', label: '$ долар' }, { value: 'EUR', label: '€ євро' },
]

/** 29–31 числа: у коротких місяцях платіж з'їжджає на останній день. */
function shortMonthNote(freq: Freq, day: number) {
  if (freq !== 'monthly' && freq !== 'yearly') return undefined
  if (day <= 28) return undefined
  return freq === 'monthly'
    ? 'У коротких місяцях платіж стане останнім днем місяця.'
    : 'Якщо такого числа немає — останній день місяця.'
}

/** Проєкти, у які можна поставити платіж: активні, крім «Вільних». */
export function payableProjects(db: DB): Project[] {
  return db.projects
    .filter(p => p.status === 'active' && !p.isFree)
    .sort((a, b) => a.sortOrder - b.sortOrder)
}

type Draft = {
  name: string
  projectId: string
  flow: 'in' | 'out'
  expectedMinor: number
  currency: Currency
  amountMode: 'fixed' | 'variable'
  freq: Freq
  byMonthDay: number
  byDay: number[]
  byMonth: number
  anchorDate: string
  assigneeId: string
  active: boolean
}

function emptyDraft(): Draft {
  const t = today()
  const d = parse(t)
  return {
    name: '', projectId: '', flow: 'out', expectedMinor: 0, currency: 'UAH', amountMode: 'fixed',
    freq: 'monthly', byMonthDay: d.getDate(), byDay: [isoDow(t)], byMonth: d.getMonth() + 1,
    anchorDate: t, assigneeId: '', active: true,
  }
}

function toDraft(p: RecurringPlan): Draft {
  const a = parse(p.anchorDate)
  return {
    name: p.name, projectId: p.projectId, flow: p.flow, expectedMinor: p.expectedMinor,
    currency: p.currency, amountMode: p.amountMode, freq: p.freq,
    byMonthDay: p.byMonthDay ?? a.getDate(),
    byDay: p.byDay?.length ? [...p.byDay] : [isoDow(p.anchorDate)],
    byMonth: p.byMonth ?? a.getMonth() + 1,
    anchorDate: p.anchorDate, assigneeId: p.assigneeId ?? '', active: p.active,
  }
}

/**
 * Регулярне правило: платіж або надходження за розкладом.
 *
 * Правило живе в проєкті. Що оплата робить із грошима, каже проєкт, а не
 * правило: у проєкті «повертати» — гасить борг, у «накопичувати» — витрачає
 * з накопичення, в інших — звичайна витрата. Надходження (зарплата) падає
 * у «Вільні гроші». Тому окремих полів «із фонду» й «гасить борг» немає.
 */
export function RuleForm({ db, editing, projectId, flow, onDone }: {
  db: DB
  editing: RecurringPlan | null
  /** проєкт, з якого відкрили форму — у новому правилі він уже вибраний */
  projectId?: ID
  flow?: 'in' | 'out'
  onDone: () => void
}) {
  const free = freeProject(db)
  const preset = projectId ? db.projects.find(p => p.id === projectId) : undefined
  const [draft, setDraft] = useState<Draft>(() => {
    if (editing) return toDraft(editing)
    const f = flow ?? (preset?.isFree ? 'in' : 'out')
    return {
      ...emptyDraft(),
      flow: f,
      projectId: f === 'in' ? (free?.id ?? '') : (preset && !preset.isFree ? preset.id : ''),
      name: preset?.direction === 'repay' ? preset.name : '',
      currency: preset && !preset.isFree ? preset.currency : 'UAH',
      expectedMinor: preset?.direction === 'repay' ? preset.monthlyMinor ?? 0 : 0,
    }
  })
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft(d => ({ ...d, [k]: v }))
  const [initialAnchor] = useState(draft.anchorDate)

  const projects = payableProjects(db)
  const setFlow = (f: 'in' | 'out') => setDraft(d => ({
    ...d, flow: f,
    projectId: f === 'in' ? (free?.id ?? '') : (d.projectId === free?.id ? '' : d.projectId),
  }))

  const year = Number(thisMonth().slice(0, 4))
  const monthOptions = Array.from({ length: 12 }, (_, i) => ({
    value: String(i + 1),
    label: monthTitle(`${year}-${String(i + 1).padStart(2, '0')}`),
  }))
  const dayOptions = Array.from({ length: 31 }, (_, i) => ({ value: String(i + 1), label: `${i + 1} числа` }))

  const preview: RecurringPlan = {
    id: editing?.id ?? 'preview',
    name: draft.name, projectId: draft.projectId, flow: draft.flow, expectedMinor: draft.expectedMinor,
    currency: draft.currency, amountMode: draft.amountMode, freq: draft.freq,
    byMonthDay: draft.byMonthDay, byDay: draft.byDay, byMonth: draft.byMonth,
    anchorDate: draft.anchorDate, active: draft.active,
  }

  const invalid =
    !draft.name.trim() ||
    !draft.projectId ||
    (draft.amountMode === 'fixed' && draft.expectedMinor <= 0)

  const submit = () => {
    if (invalid) return
    const payload: Omit<RecurringPlan, 'id'> = {
      name: draft.name.trim(),
      projectId: draft.projectId,
      flow: draft.flow,
      expectedMinor: draft.expectedMinor,
      currency: draft.currency,
      amountMode: draft.amountMode,
      freq: draft.freq,
      byMonthDay: draft.freq === 'monthly' || draft.freq === 'yearly' ? draft.byMonthDay : undefined,
      byDay: draft.freq === 'weekly' && draft.byDay.length ? [...draft.byDay].sort((a, b) => a - b) : undefined,
      byMonth: draft.freq === 'yearly' ? draft.byMonth : undefined,
      anchorDate: draft.anchorDate,
      assigneeId: draft.assigneeId || undefined,
      active: draft.active,
    }
    // майбутні платежі перегенерує store — руками occurrences не чіпаємо
    if (editing) updateRecurringPlan(editing.id, payload)
    else addRecurringPlan(payload)
    onDone()
  }

  const note = shortMonthNote(draft.freq, draft.byMonthDay)
  const target = db.projects.find(p => p.id === draft.projectId)

  return (
    <div>
      <div className="rounded-lg bg-surface2 px-3 py-2 mb-3">
        <div className="text-[11.5px] uppercase tracking-wider text-faint">Правило</div>
        <div className="text-[14px]">{ruleText(preview)}</div>
      </div>

      <Field label="Що це">
        <Segmented<'out' | 'in'> label="Напрям" full value={draft.flow} onChange={setFlow}
          items={[{ value: 'out', label: 'Платіж' }, { value: 'in', label: 'Надходження' }]} />
      </Field>

      <Field label="Назва" htmlFor="plan-name">
        <Input id="plan-name" value={draft.name} onChange={v => set('name', v)}
          placeholder={draft.flow === 'in' ? 'Зарплата' : 'Оренда'} autoFocus={!editing} onEnter={submit} />
      </Field>

      {draft.flow === 'out' && (
        <Field label="Проєкт" htmlFor="plan-project"
          hint={target?.direction === 'repay' ? 'Кожна оплата зменшить борг.'
            : target?.direction === 'save' ? 'Оплата витрачає гроші з цього накопичення.'
            : 'Витрата за цим платежем піде в цей проєкт.'}>
          <Select id="plan-project" value={draft.projectId} placeholder="Оберіть проєкт"
            options={projects.map(p => ({ value: p.id, label: p.name }))}
            onChange={v => set('projectId', v)} />
        </Field>
      )}

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

      {/* Обовʼязкове вище: що, куди, скільки і коли. Решта — кнопки «додати». */}
      <OptionalFields items={[
        { key: 'who', label: draft.flow === 'in' ? 'Чиє' : 'Хто платить', filled: !!draft.assigneeId,
          clear: () => set('assigneeId', ''),
          render: remove => (
            <Field label={draft.flow === 'in' ? 'Чиє надходження' : 'Хто платить'} htmlFor="plan-who" onRemove={remove}
              hint={draft.flow === 'in' ? undefined : 'Щоб було кого спитати «ти вже оплатив?». Взаєморозрахунків немає.'}>
              <Select id="plan-who" value={draft.assigneeId} placeholder="Будь-хто"
                options={db.members.map(m => ({ value: m.id, label: m.name }))}
                onChange={v => set('assigneeId', v)} />
            </Field>
          ) },
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
        { key: 'currency', label: 'Валюта', filled: draft.currency !== 'UAH',
          clear: () => set('currency', 'UAH'),
          render: remove => (
            <Field label="Валюта" onRemove={remove}>
              <Segmented<Currency> label="Валюта" full value={draft.currency}
                onChange={v => set('currency', v)} items={CURRENCIES} />
            </Field>
          ) },
        // Дата привʼязки має початкове значення: «заповнена» лише коли її змінили
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
          в історії — цифри за минуле не змінюються.
        </p>
      )}
    </div>
  )
}

/** Платіж без правила: живе тільки в чеклісті свого місяця. */
export function OneOffForm({ db, month, projectId: presetProject, onDone }: {
  db: DB; month: string; projectId?: ID; onDone: () => void
}) {
  const [name, setName] = useState('')
  const [projectId, setProjectId] = useState<string>(presetProject ?? '')
  const [expectedMinor, setExpectedMinor] = useState(0)
  const [currency, setCurrency] = useState<Currency>('UAH')
  const [dueDate, setDueDate] = useState(month === thisMonth() ? today() : `${month}-01`)
  const [assigneeId, setAssigneeId] = useState('')

  const projects = payableProjects(db)
  const invalid = !name.trim() || !projectId || expectedMinor <= 0

  const submit = () => {
    if (invalid) return
    addOccurrence({
      projectId, name: name.trim(), dueDate, expectedMinor, currency,
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

      {!presetProject && (
        <Field label="Проєкт" htmlFor="one-project">
          <Select id="one-project" value={projectId} placeholder="Оберіть проєкт"
            options={projects.map(p => ({ value: p.id, label: p.name }))}
            onChange={setProjectId} />
        </Field>
      )}

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
              <Segmented<Currency> label="Валюта" full value={currency} onChange={setCurrency} items={CURRENCIES} />
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
