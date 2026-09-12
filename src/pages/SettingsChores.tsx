import { useState } from 'react'
import {
  Avatar, Badge, Btn, Card, ConfirmButton, Empty, Field, FormActions, Icon,
  Input, Pill, SectionTitle, Segmented, Select, Sheet, Switch,
} from '../ui'
import { useDB, addTaskTemplate, updateTaskTemplate, removeTaskTemplate } from '../data/store'
import type { DB, ID, TaskTemplate } from '../data/types'
import { addDays, relativeDue, today } from '../lib/dates'

/** Перший день тижня — понеділок: 1=Пн .. 7=Нд, як у `byDay`. */
const DOW = [
  { v: 1, l: 'Пн' }, { v: 2, l: 'Вт' }, { v: 3, l: 'Ср' }, { v: 4, l: 'Чт' },
  { v: 5, l: 'Пт' }, { v: 6, l: 'Сб' }, { v: 7, l: 'Нд' },
]
const EFFORT: Record<1 | 2 | 3, string> = { 1: 'Швидко', 2: 'Середнє', 3: 'Довго' }
const INTERVALS = [3, 4, 7, 14, 30, 60]

type Draft = Omit<TaskTemplate, 'id'>

const EMPTY: Draft = {
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

export default function SettingsChores() {
  const db = useDB()
  const [editing, setEditing] = useState<TaskTemplate | 'new' | null>(null)

  const sorted = [...db.taskTemplates].sort((a, b) =>
    (a.area ?? '').localeCompare(b.area ?? '', 'uk') || a.title.localeCompare(b.title, 'uk'))
  const active = sorted.filter(t => t.active)
  const paused = sorted.filter(t => !t.active)

  return (
    <div className="max-w-[760px] mx-auto pb-10">
      <header className="px-4 pt-5 pb-3 sm:px-6 flex items-center justify-between gap-3">
        <h1 className="text-[22px] font-semibold tracking-tight">Побутові задачі</h1>
        <Btn onClick={() => setEditing('new')}>{Icon.plus(16)} Шаблон</Btn>
      </header>

      <div className="px-4 sm:px-6">
        <p className="text-[12.5px] text-faint">
          Шаблон сам створює задачу, коли настає час. Руками додавати нічого не треба.
        </p>
      </div>

      {db.taskTemplates.length === 0 ? (
        <Empty>
          <p className="mb-3">
            Тут живе те, що повторюється: пропилососити, полити квіти, винести сміття.<br />
            Шаблон сам покладе задачу в «Сьогодні», коли настане час.
          </p>
          <Btn variant="primary" onClick={() => setEditing('new')}>{Icon.plus(16)} Створити шаблон</Btn>
        </Empty>
      ) : (
        <>
          <SectionTitle>Активні</SectionTitle>
          {active.length === 0
            ? <div className="px-4 sm:px-6"><Card><p className="text-[13.5px] text-faint">Усі шаблони вимкнені — нові задачі не з'являються.</p></Card></div>
            : (
              <ul className="border-y border-line divide-y divide-line bg-surface">
                {active.map(t => <Row key={t.id} tpl={t} db={db} onOpen={() => setEditing(t)} />)}
              </ul>
            )}

          {paused.length > 0 && (
            <>
              <SectionTitle>Вимкнені</SectionTitle>
              <ul className="border-y border-line divide-y divide-line bg-surface opacity-70">
                {paused.map(t => <Row key={t.id} tpl={t} db={db} onOpen={() => setEditing(t)} />)}
              </ul>
            </>
          )}
        </>
      )}

      <Sheet open={editing !== null} onClose={() => setEditing(null)}
             title={editing === 'new' ? 'Новий шаблон' : 'Шаблон'}>
        {editing !== null && (
          <TemplateForm
            db={db}
            initial={editing === 'new' ? EMPTY : stripId(editing)}
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
    </div>
  )
}

function stripId(t: TaskTemplate): Draft {
  const { id: _id, ...rest } = t
  return rest
}

function Row({ tpl, db, onOpen }: { tpl: TaskTemplate; db: DB; onOpen: () => void }) {
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
            {!tpl.active && <Badge tone="warn">вимкнено</Badge>}
          </div>
          <div className="text-[12.5px] text-faint">
            {scheduleText(tpl)} · {rotationText(tpl, db)} · {EFFORT[tpl.effort]}
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

  const areas = [...new Set(db.taskTemplates.map(t => t.area).filter(Boolean) as string[])]
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
      active,
    })
  }

  return (
    <div>
      <Field label="Що робимо" htmlFor="tpl-title">
        <Input id="tpl-title" value={title} onChange={setTitle} autoFocus
               placeholder="Пропилососити" onEnter={submit} />
      </Field>

      <Field label="Область" htmlFor="tpl-area" hint="Необов'язково — просто щоб згрупувати">
        <Input id="tpl-area" value={area} onChange={setArea} placeholder="Дім" />
      </Field>
      {areas.length > 0 && (
        <div className="flex gap-1.5 flex-wrap -mt-1 mb-3">
          {areas.map(a => (
            <Pill key={a} active={area.trim() === a} onClick={() => setArea(area.trim() === a ? '' : a)}>{a}</Pill>
          ))}
        </div>
      )}

      <Field label="Складність" hint="Впливає на баланс навантаження між вами">
        <Segmented<'1' | '2' | '3'> full value={effort} onChange={setEffort} label="Складність"
          items={[{ value: '1', label: EFFORT[1] }, { value: '2', label: EFFORT[2] }, { value: '3', label: EFFORT[3] }]} />
      </Field>

      <Field label="Коли повторювати">
        <Segmented<TaskTemplate['scheduleKind']> full value={kind} onChange={setKind} label="Режим розкладу"
          items={[{ value: 'fixed', label: 'За календарем' }, { value: 'after_completion', label: 'Після виконання' }]} />
      </Field>

      <p className="text-[12.5px] text-faint -mt-1 mb-3 leading-snug">
        {kind === 'fixed'
          ? 'Задача з\'являється в конкретні дні, незалежно від того, коли її зробили востаннє.'
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
        <Field label="Раз на скільки днів" htmlFor="tpl-interval"
               error={!scheduleOk ? 'Потрібне число днів, від 1' : undefined}
               hint={scheduleOk ? `Наступна задача з'явиться через ${days} дн. після того, як закриють попередню` : undefined}>
          <Input id="tpl-interval" value={interval} onChange={setInterval}
                 inputMode="numeric" align="right" placeholder="7" onEnter={submit} />
        </Field>
      )}

      {kind === 'after_completion' && (
        <div className="flex gap-1.5 flex-wrap -mt-1 mb-3">
          {INTERVALS.map(n => (
            <Pill key={n} active={days === n} onClick={() => setInterval(String(n))}>{n} дн.</Pill>
          ))}
        </div>
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
          ? 'Задача дістається тому, у кого менше навантаження за останні 28 днів — з урахуванням складності. Черга вирівнюється сама.'
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

      <div className="border-t border-line pt-2 mt-1">
        <Switch checked={active} onChange={setActive} label="Шаблон активний"
                hint={active ? 'Створює нові задачі за розкладом' : 'Нові задачі не створюються, наявні лишаються'} />
      </div>

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
