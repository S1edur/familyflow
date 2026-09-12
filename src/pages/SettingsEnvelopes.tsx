import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Badge, Btn, Card, Empty, Field, FormActions, Icon, IconButton, Input,
  ListRow, SectionTitle, Select, Sheet, Switch,
} from '../ui'
import {
  useDB, addEnvelope, updateEnvelope, archiveEnvelope, reorderEnvelope,
} from '../data/store'
import type { DB, Envelope, EnvelopeKind, ID } from '../data/types'

/* Порядок груп на екрані: спершу звідки гроші приходять, далі куди йдуть. */
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

const byOrder = (a: Envelope, b: Envelope) =>
  a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'uk')

/** Строго зростаючі позиції з наявних — щоб обмін місцями спрацював і на однакових sortOrder. */
function slots(values: number[]) {
  let prev = -Infinity
  return values.map(v => { const next = v > prev ? v : prev + 1; prev = next; return next })
}

export default function SettingsEnvelopes() {
  const db = useDB()
  const [editing, setEditing] = useState<Envelope | 'new' | null>(null)
  const [showArchived, setShowArchived] = useState(false)

  const active = useMemo(() => db.envelopes.filter(e => !e.archived).sort(byOrder), [db.envelopes])
  const archived = useMemo(() => db.envelopes.filter(e => e.archived).sort(byOrder), [db.envelopes])
  const groups = KINDS
    .map(k => ({ ...k, items: active.filter(e => e.kind === k.value) }))
    .filter(g => g.items.length > 0)

  /** Обмін місцями із сусідом усередині своєї групи. */
  const move = (env: Envelope, dir: -1 | 1) => {
    const group = active.filter(e => e.kind === env.kind)
    const i = group.findIndex(e => e.id === env.id)
    const j = i + dir
    if (i < 0 || j < 0 || j >= group.length) return
    const positions = slots(group.map(e => e.sortOrder))
    const next = group.slice()
    next[i] = group[j]
    next[j] = group[i]
    next.forEach((e, k) => { if (e.sortOrder !== positions[k]) reorderEnvelope(e.id, positions[k]) })
  }

  return (
    <div className="max-w-[760px] mx-auto">
      <header className="px-4 pt-5 pb-3 sm:px-6">
        <Link to="/settings" className="inline-flex items-center gap-1 text-[12.5px] text-muted hover:text-ink">
          <span className="rotate-180">{Icon.chev(14)}</span>Налаштування
        </Link>
        <div className="flex items-center gap-3 mt-1.5">
          <h1 className="flex-1 text-[22px] font-semibold tracking-tight">Конверти</h1>
          <Btn variant="primary" onClick={() => setEditing('new')}>{Icon.plus(16)} Новий</Btn>
        </div>
        <p className="text-[12.5px] text-faint mt-1.5">
          Конверти не видаляються: на них посилаються записи за минулі місяці. Зайвий — в архів,
          історія залишиться цілою.
        </p>
      </header>

      {!active.length && (
        <Empty>
          <p>Конверт — це куди лягає витрата: «Їжа», «Комуналка», «Авто».<br />
            З них збирається план місяця.</p>
          <div className="mt-3"><Btn variant="primary" onClick={() => setEditing('new')}>Створити конверт</Btn></div>
        </Empty>
      )}

      {groups.map(g => (
        <section key={g.value}>
          <SectionTitle>{g.label}</SectionTitle>
          <ul className="border-y border-line divide-y divide-line bg-surface">
            {g.items.map((e, i) => (
              <EnvelopeRow key={e.id} env={e} usage={usageOf(db, e.id)} db={db}
                onOpen={() => setEditing(e)}
                onUp={i > 0 ? () => move(e, -1) : undefined}
                onDown={i < g.items.length - 1 ? () => move(e, 1) : undefined} />
            ))}
          </ul>
        </section>
      ))}

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
            <ul className="border-y border-line divide-y divide-line bg-surface">
              {archived.map(e => (
                <EnvelopeRow key={e.id} env={e} usage={usageOf(db, e.id)} db={db}
                  onOpen={() => setEditing(e)}
                  onRestore={() => archiveEnvelope(e.id, false)} />
              ))}
            </ul>
          )}
        </section>
      )}

      <Sheet open={editing !== null} onClose={() => setEditing(null)}
        title={editing === 'new' ? 'Новий конверт' : editing ? editing.name : ''}>
        {editing !== null && (
          <EnvelopeForm
            key={editing === 'new' ? 'new' : editing.id}
            env={editing === 'new' ? null : editing}
            db={db}
            onDone={() => setEditing(null)} />
        )}
      </Sheet>
    </div>
  )
}

function EnvelopeRow({ env, usage, db, onOpen, onUp, onDown, onRestore }: {
  env: Envelope; usage: Usage; db: DB; onOpen: () => void
  onUp?: () => void; onDown?: () => void; onRestore?: () => void
}) {
  const owner = db.members.find(m => m.id === env.ownerId)
  return (
    <ListRow onClick={onOpen}>
      <span className={`flex-1 truncate text-[14px] ${env.archived ? 'text-muted' : ''}`}>{env.name}</span>
      {owner && <Badge>{owner.name}</Badge>}
      <span className="text-[12px] num text-faint shrink-0" title={usageTitle(usage)}>
        {usage.total
          ? `${usage.total} ${plural(usage.total, 'запис', 'записи', 'записів')}`
          : 'порожній'}
      </span>
      <span className="flex items-center shrink-0" onClick={ev => ev.stopPropagation()}>
        {onRestore && <Btn variant="quiet" onClick={onRestore}>Повернути</Btn>}
        {(onUp || onDown) && (
          <>
            <IconButton label={`Вище: ${env.name}`} disabled={!onUp} onClick={onUp}>
              <span className="-rotate-90 block">{Icon.chev(16)}</span>
            </IconButton>
            <IconButton label={`Нижче: ${env.name}`} disabled={!onDown} onClick={onDown}>
              <span className="rotate-90 block">{Icon.chev(16)}</span>
            </IconButton>
          </>
        )}
      </span>
    </ListRow>
  )
}

function usageTitle(u: Usage) {
  const parts: string[] = []
  if (u.entries) parts.push(`витрат і доходів: ${u.entries}`)
  if (u.occurrences) parts.push(`платежів: ${u.occurrences}`)
  if (u.plans) parts.push(`регулярних: ${u.plans}`)
  if (u.planLines) parts.push(`планів місяця: ${u.planLines}`)
  return parts.length ? parts.join(', ') : 'На цей конверт ще нічого не записано'
}

function EnvelopeForm({ env, db, onDone }: { env: Envelope | null; db: DB; onDone: () => void }) {
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

      {env && (
        <>
          <Card className="mt-1 text-[12.5px] text-muted">
            <div className="text-ink">
              На конверт посилається <span className="num">{usage!.total}</span>{' '}
              {plural(usage!.total, 'запис', 'записи', 'записів')}
            </div>
            <p className="mt-1">
              {usage!.total
                ? `${usageTitle(usage!)}. Архів прибирає конверт зі списків і нових витрат — записи залишаються на місці.`
                : 'Поки що нічого. Архів прибирає конверт зі списків, видалення немає навмисно.'}
            </p>
          </Card>
          <div className="mt-2">
            <Switch checked={archived} onChange={setArchived} label="В архіві"
              hint="Не показується в плані місяця й у швидкому записі" />
          </div>
        </>
      )}

      <FormActions onSubmit={save} onCancel={onDone} disabled={!canSave}
        submitLabel={env ? 'Зберегти' : 'Створити'} />
    </div>
  )
}
