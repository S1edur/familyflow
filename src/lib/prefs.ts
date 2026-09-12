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
