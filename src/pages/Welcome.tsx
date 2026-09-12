import { useState } from 'react'
import { Btn, Card, Icon } from '../ui'
import { signInWithGoogle } from '../data/auth'

/** Екран входу. Показується, поки не ввійшли і ключі налаштовані. */
export default function Welcome() {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const go = async () => {
    setBusy(true); setErr(null)
    try { await signInWithGoogle() }
    catch (e) { setErr(e instanceof Error ? e.message : 'Не вдалось увійти'); setBusy(false) }
  }

  return (
    <div className="min-h-full grid place-items-center px-6 py-10">
      <div className="w-full max-w-[380px]">
        <div className="text-center mb-7">
          <div className="text-[26px] font-semibold tracking-tight display">Family Flow</div>
          <p className="text-[14px] text-muted mt-2 leading-snug">
            Спільні задачі й домашні гроші на двох. Обидва бачать і редагують усе.
          </p>
        </div>

        <Card>
          <Btn variant="primary" full onClick={go} disabled={busy}>
            {busy ? 'Відкриваємо Google…' : 'Увійти через Google'}
          </Btn>
          {err && <p className="text-[12.5px] text-warn mt-3 leading-snug">{err}</p>}
          <p className="text-[12px] text-faint mt-3 leading-snug">
            Паролів немає — тому й красти нема чого. Доступ до ваших даних
            дають тільки політики на стороні бази.
          </p>
        </Card>

        <ul className="mt-6 space-y-2.5 text-[13px] text-muted">
          {[
            [Icon.check, 'Задачі, які самі повертаються після виконання'],
            [Icon.wallet, 'Платежі підтверджуються в один тап'],
            [Icon.piggy, 'Фонди рахують, скільки відкласти цього місяця'],
          ].map(([ico, text], i) => (
            <li key={i} className="flex items-start gap-2.5">
              <span className="text-faint shrink-0 mt-0.5">{(ico as (s?: number) => React.ReactNode)(16)}</span>
              <span>{text as string}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
