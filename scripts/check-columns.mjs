/**
 * Звіряє колонки в src/data/cloud-map.ts зі схемою sql/01_schema.sql.
 *
 * Цей клас помилок типи не ловлять: невірна назва колонки компілюється
 * бездоганно і падає аж у бою, як `column recurring_plans.by_month_day
 * does not exist`. Схема іменує частину полів за стандартом iCalendar —
 * bymonthday, byday, bymonth, без підкреслень, — і сплутати їх дуже легко.
 */
import { readFileSync, readdirSync } from 'node:fs'

// Усі міграції, не лише перша: колонки додаються й пізніше.
const files = readdirSync('sql').filter(f => f.endsWith('.sql')).sort()
const schema = files.map(f => readFileSync(`sql/${f}`, 'utf8')).join('\n')
const map = readFileSync('src/data/cloud-map.ts', 'utf8')

const real = new Map()
for (const m of schema.matchAll(/create table (?:if not exists )?(?:public\.)?(\w+) \(\n(.*?)\n\);/gs)) {
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

// alter table X add column [if not exists] Y ...
for (const m of schema.matchAll(/alter table (?:public\.)?(\w+)\s+add column\s+(?:if not exists\s+)?(\w+)/gi)) {
  const [, table, col] = m
  if (!real.has(table)) real.set(table, new Set())
  real.get(table).add(col)
}

// Колонки, які додаються в циклі DO $$ ... foreach по масиву таблиць
for (const block of schema.matchAll(/tables text\[\] := array\[(.*?)\];(.*?)end \$\$;/gs)) {
  const tables = [...block[1].matchAll(/'(\w+)'/g)].map(x => x[1])
  const cols = [...block[2].matchAll(/add column if not exists (\w+)/g)].map(x => x[1])
  for (const t of tables) {
    if (!real.has(t)) real.set(t, new Set())
    for (const c of cols) real.get(t).add(c)
  }
}

let bad = 0
// Кожна сутність у cloud-map ОБОВʼЯЗКОВО має пару table + columns одна за одною.
// Якщо між ними опинився коментар, регулярка її не побачить — і перевірка
// мовчки пропустить таблицю. Тому окремо рахуємо, що звірено все.
const declared = [...map.matchAll(/table: '(\w+)'/g)].length
let checked = 0
for (const m of map.matchAll(/table: '(\w+)',\s*\n\s*columns: '([^']+)'/g)) {
  checked++
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

if (checked !== declared) {
  console.error(`✗ звірено ${checked} з ${declared} таблиць: між table і columns щось стоїть`)
  bad++
}

if (bad) {
  console.error(`\nМапування розійшлося зі схемою у ${bad} табл. Збірку зупинено.`)
  process.exit(1)
}
console.log('cloud-map ↔ схема: збігається')
