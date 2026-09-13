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
| `Links.tsx` | `LinkGroup`, `LinkRow`, `LinkChip`, `AttachButton` |
| `useSheet.ts` | `useSheet` |
| `Sheet.tsx` | `Sheet` |
| `Button.tsx` | `Btn`, `IconButton`, `ConfirmButton`, `FormActions` |
| `Tabs.tsx` | `Tabs`, `Segmented` |
| `Layout.tsx` | `Empty`, `SectionTitle`, `Card`, `ListRow`, `Stat` |
| `Badge.tsx` | `Badge`, `Pill` |
| `Form.tsx` | `Field`, `Input`, `Textarea`, `Select`, `MoneyInput`, `DateInput`, `Switch`, `fieldClass` |
| `Optional.tsx` | `OptionalFields` |
| `Menu.tsx` | `PropertyMenu`, `MenuOption` |

---

## Основа

### `Icon`
Мапа `Icon.plus(size?) → JSX`. Розмір за замовчуванням 20.
Набір: `home check list wallet cart piggy plus x chev more sun moon image gear bell pin calendar clock trash pencil`.
Іконка сама по собі `aria-hidden` — підпис дає кнопка навколо неї.

### `Avatar`
`{ member?: Member; size?: number }` — без `member` показує пунктирне «?» (вільна задача).

### `PriorityMark` / `priorityLabel`
`{ p: Priority; size?: number }`. `priorityLabel(p) → string`.
`p === 0` — «Без пріоритету», сірі стовпчики; сортується останнім (інваріант 8).

### `Progress`
`{ value: number /* 0..1 */; pending?: number /* 0..1 */; tone?: 'accent' | 'warn' | 'neutral'; height?: number }`.
Перевищення плану — `tone="warn"`, не червоне.
`pending` — частка, яка вже розписана, але ще не сталася (автоматичні платежі
місяця): малюється штрихованим сегментом одразу за фактом. Суцільний колір там
читався б як «уже виконано».

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

### `PropertyMenu<T extends string | number>`
`{ label: string; value: T; options: { value: T; label: string; icon?: ReactNode }[]; onChange: (v: T) => void; placeholder?: ReactNode }`.
Одна властивість — один компактний чип, як у Linear: статус, пріоритет, виконавець
рядком під назвою замість трьох блоків пілюль. Тап відкриває меню з галочкою біля
поточного. Меню рендериться порталом із `position: fixed` — інакше `overflow` листа
його обрізає. Закривається вибором, кліком поза ним, Escape (лист лишається відкритим),
скролом. Стрілки, Home/End, Enter.

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
`{ label: string; children; hint?: string; error?: string; htmlFor?: string; onRemove?: () => void }`.
Підпис + контрол + підказка. Коли є `error`, він замінює `hint` і показується
**бурштиновим** — червоне лишаємо руйнівним діям.
`onRemove` домальовує хрестик біля підпису — для необовʼязкових полів,
які згортаються назад у кнопку (див. `OptionalFields`).

### `OptionalFields`
`{ items: OptionalItem[]; label?: string /* 'Додати' */ }`, де
`OptionalItem = { key; label; filled: boolean; clear?: () => void; render: (remove?) => ReactNode }`.

**Порожнє необовʼязкове поле — це не поле, а кнопка «додати».** Форма, де всі
можливості розкладені порожніми інпутами, читається як список обовʼязків:
видно десять полів і незрозуміло, які з них твої.

Поле показується, якщо `filled` або якщо його щойно додали; порожнє згортається
назад. `render` отримує дію «прибрати» і віддає її в `Field onRemove`.
Обовʼязкові поля сюди не кладемо — назва, сума, конверт видимі завжди.

```tsx
<OptionalFields items={[
  { key: 'notes', label: 'Нотатка', filled: !!d.notes, clear: () => set('notes', ''),
    render: remove => (
      <Field label="Нотатка" onRemove={remove}>
        <Textarea value={d.notes} onChange={v => set('notes', v)} />
      </Field>
    ) },
]} />
```

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


---

## Звʼязки

Родина сутностей у застосунку звʼязана: конверт приймає, фонд і правило кладуть,
борг гаситься правилом. **Якщо звʼязок існує, він має бути видимий з обох боків
і з обох боків клікабельний.** Список, який лише називає фонд, змушує шукати той
фонд руками — це розрив, заради якого ці компоненти й зроблені.

Самі звʼязки рахує `src/data/links.ts` (`envelopeSources`, `fundLinks`,
`debtLinks`), нічого не зберігаючи — інваріант 4.

### `LinkGroup`
`{ title: string; summary?: ReactNode; hint?: ReactNode; children?; actions?: ReactNode }`.
Блок звʼязків усередині листа: капслок-заголовок, підсумок праворуч
(«цього місяця 25 000 ₴»), рядки, пояснення і дії внизу.

### `LinkRow`
`{ link: Link; onOpen?: () => void; right?: ReactNode }`.
Рядок звʼязку: іконка, назва, підпис («5 числа щомісяця»), сума, шеврон.
`Link` приходить із `data/links.ts` і вже несе маршрут `to`.
Іконки розрізняють вид: `piggy` фонд, `clock` правило, `wallet` конверт, `list` борг.

### `LinkChip`
`{ icon?: LinkIcon; children; onClick: () => void; tone?: 'neutral' | 'accent' }`.
Інлайнова згадка іншої сутності в рядку списку. Зупиняє спливання кліку, тож
працює всередині клікабельного рядка. `accent` — коли звʼязок щось робить сам
(«гаситься само», «внесок у фонд»).

### `AttachButton`
`{ onClick: () => void; children; icon?: 'plus' | 'pencil' }`.
Пунктирна кнопка «привʼязати ще» — виглядає як місце, куди щось стане.
`icon="pencil"` для зміни наявного звʼязку: плюс там читався б як «додати другий».

### `useSheet`
`useSheet(key) → [value, set, patch]` над `useSearchParams`.
Відкритий лист живе в адресі: `?env=<id>`, `?fund=new`, `?tab=bills&rule=<id>`.
Через це на сутність можна послатися з будь-якого екрана, а «назад» на телефоні
закриває лист, а не весь екран. `set(v, also?)` дає прибрати супутні параметри
(підказки, з яких лист відкрився).
