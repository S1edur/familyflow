import { useState } from 'react'
import {
  Badge, Btn, Card, ConfirmButton, DateInput, Empty, Field, FormActions,
  Icon, IconButton, Input, MoneyInput, Progress, SectionTitle, Segmented, Sheet,
} from '../ui'
import {
  useDB, fundStatus, fundBalance, addFund, updateFund, archiveFund, spendFromFund, addEntry,
} from '../data/store'
import type { Currency, Fund, FundKind } from '../data/types'
import { money } from '../lib/money'
import { monthsUntil, shortDate } from '../lib/dates'

/* ─────────────── словник ─────────────── */

const KINDS: { value: FundKind; label: string; hint: string }[] = [
  { value: 'sinking',   label: 'Нерегулярне', hint: 'Платіж раз на рік або раз на кілька років: страховка, ТО.' },
  { value: 'goal',      label: 'Ціль',        hint: 'Відпустка, покупка, ремонт — збираємо до конкретної суми.' },
  { value: 'emergency', label: 'Подушка',     hint: 'Запас на випадок втрати доходу. Відкладаємо постійно.' },
  { value: 'buffer',    label: 'Буфер',       hint: 'Невеликий запас на місяці, де витрати більші за звичайні.' },
]

const CURRENCIES: { value: Currency; label: string }[] = [
  { value: 'UAH', label: '₴ гривня' },
  { value: 'USD', label: '$ долар' },
  { value: 'EUR', label: '€ євро' },
]

const kindLabel = (k: FundKind) => KINDS.find(x => x.value === k)?.label ?? k

/* ─────────────── чернетка форми ─────────────── */

type Mode = 'goal' | 'fixed'

interface Draft {
  name: string
  kind: FundKind
  currency: Currency
  mode: Mode
  targetMinor: number
  dueDate?: string
  bufferPct: number
  monthlyFixedMinor: number
}

const emptyDraft = (): Draft => ({
  name: '', kind: 'sinking', currency: 'UAH', mode: 'goal',
  targetMinor: 0, dueDate: undefined, bufferPct: 0, monthlyFixedMinor: 0,
})

const draftOf = (f: Fund): Draft => ({
  name: f.name,
  kind: f.kind,
  currency: f.currency,
  mode: f.monthlyFixedMinor ? 'fixed' : 'goal',
  targetMinor: f.targetMinor ?? 0,
  dueDate: f.dueDate,
  bufferPct: f.bufferPct ?? 0,
  monthlyFixedMinor: f.monthlyFixedMinor ?? 0,
})

/**
 * Розрахунок для ще не збереженої чернетки — та сама формула, що й у `fundStatus`,
 * але над полями форми. Збережені фонди рахує тільки `fundStatus`.
 */
function previewOf(d: Draft, balance: number) {
  if (d.mode === 'fixed') {
    return { target: undefined, monthsLeft: 1, required: d.monthlyFixedMinor }
  }
  const target = d.targetMinor ? Math.round(d.targetMinor * (1 + d.bufferPct / 100)) : undefined
  const monthsLeft = monthsUntil(d.dueDate)
  const required = target ? Math.max(0, Math.ceil((target - balance) / monthsLeft / 100) * 100) : 0
  return { target, monthsLeft, required }
}

/** «5 місяців» у правильному відмінку. */
function monthsWord(n: number) {
  const d10 = n % 10, d100 = n % 100
  if (d10 === 1 && d100 !== 11) return `${n} місяць`
  if (d10 >= 2 && d10 <= 4 && (d100 < 12 || d100 > 14)) return `${n} місяці`
  return `${n} місяців`
}

/* ─────────────── екран ─────────────── */

type MoveKind = 'in' | 'out'

export default function Funds() {
  const db = useDB()

  // лист редагування: null = закритий, '' = новий фонд
  const [editId, setEditId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft>(emptyDraft)

  // лист внесення / витрати
  const [moveId, setMoveId] = useState<string | null>(null)
  const [moveKind, setMoveKind] = useState<MoveKind>('in')
  const [moveMinor, setMoveMinor] = useState(0)

  const active = db.funds.filter(f => !f.archived).sort((a, b) => a.priority - b.priority)
  const archived = db.funds.filter(f => f.archived).sort((a, b) => a.priority - b.priority)

  // Валюти не змішуємо: сьогоднішній курс не можна застосовувати до
  // історичних внесків (інваріант 2), тож підсумок окремо по кожній.
  const totals = active.reduce<Partial<Record<Currency, number>>>((acc, f) => {
    acc[f.currency] = (acc[f.currency] ?? 0) + fundStatus(db, f.id).required
    return acc
  }, {})
  const totalLabel = CURRENCIES
    .filter(c => totals[c.value] != null)
    .map(c => money(totals[c.value] ?? 0, c.value))
    .join(' + ')

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft(d => ({ ...d, [k]: v }))

  const openNew = () => { setDraft(emptyDraft()); setEditId('') }
  const openEdit = (f: Fund) => { setDraft(draftOf(f)); setEditId(f.id) }
  const closeEdit = () => setEditId(null)

  const editing = editId ? db.funds.find(f => f.id === editId) : undefined
  const balance = editing ? fundBalance(db, editing.id) : 0
  const preview = previewOf(draft, balance)

  const goal = draft.mode === 'goal'
  const nameOk = draft.name.trim().length > 0
  const amountOk = goal ? draft.targetMinor > 0 : draft.monthlyFixedMinor > 0
  const canSave = nameOk && amountOk

  /** Два режими взаємовиключні: поля чужого режиму гасимо явно. */
  function save() {
    if (!canSave) return
    const shape = {
      name: draft.name.trim(),
      kind: draft.kind,
      currency: draft.currency,
      targetMinor: goal ? draft.targetMinor : undefined,
      dueDate: goal ? draft.dueDate : undefined,
      bufferPct: goal && draft.bufferPct > 0 ? draft.bufferPct : undefined,
      monthlyFixedMinor: goal ? undefined : draft.monthlyFixedMinor,
    }
    if (editing) updateFund(editing.id, shape)
    else addFund(shape)
    closeEdit()
  }

  /** Перенумеровуємо весь список — пріоритет тут це порядок, а не вага. */
  function move(index: number, dir: -1 | 1) {
    const next = active.slice()
    const to = index + dir
    if (to < 0 || to >= next.length) return
    const [f] = next.splice(index, 1)
    next.splice(to, 0, f)
    next.forEach((x, i) => updateFund(x.id, { priority: (i + 1) * 10 }))
  }

  /* ── внесення і витрата ── */

  const moving = moveId ? db.funds.find(f => f.id === moveId) : undefined
  const movingBalance = moving ? fundBalance(db, moving.id) : 0

  const openMove = (f: Fund, kind: MoveKind, required: number) => {
    setMoveId(f.id)
    setMoveKind(kind)
    setMoveMinor(kind === 'in' ? required : 0)
  }
  const closeMove = () => setMoveId(null)

  function commitMove() {
    if (!moving || moveMinor <= 0) return
    if (moveKind === 'in') {
      addEntry({ kind: 'fund_in', amountMinor: moveMinor, currency: moving.currency, fundId: moving.id })
    } else {
      spendFromFund(moving.id, moveMinor)
    }
    closeMove()
  }

  return (
    <div className="max-w-[760px] mx-auto pb-10">
      <header className="px-4 pt-3 pb-3 sm:px-6">
        <p className="text-[13px] text-muted">
          Фонд — це гроші, відкладені наперед на те, що буде пізніше.
          {active.length > 0 && (
            <> Разом цього місяця <span className="num">{totalLabel}</span>.</>
          )}
        </p>
      </header>

      <div className="px-4 sm:px-6">
        <SectionTitle right={
          active.length > 0
            ? <Btn onClick={openNew}>{Icon.plus(16)} Новий фонд</Btn>
            : undefined
        }>
          Активні
        </SectionTitle>

        {active.length > 0 && (
          <p className="text-[12.5px] text-faint mb-2">
            треба цього місяця = (ціль − зібрано) ÷ місяців, що лишились
          </p>
        )}

        {active.length === 0 ? (
          <Empty>
            <p className="max-w-[42ch] mx-auto">
              Тут будуть фонди: страховка, ТО, відпустка, подушка.
              Ставите ціль і дату — застосунок рахує, скільки відкладати щомісяця.
            </p>
            <div className="mt-4">
              <Btn variant="primary" onClick={openNew}>{Icon.plus(16)} Створити фонд</Btn>
            </div>
          </Empty>
        ) : (
          <div className="grid gap-2">
            {active.map((f, i) => {
              const status = fundStatus(db, f.id)
              return (
                <FundCard key={f.id} fund={f} index={i} last={i === active.length - 1}
                          status={status}
                          onEdit={() => openEdit(f)} onMove={dir => move(i, dir)}
                          onPayIn={() => openMove(f, 'in', status.required)}
                          onSpend={() => openMove(f, 'out', 0)} />
              )
            })}
          </div>
        )}

        {archived.length > 0 && (
          <>
            <SectionTitle>Архів</SectionTitle>
            <div className="grid gap-2">
              {archived.map(f => (
                <Card key={f.id} className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-[14.5px] text-muted truncate">{f.name}</div>
                    <div className="text-[12.5px] text-faint num">
                      {money(fundBalance(db, f.id), f.currency)} лишилось у фонді
                    </div>
                  </div>
                  <Btn onClick={() => archiveFund(f.id, false)}>Повернути</Btn>
                </Card>
              ))}
            </div>
            <p className="text-[12.5px] text-faint mt-2">
              Архівний фонд не просить грошей щомісяця, але його записи й залишок зберігаються.
            </p>
          </>
        )}
      </div>

      {/* ── внести у фонд / витратити з фонду ── */}
      <Sheet open={moveId !== null} onClose={closeMove} title={moving?.name}>
        <Field label="Що робимо">
          <Segmented<MoveKind> full label="Напрям руху грошей" value={moveKind}
                               onChange={k => { setMoveKind(k); setMoveMinor(0) }}
                               items={[
                                 { value: 'in',  label: 'Внести' },
                                 { value: 'out', label: 'Витратити' },
                               ]} />
        </Field>

        <Field label="Сума" htmlFor="fund-move"
               hint={moveKind === 'in'
                 ? 'Підставлено внесок цього місяця — суму можна змінити.'
                 : `У фонді зараз ${money(movingBalance, moving?.currency ?? 'UAH')}.`}>
          <MoneyInput id="fund-move" size="lg" autoFocus
                      valueMinor={moveMinor} currency={moving?.currency ?? 'UAH'}
                      onChange={setMoveMinor} />
        </Field>

        {moveKind === 'out' && moveMinor > movingBalance && (
          <p className="text-[12px] text-warn mb-3">
            Це більше, ніж зібрано — залишок фонду піде в мінус.
          </p>
        )}

        <Btn variant="primary" full disabled={moveMinor <= 0} onClick={commitMove}>
          {moveKind === 'in' ? 'Внести у фонд' : 'Витратити з фонду'}
        </Btn>
      </Sheet>

      {/* ── створення і редагування ── */}
      <Sheet open={editId !== null} onClose={closeEdit} title={editing ? editing.name : 'Новий фонд'}>
        <Field label="Назва" htmlFor="fund-name">
          <Input id="fund-name" value={draft.name} onChange={v => set('name', v)}
                 placeholder="Страховка авто" autoFocus={!editing} onEnter={save} />
        </Field>

        <Field label="Вид" hint={KINDS.find(k => k.value === draft.kind)?.hint}>
          <Segmented full label="Вид фонду" value={draft.kind}
                     onChange={v => set('kind', v)}
                     items={KINDS.map(k => ({ value: k.value, label: k.label }))} />
        </Field>

        <Field label="Валюта" hint="Фонд збирається і витрачається в цій валюті.">
          <Segmented full label="Валюта" value={draft.currency}
                     onChange={v => set('currency', v)}
                     items={CURRENCIES.map(c => ({ value: c.value, label: c.label }))} />
        </Field>

        <Field label="Як рахувати внесок"
               hint={goal
                 ? 'Знаємо суму й дату — місячний внесок рахується сам.'
                 : 'Дати немає: просто відкладаємо однакову суму щомісяця.'}>
          <Segmented<Mode> full label="Режим фонду" value={draft.mode}
                           onChange={v => set('mode', v)}
                           items={[
                             { value: 'goal',  label: 'Ціль і дата' },
                             { value: 'fixed', label: 'Сума на місяць' },
                           ]} />
        </Field>

        {goal ? (
          <>
            <Field label="Скільки треба зібрати" htmlFor="fund-target">
              <MoneyInput id="fund-target" valueMinor={draft.targetMinor} currency={draft.currency}
                          onChange={v => set('targetMinor', v)} />
            </Field>

            <Field label="До якої дати" htmlFor="fund-due"
                   hint={draft.dueDate
                     ? `Лишилось ${monthsWord(monthsUntil(draft.dueDate))}, рахуючи цей.`
                     : 'Без дати внесок рахується так, ніби зібрати треба цього ж місяця.'}>
              <DateInput id="fund-due" value={draft.dueDate} onChange={v => set('dueDate', v)} />
            </Field>

            <Field label="Запас, %" htmlFor="fund-buffer"
                   hint="Ціна може зрости. 10% означає, що збираємо на 10% більше за ціль.">
              <Input id="fund-buffer" align="right" inputMode="numeric"
                     value={draft.bufferPct ? String(draft.bufferPct) : ''}
                     placeholder="0"
                     onChange={v => {
                       const n = Math.round(Number(v.replace(/[^\d]/g, '')))
                       set('bufferPct', isFinite(n) ? Math.min(100, n) : 0)
                     }} />
            </Field>
          </>
        ) : (
          <Field label="Відкладати щомісяця" htmlFor="fund-fixed"
                 hint="Стільки фонд просить кожного місяця, без кінцевої дати.">
            <MoneyInput id="fund-fixed" valueMinor={draft.monthlyFixedMinor} currency={draft.currency}
                        onChange={v => set('monthlyFixedMinor', v)} />
          </Field>
        )}

        <Explain draft={draft} balance={balance} preview={preview} />

        <FormActions
          onSubmit={save} onCancel={closeEdit} disabled={!canSave}
          submitLabel={editing ? 'Зберегти' : 'Створити фонд'}
          destructive={editing && !editing.archived
            ? <ConfirmButton variant="quiet" confirmLabel="Точно в архів?"
                             onConfirm={() => { archiveFund(editing.id); closeEdit() }}>
                В архів
              </ConfirmButton>
            : undefined} />
      </Sheet>
    </div>
  )
}

/* ─────────────── картка фонду ─────────────── */

function FundCard({ fund, status, index, last, onEdit, onMove, onPayIn, onSpend }: {
  fund: Fund
  status: ReturnType<typeof fundStatus>
  index: number
  last: boolean
  onEdit: () => void
  onMove: (dir: -1 | 1) => void
  onPayIn: () => void
  onSpend: () => void
}) {
  const { balance, target, monthsLeft, required, progress, onTrack } = status
  const behind = !!target && !onTrack

  return (
    <Card>
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[14.5px] font-medium">{fund.name}</span>
            {/* у сіді є фонд «Подушка» виду emergency, що теж зветься «Подушка» */}
            {kindLabel(fund.kind).toLowerCase() !== fund.name.trim().toLowerCase() &&
              <Badge>{kindLabel(fund.kind)}</Badge>}
            {behind && <Badge tone="warn">відстаємо</Badge>}
          </div>
          <div className="text-[19px] font-semibold num mt-1">
            {money(balance, fund.currency)}
            {target && (
              <span className="text-faint text-[13px] font-normal"> / {money(target, fund.currency)}</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          <IconButton label="Вище в списку" disabled={index === 0} onClick={() => onMove(-1)}>
            <span className="block -rotate-90">{Icon.chev(16)}</span>
          </IconButton>
          <IconButton label="Нижче в списку" disabled={last} onClick={() => onMove(1)}>
            <span className="block rotate-90">{Icon.chev(16)}</span>
          </IconButton>
          <IconButton label={`Змінити фонд «${fund.name}»`} onClick={onEdit}>
            {Icon.pencil(16)}
          </IconButton>
        </div>
      </div>

      {target && (
        <div className="mt-2">
          <Progress value={progress} tone={behind ? 'warn' : 'accent'} />
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[12.5px] text-muted">
        <span className="num">треба {money(required, fund.currency)} / міс</span>
        {fund.dueDate && <span className="num text-faint">до {shortDate(fund.dueDate)}</span>}
        {target && <span className="text-faint">лишилось {monthsWord(monthsLeft)}</span>}
        {fund.monthlyFixedMinor != null && <span className="text-faint">без кінцевої дати</span>}
      </div>

      <Formula fund={fund} balance={balance} target={target} monthsLeft={monthsLeft} required={required} />

      {behind && (
        <p className="text-[12px] text-warn mt-1.5">
          Збираємо повільніше, ніж планували — внесок вище це вже враховує.
        </p>
      )}

      <div className="mt-3 flex gap-2">
        <div className="flex-1"><Btn full onClick={onPayIn}>Внести</Btn></div>
        <Btn variant="quiet" onClick={onSpend}>Витратити</Btn>
      </div>
    </Card>
  )
}

/* ─────────────── звідки взялась цифра ─────────────── */

function Formula({ fund, balance, target, monthsLeft, required }: {
  fund: Fund; balance: number; target?: number; monthsLeft: number; required: number
}) {
  const c = fund.currency
  if (!target) {
    return (
      <p className="text-[12px] text-faint mt-1.5">
        Фіксований внесок: щомісяця відкладаємо <span className="num">{money(required, c)}</span>,
        поки фонд потрібен.
      </p>
    )
  }
  const left = Math.max(0, target - balance)
  return (
    <div className="text-[12px] text-faint mt-1.5 leading-relaxed">
      <div className="num">
        ({money(target, c)} − {money(balance, c)}) ÷ {monthsLeft} = {money(required, c)}
      </div>
      {fund.bufferPct ? (
        <div>
          ціль з запасом: <span className="num">{money(fund.targetMinor ?? 0, c)}</span> + {fund.bufferPct}%
          = <span className="num">{money(target, c)}</span>
        </div>
      ) : null}
      {left === 0 && <div>Зібрано повністю — цього місяця відкладати не треба.</div>}
    </div>
  )
}

/* ─────────────── розрахунок у формі ─────────────── */

function Explain({ draft, balance, preview }: {
  draft: Draft
  balance: number
  preview: { target?: number; monthsLeft: number; required: number }
}) {
  const c = draft.currency
  const { target, monthsLeft, required } = preview

  if (draft.mode === 'fixed') {
    return (
      <div className="rounded-lg bg-surface2 p-3 text-[12.5px] text-muted mt-1">
        <div className="text-[11.5px] uppercase tracking-wider text-faint mb-1">Розрахунок</div>
        {required > 0
          ? <>Щомісяця фонд проситиме <span className="num text-ink">{money(required, c)}</span>. Ціль і дата тут не задаються.</>
          : <>Вкажіть суму, і фонд щомісяця проситиме саме її.</>}
      </div>
    )
  }

  if (!target) {
    return (
      <div className="rounded-lg bg-surface2 p-3 text-[12.5px] text-muted mt-1">
        <div className="text-[11.5px] uppercase tracking-wider text-faint mb-1">Розрахунок</div>
        Вкажіть суму — і побачите, скільки відкладати щомісяця.
      </div>
    )
  }

  return (
    <div className="rounded-lg bg-surface2 p-3 text-[12.5px] text-muted mt-1 leading-relaxed">
      <div className="text-[11.5px] uppercase tracking-wider text-faint mb-1">Розрахунок</div>
      {draft.bufferPct > 0 && (
        <div>
          ціль <span className="num">{money(draft.targetMinor, c)}</span> + запас {draft.bufferPct}%
          = <span className="num">{money(target, c)}</span>
        </div>
      )}
      <div>треба цього місяця = (ціль − зібрано) ÷ місяців, що лишились</div>
      <div className="num">
        ({money(target, c)} − {money(balance, c)}) ÷ {monthsLeft} =
        <span className="text-ink font-medium"> {money(required, c)}</span>
      </div>
      <div className="text-faint mt-1">
        {draft.dueDate
          ? <>Рахуємо {monthsWord(monthsLeft)} разом із поточним — до {shortDate(draft.dueDate)}.</>
          : <>Дати немає, тому рахуємо так, ніби зібрати треба цього місяця.</>}
      </div>
    </div>
  )
}
