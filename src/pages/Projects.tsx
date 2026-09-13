import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Badge, Btn, Card, Empty, Icon, Progress, Rows, SectionTitle, Sheet, useSheet } from '../ui'
import { useDB, freeBalance, freeProject, projectStatus } from '../data/store'
import { projectRoute } from '../data/links'
import { money } from '../lib/money'
import type { DB, Project, ProjectDirection } from '../data/types'
import { DIRECTIONS, ProjectForm, monthYear, spendGuide, tasksWord } from '../components/ProjectForm'

/* ─────────────── шаблони ─────────────── */

interface Template {
  key: string
  title: string
  examples: string
  /** Лише передзаповнення: ключ без значення розгортає поле у формі. */
  fill: (db: DB) => Partial<Project>
  /** куди вести після створення: регулярним платежам одразу потрібні правила */
  tab?: 'bills' | 'tasks'
}

const TEMPLATES: Template[] = [
  { key: 'daily', title: 'Щоденні витрати', examples: 'Продукти, транспорт, розваги',
    fill: () => ({ direction: 'spend', monthlyMinor: 0 }) },
  { key: 'bills', title: 'Регулярні платежі', examples: 'Житло, підписки, звʼязок',
    fill: () => ({ direction: 'spend' }), tab: 'bills' },
  { key: 'goal', title: 'Ціль', examples: 'Відпустка, страховка, ТО',
    fill: () => ({ direction: 'save', targetMinor: 0, endsOn: undefined }) },
  { key: 'reserve', title: 'Запас', examples: 'Подушка, на чорний день',
    fill: () => ({ direction: 'save', monthlyMinor: 0 }) },
  { key: 'debt', title: 'Борг', examples: 'Кредит, позика в батьків',
    fill: () => ({ direction: 'repay', targetMinor: 0 }) },
  { key: 'oneoff', title: 'Разовий бюджет', examples: 'Ремонт, весілля, переїзд',
    fill: () => ({ direction: 'spend', targetMinor: 0, endsOn: undefined }) },
  { key: 'personal', title: 'Особисті', examples: 'Кишенькові кожному',
    fill: db => ({ direction: 'spend', monthlyMinor: 0, ownerId: db.meId }) },
  { key: 'none', title: 'Без грошей', examples: 'Документи, дача, свято',
    fill: () => ({ direction: 'none' }), tab: 'tasks' },
]

/* ─────────────── ключове число рядка ─────────────── */

const openTasks = (db: DB, id: string) =>
  db.tasks.filter(t => t.projectId === id && t.status !== 'done' && t.status !== 'dropped').length

/** Один рядок проєкту: назва, власник, прогрес і те число, заради якого його відкривають. */
function ProjectRow({ db, p, onOpen }: { db: DB; p: Project; onOpen: () => void }) {
  const owner = db.members.find(m => m.id === p.ownerId)
  const muted = p.status !== 'active'
  let bar: { value: number; pending?: number; tone: 'accent' | 'warn' | 'neutral' } | null = null
  let main = ''
  const notes: { text: string; warn?: boolean }[] = []

  if (p.direction === 'spend') {
    const s = projectStatus(db, p.id)
    const g = spendGuide(db, p)
    const actual = g.whole ? s.totalSpent : s.monthActual
    if (g.base > 0) {
      main = `${money(actual, 'UAH')} / ${money(g.base, 'UAH')}${g.whole ? '' : ' цього місяця'}`
      bar = { value: actual / g.base, pending: g.whole ? 0 : s.monthOpen / g.base, tone: actual > g.base ? 'warn' : 'accent' }
    } else {
      main = `${money(actual, 'UAH')} цього місяця`
    }
  } else if (p.direction === 'save') {
    const s = projectStatus(db, p.id)
    main = s.target ? `${money(s.balance, p.currency)} / ${money(s.target, p.currency)}` : `${money(s.balance, p.currency)} зібрано`
    if (s.target) bar = { value: s.progress, tone: 'accent' }
    if (!muted && s.toSetAside > 0) notes.push({ text: `відкласти ще ${money(s.toSetAside, p.currency)}` })
    if (!muted && !s.onTrack) notes.push({ text: 'відстаємо', warn: true })
  } else if (p.direction === 'repay') {
    const s = projectStatus(db, p.id)
    main = s.remaining ? `лишилось ${money(s.remaining, p.currency)}` : 'виплачено'
    if (s.target) bar = { value: s.progress, tone: 'accent' }
    if (s.payoff) notes.push({ text: `закриємо ~ ${monthYear(s.payoff)}`, warn: !s.onTrack })
  } else {
    const n = openTasks(db, p.id)
    main = n ? tasksWord(n) : 'відкритих задач немає'
  }

  return (
    <li>
      <button type="button" onClick={onOpen}
        className="w-full text-left px-4 sm:px-6 py-3 hover:bg-surface2 transition-colors">
        <div className="flex items-center gap-2 min-w-0">
          {p.pinned && <span className="shrink-0 text-faint" aria-label="Закріплено">{Icon.pin(13)}</span>}
          <span className={`flex-1 min-w-0 truncate text-[14.5px] ${muted ? 'text-muted' : ''}`}>{p.name}</span>
          {owner && <Badge>{owner.name}</Badge>}
          {p.status === 'done' && <Badge>завершено</Badge>}
          {p.status === 'archived' && <Badge>в архіві</Badge>}
          <span className="shrink-0 text-faint">{Icon.chev(14)}</span>
        </div>
        {bar && <div className="mt-2"><Progress value={bar.value} pending={bar.pending} tone={muted ? 'neutral' : bar.tone} height={4} /></div>}
        <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 text-[12.5px]">
          <span className={`num ${bar?.tone === 'warn' && !muted ? 'text-warn' : 'text-muted'}`}>{main}</span>
          {notes.map(n => (
            <span key={n.text} className={`num ${n.warn ? 'text-warn' : 'text-faint'}`}>· {n.text}</span>
          ))}
        </div>
      </button>
    </li>
  )
}

const bySort = (a: Project, b: Project) =>
  Number(!!b.pinned) - Number(!!a.pinned) || a.sortOrder - b.sortOrder

/* ─────────────── екран ─────────────── */

export default function Projects() {
  const db = useDB()
  const nav = useNavigate()
  // лист створення в адресі: ?new=pick — вибір шаблону, ?new=<шаблон> — форма
  const [newParam, setNew] = useSheet('new')
  const [showClosed, setShowClosed] = useState(false)

  const free = freeProject(db)
  const balance = freeBalance(db)
  const others = db.projects.filter(p => !p.isFree)
  const active = others.filter(p => p.status === 'active')
  const closed = others.filter(p => p.status !== 'active').sort(bySort)
  const template = newParam && newParam !== 'pick' ? TEMPLATES.find(t => t.key === newParam) : undefined

  const open = (p: Project) => nav(projectRoute(p.id))
  const created = (id?: string) => {
    if (!id) { setNew('pick'); return }
    const tab = template?.tab
    setNew(null)
    nav(projectRoute(id) + (tab ? `?tab=${tab}` : ''))
  }

  return (
    <div className="max-w-[980px] mx-auto pb-10">
      <div className="px-4 sm:px-6 pt-3">
        {/* «Вільні гроші» — не проєкт серед інших, а відповідь на головне питання */}
        <Card padded={false}>
          <button type="button" disabled={!free} onClick={() => free && nav(projectRoute(free.id))}
            className="w-full text-left p-4 flex items-center gap-3 rounded-xl hover:bg-surface2 transition-colors disabled:hover:bg-transparent">
            <span className="flex-1 min-w-0">
              <span className="block text-[12px] uppercase tracking-wider text-faint">{free?.name ?? 'Вільні гроші'}</span>
              <span className={`block text-[28px] font-semibold num leading-tight ${balance < 0 ? 'text-warn' : ''}`}>
                {money(balance, 'UAH')}
              </span>
              <span className="block text-[12.5px] text-faint">
                {balance < 0 ? 'обіцяли більше, ніж є' : 'нікому не обіцяні'}
              </span>
            </span>
            {free && <span className="shrink-0 text-faint">{Icon.chev(16)}</span>}
          </button>
        </Card>
      </div>

      <div className="px-4 sm:px-6 mt-4 flex items-center justify-between">
        <p className="text-[13px] text-muted">
          {active.length ? `${active.length} в роботі` : ''}
        </p>
        {others.length > 0 && <Btn onClick={() => setNew('pick')}>{Icon.plus(16)} Проєкт</Btn>}
      </div>

      {others.length === 0 ? (
        <Empty>
          <p className="max-w-[44ch] mx-auto">
            Проєкт — це все, на що йдуть гроші чи сили: продукти й житло, відпустка,
            борг, ремонт або документи на авто. Почніть із шаблону — поля заповняться самі.
          </p>
          <div className="mt-4">
            <Btn variant="primary" onClick={() => setNew('pick')}>{Icon.plus(16)} Створити проєкт</Btn>
          </div>
        </Empty>
      ) : (
        DIRECTIONS.map(d => {
          const list = active.filter(p => p.direction === d.value).sort(bySort)
          if (!list.length) return null
          return (
            <section key={d.value} className="mt-2">
              <div className="sm:px-6"><SectionTitle>{d.label}</SectionTitle></div>
              <Rows>{list.map(p => <ProjectRow key={p.id} db={db} p={p} onOpen={() => open(p)} />)}</Rows>
            </section>
          )
        })
      )}

      {closed.length > 0 && (
        <section className="mt-6">
          <div className="px-4 sm:px-6">
            <button type="button" onClick={() => setShowClosed(v => !v)} aria-expanded={showClosed}
              className="inline-flex items-center gap-1.5 text-[12px] uppercase tracking-wider text-faint font-medium hover:text-ink mb-2">
              <span className={`transition-transform ${showClosed ? 'rotate-90' : ''}`}>{Icon.chev(12)}</span>
              Завершені й архів <span className="num">{closed.length}</span>
            </button>
          </div>
          {showClosed && <Rows>{closed.map(p => <ProjectRow key={p.id} db={db} p={p} onOpen={() => open(p)} />)}</Rows>}
        </section>
      )}

      <Sheet open={newParam === 'pick' || !!template} onClose={() => setNew(null)}
        title={template ? template.title : 'Новий проєкт'}>
        {newParam === 'pick' && (
          <div>
            <p className="text-[12.5px] text-faint mb-3">Шаблон лише заповнює поля — усе можна змінити.</p>
            <div className="grid grid-cols-2 gap-2">
              {TEMPLATES.map(t => (
                <button key={t.key} type="button" onClick={() => setNew(t.key)}
                  className="text-left rounded-xl border border-line bg-surface p-3 hover:border-accent hover:bg-surface2 transition-colors">
                  <span className="block text-[14px] font-medium">{t.title}</span>
                  <span className="block text-[11.5px] text-faint mt-0.5">{dirLabel(t.fill(db).direction)}</span>
                  <span className="block text-[12px] text-muted mt-1 leading-snug">{t.examples}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {template && (
          <ProjectForm key={template.key} db={db} editing={null} template={template.fill(db)} onDone={created} />
        )}
      </Sheet>
    </div>
  )
}

const dirLabel = (d?: ProjectDirection) => DIRECTIONS.find(x => x.value === d)?.label.toLowerCase() ?? ''
