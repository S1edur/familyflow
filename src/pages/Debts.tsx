import { useState, type ReactNode } from 'react'
import {
  Badge, Btn, Card, ConfirmButton, DateInput, Empty, Field, FormActions,
  Icon, IconButton, Input, MoneyInput, Progress, SectionTitle, Select, Sheet,
} from '../ui'
import {
  useDB, debtStatus, debtEnvelopeId, addEntry,
  addDebt, updateDebt, closeDebt, reopenDebt,
} from '../data/store'
import type { Currency, Debt } from '../data/types'
import { money, toBase } from '../lib/money'
import { iso, longDate, shortDate, today } from '../lib/dates'

const CURRENCIES: { value: Currency; label: string }[] = [
  { value: 'UAH', label: 'Гривня ₴' },
  { value: 'USD', label: 'Долар $' },
  { value: 'EUR', label: 'Євро €' },
]

/* ─────────── прогноз ───────────
   Дата закриття — похідне значення, рахуємо на читанні (інваріант 4).
   `payoffAfter` повторює розрахунок із debtStatus, щоб прогноз і порівняння
   з бажаною датою ніколи не розходились. */

/** Дата, коли борг закриється після `months` місячних платежів. */
function payoffAfter(months: number) {
  const dt = new Date()
  dt.setMonth(dt.getMonth() + months)
  return iso(dt)
}

/** Скільки місячних платежів ще вміщується до бажаної дати. 0 — жодного. */
function paymentsUntil(target: string) {
  let k = 0
  while (k < 600 && payoffAfter(k + 1) <= target) k++
  return k
}

interface Plan {
  slots: number | null       // платежів до бажаної дати
  required: number | null    // який платіж потрібен, щоб встигнути
  needed: number | null      // за скільки платежів закриємо зараз
  lateBy: number | null      // на скільки місяців пізніше бажаного
}

function planFor(remaining: number, monthly: number, target?: string): Plan {
  const slots = target ? paymentsUntil(target) : null
  const required = slots === null ? null : slots > 0 ? Math.ceil(remaining / slots) : remaining
  const needed = monthly > 0 ? Math.ceil(remaining / monthly) : null
  const lateBy = needed !== null && slots !== null ? needed - slots : null
  return { slots, required, needed, lateBy }
}

/* ─────────── дрібні шматки розмітки ─────────── */

function Line({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div>
      <div className="text-[11.5px] uppercase tracking-wider text-faint">{label}</div>
      <div className={`text-[14px] num ${muted ? 'text-faint' : ''}`}>{value}</div>
    </div>
  )
}

function Note({ tone = 'quiet', children }: { tone?: 'quiet' | 'warn' | 'good'; children: ReactNode }) {
  const v = {
    quiet: 'bg-surface2 text-muted',
    warn: 'bg-warnSoft text-warn',
    good: 'bg-accentSoft text-accentInk',
  }[tone]
  return <div className={`rounded-lg px-3 py-2 text-[13px] leading-snug ${v}`}>{children}</div>
}

/* ─────────── чернетка форми ─────────── */

interface Draft {
  name: string
  counterparty: string
  principalMinor: number
  currency: Currency
  monthlyPaymentMinor: number
  targetDate?: string
  openedOn: string
}

const blank = (): Draft => ({
  name: '', counterparty: '', principalMinor: 0, currency: 'UAH',
  monthlyPaymentMinor: 0, targetDate: undefined, openedOn: today(),
})

const draftOf = (d: Debt): Draft => ({
  name: d.name,
  counterparty: d.counterparty ?? '',
  principalMinor: d.principalMinor,
  currency: d.currency,
  monthlyPaymentMinor: d.monthlyPaymentMinor ?? 0,
  targetDate: d.targetDate,
  openedOn: d.openedOn,
})

export default function Debts() {
  const db = useDB()

  // редагування / створення
  const [editing, setEditing] = useState<Debt | 'new' | null>(null)
  const [draft, setDraft] = useState<Draft>(blank)
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft(p => ({ ...p, [k]: v }))
  const openNew = () => { setDraft(blank()); setEditing('new') }
  const openEdit = (d: Debt) => { setDraft(draftOf(d)); setEditing(d) }
  const close = () => setEditing(null)

  // внесення платежу
  const [payId, setPayId] = useState<string | null>(null)
  const [payMinor, setPayMinor] = useState(0)
  const paying = payId ? db.debts.find(d => d.id === payId) : null
  const openPay = (d: Debt) => { setPayMinor(d.monthlyPaymentMinor ?? 0); setPayId(d.id) }
  const closePay = () => setPayId(null)

  const submitPayment = () => {
    if (!paying || payMinor <= 0) return
    addEntry({
      kind: 'debt_payment',
      amountMinor: payMinor,
      currency: paying.currency,
      debtId: paying.id,
      // без конверта платіж не потрапить у факт по конверту «Борги» в місяці
      envelopeId: debtEnvelopeId(db),
    })
    closePay()
  }

  const active = db.debts.filter(d => !d.closedOn)
  const closed = db.debts.filter(d => d.closedOn)

  const sortedActive = [...active].sort((a, b) => {
    if (!!a.targetDate !== !!b.targetDate) return a.targetDate ? -1 : 1
    if (a.targetDate && b.targetDate && a.targetDate !== b.targetDate)
      return a.targetDate.localeCompare(b.targetDate)
    return a.name.localeCompare(b.name, 'uk')
  })
  const sortedClosed = [...closed].sort((a, b) => (b.closedOn ?? '').localeCompare(a.closedOn ?? ''))

  // залишки переоцінюються за поточним курсом (інваріант 3)
  const totalBase = active.reduce(
    (s, d) => s + toBase(debtStatus(db, d.id).remaining, d.currency, db.rates), 0)
  const mixed = active.some(d => d.currency !== 'UAH')

  const canSave = draft.name.trim().length > 0 && draft.principalMinor > 0

  const save = () => {
    const patch = {
      name: draft.name.trim(),
      counterparty: draft.counterparty.trim() || undefined,
      principalMinor: draft.principalMinor,
      currency: draft.currency,
      monthlyPaymentMinor: draft.monthlyPaymentMinor || undefined,
      targetDate: draft.targetDate,
      openedOn: draft.openedOn,
    }
    if (editing === 'new') addDebt(patch)
    else if (editing) updateDebt(editing.id, patch)
    close()
  }

  // залишок, від якого рахуємо підказку прямо у формі
  const draftRemaining = editing && editing !== 'new'
    ? Math.max(0, draft.principalMinor - debtStatus(db, editing.id).paid)
    : draft.principalMinor
  const draftPlan = planFor(draftRemaining, draft.monthlyPaymentMinor, draft.targetDate)

  const payingLeft = paying ? debtStatus(db, paying.id).remaining : 0

  return (
    <div className="max-w-[760px] mx-auto pb-8">
      <header className="px-4 pt-3 pb-3 sm:px-6 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] text-muted num">
            {active.length === 0
              ? 'Активних боргів немає'
              : `Лишилось ${mixed ? '≈ ' : ''}${money(totalBase)} у ${active.length} ${active.length === 1 ? 'борзі' : 'боргах'}`}
          </p>
        </div>
        {db.debts.length > 0 && (
          <Btn variant="quiet" onClick={openNew}>{Icon.plus(16)}Додати</Btn>
        )}
      </header>

      {db.debts.length === 0 ? (
        <Empty>
          <p className="max-w-[420px] mx-auto">
            Тут живуть борги: назва, кому, тіло боргу, скільки відкладаємо щомісяця
            і до якої дати хочемо закрити. Покажемо, чи встигаємо, і будемо вести платежі.
          </p>
          <div className="mt-4"><Btn variant="primary" onClick={openNew}>{Icon.plus(16)}Додати борг</Btn></div>
        </Empty>
      ) : (
        <div className="px-0 sm:px-6">
          {sortedActive.length > 0 && <SectionTitle>Активні</SectionTitle>}
          <div className="px-4 sm:px-0 grid gap-3">
            {sortedActive.map(d => {
              const s = debtStatus(db, d.id)
              const monthly = d.monthlyPaymentMinor ?? 0
              const p = planFor(s.remaining, monthly, d.targetDate)
              const autoPlan = db.recurringPlans.find(rp => rp.debtId === d.id && rp.active)
              const payments = db.entries
                .filter(e => e.debtId === d.id && e.kind === 'debt_payment')
                .sort((a, b) => b.occurredOn.localeCompare(a.occurredOn))
              return (
                <Card key={d.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[14.5px] font-medium truncate">{d.name}</div>
                      {d.counterparty && <div className="text-[12.5px] text-faint truncate">{d.counterparty}</div>}
                    </div>
                    <IconButton label="Змінити борг" onClick={() => openEdit(d)}>{Icon.pencil(16)}</IconButton>
                  </div>

                  <div className="text-[26px] font-semibold num mt-1">{money(s.remaining, d.currency)}</div>
                  <div className="text-[12.5px] text-faint num">
                    виплачено {money(s.paid, d.currency)} з {money(d.principalMinor, d.currency)}
                  </div>
                  <div className="mt-2.5"><Progress value={s.progress} height={8} /></div>

                  <div className="mt-3 pt-3 border-t border-line grid gap-2.5">
                    <div className="grid grid-cols-2 gap-3">
                      <Line
                        label="Щомісяця"
                        value={monthly ? money(monthly, d.currency) : 'не задано'}
                        muted={!monthly}
                      />
                      <Line
                        label="Бажано закрити"
                        value={d.targetDate ? longDate(d.targetDate) : 'не задано'}
                        muted={!d.targetDate}
                      />
                      <Line
                        label="Закриємо орієнтовно"
                        value={s.remaining === 0 ? 'уже виплачено' : s.payoff ? longDate(s.payoff) : 'без платежу не порахувати'}
                        muted={!s.payoff && s.remaining > 0}
                      />
                      <Line label="Відкрито" value={longDate(d.openedOn)} muted />
                    </div>

                    {s.remaining === 0 ? (
                      <Note tone="good">Борг виплачено повністю — можна закривати.</Note>
                    ) : !monthly && !d.targetDate ? (
                      <Note>
                        Додайте місячний платіж і бажану дату закриття — покажемо, чи встигаємо
                        і яким мав би бути платіж.
                      </Note>
                    ) : !d.targetDate ? (
                      <Note>Додайте бажану дату закриття — порівняємо з прогнозом.</Note>
                    ) : p.required !== null && !monthly ? (
                      <Note>
                        Щоб закрити до {longDate(d.targetDate)}, треба{' '}
                        <span className="num font-medium">{money(p.required, d.currency)}</span>{' '}
                        {p.slots ? 'на місяць' : 'внести одразу'}.
                      </Note>
                    ) : p.lateBy !== null && p.lateBy <= 0 ? (
                      <Note tone="good">
                        Встигаємо до {longDate(d.targetDate)}
                        {p.lateBy < 0 ? `, із запасом ${-p.lateBy} міс.` : '.'}
                      </Note>
                    ) : p.lateBy !== null && p.required !== null ? (
                      <Note tone="warn">
                        За таким платежем закриємо приблизно на {p.lateBy} міс. пізніше бажаного.
                        Щоб встигнути, це{' '}
                        <span className="num font-medium">{money(p.required, d.currency)}</span>{' '}
                        {p.slots ? 'на місяць' : 'одразу'} — на{' '}
                        <span className="num">{money(p.required - monthly, d.currency)}</span> більше.
                      </Note>
                    ) : null}

                    {autoPlan && (
                      <div className="flex items-center gap-2 text-[12.5px] text-muted">
                        <span className="text-faint shrink-0">{Icon.clock(14)}</span>
                        <span className="min-w-0 truncate">
                          Гаситься автоматично: {autoPlan.name},{' '}
                          <span className="num">{money(autoPlan.expectedMinor, autoPlan.currency)}</span>
                          {' '}— вручну вносити не треба
                        </span>
                      </div>
                    )}

                    <div>
                      <Btn variant={autoPlan ? 'quiet' : 'primary'} onClick={() => openPay(d)}>
                        Внести платіж
                      </Btn>
                    </div>
                  </div>

                  {payments.length > 0 && (
                    <ul className="mt-3 pt-3 border-t border-line space-y-1">
                      {payments.slice(0, 6).map(e => (
                        <li key={e.id} className="flex justify-between text-[12.5px] text-faint num">
                          <span>{shortDate(e.occurredOn)}</span>
                          <span>{money(e.amountMinor, e.currency)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              )
            })}
          </div>

          {sortedClosed.length > 0 && (
            <>
              <SectionTitle>Закриті</SectionTitle>
              <div className="px-4 sm:px-0 grid gap-2">
                {sortedClosed.map(d => (
                  <Card key={d.id}>
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-[14px] truncate">{d.name}</div>
                        <div className="text-[12.5px] text-faint num truncate">
                          {money(d.principalMinor, d.currency)}
                          {d.counterparty ? ` · ${d.counterparty}` : ''}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Badge tone="accent">закрито {d.closedOn ? longDate(d.closedOn) : ''}</Badge>
                        <IconButton label="Змінити борг" onClick={() => openEdit(d)}>{Icon.pencil(16)}</IconButton>
                        <Btn variant="quiet" onClick={() => reopenDebt(d.id)}>Повернути</Btn>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* ─── платіж ─── */}
      <Sheet open={!!paying} onClose={closePay} title={paying?.name}>
        <Field
          label="Сума платежу"
          htmlFor="debt-pay"
          hint={paying ? `Лишилось ${money(payingLeft, paying.currency)}` : undefined}
        >
          <MoneyInput id="debt-pay" size="lg" autoFocus
            valueMinor={payMinor}
            currency={paying?.currency ?? 'UAH'}
            onChange={setPayMinor} />
        </Field>
        <Btn variant="primary" full disabled={payMinor <= 0} onClick={submitPayment}>
          Записати платіж
        </Btn>
      </Sheet>

      {/* ─── створення / редагування ─── */}
      <Sheet open={!!editing} onClose={close} title={editing === 'new' ? 'Новий борг' : 'Борг'}>
        <Field label="Назва" htmlFor="debt-name" hint="Як ви його називаєте між собою">
          <Input id="debt-name" value={draft.name} onChange={v => set('name', v)}
            placeholder="Кредит на авто" autoFocus />
        </Field>

        <Field label="Кому" htmlFor="debt-cp" hint="Банк, людина, магазин — необов'язково">
          <Input id="debt-cp" value={draft.counterparty} onChange={v => set('counterparty', v)}
            placeholder="Мамі" />
        </Field>

        <div className="grid grid-cols-[1fr_auto] gap-3">
          <Field label="Тіло боргу" htmlFor="debt-principal">
            <MoneyInput id="debt-principal" valueMinor={draft.principalMinor}
              currency={draft.currency} onChange={v => set('principalMinor', v)} />
          </Field>
          <Field label="Валюта" htmlFor="debt-currency">
            <Select id="debt-currency" value={draft.currency}
              onChange={v => set('currency', v)} options={CURRENCIES} />
          </Field>
        </div>

        <Field label="Місячний платіж" htmlFor="debt-monthly"
          hint="Скільки відкладаємо щомісяця. Можна лишити порожнім">
          <MoneyInput id="debt-monthly" valueMinor={draft.monthlyPaymentMinor}
            currency={draft.currency} onChange={v => set('monthlyPaymentMinor', v)} />
        </Field>

        <Field label="Бажана дата закриття" htmlFor="debt-target"
          hint="Приблизно — щоб бачити, чи встигаємо">
          <DateInput id="debt-target" value={draft.targetDate} onChange={v => set('targetDate', v)} />
        </Field>

        <Field label="Дата відкриття" htmlFor="debt-opened">
          <DateInput id="debt-opened" value={draft.openedOn}
            onChange={v => set('openedOn', v ?? today())} />
        </Field>

        {draftRemaining > 0 && draft.targetDate && draftPlan.required !== null && (
          draftPlan.lateBy !== null && draftPlan.lateBy > 0 ? (
            <Note tone="warn">
              З платежем {money(draft.monthlyPaymentMinor, draft.currency)} закриємо приблизно
              на {draftPlan.lateBy} міс. пізніше. Щоб встигнути —{' '}
              <span className="num font-medium">{money(draftPlan.required, draft.currency)}</span>{' '}
              {draftPlan.slots ? 'на місяць' : 'одразу'}.
            </Note>
          ) : draftPlan.lateBy !== null ? (
            <Note tone="good">Встигаємо до {longDate(draft.targetDate)}.</Note>
          ) : (
            <Note>
              Щоб закрити до {longDate(draft.targetDate)}, це{' '}
              <span className="num font-medium">{money(draftPlan.required, draft.currency)}</span>{' '}
              {draftPlan.slots ? 'на місяць' : 'одразу'}.
            </Note>
          )
        )}

        <FormActions
          onSubmit={save}
          onCancel={close}
          disabled={!canSave}
          submitLabel={editing === 'new' ? 'Додати борг' : 'Зберегти'}
          destructive={editing && editing !== 'new' ? (
            editing.closedOn
              ? <Btn variant="quiet" onClick={() => { reopenDebt(editing.id); close() }}>Повернути в роботу</Btn>
              : <ConfirmButton variant="quiet" confirmLabel="Закрити?"
                  onConfirm={() => { closeDebt(editing.id); close() }}>Закрити борг</ConfirmButton>
          ) : undefined}
        />
      </Sheet>
    </div>
  )
}
