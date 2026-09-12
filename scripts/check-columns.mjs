/**
 * Звіряє колонки в src/data/cloud-map.ts зі схемою sql/01_schema.sql.
 *
 * Цей клас помилок типи не ловлять: невірна назва колонки компілюється
 * бездоганно і падає аж у бою, як `column recurring_plans.by_month_day
 * does not exist`. Схема іменує частину полів за стандартом iCalendar —
 * bymonthday, byday, bymonth, без підкреслень, — і сплутати їх дуже легко.
 */
import { readFileSync } from 'node:fs'

const schema = readFileSync('sql/01_schema.sql', 'utf8')
const map = readFileSync('src/data/cloud-map.ts', 'utf8')

const real = new Map()
for (const m of schema.matchAll(/create table (\w+) \(\n(.*?)\n\);/gs)) {
  const cols = new Set()
  for (const line of m[2].split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('--')) continue
    if (/^(unique|primary|foreign|check|constraint)\b/i.test(t)) continue
    const c = /^([a-z_][a-z0-9_]*)\s+\S/.exec(t)
    if (c) cols.add(c[1])
  }
  real.set(m[1], cols)
}

let bad = 0
for (const m of map.matchAll(/table: '(\w+)',\s*\n\s*columns: '([^']+)'/g)) {
  const [, table, cols] = m
  const have = real.get(table)
  if (!have) { console.error(`✗ ${table}: такої таблиці немає в схемі`); bad++; continue }
  const missing = cols.split(',').map(c => c.trim()).filter(c => !have.has(c))
  if (missing.length) {
    console.error(`✗ ${table}: немає колонок ${missing.join(', ')}`)
    console.error(`  у схемі є: ${[...have].sort().join(', ')}`)
    bad++
  }
}

if (bad) {
  console.error(`\nМапування розійшлося зі схемою у ${bad} табл. Збірку зупинено.`)
  process.exit(1)
}
console.log('cloud-map ↔ схема: збігається')
