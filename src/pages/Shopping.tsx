import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Avatar, Btn, ConfirmButton, Empty, Field, FormActions, Icon,
  IconButton, Input, ListRow, MoneyInput, Pill, SectionTitle, Select, Sheet, toast, Rows,
} from '../ui'
import {
  useDB, addShoppingItem, updateShoppingItem, toggleShoppingItem,
  removeShoppingItem, finishShopping,
} from '../data/store'
import type { DB, ShoppingItem } from '../data/types'
import { money } from '../lib/money'
import { shortDate } from '../lib/dates'

const CATEGORIES = ['Овочі', 'Молочне', 'Мʼясо', 'Випічка', 'Бакалія', 'Заморожене', 'Побутове', 'Інше']
const CATEGORY_OPTIONS = CATEGORIES.map(c => ({ value: c, label: c }))

const ADD_INPUT_ID = 'shopping-add'

/** «2 л молоко» і «Молоко 2 л» → назва + кількість. Кількість необовʼязкова. */
function splitQty(raw: string): { name: string; qty?: string } {
  const unit = '(?:шт|кг|л|г|мл|уп|пач)'
  const num = '\\d+(?:[.,]\\d+)?'
  const lead = raw.match(new RegExp(`^(${num})\\s*(${unit})?\\s+(.+)$`, 'i'))
  // «3 шт» без назви лишаємо як є — інакше товар зветься «шт»
  if (lead && !new RegExp(`^${unit}$`, 'i').test(lead[3].trim())) {
    return { name: lead[3], qty: qtyText(lead[1], lead[2]) }
  }
  const tail = raw.match(new RegExp(`^(.+?)\\s+(${num})\\s*(${unit})$`, 'i'))
  if (tail) return { name: tail[1], qty: qtyText(tail[2], tail[3]) }
  return { name: raw }
}

const qtyText = (n: string, unit?: string) => (unit ? `${n} ${unit.toLowerCase()}` : n)

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export default function Shopping() {
  const db = useDB()
  const [draft, setDraft] = useState('')
  const [category, setCategory] = useState('')
  const [finish, setFinish] = useState(false)
  const [editing, setEditing] = useState<ShoppingItem | null>(null)

  const grouped = useMemo(() => {
    const map = new Map<string, typeof db.shoppingItems>()
    for (const c of CATEGORIES) map.set(c, [])
    for (const i of db.shoppingItems) {
      if (i.tripId) continue
      const c = i.category && map.has(i.category) ? i.category : 'Інше'
      map.get(c)!.push(i)
    }
    return [...map.entries()].filter(([, v]) => v.length)
  }, [db.shoppingItems])

  // у списку лишається те, що ще не привʼязане до завершеного походу
  const inList = db.shoppingItems.filter(i => !i.tripId)
  const checked = inList.filter(i => i.checkedAt).length
  const left = inList.length - checked

  const submit = () => {
    const raw = draft.trim()
    if (!raw) return
    const { name, qty } = splitQty(raw)
    // категорія необовʼязкова: без вибору її підбере store за попереднім таким товаром
    addShoppingItem(capitalize(name), { qty, category: category || undefined })
    setDraft('')
  }

  return (
    <div className="max-w-[680px] mx-auto pb-16 sm:pb-8">
      <header className="px-4 pt-3 pb-3 sm:px-6 flex items-baseline justify-between">
        <span className="text-[12.5px] text-faint num">{left} у списку</span>
      </header>

      <div className="px-4 sm:px-6">
        {/* без autoFocus: на телефоні він відкривав клавіатуру щойно людина зайшла
            подивитись список; фокус ставить кнопка в порожньому стані */}
        <Input id={ADD_INPUT_ID} value={draft} onChange={setDraft} onEnter={submit}
          placeholder="Додати — Enter" />
        {(draft.trim() || category) && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            <Pill active={!category} onClick={() => setCategory('')} title="Відділ підбереться сам">
              Відділ сам
            </Pill>
            {CATEGORIES.map(c => (
              <Pill key={c} active={category === c} onClick={() => setCategory(category === c ? '' : c)}>
                {c}
              </Pill>
            ))}
          </div>
        )}
        <div className="text-[12px] text-faint mt-1.5">
          «2 л молоко» — кількість розпізнається сама.
        </div>
      </div>

      {grouped.map(([cat, items]) => (
        <section key={cat} className="mt-4">
          <div className="sm:px-6">
            <SectionTitle>{cat}</SectionTitle>
          </div>
          <Rows>
            {items.map(i => {
              const by = db.members.find(m => m.id === i.addedBy)
              return (
                <ListRow key={i.id}>
                  <button onClick={() => toggleShoppingItem(i.id)}
                    aria-label={i.checkedAt ? `${i.name} — зняти позначку` : `${i.name} — куплено`}
                    aria-pressed={!!i.checkedAt}
                    className={`shrink-0 h-[18px] w-[18px] rounded-[5px] border grid place-items-center ${
                      i.checkedAt ? 'bg-accent border-accent text-white' : 'border-line2 hover:border-accent'}`}>
                    {i.checkedAt && Icon.check(12)}
                  </button>
                  <button onClick={() => setEditing(i)} aria-label={`Змінити ${i.name}`}
                    className={`flex-1 min-w-0 text-left text-[14px] truncate ${
                      i.checkedAt ? 'line-through text-faint' : ''}`}>
                    {i.name}{i.qty && <span className="text-faint num"> · {i.qty}</span>}
                  </button>
                  <Avatar member={by} size={18} />
                  <IconButton label={`Прибрати ${i.name}`} size={28}
                    onClick={() => removeShoppingItem(i.id)}>
                    {Icon.x(15)}
                  </IconButton>
                </ListRow>
              )
            })}
          </Rows>
        </section>
      ))}

      {!inList.length && (
        <Empty>
          <p className="mb-3">Список на похід у магазин. Товари самі стають по відділах,<br className="hidden sm:inline" /> а ціни по кожному не питаємо — тільки сума з чека.</p>
          <Btn onClick={() => document.getElementById(ADD_INPUT_ID)?.focus()}>Додати перший товар</Btn>
        </Empty>
      )}

      {checked > 0 && (
        <div className="px-4 sm:px-6 mt-5 sticky bottom-24 sm:static">
          <Btn variant="primary" full onClick={() => setFinish(true)}>
            Завершити похід · {checked} шт
          </Btn>
        </div>
      )}

      <PastTrips />

      <EditSheet item={editing} onClose={() => setEditing(null)} />
      <FinishSheet open={finish} onClose={() => setFinish(false)} />
    </div>
  )
}

/** Правка одного товару: назва, кількість, відділ. */
function EditSheet({ item, onClose }: { item: ShoppingItem | null; onClose: () => void }) {
  return item ? <EditForm key={item.id} item={item} onClose={onClose} /> : null
}

function EditForm({ item, onClose }: { item: ShoppingItem; onClose: () => void }) {
  const [name, setName] = useState(item.name)
  const [qty, setQty] = useState(item.qty ?? '')
  const [category, setCategory] = useState(item.category ?? 'Інше')
  const clean = name.trim()

  const save = () => {
    if (!clean) return
    updateShoppingItem(item.id, { name: capitalize(clean), qty: qty.trim(), category })
    onClose()
  }

  return (
    <Sheet open onClose={onClose} title="Товар">
      <Field label="Назва" htmlFor="shop-name">
        <Input id="shop-name" value={name} onChange={setName} onEnter={save} autoFocus />
      </Field>
      <Field label="Кількість" htmlFor="shop-qty" hint="Необовʼязково: «2 л», «300 г», «3 шт»">
        <Input id="shop-qty" value={qty} onChange={setQty} onEnter={save} placeholder="—" />
      </Field>
      <Field label="Відділ" htmlFor="shop-cat">
        <Select id="shop-cat" value={category} onChange={setCategory} options={CATEGORY_OPTIONS} />
      </Field>
      <FormActions onSubmit={save} onCancel={onClose} disabled={!clean}
        destructive={
          <ConfirmButton onConfirm={() => { removeShoppingItem(item.id); onClose() }}>
            Прибрати
          </ConfirmButton>
        } />
    </Sheet>
  )
}

/** Минулі походи: згорнуто, найновіші вгорі. Дані про походи більше не зникають. */
function PastTrips() {
  const db = useDB()
  const [open, setOpen] = useState(false)
  const trips = useMemo(
    () => [...db.trips].sort((a, b) => b.completedAt.localeCompare(a.completedAt)),
    [db.trips],
  )
  if (!trips.length) return null

  return (
    <section className="mt-8">
      <div className="sm:px-6">
        <SectionTitle right={
          <Pill active={open} onClick={() => setOpen(!open)}>
            {open ? 'Сховати' : `Показати · ${trips.length}`}
          </Pill>
        }>
          Минулі походи
        </SectionTitle>
      </div>
      {open && (
        <Rows>
          {trips.map(t => {
            const by = db.members.find(m => m.id === t.shoppedBy)
            // кількість позицій тепер похідна — товари привʼязані до походу, а не видалені
            const n = db.shoppingItems.filter(i => i.tripId === t.id).length
            return (
              <ListRow key={t.id}>
                <span className="shrink-0 text-[13px] text-faint num w-[52px]">
                  {shortDate(t.completedAt.slice(0, 10))}
                </span>
                <span className="flex-1 min-w-0 text-[14px] truncate">
                  {t.store || <span className="text-faint">Без магазину</span>}
                  {n > 0 && <span className="text-faint text-[12.5px] num"> · {n} поз.</span>}
                </span>
                <span className="text-[14px] num">{money(t.totalMinor, t.currency)}</span>
                <Avatar member={by} size={18} />
              </ListRow>
            )
          })}
        </Rows>
      )}
    </section>
  )
}

/**
 * Конверт для походу за замовчуванням — рахується на читанні, без зашитої назви:
 * у кожного дому конверти звуться по-своєму, а в новому їх може ще не бути.
 * Куди раніше записували походи → перший змінний → перший будь-який витратний.
 */
function defaultTripEnvelope(db: DB): string | undefined {
  const usable = db.envelopes.filter(e => e.kind !== 'income' && !e.archived)
  const ids = new Set(usable.map(e => e.id))
  const counts = new Map<string, number>()
  for (const e of db.entries) {
    if (!e.tripId || !e.envelopeId || !ids.has(e.envelopeId)) continue
    counts.set(e.envelopeId, (counts.get(e.envelopeId) ?? 0) + 1)
  }
  let best: string | undefined
  for (const [id, n] of counts) if (!best || n > counts.get(best)!) best = id
  return best
    ?? usable.find(e => e.kind === 'variable')?.id
    ?? usable[0]?.id
    ?? db.envelopes.find(e => e.kind !== 'income')?.id
}

function FinishSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const db = useDB()
  const navigate = useNavigate()
  const [store, setStore] = useState('')
  const [minor, setMinor] = useState(0)
  // Вибір людини тримаємо окремо від замовчування: дані можуть приїхати вже після
  // монтування, а вибраний раніше конверт — зникнути. Тоді беремо замовчування.
  const [picked, setPicked] = useState('')
  const fallback = defaultTripEnvelope(db)
  const spendable = db.envelopes.filter(e => e.kind !== 'income' && (!e.archived || e.id === picked || e.id === fallback))
  const envelopeId = spendable.some(e => e.id === picked) ? picked : fallback

  const save = () => {
    if (!minor || !envelopeId) return
    const n = db.shoppingItems.filter(i => i.checkedAt && !i.tripId).length
    finishShopping(minor, envelopeId, store.trim() || undefined)
    toast(`Похід записано: ${money(minor)} · ${n} поз.`)
    setStore('')
    setMinor(0)
    setPicked('')
    onClose()
  }

  return (
    <Sheet open={open} onClose={onClose} title="Завершити похід">
      <p className="text-[13px] text-muted mb-3">
        Одна сума з чека. Ціни по кожному товару не питаємо — це те, через що такі списки кидають.
      </p>
      <Field label="Сума з чека" htmlFor="trip-total">
        <MoneyInput id="trip-total" valueMinor={minor} onChange={setMinor} size="lg" autoFocus />
      </Field>
      <Field label="Магазин" htmlFor="trip-store" hint="Необовʼязково">
        <Input id="trip-store" value={store} onChange={setStore} placeholder="—" />
      </Field>
      {envelopeId ? (
        <Field label="Конверт" htmlFor="trip-env">
          <Select id="trip-env" value={envelopeId} onChange={setPicked}
            options={spendable.map(e => ({ value: e.id, label: e.name }))} />
        </Field>
      ) : (
        <div className="mb-3 rounded-lg bg-surface2 px-3 py-2.5 text-[13px] text-muted leading-snug">
          <p>Похід записується витратою в конверт, а конвертів витрат ще немає.</p>
          <div className="mt-2">
            <Btn onClick={() => { onClose(); navigate('/envelopes?env=new') }}>
              {Icon.plus(16)} Завести конверт
            </Btn>
          </div>
        </div>
      )}
      <Btn variant="primary" full disabled={!minor || !envelopeId} onClick={save}>Записати витрату</Btn>
    </Sheet>
  )
}
