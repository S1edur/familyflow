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

/** Створити дім і покласти себе першим учасником. */
export async function createHousehold(name: string): Promise<Household> {
  const db = cloud()
  const { data: h, error } = await db
    .from('households')
    .insert({ name: name.trim() || 'Наша сім\'я' })
    .select('id, name')
    .single()
  if (error) throw error

  const { data: { user } } = await db.auth.getUser()
  if (!user) throw new Error('Немає сесії')

  const { error: mErr } = await db
    .from('household_members')
    .insert({ household_id: h.id, profile_id: user.id })
  if (mErr) throw mErr

  await seedEnvelopes(h.id)
  household = { id: h.id, name: h.name }
  emit()
  return household
}

/**
 * Стартові конверти. Це вміст sql/05_seed.sql, який не можна було виконати
 * руками: там заглушка '<household>' замість справжнього ідентифікатора,
 * бо дім створюється тільки тут.
 */
const STARTER: Array<[string, string, number]> = [
  ['Дохід', 'income', 0],
  ['Оренда / іпотека', 'fixed', 10],
  ['Комуналка', 'fixed', 20],
  ['Інтернет і звʼязок', 'fixed', 30],
  ['Підписки', 'fixed', 40],
  ['Продукти', 'variable', 50],
  ['Транспорт / паливо', 'variable', 60],
  ['Побут і дім', 'variable', 70],
  ['Здоровʼя', 'variable', 80],
  ['Розваги', 'variable', 90],
  ['Нерегулярне', 'sinking', 100],
  ['Накопичення', 'savings', 110],
  ['Борги', 'debt', 120],
]

async function seedEnvelopes(householdId: string) {
  const { error } = await cloud().from('envelopes').insert(
    STARTER.map(([name, kind, sort_order]) => ({ household_id: householdId, name, kind, sort_order })),
  )
  if (error) throw error
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
