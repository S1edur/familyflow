import { useState } from 'react'
import { Btn, Progress, Sheet } from '../components/ui'
import { useDB, debtStatus, addEntry } from '../data/store'
import { money, parseAmount } from '../lib/money'
import { longDate, shortDate } from '../lib/dates'

export default function Debts() {
  const db = useDB()
  const [payId, setPayId] = useState<string | null>(null)
  const [raw, setRaw] = useState('')
  const debt = payId ? db.debts.find(d => d.id === payId) : null
  const totalLeft = db.debts.filter(d => !d.closedOn).reduce((s, d) => s + debtStatus(db, d.id).remaining, 0)

  return (
    <div className="max-w-[760px] mx-auto">
      <header className="px-4 pt-5 pb-3 sm:px-6">
        <h1 className="text-[22px] font-semibold tracking-tight">Борги</h1>
        <p className="text-[13px] text-muted mt-1 num">Лишилось {money(totalLeft)}</p>
      </header>

      <div className="px-4 sm:px-6 grid gap-3">
        {db.debts.map(d => {
          const s = debtStatus(db, d.id)
          const payments = db.entries
            .filter(e => e.debtId === d.id && e.kind === 'debt_payment')
            .sort((a, b) => b.occurredOn.localeCompare(a.occurredOn))
          return (
            <div key={d.id} className="rounded-xl border border-line bg-surface p-4">
              <div className="flex items-baseline justify-between">
                <div className="text-[14.5px] font-medium">{d.name}</div>
                <div className="text-[12.5px] text-faint">{d.counterparty}</div>
              </div>
              <div className="text-[26px] font-semibold num mt-1">{money(s.remaining, d.currency)}</div>
              <div className="text-[12.5px] text-faint num">
                виплачено {money(s.paid, d.currency)} з {money(d.principalMinor, d.currency)}
              </div>
              <div className="mt-2.5"><Progress value={s.progress} height={8} /></div>
              {s.payoff && (
                <div className="mt-3 pt-3 border-t border-line">
                  <div className="text-[11.5px] uppercase tracking-wider text-faint">Закриємо орієнтовно</div>
                  <div className="text-[15px] font-medium">{longDate(s.payoff)}</div>
                </div>
              )}
              <div className="mt-3">
                <Btn variant="primary" onClick={() => { setPayId(d.id); setRaw(String((d.monthlyPaymentMinor ?? 0) / 100)) }}>
                  Внести платіж
                </Btn>
              </div>
              {payments.length > 0 && (
                <ul className="mt-3 pt-3 border-t border-line space-y-1">
                  {payments.slice(0, 6).map(p => (
                    <li key={p.id} className="flex justify-between text-[12.5px] text-faint num">
                      <span>{shortDate(p.occurredOn)}</span>
                      <span>{money(p.amountMinor, p.currency)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )
        })}
      </div>

      <Sheet open={!!debt} onClose={() => setPayId(null)} title={debt?.name}>
        <div className="text-center py-4">
          <input autoFocus value={raw} onChange={e => setRaw(e.target.value)} inputMode="decimal"
            className="w-full text-center text-[32px] font-semibold num bg-transparent outline-none" />
        </div>
        <Btn variant="primary" full disabled={!parseAmount(raw)}
          onClick={() => {
            const m = parseAmount(raw)
            if (m && debt) { addEntry({ kind: 'debt_payment', amountMinor: m, currency: debt.currency, debtId: debt.id }); setPayId(null) }
          }}>Записати платіж</Btn>
      </Sheet>
    </div>
  )
}
