import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Avatar, Badge, Btn, ConfirmButton, DateInput, Empty, Field, Icon, Input,
  Pill, PriorityMark, Segmented, Sheet, Tabs, Textarea, priorityLabel,
} from '../ui'
import {
  useDB, addTask, completeTask, updateTask, deleteTask, setPriority, setAssignee,
  fairness, confirmOccurrence, skipOccurrence, shoppingPending,
} from '../data/store'
import type { DB, Occurrence, Priority, Task, TaskStatus } from '../data/types'
import { money } from '../lib/money'
import { addDays, relativeDue, shortDate, today } from '../lib/dates'
import { readPinShopping, writePinShopping } from '../lib/prefs'

type View = 'mine' | 'today' | 'all' | 'open'

const GROUPS: { status: TaskStatus; label: string }[] = [
  { status: 'doing',   label: 'В роботі' },
  { status: 'todo',    label: 'До виконання' },
  { status: 'backlog', label: 'Колись' },
]

/**
 * Рядок списку — або справжня задача, або платіж.
 * Платіж НЕ зберігається як Task: він будується на льоту з db.occurrences
 * при кожному рендері (інваріант 4 — похідне не зберігається).
 */
type Item =
  | { kind: 'task'; id: string; task: Task }
  | { kind: 'bill'; id: string; occ: Occurrence }
  | { kind: 'shop'; id: 'shop'; count: number; allChecked: boolean }



/**
 * Горизонт показу платежів.
 * Платежі генеруються на 13 місяців уперед — без стелі список потоне в сотнях
 * рядків, як колись тонув у восьми «винести сміття» підряд.
 * 7 днів у робочих вкладках: стільки ж живе горизонт повторюваних задач
 * (TASK_HORIZON_DAYS) і стільки ж показує relativeDue() як «через N дн.»,
 * далі вона вже друкує голу дату — тобто це межа, до якої дата ще відчувається
 * як «скоро». «Всі» піднімає стелю до 31 дня: це рівно та довжина, за якою
 * стоїть окремий екран «Місяць» із повним чеклістом платежів.
 */
const BILL_DAYS_WORK = 7
const BILL_DAYS_ALL = 31

const EFFORTS: { value: '1' | '2' | '3'; label: string }[] = [
  { value: '1', label: 'Легка' },
  { value: '2', label: 'Середня' },
  { value: '3', label: 'Важка' },
]

const openBill = (o: Occurrence) => o.status === 'due' || o.status === 'projected'

export default function Tasks() {
  const db = useDB()
  const [view, setView] = useState<View>('mine')
  const [pinned, setPinned] = useState(readPinShopping)
  const togglePin = () => { const next = !pinned; setPinned(next); writePinShopping(next) }

  const pending = shoppingPending(db)
  const shop: Item | null = pending
    ? { kind: 'shop', id: 'shop', count: pending.count, allChecked: pending.allChecked }
    : null
  const [draft, setDraft] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [billId, setBillId] = useState<string | null>(null)
  const [showDone, setShowDone] = useState(false)
  const draftRef = useRef<HTMLInputElement>(null)

  const t = today()
  const billHorizon = view === 'all' ? addDays(t, BILL_DAYS_ALL) : addDays(t, BILL_DAYS_WORK)

  const visible = useMemo(() => {
    return db.tasks.filter(x => {
      if (x.status === 'dropped') return false
      if (x.deferUntil && x.deferUntil > t && x.status !== 'done') return false
      // повторювані показуємо лише найближчі — решта живе у вкладці «Всі»
      if (view !== 'all' && x.templateId && x.status !== 'done' && x.dueDate && x.dueDate > addDays(t, 2)) return false
      if (view === 'mine') return x.assigneeId === db.meId || !x.assigneeId
      if (view === 'today') return !!x.dueDate && x.dueDate <= t
      if (view === 'open') return !x.assigneeId
      return true
    })
  }, [db.tasks, view, db.meId, t])

  // платежі — той самий фільтр вкладки, але зі своєю стелею по датах
  const bills = useMemo(() => {
    return db.occurrences.filter(o => {
      if (!openBill(o)) return false
      if (o.dueDate > billHorizon) return false
      if (view === 'mine') return o.assigneeId === db.meId || !o.assigneeId
      if (view === 'today') return o.dueDate <= t
      if (view === 'open') return !o.assigneeId
      return true
    })
  }, [db.occurrences, view, db.meId, t, billHorizon])

  // скільки платежів лишилось за горизонтом — одним рядком, а не сотнею
  const beyond = db.occurrences.filter(o => openBill(o) && o.dueDate > billHorizon).length

  const counts = useMemo(() => {
    const near = addDays(t, BILL_DAYS_WORK)
    const mineBills = db.occurrences.filter(o => openBill(o) && o.dueDate <= near && (o.assigneeId === db.meId || !o.assigneeId)).length
    const todayBills = db.occurrences.filter(o => openBill(o) && o.dueDate <= t).length
    const openBills = db.occurrences.filter(o => openBill(o) && o.dueDate <= near && !o.assigneeId).length
    return {
      mine: db.tasks.filter(x => (x.assigneeId === db.meId || !x.assigneeId) && x.status !== 'done' && x.status !== 'dropped').length + mineBills,
      today: db.tasks.filter(x => x.dueDate && x.dueDate <= t && x.status !== 'done').length + todayBills,
      open: db.tasks.filter(x => !x.assigneeId && x.status !== 'done' && x.status !== 'dropped').length + openBills,
    }
  }, [db.tasks, db.occurrences, db.meId, t])

  // платежі живуть у «До виконання» — один список, а не друга секція поруч
  const itemsFor = (status: TaskStatus): Item[] => {
    const rows: Item[] = visible
      .filter(x => x.status === status)
      .map(task => ({ kind: 'task' as const, id: task.id, task }))
    if (status === 'todo') {
      rows.push(...bills.map(occ => ({ kind: 'bill' as const, id: occ.id, occ })))
      if (shop && !pinned) rows.push(shop)
    }
    const sorted = sortItems(rows)
    // закріплений похід іде першим і не вдає із себе пріоритет, якого не має
    return status === 'todo' && shop && pinned ? [shop, ...sorted] : sorted
  }

  const openCount = visible.filter(x => x.status !== 'done').length + bills.length + (shop ? 1 : 0)

  const done: Item[] = useMemo(() => {
    const since = addDays(t, -7)
    const tasks: Item[] = visible.filter(x => x.status === 'done')
      .map(task => ({ kind: 'task' as const, id: task.id, task }))
    const settled: Item[] = db.occurrences
      .filter(o => (o.status === 'paid' || o.status === 'skipped') && (o.paidOn ?? o.dueDate) >= since)
      .map(occ => ({ kind: 'bill' as const, id: occ.id, occ }))
    return [...tasks, ...settled].sort((a, b) => doneAt(b).localeCompare(doneAt(a)))
  }, [visible, db.occurrences, t])

  const submit = () => {
    const title = draft.trim()
    if (!title) return
    addTask({ title, assigneeId: view === 'mine' ? db.meId : undefined })
    setDraft('')
  }

  const open = openId ? db.tasks.find(x => x.id === openId) ?? null : null
  const bill = billId ? db.occurrences.find(o => o.id === billId) ?? null : null
  const share = fairness(db)
  const total = share.reduce((s, f) => s + f.done, 0)

  return (
    <div className="max-w-[760px] mx-auto">
      <header className="px-4 pt-5 pb-3 sm:px-6">
        <h1 className="text-[22px] font-semibold tracking-tight mb-3">Задачі</h1>
        <Tabs value={view} onChange={setView} items={[
          { value: 'mine',  label: 'Мої',      badge: counts.mine },
          { value: 'today', label: 'Сьогодні', badge: counts.today },
          { value: 'open',  label: 'Вільні',   badge: counts.open },
          { value: 'all',   label: 'Всі' },
        ]} />
      </header>

      <div className="px-4 sm:px-6">
        <div className="flex items-center gap-2 h-11 px-3 rounded-lg border border-line bg-surface mb-3">
          <span className="text-faint">{Icon.plus(17)}</span>
          <input ref={draftRef} value={draft} onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') submit() }}
            placeholder="Нова задача — Enter, щоб додати"
            className="flex-1 bg-transparent outline-none text-[14px] placeholder:text-faint" />
        </div>
      </div>

      {GROUPS.map(g => {
        const rows = itemsFor(g.status)
        if (!rows.length) return null
        return (
          <section key={g.status} className="mt-4">
            <div className="px-4 sm:px-6 mb-1 flex items-baseline gap-2">
              <h2 className="text-[12px] uppercase tracking-wider text-faint font-medium">{g.label}</h2>
              <span className="text-[12px] text-faint num">{rows.length}</span>
            </div>
            <ul className="border-y border-line divide-y divide-line bg-surface">
              {rows.map(it =>
                it.kind === 'task' ? <TaskRow key={it.id} task={it.task} onOpen={() => setOpenId(it.id)} />
                : it.kind === 'shop' ? <ShopRow key={it.id} item={it} pinned={pinned} onTogglePin={togglePin} />
                : <BillRow key={it.id} occ={it.occ} onOpen={() => setBillId(it.id)} />)}
            </ul>
          </section>
        )
      })}

      {beyond > 0 && (
        <div className="px-4 sm:px-6 mt-2 text-[12.5px] text-faint">
          Ще <span className="num">{beyond}</span> {plural(beyond, 'платіж', 'платежі', 'платежів')} далі —
          {view === 'all' ? ' у розділі «Місяць».' : ' у вкладці «Всі».'}
        </div>
      )}

      {openCount === 0 && (
        <Empty>
          <p className="mb-3">
            Тут збираються побутові задачі й платежі, яким настав час.
            Поки порожньо — нічого не горить.
          </p>
          <Btn onClick={() => draftRef.current?.focus()}>Додати задачу</Btn>
        </Empty>
      )}

      {done.length > 0 && (
        <section className="mt-6">
          <button onClick={() => setShowDone(v => !v)}
            className="px-4 sm:px-6 mb-1 flex items-center gap-1.5 text-[12px] uppercase tracking-wider text-faint font-medium">
            <span className={`transition-transform ${showDone ? 'rotate-90' : ''}`}>{Icon.chev(13)}</span>
            Зроблено <span className="num">{done.length}</span>
          </button>
          {showDone && (
            <ul className="border-y border-line divide-y divide-line bg-surface">
              {done.slice(0, 30).map(it =>
                it.kind === 'task' ? <TaskRow key={it.id} task={it.task} onOpen={() => setOpenId(it.id)} />
                : it.kind === 'shop' ? null
                : <BillRow key={it.id} occ={it.occ} onOpen={() => setBillId(it.id)} />)}
            </ul>
          )}
        </section>
      )}

      {/* баланс навантаження */}
      <section className="px-4 sm:px-6 mt-8">
        <h2 className="text-[12px] uppercase tracking-wider text-faint font-medium mb-2">Баланс за 28 днів</h2>
        {/* Рахуються задачі, походи в магазин і підтверджені платежі.
            Розбивку віддаємо підказкою, а не цифрами: у діапазоні 40–60%
            смуга має лишатись нейтральною і без чисел. */}
        <div className="h-2.5 rounded-full overflow-hidden flex bg-surface2">
          {share.map(s => (
            <div key={s.member.id} style={{
              width: total ? `${(s.done / total) * 100}%` : '50%',
              background: balanced(share) ? 'var(--c-line2)' : s.member.color,
            }} />
          ))}
        </div>
        <div className="flex justify-between mt-1.5 text-[12.5px] text-faint">
          {share.map(s => (
            <span key={s.member.id} title={breakdown(s)}>
              {s.member.name}
              {!balanced(share) && total > 0 && <span className="num"> · {Math.round((s.done / total) * 100)}%</span>}
            </span>
          ))}
        </div>
        {balanced(share) && <div className="text-[12.5px] text-faint mt-1">Приблизно порівну</div>}
      </section>

      <TaskSheet task={open} onClose={() => setOpenId(null)} />
      <BillSheet occ={bill} onClose={() => setBillId(null)} />
    </div>
  )
}

function plural(n: number, one: string, few: string, many: string) {
  const a = Math.abs(n) % 100
  if (a > 10 && a < 20) return many
  const b = a % 10
  if (b === 1) return one
  if (b >= 2 && b <= 4) return few
  return many
}

/** Підказка при наведенні: з чого склалось навантаження. */
function breakdown(s: { tasks: number; trips: number; bills: number }) {
  return [
    `задачі ${s.tasks}`,
    s.trips ? `магазин ${s.trips}` : null,
    s.bills ? `платежі ${s.bills}` : null,
  ].filter(Boolean).join(' · ')
}

function balanced(share: { done: number }[]) {
  const total = share.reduce((s, x) => s + x.done, 0)
  if (!total) return true
  return share.every(s => s.done / total >= 0.4 && s.done / total <= 0.6)
}

function doneAt(it: Item) {
  if (it.kind === 'task') return it.task.completedAt ?? ''
  if (it.kind === 'shop') return ''
  return it.occ.paidOn ?? it.occ.dueDate
}

/**
 * Один порядок для задач і платежів.
 * priority === 0 — «не проставлений», іде ОСТАННІМ (інваріант 8).
 * Платіж пріоритету не має і теж потрапляє в цей хвіст, але має дату,
 * тому стає перед безстроковими задачами без пріоритету.
 */
function sortItems(rows: Item[]) {
  // відкріплений рядок покупок не має ні пріоритету, ні дати — тож іде в хвіст
  const prio = (it: Item) => {
    if (it.kind === 'bill' || it.kind === 'shop') return 9
    return it.task.priority === 0 ? 9 : it.task.priority
  }
  const due = (it: Item) =>
    it.kind === 'bill' ? it.occ.dueDate : it.kind === 'shop' ? undefined : it.task.dueDate
  const created = (it: Item) =>
    it.kind === 'bill' ? it.occ.dueDate : it.kind === 'shop' ? '9999' : it.task.createdAt

  return [...rows].sort((a, b) => {
    const pa = prio(a), pb = prio(b)
    if (pa !== pb) return pa - pb
    const da = due(a), dbb = due(b)
    if (!!da !== !!dbb) return da ? -1 : 1
    if (da && dbb && da !== dbb) return da.localeCompare(dbb)
    return created(a).localeCompare(created(b))
  })
}

/* ───────────────────────── рядки ───────────────────────── */

/**
 * Похід у магазин рядком у списку задач. Будується з db.shoppingItems на льоту,
 * у сховище не пишеться нічого (інваріант 4).
 * Чекбокс не закриває його напряму: щоб завершити похід, потрібна сума з чека,
 * тож обидва тапи ведуть на екран покупок.
 */
function ShopRow({ item, pinned, onTogglePin }: {
  item: Extract<Item, { kind: 'shop' }>; pinned: boolean; onTogglePin: () => void
}) {
  const nav = useNavigate()
  const go = () => nav('/shopping')

  return (
    <li className="flex items-center gap-2.5 px-4 sm:px-6 h-11 group">
      <button onClick={go} aria-label="Відкрити покупки"
        className="shrink-0 h-[18px] w-[18px] rounded-[5px] border border-line2 hover:border-accent" />

      <button onClick={go} className="shrink-0 text-faint" aria-hidden tabIndex={-1}>
        {Icon.cart(15)}
      </button>

      <button onClick={go} className="flex-1 min-w-0 text-left">
        <span className="text-[14px] block truncate">Сходити в магазин</span>
      </button>

      {item.allChecked
        ? <Badge tone="accent">є сума з чека?</Badge>
        : <span className="shrink-0 text-[12.5px] text-faint num">
            {item.count} {plural(item.count, 'товар', 'товари', 'товарів')}
          </span>}

      <button onClick={onTogglePin}
        aria-label={pinned ? 'Відкріпити' : 'Закріпити зверху'}
        title={pinned ? 'Відкріпити' : 'Закріпити зверху'}
        className={`shrink-0 p-1 -mr-1 rounded transition-colors ${
          pinned ? 'text-accent' : 'text-faint opacity-0 group-hover:opacity-100 focus-visible:opacity-100'}`}>
        {Icon.pin(15)}
      </button>
    </li>
  )
}

function TaskRow({ task, onOpen }: { task: Task; onOpen: () => void }) {
  const db = useDB()
  const member = db.members.find(m => m.id === task.assigneeId)
  const isDone = task.status === 'done'
  const due = task.dueDate ? relativeDue(task.dueDate) : null

  const cycleAssignee = () => {
    const ids = [...db.members.map(m => m.id), undefined]
    const i = ids.indexOf(task.assigneeId)
    setAssignee(task.id, ids[(i + 1) % ids.length])
  }
  const cyclePriority = () => {
    const order: Priority[] = [0, 1, 2, 3, 4]
    setPriority(task.id, order[(order.indexOf(task.priority) + 1) % order.length])
  }

  return (
    <li className="flex items-center gap-2.5 px-4 sm:px-6 h-11 group">
      <button onClick={() => completeTask(task.id)} aria-label="Виконано"
        className={`shrink-0 h-[18px] w-[18px] rounded-[5px] border grid place-items-center transition-colors ${
          isDone ? 'bg-accent border-accent text-white' : 'border-line2 hover:border-accent'}`}>
        {isDone && Icon.check(12)}
      </button>

      <button onClick={cyclePriority} className="shrink-0 opacity-90 hover:opacity-100"
        title={priorityLabel(task.priority)}>
        <PriorityMark p={task.priority} />
      </button>

      <button onClick={onOpen} className="flex-1 min-w-0 text-left">
        <span className={`text-[14px] block truncate ${isDone ? 'line-through text-faint' : ''}`}>{task.title}</span>
      </button>

      {task.templateId && <span className="shrink-0 text-faint text-[11px]" title="Повторювана">↻</span>}
      {task.area && <span className="shrink-0 hidden sm:block text-[11.5px] text-faint px-1.5 py-0.5 rounded border border-line">{task.area}</span>}
      {due && !isDone && (
        <span className={`shrink-0 text-[12px] num ${
          due.tone === 'over' ? 'text-warn font-medium' : due.tone === 'today' ? 'text-warn' : 'text-faint'}`}>{due.label}</span>
      )}
      <button onClick={cycleAssignee} className="shrink-0" aria-label="Виконавець">
        <Avatar member={member} />
      </button>
    </li>
  )
}

/**
 * Платіж у списку задач. Об'єкта Task для нього не існує — рядок зібраний
 * з Occurrence просто зараз. Чекбокс викликає confirmOccurrence: воно саме
 * створить витрату і, якщо план прив'язаний до фонду, списання з фонду.
 */
function BillRow({ occ, onOpen }: { occ: Occurrence; onOpen: () => void }) {
  const db = useDB()
  const member = db.members.find(m => m.id === occ.assigneeId)
  const paid = occ.status === 'paid'
  const skipped = occ.status === 'skipped'
  const settled = paid || skipped
  const due = relativeDue(occ.dueDate)

  return (
    <li className="flex items-center gap-2.5 px-4 sm:px-6 h-11 group">
      {settled ? (
        <span className={`shrink-0 h-[18px] w-[18px] rounded-[5px] border grid place-items-center ${
          paid ? 'bg-accent border-accent text-white' : 'border-line2 text-faint'}`}>
          {paid ? Icon.check(12) : '—'}
        </span>
      ) : (
        <button onClick={() => confirmOccurrence(occ.id)} aria-label="Оплачено"
          className="shrink-0 h-[18px] w-[18px] rounded-[5px] border border-line2 hover:border-accent grid place-items-center transition-colors" />
      )}

      <span className="shrink-0 text-faint" title="Платіж">{Icon.wallet(15)}</span>

      <button onClick={onOpen} className="flex-1 min-w-0 text-left">
        <span className={`text-[14px] block truncate ${settled ? 'line-through text-faint' : ''}`}>{occ.name}</span>
      </button>

      <span className="shrink-0 hidden sm:block">
        <Badge tone={due.tone === 'over' && !settled ? 'warn' : 'neutral'}>Платіж</Badge>
      </span>

      <span className={`shrink-0 text-[13.5px] num ${settled ? 'text-faint' : 'text-muted'}`}>
        {money(settled ? occ.actualMinor ?? occ.expectedMinor : occ.expectedMinor, occ.currency)}
      </span>

      <span className={`shrink-0 text-[12px] num ${
        settled ? 'text-faint'
          : due.tone === 'over' ? 'text-warn font-medium'
          : due.tone === 'today' ? 'text-warn' : 'text-faint'}`}>
        {settled ? shortDate(occ.paidOn ?? occ.dueDate) : due.label}
      </span>

      <span className="shrink-0"><Avatar member={member} /></span>
    </li>
  )
}

/* ───────────────────────── листи ───────────────────────── */

function BillSheet({ occ, onClose }: { occ: Occurrence | null; onClose: () => void }) {
  const db = useDB()
  if (!occ) return null
  const envelope = db.envelopes.find(e => e.id === occ.envelopeId)
  const member = db.members.find(m => m.id === occ.assigneeId)
  const settled = occ.status === 'paid' || occ.status === 'skipped'
  const due = relativeDue(occ.dueDate)

  return (
    <Sheet open={!!occ} onClose={onClose} title="Платіж">
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <span className="text-[16px] font-medium">{occ.name}</span>
        <span className="text-[18px] num">{money(occ.actualMinor ?? occ.expectedMinor, occ.currency)}</span>
      </div>
      <div className="text-[12.5px] text-faint mb-4">
        <span className="num">{shortDate(occ.dueDate)}</span>
        {!settled && due.tone === 'over' && <span className="text-warn"> · прострочено</span>}
        {occ.status === 'paid' && <span> · оплачено</span>}
        {occ.status === 'skipped' && <span> · пропущено</span>}
        {envelope && <span> · {envelope.name}</span>}
        {member && <span> · {member.name}</span>}
      </div>

      {settled ? (
        <div className="text-[13px] text-faint">
          Змінити суму або скасувати підтвердження можна в розділі «Місяць».
        </div>
      ) : (
        <>
          <div className="flex gap-2">
            <Btn variant="primary" full onClick={() => { confirmOccurrence(occ.id); onClose() }}>Оплачено</Btn>
            <Btn onClick={() => { skipOccurrence(occ.id); onClose() }}>Пропустити</Btn>
          </div>
          <div className="text-[12px] text-faint mt-2">
            Підтвердження запише витрату в конверт, а якщо платіж фінансує фонд — і списання з нього.
            Пропуск лишає платіж в історії зі статусом «пропущено».
          </div>
        </>
      )}
    </Sheet>
  )
}

function TaskSheet({ task, onClose }: { task: Task | null; onClose: () => void }) {
  const db = useDB()
  if (!task) return null
  const areas = knownAreas(db)

  return (
    <Sheet open={!!task} onClose={onClose} title="Задача">
      <input value={task.title} onChange={e => updateTask(task.id, { title: e.target.value })}
        className="w-full text-[16px] font-medium bg-transparent outline-none mb-3" />

      <Field label="Статус">
        <div className="flex gap-1 flex-wrap">
          {(['backlog', 'todo', 'doing', 'done'] as TaskStatus[]).map(s => (
            <Pill key={s} active={task.status === s} onClick={() => updateTask(task.id, { status: s })}>
              {s === 'backlog' ? 'Колись' : s === 'todo' ? 'До виконання' : s === 'doing' ? 'В роботі' : 'Зроблено'}
            </Pill>
          ))}
        </div>
      </Field>

      <Field label="Пріоритет">
        <div className="flex gap-1 flex-wrap">
          {([1, 2, 3, 4, 0] as Priority[]).map(p => (
            <Pill key={p} active={task.priority === p} onClick={() => setPriority(task.id, p)}>
              <PriorityMark p={p} size={12} /> {priorityLabel(p)}
            </Pill>
          ))}
        </div>
      </Field>

      <Field label="Виконавець">
        <div className="flex gap-1">
          {db.members.map(m => (
            <Pill key={m.id} active={task.assigneeId === m.id} onClick={() => setAssignee(task.id, m.id)}>
              <Avatar member={m} size={16} /> {m.name}
            </Pill>
          ))}
          <Pill active={!task.assigneeId} onClick={() => setAssignee(task.id, undefined)}>Вільна</Pill>
        </div>
      </Field>

      {/* складність — валюта балансу навантаження і вхід у ротацію least_loaded */}
      <Field label="Складність" hint="Важить у балансі за 28 днів і в черзі повторюваних задач.">
        <Segmented full value={String(task.effort) as '1' | '2' | '3'} items={EFFORTS}
          onChange={v => updateTask(task.id, { effort: Number(v) as 1 | 2 | 3 })} />
      </Field>

      <Field label="Зона" htmlFor="task-area">
        <Input id="task-area" value={task.area ?? ''} placeholder="Кухня, авто, документи…"
          onChange={v => updateTask(task.id, { area: v.trim() ? v : undefined })} />
        {areas.length > 0 && (
          <div className="flex gap-1 flex-wrap mt-1.5">
            {areas.map(a => (
              <Pill key={a} active={task.area === a}
                onClick={() => updateTask(task.id, { area: task.area === a ? undefined : a })}>{a}</Pill>
            ))}
          </div>
        )}
      </Field>

      <Field label="Нотатка" htmlFor="task-notes">
        <Textarea id="task-notes" value={task.notes ?? ''} placeholder="Деталі, посилання, що саме треба"
          onChange={v => updateTask(task.id, { notes: v.trim() ? v : undefined })} />
      </Field>

      <Field label="Дедлайн" htmlFor="task-due">
        <DateInput id="task-due" value={task.dueDate}
          onChange={v => updateTask(task.id, { dueDate: v })} />
      </Field>

      <Field label="Відкласти до" htmlFor="task-defer">
        <DateInput id="task-defer" value={task.deferUntil}
          onChange={v => updateTask(task.id, { deferUntil: v })} />
      </Field>

      <div className="flex gap-2 mt-4">
        <Btn variant="primary" full onClick={() => { completeTask(task.id); onClose() }}>
          {task.status === 'done' ? 'Повернути в роботу' : 'Виконано'}
        </Btn>
        <Btn onClick={() => { updateTask(task.id, { status: 'dropped' }); onClose() }}>Прибрати</Btn>
      </div>

      <div className="mt-4 pt-3 border-t border-line flex items-center justify-between gap-3">
        <span className="text-[12px] text-faint">
          «Прибрати» ховає задачу зі списків. Видалення стирає її та підзадачі назавжди.
        </span>
        <ConfirmButton onConfirm={() => { deleteTask(task.id); onClose() }}>Видалити</ConfirmButton>
      </div>
    </Sheet>
  )
}

/** Зони, які вже вживаються — щоб не вигадувати нову назву щоразу. */
function knownAreas(db: DB): string[] {
  const set = new Set<string>()
  db.tasks.forEach(t => { if (t.area && t.status !== 'dropped') set.add(t.area) })
  db.taskTemplates.forEach(t => { if (t.area) set.add(t.area) })
  return [...set].sort((a, b) => a.localeCompare(b, 'uk'))
}
