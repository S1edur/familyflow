import { useMemo, useState } from 'react'
import { AttachButton, Btn, DateInput, Field, Input, Pill, Segmented, Select, Sheet, toast } from '../ui'
import { useDB, addEntry, freeProject } from '../data/store'
import { payableProjects } from './RuleForm'
import { SYMBOL, money, parseAmount } from '../lib/money'
import type { Currency, DB, EntryKind, Project } from '../data/types'
import { addDays, monthKey, today } from '../lib/dates'

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', ',', '0', '⌫']
type Kind = Extract<EntryKind, 'expense' | 'income'>
const SUGGEST_DAYS = 60
const SUGGEST_MAX = 4
const NNBSP = '\u202F'

// Розряди вузьким пробілом і кома, як у money(): сума на табло не має
// виглядати інакше, ніж та сама сума в списку після запису.
function formatRaw(raw: string): string {
  const [int, frac] = raw.split(',')
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, NNBSP)
  return frac === undefined ? grouped : `${grouped},${frac}`
}

function formatRate(rate: number): string {
  return rate.toLocaleString('uk-UA', { maximumFractionDigits: 4 }).replace(/[\s\u00A0]/g, NNBSP)
}

// Проєкти, куди найчастіше пишуть витрати останнім часом. Рахуємо на читанні
// з записів, нічого не зберігаючи (інваріант 4): звичка змінюється — підказки теж.
function suggestProjects(db: DB, usable: Project[]): Project[] {
  const byId = new Map(usable.map(p => [p.id, p]))
  const since = addDays(today(), -SUGGEST_DAYS)
  const stats = new Map<string, { n: number; last: string }>()
  for (const e of db.entries) {
    if ((e.kind !== 'expense' && e.kind !== 'repay') || !e.projectId
      || e.occurredOn < since || !byId.has(e.projectId)) continue
    const cur = stats.get(e.projectId) ?? { n: 0, last: '' }
    cur.n++
    if (e.occurredOn > cur.last) cur.last = e.occurredOn
    stats.set(e.projectId, cur)
  }
  if (stats.size) {
    return [...stats.entries()]
      .sort(([, a], [, b]) => b.n - a.n || b.last.localeCompare(a.last))
      .slice(0, SUGGEST_MAX)
      .map(([id]) => byId.get(id)!)
  }
  // новий дім без історії: проєкти «витрачати» — найімовірніше, куди пишуть першими
  return usable.filter(p => p.direction === 'spend').slice(0, SUGGEST_MAX)
}

export function QuickAdd({ open, onClose }: { open: boolean; onClose: () => void }) {
  const db = useDB()
  const [kind, setKind] = useState<Kind>('expense')
  const [raw, setRaw] = useState('')
  const [currency, setCurrency] = useState<Currency>('UAH')
  const [note, setNote] = useState('')
  const [date, setDate] = useState<string | undefined>(today())

  // Витрата можлива в будь-який активний проєкт, крім «Вільних»: без проєкту
  // вона й так лягає у вільні. «Без грошей» теж пропускаємо — там лише задачі.
  const spendable = useMemo(
    () => payableProjects(db).filter(p => p.direction !== 'none'),
    [db.projects],
  )
  const suggested = useMemo(() => suggestProjects(db, spendable), [spendable, db.entries])
  const [choice, setChoice] = useState('')
  const [pickOther, setPickOther] = useState(false)

  // Вибір скидається при кожному відкритті листа: компонент живе весь час,
  // а проєкти до входу в хмару були демо-даними — їхні id у запис іти не мають.
  const [wasOpen, setWasOpen] = useState(false)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setChoice(suggested[0]?.id ?? '')
      setPickOther(false)
    }
  }

  // Перевірка на читанні: проєкт могли завершити або дані могли замінитись,
  // поки лист відкритий. Витрата без проєкту допустима — це «Вільні гроші».
  const project = spendable.find(p => p.id === choice)
  const projectId = project?.id ?? ''

  // шаблони: найчастіші трійки (проєкт, валюта, сума) з історії витрат.
  // Суму групуємо з точністю до гривні/долара — копійки не роблять запис іншим.
  const presets = useMemo(() => {
    const usable = new Set(spendable.map(p => p.id))
    const counts = new Map<string, { projectId: string; currency: Currency; amount: number; n: number }>()
    for (const e of db.entries) {
      if ((e.kind !== 'expense' && e.kind !== 'repay') || !e.projectId || !usable.has(e.projectId)) continue
      const amount = Math.max(100, Math.round(e.amountMinor / 100) * 100)
      const k = `${e.projectId}|${e.currency}|${amount}`
      const cur = counts.get(k) ?? { projectId: e.projectId, currency: e.currency, amount, n: 0 }
      cur.n++; counts.set(k, cur)
    }
    return [...counts.values()].sort((a, b) => b.n - a.n).slice(0, 4)
  }, [db.entries, spendable])

  const minor = parseAmount(raw)
  const press = (k: string) => {
    if (k === '⌫') return setRaw(r => r.slice(0, -1))
    if (k === ',' && raw.includes(',')) return
    setRaw(r => (r + k).slice(0, 12))
  }
  const submit = () => {
    if (!minor) return
    const common = { amountMinor: minor, currency, note: note.trim() || undefined, occurredOn: date || today() }
    if (kind === 'income') {
      // дохід завжди у вільні: розкласти по проєктах — окрема свідома дія
      addEntry({ ...common, kind: 'income', projectId: freeProject(db)?.id })
    } else {
      addEntry({ ...common, kind: project?.direction === 'repay' ? 'repay' : 'expense', projectId: projectId || undefined })
    }
    // оптимістичне оновлення без спінера потребує сліду, інакше незрозуміло,
    // чи взагалі щось сталось: лист закрився і все
    const label = kind === 'income' ? '' : project ? ' · ' + project.name : ''
    toast(`${kind === 'income' ? 'Дохід' : 'Записано'}: ${money(minor, currency)}${label}`)
    setRaw(''); setNote(''); setDate(today()); setPickOther(false)
    onClose()
  }

  // підсумок за місяць вибраної дати, а не завжди за поточний
  const month = monthKey(date || today())
  const free = freeProject(db)
  const sumThis = db.entries
    .filter(e => monthKey(e.occurredOn) === month && (kind === 'income'
      ? e.kind === 'income'
      : (e.kind === 'expense' || e.kind === 'repay') && (projectId
        ? e.projectId === projectId
        : !e.projectId || e.projectId === free?.id)))
    .reduce((s, e) => s + e.amountBaseMinor, 0)

  // вибраний поза підказками теж стає пілюлею — інакше вибір не видно
  const pills = project && !suggested.some(p => p.id === project.id) ? [...suggested, project] : suggested

  return (
    <Sheet open={open} onClose={onClose} title={kind === 'income' ? 'Дохід' : 'Витрата'}>
      <Segmented value={kind} onChange={setKind} full label="Тип запису" items={[
        { value: 'expense', label: 'Витрата' },
        { value: 'income', label: 'Дохід' },
      ]} />

      <div className="text-center py-3">
        <div className="text-[34px] font-semibold num tracking-tight">
          {raw ? `${formatRaw(raw)} ` : <span className="text-faint">0 </span>}
          <span className="text-muted text-[24px]">{SYMBOL[currency]}</span>
        </div>
        <div className="text-[12.5px] text-faint mt-0.5">
          {kind === 'income'
            ? <>дохід цього місяця — {money(sumThis)}</>
            : projectId
              ? <>у цьому місяці на цей проєкт — {money(sumThis)}</>
              : <>у цьому місяці без проєкту — {money(sumThis)}</>}
        </div>
      </div>

      {kind === 'expense' && presets.length > 0 && !raw && (
        <div className="flex gap-1.5 flex-wrap justify-center mb-3">
          {presets.map((p, i) => {
            const pr = spendable.find(x => x.id === p.projectId)
            return (
              <Pill key={i}
                onClick={() => { setChoice(p.projectId); setCurrency(p.currency); setRaw(String(p.amount / 100)) }}
                title={`${pr?.name}, ${money(p.amount, p.currency)}`}>
                <span className="text-[12.5px]">{pr?.name} · <span className="num">{money(p.amount, p.currency)}</span></span>
              </Pill>
            )
          })}
        </div>
      )}

      {kind === 'expense' && (
        <div className="mb-2">
          <div className="flex gap-1.5 flex-wrap" role="group" aria-label="Проєкт">
            {pills.map(p => (
              <Pill key={p.id} active={p.id === projectId}
                // проєкт необов'язковий: повторний тап знімає вибір — витрата йде у вільні
                onClick={() => setChoice(cur => (cur === p.id ? '' : p.id))}>
                {p.name}
              </Pill>
            ))}
            {!pickOther && spendable.length > pills.length && (
              <AttachButton onClick={() => setPickOther(true)}>Інший…</AttachButton>
            )}
          </div>
          {pickOther && (
            <div className="mt-1.5">
              <Select value={projectId} placeholder="Без проєкту"
                onChange={v => { setChoice(v); setPickOther(false) }}
                options={spendable.map(p => ({ value: p.id, label: p.name }))} />
            </div>
          )}
        </div>
      )}

      <div className="flex gap-1.5 mb-2 items-center flex-wrap">
        {(['UAH', 'USD', 'EUR'] as Currency[]).map(c => (
          <Pill key={c} active={currency === c} onClick={() => setCurrency(c)}>{c}</Pill>
        ))}
        {currency !== 'UAH' && (
          <span className="text-[12px] text-faint num ml-1">
            курс {formatRate(db.rates[currency])} → {minor ? money(Math.round(minor * db.rates[currency])) : '—'}
          </span>
        )}
      </div>

      <div className="grid grid-cols-[1fr_auto] gap-2 items-start">
        <Field label="Нотатка" htmlFor="qa-note">
          <Input id="qa-note" value={note} onChange={setNote} placeholder="Необов’язково" onEnter={submit} />
        </Field>
        <Field label="Дата" htmlFor="qa-date">
          <DateInput id="qa-date" value={date} onChange={setDate} />
        </Field>
      </div>

      <div className="grid grid-cols-3 gap-1.5">
        {KEYS.map(k => (
          <button key={k} onClick={() => press(k)} aria-label={k === '⌫' ? 'Стерти' : undefined}
            className="h-13 py-3.5 rounded-lg bg-surface2 text-[19px] font-medium num active:opacity-70">
            {k}
          </button>
        ))}
      </div>

      <div className="mt-3">
        <Btn variant="primary" full onClick={submit} disabled={!minor}>Записати</Btn>
      </div>
    </Sheet>
  )
}
