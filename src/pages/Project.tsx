import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  Avatar, Badge, Btn, Card, Empty, Field, Icon, Input, LinkChip, MoneyInput, OptionalFields,
  Progress, Rows, SectionTitle, Select, Sheet, Stat, Tabs, toast, useSheet,
} from '../ui'
import {
  useDB, addEntry, addTask, completeTask, freeBalance, freeEntries, fundProject,
  projectEntries, projectStatus, removeEntry, spendOnProject, transferEnd,
} from '../data/store'
import { nextDue, projectPlans, projectRoute, ruleText } from '../data/links'
import { money } from '../lib/money'
import { addMonths, monthKey, monthTitle, relativeDue, shortDate, thisMonth, today } from '../lib/dates'
import { BillRow } from '../components/BillRow'
import { OneOffForm, RuleForm } from '../components/RuleForm'
import {
  DIRECTIONS, ProjectForm, monthYear, monthsWord, spendGuide, tasksWord,
} from '../components/ProjectForm'
import type { DB, Entry, ID, Project as ProjectT, Task } from '../data/types'

type Tab = 'money' | 'bills' | 'tasks' | 'settings'
type MoveKind = 'fund' | 'spend' | 'repay' | 'income' | 'start' | 'setAside'
interface Move { kind: MoveKind; amount: number; note: string; target: string }

const START_NOTE = 'Стартовий залишок'

/** «5 вер» або «5 вер 2025», якщо рік не поточний. */
function dateLabel(isoDate: string) {
  return isoDate.slice(0, 4) === today().slice(0, 4) ? shortDate(isoDate) : `${shortDate(isoDate)} ${isoDate.slice(0, 4)}`
}

export default function Project() {
  const { id = '' } = useParams()
  const db = useDB()
  const nav = useNavigate()
  const project = db.projects.find(p => p.id === id)

  // Дані ще не приїхали з бази або проєкт прибрали — спокійно, без падіння
  if (!project) {
    return (
      <div className="max-w-[980px] mx-auto px-4 sm:px-6">
        <Empty>
          <p className="max-w-[40ch] mx-auto">
            Такого проєкту тут немає. Можливо, дані ще завантажуються або проєкт прибрали.
          </p>
          <div className="mt-4"><Btn onClick={() => nav('/projects')}>До всіх проєктів</Btn></div>
        </Empty>
      </div>
    )
  }
  return <ProjectView key={project.id} db={db} project={project} />
}

/* ─────────────── сторінка ─────────────── */

function ProjectView({ db, project }: { db: DB; project: ProjectT }) {
  const nav = useNavigate()
  const id = project.id
  const isFree = !!project.isFree
  const dir = project.direction
  const active = project.status === 'active'
  const s = isFree ? undefined : projectStatus(db, id)

  const [tabParam, setTabParam] = useSheet('tab')
  const [ruleParam, setRule] = useSheet('rule')
  const [flowParam] = useSheet('flow')
  const [startParam, setStart] = useSheet('start')

  const month = thisMonth()
  const monthOcc = db.occurrences
    .filter(o => o.projectId === id && monthKey(o.dueDate) === month)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
  const openOcc = monthOcc.filter(o => o.status === 'due' || o.status === 'projected').length
  const tasks = db.tasks.filter(t => t.projectId === id && t.status !== 'dropped')
  const openTaskCount = tasks.filter(t => t.status !== 'done').length
  const entries = isFree ? freeEntries(db) : projectEntries(db, id)

  // Проєкт без грошей живе задачами; вкладка «Гроші» лише якщо щось таки записали
  const tabs: { value: Tab; label: string; badge?: number }[] = [
    ...(dir !== 'none' || entries.length ? [{ value: 'money' as const, label: 'Гроші' }] : []),
    { value: 'bills', label: isFree ? 'Надходження' : 'Платежі', badge: openOcc },
    ...(isFree ? [] : [{ value: 'tasks' as const, label: 'Задачі', badge: openTaskCount }]),
    { value: 'settings', label: 'Налаштування' },
  ]
  const fallback: Tab = dir === 'none' && !entries.length ? 'tasks' : 'money'
  const tab: Tab = tabs.some(t => t.value === tabParam) ? tabParam as Tab : fallback
  const setTab = (v: Tab) => setTabParam(v === fallback ? null : v, { rule: null, flow: null })

  /* ── лист руху грошей ── */

  const [move, setMove] = useState<Move | null>(null)
  const openMove = (kind: MoveKind, amount = 0, target = '') => setMove({ kind, amount, note: '', target })

  // крок «Скільки грошей зараз» із перших кроків веде сюди з ?start=1
  useEffect(() => {
    if (startParam === '1' && isFree) setMove(m => m ?? { kind: 'start', amount: 0, note: '', target: '' })
  }, [startParam, isFree])

  const closeMove = () => { setMove(null); if (startParam) setStart(null) }

  const saveTargets = db.projects
    .filter(p => p.direction === 'save' && p.status === 'active' && !p.isFree)
    .sort((a, b) => a.sortOrder - b.sortOrder)
  const suggestFor = (pid: ID) => {
    if (!db.projects.some(p => p.id === pid)) return 0
    const t = projectStatus(db, pid)
    return t.toSetAside || t.required
  }

  const moveTarget = move?.kind === 'setAside' ? db.projects.find(p => p.id === move.target) : undefined
  const moveCurrency = move?.kind === 'setAside' ? moveTarget?.currency ?? 'UAH'
    : move?.kind === 'income' || move?.kind === 'start' ? 'UAH' : project.currency

  const commitMove = () => {
    if (!move || move.amount <= 0) return
    const note = move.note.trim() || undefined
    const sum = money(move.amount, moveCurrency)
    let entryId: ID | undefined
    let text = ''
    switch (move.kind) {
      case 'fund': entryId = fundProject(id, move.amount, undefined, note); text = `Внесено: ${sum} · ${project.name}`; break
      case 'spend': entryId = spendOnProject(id, move.amount, note); text = `Записано: ${sum} · ${project.name}`; break
      case 'repay': entryId = spendOnProject(id, move.amount, note); text = `Сплачено: ${sum} · ${project.name}`; break
      case 'income':
      case 'start':
        entryId = addEntry({
          kind: 'income', amountMinor: move.amount, currency: 'UAH', projectId: id,
          note: move.kind === 'start' ? START_NOTE : note,
        })
        text = move.kind === 'start' ? `Стартовий залишок: ${sum}` : `Надходження: ${sum}`
        break
      case 'setAside':
        if (!moveTarget) return
        entryId = fundProject(moveTarget.id, move.amount, undefined, note)
        text = `Відкладено: ${sum} · ${moveTarget.name}`
        break
    }
    closeMove()
    if (entryId) {
      const undo = entryId
      toast(text, { action: { label: 'Скасувати', run: () => removeEntry(undo) } })
    }
  }

  /* ── правило й разовий платіж ── */

  const plan = ruleParam && ruleParam !== 'new' ? db.recurringPlans.find(p => p.id === ruleParam) : undefined
  const ruleOpen = ruleParam === 'new' || !!plan
  const closeRule = () => setRule(null, { flow: null })
  const [oneOff, setOneOff] = useState(false)

  const owner = db.members.find(m => m.id === project.ownerId)
  const source = project.sourceProjectId ? db.projects.find(p => p.id === project.sourceProjectId) : undefined

  return (
    <div className="max-w-[980px] mx-auto pb-10">
      {/* ── шапка ── */}
      <header className="px-4 sm:px-6 pt-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {!isFree && <Badge tone="accent">{DIRECTIONS.find(x => x.value === dir)?.badge}</Badge>}
          {project.status === 'done' && <Badge>завершено</Badge>}
          {project.status === 'archived' && <Badge>в архіві</Badge>}
          {owner && <Badge>{owner.name}</Badge>}
          {project.counterparty && <Badge>{project.counterparty}</Badge>}
          {project.endsOn && <Badge><span className="num">до {dateLabel(project.endsOn)}</span></Badge>}
          {source && (
            <LinkChip icon="piggy" onClick={() => nav(projectRoute(source.id))}>платимо з: {source.name}</LinkChip>
          )}
        </div>
        {project.description && <p className="text-[13.5px] text-muted mt-2 whitespace-pre-line">{project.description}</p>}

        <Card className="mt-3">
          {isFree && <FreeSummary db={db} />}
          {s && dir === 'spend' && <SpendSummary db={db} p={project} s={s} />}
          {s && dir === 'save' && <SaveSummary p={project} s={s} />}
          {s && dir === 'repay' && <RepaySummary p={project} s={s} />}
          {dir === 'none' && !isFree && (
            <div className="text-[14px]">
              <span className="num">{openTaskCount ? tasksWord(openTaskCount) : 'Відкритих задач немає'}</span>
              <span className="text-faint num"> · виконано {tasks.length - openTaskCount}</span>
            </div>
          )}

          {isFree || (active && dir !== 'none') ? (
            <div className="flex flex-wrap gap-2 mt-4">
              {isFree && <>
                <Btn variant="primary" onClick={() => openMove('income')}>{Icon.plus(16)} Надходження</Btn>
                <Btn disabled={!saveTargets.length}
                  onClick={() => { const t = saveTargets[0]; if (t) openMove('setAside', suggestFor(t.id), t.id) }}>
                  {Icon.piggy(16)} Відкласти в проєкт
                </Btn>
              </>}
              {s && dir === 'save' && <>
                <Btn variant="primary" onClick={() => openMove('fund', s.toSetAside || s.required)}>{Icon.plus(16)} Внести</Btn>
                <Btn onClick={() => openMove('spend')}>Витратити</Btn>
              </>}
              {s && dir === 'spend' && (
                <Btn variant="primary" onClick={() => openMove('spend')}>{Icon.plus(16)} Записати витрату</Btn>
              )}
              {s && dir === 'repay' && (
                <Btn variant="primary" onClick={() => openMove('repay', project.monthlyMinor ?? 0)}>Сплатити</Btn>
              )}
            </div>
          ) : null}
        </Card>
      </header>

      <div className="px-4 sm:px-6 mt-5 mb-3">
        <Tabs<Tab> value={tab} onChange={setTab} items={tabs} />
      </div>

      {tab === 'money' && (
        <MoneyTab db={db} project={project} entries={entries}
          onSetAside={pid => openMove('setAside', suggestFor(pid), pid)}
          onFirst={() => isFree ? openMove('income')
            : dir === 'save' ? openMove('fund', s?.toSetAside || s?.required || 0)
            : dir === 'repay' ? openMove('repay', project.monthlyMinor ?? 0)
            : openMove('spend')} />
      )}

      {tab === 'bills' && (
        <section>
          <div className="sm:px-6">
            <SectionTitle>{monthTitle(month)}</SectionTitle>
          </div>
          {monthOcc.length ? (
            <Rows>
              {monthOcc.map(o => (
                <BillRow key={o.id} o={o} compact
                  onOpen={o.planId ? () => setRule(o.planId!) : undefined} />
              ))}
            </Rows>
          ) : (
            <p className="px-4 sm:px-6 text-[13px] text-faint">
              {isFree ? 'Цього місяця надходжень за розкладом немає.' : 'Цього місяця платежів немає.'}
            </p>
          )}

          <div className="sm:px-6 mt-2">
            <SectionTitle right={
              <span className="flex gap-1.5">
                <Btn variant="quiet" onClick={() => setRule('new', { flow: isFree ? 'in' : null })}>{Icon.plus(15)} Правило</Btn>
                {!isFree && <Btn variant="quiet" onClick={() => setOneOff(true)}>{Icon.plus(15)} Разовий</Btn>}
              </span>
            }>Правила</SectionTitle>
          </div>
          <RulesList db={db} projectId={id} isFree={isFree} onOpen={pid => setRule(pid)}
            onNew={() => setRule('new', { flow: isFree ? 'in' : null })} />
        </section>
      )}

      {tab === 'tasks' && !isFree && <TasksTab db={db} projectId={id} tasks={tasks} />}

      {tab === 'settings' && (
        <div className="px-4 sm:px-6 max-w-[560px]">
          <ProjectForm key={id} db={db} editing={project} onDone={() => { /* форма лишається на місці */ }} />
        </div>
      )}

      {/* ── листи ── */}

      <Sheet open={!!move} onClose={closeMove} title={moveTitle(move?.kind, project)}>
        {move && (
          <MoveForm db={db} project={project} move={move} setMove={setMove} currency={moveCurrency}
            targets={saveTargets} suggestFor={suggestFor} onSubmit={commitMove} />
        )}
      </Sheet>

      <Sheet open={ruleOpen} onClose={closeRule}
        title={plan ? plan.name : isFree || flowParam === 'in' ? 'Нове надходження' : 'Нове правило'}>
        {ruleOpen && (
          <RuleForm key={ruleParam ?? ''} db={db} editing={plan ?? null} projectId={id}
            flow={flowParam === 'in' ? 'in' : flowParam === 'out' ? 'out' : undefined}
            onDone={closeRule} />
        )}
      </Sheet>

      <Sheet open={oneOff} onClose={() => setOneOff(false)} title="Разовий платіж">
        {oneOff && <OneOffForm db={db} month={month} projectId={id} onDone={() => setOneOff(false)} />}
      </Sheet>
    </div>
  )
}

function moveTitle(kind: MoveKind | undefined, p: ProjectT) {
  switch (kind) {
    case 'fund': return `Внести · ${p.name}`
    case 'spend': return `Витрата · ${p.name}`
    case 'repay': return `Сплатити · ${p.name}`
    case 'income': return 'Надходження'
    case 'start': return 'Скільки грошей зараз'
    case 'setAside': return 'Відкласти в проєкт'
    default: return undefined
  }
}

/* ─────────────── шапка: прогрес за напрямом ─────────────── */

type State = ReturnType<typeof projectStatus>

function FreeSummary({ db }: { db: DB }) {
  const balance = freeBalance(db)
  return (
    <div>
      <div className={`text-[30px] font-semibold num leading-tight ${balance < 0 ? 'text-warn' : ''}`}>{money(balance, 'UAH')}</div>
      <div className="text-[12.5px] text-faint">
        {balance < 0 ? 'обіцяли більше, ніж є — варто глянути витрати й накопичення' : 'нікому не обіцяні'}
      </div>
    </div>
  )
}

function SpendSummary({ db, p, s }: { db: DB; p: ProjectT; s: State }) {
  const g = spendGuide(db, p)
  const hasMonthly = !!p.monthlyMinor
  const budget = p.targetMinor ? spendGuide(db, { ...p, monthlyMinor: undefined }).base : 0
  const actual = s.monthActual
  const over = hasMonthly && actual > g.base

  return (
    <div>
      {hasMonthly || !budget ? (
        <>
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className={`text-[26px] font-semibold num leading-tight ${over ? 'text-warn' : ''}`}>{money(actual, 'UAH')}</span>
            <span className="text-[13px] text-faint num">
              {hasMonthly ? `з ${money(g.base, 'UAH')} цього місяця` : 'цього місяця'}
            </span>
          </div>
          {hasMonthly && (
            <div className="mt-2">
              <Progress value={actual / g.base} pending={s.monthOpen / g.base} tone={over ? 'warn' : 'accent'} />
            </div>
          )}
          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
            <Stat label="Ще очікується" value={money(s.monthOpen, 'UAH')} tone={s.monthOpen ? 'default' : 'muted'} />
            {hasMonthly && (over
              ? <Stat label="Понад орієнтир" value={money(actual - g.base, 'UAH')} tone="warn" />
              : <Stat label="Лишилось до орієнтира" value={money(Math.max(0, g.base - actual - s.monthOpen), 'UAH')}
                  tone={g.base - actual - s.monthOpen < 0 ? 'warn' : 'default'} />)}
            {budget > 0 && <Stat label="Усього з бюджету" value={`${money(s.totalSpent, 'UAH')} / ${money(budget, 'UAH')}`}
              tone={s.totalSpent > budget ? 'warn' : 'default'} />}
          </dl>
        </>
      ) : (
        <>
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className={`text-[26px] font-semibold num leading-tight ${s.totalSpent > budget ? 'text-warn' : ''}`}>{money(s.totalSpent, 'UAH')}</span>
            <span className="text-[13px] text-faint num">з {money(budget, 'UAH')} бюджету</span>
          </div>
          <div className="mt-2"><Progress value={s.totalSpent / budget} tone={s.totalSpent > budget ? 'warn' : 'accent'} /></div>
          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
            {s.totalSpent > budget
              ? <Stat label="Понад бюджет" value={money(s.totalSpent - budget, 'UAH')} tone="warn" />
              : <Stat label="Лишилось" value={money(budget - s.totalSpent, 'UAH')} />}
            <Stat label="Цього місяця" value={money(actual, 'UAH')} />
            <Stat label="Ще очікується" value={money(s.monthOpen, 'UAH')} tone={s.monthOpen ? 'default' : 'muted'} />
            {p.endsOn && <Stat label="Лишилось часу" value={monthsWord(s.monthsLeft ?? 1)} />}
          </dl>
        </>
      )}
    </div>
  )
}

function SaveSummary({ p, s }: { p: ProjectT; s: State }) {
  const c = p.currency
  return (
    <div>
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className={`text-[26px] font-semibold num leading-tight ${s.balance < 0 ? 'text-warn' : ''}`}>{money(s.balance, c)}</span>
        <span className="text-[13px] text-faint num">{s.target ? `зібрано з ${money(s.target, c)}` : 'зібрано'}</span>
      </div>
      {s.target != null && <div className="mt-2"><Progress value={s.progress} /></div>}
      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
        <Stat label="Треба на місяць" value={money(s.required, c)} />
        <Stat label="Внесено цього місяця" value={money(s.monthActual, c)} tone={s.monthActual ? 'default' : 'muted'} />
        {s.toSetAside > 0
          ? <Stat label="Відкласти ще" value={money(s.toSetAside, c)} />
          : <Stat label="Цього місяця" value="відкладено" tone="muted" />}
        {p.endsOn && <Stat label="Лишилось" value={monthsWord(s.monthsLeft ?? 1)} />}
      </dl>
      {s.target != null && p.endsOn && (
        <p className={`text-[12.5px] mt-3 ${s.onTrack ? 'text-faint' : 'text-warn'}`}>
          {s.balance >= s.target ? 'Ціль зібрано.'
            : s.onTrack ? `Встигаємо до ${dateLabel(p.endsOn)}, якщо відкладати ${money(s.required, c)} щомісяця.`
            : `Відстаємо: з таким темпом до ${dateLabel(p.endsOn)} не збираємо.`}
        </p>
      )}
    </div>
  )
}

function RepaySummary({ p, s }: { p: ProjectT; s: State }) {
  const c = p.currency
  const target = s.target ?? 0
  const remaining = s.remaining ?? 0
  const paid = target - remaining
  return (
    <div>
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="text-[26px] font-semibold num leading-tight">{remaining ? money(remaining, c) : 'Виплачено'}</span>
        {remaining > 0 && <span className="text-[13px] text-faint">лишилось</span>}
      </div>
      {target > 0 && <div className="mt-2"><Progress value={s.progress} /></div>}
      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
        <Stat label="Сплачено" value={`${money(paid, c)} / ${money(target, c)}`} />
        <Stat label="Платіж на місяць" value={p.monthlyMinor ? money(p.monthlyMinor, c) : '—'} tone={p.monthlyMinor ? 'default' : 'muted'} />
        <Stat label="Цього місяця" value={money(s.monthActual, c)} tone={s.monthActual ? 'default' : 'muted'} />
        {s.payoff && <Stat label="Закриємо" value={`~ ${monthYear(s.payoff)}`} tone={s.onTrack ? 'default' : 'warn'} />}
      </dl>
      {remaining > 0 && (
        <p className={`text-[12.5px] mt-3 ${s.onTrack ? 'text-faint' : 'text-warn'}`}>
          {!p.monthlyMinor ? 'Вкажіть платіж на місяць у налаштуваннях — порахуємо дату закриття.'
            : !p.endsOn ? 'Бажаної дати немає — прогноз лише за поточним платежем.'
            : s.onTrack ? `Встигаємо до ${dateLabel(p.endsOn)}.`
            : `Закриємо пізніше бажаного ${dateLabel(p.endsOn)}. Щоб встигнути — ${money(s.required, c)} на місяць.`}
        </p>
      )}
    </div>
  )
}

/* ─────────────── лист руху грошей ─────────────── */

function MoveForm({ db, project, move, setMove, currency, targets, suggestFor, onSubmit }: {
  db: DB
  project: ProjectT
  move: Move
  setMove: (fn: (m: Move | null) => Move | null) => void
  currency: ProjectT['currency']
  targets: ProjectT[]
  suggestFor: (id: ID) => number
  onSubmit: () => void
}) {
  const patch = (p: Partial<Move>) => setMove(m => m ? { ...m, ...p } : m)
  const s = !project.isFree && project.direction === 'save' ? projectStatus(db, project.id) : undefined
  const target = move.kind === 'setAside' ? targets.find(t => t.id === move.target) : undefined
  const targetState = target ? projectStatus(db, target.id) : undefined
  const source = project.sourceProjectId ? db.projects.find(p => p.id === project.sourceProjectId) : undefined

  const hint =
    move.kind === 'start' ? 'Те, що є на картках і готівкою разом. З цієї суми починаються «Вільні гроші».'
    : move.kind === 'fund' ? (s?.toSetAside ? 'Підставлено, скільки лишилось відкласти цього місяця.' : 'Переказ із вільних грошей. Не витрата.')
    : move.kind === 'spend' && s ? `У проєкті зараз ${money(s.balance, project.currency)}.`
    : move.kind === 'spend' ? (source ? `Платимо з накопичення «${source.name}».` : 'Зменшить вільні гроші.')
    : move.kind === 'repay' ? 'Підставлено платіж на місяць.'
    : move.kind === 'setAside' && targetState ? (targetState.toSetAside
        ? `Цього місяця лишилось відкласти ${money(targetState.toSetAside, target!.currency)}.`
        : `Зібрано ${money(targetState.balance, target!.currency)}.`)
    : undefined

  return (
    <div>
      {move.kind === 'setAside' && (
        <Field label="Куди" htmlFor="mv-target">
          <Select id="mv-target" value={move.target}
            options={targets.map(t => ({ value: t.id, label: t.name }))}
            onChange={v => patch({ target: v, amount: suggestFor(v) })} />
        </Field>
      )}

      <Field label="Сума" htmlFor="mv-amount" hint={hint}>
        <MoneyInput id="mv-amount" size="lg" autoFocus valueMinor={move.amount} currency={currency}
          onChange={v => patch({ amount: v })} />
      </Field>

      {move.kind === 'spend' && s && move.amount > s.balance && (
        <p className="text-[12px] text-warn -mt-1 mb-3">Це більше, ніж зібрано — баланс проєкту піде в мінус.</p>
      )}

      {move.kind !== 'start' && (
        <OptionalFields items={[
          { key: 'note', label: 'Нотатка', filled: !!move.note, clear: () => patch({ note: '' }),
            render: remove => (
              <Field label="Нотатка" htmlFor="mv-note" onRemove={remove}>
                <Input id="mv-note" value={move.note} onChange={v => patch({ note: v })} onEnter={onSubmit} />
              </Field>
            ) },
        ]} />
      )}

      <Btn variant="primary" full disabled={move.amount <= 0 || (move.kind === 'setAside' && !target)} onClick={onSubmit}>
        {move.kind === 'fund' ? 'Внести'
          : move.kind === 'repay' ? 'Сплатити'
          : move.kind === 'setAside' ? 'Відкласти'
          : move.kind === 'spend' ? 'Записати витрату'
          : 'Записати'}
      </Btn>
    </div>
  )
}

/* ─────────────── вкладка «Гроші» ─────────────── */

function MoneyTab({ db, project, entries, onSetAside, onFirst }: {
  db: DB
  project: ProjectT
  entries: Entry[]
  onSetAside: (id: ID) => void
  onFirst: () => void
}) {
  const nav = useNavigate()
  const [limit, setLimit] = useState(20)
  const id = project.id
  const isFree = !!project.isFree
  const name = (pid?: ID) => {
    const p = pid ? db.projects.find(x => x.id === pid) : undefined
    return !p || p.isFree ? 'Вільні гроші' : p.name
  }

  /** Знак запису з погляду цього проєкту: у нього «+», з нього «−». */
  const sign = (e: Entry): 1 | -1 => {
    if (e.kind === 'income') return 1
    if (e.kind !== 'transfer') return -1
    if (isFree) return transferEnd(db, e.projectId) === null ? 1 : -1
    return e.projectId === id ? 1 : -1
  }

  const months = project.direction === 'spend'
    ? Array.from({ length: 6 }, (_, i) => addMonths(thisMonth(), -i))
    : []
  const guide = project.monthlyMinor ? spendGuide(db, project).base : 0

  const savings = isFree ? db.projects
    .filter(p => p.direction === 'save' && p.status === 'active' && !p.isFree)
    .sort((a, b) => a.sortOrder - b.sortOrder) : []

  // переказ читається з боку проєкту: у накопичення це внесок, із вільних — відкладено
  const title = (e: Entry, plus: boolean) =>
    e.kind === 'income' ? 'Надходження'
    : e.kind === 'expense' ? 'Витрата'
    : e.kind === 'repay' ? 'Погашення'
    : isFree ? (plus ? 'Повернули у вільні' : 'Відкладено')
    : plus ? 'Внесок' : 'Переказ'

  return (
    <div>
      {months.length > 0 && (
        <section className="mb-2">
          <div className="sm:px-6"><SectionTitle>Останні 6 місяців</SectionTitle></div>
          <Rows>
            {months.map(m => {
              const actual = projectStatus(db, id, m).monthActual
              const over = guide > 0 && actual > guide
              return (
                <li key={m} className="px-4 sm:px-6 py-2.5">
                  <div className="flex items-baseline gap-3">
                    <span className="flex-1 text-[14px]">{monthTitle(m)}</span>
                    <span className={`text-[13.5px] num ${over ? 'text-warn' : 'text-muted'}`}>
                      {money(actual, 'UAH')}{guide > 0 && <span className="text-faint"> / {money(guide, 'UAH')}</span>}
                    </span>
                  </div>
                  {guide > 0 && <div className="mt-1.5"><Progress value={actual / guide} tone={over ? 'warn' : 'accent'} height={4} /></div>}
                </li>
              )
            })}
          </Rows>
        </section>
      )}

      {savings.length > 0 && (
        <section className="mb-2">
          <div className="sm:px-6"><SectionTitle>Накопичення</SectionTitle></div>
          <Rows>
            {savings.map(p => {
              const st = projectStatus(db, p.id)
              // скільки саме з вільних сюди переклали — у валюті накопичення
              const fromFree = db.entries
                .filter(e => e.kind === 'transfer' && e.projectId === p.id && transferEnd(db, e.fromProjectId) === null)
                .reduce((sum, e) => sum + e.amountMinor, 0)
              return (
                <li key={p.id} className="flex items-center gap-2 pr-4 sm:pr-6">
                  <button type="button" onClick={() => nav(projectRoute(p.id))}
                    className="flex-1 min-w-0 text-left pl-4 sm:pl-6 py-2.5 hover:bg-surface2 transition-colors">
                    <span className="block text-[14px] truncate">{p.name}</span>
                    <span className="block text-[12px] text-faint num truncate">
                      відкладено {money(fromFree, p.currency)} · зараз {money(st.balance, p.currency)}
                      {st.target ? ` з ${money(st.target, p.currency)}` : ''}
                    </span>
                  </button>
                  {st.toSetAside > 0 && (
                    <Btn variant="quiet" onClick={() => onSetAside(p.id)}>
                      <span className="num">+{money(st.toSetAside, p.currency)}</span>
                    </Btn>
                  )}
                </li>
              )
            })}
          </Rows>
        </section>
      )}

      <div className="sm:px-6"><SectionTitle>Записи</SectionTitle></div>
      {entries.length === 0 ? (
        <Empty>
          <p className="max-w-[40ch] mx-auto">
            {isFree ? 'Тут буде рух вільних грошей: надходження, відкладання в накопичення.'
              : 'Тут буде історія: кожна витрата, внесок чи платіж цього проєкту.'}
          </p>
          <div className="mt-4">
            <Btn variant="primary" onClick={onFirst}>
              {isFree ? 'Записати надходження'
                : project.direction === 'save' ? 'Внести перший раз'
                : project.direction === 'repay' ? 'Записати платіж'
                : 'Записати витрату'}
            </Btn>
          </div>
        </Empty>
      ) : (
        <>
          <Rows>
            {entries.slice(0, limit).map(e => {
              const plus = sign(e) === 1
              const other = e.kind === 'transfer' ? (plus ? e.fromProjectId : e.projectId) : undefined
              const otherProject = other ? db.projects.find(p => p.id === other) : undefined
              return (
                <li key={e.id} className="px-4 sm:px-6 py-2.5 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-[14px] truncate">{e.note || title(e, plus)}</div>
                    <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-faint num">
                      <span>{dateLabel(e.occurredOn)}</span>
                      {e.note && <span>· {title(e, plus).toLowerCase()}</span>}
                      {e.kind === 'transfer' && (
                        otherProject && !otherProject.isFree && otherProject.id !== id
                          ? <LinkChip icon="piggy" onClick={() => nav(projectRoute(otherProject.id))}>
                              {plus ? 'з' : 'у'} {otherProject.name}
                            </LinkChip>
                          : <span>· {plus ? 'з вільних' : 'у вільні'}</span>
                      )}
                      {isFree && e.kind !== 'transfer' && e.projectId && e.projectId !== id && (
                        <LinkChip onClick={() => nav(projectRoute(e.projectId!))}>{name(e.projectId)}</LinkChip>
                      )}
                    </div>
                  </div>
                  <span className={`shrink-0 text-[14px] num ${plus ? '' : 'text-muted'}`}>
                    {plus ? money(e.amountMinor, e.currency, { sign: true }) : money(-e.amountMinor, e.currency)}
                  </span>
                </li>
              )
            })}
          </Rows>
          {entries.length > limit && (
            <div className="px-4 sm:px-6 mt-2">
              <Btn variant="quiet" onClick={() => setLimit(l => l + 50)}>
                Показати ще <span className="num">{Math.min(50, entries.length - limit)}</span>
              </Btn>
            </div>
          )}
        </>
      )}
    </div>
  )
}

/* ─────────────── вкладка «Платежі»: правила ─────────────── */

function RulesList({ db, projectId, isFree, onOpen, onNew }: {
  db: DB; projectId: ID; isFree: boolean; onOpen: (id: ID) => void; onNew: () => void
}) {
  const plans = projectPlans(db, projectId)
  if (!plans.length) {
    return (
      <Empty>
        <p className="max-w-[40ch] mx-auto">
          {isFree ? 'Зарплата й інші регулярні надходження — щоб місяць рахувався наперед.'
            : 'Регулярні платежі проєкту: оренда, підписка, внесок. Стануть пунктами чекліста в Місяці.'}
        </p>
        <div className="mt-4">
          <Btn variant="primary" onClick={onNew}>{Icon.plus(16)} {isFree ? 'Додати надходження' : 'Додати правило'}</Btn>
        </div>
      </Empty>
    )
  }
  return (
    <Rows>
      {plans.map(p => {
        const next = p.active ? nextDue(db, p.id) : undefined
        return (
          <li key={p.id}>
            <button type="button" onClick={() => onOpen(p.id)}
              className="w-full text-left px-4 sm:px-6 py-2.5 flex items-center gap-3 hover:bg-surface2 transition-colors">
              <span className="shrink-0 text-faint">{Icon.clock(16)}</span>
              <span className="flex-1 min-w-0">
                <span className={`flex items-center gap-1.5 text-[14px] ${p.active ? '' : 'text-muted'}`}>
                  <span className="truncate">{p.name}</span>
                  {!p.active && <Badge>вимкнено</Badge>}
                </span>
                <span className="block text-[12px] text-faint num truncate">
                  {ruleText(p)}{next ? (next.dueDate < today()
                    ? ` · чекає з ${shortDate(next.dueDate)}`
                    : ` · наступний ${relativeDue(next.dueDate).label}`) : ''}
                </span>
              </span>
              <span className="shrink-0 text-[14px] num text-muted">
                {p.amountMode === 'variable' ? '~' : ''}{money(p.expectedMinor, p.currency)}
              </span>
              <span className="shrink-0 text-faint">{Icon.chev(14)}</span>
            </button>
          </li>
        )
      })}
    </Rows>
  )
}

/* ─────────────── вкладка «Задачі» ─────────────── */

/** Дедлайн за зростанням (без дати — у кінці), далі пріоритет: 0 «не проставлений» останнім. */
function byDueThenPriority(a: Task, b: Task) {
  const da = a.dueDate ?? '9999', dbb = b.dueDate ?? '9999'
  if (da !== dbb) return da.localeCompare(dbb)
  const pa = a.priority || 9, pb = b.priority || 9
  return pa - pb || a.createdAt.localeCompare(b.createdAt)
}

function TasksTab({ db, projectId, tasks }: { db: DB; projectId: ID; tasks: Task[] }) {
  const nav = useNavigate()
  const [title, setTitle] = useState('')
  const [showDone, setShowDone] = useState(false)
  const open = tasks.filter(t => t.status !== 'done').sort(byDueThenPriority)
  const done = tasks.filter(t => t.status === 'done')
    .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''))

  const add = () => {
    const t = title.trim()
    if (!t) return
    addTask({ title: t, projectId })
    setTitle('')
  }

  const row = (t: Task) => {
    const isDone = t.status === 'done'
    const who = db.members.find(m => m.id === t.assigneeId)
    const due = t.dueDate && !isDone ? relativeDue(t.dueDate) : undefined
    // прострочене бурштинове лише своє або нічиє: чуже прострочення одному не показуємо
    const mine = !t.assigneeId || t.assigneeId === db.meId
    const warn = !!due && mine && (due.tone === 'over' || due.tone === 'today')
    return (
      <li key={t.id} className="px-4 sm:px-6 min-h-11 py-2 flex items-center gap-3">
        <button type="button" onClick={() => completeTask(t.id)}
          aria-label={isDone ? `Повернути: ${t.title}` : `Виконано: ${t.title}`}
          className={`shrink-0 h-5 w-5 rounded-[6px] border grid place-items-center transition-colors ${
            isDone ? 'bg-accent border-accent text-white' : 'border-line2 hover:border-accent hover:bg-accentSoft'}`}>
          {isDone && Icon.check(13)}
        </button>
        <button type="button" onClick={() => nav('/tasks?task=' + t.id)}
          className={`flex-1 min-w-0 text-left text-[14px] truncate ${isDone ? 'text-faint line-through' : ''}`}>
          {t.title}
        </button>
        {due && <span className={`shrink-0 text-[12px] num ${warn ? 'text-warn' : 'text-faint'}`}>{due.label}</span>}
        {who && <Avatar member={who} size={20} />}
      </li>
    )
  }

  return (
    <div>
      <div className="px-4 sm:px-6 mb-3">
        <Input value={title} onChange={setTitle} onEnter={add} placeholder="Нова задача — Enter" />
      </div>

      {open.length ? (
        <Rows>{open.map(row)}</Rows>
      ) : (
        <p className="px-4 sm:px-6 py-4 text-[13px] text-faint">
          {done.length ? 'Усе виконано.' : 'Задач у проєкті ще немає — впишіть першу в поле вище.'}
        </p>
      )}

      {done.length > 0 && (
        <div className="mt-4">
          <div className="px-4 sm:px-6 mb-2">
            <button type="button" onClick={() => setShowDone(v => !v)} aria-expanded={showDone}
              className="inline-flex items-center gap-1.5 text-[12px] uppercase tracking-wider text-faint font-medium hover:text-ink">
              <span className={`transition-transform ${showDone ? 'rotate-90' : ''}`}>{Icon.chev(12)}</span>
              Виконані <span className="num">{done.length}</span>
            </button>
          </div>
          {showDone && <Rows>{done.map(row)}</Rows>}
        </div>
      )}

      <div className="px-4 sm:px-6 mt-4">
        <Btn variant="quiet" onClick={() => nav(`/tasks?project=${projectId}`)}>
          Усі в Задачах {Icon.chev(14)}
        </Btn>
      </div>
    </div>
  )
}
