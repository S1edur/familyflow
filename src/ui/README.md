# `src/ui` — дизайн-система

Один файл на групу компонентів, усе назовні через барель:

```ts
import { Card, Field, MoneyInput, FormActions } from '../ui'
```

`src/components/ui.tsx` лишився як тонкий реекспорт (`export * from '../ui'`),
щоб наявні сторінки не ламались. Нові екрани імпортують з `../ui`.

## Правила

- Кольори — тільки змінні з `src/index.css` (`text-warn`, `bg-surface2`,
  `var(--c-accent)`). Жодного hex у компонентах.
- **Перевищення і прострочення — бурштинові** (`warn`). Червоне (`stop`) —
  лише руйнівні дії.
- Числа — клас `num`, символ валюти після числа.
- Гроші — ціле число копійок + валюта. Ніяких float, форматування на виході.
- Видимий текст — українською; aria-label на кнопках-іконках обов'язковий.

## Файли

| Файл | Що всередині |
|---|---|
| `Icon.tsx` | `Icon` |
| `Avatar.tsx` | `Avatar` |
| `Priority.tsx` | `PriorityMark`, `priorityLabel` |
| `Progress.tsx` | `Progress` |
| `Sheet.tsx` | `Sheet` |
| `Button.tsx` | `Btn`, `IconButton`, `ConfirmButton`, `FormActions` |
| `Tabs.tsx` | `Tabs`, `Segmented` |
| `Layout.tsx` | `Empty`, `SectionTitle`, `Card`, `ListRow`, `Stat` |
| `Badge.tsx` | `Badge`, `Pill` |
| `Form.tsx` | `Field`, `Input`, `Textarea`, `Select`, `MoneyInput`, `DateInput`, `Switch`, `fieldClass` |

---

## Основа

### `Icon`
Мапа `Icon.plus(size?) → JSX`. Розмір за замовчуванням 20.
Набір: `home check list wallet cart piggy plus x chev more sun moon image gear clock trash pencil`.
Іконка сама по собі `aria-hidden` — підпис дає кнопка навколо неї.

### `Avatar`
`{ member?: Member; size?: number }` — без `member` показує пунктирне «?» (вільна задача).

### `PriorityMark` / `priorityLabel`
`{ p: Priority; size?: number }`. `priorityLabel(p) → string`.
`p === 0` — «Без пріоритету», сірі стовпчики; сортується останнім (інваріант 8).

### `Progress`
`{ value: number /* 0..1 */; tone?: 'accent' | 'warn' | 'neutral'; height?: number }`.
Перевищення плану — `tone="warn"`, не червоне.

### `Sheet`
`{ open: boolean; onClose: () => void; title?: string; children }`.
Нижній лист на телефоні, діалог по центру на десктопі. Esc і клік по підкладці закривають,
скрол сторінки блокується. Використовувати для редагування однієї сутності.

---

## Дії

### `Btn`
`{ children; onClick?; variant?: 'primary' | 'ghost' | 'quiet' | 'danger'; full?; disabled?; type? }`.
`primary` — одна на екран. `danger` — єдине червоне місце.

### `IconButton`
`{ children; label: string; onClick?; size?: number /* 32 */; tone?: 'quiet' | 'ghost' | 'accent' | 'danger'; disabled? }`.
`label` йде в `aria-label` і `title` — не опускати.

### `ConfirmButton`
`{ children; confirmLabel?: string /* 'Точно?' */; onConfirm: () => void; full?; disabled?; variant?: 'danger' | 'quiet' }`.
Видалення у два тапи без `window.confirm`: перший тап озброює, другий виконує,
через 4 с або при втраті фокуса роззброюється.

### `FormActions`
`{ onSubmit?; onCancel?; submitLabel? /* 'Зберегти' */; cancelLabel? /* 'Скасувати' */; disabled?; destructive?: ReactNode }`.
Ряд кнопок унизу форми. `destructive` (зазвичай `ConfirmButton`) притискається ліворуч.

---

## Навігація і вибір

### `Tabs<T extends string>`
`{ value: T; onChange: (v: T) => void; items: { value: T; label: string; badge?: number }[] }`.
Вкладки екрана. `badge` показується тільки коли > 0.

### `Segmented<T extends string>`
`{ value; onChange; items: { value: T; label: string }[]; full?; label? }`.
2–4 взаємовиключні варіанти **всередині форми** (тип конверта, періодичність).
Для вкладок екрана беремо `Tabs`.

### `Pill`
`{ active?; onClick: () => void; children; disabled?; title? }`.
Один тап замість форми: статус, пріоритет, виконавець. Проставляє `aria-pressed`.

### `Badge`
`{ children; tone?: 'neutral' | 'accent' | 'warn' | 'stop' }`.
Статична мітка, не клікається. Прострочено / перевитрата — `warn`.

---

## Каркас

### `Card`
`{ children; className?; padded? /* true */ }` — `rounded-xl border border-line bg-surface p-4`.

### `ListRow`
`{ children; as?: 'li' | 'div'; onClick?; className? }` — рядок сталої висоти 44
з полями екрана (`px-4 sm:px-6`). За замовчуванням `li`, всередині `ul`.

### `SectionTitle`
`{ children; right?: ReactNode }` — дрібний капслок-заголовок секції з дією праворуч.

### `Empty`
`{ children }` — порожній стан. Пояснити, що тут буде, і дати одну дію.

### `Stat`
`{ label: string; value: ReactNode; tone?: 'default' | 'warn' | 'muted' }`.
`dt`/`dd`, число з `num`. Загортати в `<dl>`.

---

## Форми

Усі контроли мають однаковий вигляд через `fieldClass`
(висота 40, `rounded-lg border border-line bg-surface`, фокус — `accent`).

### `Field`
`{ label: string; children; hint?: string; error?: string; htmlFor?: string }`.
Підпис + контрол + підказка. Коли є `error`, він замінює `hint` і показується
**бурштиновим** — червоне лишаємо руйнівним діям.

### `Input`
`{ value: string; onChange: (v: string) => void; placeholder?; id?; type?: 'text'|'search'|'url'|'tel'; disabled?; autoFocus?; inputMode?; onEnter?; align?: 'left'|'right' }`.
`align="right"` вмикає `num` — для нечислових полів не потрібен.

### `Textarea`
`{ value; onChange; placeholder?; id?; rows? /* 3 */; disabled? }`.

### `Select<T extends string>`
`{ value: T | ''; onChange: (v: T) => void; options: { value: T; label: string }[]; id?; disabled?; placeholder? }`.
Нативний `<select>` — на телефоні це рідний пікер. `placeholder` додає порожній
варіант зі значенням `''`.

### `MoneyInput`
`{ valueMinor: number; onChange: (minor: number) => void; currency?: Currency /* 'UAH' */; id?; placeholder?; disabled?; autoFocus?; size?: 'md' | 'lg' }`.

**Працює в копійках.** Приймає ціле, віддає ціле — `parseAmount` перетворює ввід,
`money` форматує показ, і тільки коли поле поза фокусом. Поки поле в фокусі,
видно рядок як його набирають; у стані завжди копійки. Порожнє поле → `onChange(0)`.
Символ валюти — праворуч від числа, число з `num`.
`size="lg"` — велика сума у швидкому записі.

### `DateInput`
`{ value?: string; onChange: (iso: string | undefined) => void; id?; disabled?; min?; max? }`.
Значення ISO `YYYY-MM-DD` (як `iso()` з `lib/dates`). Очищене поле → `undefined`.

### `Switch`
`{ checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string; disabled? }`.
Булеві поля: `active` регулярного платежу, `archived` конверта.
`role="switch"` + `aria-checked`; підпис — частина кнопки, окремий `Field` не потрібен.
