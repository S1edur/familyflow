import { useEffect, useState, type ReactNode } from 'react'
import {
  Btn, ConfirmButton, DateInput, Field, FormActions, Input, MoneyInput, OptionalFields,
  Pill, Segmented, Select, Textarea, toast,
} from '../ui'
import { addProject, projectStatus, setProjectStatus, updateProject } from '../data/store'
import { money, toBase } from '../lib/money'
import { iso, monthsUntil, parse, shortDate, today } from '../lib/dates'
import type { Currency, DB, ID, Project, ProjectDirection, ProjectStatus } from '../data/types'

/* ─────────────── словник, спільний для списку й сторінки проєкту ─────────────── */

export const DIRECTIONS: { value: ProjectDirection; label: string; badge: string }[] = [
  { value: 'spend', label: 'Витрачати', badge: 'витрачати' },
  { value: 'save', label: 'Накопичувати', badge: 'накопичувати' },
  { value: 'repay', label: 'Повертати', badge: 'повертати' },
  { value: 'none', label: 'Без грошей', badge: 'без грошей' },
]

const CURRENCIES: { value: Currency; label: string }[] = [
  { value: 'UAH', label: '₴ гривня' }, { value: 'USD', label: '$ долар' }, { value: 'EUR', label: '€ євро' },
]

/** «5 місяців» у правильному відмінку. */
export function monthsWord(n: number) {
  const d10 = n % 10, d100 = n % 100
  if (d10 === 1 && d100 !== 11) return `${n} місяць`
  if (d10 >= 2 && d10 <= 4 && (d100 < 12 || d100 > 14)) return `${n} місяці`
  return `${n} місяців`
}

/** «3 відкриті задачі» у правильному відмінку. */
export function tasksWord(n: number) {
  const d10 = n % 10, d100 = n % 100
  if (d10 === 1 && d100 !== 11) return `${n} відкрита задача`
  if (d10 >= 2 && d10 <= 4 && (d100 < 12 || d100 > 14)) return `${n} відкриті задачі`
  return `${n} відкритих задач`
}

/** «лис 2027» — для прогнозу закриття точність до місяця чесніша за день. */
export function monthYear(isoDate: string) {
  return `${shortDate(isoDate).split(' ')[1]} ${isoDate.slice(0, 4)}`
}

/**
 * Дата закриття після `months` щомісячних платежів. Та сама арифметика, що
 * в `projectStatus`, щоб прогноз у формі й на сторінці не розходились.
 */
function payoffAfter(months: number) {
  const dt = parse(today())
  dt.setMonth(dt.getMonth() + months)
  return iso(dt)
}

/** Скільки щомісячних платежів уміщується до дати. */
function paymentsUntil(target: string) {
  let k = 0
  while (k < 600 && payoffAfter(k + 1) <= target) k++
  return k
}

/**
 * Орієнтир spend-проєкту в базовій валюті. Факт `projectStatus` рахує в базовій,
 * а `monthlyMinor`/`targetMinor` лежать у валюті проєкту — порівнювати їх
 * напряму можна лише для гривневого проєкту.
 */
export function spendGuide(db: DB, p: Project): { base: number; whole: boolean } {
  const whole = !!p.targetMinor && !p.monthlyMinor
  const raw = whole ? p.targetMinor! : p.monthlyMinor ?? 0
  return { base: toBase(raw, p.currency, db.rates), whole }
}

/* ─────────────── чернетка ─────────────── */

type SaveMode = 'goal' | 'fixed'

interface Draft {
  name: string
  description: string
  direction: ProjectDirection
  currency: Currency
  endsOn?: string
  targetMinor: number
  monthlyMinor: number
  bufferPct: number
  counterparty: string
  sourceProjectId: string
  ownerId: string
  pinned: boolean
  saveMode: SaveMode
}

function draftOf(p: Partial<Project>): Draft {
  return {
    name: p.name ?? '',
    description: p.description ?? '',
    direction: p.direction ?? 'spend',
    currency: p.currency ?? 'UAH',
    endsOn: p.endsOn,
    targetMinor: p.targetMinor ?? 0,
    monthlyMinor: p.monthlyMinor ?? 0,
    bufferPct: p.bufferPct ?? 0,
    counterparty: p.counterparty ?? '',
    sourceProjectId: p.sourceProjectId ?? '',
    ownerId: p.ownerId ?? '',
    pinned: !!p.pinned,
    // фіксований внесок перекриває ціль у projectStatus — так само й тут
    saveMode: p.monthlyMinor || ('monthlyMinor' in p && !('targetMinor' in p)) ? 'fixed' : 'goal',
  }
}

/** Лишаємо лише поля, що мають сенс для напряму: решта стирається явно. */
function shapeOf(d: Draft): Omit<Project, 'id' | 'sortOrder' | 'status' | 'isFree'> {
  const spend = d.direction === 'spend', save = d.direction === 'save', repay = d.direction === 'repay'
  const goal = save && d.saveMode === 'goal'
  return {
    name: d.name.trim(),
    description: d.description.trim() || undefined,
    direction: d.direction,
    currency: d.currency,
    endsOn: d.endsOn,
    targetMinor: (spend || goal || repay) && d.targetMinor > 0 ? d.targetMinor : undefined,
    monthlyMinor: (spend || repay || (save && !goal)) && d.monthlyMinor > 0 ? d.monthlyMinor : undefined,
    bufferPct: goal && d.bufferPct > 0 ? d.bufferPct : undefined,
    counterparty: repay ? d.counterparty.trim() || undefined : undefined,
    sourceProjectId: (spend || repay) && d.sourceProjectId ? d.sourceProjectId : undefined,
    ownerId: d.ownerId || undefined,
    pinned: d.pinned || undefined,
  }
}

/* ─────────────── форма ─────────────── */

/**
 * Створення й редагування проєкту.
 *
 * Обовʼязкове видно завжди й залежить від напряму; решта — кнопками «Додати».
 * `template` лише передзаповнює поля; ключ, присутній у шаблоні навіть
 * без значення (`endsOn: undefined`), одразу розгортає відповідне поле —
 * «Разовий бюджет» без видимого бюджету був би звичайними витратами.
 */
export function ProjectForm({ db, editing, template, onDone }: {
  db: DB
  editing: Project | null
  template?: Partial<Project>
  onDone: (id?: ID) => void
}) {
  const [d, setD] = useState<Draft>(() => draftOf(editing ?? template ?? {}))
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD(x => ({ ...x, [k]: v }))
  const [seeded, setSeeded] = useState<Set<string>>(() => new Set(
    editing || !template ? [] : [
      'endsOn' in template && 'ends',
      'targetMinor' in template && template.direction === 'spend' && 'budget',
      'ownerId' in template && 'owner',
    ].filter((k): k is string => !!k),
  ))
  const unseed = (k: string) => setSeeded(s => { const n = new Set(s); n.delete(k); return n })

  // Проєкт змінився ззовні (інша вкладка, партнер) — форму не перезаписуємо:
  // людина могла вже почати правити. Нова чернетка — лише для іншого проєкту.
  const editingId = editing?.id
  useEffect(() => {
    if (editing) setD(draftOf(editing))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId])

  const isFree = !!editing?.isFree
  const { direction: dir, currency: c } = d
  const goal = dir === 'save' && d.saveMode === 'goal'

  const invalid = !d.name.trim() || (!isFree && (
    (goal && d.targetMinor <= 0) ||
    (dir === 'save' && !goal && d.monthlyMinor <= 0) ||
    (dir === 'repay' && d.targetMinor <= 0)
  ))

  const submit = () => {
    if (invalid) return
    if (isFree && editing) {
      updateProject(editing.id, { name: d.name.trim(), description: d.description.trim() || undefined })
      toast('Збережено')
      onDone(editing.id)
      return
    }
    const shape = shapeOf(d)
    // форма редагування лишається на місці — без тосту не видно, що зберіглось
    if (editing) { updateProject(editing.id, shape); toast('Збережено'); onDone(editing.id) }
    else onDone(addProject(shape))
  }

  const state = editing && !isFree ? projectStatus(db, editing.id) : undefined

  // накопичення, з яких можна платити: активні, у тій самій валюті, не цей
  const sources = db.projects
    .filter(p => p.direction === 'save' && p.status === 'active' && !p.isFree
      && p.currency === c && p.id !== editing?.id)
    .sort((a, b) => a.sortOrder - b.sortOrder)

  const optional = isFree ? [] : [
    { key: 'description', label: 'Опис', filled: !!d.description, clear: () => set('description', ''),
      render: (remove?: () => void) => (
        <Field label="Опис" htmlFor="pr-desc" onRemove={remove}>
          <Textarea id="pr-desc" rows={2} value={d.description} onChange={v => set('description', v)} />
        </Field>
      ) },
    { key: 'ends', label: dir === 'repay' ? 'Бажана дата' : 'До якої дати',
      filled: !!d.endsOn || seeded.has('ends'),
      clear: () => { set('endsOn', undefined); unseed('ends') },
      render: (remove?: () => void) => (
        <Field label={dir === 'repay' ? 'Закрити до' : 'До якої дати'} htmlFor="pr-ends" onRemove={remove}
          hint={dir === 'save' && goal
            ? d.endsOn ? `Лишилось ${monthsWord(monthsUntil(d.endsOn))}, рахуючи цей.` : 'Без дати внесок рахується так, ніби зібрати треба цього місяця.'
            : dir === 'repay' ? 'Порівняємо з прогнозом закриття.'
            : 'Порожнє — проєкт безстроковий.'}>
          <DateInput id="pr-ends" value={d.endsOn} onChange={v => set('endsOn', v)} />
        </Field>
      ) },
    ...(dir === 'spend' ? [{
      key: 'budget', label: 'Бюджет на весь час', filled: d.targetMinor > 0 || seeded.has('budget'),
      clear: () => { set('targetMinor', 0); unseed('budget') },
      render: (remove?: () => void) => (
        <Field label="Бюджет на весь час" htmlFor="pr-budget" onRemove={remove}
          hint="Для ремонту чи переїзду: скільки всього можна витратити. Без орієнтира на місяць порівнюємо з ним.">
          <MoneyInput id="pr-budget" valueMinor={d.targetMinor} currency={c} onChange={v => set('targetMinor', v)} />
        </Field>
      ),
    }] : []),
    ...(goal ? [{
      key: 'buffer', label: 'Запас, %', filled: d.bufferPct > 0, clear: () => set('bufferPct', 0),
      render: (remove?: () => void) => (
        <Field label="Запас, %" htmlFor="pr-buffer" onRemove={remove}
          hint="Ціна може зрости. 10% — збираємо на 10% більше за ціль.">
          <Input id="pr-buffer" align="right" inputMode="numeric" placeholder="0"
            value={d.bufferPct ? String(d.bufferPct) : ''}
            onChange={v => {
              const n = Math.round(Number(v.replace(/[^\d]/g, '')))
              set('bufferPct', isFinite(n) ? Math.min(100, n) : 0)
            }} />
        </Field>
      ),
    }] : []),
    ...(dir === 'repay' ? [{
      key: 'counterparty', label: 'Кому', filled: !!d.counterparty, clear: () => set('counterparty', ''),
      render: (remove?: () => void) => (
        <Field label="Кому винні" htmlFor="pr-cp" onRemove={remove}>
          <Input id="pr-cp" value={d.counterparty} onChange={v => set('counterparty', v)} placeholder="Банк, батьки" />
        </Field>
      ),
    }] : []),
    ...((dir === 'spend' || dir === 'repay') ? [{
      key: 'source', label: 'Платити з накопичення', filled: !!d.sourceProjectId, clear: () => set('sourceProjectId', ''),
      render: (remove?: () => void) => (
        <Field label="Платити з накопичення" htmlFor="pr-source" onRemove={remove}
          hint={sources.length
            ? 'Витрати зменшуватимуть це накопичення, а не вільні гроші.'
            : `Немає активних накопичень у валюті ${c}.`}>
          <Select id="pr-source" value={d.sourceProjectId} placeholder="Вільні гроші"
            options={sources.map(p => ({ value: p.id, label: p.name }))}
            onChange={v => set('sourceProjectId', v)} />
        </Field>
      ),
    }] : []),
    { key: 'currency', label: 'Валюта', filled: c !== 'UAH',
      clear: () => setD(x => ({ ...x, currency: 'UAH', sourceProjectId: '' })),
      render: (remove?: () => void) => (
        <Field label="Валюта" onRemove={remove}
          hint={editing ? 'Записи, уже зроблені, лишаються у своїй валюті.' : undefined}>
          {/* джерело в іншій валюті вже не підходить — скидаємо разом */}
          <Segmented<Currency> label="Валюта" full value={c} items={CURRENCIES}
            onChange={v => setD(x => ({ ...x, currency: v, sourceProjectId: '' }))} />
        </Field>
      ) },
    { key: 'owner', label: 'Власник', filled: !!d.ownerId || seeded.has('owner'),
      clear: () => { set('ownerId', ''); unseed('owner') },
      render: (remove?: () => void) => (
        <Field label="Чий проєкт" htmlFor="pr-owner" onRemove={remove}
          hint="Особисте — лише мітка. Бачать і редагують однаково обоє.">
          <Select id="pr-owner" value={d.ownerId} placeholder="Спільний"
            options={db.members.map(m => ({ value: m.id, label: m.name }))}
            onChange={v => set('ownerId', v)} />
        </Field>
      ) },
    { key: 'pinned', label: 'Закріпити', filled: d.pinned, clear: () => set('pinned', false),
      render: (remove?: () => void) => <PinnedField onOn={() => set('pinned', true)} onRemove={remove} /> },
  ]

  const status = editing?.status
  const changeStatus = (next: ProjectStatus, text: string) => {
    if (!editing) return
    setProjectStatus(editing.id, next)
    // без «Скасувати»: завершення вимикає правила й прибирає майбутні платежі,
    // повернення статусу їх не відновить — тож захист тут двотапова кнопка
    toast(text)
    onDone(editing.id)
  }
  const statusActions = editing && !isFree ? (
    status === 'active' ? (
      <>
        <ConfirmButton variant="quiet" confirmLabel="Завершити?"
          onConfirm={() => changeStatus('done', 'Проєкт завершено')}>Завершити</ConfirmButton>
        <ConfirmButton variant="quiet" confirmLabel="В архів?"
          onConfirm={() => changeStatus('archived', 'Проєкт в архіві')}>В архів</ConfirmButton>
      </>
    ) : (
      <Btn variant="quiet" onClick={() => changeStatus('active', 'Проєкт знову в роботі')}>
        Повернути в роботу
      </Btn>
    )
  ) : undefined

  return (
    <div>
      <Field label="Назва" htmlFor="pr-name">
        <Input id="pr-name" value={d.name} onChange={v => set('name', v)} onEnter={submit}
          autoFocus={!editing} placeholder={PLACEHOLDER[dir]} />
      </Field>

      {!isFree && (
        <Field label="Напрям" hint={DIR_HINT[dir]}>
          {/* чотири варіанти в один Segmented на 375px не вміщуються — сітка 2×2 */}
          <div role="radiogroup" aria-label="Напрям" className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
            {DIRECTIONS.map(x => (
              <Pill key={x.value} active={dir === x.value} onClick={() => set('direction', x.value)}>
                {x.label}
              </Pill>
            ))}
          </div>
        </Field>
      )}

      {!isFree && dir === 'spend' && (
        <Field label="Орієнтир на місяць" htmlFor="pr-monthly"
          hint="Орієнтир, не ліміт: перевищення лише покажемо бурштиновим. Можна лишити 0.">
          <MoneyInput id="pr-monthly" valueMinor={d.monthlyMinor} currency={c} onChange={v => set('monthlyMinor', v)} />
        </Field>
      )}

      {!isFree && dir === 'save' && (
        <>
          <Field label="Як рахувати внесок"
            hint={goal ? 'Знаємо суму й дату — внесок на місяць рахується сам.' : 'Дати немає: відкладаємо однакову суму щомісяця.'}>
            <Segmented<SaveMode> label="Режим накопичення" full value={d.saveMode} onChange={v => set('saveMode', v)}
              items={[{ value: 'goal', label: 'Ціль і дата' }, { value: 'fixed', label: 'Сума на місяць' }]} />
          </Field>
          {goal ? (
            <Field label="Скільки треба зібрати" htmlFor="pr-target">
              <MoneyInput id="pr-target" valueMinor={d.targetMinor} currency={c} onChange={v => set('targetMinor', v)} />
            </Field>
          ) : (
            <Field label="Відкладати щомісяця" htmlFor="pr-fixed">
              <MoneyInput id="pr-fixed" valueMinor={d.monthlyMinor} currency={c} onChange={v => set('monthlyMinor', v)} />
            </Field>
          )}
        </>
      )}

      {!isFree && dir === 'repay' && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Скільки винні" htmlFor="pr-debt">
            <MoneyInput id="pr-debt" valueMinor={d.targetMinor} currency={c} onChange={v => set('targetMinor', v)} />
          </Field>
          <Field label="Платимо щомісяця" htmlFor="pr-pay">
            <MoneyInput id="pr-pay" valueMinor={d.monthlyMinor} currency={c} onChange={v => set('monthlyMinor', v)} />
          </Field>
        </div>
      )}

      <OptionalFields items={optional} />

      {!isFree && dir === 'save' && <SaveExplain d={d} balance={state?.balance ?? 0} />}
      {!isFree && dir === 'repay' && (
        // сплачене вже стоїть у записах: форма рахує залишок від нового тіла боргу
        <RepayExplain d={d} paid={state?.target != null ? state.target - (state.remaining ?? 0) : 0} />
      )}
      {isFree && (
        <p className="text-[12.5px] text-faint mb-2">
          «Вільні гроші» — системний проєкт: сюди падають надходження, звідси відкладаємо в накопичення.
          Напрям і статус не змінюються.
        </p>
      )}

      <FormActions onSubmit={submit} onCancel={editing ? undefined : () => onDone()} disabled={invalid}
        submitLabel={editing ? 'Зберегти' : 'Створити'} destructive={statusActions} />
      {editing && !isFree && status !== 'active' && (
        <p className="text-[12px] text-faint mt-2">
          Коли проєкт завершили, його правила вимкнулись. Повернувши в роботу, увімкніть потрібні у вкладці «Платежі».
        </p>
      )}
    </div>
  )
}

const PLACEHOLDER: Record<ProjectDirection, string> = {
  spend: 'Продукти', save: 'Відпустка', repay: 'Кредит на авто', none: 'Документи на авто',
}

const DIR_HINT: Record<ProjectDirection, string> = {
  spend: 'Куди йдуть гроші: факт порівнюємо з орієнтиром.',
  save: 'Відкладаємо наперед — застосунок підкаже, скільки цього місяця.',
  repay: 'Борг: кожен платіж зменшує залишок.',
  none: 'Лише задачі, без грошей.',
}

/**
 * «Закріпити» — вмикач без другого тапу: кнопка «Додати · Закріпити» сама і є
 * дією, тож поле, що зʼявилось вимкненим, вимагало б ще одного натискання.
 */
function PinnedField({ onOn, onRemove }: { onOn: () => void; onRemove?: () => void }) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { onOn() }, [])
  return (
    <Field label="Закріплено" onRemove={onRemove}>
      <div className="text-[13px] text-muted">Показується першим у своїй групі.</div>
    </Field>
  )
}

function Explain({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg bg-surface2 p-3 text-[12.5px] text-muted mt-1 mb-1 leading-relaxed">
      <div className="text-[11.5px] uppercase tracking-wider text-faint mb-1">Розрахунок</div>
      {children}
    </div>
  )
}

/** Та сама формула, що в `projectStatus`, але над ще не збереженою чернеткою. */
function SaveExplain({ d, balance }: { d: Draft; balance: number }) {
  const c = d.currency
  if (d.saveMode === 'fixed') {
    return (
      <Explain>
        {d.monthlyMinor > 0
          ? <>Щомісяця нагадаємо відкласти <span className="num text-ink">{money(d.monthlyMinor, c)}</span>.</>
          : <>Вкажіть суму — і щомісяця підкажемо відкласти саме її.</>}
      </Explain>
    )
  }
  if (!d.targetMinor) return <Explain>Вкажіть суму — і побачите, скільки відкладати щомісяця.</Explain>

  const target = Math.round(d.targetMinor * (1 + d.bufferPct / 100))
  const months = monthsUntil(d.endsOn)
  const required = Math.max(0, Math.ceil((target - balance) / months / 100) * 100)
  return (
    <Explain>
      {d.bufferPct > 0 && (
        <div className="num">
          ціль {money(d.targetMinor, c)} + запас {d.bufferPct}% = {money(target, c)}
        </div>
      )}
      <div>треба на місяць = (ціль − зібрано) ÷ місяців, що лишились</div>
      <div className="num">
        ({money(target, c)} {balance < 0 ? '+' : '−'} {money(Math.abs(balance), c)}) ÷ {months} =
        <span className="text-ink font-medium"> {money(required, c)}</span>
      </div>
      <div className="text-faint mt-1">
        {d.endsOn
          ? <>Рахуємо {monthsWord(months)} разом із поточним — до {shortDate(d.endsOn)}.</>
          : <>Дати немає, тому рахуємо так, ніби зібрати треба цього місяця.</>}
      </div>
    </Explain>
  )
}

function RepayExplain({ d, paid }: { d: Draft; paid: number }) {
  const c = d.currency
  const remaining = Math.max(0, d.targetMinor - paid)
  if (!d.targetMinor) return <Explain>Вкажіть, скільки винні, — порахуємо, коли закриємо.</Explain>
  if (remaining === 0) return <Explain>Уже виплачено повністю.</Explain>
  if (!d.monthlyMinor) {
    return <Explain>Лишилось <span className="num text-ink">{money(remaining, c)}</span>. Вкажіть платіж на місяць — порахуємо дату закриття.</Explain>
  }
  const needed = Math.ceil(remaining / d.monthlyMinor)
  const payoff = payoffAfter(needed)
  const slots = d.endsOn ? paymentsUntil(d.endsOn) : null
  const lateBy = slots !== null ? needed - slots : null
  const requiredToMeet = slots ? Math.ceil(remaining / slots / 100) * 100 : remaining
  return (
    <Explain>
      <div className="num">
        {paid > 0 && <>сплачено {money(paid, c)} · </>}лишилось {money(remaining, c)}
      </div>
      <div>
        {monthsWord(needed)} по <span className="num">{money(d.monthlyMinor, c)}</span> — закриємо ~
        <span className="text-ink font-medium"> {monthYear(payoff)}</span>.
      </div>
      {d.endsOn && lateBy !== null && (lateBy > 0
        ? <div className="text-warn mt-1">
            Це на {lateBy} міс. пізніше бажаного. Щоб встигнути до {shortDate(d.endsOn)} —{' '}
            <span className="num font-medium">{money(requiredToMeet, c)}</span> {slots ? 'на місяць' : 'одразу'}.
          </div>
        : <div className="text-faint mt-1">Встигаємо до {shortDate(d.endsOn)}.</div>)}
    </Explain>
  )
}
