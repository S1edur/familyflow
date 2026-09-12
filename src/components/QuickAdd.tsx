import { useMemo, useState } from 'react'
import { Sheet, Btn } from './ui'
import { useDB, addEntry } from '../data/store'
import { money, parseAmount } from '../lib/money'
import type { Currency } from '../data/types'
import { monthKey, today } from '../lib/dates'

const KEYS = ['1','2','3','4','5','6','7','8','9',',','0','⌫']

export function QuickAdd({ open, onClose }: { open: boolean; onClose: () => void }) {
  const db = useDB()
  const [raw, setRaw] = useState('')
  const [currency, setCurrency] = useState<Currency>('UAH')
  const spendable = db.envelopes.filter(e => e.kind !== 'income' && !e.archived)
  const [envelopeId, setEnvelopeId] = useState(spendable[4]?.id ?? spendable[0].id)

  // шаблони: найчастіші пари (конверт, сума) за 60 днів
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
    addEntry({ kind: 'expense', amountMinor: minor, currency, envelopeId })
    setRaw(''); onClose()
  }

  const spentThis = db.entries
    .filter(e => e.kind === 'expense' && e.envelopeId === envelopeId && monthKey(e.occurredOn) === monthKey(today()))
    .reduce((s, e) => s + e.amountBaseMinor, 0)

  return (
    <Sheet open={open} onClose={onClose} title="Витрата">
      <div className="text-center py-3">
        <div className="text-[34px] font-semibold num tracking-tight">
          {raw ? `${raw} ` : <span className="text-faint">0 </span>}
          <span className="text-muted text-[24px]">{currency === 'UAH' ? '₴' : currency === 'USD' ? '$' : '€'}</span>
        </div>
        <div className="text-[12.5px] text-faint mt-0.5">
          у цьому місяці на цей конверт — {money(spentThis)}
        </div>
      </div>

      {presets.length > 0 && !raw && (
        <div className="flex gap-1.5 flex-wrap justify-center mb-3">
          {presets.map((p, i) => {
            const env = db.envelopes.find(e => e.id === p.envelopeId)
            return (
              <button key={i} onClick={() => { setEnvelopeId(p.envelopeId); setRaw(String(p.amount / 100)) }}
                className="h-8 px-2.5 rounded-lg border border-line text-[12.5px] text-muted hover:bg-surface2">
                {env?.name} · <span className="num">{p.amount / 100}</span>
              </button>
            )
          })}
        </div>
      )}

      <select value={envelopeId} onChange={e => setEnvelopeId(e.target.value)}
        className="w-full h-11 rounded-lg border border-line bg-surface px-3 text-[14px] mb-2">
        {spendable.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
      </select>

      <div className="flex gap-1.5 mb-3">
        {(['UAH', 'USD', 'EUR'] as Currency[]).map(c => (
          <button key={c} onClick={() => setCurrency(c)}
            className={`h-8 px-3 rounded-lg text-[13px] border ${currency === c ? 'border-accent text-accent bg-accentSoft' : 'border-line text-muted'}`}>
            {c}
          </button>
        ))}
        {currency !== 'UAH' && (
          <span className="self-center text-[12px] text-faint num ml-1">
            курс {db.rates[currency]} → {minor ? money(Math.round(minor * db.rates[currency])) : '—'}
          </span>
        )}
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
