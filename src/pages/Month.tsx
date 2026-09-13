import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Btn, Card, Empty, Field, FormActions, Icon, IconButton, LinkChip, MoneyInput, Progress,
  Rows, SectionTitle, Sheet, Stat, toast,
} from '../ui'
import { MonthBar, useMonth } from '../components/MonthBar'
import { BillRow } from '../components/BillRow'
import { OneOffForm } from '../components/RuleForm'
import {
  useDB, monthView, fundProject, removeEntry, completeTask, type ProjectState,
} from '../data/store'
import { hasIncome, setupSteps } from '../data/setup'
import { projectRoute } from '../data/links'
import { money, toBase } from '../lib/money'
import { monthKey, monthTitle, shortDate, thisMonth, today } from '../lib/dates'
import type { DB, Project } from '../data/types'

type View = ReturnType<typeof monthView>

/** Сума без символу — для пари «5 000 / 5 000 ₴», де валюта одна на двох. */
const bare = (minor: number, c: Project['currency']) => money(minor, c).replace(/\s*[₴$€]$/, '')
type When = 'past' | 'current' | 'future'

/** Іконка чипа за напрямом проєкту — та сама мова, що в BillRow. */
function projectIcon(p: Project) {
  return p.direction === 'save' ? 'piggy' as const
    : p.direction === 'repay' ? 'list' as const
    : p.direction === 'spend' ? 'wallet' as const
    : 'check' as const
}

/**
 * Місяць — агрегатор, а не сутність: що має статися з усіма проєктами
 * за вибраний місяць. Нічого тут не зберігається, усе з monthView.
 */
export default function Month() {
  const db = useDB()
  const [month, setMonth] = useMonth()
  const view = monthView(db, month)
  const cur = thisMonth()
  const when: When = month < cur ? 'past' : month === cur ? 'current' : 'future'

  return (
    <div className="max-w-[980px] mx-auto pb-10">
      <header className="px-4 pt-3 pb-1 sm:px-6">
        <MonthBar month={month} onChange={setMonth} />
        <Summary db={db} view={view} when={when} />
      </header>

      <Bills db={db} view={view} month={month} />
      <SetAside view={view} when={when} />
      <Spending view={view} />
      <Debts view={view} when={when} />
      <MonthTasks db={db} month={month} />
    </div>
  )
}

/* ═══════════════════ підсумок ═══════════════════ */

function Summary({ db, view, when }: { db: DB; view: View; when: When }) {
  if (!hasIncome(db)) {
    // Без доходу й стартового залишку «вільні» — не число, а шум:
    // чотири нулі нічого не пояснюють, тож кажемо, звідки візьмуться числа.
    const step = setupSteps(db).find(s => s.key === 'income')
    return (
      <Link to={step?.to ?? '/projects'}
        className="block rounded-xl border border-dashed border-line2 bg-surface p-4 hover:border-accent transition-colors">
        <div className="text-[12px] uppercase tracking-wider text-faint">Вільні гроші</div>
        <div className="text-[14px] mt-1">
          Спершу дохід: з нього мінус платежі, орієнтири й внески — і стане видно, скільки лишиться на кінець місяця.
        </div>
        <div className="text-[12.5px] text-accent mt-2">Додати зарплату</div>
      </Link>
    )
  }

  const closed = view.bills.filter(o => o.status === 'paid' || o.status === 'skipped').length

  if (when === 'past') {
    // Для минулого прогнозу немає — лише те, що сталося.
    const net = view.income - view.spent
    return (
      <Card>
        <div className="text-[12px] uppercase tracking-wider text-faint">Дохід мінус витрати</div>
        <div className={`text-[30px] font-semibold num tracking-tight ${net < 0 ? 'text-warn' : ''}`}>
          {money(net, 'UAH', { sign: net > 0 })}
        </div>
        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2 mt-3 pt-3 border-t border-line text-[13px]">
          <Stat label="Дохід" value={money(view.income)} />
          <Stat label="Витрачено" value={money(view.spent)} />
          <Stat label="Відкладено" value={money(view.setAside)} />
          <Stat label="Платежі" value={`${closed} з ${view.bills.length}`} />
        </dl>
      </Card>
    )
  }

  return (
    <Card>
      <div className="flex flex-wrap items-end gap-x-8 gap-y-2">
        <div>
          <div className="text-[12px] uppercase tracking-wider text-faint">Вільні зараз</div>
          <div className={`text-[30px] font-semibold num tracking-tight ${view.freeNow < 0 ? 'text-warn' : ''}`}>
            {money(view.freeNow)}
          </div>
        </div>
        {view.forecast !== undefined ? (
          <div className="pb-1">
            <div className="text-[12px] text-faint">Прогноз на кінець місяця</div>
            <div className={`text-[18px] font-medium num ${view.forecast < 0 ? 'text-warn' : ''}`}>{money(view.forecast)}</div>
          </div>
        ) : (
          // store не рахує прогноз для майбутнього: він не знав би, що станеться
          // до того місяця, і показав би впевнену, але вигадану цифру
          <p className="pb-1 text-[12.5px] text-faint max-w-[260px] leading-snug">
            Прогноз зʼявиться, коли місяць настане. Нижче — що вже заплановано.
          </p>
        )}
      </div>

      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2 mt-3 pt-3 border-t border-line text-[13px]">
        <Stat label="Дохід" value={
          <>
            {money(view.income)}
            {view.incomeExpected > 0 && (
              <span className="block text-faint text-[11.5px]">+{money(view.incomeExpected)} очік.</span>
            )}
          </>
        } />
        <Stat label="Ще платити" value={money(view.billsLeft)} />
        <Stat label="Відкласти" value={money(view.toSetAside)} />
        <Stat label="Витрачено" value={money(view.spent)} />
      </dl>
    </Card>
  )
}

/* ═══════════════════ платежі ═══════════════════ */

function Bills({ db, view, month }: { db: DB; view: View; month: string }) {
  const nav = useNavigate()
  const [oneOff, setOneOff] = useState(false)

  return (
    <section className="mt-6">
      <div className="sm:px-6">
        <SectionTitle right={
          <Btn variant="ghost" onClick={() => setOneOff(true)}>{Icon.plus(16)} Разовий</Btn>
        }>Платежі</SectionTitle>
      </div>

      {view.bills.length ? (
        <Rows>
          {view.bills.map(o => <BillRow key={o.id} o={o} />)}
        </Rows>
      ) : (
        <Empty>
          <div className="max-w-[380px] mx-auto">
            <p>
              Тут чекліст місяця: оренда, інтернет, зарплата. Платежі беруться з регулярних
              правил у проєктах — руками заводити їх щомісяця не треба.
            </p>
            <div className="mt-4">
              <Btn variant="primary" onClick={() => nav('/projects')}>Відкрити проєкти</Btn>
            </div>
          </div>
        </Empty>
      )}

      <Sheet open={oneOff} onClose={() => setOneOff(false)} title="Разовий платіж">
        {oneOff && <OneOffForm db={db} month={month} onDone={() => setOneOff(false)} />}
      </Sheet>
    </section>
  )
}

/* ═══════════════════ відкласти ═══════════════════ */

/** Внесок одним тапом і тост зі скасуванням: помилку виправляють після, а не підтверджують до. */
function contribute(p: Project, amountMinor: number) {
  const id = fundProject(p.id, amountMinor)
  if (!id) return
  toast(`Внесено: ${money(amountMinor, p.currency)} · ${p.name}`, {
    action: { label: 'Скасувати', run: () => removeEntry(id) },
  })
}

function SetAside({ view, when }: { view: View; when: When }) {
  const [other, setOther] = useState<ProjectState | null>(null)
  const rows = view.states.filter(s => s.project.direction === 'save')
  if (!rows.length) return null

  return (
    <section className="mt-6">
      <div className="sm:px-6"><SectionTitle>Відкласти</SectionTitle></div>
      <Rows>
        {rows.map(s => (
          <SaveRow key={s.project.id} s={s} when={when} onOther={() => setOther(s)} />
        ))}
      </Rows>

      <Sheet open={!!other} onClose={() => setOther(null)} title={other ? `Внести: ${other.project.name}` : undefined}>
        {other && <OtherAmount s={other} onDone={() => setOther(null)} />}
      </Sheet>
    </section>
  )
}

function SaveRow({ s, when, onOther }: { s: ProjectState; when: When; onOther: () => void }) {
  const nav = useNavigate()
  const p = s.project
  // «Треба» рахується від сьогодні — для минулого місяця це не та цифра,
  // а внести в інший місяць, ніж поточний, запис не вміє (дата — сьогодні).
  const canAct = when === 'current'
  const done = s.required > 0 && s.toSetAside === 0

  return (
    <li className="px-4 sm:px-6 py-2.5">
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <button type="button" onClick={() => nav(projectRoute(p.id))}
            className="block max-w-full text-left text-[14px] truncate hover:text-accent transition-colors">
            {p.name}
          </button>
          <div className="text-[12px] text-faint num">
            {/* коли внесено все, «з N» не показуємо: треба рахується від поточного
                балансу й після внеску меншає, тож «978 з 870» лише плутало б */}
            {when !== 'past' && s.required > 0 && !done
              ? <>внесено {money(s.monthActual, p.currency)} з {money(s.required, p.currency)} {when === 'current' ? 'цього місяця' : 'за місяць'}</>
              : <>внесено {money(s.monthActual, p.currency)}{when === 'current' ? ' цього місяця' : ''}</>}
            {done && when !== 'past' && <span className="text-accent"> · готово</span>}
          </div>
        </div>

        {canAct && (
          <span className="shrink-0 flex items-center gap-1">
            {s.toSetAside > 0 && (
              <Btn variant="ghost" onClick={() => contribute(p, s.toSetAside)}>
                <span className="num">Внести {money(s.toSetAside, p.currency)}</span>
              </Btn>
            )}
            <IconButton label={`Інша сума: ${p.name}`} onClick={onOther}>{Icon.more(16)}</IconButton>
          </span>
        )}
      </div>
      {when !== 'past' && s.required > 0 && (
        <div className="mt-1.5">
          <Progress value={done ? 1 : s.monthActual / s.required} height={4} />
        </div>
      )}
    </li>
  )
}

function OtherAmount({ s, onDone }: { s: ProjectState; onDone: () => void }) {
  const [amount, setAmount] = useState(s.toSetAside)
  const submit = () => {
    if (amount <= 0) return
    contribute(s.project, amount)
    onDone()
  }
  return (
    <div>
      <Field label="Сума" htmlFor="set-aside-amount"
        hint={s.toSetAside > 0 ? `Цього місяця лишилось відкласти ${money(s.toSetAside, s.project.currency)}.` : undefined}>
        <MoneyInput id="set-aside-amount" valueMinor={amount} currency={s.project.currency}
          onChange={setAmount} autoFocus size="lg" />
      </Field>
      <FormActions onSubmit={submit} onCancel={onDone} disabled={amount <= 0} submitLabel="Внести" />
    </div>
  )
}

/* ═══════════════════ витрати ═══════════════════ */

function Spending({ view }: { view: View }) {
  const [showQuiet, setShowQuiet] = useState(false)
  const rows = view.states.filter(s => s.project.direction === 'spend')
  if (!rows.length) return null
  // Без руху й без орієнтира рядок — лише назва з нулем; згортаємо, щоб не заглушував решту.
  const quiet = (s: ProjectState) => !s.monthActual && !s.monthOpen && !s.project.monthlyMinor
  const shown = rows.filter(s => !quiet(s))
  const hidden = rows.filter(quiet)

  return (
    <section className="mt-6">
      <div className="sm:px-6"><SectionTitle>Витрати</SectionTitle></div>
      {shown.length > 0 && (
        <Rows>
          {shown.map(s => <SpendRow key={s.project.id} s={s} />)}
        </Rows>
      )}
      {hidden.length > 0 && (
        <>
          <button onClick={() => setShowQuiet(v => !v)} aria-expanded={showQuiet}
            className="w-full flex items-center gap-2 px-4 sm:px-6 py-2.5 text-[12px] uppercase tracking-wider text-faint hover:text-muted">
            <span className={`transition-transform ${showQuiet ? 'rotate-90' : ''}`}>{Icon.chev(14)}</span>
            Ще <span className="num">{hidden.length}</span> без витрат
          </button>
          {showQuiet && (
            <Rows>
              {hidden.map(s => <SpendRow key={s.project.id} s={s} />)}
            </Rows>
          )}
        </>
      )}
    </section>
  )
}

function SpendRow({ s }: { s: ProjectState }) {
  const db = useDB()
  const nav = useNavigate()
  const p = s.project
  // spend-суми в projectStatus уже в базовій валюті; орієнтир — у валюті проєкту
  const guide = p.monthlyMinor ? toBase(p.monthlyMinor, p.currency, db.rates) : 0
  const over = guide > 0 && s.monthActual > guide
  const short = guide > 0 && !over && s.monthActual + s.monthOpen > guide

  return (
    <li className="px-4 sm:px-6 py-2.5">
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => nav(projectRoute(p.id))}
          className="flex-1 min-w-0 text-left text-[14px] truncate hover:text-accent transition-colors">
          {p.name}
        </button>
        <span className={`shrink-0 text-[13px] num ${over ? 'text-warn' : 'text-muted'}`}>{money(s.monthActual)}</span>
        {guide > 0 && (
          <>
            <span className="text-faint text-[13px]">/</span>
            <span className="shrink-0 text-[13px] num text-faint">{money(guide)}</span>
          </>
        )}
      </div>
      {guide > 0 && (
        <div className="mt-1.5">
          <Progress value={s.monthActual / guide} pending={s.monthOpen / guide}
            tone={over ? 'warn' : 'accent'} height={4} />
        </div>
      )}
      {(s.monthOpen > 0 || over) && (
        <div className="mt-1 text-[11.5px] text-faint num">
          {s.monthOpen > 0 && <span className={short ? 'text-warn' : undefined}>ще {money(s.monthOpen)} платежами</span>}
          {s.monthOpen > 0 && (over || short) && ' · '}
          {over && <span className="text-warn">більше за орієнтир на {money(s.monthActual - guide)}</span>}
          {short && <span>більше за орієнтир</span>}
        </div>
      )}
    </li>
  )
}

/* ═══════════════════ борги ═══════════════════ */

function Debts({ view, when }: { view: View; when: When }) {
  const nav = useNavigate()
  const rows = view.states.filter(s => s.project.direction === 'repay')
  if (!rows.length) return null

  return (
    <section className="mt-6">
      <div className="sm:px-6"><SectionTitle>Борги</SectionTitle></div>
      <Rows>
        {rows.map(s => {
          const p = s.project
          const c = p.currency
          return (
            <li key={p.id} className="px-4 sm:px-6 py-2.5">
              <div className="flex items-center gap-3">
                <button type="button" onClick={() => nav(projectRoute(p.id))}
                  className="flex-1 min-w-0 text-left text-[14px] truncate hover:text-accent transition-colors">
                  {p.name}
                </button>
                <span className="shrink-0 text-[13px] num text-muted">
                  {s.required > 0
                    ? <>{bare(s.monthActual, c)}<span className="text-faint"> / {money(s.required, c)}</span></>
                    : money(s.monthActual, c)}
                </span>
              </div>
              {s.required > 0 && (
                <div className="mt-1.5"><Progress value={s.monthActual / s.required} height={4} /></div>
              )}
              <div className="mt-1 text-[11.5px] text-faint num">
                {when === 'current' ? 'сплачено цього місяця' : 'сплачено за місяць'}
                {s.remaining !== undefined && <> · лишилось {money(s.remaining, c)}</>}
                {s.payoff && (
                  <span className={s.onTrack ? undefined : 'text-warn'}>
                    {' '}· закриття {monthTitle(monthKey(s.payoff)).toLowerCase()}
                    {!s.onTrack && ', пізніше за план'}
                  </span>
                )}
              </div>
            </li>
          )
        })}
      </Rows>
    </section>
  )
}

/* ═══════════════════ задачі ═══════════════════ */

function MonthTasks({ db, month }: { db: DB; month: string }) {
  const nav = useNavigate()
  const t = today()
  const tasks = db.tasks
    .filter(x => x.dueDate && monthKey(x.dueDate) === month
      && x.status !== 'done' && x.status !== 'dropped')
    // Чуже прострочене не показуємо: це було б «у другого прострочено»,
    // якого CLAUDE.md не дозволяє. Чуже непрострочене — просто план місяця.
    .filter(x => x.dueDate! >= t || !x.assigneeId || x.assigneeId === db.meId)
    .sort((a, b) => a.dueDate!.localeCompare(b.dueDate!))

  return (
    <section className="mt-6">
      <div className="sm:px-6">
        <SectionTitle right={<Link to="/tasks" className="text-[12.5px] text-accent">усі</Link>}>
          Задачі місяця
        </SectionTitle>
      </div>

      {tasks.length ? (
        <Rows>
          {tasks.map(x => {
            const project = x.projectId ? db.projects.find(p => p.id === x.projectId) : undefined
            const overdue = x.dueDate! < t
            const who = x.assigneeId ? db.members.find(m => m.id === x.assigneeId) : undefined
            return (
              <li key={x.id} className="flex items-center gap-2.5 px-4 sm:px-6 min-h-11 py-2">
                <button onClick={() => completeTask(x.id)} aria-label={`Виконано: ${x.title}`}
                  className="shrink-0 h-[18px] w-[18px] rounded-[5px] border border-line2 hover:border-accent" />
                <button type="button" onClick={() => nav(`/tasks?task=${x.id}`)}
                  className="flex-1 min-w-0 text-left text-[14px] truncate hover:text-accent transition-colors">
                  {x.title}
                </button>
                {project && !project.isFree && (
                  <span className="hidden min-[420px]:inline-flex max-w-[40%] overflow-hidden">
                    <LinkChip icon={projectIcon(project)} onClick={() => nav(projectRoute(project.id))}>
                      <span className="truncate">{project.name}</span>
                    </LinkChip>
                  </span>
                )}
                {who && who.id !== db.meId && <span className="shrink-0 text-[12px] text-faint">{who.name}</span>}
                {/* прострочення бурштинове, не червоне */}
                <span className={`shrink-0 text-[12px] num ${overdue ? 'text-warn font-medium' : 'text-faint'}`}>
                  {shortDate(x.dueDate!)}
                </span>
              </li>
            )
          })}
        </Rows>
      ) : (
        <Empty>
          <div className="max-w-[380px] mx-auto">
            <p>Тут будуть задачі з датою в цьому місяці: техогляд, запис до лікаря, оплата податку.</p>
            <div className="mt-4">
              <Btn onClick={() => nav('/tasks')}>Відкрити задачі</Btn>
            </div>
          </div>
        </Empty>
      )}
    </section>
  )
}
