/**
 * Пуш-сповіщення на цьому пристрої.
 *
 * Браузер лише ПІДПИСУЄТЬСЯ: отримує від свого push-сервісу адресу й ключі
 * та кладе їх у push_subscriptions. Надсилає сервер (api/), бо для підпису
 * потрібен приватний VAPID-ключ, а він не може жити в бандлі.
 *
 * На iPhone вебпуші працюють тільки у ВСТАНОВЛЕНОМУ застосунку (iOS 16.4+,
 * «Поділитися → На початковий екран»). У вкладці Safari PushManager просто
 * відсутній — тому окремий стан `needs-install`, а не «не підтримується».
 */
import { useEffect, useState } from 'react'
import { supabase } from './supabase'

export type PushState =
  | 'unavailable'    // локальний режим або сервер ще не налаштований
  | 'needs-install'  // iPhone/iPad у вкладці Safari
  | 'unsupported'    // браузер не вміє
  | 'denied'         // людина заборонила — змінити можна лише в налаштуваннях
  | 'off'
  | 'on'

const VAPID = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined

const isIOS = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true

function registration() {
  return navigator.serviceWorker.register('/sw.js')
}

export async function pushState(): Promise<PushState> {
  if (!supabase || !VAPID) return 'unavailable'
  if (isIOS() && !isStandalone()) return 'needs-install'
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return 'unsupported'
  }
  if (Notification.permission === 'denied') return 'denied'
  const reg = await navigator.serviceWorker.getRegistration('/sw.js')
  const sub = await reg?.pushManager.getSubscription()
  return sub && Notification.permission === 'granted' ? 'on' : 'off'
}

/** VAPID-ключ приходить base64url-рядком, PushManager хоче байти. */
function keyBytes(b64: string) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4)
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, c => c.charCodeAt(0))
}

export async function enablePush(): Promise<void> {
  if (!supabase || !VAPID) throw new Error('Сповіщення ще не налаштовані на сервері')
  // Питати дозвіл можна лише у відповідь на тап — інакше Safari мовчки відмовить.
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('Без дозволу сповіщення не прийдуть')

  const reg = await registration()
  await navigator.serviceWorker.ready
  const sub = await reg.pushManager.getSubscription()
    ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID) })

  const json = sub.toJSON()
  const { error } = await supabase.rpc('save_push_subscription', {
    p_endpoint: sub.endpoint,
    p_p256dh: json.keys?.p256dh,
    p_auth: json.keys?.auth,
    p_user_agent: navigator.userAgent.slice(0, 200),
  })
  if (error) {
    await sub.unsubscribe()
    throw new Error(error.message)
  }
}

export async function disablePush(): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration('/sw.js')
  const sub = await reg?.pushManager.getSubscription()
  if (!sub) return
  if (supabase) await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
  await sub.unsubscribe()
}

/** Виклик серверної функції від імені поточного користувача. */
async function callApi(body: Record<string, unknown>) {
  if (!supabase) return
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) return
  const res = await fetch('/api/notify', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`)
}

export const sendTestPush = () => callApi({ kind: 'test' })

/**
 * «Вам призначили задачу» — партнерові, одразу.
 *
 * Шле клієнт, а не тригер у базі: так не треба налаштовувати вебхук у
 * Supabase. Сервер сам перевіряє, що обидва в одному домі, тож чужому
 * надіслати не вийде. Помилку ковтаємо: сповіщення — не частина запису.
 */
export function notifyAssigned(task: { id: string; title: string; assigneeId: string }) {
  if (!supabase || !VAPID) return
  void callApi({ kind: 'assigned', taskId: task.id, title: task.title, assigneeId: task.assigneeId })
    .catch(() => { /* не доставили — задача однаково є в застосунку */ })
}

/** Стан для інтерфейсу; `refresh` після ввімкнення/вимкнення. */
export function usePushState() {
  const [state, setState] = useState<PushState | null>(null)
  const refresh = () => { void pushState().then(setState).catch(() => setState('unsupported')) }
  useEffect(refresh, [])
  return [state, refresh] as const
}
