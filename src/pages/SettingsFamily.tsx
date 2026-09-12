import { useState } from 'react'
import {
  Avatar, Badge, Btn, Card, ConfirmButton, Field, FormActions, Icon, Input,
  Pill, SectionTitle, Sheet,
} from '../ui'
import { useDB, setMe, addMember, updateMember, setRates, resetAll } from '../data/store'
import type { Member } from '../data/types'
import { money } from '../lib/money'

/** Кольори учасників — це дані, а не тема: тут hex доречний. */
const PALETTE = [
  '#0F6B5C', '#8F5514', '#2F6DA8', '#7A4FA3',
  '#A13D5E', '#3F7A34', '#B0641C', '#4A5B7A',
]
const HEX = /^#[0-9a-fA-F]{6}$/

export default function SettingsFamily() {
  const db = useDB()
  const [editing, setEditing] = useState<Member | 'new' | null>(null)
  const me = db.members.find(m => m.id === db.meId)

  return (
    <div className="max-w-[760px] mx-auto pb-10">
      <header className="px-4 pt-3 pb-3 sm:px-6">
      </header>

      {/* ── хто зараз записує ── */}
      <SectionTitle>Зараз записує</SectionTitle>
      <div className="px-4 sm:px-6">
        <Card>
          <div className="flex gap-1.5 flex-wrap">
            {db.members.map(m => (
              <Pill key={m.id} active={db.meId === m.id} onClick={() => setMe(m.id)}>
                <Avatar member={m} size={18} /> {m.name}
              </Pill>
            ))}
          </div>
          <p className="text-[12.5px] text-faint mt-3 leading-snug">
            {/* ім'я показуємо називним відмінком окремо: «записуються на Іра» — помилка,
                а відмінювати імена в коді не варто */}
            Зараз усе записується від імені: {me ? <b className="font-medium text-muted">{me.name}</b> : '— нікого не вибрано'}.
            Витрати, виконані задачі й куплене підуть саме сюди. Перемикайте, коли застосунок
            бере в руки інший — інакше все впаде на одного, і баланс навантаження
            покаже 100/0 замість правди.
          </p>
        </Card>
      </div>

      {/* ── учасники ── */}
      <SectionTitle right={<Btn variant="quiet" onClick={() => setEditing('new')}>{Icon.plus(16)} Додати</Btn>}>
        Учасники
      </SectionTitle>
      <ul className="border-y border-line divide-y divide-line bg-surface">
        {db.members.map(m => (
          <li key={m.id}>
            <button onClick={() => setEditing(m)}
              className="w-full text-left flex items-center gap-3 px-4 sm:px-6 py-3 hover:bg-surface2/60 transition-colors">
              <Avatar member={m} size={28} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-[14px]">{m.name}</span>
                  {db.meId === m.id && <Badge tone="accent">записує</Badge>}
                </div>
                <div className="text-[12.5px] text-faint">Ініціали: {m.initials}</div>
              </div>
              <span className="text-faint shrink-0">{Icon.chev(16)}</span>
            </button>
          </li>
        ))}
      </ul>

      {/* ── курси ── */}
      <SectionTitle>Курси валют</SectionTitle>
      <div className="px-4 sm:px-6">
        <Card>
          <div className="grid grid-cols-2 gap-3">
            <RateField code="USD" symbol="$" value={db.rates.USD} />
            <RateField code="EUR" symbol="€" value={db.rates.EUR} />
          </div>
          <p className="text-[12.5px] text-faint mt-1 leading-snug">
            Новий курс діє тільки на нові записи: кожен запис заморожує свій курс у момент
            створення, і історія ніколи не перераховується заднім числом.
            Переоцінюються лише залишки готівки.
          </p>
          <div className="mt-3 rounded-lg bg-surface2 px-3 py-2 text-[12.5px] text-muted">
            Зараз 100 $ ≈ <span className="num">{money(Math.round(10000 * db.rates.USD))}</span>,
            100 € ≈ <span className="num">{money(Math.round(10000 * db.rates.EUR))}</span>
          </div>
        </Card>
      </div>

      {/* ── дані ── */}
      <SectionTitle>Дані</SectionTitle>
      <div className="px-4 sm:px-6">
        <Card>
          <p className="text-[13.5px]">Скинути до стартових даних</p>
          <p className="text-[12.5px] text-faint mt-1 leading-snug">
            Зітре все: витрати, платежі, фонди, борги, задачі й покупки — і поставить
            демонстраційний набір замість них. Скасувати це не вийде.
          </p>
          <div className="mt-3">
            <ConfirmButton confirmLabel="Точно стерти все?" onConfirm={resetAll}>
              {Icon.trash(16)} Скинути дані
            </ConfirmButton>
          </div>
        </Card>
      </div>

      <Sheet open={editing !== null} onClose={() => setEditing(null)}
             title={editing === 'new' ? 'Новий учасник' : 'Учасник'}>
        {editing !== null && (
          <MemberForm
            initial={editing === 'new' ? undefined : editing}
            taken={db.members.map(m => m.color)}
            onSave={v => {
              if (editing === 'new') addMember(v)
              else updateMember(editing.id, v)
              setEditing(null)
            }}
            onCancel={() => setEditing(null)}
          />
        )}
      </Sheet>
    </div>
  )
}

/** Курс: скільки гривень за одиницю. Зберігаємо, щойно значення валідне. */
function RateField({ code, symbol, value }: { code: 'USD' | 'EUR'; symbol: string; value: number }) {
  const [raw, setRaw] = useState<string | null>(null)
  const shown = raw ?? String(value).replace('.', ',')
  const n = Number(shown.replace(',', '.').trim())
  const bad = !shown.trim() || !isFinite(n) || n <= 0

  return (
    <Field label={`1 ${symbol} у гривні`} htmlFor={`rate-${code}`}
           error={bad ? 'Потрібне число більше за нуль' : undefined}
           hint={bad ? undefined : `Курс ${code}`}>
      <Input id={`rate-${code}`} value={shown} align="right" inputMode="decimal"
        onChange={v => {
          setRaw(v)
          const parsed = Number(v.replace(',', '.').trim())
          if (v.trim() && isFinite(parsed) && parsed > 0) setRates({ [code]: parsed })
        }} />
    </Field>
  )
}

function MemberForm({ initial, taken, onSave, onCancel }: {
  initial?: Member
  taken: string[]
  onSave: (v: { name: string; color: string; initials?: string }) => void
  onCancel: () => void
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [initials, setInitials] = useState(initial?.initials ?? '')
  const [color, setColor] = useState(initial?.color ?? PALETTE.find(c => !taken.includes(c)) ?? PALETTE[0])

  const shownInitials = (initials.trim() || name.trim().slice(0, 1)).toUpperCase()
  const colorOk = HEX.test(color.trim())
  const ok = name.trim().length > 0 && colorOk

  const preview: Member = {
    id: initial?.id ?? 'preview', name: name.trim() || 'Ім\'я',
    color: colorOk ? color.trim() : 'var(--c-line2)',
    initials: shownInitials || '?',
  }

  function submit() {
    if (!ok) return
    onSave({ name: name.trim(), color: color.trim(), initials: shownInitials })
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <Avatar member={preview} size={44} />
        <div className="text-[13.5px] text-faint">Так учасник виглядатиме в задачах і платежах.</div>
      </div>

      <Field label="Ім'я" htmlFor="m-name">
        <Input id="m-name" value={name} onChange={setName} autoFocus placeholder="Іра" onEnter={submit} />
      </Field>

      <Field label="Ініціали" htmlFor="m-initials"
             hint="Одна-дві літери для кружка. Порожнє — візьмемо першу літеру імені">
        <Input id="m-initials" value={initials} onChange={v => setInitials(v.slice(0, 2))}
               placeholder={name.trim().slice(0, 1).toUpperCase() || 'І'} onEnter={submit} />
      </Field>

      <Field label="Колір">
        <div className="flex gap-1.5 flex-wrap">
          {PALETTE.map(c => (
            <Pill key={c} active={color.trim().toLowerCase() === c.toLowerCase()}
                  title={c} onClick={() => setColor(c)}>
              <span className="w-4 h-4 rounded-full block" style={{ background: c }} />
            </Pill>
          ))}
        </div>
      </Field>

      <Field label="Свій колір" htmlFor="m-color"
             error={colorOk ? undefined : 'Потрібен код виду #0F6B5C'}
             hint={colorOk ? 'Код кольору — це дані учасника, а не тема застосунку' : undefined}>
        <Input id="m-color" value={color} onChange={setColor} placeholder="#0F6B5C" onEnter={submit} />
      </Field>

      <FormActions onSubmit={submit} onCancel={onCancel} disabled={!ok} />
    </div>
  )
}
