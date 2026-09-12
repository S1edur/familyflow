import { useState } from 'react'
import { Btn, Card, Icon, SectionTitle, toast } from '../ui'
import { useAuth, useHousehold, createInvite, signOut } from '../data/auth'

/**
 * Акаунт і запрошення. Свідомо окремо від «Сімʼя і валюти»: там локальні
 * учасники застосунку, а тут — хто ввійшов і до якого дому належить.
 * Поки дані ще не переїхали в базу, плутати ці дві речі не варто.
 */
export function AccountCard() {
  const auth = useAuth()
  const household = useHousehold()
  const [code, setCode] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (auth.status !== 'in' || !household) return null

  const invite = async () => {
    setBusy(true)
    try {
      setCode(await createInvite())
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Не вдалось створити код', { tone: 'warn' })
    } finally {
      setBusy(false)
    }
  }

  const copy = async () => {
    if (!code) return
    try {
      await navigator.clipboard.writeText(code)
      toast('Код скопійовано')
    } catch {
      toast('Скопіюйте код вручну', { tone: 'warn' })
    }
  }

  return (
    <>
      <SectionTitle>Акаунт</SectionTitle>
      <div className="px-4 sm:px-6">
        <Card>
          <div className="flex items-center gap-3">
            {auth.avatar
              ? <img src={auth.avatar} alt="" className="w-10 h-10 rounded-full" />
              : <span className="w-10 h-10 rounded-full bg-surface2 grid place-items-center text-faint">
                  {Icon.home(18)}
                </span>}
            <div className="min-w-0 flex-1">
              <div className="text-[14px] truncate">{auth.name ?? auth.email}</div>
              <div className="text-[12.5px] text-faint truncate">Дім «{household.name}»</div>
            </div>
          </div>

          <div className="mt-4 pt-4 border-t border-line">
            {code ? (
              <>
                <div className="text-[11.5px] uppercase tracking-wider text-faint mb-1.5">
                  Код для партнера
                </div>
                <button onClick={copy}
                  className="w-full text-center text-[26px] font-semibold num tracking-[0.12em] py-3 rounded-lg bg-accentSoft text-accentInk">
                  {code}
                </button>
                <p className="text-[12.5px] text-faint mt-2 leading-snug">
                  Тапніть, щоб скопіювати. Діє 14 днів і спрацьовує один раз —
                  після того, як партнер увійде, код згорить.
                </p>
                <div className="mt-3">
                  <Btn full onClick={invite} disabled={busy}>Інший код</Btn>
                </div>
              </>
            ) : (
              <>
                <Btn variant="primary" full onClick={invite} disabled={busy}>
                  {busy ? 'Створюємо…' : 'Запросити партнера'}
                </Btn>
                <p className="text-[12.5px] text-faint mt-2 leading-snug">
                  Отримаєте код із восьми символів. Партнер входить через Google
                  і вводить його — і ви в одному домі.
                </p>
              </>
            )}
          </div>
        </Card>

        <button onClick={() => void signOut()}
          className="mt-3 w-full text-[12.5px] text-faint hover:text-muted py-2">
          Вийти
        </button>
      </div>
    </>
  )
}
