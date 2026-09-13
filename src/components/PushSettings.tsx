import { useState } from 'react'
import { Btn, toast } from '../ui'
import { disablePush, enablePush, sendTestPush, usePushState } from '../data/push'

/**
 * Сповіщення на ЦЬОМУ пристрої. Підписка належить браузеру, не акаунту:
 * увімкнули на телефоні — на ноутбуці вони самі не зʼявляться.
 */
export function PushSettings() {
  const [state, refresh] = usePushState()
  const [busy, setBusy] = useState(false)

  // локальний режим або сервер не налаштований — нема про що говорити
  if (state === null || state === 'unavailable') return null

  const run = async (fn: () => Promise<void>, ok?: string) => {
    setBusy(true)
    try { await fn(); if (ok) toast(ok) }
    catch (e) { toast(e instanceof Error ? e.message : 'Не вдалося', { tone: 'warn' }) }
    finally { setBusy(false); refresh() }
  }

  return (
    <div className="rounded-xl border border-line bg-surface2/40 p-3">
      <div className="text-[14px] font-medium">Сповіщення на цьому пристрої</div>

      {state === 'needs-install' && (
        <p className="text-[12.5px] text-muted mt-1 leading-snug">
          На iPhone сповіщення приходять лише від застосунку на екрані «Додому».
          У Safari: «Поділитися» → «На початковий екран», потім відкрийте
          Family Flow звідти й увімкніть тут.
        </p>
      )}

      {state === 'unsupported' && (
        <p className="text-[12.5px] text-muted mt-1 leading-snug">
          Цей браузер не вміє вебсповіщень. Спробуйте Chrome, Edge або Safari.
        </p>
      )}

      {state === 'denied' && (
        <p className="text-[12.5px] text-muted mt-1 leading-snug">
          Сповіщення заборонені для цього сайту. Дозволити можна в налаштуваннях
          браузера або телефона — застосунок сам запитати вдруге не може.
        </p>
      )}

      {state === 'off' && (
        <>
          <p className="text-[12.5px] text-muted mt-1 leading-snug">
            Зранку — що чекає сьогодні. Одразу — коли вам призначили задачу.
            Лише ваші справи й нічиї, про чуже не пишемо.
          </p>
          <div className="mt-2">
            <Btn variant="primary" disabled={busy}
              onClick={() => run(async () => { await enablePush(); await sendTestPush() }, 'Сповіщення увімкнено')}>
              {busy ? 'Вмикаємо…' : 'Увімкнути'}
            </Btn>
          </div>
        </>
      )}

      {state === 'on' && (
        <>
          <p className="text-[12.5px] text-muted mt-1 leading-snug">
            Увімкнено. Зранку — що чекає сьогодні, одразу — призначені вам задачі.
          </p>
          <div className="mt-2 flex gap-1.5">
            <Btn disabled={busy} onClick={() => run(sendTestPush, 'Надіслали — має прийти за кілька секунд')}>
              Надіслати тест
            </Btn>
            <Btn variant="quiet" disabled={busy} onClick={() => run(disablePush, 'Сповіщення вимкнено')}>
              Вимкнути
            </Btn>
          </div>
        </>
      )}
    </div>
  )
}
