import { useSyncExternalStore } from 'react'
import { supabase, isCloudConfigured, cloud } from './supabase'

/**
 * Вхід і належність до дому.
 *
 * Патерн той самий, що в store.ts: модульний стан + useSyncExternalStore,
 * без контексту. Так само, як toast() — щоб викликалось звідусіль.
 *
 * `offline` — ключів немає. Застосунок працює на локальних даних, як і
 * працював. Це режим офлайнової однофайлової збірки, і це НЕ помилка.
 */
export type Auth =
  | { status: 'offline' }
  | { status: 'loading' }
  | { status: 'anon' }
  | { status: 'in'; userId: string; email?: string; name?: string; avatar?: string }

export interface Household { id: string; name: string }

/** undefined — ще не зʼясовували; null — зʼясували, дому немає. */
type HouseholdState = Household | null | undefined

let auth: Auth = isCloudConfigured ? { status: 'loading' } : { status: 'offline' }
let household: HouseholdState = isCloudConfigured ? undefined : null

const listeners = new Set<() => void>()
const emit = () => listeners.forEach(l => l())
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }

export function useAuth(): Auth {
  return useSyncExternalStore(subscribe, () => auth, () => auth)
}
export function useHousehold(): HouseholdState {
  return useSyncExternalStore(subscribe, () => household, () => household)
}

/* ───────────────────────── сесія ───────────────────────── */

if (supabase) {
  supabase.auth.getSession().then(({ data }) => applySession(data.session))
  supabase.auth.onAuthStateChange((_e, session) => applySession(session))
}

function applySession(session: import('@supabase/supabase-js').Session | null) {
  if (!session?.user) {
    auth = { status: 'anon' }
    household = null
    emit()
    return
  }
  const u = session.user
  auth = {
    status: 'in',
    userId: u.id,
    email: u.email ?? undefined,
    // Google кладе імʼя і аватар у метадані; якщо їх немає — беремо пошту
    name: (u.user_metadata?.full_name as string) || (u.user_metadata?.name as string) || u.email || undefined,
    avatar: (u.user_metadata?.avatar_url as string) || undefined,
  }
  emit()
  void loadHousehold()
}

async function loadHousehold() {
  const db = cloud()
  // members → households одним запитом; RLS сам обмежить своїм домом
  const { data, error } = await db
    .from('household_members')
    .select('household_id, households(id, name)')
    .limit(1)
    .maybeSingle()

  if (error) { household = null; emit(); return }
  const h = data?.households as unknown as Household | undefined
  household = h ? { id: h.id, name: h.name } : null
  emit()
}

/* ───────────────────────── дії ───────────────────────── */

export function signInWithGoogle() {
  return cloud().auth.signInWithOAuth({
    provider: 'google',
    // повертаємось туди ж, звідки пішли — HashRouter тримає маршрут у #
    options: { redirectTo: window.location.origin + window.location.pathname },
  })
}

export async function signOut() {
  await cloud().auth.signOut()
}

/**
 * Створити дім. Однією операцією на боці бази — і це не оптимізація.
 *
 * households_select каже: бачиш дім, якщо ти його учасник. Поки членство
 * не створене, щойно вставлений дім тобі невидимий, і insert().select()
 * повертає 403. Те саме зі стартовими конвертами. Тому дім, членство
 * й конверти створює одна security definer функція, в одній транзакції.
 */
export async function createHousehold(name: string): Promise<Household> {
  const db = cloud()
  const { error } = await db.rpc('create_household', { p_name: name.trim() })
  if (error) throw new Error(error.message)
  await loadHousehold()
  if (!household) throw new Error('Дім створено, але не вдалось його прочитати')
  return household
}

/** Приєднатись за кодом. Уся перевірка — всередині RPC, бо RLS ховає запрошення. */
export async function joinHousehold(code: string): Promise<void> {
  const { error } = await cloud().rpc('accept_invite', { p_code: code.trim() })
  if (error) throw new Error(error.message)
  await loadHousehold()
}

/** Код для партнера. Живе 14 днів, одноразовий. */
export async function createInvite(): Promise<string> {
  const { data, error } = await cloud().rpc('create_invite')
  if (error) throw new Error(error.message)
  return data as string
}
