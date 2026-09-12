import { useMemo, useState } from 'react'
import { Btn, DateInput, Field, Input, Pill, Segmented, Select, Sheet } from '../ui'
import { useDB, addEntry } from '../data/store'
import { SYMBOL, money, parseAmount } from '../lib/money'
import type { Currency, EntryKind } from '../data/types'
import { monthKey, today } from '../lib/dates'

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', ',', '0', '⌫']
type Kind = Extract<EntryKind, 'expense' | 'income'>

export function QuickAdd({ open, onClose }: { open: boolean; onClose: () => void }) {
  const db = useDB()
  const [kind, setKind] = useState<Kind>('expense')
  const [raw, setRaw] = useState('')
  const [currency, setCurrency] = useState<Currency>('UAH')
  const [note, setNote] = useState('')
  const [date, setDate] = useState<string | undefined>(today())

  const spendable = db.envelopes.filter(e => e.kind !== 'income' && !e.archived)
  const incoming = db.envelopes.filter(e => e.kind === 'income' && !e.archived)
  // конверт запам'ятовується окремо для кожного типу: списки не перетинаються
  const [expenseEnv, setExpenseEnv] = useState(spendable[4]?.id ?? spendable[0]?.id ?? '')
  const [incomeEnv, setIncomeEnv] = useState(incoming[0]?.id ?? '')

  const envelopes = kind === 'income' ? incoming : spendable
  const envelopeId = kind === 'income' ? incomeEnv : expenseEnv
  const setEnvelopeId = kind === 'income' ? setIncomeEnv : setExpenseEnv

  // шаблони: найчастіші пари (конверт, сума) з історії витрат
  const presets = useMemo(() => {
    const counts = new Map<string, { envelopeId: string; amount: number; n: number }>()
    for (const e of db.entries) {
      if (e.kind !== 'expense' || !e.envelopeId) continue
      const k = `${e.envelopeId}|${Math.round(e.amountMinor / 10000) * 10000}`
      const cur = counts.get(k) ?? { envelopeId: e.envelopeId, amount: Math.round(e.amountMinor / 10000) * 10000, n: 0 }
      cur.n++; counts.set(k, cur)
    }
    return [...counts.values()].sort((a, b) => b.n - a.n).slice(0, 4)
  }, [db.entries])

  const minor = parseAmount(raw)
  const press = (k: string) => {
    if (k === '⌫') return setRaw(r => r.slice(0, -1))
    if (k === ',' && raw.includes(',')) return
    setRaw(r => (r + k).slice(0, 12))
  }
  const submit = () => {
    if (!minor) return
    addEntry({
      kind,
      amountMinor: minor,
      currency,
      envelopeId: envelopeId || undefined,
      note: note.trim() || undefined,
      occurredOn: date || today(),
    })
    setRaw(''); setNote(''); setDate(today())
    onClose()
  }

  // підсумок за місяць вибраної дати, а не завжди за поточний
  const month = monthKey(date || today())
  const sumThis = db.entries
    .filter(e => e.kind === kind && monthKey(e.occurredOn) === month
      && (kind === 'income' || e.envelopeId === envelopeId))
    .reduce((s, e) => s + e.amountBaseMinor, 0)

  return (
    <Sheet open={open} onClose={onClose} title={kind === 'income' ? 'Дохід' : 'Витрата'}>
      <Segmented value={kind} onChange={setKind} full label="Тип запису" items={[
        { value: 'expense', label: 'Витрата' },
        { value: 'income', label: 'Дохід' },
      ]} />

      <div className="text-center py-3">
        <div className="text-[34px] font-semibold num tracking-tight">
          {raw ? `${raw} ` : <span className="text-faint">0 </span>}
          <span className="text-muted text-[24px]">{SYMBOL[currency]}</span>
        </div>
        <div className="text-[12.5px] text-faint mt-0.5">
          {kind === 'income'
            ? <>дохід цього місяця — {money(sumThis)}</>
            : <>у цьому місяці на цей конверт — {money(sumThis)}</>}
        </div>
      </div>

      {kind === 'expense' && presets.length > 0 && !raw && (
        <div className="flex gap-1.5 flex-wrap justify-center mb-3">
          {presets.map((p, i) => {
            const env = db.envelopes.find(e => e.id === p.envelopeId)
            return (
              <Pill key={i} onClick={() => { setExpenseEnv(p.envelopeId); setRaw(String(p.amount / 100)) }}
                title={`${env?.name}, ${money(p.amount)}`}>
                <span className="text-[12.5px]">{env?.name} · <span className="num">{p.amount / 100}</span></span>
              </Pill>
            )
          })}
        </div>
      )}

      <div className="mb-2">
        <Select value={envelopeId} onChange={setEnvelopeId}
          options={envelopes.map(e => ({ value: e.id, label: e.name }))}
          placeholder={envelopes.length ? undefined : 'Конвертів немає'} />
      </div>

      <div className="flex gap-1.5 mb-2 items-center flex-wrap">
        {(['UAH', 'USD', 'EUR'] as Currency[]).map(c => (
          <Pill key={c} active={currency === c} onClick={() => setCurrency(c)}>{c}</Pill>
        ))}
        {currency !== 'UAH' && (
          <span className="text-[12px] text-faint num ml-1">
            курс {db.rates[currency]} → {minor ? money(Math.round(minor * db.rates[currency])) : '—'}
          </span>
        )}
      </div>

      <div className="grid grid-cols-[1fr_auto] gap-2 items-start">
        <Field label="Нотатка" htmlFor="qa-note">
          <Input id="qa-note" value={note} onChange={setNote} placeholder="Необов’язково" onEnter={submit} />
        </Field>
        <Field label="Дата" htmlFor="qa-date">
          <DateInput id="qa-date" value={date} onChange={setDate} />
        </Field>
      </div>

      <div className="grid grid-cols-3 gap-1.5">
        {KEYS.map(k => (
          <button key={k} onClick={() => press(k)}
            className="h-13 py-3.5 rounded-lg bg-surface2 text-[19px] font-medium num active:opacity-70">
            {k}
          </button>
        ))}
      </div>

      <div className="mt-3">
        <Btn variant="primary" full onClick={submit} disabled={!minor}>Записати</Btn>
      </div>
    </Sheet>
  )
}
