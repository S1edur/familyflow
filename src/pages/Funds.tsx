import { useState } from 'react'
import { Btn, Progress, Sheet } from '../components/ui'
import { useDB, fundStatus, addEntry } from '../data/store'
import { money, parseAmount } from '../lib/money'
import { shortDate } from '../lib/dates'

export default function Funds() {
  const db = useDB()
  const [payTo, setPayTo] = useState<string | null>(null)
  const [raw, setRaw] = useState('')
  const fund = payTo ? db.funds.find(f => f.id === payTo) : null

  const totalRequired = db.funds.reduce((s, f) => s + fundStatus(db, f.id).required, 0)

  return (
    <div className="max-w-[760px] mx-auto">
      <header className="px-4 pt-5 pb-3 sm:px-6">
        <h1 className="text-[22px] font-semibold tracking-tight">Фонди і цілі</h1>
        <p className="text-[13px] text-muted mt-1 num">
          Цього місяця треба відкласти {money(totalRequired)}
        </p>
      </header>

      <div className="px-4 sm:px-6 grid gap-2 sm:grid-cols-2">
        {db.funds.filter(f => !f.archived).sort((a, b) => a.priority - b.priority).map(f => {
          const s = fundStatus(db, f.id)
          return (
            <div key={f.id} className="rounded-xl border border-line bg-surface p-4">
              <div className="flex items-baseline justify-between gap-2">
                <div className="text-[14.5px] font-medium">{f.name}</div>
                {!s.onTrack && s.target && (
                  <span className="text-[11px] text-warn border border-warn/40 rounded px-1.5 py-0.5 shrink-0">відстаємо</span>
                )}
              </div>
              <div className="text-[19px] font-semibold num mt-1">
                {money(s.balance, f.currency)}
                {s.target && <span className="text-faint text-[13px] font-normal"> / {money(s.target, f.currency)}</span>}
              </div>
              <div className="mt-2"><Progress value={s.progress} tone={s.onTrack ? 'accent' : 'warn'} /></div>
              <div className="flex items-center justify-between mt-2 text-[12.5px] text-faint">
                <span className="num">треба {money(s.required, f.currency)} / міс</span>
                {f.dueDate && <span className="num">до {shortDate(f.dueDate)}</span>}
              </div>
              <div className="mt-3">
                <Btn full onClick={() => { setPayTo(f.id); setRaw(String(s.required / 100)) }}>Внести</Btn>
              </div>
            </div>
          )
        })}
      </div>

      <Sheet open={!!fund} onClose={() => setPayTo(null)} title={fund?.name}>
        <div className="text-center py-4">
          <input autoFocus value={raw} onChange={e => setRaw(e.target.value)} inputMode="decimal"
            className="w-full text-center text-[32px] font-semibold num bg-transparent outline-none" />
          <div className="text-[12.5px] text-faint">{fund?.currency}</div>
        </div>
        <Btn variant="primary" full disabled={!parseAmount(raw)}
          onClick={() => {
            const m = parseAmount(raw)
            if (m && fund) { addEntry({ kind: 'fund_in', amountMinor: m, currency: fund.currency, fundId: fund.id }); setPayTo(null) }
          }}>Внести у фонд</Btn>
      </Sheet>
    </div>
  )
}
