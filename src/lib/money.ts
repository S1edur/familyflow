import type { Currency, Rates } from '../data/types'

export const SYMBOL: Record<Currency, string> = { UAH: '₴', USD: '$', EUR: '€' }

/** 25 000 ₴ — вузький нерозривний пробіл, копійки тільки коли ненульові */
export function money(minor: number, currency: Currency = 'UAH', opts: { sign?: boolean } = {}) {
  const neg = minor < 0
  const abs = Math.abs(minor)
  const whole = Math.floor(abs / 100)
  const cents = abs % 100
  const s = whole.toLocaleString('uk-UA').replace(/ /g, ' ')
  const tail = cents ? ',' + String(cents).padStart(2, '0') : ''
  const sign = neg ? '−' : opts.sign ? '+' : ''
  return `${sign}${s}${tail} ${SYMBOL[currency]}`
}

/** Компактно для великих чисел на дашборді: 1,2 млн */
export function moneyShort(minor: number, currency: Currency = 'UAH') {
  const whole = Math.abs(minor) / 100
  if (whole >= 1_000_000) return `${(whole / 1_000_000).toFixed(1).replace('.', ',')} млн ${SYMBOL[currency]}`
  return money(minor, currency)
}

export function rateFor(currency: Currency, rates: Rates): number {
  if (currency === 'UAH') return 1
  return rates[currency]
}

export function toBase(minor: number, currency: Currency, rates: Rates): number {
  return Math.round(minor * rateFor(currency, rates))
}

/** '25000' | '25 000,50' -> копійки */
export function parseAmount(raw: string): number | null {
  const cleaned = raw.replace(/[\s  ]/g, '').replace(',', '.')
  if (!cleaned || !/^\d*\.?\d*$/.test(cleaned)) return null
  const n = Number(cleaned)
  if (!isFinite(n) || n <= 0) return null
  return Math.round(n * 100)
}
