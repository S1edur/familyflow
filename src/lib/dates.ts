const MONTHS_GEN = ['січня','лютого','березня','квітня','травня','червня','липня','серпня','вересня','жовтня','листопада','грудня']
const MONTHS_NOM = ['Січень','Лютий','Березень','Квітень','Травень','Червень','Липень','Серпень','Вересень','Жовтень','Листопад','Грудень']
const MONTHS_SHORT = ['січ','лют','бер','кві','тра','чер','лип','сер','вер','жов','лис','гру']
const DOW_SHORT = ['нд','пн','вт','ср','чт','пт','сб']

// локальний календар, НЕ toISOString(): parse() будує локальну північ,
// а toISOString() перевів би її в попередню UTC-добу — addDays() губив би день
export const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
export const today = () => iso(new Date())
export const monthKey = (d: Date | string) =>
  (typeof d === 'string' ? d : iso(d)).slice(0, 7)
export const thisMonth = () => monthKey(new Date())

export function parse(d: string) { return new Date(d + 'T00:00:00') }

export function addMonths(mk: string, n: number) {
  const [y, m] = mk.split('-').map(Number)
  const d = new Date(y, m - 1 + n, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function monthTitle(mk: string) {
  const [y, m] = mk.split('-').map(Number)
  const now = new Date()
  const suffix = y === now.getFullYear() ? '' : ` ${y}`
  return MONTHS_NOM[m - 1] + suffix
}

/** '5 вер' */
export function shortDate(d: string) {
  const dt = parse(d)
  return `${dt.getDate()} ${MONTHS_SHORT[dt.getMonth()]}`
}

/** '5 вересня, пн' */
export function longDate(d: string) {
  const dt = parse(d)
  return `${dt.getDate()} ${MONTHS_GEN[dt.getMonth()]}, ${DOW_SHORT[dt.getDay()]}`
}

export function daysBetween(a: string, b: string) {
  return Math.round((parse(b).getTime() - parse(a).getTime()) / 86400000)
}

export function addDays(d: string, n: number) {
  const dt = parse(d)
  dt.setDate(dt.getDate() + n)
  return iso(dt)
}

/** Скільки місяців лишилось до дати, включно з поточним. Мінімум 1. */
export function monthsUntil(due: string | undefined, from = today()): number {
  if (!due) return 1
  const a = parse(from), b = parse(due)
  const n = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth()) + 1
  return Math.max(1, n)
}

export function relativeDue(d: string): { label: string; tone: 'over' | 'today' | 'soon' | 'later' } {
  const diff = daysBetween(today(), d)
  if (diff < 0) return { label: diff === -1 ? 'вчора' : `${-diff} дн. тому`, tone: 'over' }
  if (diff === 0) return { label: 'сьогодні', tone: 'today' }
  if (diff === 1) return { label: 'завтра', tone: 'soon' }
  if (diff <= 7) return { label: `через ${diff} дн.`, tone: 'soon' }
  return { label: shortDate(d), tone: 'later' }
}

/** ISO день тижня: 1=Пн .. 7=Нд */
export const isoDow = (d: string) => ((parse(d).getDay() + 6) % 7) + 1

export function clampDayOfMonth(year: number, month1: number, day: number) {
  const last = new Date(year, month1, 0).getDate()
  return Math.min(day, last)
}
