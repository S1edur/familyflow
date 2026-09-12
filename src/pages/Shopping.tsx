import { useMemo, useState } from 'react'
import { Avatar, Btn, Empty, Icon, Sheet } from '../components/ui'
import { useDB, addShoppingItem, toggleShoppingItem, removeShoppingItem, finishShopping } from '../data/store'
import { money, parseAmount } from '../lib/money'

const CATEGORIES = ['Овочі', 'Молочне', 'Мʼясо', 'Випічка', 'Бакалія', 'Заморожене', 'Побутове', 'Інше']

export default function Shopping() {
  const db = useDB()
  const [draft, setDraft] = useState('')
  const [finish, setFinish] = useState(false)

  const grouped = useMemo(() => {
    const map = new Map<string, typeof db.shoppingItems>()
    for (const c of CATEGORIES) map.set(c, [])
    for (const i of db.shoppingItems) {
      const c = i.category && map.has(i.category) ? i.category : 'Інше'
      map.get(c)!.push(i)
    }
    return [...map.entries()].filter(([, v]) => v.length)
  }, [db.shoppingItems])

  const checked = db.shoppingItems.filter(i => i.checkedAt).length
  const left = db.shoppingItems.length - checked

  const submit = () => {
    const raw = draft.trim()
    if (!raw) return
    // «2 молоко» → назва + кількість
    const m = raw.match(/^(\d+[\s]*(?:шт|кг|л|г|мл)?)\s+(.+)$/i)
    const name = m ? m[2] : raw
    addShoppingItem(name.charAt(0).toUpperCase() + name.slice(1))
    setDraft('')
  }

  return (
    <div className="max-w-[680px] mx-auto">
      <header className="px-4 pt-5 pb-3 sm:px-6 flex items-baseline justify-between">
        <h1 className="text-[22px] font-semibold tracking-tight">Покупки</h1>
        <span className="text-[12.5px] text-faint num">{left} у списку</span>
      </header>

      <div className="px-4 sm:px-6">
        <div className="flex items-center gap-2 h-11 px-3 rounded-lg border border-line bg-surface">
          <span className="text-faint">{Icon.plus(17)}</span>
          <input autoFocus value={draft} onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') submit() }}
            placeholder="Додати — Enter"
            className="flex-1 bg-transparent outline-none text-[14px] placeholder:text-faint" />
        </div>
      </div>

      {grouped.map(([cat, items]) => (
        <section key={cat} className="mt-4">
          <h2 className="px-4 sm:px-6 mb-1 text-[12px] uppercase tracking-wider text-faint font-medium">{cat}</h2>
          <ul className="border-y border-line divide-y divide-line bg-surface">
            {items.map(i => {
              const by = db.members.find(m => m.id === i.addedBy)
              return (
                <li key={i.id} className="flex items-center gap-3 px-4 sm:px-6 h-11 group">
                  <button onClick={() => toggleShoppingItem(i.id)} aria-label="Куплено"
                    className={`shrink-0 h-[18px] w-[18px] rounded-[5px] border grid place-items-center ${
                      i.checkedAt ? 'bg-accent border-accent text-white' : 'border-line2 hover:border-accent'}`}>
                    {i.checkedAt && Icon.check(12)}
                  </button>
                  <span className={`flex-1 text-[14px] truncate ${i.checkedAt ? 'line-through text-faint' : ''}`}>
                    {i.name}{i.qty && <span className="text-faint"> · {i.qty}</span>}
                  </span>
                  <Avatar member={by} size={18} />
                  <button onClick={() => removeShoppingItem(i.id)}
                    className="text-faint opacity-0 group-hover:opacity-100 transition-opacity" aria-label="Прибрати">
                    {Icon.x(15)}
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      ))}

      {!db.shoppingItems.length && <Empty>Список порожній</Empty>}

      {checked > 0 && (
        <div className="px-4 sm:px-6 mt-5 sticky bottom-24 sm:static">
          <Btn variant="primary" full onClick={() => setFinish(true)}>
            Завершити похід · {checked} шт
          </Btn>
        </div>
      )}

      <FinishSheet open={finish} onClose={() => setFinish(false)} />
    </div>
  )
}

function FinishSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const db = useDB()
  const [store, setStore] = useState('')
  const [total, setTotal] = useState('')
  const groceries = db.envelopes.find(e => e.name === 'Продукти') ?? db.envelopes[5]
  const [envelopeId, setEnvelopeId] = useState(groceries.id)
  const minor = parseAmount(total)

  return (
    <Sheet open={open} onClose={onClose} title="Завершити похід">
      <p className="text-[13px] text-muted mb-3">
        Одна сума з чека. Ціни по кожному товару не питаємо — це те, через що такі списки кидають.
      </p>
      <div className="text-center py-2">
        <input autoFocus value={total} onChange={e => setTotal(e.target.value)} inputMode="decimal" placeholder="0"
          className="w-full text-center text-[32px] font-semibold num bg-transparent outline-none placeholder:text-faint" />
        <div className="text-[12.5px] text-faint">{minor ? money(minor) : 'сума з чека'}</div>
      </div>
      <input value={store} onChange={e => setStore(e.target.value)} placeholder="Магазин (необовʼязково)"
        className="w-full h-11 px-3 rounded-lg border border-line bg-surface text-[14px] mb-2" />
      <select value={envelopeId} onChange={e => setEnvelopeId(e.target.value)}
        className="w-full h-11 rounded-lg border border-line bg-surface px-3 text-[14px] mb-3">
        {db.envelopes.filter(e => e.kind !== 'income').map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
      </select>
      <Btn variant="primary" full disabled={!minor}
        onClick={() => { if (minor) { finishShopping(minor, envelopeId, store || undefined); setStore(''); setTotal(''); onClose() } }}>
        Записати витрату
      </Btn>
    </Sheet>
  )
}
