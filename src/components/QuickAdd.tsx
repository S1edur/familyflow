import { useMemo, useState } from 'react'
import { AttachButton, Btn, DateInput, Field, Input, Pill, Segmented, Select, Sheet, toast } from '../ui'
import { useDB, addEntry } from '../data/store'
import { SYMBOL, money, parseAmount } from '../lib/money'
import type { Currency, DB, Envelope, EntryKind } from '../data/types'
import { addDays, monthKey, today } from '../lib/dates'

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', ',', '0', '⌫']
type Kind = Extract<EntryKind, 'expense' | 'income'>
const SUGGEST_DAYS = 60
const SUGGEST_MAX = 4
const NNBSP = '\u202F'

// Розряди вузьким пробілом і кома, як у money(): сума на табло не має
// виглядати інакше, ніж та сама сума в списку після запису.
function formatRaw(raw: string): string {
  const [int, frac] = raw.split(',')
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, NNBSP)
  return frac === undefined ? grouped : `${grouped},${frac}`
}

function formatRate(rate: number): string {
  return rate.toLocaleString('uk-UA', { maximumFractionDigits: 4 }).replace(/[\s\u00A0]/g, NNBSP)
}

// Конверти, куди найчастіше пишуть витрати останнім часом. Рахуємо на читанні
// з записів, нічого не зберігаючи (інваріант 4): звичка змінюється — підказки теж.
function suggestEnvelopes(db: DB): Envelope[] {
  const usable = new Map(db.envelopes
    .filter(e => e.kind !== 'income' && !e.archived)
    .map(e => [e.id, e]))
  const since = addDays(today(), -SUGGEST_DAYS)
  const stats = new Map<string, { n: number; last: string }>()
  for (const e of db.entries) {
    if (e.kind !== 'expense' || !e.envelopeId || e.occurredOn < since || !usable.has(e.envelopeId)) continue
    const cur = stats.get(e.envelopeId) ?? { n: 0, last: '' }
    cur.n++
    if (e.occurredOn > cur.last) cur.last = e.occurredOn
    stats.set(e.envelopeId, cur)
  }
  if (stats.size) {
    return [...stats.entries()]
      .sort(([, a], [, b]) => b.n - a.n || b.last.localeCompare(a.last))
      .slice(0, SUGGEST_MAX)
      .map(([id]) => usable.get(id)!)
  }
  // новий дім без історії: змінні витрати — найімовірніше, що пишуть першими
  return [...usable.values()]
    .filter(e => e.kind === 'variable')
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .slice(0, SUGGEST_MAX)
}

export function QuickAdd({ open, onClose }: { open: boolean; onClose: () => void }) {
  const db = useDB()
  const [kind, setKind] = useState<Kind>('expense')
  const [raw, setRaw] = useState('')
  const [currency, setCurrency] = useState<Currency>('UAH')
  const [note, setNote] = useState('')
  const [date, setDate] = useState<string | undefined>(today())

  const spendable = db.envelopes.filter(e => e.kind !== 'income' && !e.archived)
  const incoming = db.envelopes.filter(e => e.kind === 'income' && !e.archived)
  const suggested = useMemo(() => suggestEnvelopes(db), [db.envelopes, db.entries])
  // конверт запам'ятовується окремо для кожного типу: списки не перетинаються
  const [expenseChoice, setExpenseEnv] = useState('')
  const [pickOther, setPickOther] = useState(false)
  const [incomeChoice, setIncomeEnv] = useState('')

  // Вибір скидається при кожному відкритті листа: компонент живе весь час,
  // а конверти до входу в хмару були демо-даними — їхні id у запис іти не мають.
  const [wasOpen, setWasOpen] = useState(false)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setExpenseEnv(suggested[0]?.id ?? spendable[0]?.id ?? '')
      setIncomeEnv(incoming[0]?.id ?? '')
      setPickOther(false)
    }
  }

  // Перевірка на читанні: конверт могли видалити або дані могли замінитись,
  // поки лист відкритий. Витрата без конверта допустима, дохід показує перший
  // наявний — той самий, що бачить людина в Select.
  const expenseEnv = spendable.some(e => e.id === expenseChoice) ? expenseChoice : ''
  const incomeEnv = incoming.some(e => e.id === incomeChoice) ? incomeChoice : incoming[0]?.id ?? ''

  const envelopes = kind === 'income' ? incoming : spendable
  const envelopeId = kind === 'income' ? incomeEnv : expenseEnv
  const setEnvelopeId = kind === 'income' ? setIncomeEnv : setExpenseEnv

  // шаблони: найчастіші трійки (конверт, валюта, сума) з історії витрат.
  // Суму групуємо з точністю до гривні/долара — копійки не роблять запис іншим.
  const presets = useMemo(() => {
    const usable = new Set(db.envelopes.filter(e => e.kind !== 'income' && !e.archived).map(e => e.id))
    const counts = new Map<string, { envelopeId: string; currency: Currency; amount: number; n: number }>()
    for (const e of db.entries) {
      if (e.kind !== 'expense' || !e.envelopeId || !usable.has(e.envelopeId)) continue
      const amount = Math.max(100, Math.round(e.amountMinor / 100) * 100)
      const k = `${e.envelopeId}|${e.currency}|${amount}`
      const cur = counts.get(k) ?? { envelopeId: e.envelopeId, currency: e.currency, amount, n: 0 }
      cur.n++; counts.set(k, cur)
    }
    return [...counts.values()].sort((a, b) => b.n - a.n).slice(0, 4)
  }, [db.entries, db.envelopes])

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
    // оптимістичне оновлення без спінера потребує сліду, інакше незрозуміло,
    // чи взагалі щось сталось: лист закрився і все
    const env = db.envelopes.find(e => e.id === envelopeId)
    toast(`${kind === 'income' ? 'Дохід' : 'Записано'}: ${money(minor, currency)}${env ? ' · ' + env.name : ''}`)
    setRaw(''); setNote(''); setDate(today()); setPickOther(false)
    onClose()
  }

  // підсумок за місяць вибраної дати, а не завжди за поточний
  const month = monthKey(date || today())
  const sumThis = db.entries
    .filter(e => e.kind === kind && monthKey(e.occurredOn) === month
      && (kind === 'income' || e.envelopeId === envelopeId))
    .reduce((s, e) => s + e.amountBaseMinor, 0)

  // вибраний поза підказками теж стає пілюлею — інакше вибір не видно
  const picked = spendable.find(e => e.id === expenseEnv)
  const pills = picked && !suggested.some(e => e.id === picked.id) ? [...suggested, picked] : suggested

  return (
    <Sheet open={open} onClose={onClose} title={kind === 'income' ? 'Дохід' : 'Витрата'}>
      <Segmented value={kind} onChange={setKind} full label="Тип запису" items={[
        { value: 'expense', label: 'Витрата' },
        { value: 'income', label: 'Дохід' },
      ]} />

      <div className="text-center py-3">
        <div className="text-[34px] font-semibold num tracking-tight">
          {raw ? `${formatRaw(raw)} ` : <span className="text-faint">0 </span>}
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
              <Pill key={i}
                onClick={() => { setExpenseEnv(p.envelopeId); setCurrency(p.currency); setRaw(String(p.amount / 100)) }}
                title={`${env?.name}, ${money(p.amount, p.currency)}`}>
                <span className="text-[12.5px]">{env?.name} · <span className="num">{money(p.amount, p.currency)}</span></span>
              </Pill>
            )
          })}
        </div>
      )}

      {kind === 'expense' ? (
        <div className="mb-2">
          <div className="flex gap-1.5 flex-wrap" role="group" aria-label="Конверт">
            {pills.map(e => (
              <Pill key={e.id} active={e.id === expenseEnv}
                // конверт необов'язковий: повторний тап знімає вибір
                onClick={() => setExpenseEnv(cur => (cur === e.id ? '' : e.id))}>
                {e.name}
              </Pill>
            ))}
            {!pickOther && spendable.length > pills.length && (
              <AttachButton onClick={() => setPickOther(true)}>Інший…</AttachButton>
            )}
          </div>
          {pickOther && (
            <div className="mt-1.5">
              <Select value={expenseEnv} placeholder="Без конверта"
                onChange={v => { setExpenseEnv(v); setPickOther(false) }}
                options={spendable.map(e => ({ value: e.id, label: e.name }))} />
            </div>
          )}
        </div>
      ) : (
        <div className="mb-2">
          <Select value={envelopeId} onChange={setEnvelopeId}
            options={envelopes.map(e => ({ value: e.id, label: e.name }))}
            placeholder={envelopes.length ? undefined : 'Конвертів немає'} />
        </div>
      )}

      <div className="flex gap-1.5 mb-2 items-center flex-wrap">
        {(['UAH', 'USD', 'EUR'] as Currency[]).map(c => (
          <Pill key={c} active={currency === c} onClick={() => setCurrency(c)}>{c}</Pill>
        ))}
        {currency !== 'UAH' && (
          <span className="text-[12px] text-faint num ml-1">
            курс {formatRate(db.rates[currency])} → {minor ? money(Math.round(minor * db.rates[currency])) : '—'}
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
          <button key={k} onClick={() => press(k)} aria-label={k === '⌫' ? 'Стерти' : undefined}
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
