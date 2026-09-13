import { useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  Avatar, Badge, Btn, Card, ConfirmButton, DateInput, Empty, Field, FormActions,
  Icon, Input, LinkChip, OptionalFields, Pill, PriorityMark, Segmented, Select, Sheet, Switch, Tabs,
  Textarea, priorityLabel, Rows, PropertyMenu, useSheet, type MenuOption,
} from '../ui'
import {
  useDB, addTask, completeTask, updateTask, deleteTask, setPriority, setAssignee,
  fairness, skipOccurrence, shoppingPending, isIncomeOccurrence,
  addTaskTemplate, updateTaskTemplate, removeTaskTemplate,
} from '../data/store'
import { AmountForm, BillRow, doneLabel, payBill } from '../components/BillRow'
import { payableProjects } from '../components/RuleForm'
import { monthRoute, projectRoute, ruleRoute, ruleText } from '../data/links'
import type { DB, ID, Occurrence, Priority, Project, Task, TaskStatus, TaskTemplate } from '../data/types'
import { money } from '../lib/money'
import { addDays, relativeDue, shortDate, thisMonth, today } from '../lib/dates'
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
 * стоїть екран «Місяць» з повним чеклістом платежів.
 */
const BILL_DAYS_WORK = 7
const BILL_DAYS_ALL = 31

const EFFORTS: { value: '1' | '2' | '3'; label: string }[] = [
  { value: '1', label: 'Легка' },
  { value: '2', label: 'Середня' },
  { value: '3', label: 'Важка' },
]

/** Перший день тижня — понеділок: 1=Пн .. 7=Нд, як у `byDay`. */
const DOW = [
  { v: 1, l: 'Пн' }, { v: 2, l: 'Вт' }, { v: 3, l: 'Ср' }, { v: 4, l: 'Чт' },
  { v: 5, l: 'Пт' }, { v: 6, l: 'Сб' }, { v: 7, l: 'Нд' },
]

/** Готові інтервали для «після виконання» — один тап замість набору числа. */
const INTERVALS = [3, 4, 7, 14, 30, 60]

const EFFORT_LABEL: Record<1 | 2 | 3, string> = { 1: 'Легка', 2: 'Середня', 3: 'Важка' }

const openBill = (o: Occurrence) => o.status === 'due' || o.status === 'projected'

const billHorizonFor = (view: View, t: string) =>
  addDays(t, view === 'all' ? BILL_DAYS_ALL : BILL_DAYS_WORK)

/** Чи видно задачу у вкладці. Одна функція і для списку, і для бейджа. */
function showTask(x: Task, view: View, t: string, meId: ID) {
  if (x.status === 'dropped') return false
  if (x.deferUntil && x.deferUntil > t && x.status !== 'done') return false
  // повторювані показуємо лише найближчі — решта живе у вкладці «Всі»
  if (view !== 'all' && x.templateId && x.status !== 'done' && x.dueDate && x.dueDate > addDays(t, 2)) return false
  if (view === 'mine') return x.assigneeId === meId || !x.assigneeId
  if (view === 'today') return !!x.dueDate && x.dueDate <= t
  if (view === 'open') return !x.assigneeId
  return true
}

/** Чи видно відкритий платіж у вкладці — з урахуванням горизонту дат. */
function showBill(o: Occurrence, view: View, t: string, meId: ID) {
  if (!openBill(o)) return false
  if (o.dueDate > billHorizonFor(view, t)) return false
  if (view === 'mine') return o.assigneeId === meId || !o.assigneeId
  if (view === 'today') return o.dueDate <= t
  if (view === 'open') return !o.assigneeId
  return true
}

export default function Tasks() {
  const db = useDB()
  const [view, setView] = useState<View>('mine')
  const [pinned, setPinned] = useState(readPinShopping)
  const togglePin = () => { const next = !pinned; setPinned(next); writePinShopping(next) }

  const nav = useNavigate()
  const pending = shoppingPending(db)
  const shop: Item | null = pending
    ? { kind: 'shop', id: 'shop', count: pending.count, allChecked: pending.allChecked }
    : null
  const [draft, setDraft] = useState('')
  // Лист задачі й фільтр проєкту живуть в адресі: на них посилаються
  // інші екрани (`/tasks?task=<id>`, `/tasks?project=<id>`).
  const [openId, setOpenId] = useSheet('task')
  const [params, setParams] = useSearchParams()
  const projectFilter = params.get('project')
  const setProjectFilter = (id: string | null) => setParams(prev => {
    const next = new URLSearchParams(prev)
    if (id) next.set('project', id); else next.delete('project')
    return next
  }, { replace: true })
  const filterProject = projectFilter ? db.projects.find(p => p.id === projectFilter) : undefined
  const [billId, setBillId] = useState<string | null>(null)
  const [showDone, setShowDone] = useState(false)
  const draftRef = useRef<HTMLInputElement>(null)

  const t = today()
  const billHorizon = billHorizonFor(view, t)

  // Фільтр проєкту накладається поверх вкладки — і на задачі, і на платежі.
  const tasksHere = useMemo(
    () => db.tasks.filter(x => !projectFilter || x.projectId === projectFilter),
    [db.tasks, projectFilter])
  const occHere = useMemo(
    () => db.occurrences.filter(o => !projectFilter || o.projectId === projectFilter),
    [db.occurrences, projectFilter])

  const visible = useMemo(
    () => tasksHere.filter(x => showTask(x, view, t, db.meId)),
    [tasksHere, view, db.meId, t])

  // платежі — той самий фільтр вкладки, але зі своєю стелею по датах
  const bills = useMemo(
    () => occHere.filter(o => showBill(o, view, t, db.meId)),
    [occHere, view, db.meId, t])

  // скільки платежів лишилось за горизонтом — одним рядком, а не сотнею
  const beyond = occHere.filter(o => openBill(o) && o.dueDate > billHorizon).length

  // Бейдж рахується ТИМИ САМИМИ фільтрами, що й список під ним: інакше
  // «Мої 16» над чотирнадцятьма рядками виглядає як загублені задачі.
  // рядок походу в магазин стоїть у кожній вкладці — тож і в кожному бейджі;
  // до проєкту похід не належить, тож у відфільтрованому списку його немає
  const hasShop = !!pending && !projectFilter
  const counts = useMemo(() => {
    const count = (v: View) =>
      tasksHere.filter(x => x.status !== 'done' && showTask(x, v, t, db.meId)).length
      + occHere.filter(o => showBill(o, v, t, db.meId)).length
      + (hasShop ? 1 : 0)
    return { mine: count('mine'), today: count('today'), open: count('open') }
  }, [tasksHere, occHere, db.meId, t, hasShop])

  // платежі живуть у «До виконання» — один список, а не друга секція поруч
  const itemsFor = (status: TaskStatus): Item[] => {
    const rows: Item[] = visible
      .filter(x => x.status === status)
      .map(task => ({ kind: 'task' as const, id: task.id, task }))
    const shopRow = hasShop ? shop : null
    if (status === 'todo') {
      rows.push(...bills.map(occ => ({ kind: 'bill' as const, id: occ.id, occ })))
      if (shopRow && !pinned) rows.push(shopRow)
    }
    const sorted = sortItems(rows)
    // закріплений похід іде першим і не вдає із себе пріоритет, якого не має
    return status === 'todo' && shopRow && pinned ? [shopRow, ...sorted] : sorted
  }

  const openCount = visible.filter(x => x.status !== 'done').length + bills.length + (hasShop ? 1 : 0)

  const done: Item[] = useMemo(() => {
    const since = addDays(t, -7)
    const tasks: Item[] = visible.filter(x => x.status === 'done')
      .map(task => ({ kind: 'task' as const, id: task.id, task }))
    const settled: Item[] = occHere
      .filter(o => (o.status === 'paid' || o.status === 'skipped') && (o.paidOn ?? o.dueDate) >= since)
      .map(occ => ({ kind: 'bill' as const, id: occ.id, occ }))
    return [...tasks, ...settled].sort((a, b) => doneAt(b).localeCompare(doneAt(a)))
  }, [visible, occHere, t])

  const submit = () => {
    const title = draft.trim()
    if (!title) return
    // у відфільтрованому списку нова задача належить тому самому проєкту —
    // інакше вона зникла б із екрана одразу після Enter
    addTask({
      title, assigneeId: view === 'mine' ? db.meId : undefined,
      projectId: projectFilter ?? undefined,
    })
    setDraft('')
  }

  const open = openId ? db.tasks.find(x => x.id === openId) ?? null : null
  const bill = billId ? db.occurrences.find(o => o.id === billId) ?? null : null
  const share = fairness(db)
  const total = share.reduce((s, f) => s + f.done, 0)

  return (
    <div className="max-w-[760px] mx-auto">
      <header className="px-4 pt-3 pb-3 sm:px-6">
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
        {projectFilter && (
          <div className="flex items-center gap-1 mb-1 min-w-0">
            <span className="inline-flex items-center min-w-0 max-w-full rounded-lg border border-line bg-surface text-[13px]">
              <button type="button" className="min-w-0 truncate pl-2.5 pr-1 h-7 text-left hover:text-accent"
                disabled={!filterProject}
                onClick={() => filterProject && nav(projectRoute(filterProject.id))}
                title={filterProject ? 'Відкрити проєкт' : undefined}>
                <span className="text-faint">Проєкт: </span>{filterProject?.name ?? 'не знайдено'}
              </button>
              <button type="button" onClick={() => setProjectFilter(null)} aria-label="Зняти фільтр проєкту"
                className="shrink-0 h-7 w-7 grid place-items-center text-faint hover:text-ink">
                {Icon.x(14)}
              </button>
            </span>
          </div>
        )}
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
            <Rows>
              {rows.map(it =>
                it.kind === 'task' ? <TaskRow key={it.id} task={it.task} onOpen={() => setOpenId(it.id)}
                    onProject={projectFilter ? undefined : setProjectFilter} />
                : it.kind === 'shop' ? <ShopRow key={it.id} item={it} pinned={pinned} onTogglePin={togglePin} />
                : <BillRow key={it.id} o={it.occ} compact onOpen={() => setBillId(it.id)} />)}
            </Rows>
          </section>
        )
      })}

      {beyond > 0 && (
        <div className="px-4 sm:px-6 mt-2 text-[12.5px] text-faint">
          Ще <span className="num">{beyond}</span> {plural(beyond, 'платіж', 'платежі', 'платежів')} далі —
          {view === 'all' ? ' у «Місяці».' : ' у вкладці «Всі».'}
        </div>
      )}

      {openCount === 0 && (
        <Empty>
          <p className="mb-3">
            {projectFilter
              ? 'Тут будуть задачі й платежі цього проєкту. Нова задача з поля вище одразу потрапить у проєкт.'
              : 'Тут збираються побутові задачі й платежі, яким настав час. Поки порожньо — нічого не горить.'}
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
            <Rows>
              {done.slice(0, 30).map(it =>
                it.kind === 'task' ? <TaskRow key={it.id} task={it.task} onOpen={() => setOpenId(it.id)}
                    onProject={projectFilter ? undefined : setProjectFilter} />
                : it.kind === 'shop' ? null
                : <BillRow key={it.id} o={it.occ} compact onOpen={() => setBillId(it.id)} />)}
            </Rows>
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

      {/* Шаблони повторюваних задач — тут, а не в налаштуваннях: правити те, що
          породжує ці рядки, треба на тому ж екрані, де рядки видно.
          Секція згорнута, щоб не тиснути на щоденний список. */}
      <TemplatesSection />

      {/* невідомий id у ?task= — просто нічого не відкриваємо */}
      <TaskSheet task={open} onClose={() => setOpenId(null)} />
      {/* key: стан «спитати суму» належить одному платежу, а не листу взагалі */}
      <BillSheet key={billId ?? 'none'} occ={bill} onClose={() => setBillId(null)} />
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
  // не на вкладку «Покупки», а на крок із задачі — з поверненням у «Задачі»
  const go = () => nav('/tasks/shopping')

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

      {/* на телефоні наведення немає — тож кнопка видима завжди, лише приглушена */}
      <button onClick={onTogglePin}
        aria-label={pinned ? 'Відкріпити' : 'Закріпити зверху'}
        title={pinned ? 'Відкріпити' : 'Закріпити зверху'}
        className={`shrink-0 p-1 -mr-1 rounded transition-colors ${
          pinned ? 'text-accent' : 'text-faint opacity-60 hover:opacity-100 focus-visible:opacity-100'}`}>
        {Icon.pin(15)}
      </button>
    </li>
  )
}

/** Іконка проєкту за напрямом грошей — та сама мова, що в посиланнях. */
function projectIcon(p: Pick<Project, 'direction'>, size = 14) {
  if (p.direction === 'save') return Icon.piggy(size)
  if (p.direction === 'repay') return Icon.list(size)
  if (p.direction === 'spend') return Icon.wallet(size)
  return Icon.check(size)
}

function TaskRow({ task, onOpen, onProject }: {
  task: Task; onOpen: () => void
  /** Тап по чипу проєкту фільтрує список. Немає — список уже відфільтрований, чип зайвий. */
  onProject?: (id: ID) => void
}) {
  const db = useDB()
  const member = db.members.find(m => m.id === task.assigneeId)
  const project = onProject && task.projectId ? db.projects.find(p => p.id === task.projectId) : undefined
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
      <button onClick={() => completeTask(task.id)}
        aria-label={isDone ? `Повернути в роботу: ${task.title}` : `Виконано: ${task.title}`}
        className={`shrink-0 h-[18px] w-[18px] rounded-[5px] border grid place-items-center transition-colors ${
          isDone ? 'bg-accent border-accent text-white' : 'border-line2 hover:border-accent'}`}>
        {isDone && Icon.check(12)}
      </button>

      <button onClick={cyclePriority} className="shrink-0 opacity-90 hover:opacity-100"
        title={priorityLabel(task.priority)}
        aria-label={`Пріоритет: ${priorityLabel(task.priority)}. Змінити`}>
        <PriorityMark p={task.priority} />
      </button>

      <button onClick={onOpen} className="flex-1 min-w-0 text-left">
        <span className={`text-[14px] block truncate ${isDone ? 'line-through text-faint' : ''}`}>{task.title}</span>
      </button>

      {project && (
        <button type="button" onClick={() => onProject?.(project.id)}
          title={`Задачі проєкту «${project.name}»`}
          className="min-w-0 max-w-[30%] sm:max-w-[160px] truncate text-[11.5px] text-faint px-1.5 py-0.5 rounded border border-line hover:text-ink hover:border-line2">
          {project.name}
        </button>
      )}
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

/* ───────────────────────── листи ───────────────────────── */

/**
 * Лист платежу з «Задач»: звʼязки, яких компактний рядок не показує, і ті самі
 * дії, що в рядку (`payBill`) — щоб оплата звідси не відрізнялась від чекліста.
 */
function BillSheet({ occ, onClose }: { occ: Occurrence | null; onClose: () => void }) {
  const db = useDB()
  const nav = useNavigate()
  const [askAmount, setAskAmount] = useState(false)
  if (!occ) return null
  const project = db.projects.find(p => p.id === occ.projectId)
  const income = isIncomeOccurrence(db, occ)
  const month = occ.dueDate.slice(0, 7)
  const plan = occ.planId ? db.recurringPlans.find(p => p.id === occ.planId) : undefined
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
        {member && <span> · {member.name}</span>}
      </div>

      {/* звідки цей платіж і куди лягає — переходами, а не описом */}
      <div className="flex flex-wrap items-center gap-1.5 mb-4">
        {plan && <LinkChip icon="clock" onClick={() => nav(ruleRoute(plan))}>{ruleText(plan)}</LinkChip>}
        {project && !project.isFree && (
          <LinkChip icon={project.direction === 'save' ? 'piggy' : project.direction === 'repay' ? 'list' : 'wallet'}
            onClick={() => nav(projectRoute(project.id))}>
            {project.name}
          </LinkChip>
        )}
      </div>

      {settled ? (
        <div className="text-[13px] text-faint">
          Скасувати підтвердження — квадратом у рядку. Весь місяць — у чеклісті.
          <div className="mt-2">
            {/* чекліст того місяця, де платіж, а не поточного */}
            <Btn onClick={() => nav(monthRoute(month === thisMonth() ? undefined : month))}>
              Відкрити чекліст
            </Btn>
          </div>
        </div>
      ) : askAmount ? (
        // суми в платежу немає — питаємо її тут же, а не мовчки пишемо 0
        <AmountForm o={occ} onDone={() => { setAskAmount(false); onClose() }} />
      ) : (
        <>
          <div className="flex gap-2">
            <Btn variant="primary" full onClick={() => { if (payBill(db, occ)) onClose(); else setAskAmount(true) }}>
              {doneLabel(db, occ)}
            </Btn>
            <Btn onClick={() => { skipOccurrence(occ.id); onClose() }}>Пропустити</Btn>
          </div>
          <div className="text-[12px] text-faint mt-2">
            {income
              ? 'Підтвердження запише надходження у «Вільні гроші».'
              : project && !project.isFree
                ? `Підтвердження запише ${project.direction === 'repay' ? 'погашення' : 'витрату'} в проєкт «${project.name}».`
                : 'Підтвердження запише витрату з вільних грошей.'}
            {' '}Пропуск лишає платіж в історії зі статусом «пропущено».
          </div>
        </>
      )}
    </Sheet>
  )
}

/** Кружечок статусу для меню: порожній → половина → галочка, як читається прогрес. */
function StatusIcon({ s }: { s: TaskStatus }) {
  if (s === 'done') return <span className="text-accent">{Icon.check(14)}</span>
  return (
    <svg width={14} height={14} viewBox="0 0 14 14" aria-hidden
      className={s === 'doing' ? 'text-accent' : 'text-muted'}>
      <circle cx="7" cy="7" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.5"
        strokeDasharray={s === 'backlog' ? '2 2' : undefined} />
      {s === 'doing' && <path d="M7 3.5a3.5 3.5 0 0 1 0 7z" fill="currentColor" />}
    </svg>
  )
}

const STATUS_OPTIONS: MenuOption<TaskStatus>[] = ([
  ['backlog', 'Колись'], ['todo', 'До виконання'], ['doing', 'В роботі'], ['done', 'Зроблено'],
] as [TaskStatus, string][]).map(([value, label]) => ({ value, label, icon: <StatusIcon s={value} /> }))

// 0 — «Без пріоритету», останнім (інваріант 8).
const PRIORITY_OPTIONS: MenuOption<Priority>[] = ([1, 2, 3, 4, 0] as Priority[])
  .map(p => ({ value: p, label: priorityLabel(p), icon: <PriorityMark p={p} size={14} /> }))

// Меню працює з рядками; «вільна» задача в даних — це undefined.
const UNASSIGNED = '__unassigned__'
// так само «без проєкту» (побут) — це undefined
const NO_PROJECT = '__no_project__'

/**
 * Проєкти, до яких можна привʼязати задачу: активні, крім «Вільних».
 * Поточний завершений лишається у списку, інакше меню показало б «Без проєкту»,
 * хоча задача досі в ньому.
 */
function taskProjectOptions(db: DB, currentId?: ID): MenuOption<string>[] {
  const list = payableProjects(db)
  const current = currentId ? db.projects.find(p => p.id === currentId) : undefined
  if (current && !list.includes(current)) list.push(current)
  return [
    { value: NO_PROJECT, label: 'Без проєкту', icon: <span className="text-faint">{Icon.home(14)}</span> },
    ...list.map(p => ({ value: p.id, label: p.name, icon: <span className="text-muted">{projectIcon(p)}</span> })),
  ]
}

function TaskSheet({ task, onClose }: { task: Task | null; onClose: () => void }) {
  const db = useDB()
  const nav = useNavigate()
  if (!task) return null
  const areas = knownAreas(db)
  const project = task.projectId ? db.projects.find(p => p.id === task.projectId) : undefined

  return (
    <Sheet open={!!task} onClose={onClose} title="Задача">
      <input value={task.title} onChange={e => updateTask(task.id, { title: e.target.value })}
        className="w-full text-[16px] font-medium bg-transparent outline-none mb-2" />

      <div className="flex flex-wrap gap-1.5 mb-4">
        <PropertyMenu label="Статус" value={task.status} placeholder="Прибрана"
          options={STATUS_OPTIONS} onChange={s => updateTask(task.id, { status: s })} />
        <PropertyMenu label="Пріоритет" value={task.priority}
          options={PRIORITY_OPTIONS} onChange={p => setPriority(task.id, p)} />
        <PropertyMenu label="Виконавець" value={task.assigneeId ?? UNASSIGNED}
          options={[
            ...db.members.map(m => ({ value: m.id, label: m.name, icon: <Avatar member={m} size={16} /> })),
            { value: UNASSIGNED, label: 'Вільна', icon: <Avatar size={16} /> },
          ]}
          onChange={v => setAssignee(task.id, v === UNASSIGNED ? undefined : v)} />
        <PropertyMenu label="Проєкт" value={task.projectId ?? NO_PROJECT}
          options={taskProjectOptions(db, task.projectId)}
          onChange={v => updateTask(task.id, { projectId: v === NO_PROJECT ? undefined : v })} />
        {/* окремий перехід, а не частина меню: чип меню вибирає, а не веде геть */}
        {project && (
          <span className="inline-flex items-center">
            <LinkChip onClick={() => { onClose(); nav(projectRoute(project.id)) }}>
              відкрити {Icon.chev(11)}
            </LinkChip>
          </span>
        )}
      </div>

      {/* Решта задачі здебільшого порожня: дедлайн, зона, нотатка потрібні
          одиницям. Порожніми полями вони читаються як список обовʼязків. */}
      <OptionalFields items={[
        { key: 'due', label: 'Дедлайн', filled: !!task.dueDate,
          clear: () => updateTask(task.id, { dueDate: undefined }),
          render: remove => (
            <Field label="Дедлайн" htmlFor="task-due" onRemove={remove}>
              <DateInput id="task-due" value={task.dueDate}
                onChange={v => updateTask(task.id, { dueDate: v })} />
            </Field>
          ) },

        { key: 'defer', label: 'Відкласти до', filled: !!task.deferUntil,
          clear: () => updateTask(task.id, { deferUntil: undefined }),
          render: remove => (
            <Field label="Відкласти до" htmlFor="task-defer" onRemove={remove}>
              <DateInput id="task-defer" value={task.deferUntil}
                onChange={v => updateTask(task.id, { deferUntil: v })} />
            </Field>
          ) },

        { key: 'area', label: 'Зона', filled: !!task.area,
          clear: () => updateTask(task.id, { area: undefined }),
          render: remove => (
            <Field label="Зона" htmlFor="task-area" onRemove={remove}>
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
          ) },

        { key: 'notes', label: 'Нотатка', filled: !!task.notes,
          clear: () => updateTask(task.id, { notes: undefined }),
          render: remove => (
            <Field label="Нотатка" htmlFor="task-notes" onRemove={remove}>
              <Textarea id="task-notes" value={task.notes ?? ''} placeholder="Деталі, посилання, що саме треба"
                onChange={v => updateTask(task.id, { notes: v.trim() ? v : undefined })} />
            </Field>
          ) },

        // складність — валюта балансу навантаження і вхід у ротацію least_loaded.
        // Значення є завжди, тож «порожньо» тут — це типова середня.
        { key: 'effort', label: 'Складність', filled: task.effort !== 2,
          clear: () => updateTask(task.id, { effort: 2 }),
          render: remove => (
            <Field label="Складність" hint="Важить у балансі за 28 днів і в черзі повторюваних задач."
              onRemove={remove}>
              <Segmented full value={String(task.effort) as '1' | '2' | '3'} items={EFFORTS}
                onChange={v => updateTask(task.id, { effort: Number(v) as 1 | 2 | 3 })} />
            </Field>
          ) },
      ]} />

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

/* ──────────────── повторювані: шаблони побутових задач ──────────────── */

type Draft = Omit<TaskTemplate, 'id'>

const EMPTY_TPL: Draft = {
  title: '', area: '', effort: 2,
  scheduleKind: 'after_completion', intervalDays: 7,
  rotation: 'least_loaded', active: true,
}

/** Коротко про розклад — те саме, що читає materialize(). */
function scheduleText(t: TaskTemplate | Draft) {
  if (t.scheduleKind === 'after_completion') {
    return `Кожні ${t.intervalDays ?? 7} дн. після виконання`
  }
  if (t.freq === 'monthly') return `Щомісяця, ${t.byMonthDay ?? 1} числа`
  const days = [...(t.byDay ?? [])].sort((a, b) => a - b)
    .map(d => DOW[d - 1]?.l.toLowerCase()).filter(Boolean)
  return days.length ? `Щотижня: ${days.join(', ')}` : 'Щотижня'
}

/** Наступний раз для «після виконання» рахується від останнього виконання. */
function nextAfter(t: TaskTemplate) {
  return addDays(t.lastCompletedAt?.slice(0, 10) ?? today(), t.intervalDays ?? 7)
}

function rotationText(t: TaskTemplate, d: DB) {
  if (t.rotation === 'least_loaded') return 'Кому менше випало'
  const m = d.members.find(x => x.id === t.defaultAssigneeId)
  return m ? m.name : 'Вільна — хто візьме'
}

/**
 * Згорнута секція внизу екрана. Шаблони — це «звідки беруться рядки вище»,
 * тож живуть на тому самому екрані, але нижче балансу: щоденний список
 * лишається головним, а налаштування повторення — під рукою.
 */
function TemplatesSection() {
  const db = useDB()
  const [show, setShow] = useState(false)
  const [editing, setEditing] = useState<TaskTemplate | 'new' | null>(null)

  const sorted = [...db.taskTemplates].sort((a, b) =>
    (a.area ?? '').localeCompare(b.area ?? '', 'uk') || a.title.localeCompare(b.title, 'uk'))
  const active = sorted.filter(t => t.active)
  const paused = sorted.filter(t => !t.active)

  const startNew = () => { setShow(true); setEditing('new') }

  return (
    <section className="mt-8 pb-10">
      <div className="px-4 sm:px-6 mb-1 flex items-center justify-between gap-3">
        <button onClick={() => setShow(v => !v)} aria-expanded={show}
          className="flex items-center gap-1.5 text-[12px] uppercase tracking-wider text-faint font-medium">
          <span className={`transition-transform ${show ? 'rotate-90' : ''}`}>{Icon.chev(13)}</span>
          Повторювані
          {active.length > 0 && <span className="num">{active.length}</span>}
        </button>
        {show && <Btn onClick={startNew}>{Icon.plus(16)} Шаблон</Btn>}
      </div>

      {show && (
        <>
          <p className="px-4 sm:px-6 text-[12.5px] text-faint mb-2 leading-snug">
            Шаблон сам кладе задачу в список, коли настає час. Руками додавати нічого не треба.
          </p>

          {db.taskTemplates.length === 0 ? (
            <Empty>
              <p className="mb-3">
                Тут живе те, що повторюється: пропилососити, полити квіти, винести сміття.<br />
                Шаблон сам покладе задачу в «Сьогодні», коли настане час.
              </p>
              <Btn variant="primary" onClick={startNew}>{Icon.plus(16)} Створити шаблон</Btn>
            </Empty>
          ) : (
            <>
              {active.length === 0 ? (
                <div className="px-4 sm:px-6">
                  <Card>
                    <p className="text-[13.5px] text-faint">
                      Усі шаблони вимкнені — нові задачі не з'являються.
                    </p>
                  </Card>
                </div>
              ) : (
                <Rows>
                  {active.map(t => <TemplateRow key={t.id} tpl={t} db={db} onOpen={() => setEditing(t)} />)}
                </Rows>
              )}

              {paused.length > 0 && (
                <>
                  <div className="px-4 sm:px-6 mt-4 mb-1 text-[12px] uppercase tracking-wider text-faint font-medium">
                    Вимкнені
                  </div>
                  <Rows className="opacity-70">
                    {paused.map(t => <TemplateRow key={t.id} tpl={t} db={db} onOpen={() => setEditing(t)} />)}
                  </Rows>
                </>
              )}
            </>
          )}
        </>
      )}

      <Sheet open={editing !== null} onClose={() => setEditing(null)}
             title={editing === 'new' ? 'Новий шаблон' : 'Шаблон'}>
        {editing !== null && (
          <TemplateForm
            db={db}
            initial={editing === 'new' ? EMPTY_TPL : stripId(editing)}
            onSave={patch => {
              if (editing === 'new') addTaskTemplate(patch)
              else updateTaskTemplate(editing.id, patch)
              setEditing(null)
            }}
            onCancel={() => setEditing(null)}
            onDelete={editing === 'new' ? undefined : () => { removeTaskTemplate(editing.id); setEditing(null) }}
          />
        )}
      </Sheet>
    </section>
  )
}

function stripId(t: TaskTemplate): Draft {
  const { id: _id, ...rest } = t
  return rest
}

function TemplateRow({ tpl, db, onOpen }: { tpl: TaskTemplate; db: DB; onOpen: () => void }) {
  const assignee = db.members.find(m => m.id === tpl.defaultAssigneeId)
  const after = tpl.scheduleKind === 'after_completion'
  const next = after ? relativeDue(nextAfter(tpl)) : undefined

  return (
    <li>
      <button onClick={onOpen}
        className="w-full text-left flex items-center gap-3 px-4 sm:px-6 py-3 hover:bg-surface2/60 transition-colors">
        {tpl.rotation === 'least_loaded'
          ? <span className="shrink-0 text-faint" title="Кому менше випало">{Icon.list(18)}</span>
          : <Avatar member={assignee} size={22} />}

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[14px]">{tpl.title}</span>
            {tpl.area && <Badge>{tpl.area}</Badge>}
            {tpl.projectId && db.projects.find(p => p.id === tpl.projectId) && (
              <Badge>{db.projects.find(p => p.id === tpl.projectId)!.name}</Badge>
            )}
            {!tpl.active && <Badge tone="warn">вимкнено</Badge>}
          </div>
          <div className="text-[12.5px] text-faint">
            {scheduleText(tpl)} · {rotationText(tpl, db)} · {EFFORT_LABEL[tpl.effort]}
          </div>
          {after && (
            <div className="text-[12.5px] text-faint">
              {tpl.lastCompletedAt
                ? `Востаннє: ${relativeDue(tpl.lastCompletedAt.slice(0, 10)).label}`
                : 'Ще жодного разу'}
              {tpl.active && next && (
                <> · наступний раз <span className={next.tone === 'over' ? 'text-warn' : ''}>{next.label}</span></>
              )}
            </div>
          )}
        </div>
        <span className="text-faint shrink-0">{Icon.chev(16)}</span>
      </button>
    </li>
  )
}

function TemplateForm({ db, initial, onSave, onCancel, onDelete }: {
  db: DB
  initial: Draft
  onSave: (patch: Draft) => void
  onCancel: () => void
  onDelete?: () => void
}) {
  const [title, setTitle] = useState(initial.title)
  const [area, setArea] = useState(initial.area ?? '')
  const [effort, setEffort] = useState<'1' | '2' | '3'>(String(initial.effort) as '1' | '2' | '3')
  const [kind, setKind] = useState<TaskTemplate['scheduleKind']>(initial.scheduleKind)
  const [freq, setFreq] = useState<'weekly' | 'monthly'>(initial.freq === 'monthly' ? 'monthly' : 'weekly')
  const [byDay, setByDay] = useState<number[]>(initial.byDay ?? [])
  const [byMonthDay, setByMonthDay] = useState(String(initial.byMonthDay ?? 1))
  const [interval, setInterval] = useState(String(initial.intervalDays ?? 7))
  const [rotation, setRotation] = useState<TaskTemplate['rotation']>(initial.rotation)
  const [assignee, setAssignee] = useState<ID | undefined>(initial.defaultAssigneeId)
  const [active, setActive] = useState(initial.active)
  const [projectId, setProjectId] = useState(initial.projectId ?? '')

  /** Видалення дають лише наявному шаблону — по ньому й розрізняємо новий. */
  const isNew = !onDelete

  const areas = knownAreas(db)
  const days = Number(interval)
  const mday = Number(byMonthDay)

  const scheduleOk = kind === 'after_completion'
    ? Number.isFinite(days) && days >= 1
    : freq === 'monthly' ? mday >= 1 && mday <= 31 : byDay.length > 0
  const ok = title.trim().length > 0 && scheduleOk

  function submit() {
    if (!ok) return
    onSave({
      title: title.trim(),
      area: area.trim() || undefined,
      effort: Number(effort) as 1 | 2 | 3,
      scheduleKind: kind,
      freq: kind === 'fixed' ? freq : undefined,
      byDay: kind === 'fixed' && freq === 'weekly' ? [...byDay].sort((a, b) => a - b) : undefined,
      byMonthDay: kind === 'fixed' && freq === 'monthly' ? mday : undefined,
      intervalDays: kind === 'after_completion' ? days : undefined,
      lastCompletedAt: initial.lastCompletedAt,
      rotation,
      defaultAssigneeId: rotation === 'least_loaded' ? undefined : assignee,
      projectId: projectId || undefined,
      active,
    })
  }

  return (
    <div>
      <Field label="Що робимо" htmlFor="tpl-title">
        <Input id="tpl-title" value={title} onChange={setTitle} autoFocus
               placeholder="Пропилососити" onEnter={submit} />
      </Field>

      <Field label="Коли повторювати">
        <Segmented<TaskTemplate['scheduleKind']> full value={kind} onChange={setKind} label="Режим розкладу"
          items={[{ value: 'fixed', label: 'За календарем' }, { value: 'after_completion', label: 'Після виконання' }]} />
      </Field>

      {/* Різниця між режимами — головне, що тут треба зрозуміти, тож текст поруч. */}
      <p className="text-[12.5px] text-faint -mt-1 mb-3 leading-snug">
        {kind === 'fixed'
          ? 'Задача з\'являється в конкретні дні за календарем, незалежно від того, коли її зробили востаннє.'
          : 'Відлік іде від останнього виконання. Відкритий екземпляр завжди рівно один: поки попередній не закритий, новий не з\'являється, і прострочення не накопичуються. Після двох тижнів відпустки вас чекає одна задача, а не вісім.'}
      </p>

      {kind === 'fixed' ? (
        <>
          <Field label="Як часто">
            <Segmented<'weekly' | 'monthly'> full value={freq} onChange={setFreq} label="Періодичність"
              items={[{ value: 'weekly', label: 'Щотижня' }, { value: 'monthly', label: 'Щомісяця' }]} />
          </Field>

          {freq === 'weekly' ? (
            <Field label="Дні тижня"
                   error={byDay.length === 0 ? 'Виберіть хоча б один день' : undefined}
                   hint="Можна кілька: наприклад вт і пт">
              <div className="flex gap-1.5 flex-wrap">
                {DOW.map(d => (
                  <Pill key={d.v} active={byDay.includes(d.v)}
                    onClick={() => setByDay(byDay.includes(d.v) ? byDay.filter(x => x !== d.v) : [...byDay, d.v])}>
                    {d.l}
                  </Pill>
                ))}
              </div>
            </Field>
          ) : (
            <Field label="Число місяця" htmlFor="tpl-mday"
                   hint="Якщо в місяці менше днів — візьмемо останній">
              <Select id="tpl-mday" value={byMonthDay} onChange={setByMonthDay}
                options={Array.from({ length: 31 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }))} />
            </Field>
          )}
        </>
      ) : (
        <>
          <Field label="Раз на скільки днів" htmlFor="tpl-interval"
                 error={!scheduleOk ? 'Потрібне число днів, від 1' : undefined}
                 hint={scheduleOk ? `Наступна задача з'явиться через ${days} дн. після того, як закриють попередню` : undefined}>
            <Input id="tpl-interval" value={interval} onChange={setInterval}
                   inputMode="numeric" align="right" placeholder="7" onEnter={submit} />
          </Field>
          <div className="flex gap-1.5 flex-wrap -mt-1 mb-3">
            {INTERVALS.map(n => (
              <Pill key={n} active={days === n} onClick={() => setInterval(String(n))}>{n} дн.</Pill>
            ))}
          </div>
          {initial.lastCompletedAt && (
            <p className="text-[12.5px] text-faint -mt-1 mb-3">
              Востаннє робили <span className="num">{shortDate(initial.lastCompletedAt.slice(0, 10))}</span>
              {scheduleOk && (
                <> · наступний раз <span className="num">
                  {shortDate(addDays(initial.lastCompletedAt.slice(0, 10), days))}
                </span></>
              )}
            </p>
          )}
        </>
      )}

      <Field label="На кого">
        <Segmented<TaskTemplate['rotation']> full value={rotation} onChange={setRotation} label="Ротація"
          items={[
            { value: 'none', label: 'Вручну' },
            { value: 'fixed', label: 'Завжди один' },
            { value: 'least_loaded', label: 'По черзі' },
          ]} />
      </Field>

      <p className="text-[12.5px] text-faint -mt-1 mb-3 leading-snug">
        {rotation === 'least_loaded'
          ? 'Задача дістається тому, у кого менше навантаження за останні 28 днів — з урахуванням складності. Навантаження це не лише задачі: походи в магазин і підтверджені платежі теж рахуються, тож вибір може не збігтися з кількістю задач у списку. Це та сама цифра, що в смузі «Баланс за 28 днів» вище.'
          : rotation === 'fixed'
            ? 'Кожен екземпляр одразу на цю людину.'
            : 'Задача створюється вільною або на вибрану людину — далі можна перепризначити руками.'}
      </p>

      {rotation !== 'least_loaded' && (
        <Field label="Виконавець"
               error={rotation === 'fixed' && !assignee ? 'Виберіть, на кого' : undefined}>
          <div className="flex gap-1.5 flex-wrap">
            {rotation === 'none' && (
              <Pill active={!assignee} onClick={() => setAssignee(undefined)}>
                <Avatar size={18} /> Вільна
              </Pill>
            )}
            {db.members.map(m => (
              <Pill key={m.id} active={assignee === m.id} onClick={() => setAssignee(m.id)}>
                <Avatar member={m} size={18} /> {m.name}
              </Pill>
            ))}
          </div>
        </Field>
      )}

      {/* Зона і складність мають розумні типові значення — до них доходять
          одиниці, тож вони згорнуті в кнопки, а не займають форму. */}
      <OptionalFields items={[
        { key: 'area', label: 'Зона', filled: area.trim().length > 0, clear: () => setArea(''),
          render: remove => (
            <Field label="Зона" htmlFor="tpl-area" hint="Просто щоб згрупувати" onRemove={remove}>
              <Input id="tpl-area" value={area} onChange={setArea} placeholder="Кухня, авто, документи…" />
              {areas.length > 0 && (
                <div className="flex gap-1 flex-wrap mt-1.5">
                  {areas.map(a => (
                    <Pill key={a} active={area.trim() === a}
                      onClick={() => setArea(area.trim() === a ? '' : a)}>{a}</Pill>
                  ))}
                </div>
              )}
            </Field>
          ) },

        // складність завжди має значення, тож «порожньо» тут — це типова середня
        { key: 'effort', label: 'Складність', filled: effort !== '2', clear: () => setEffort('2'),
          render: remove => (
            <Field label="Складність" hint="Важить у балансі за 28 днів і в черзі повторюваних задач."
              onRemove={remove}>
              <Segmented<'1' | '2' | '3'> full value={effort} onChange={setEffort} label="Складність" items={EFFORTS} />
            </Field>
          ) },

        { key: 'project', label: 'Проєкт', filled: !!projectId, clear: () => setProjectId(''),
          render: remove => (
            <Field label="Проєкт" htmlFor="tpl-project" onRemove={remove}
              hint="Для порядку: побутова задача зазвичай живе без проєкту.">
              <Select id="tpl-project" value={projectId} onChange={setProjectId} placeholder="Без проєкту"
                options={taskProjectOptions(db, initial.projectId)
                  .filter(o => o.value !== NO_PROJECT)
                  .map(o => ({ value: o.value, label: o.label }))} />
            </Field>
          ) },
      ]} />

      {/* Новий шаблон завжди активний — перемикач тут лише заважає. */}
      {!isNew && (
        <div className="border-t border-line pt-2 mt-1">
          <Switch checked={active} onChange={setActive} label="Шаблон активний"
                  hint={active ? 'Створює нові задачі за розкладом' : 'Нові задачі не створюються, наявні лишаються'} />
        </div>
      )}

      {scheduleOk && (
        <div className="mt-3 rounded-lg bg-surface2 px-3 py-2 text-[12.5px] text-muted">
          {scheduleText({
            ...initial, scheduleKind: kind, freq: kind === 'fixed' ? freq : undefined,
            byDay, byMonthDay: mday, intervalDays: days,
          })}
        </div>
      )}

      <FormActions
        onSubmit={submit}
        onCancel={onCancel}
        disabled={!ok}
        destructive={onDelete && (
          <ConfirmButton confirmLabel="Видалити разом із задачами?" onConfirm={onDelete}>
            Видалити
          </ConfirmButton>
        )}
      />
      {onDelete && (
        <p className="text-[12px] text-faint mt-2">
          Разом із шаблоном зникнуть його ще не виконані екземпляри. Виконане лишиться в історії.
        </p>
      )}
    </div>
  )
}

/** Зони, які вже вживаються — щоб не вигадувати нову назву щоразу. */
function knownAreas(db: DB): string[] {
  const set = new Set<string>()
  db.tasks.forEach(t => { if (t.area && t.status !== 'dropped') set.add(t.area) })
  db.taskTemplates.forEach(t => { if (t.area) set.add(t.area) })
  return [...set].sort((a, b) => a.localeCompare(b, 'uk'))
}
