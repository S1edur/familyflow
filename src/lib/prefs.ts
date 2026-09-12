/**
 * Налаштування ПЕРЕГЛЯДУ, не дані домогосподарства.
 * Живуть у localStorage поруч із ff.theme і свідомо не йдуть у спільну модель:
 * закріплений рядок — це вигляд у конкретного учасника, тут нічого не ховається.
 */
const PIN_SHOPPING = 'ff.pinShopping'

export function readPinShopping(): boolean {
  try { return localStorage.getItem(PIN_SHOPPING) !== '0' } catch { return true }
}

export function writePinShopping(on: boolean) {
  try { localStorage.setItem(PIN_SHOPPING, on ? '1' : '0') } catch { /* приватний режим */ }
}

const SEEN_AT = 'ff.seenAt'

/** Коли востаннє відкривали повідомлення. Перегляд, не дані сімʼї. */
export function readSeenAt(): string {
  try { return localStorage.getItem(SEEN_AT) ?? new Date(Date.now() - 7 * 864e5).toISOString() }
  catch { return new Date(Date.now() - 7 * 864e5).toISOString() }
}

export function writeSeenAt(iso = new Date().toISOString()) {
  try { localStorage.setItem(SEEN_AT, iso) } catch { /* приватний режим */ }
}
