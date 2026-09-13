import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AttachButton, Badge, Btn, Card, Empty, Field, FormActions, Icon, IconButton, Input,
  LinkGroup, LinkRow, ListRow, Pill, Progress, SectionTitle, Select, Sheet, Stat, Switch,
  toast, useSheet, Rows,
} from '../ui'
import { MonthBar, useMonth } from '../components/MonthBar'
import {
  useDB, envelopeMonth, monthSummary, setPlanned,
  addEnvelope, updateEnvelope, archiveEnvelope, reorderEnvelope, updateFund,
  fundStatus,
} from '../data/store'
import { envelopeAsk, envelopeSources, newRuleRoute, unlinkedFunds } from '../data/links'
import { money, parseAmount } from '../lib/money'
import { monthKey, today } from '../lib/dates'
import type { DB, Envelope, EnvelopeKind, ID } from '../data/types'

/* ═══════════════════ конверти: довідники і похідне ═══════════════════ */

/* Порядок груп: спершу звідки гроші приходять, далі куди йдуть. */
const KINDS: { value: EnvelopeKind; label: string; hint: string }[] = [
  { value: 'income',   label: 'Дохід',        hint: 'Зарплата, підробіток — те, що приходить' },
  { value: 'fixed',    label: 'Постійні',     hint: 'Оренда, комуналка, підписки — щомісяця те саме' },
  { value: 'variable', label: 'Змінні',       hint: 'Їжа, транспорт, дрібниці — сума плаває' },
  { value: 'sinking',  label: 'Накопичувальні', hint: 'Відкладаємо потроху на майбутню велику витрату' },
  { value: 'savings',  label: 'Заощадження',  hint: 'Подушка і довгі цілі' },
  { value: 'debt',     label: 'Борги',        hint: 'Платежі за кредитами і позиками' },
  { value: 'personal', label: 'Особисті',     hint: 'Особисті гроші одного з нас' },
]
const KIND_HINT = Object.fromEntries(KINDS.map(k => [k.value, k.hint])) as Record<EnvelopeKind, string>

interface Usage { entries: number; occurrences: number; plans: number; planLines: number; total: number }

/** Скільки всього дивиться на конверт. Рахуємо на читанні, не зберігаємо. */
function usageOf(db: DB, id: ID): Usage {
  const entries = db.entries.filter(e => e.envelopeId === id).length
  const occurrences = db.occurrences.filter(o => o.envelopeId === id).length
  const plans = db.recurringPlans.filter(p => p.envelopeId === id).length
  const planLines = db.planLines.filter(l => l.envelopeId === id && l.plannedMinor !== 0).length
  return { entries, occurrences, plans, planLines, total: entries + occurrences + plans + planLines }
}

function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10, m100 = n % 100
  if (m10 === 1 && m100 !== 11) return one
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few
  return many
}

function usageLabel(u: Usage) {
  return u.total ? `${u.total} ${plural(u.total, 'запис', 'записи', 'записів')}` : 'порожній'
}

function usageTitle(u: Usage) {
  const parts: string[] = []
  if (u.entries) parts.push(`витрат і доходів: ${u.entries}`)
  if (u.occurrences) parts.push(`платежів: ${u.occurrences}`)
  if (u.plans) parts.push(`регулярних: ${u.plans}`)
  if (u.planLines) parts.push(`планів місяця: ${u.planLines}`)
  return parts.length ? parts.join(', ') : 'На цей конверт ще нічого не записано'
}

const byOrder = (a: Envelope, b: Envelope) =>
  a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'uk')

/** Строго зростаючі позиції з наявних — щоб обмін місцями спрацював і на однакових sortOrder. */
function slots(values: number[]) {
  let prev = -Infinity
  return values.map(v => { const next = v > prev ? v : prev + 1; prev = next; return next })
}

/** Обмін місцями із сусідом усередині своєї групи. */
function swap(list: Envelope[], i: number, dir: -1 | 1) {
  const j = i + dir
  if (i < 0 || j < 0 || j >= list.length) return
  const positions = slots(list.map(e => e.sortOrder))
  const next = list.slice()
  next[i] = list[j]
  next[j] = list[i]
  next.forEach((e, k) => { if (e.sortOrder !== positions[k]) reorderEnvelope(e.id, positions[k]) })
}

/* ═══════════════════ екран ═══════════════════ */

/**
 * Конверти місяця: скільки заплановано, скільки вже витрачено і скільки
 * надійде автоматично. Чекліст платежів живе окремим екраном — це різні
 * заняття: тут вирішують, скільки на що, там підтверджують, що сталося.
 */
export default function Envelopes() {
  const db = useDB()
  const [month, setMonth] = useMonth()
  const sum = monthSummary(db, month)

  return (
    <div className="max-w-[980px] mx-auto pb-10">
      <header className="px-4 pt-3 pb-3 sm:px-6">
        <MonthBar month={month} onChange={setMonth} />

        <Card>
          <div className="text-[12px] uppercase tracking-wider text-faint">Вільно до кінця місяця</div>
          <div className={`text-[30px] font-semibold num tracking-tight ${sum.free < 0 ? 'text-warn' : ''}`}>
            {money(sum.free)}
          </div>
          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2 mt-3 pt-3 border-t border-line text-[13px]">
            <Stat label="Дохід" value={
              sum.incomeExpected
                ? <>{money(sum.income + sum.incomeExpected)}<span className="text-faint text-[11.5px]"> очік.</span></>
                : money(sum.income)
            } />
            <Stat label="Ще платити" value={money(sum.obligationsLeft)} />
            <Stat label="У фонди" value={money(sum.fundsRequired)} />
            <Stat label="Витрачено" value={money(sum.spentVariable)} />
          </dl>
        </Card>
      </header>

      <PlanTab db={db} month={month} />
    </div>
  )
}

function PlanTab({ db, month }: { db: DB; month: string }) {
  const [envParam, setEnvParam] = useSheet('env')
  const editing: Envelope | 'new' | null = envParam === 'new'
    ? 'new'
    : envParam ? (db.envelopes.find(e => e.id === envParam) ?? null) : null
  const setEditing = (v: Envelope | 'new' | null) =>
    setEnvParam(v === null ? null : v === 'new' ? 'new' : v.id)
  const [reordering, setReordering] = useState(false)
  const [showArchived, setShowArchived] = useState(false)

  // рядки плану: конверти витрат, факт проти плану — усе похідне
  const rows = envelopeMonth(db, month)
  const income = useMemo(
    () => db.envelopes.filter(e => !e.archived && e.kind === 'income').sort(byOrder),
    [db.envelopes])
  const archived = useMemo(
    () => db.envelopes.filter(e => e.archived).sort(byOrder),
    [db.envelopes])

  const groups = KINDS
    .filter(k => k.value !== 'income')
    .map(k => ({ ...k, rows: rows.filter(r => r.envelope.kind === k.value) }))
    .filter(g => g.rows.length > 0)

  return (
    <div className="mt-3">
      <div className="px-4 sm:px-6 flex flex-wrap items-center gap-2">
        <p className="flex-1 min-w-[180px] text-[12.5px] text-faint">
          {reordering
            ? 'Стрілки міняють порядок усередині групи.'
            : 'Планова сума правиться в рядку. Назва відкриває конверт.'}
        </p>
        <Pill active={reordering} onClick={() => setReordering(v => !v)}
          title="Показати стрілки порядку">Порядок</Pill>
        <Btn variant="ghost" onClick={() => setEditing('new')}>{Icon.plus(16)} Конверт</Btn>
      </div>

      {!rows.length && (
        <Empty>
          <div className="max-w-[380px] mx-auto">
            <p>
              Конверт — це куди лягає витрата: «Їжа», «Комуналка», «Авто».
              З них збирається план місяця, а факт підтягується з витрат сам.
            </p>
            <div className="mt-4">
              <Btn variant="primary" onClick={() => setEditing('new')}>{Icon.plus(16)} Створити конверт</Btn>
            </div>
          </div>
        </Empty>
      )}

      {groups.map(g => {
        const list = g.rows.map(r => r.envelope)
        return (
          <section key={g.value} className="mt-5">
            <div className="sm:px-6"><SectionTitle>{g.label}</SectionTitle></div>
            <Rows>
              {g.rows.map((r, i) => (
                <PlanRow key={r.envelope.id}
                  env={r.envelope}
                  planned={r.planned}
                  actual={r.actual}
                  auto={envelopeAsk(db, r.envelope.id, month).open}
                  sources={envelopeSources(db, r.envelope.id).length}
                  ownerName={db.members.find(m => m.id === r.envelope.ownerId)?.name}
                  reordering={reordering}
                  onCommit={v => setPlanned(r.envelope.id, month, v)}
                  onOpen={() => setEditing(r.envelope)}
                  onUp={i > 0 ? () => swap(list, i, -1) : undefined}
                  onDown={i < list.length - 1 ? () => swap(list, i, 1) : undefined} />
              ))}
            </Rows>
          </section>
        )
      })}

      {income.length > 0 && (
        <section className="mt-5">
          <div className="sm:px-6"><SectionTitle>Дохід</SectionTitle></div>
          <Rows>
            {income.map(e => (
              <ListRow key={e.id} onClick={() => setEditing(e)}>
                <span className="flex-1 truncate text-[14px]">{e.name}</span>
                <span className="text-[12px] num text-faint shrink-0" title={usageTitle(usageOf(db, e.id))}>
                  {usageLabel(usageOf(db, e.id))}
                </span>
              </ListRow>
            ))}
          </Rows>
          <p className="px-4 sm:px-6 mt-2 text-[12px] text-faint">
            Дохід не планується по конвертах — він у зведенні вище.
          </p>
        </section>
      )}

      {archived.length > 0 && (
        <section className="mt-6">
          <button onClick={() => setShowArchived(v => !v)}
            aria-expanded={showArchived}
            className="w-full flex items-center gap-2 px-4 sm:px-6 py-2.5 text-[12px] uppercase tracking-wider text-faint hover:text-muted">
            <span className={showArchived ? 'rotate-90 transition-transform' : 'transition-transform'}>{Icon.chev(14)}</span>
            Архів
            <span className="num">{archived.length}</span>
          </button>
          {showArchived && (
            <Rows>
              {archived.map(e => (
                <ListRow key={e.id} onClick={() => setEditing(e)}>
                  <span className="flex-1 truncate text-[14px] text-muted">{e.name}</span>
                  <span className="text-[12px] num text-faint shrink-0" title={usageTitle(usageOf(db, e.id))}>
                    {usageLabel(usageOf(db, e.id))}
                  </span>
                  <span className="shrink-0" onClick={ev => ev.stopPropagation()}>
                    <Btn variant="quiet" onClick={() => archiveEnvelope(e.id, false)}>Повернути</Btn>
                  </span>
                </ListRow>
              ))}
            </Rows>
          )}
        </section>
      )}

      <p className="px-4 sm:px-6 mt-4 text-[12px] text-faint">
        Конверти не видаляються: на них посилаються записи за минулі місяці.
        Зайвий — в архів, історія залишиться цілою.
      </p>

      <Sheet open={editing !== null} onClose={() => setEditing(null)}
        title={editing === 'new' ? 'Новий конверт' : editing ? editing.name : ''}>
        {editing !== null && (
          <EnvelopeForm
            key={editing === 'new' ? 'new' : editing.id}
            env={editing === 'new' ? null : editing}
            db={db}
            month={month}
            onDone={() => setEditing(null)} />
        )}
      </Sheet>
    </div>
  )
}

/**
 * Рядок плану. Крім факту проти плану показує, скільки з місяця вже розписано
 * автоматикою — блідим сегментом на смужці і підписом «авто». Без цього
 * незрозуміло, чому конверт «порожній», хоч насправді за нього вже все вирішено.
 */
function PlanRow({ env, planned, actual, auto, sources, ownerName, reordering, onCommit, onOpen, onUp, onDown }: {
  env: Envelope; planned: number; actual: number; auto: number; sources: number; ownerName?: string
  reordering: boolean
  onCommit: (v: number) => void
  onOpen: () => void
  onUp?: () => void
  onDown?: () => void
}) {
  const over = planned > 0 && actual > planned
  const short = planned > 0 && actual + auto > planned

  return (
    <li className="px-4 sm:px-6 py-2.5">
      <div className="flex items-center gap-3">
        <button type="button" onClick={onOpen}
          className="flex-1 min-w-0 flex items-center gap-2 text-left rounded-md hover:text-accent transition-colors">
          <span className="text-[14px] truncate">{env.name}</span>
          {sources > 0 && (
            <span className="shrink-0 text-faint" title={`Надходить сюди само: ${sources}`}>{Icon.clock(13)}</span>
          )}
          {ownerName && <Badge>{ownerName}</Badge>}
        </button>

        {reordering ? (
          <span className="flex items-center shrink-0">
            <IconButton label={`Вище: ${env.name}`} disabled={!onUp} onClick={onUp}>
              <span className="-rotate-90 block">{Icon.chev(16)}</span>
            </IconButton>
            <IconButton label={`Нижче: ${env.name}`} disabled={!onDown} onClick={onDown}>
              <span className="rotate-90 block">{Icon.chev(16)}</span>
            </IconButton>
          </span>
        ) : (
          <>
            <span className="text-[13px] num text-muted">{money(actual)}</span>
            <span className="text-faint text-[13px]">/</span>
            <PlanInput value={planned} onCommit={onCommit} />
          </>
        )}
      </div>

      {!reordering && (
        <>
          <div className="mt-1.5">
            <Progress
              value={planned ? actual / planned : 0}
              pending={planned ? auto / planned : 0}
              tone={over ? 'warn' : 'accent'} height={4} />
          </div>
          {auto > 0 && (
            <div className="mt-1 text-[11.5px] text-faint num">
              <span className={short && !over ? 'text-warn' : undefined}>
                ще {money(auto)} автоматом
              </span>
              {short && !over && <span className="text-faint"> · більше за план</span>}
            </div>
          )}
        </>
      )}
    </li>
  )
}

function PlanInput({ value, onCommit }: { value: number; onCommit: (v: number) => void }) {
  const [raw, setRaw] = useState<string | null>(null)
  const shown = raw ?? (value ? String(value / 100) : '')
  return (
    <input
      value={shown}
      onChange={e => setRaw(e.target.value)}
      onFocus={e => e.currentTarget.select()}
      onBlur={() => { if (raw !== null) { onCommit(parseAmount(raw) ?? 0); setRaw(null) } }}
      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
      inputMode="decimal" placeholder="—" aria-label="План на місяць"
      className="w-[92px] h-8 px-2 text-right text-[13px] num rounded-md border border-transparent hover:border-line focus:border-accent bg-transparent outline-none"
    />
  )
}

/**
 * Що проходить через конверт САМО — і як це звідси змінити.
 *
 * Це відповідь на «а чим конверт відрізняється від фонду й боргу»: конверт
 * не робить нічого сам, він ПРИЙМАЄ. Фонд, борг і регулярне правило —
 * джерела, які в нього щомісяця щось кладуть.
 *
 * Головне тут — не список, а те, що кожен рядок ВЕДЕ до свого джерела, а
 * привʼязати нове можна не виходячи з конверта. Доти правило жило тільки там,
 * де його завели, і конверт про нього лише повідомляв.
 */
function EnvelopeLinks({ env, db, month }: { env: Envelope; db: DB; month: string }) {
  const nav = useNavigate()
  const [attach, setAttach] = useState(false)
  const [fundId, setFundId] = useState<ID | ''>('')
  const [day, setDay] = useState(1)

  const sources = envelopeSources(db, env.id)
  const ask = envelopeAsk(db, env.id, month)
  const free = unlinkedFunds(db)

  const attachFund = () => {
    const f = db.funds.find(x => x.id === fundId)
    if (!f) return
    updateFund(f.id, { envelopeId: env.id, contributionDay: day })
    setAttach(false); setFundId(''); setDay(1)
    toast(`«${f.name}» нагадує ${day} числа`)
  }

  const actions = (
    <>
      <AttachButton onClick={() => nav(newRuleRoute({ envelopeId: env.id }))}>
        Регулярний платіж
      </AttachButton>
      {free.length > 0
        ? <AttachButton onClick={() => { setAttach(true); setFundId(free[0].id) }}>Фонд</AttachButton>
        : <AttachButton onClick={() => nav(`/funds?fund=new&env=${env.id}`)}>Новий фонд</AttachButton>}
      {env.kind === 'debt' && <AttachButton onClick={() => nav('/debts?debt=new')}>Борг</AttachButton>}
    </>
  )

  return (
    <LinkGroup
      title="Надходить сюди само"
      summary={ask.auto > 0
        ? <>цього місяця <span className="text-ink">{money(ask.auto)}</span></>
        : undefined}
      hint={sources.length
        ? undefined
        : 'Витрати сюди потрапляють лише швидким записом. Привʼяжіть фонд або створіть регулярний платіж — і конверт сам нагадає про себе в чеклісті місяця.'}
      actions={attach ? undefined : actions}>

      {sources.map(l => (
        <LinkRow key={l.key} link={l} onOpen={() => nav(l.to)} />
      ))}

      {attach && (
        <div className="rounded-lg border border-line bg-surface p-2.5 mt-1">
          <Field label="Який фонд" hint="Внесок зʼявиться в чеклісті місяця й у задачах.">
            <Select<ID> value={fundId} onChange={setFundId}
              options={free.map(f => ({ value: f.id, label: f.name }))} />
          </Field>
          <Field label="Якого числа">
            <Select value={String(day)} onChange={v => setDay(Number(v))}
              options={Array.from({ length: 28 }, (_, i) => ({ value: String(i + 1), label: `${i + 1} числа` }))} />
          </Field>
          <div className="flex gap-2 mt-1">
            <Btn variant="primary" onClick={attachFund} disabled={!fundId}>Привʼязати</Btn>
            <Btn variant="quiet" onClick={() => setAttach(false)}>Скасувати</Btn>
          </div>
        </div>
      )}
    </LinkGroup>
  )
}

function EnvelopeForm({ env, db, month, onDone }: {
  env: Envelope | null; db: DB; month: string; onDone: () => void
}) {
  const [name, setName] = useState(env?.name ?? '')
  const [kind, setKind] = useState<EnvelopeKind>(env?.kind ?? 'variable')
  const [ownerId, setOwnerId] = useState<ID | ''>(env?.ownerId ?? '')
  const [archived, setArchived] = useState(!!env?.archived)

  const trimmed = name.trim()
  const duplicate = db.envelopes.some(e =>
    e.id !== env?.id && !e.archived && e.name.trim().toLowerCase() === trimmed.toLowerCase())
  const needsOwner = kind === 'personal' && !ownerId
  const canSave = !!trimmed && !duplicate && !needsOwner

  const usage = env ? usageOf(db, env.id) : null

  const save = () => {
    if (!canSave) return
    const owner = kind === 'personal' ? (ownerId || undefined) : undefined
    if (env) {
      updateEnvelope(env.id, { name: trimmed, kind, ownerId: owner })
      if (archived !== !!env.archived) archiveEnvelope(env.id, archived)
    } else {
      addEnvelope({ name: trimmed, kind, ownerId: owner })
    }
    onDone()
  }

  return (
    <div>
      {env && <EnvelopeLinks env={env} db={db} month={month} />}

      <Field label="Назва" htmlFor="env-name"
        error={duplicate ? 'Конверт з такою назвою вже є' : undefined}
        hint={duplicate ? undefined : 'Коротко, як у житті: «Їжа», «Комуналка», «Авто»'}>
        <Input id="env-name" value={name} onChange={setName} autoFocus
          placeholder="Назва конверта" onEnter={save} />
      </Field>

      <Field label="Тип" htmlFor="env-kind" hint={KIND_HINT[kind]}>
        <Select id="env-kind" value={kind}
          onChange={k => { setKind(k); if (k !== 'personal') setOwnerId('') }}
          options={KINDS.map(k => ({ value: k.value, label: k.label }))} />
      </Field>

      {kind === 'personal' && (
        <Field label="Власник" htmlFor="env-owner"
          error={needsOwner ? 'Особистий конверт належить комусь одному' : undefined}>
          <Select<ID> id="env-owner" value={ownerId} onChange={setOwnerId} placeholder="Вибрати"
            options={db.members.map(m => ({ value: m.id, label: m.name }))} />
        </Field>
      )}

      {/* Архів — рідкісна дія, тож без окремої картки-абзацу: лічильник
          записів переїхав у підказку, де він пояснює, чому видалення немає. */}
      {env && (
        <div className="border-t border-line pt-2 mt-1">
          <Switch checked={archived} onChange={setArchived} label="В архіві"
            hint={usage!.total
              ? `${usageTitle(usage!)}. В архіві конверт зникає зі списків, записи лишаються.`
              : 'Не показується в плані місяця й у швидкому записі.'} />
        </div>
      )}

      <FormActions onSubmit={save} onCancel={onDone} disabled={!canSave}
        submitLabel={env ? 'Зберегти' : 'Створити'} />
    </div>
  )
}

