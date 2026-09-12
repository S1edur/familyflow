import { useState } from 'react'
import { Btn, Card, Field, Input, Segmented, toast } from '../ui'
import { useAuth, createHousehold, joinHousehold, signOut } from '../data/auth'

type Mode = 'create' | 'join'

/** Показується, коли людина ввійшла, але дому ще немає. */
export default function Onboarding() {
  const auth = useAuth()
  const [mode, setMode] = useState<Mode>('create')
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const me = auth.status === 'in' ? auth.name : undefined

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true); setErr(null)
    try { await fn(); toast(ok) }
    catch (e) { setErr(e instanceof Error ? e.message : 'Щось пішло не так') }
    finally { setBusy(false) }
  }

  return (
    <div className="min-h-full grid place-items-center px-6 py-10">
      <div className="w-full max-w-[400px]">
        <div className="mb-6">
          <div className="text-[22px] font-semibold tracking-tight display">
            {me ? `Вітаємо, ${me}` : 'Майже готово'}
          </div>
          <p className="text-[13.5px] text-muted mt-1.5 leading-snug">
            Дім — це спільний простір на двох. Створіть свій або приєднайтесь
            за кодом, який дав партнер.
          </p>
        </div>

        <Card>
          <Segmented
            value={mode}
            onChange={setMode}
            items={[
              { value: 'create', label: 'Створити дім' },
              { value: 'join', label: 'Маю код' },
            ]}
            full
          />

          <div className="mt-4">
            {mode === 'create' ? (
              <>
                <Field label="Назва" hint="Побачите тільки ви двоє. Можна змінити пізніше.">
                  <Input value={name} onChange={setName} placeholder="Наша сім'я"
                    onEnter={() => run(() => createHousehold(name), 'Дім створено')} />
                </Field>
                <Btn variant="primary" full disabled={busy}
                  onClick={() => run(() => createHousehold(name), 'Дім створено')}>
                  {busy ? 'Створюємо…' : 'Створити'}
                </Btn>
                <p className="text-[12px] text-faint mt-3 leading-snug">
                  Разом із домом зʼявляться стартові конверти — оренда, продукти,
                  транспорт і решта. Зайві приберете, свої додасте.
                </p>
              </>
            ) : (
              <>
                <Field label="Код запрошення" hint="Вісім символів. Живе 14 днів і спрацьовує один раз.">
                  <Input value={code} onChange={v => setCode(v.toUpperCase())}
                    placeholder="A1B2C3D4"
                    onEnter={() => run(() => joinHousehold(code), 'Ви в домі')} />
                </Field>
                <Btn variant="primary" full disabled={busy || code.trim().length < 4}
                  onClick={() => run(() => joinHousehold(code), 'Ви в домі')}>
                  {busy ? 'Перевіряємо…' : 'Приєднатись'}
                </Btn>
              </>
            )}
          </div>

          {err && <p className="text-[12.5px] text-warn mt-3 leading-snug">{err}</p>}
        </Card>

        <button onClick={() => void signOut()}
          className="mt-5 w-full text-[12.5px] text-faint hover:text-muted">
          Вийти
        </button>
      </div>
    </div>
  )
}
