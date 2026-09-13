# Family Flow

Сімейний застосунок на двох: задачі в стилі Linear, конверти й чекліст платежів,
фонди на нерегулярне, борги, спільний список покупок. Інтерфейс українською.

## Запустити

```bash
npm install
npm run dev      # http://localhost:5173, з телефона — адреса Network із виводу
```

Без змінних Supabase застосунок працює локально на демо-даних у `localStorage`
(ключ `familyflow.v1`), без входу. З ними — вхід через Google, спільний дім,
синхронізація між пристроями.

## Зібрати

```bash
npm run build                          # звіряє схему, типи src і api/, збирає dist/
npm run build && node build-single.mjs # + dist/family-flow.html одним файлом
```

## Розгортання

Vercel: фронтенд із `dist/`, функції з `api/`, cron із `vercel.json`.
База: Supabase, міграції з `sql/` по порядку (01, 02, 06–13).

Змінні середовища — лише у Vercel (Settings → Environment Variables):

| Змінна | Звідки | Куди потрапляє |
|---|---|---|
| `VITE_SUPABASE_URL` | Supabase → Project Settings → Data API (корінь, без `/rest/v1`) | бандл і функції |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Supabase → API keys → publishable | бандл (публічний, захищає RLS) |
| `VITE_VAPID_PUBLIC_KEY` | пара VAPID | бандл |
| `VAPID_PRIVATE_KEY` | пара VAPID | лише функції |
| `VAPID_SUBJECT` | `mailto:ваша@пошта` | лише функції |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → API keys → secret | лише функції |
| `CRON_SECRET` | будь-який довгий випадковий рядок | лише функції |

Пару VAPID дає `npx web-push generate-vapid-keys`.

## Де що лежить

Структура, інваріанти й правила інтерфейсу — у [`CLAUDE.md`](CLAUDE.md).
Дизайн-система — у [`src/ui/README.md`](src/ui/README.md).
