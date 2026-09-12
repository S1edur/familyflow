import { useMemo, useState } from 'react'
import { Avatar, Btn, Empty, Icon, PriorityMark, Sheet, Tabs, priorityLabel } from '../components/ui'
import { useDB, addTask, completeTask, updateTask, setPriority, setAssignee, fairness } from '../data/store'
import type { Priority, Task, TaskStatus } from '../data/types'
import { addDays, relativeDue, today } from '../lib/dates'

type View = 'mine' | 'today' | 'all' | 'open'

const GROUPS: { status: TaskStatus; label: string }[] = [
  { status: 'doing',   label: 'В роботі' },
  { status: 'todo',    label: 'До виконання' },
  { status: 'backlog', label: 'Колись' },
]

export default function Tasks() {
  const db = useDB()
  const [view, setView] = useState<View>('mine')
  const [draft, setDraft] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [showDone, setShowDone] = useState(false)

  const visible = useMemo(() => {
    const t = today()
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
  }, [db.tasks, view, db.meId])

  const counts = {
    mine: db.tasks.filter(x => (x.assigneeId === db.meId || !x.assigneeId) && x.status !== 'done' && x.status !== 'dropped').length,
    today: db.tasks.filter(x => x.dueDate && x.dueDate <= today() && x.status !== 'done').length,
    open: db.tasks.filter(x => !x.assigneeId && x.status !== 'done' && x.status !== 'dropped').length,
  }

  const done = visible.filter(x => x.status === 'done')
    .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''))

  const submit = () => {
    const title = draft.trim()
    if (!title) return
    addTask({ title, assigneeId: view === 'mine' ? db.meId : undefined })
    setDraft('')
  }

  const open = openId ? db.tasks.find(t => t.id === openId) ?? null : null
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
          <input value={draft} onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') submit() }}
            placeholder="Нова задача — Enter, щоб додати"
            className="flex-1 bg-transparent outline-none text-[14px] placeholder:text-faint" />
        </div>
      </div>

      {GROUPS.map(g => {
        const rows = sortTasks(visible.filter(x => x.status === g.status))
        if (!rows.length) return null
        return (
          <section key={g.status} className="mt-4">
            <div className="px-4 sm:px-6 mb-1 flex items-baseline gap-2">
              <h2 className="text-[12px] uppercase tracking-wider text-faint font-medium">{g.label}</h2>
              <span className="text-[12px] text-faint num">{rows.length}</span>
            </div>
            <ul className="border-y border-line divide-y divide-line bg-surface">
              {rows.map(t => <Row key={t.id} task={t} onOpen={() => setOpenId(t.id)} />)}
            </ul>
          </section>
        )
      })}

      {visible.filter(x => x.status !== 'done').length === 0 && (
        <Empty>Порожньо. Це або перемога, або нікуди не записали.</Empty>
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
              {done.slice(0, 30).map(t => <Row key={t.id} task={t} onOpen={() => setOpenId(t.id)} />)}
            </ul>
          )}
        </section>
      )}

      {/* баланс навантаження */}
      <section className="px-4 sm:px-6 mt-8">
        <h2 className="text-[12px] uppercase tracking-wider text-faint font-medium mb-2">Баланс за 28 днів</h2>
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
            <span key={s.member.id}>
              {s.member.name}
              {!balanced(share) && total > 0 && <span className="num"> · {Math.round((s.done / total) * 100)}%</span>}
            </span>
          ))}
        </div>
        {balanced(share) && <div className="text-[12.5px] text-faint mt-1">Приблизно порівну</div>}
      </section>

      <TaskSheet task={open} onClose={() => setOpenId(null)} />
    </div>
  )
}

function balanced(share: { done: number }[]) {
  const total = share.reduce((s, x) => s + x.done, 0)
  if (!total) return true
  return share.every(s => s.done / total >= 0.4 && s.done / total <= 0.6)
}

function sortTasks(rows: Task[]) {
  return [...rows].sort((a, b) => {
    // 0 = без пріоритету, завжди в кінці
    const pa = a.priority === 0 ? 9 : a.priority
    const pb = b.priority === 0 ? 9 : b.priority
    if (pa !== pb) return pa - pb
    if (!!a.dueDate !== !!b.dueDate) return a.dueDate ? -1 : 1
    if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate)
    return a.createdAt.localeCompare(b.createdAt)
  })
}

function Row({ task, onOpen }: { task: Task; onOpen: () => void }) {
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

function TaskSheet({ task, onClose }: { task: Task | null; onClose: () => void }) {
  const db = useDB()
  if (!task) return null
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

      <Field label="Дедлайн">
        <input type="date" value={task.dueDate ?? ''}
          onChange={e => updateTask(task.id, { dueDate: e.target.value || undefined })}
          className="h-10 px-3 rounded-lg border border-line bg-surface text-[14px]" />
      </Field>

      <Field label="Відкласти до">
        <input type="date" value={task.deferUntil ?? ''}
          onChange={e => updateTask(task.id, { deferUntil: e.target.value || undefined })}
          className="h-10 px-3 rounded-lg border border-line bg-surface text-[14px]" />
      </Field>

      <div className="flex gap-2 mt-4">
        <Btn variant="primary" full onClick={() => { completeTask(task.id); onClose() }}>
          {task.status === 'done' ? 'Повернути в роботу' : 'Виконано'}
        </Btn>
        <Btn variant="danger" onClick={() => { updateTask(task.id, { status: 'dropped' }); onClose() }}>Прибрати</Btn>
      </div>
    </Sheet>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <div className="text-[11.5px] uppercase tracking-wider text-faint mb-1.5">{label}</div>
      {children}
    </div>
  )
}

function Pill({ active, onClick, children }: { active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={`inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-[13px] border transition-colors ${
        active ? 'border-accent text-accent bg-accentSoft' : 'border-line text-muted hover:bg-surface2'}`}>
      {children}
    </button>
  )
}
