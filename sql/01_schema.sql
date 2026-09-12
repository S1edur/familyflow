-- ============================================================================
-- FAMILY HUB — схема БД (Supabase / PostgreSQL)
-- v1.0 · household = 2 дорослих · базова валюта UAH
--
-- ЯК ЗАСТОСУВАТИ: Supabase Dashboard → SQL Editor → New query → вставити
-- цей файл цілком → Run. НЕ просити Lovable створювати схему промптами.
-- Далі: 02_rls.sql, 03_functions.sql, 04_seed.sql
-- ============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- 1. ENUMS --
create type entry_kind        as enum ('expense','income','fund_in','fund_out','debt_payment','debt_adjustment');
create type envelope_kind     as enum ('fixed','variable','sinking','debt','savings','personal','income');
create type occurrence_status as enum ('projected','due','paid','skipped');
create type amount_mode       as enum ('fixed','variable');
create type fund_kind         as enum ('sinking','goal','emergency','buffer');
create type fund_payout       as enum ('refill','replenish','close');
create type task_status       as enum ('backlog','todo','doing','done','dropped');
create type schedule_kind     as enum ('one_off','fixed','after_completion');
create type rotation_mode     as enum ('none','fixed','round_robin','least_loaded');
create type freq_kind         as enum ('daily','weekly','monthly','yearly');

-- --------------------------------------------------- 2. ЛЮДИ ТА ДОМОГОСПОДАРСТВО --
create table profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  avatar_url   text,
  created_at   timestamptz not null default now()
);

create table households (
  id            uuid primary key default gen_random_uuid(),
  name          text not null default 'Наша сім''я',
  base_currency char(3) not null default 'UAH',
  timezone      text not null default 'Europe/Kyiv',
  created_at    timestamptz not null default now()
);

create table household_members (
  household_id uuid not null references households(id) on delete cascade,
  profile_id   uuid not null references profiles(id)   on delete cascade,
  role         text not null default 'member',      -- 'owner' | 'member' (обидва пишуть однаково)
  income_share numeric(5,4),                        -- опційно: частка доходу для "справедливої" частки
  color        text,
  joined_at    timestamptz not null default now(),
  primary key (household_id, profile_id)
);
create index on household_members (profile_id);

-- Запрошення другої людини (одноразовий код, без email-інфраструктури)
create table household_invites (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  code         text not null unique,
  created_by   uuid not null references profiles(id),
  expires_at   timestamptz not null default now() + interval '14 days',
  used_by      uuid references profiles(id),
  used_at      timestamptz
);

-- ------------------------------------------------------------ 3. ВАЛЮТИ --
-- Курси зберігаються з місячною гранулярністю (нам не треба щоденний пайплайн).
create table fx_rates (
  id         uuid primary key default gen_random_uuid(),
  base_ccy   char(3) not null,          -- 'USD'
  quote_ccy  char(3) not null,          -- 'UAH'  → 1 USD = rate UAH
  rate_date  date    not null,
  rate       numeric(20,10) not null check (rate > 0),
  source     text not null default 'manual',   -- 'manual' | 'nbu' | 'api'
  unique (base_ccy, quote_ccy, rate_date)
);

-- --------------------------------------------------------- 4. КОНВЕРТИ --
create table envelopes (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  name         text not null,
  kind         envelope_kind not null default 'variable',
  owner_id     uuid references profiles(id),   -- не NULL => особистий конверт ("кишенькові")
  icon         text,
  color        text,
  sort_order   int not null default 100,
  is_archived  boolean not null default false,
  created_at   timestamptz not null default now()
);
create index on envelopes (household_id, is_archived);

-- Місячний план: одна сума на конверт на місяць. period_month = ПЕРШЕ число місяця.
create table plan_lines (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references households(id) on delete cascade,
  envelope_id   uuid not null references envelopes(id)  on delete cascade,
  period_month  date not null,
  planned_minor bigint not null default 0,
  currency      char(3) not null default 'UAH',
  note          text,
  updated_by    uuid references profiles(id),
  updated_at    timestamptz not null default now(),
  unique (envelope_id, period_month),
  check (period_month = date_trunc('month', period_month)::date)
);
create index on plan_lines (household_id, period_month);

-- ------------------------------------------- 5. РЕГУЛЯРНІ ПЛАТЕЖІ (шаблон) --
-- Одна сутність для "підписка / рахунок / регулярний платіж". НЕ дублювати
-- окремою таблицею "bills" — це відома помилка (Firefly III #4163).
create table recurring_plans (
  id                    uuid primary key default gen_random_uuid(),
  household_id          uuid not null references households(id) on delete cascade,
  name                  text not null,
  envelope_id           uuid not null references envelopes(id),
  expected_amount_minor bigint not null default 0,
  currency              char(3) not null default 'UAH',
  amount_mode           amount_mode not null default 'fixed', -- 'variable' => питати суму щоразу
  -- розклад (структуровані поля замість RRULE — простіше для SQL і для Lovable)
  freq                  freq_kind not null default 'monthly',
  interval_n            int not null default 1,
  bymonthday            smallint,      -- 1..31, для monthly/yearly. 31 клампиться до кінця місяця
  byday                 smallint[],    -- ISO 1=Пн .. 7=Нд, для weekly
  bymonth               smallint,      -- 1..12, для yearly
  anchor_date           date not null default current_date,
  end_date              date,
  assignee_id           uuid references profiles(id),
  autoconfirm           boolean not null default false,  -- автосписання: підтверджувати автоматично
  fund_id               uuid,          -- FK нижче: фонд, який фінансує цей платіж
  debt_id               uuid references debts(id) on delete set null,  -- борг, який цей платіж гасить
  is_active             boolean not null default true,
  created_at            timestamptz not null default now()
);
create index on recurring_plans (household_id, is_active);

-- ------------------------------------------ 6. ОКРЕМІ ПЛАТЕЖІ (occurrence) --
-- Рядки існують ДО оплати — саме це робить місячний чекліст можливим.
create table occurrences (
  id                    uuid primary key default gen_random_uuid(),
  household_id          uuid not null references households(id) on delete cascade,
  recurring_plan_id     uuid references recurring_plans(id) on delete cascade, -- NULL => разовий майбутній платіж
  envelope_id           uuid not null references envelopes(id),
  name                  text not null,
  due_date              date not null,
  expected_amount_minor bigint not null default 0,
  currency              char(3) not null default 'UAH',
  status                occurrence_status not null default 'projected',
  assignee_id           uuid references profiles(id),
  paid_on               date,
  actual_amount_minor   bigint,
  paid_by               uuid references profiles(id),
  entry_id              uuid,          -- FK нижче: створений запис руху грошей
  is_detached           boolean not null default false,  -- користувач редагував → не перегенеровувати
  note                  text,
  created_at            timestamptz not null default now(),
  unique (recurring_plan_id, due_date)   -- ← робить генерацію ідемпотентною
);
create index on occurrences (household_id, due_date, status);

-- ------------------------------------------------------------- 7. ФОНДИ --
-- Одна сутність для sinking funds, цілей накопичення, подушки і буфера.
create table funds (
  id                       uuid primary key default gen_random_uuid(),
  household_id             uuid not null references households(id) on delete cascade,
  name                     text not null,
  kind                     fund_kind not null default 'sinking',
  currency                 char(3) not null default 'UAH',
  target_amount_minor      bigint,        -- NULL => безлімітний (подушка / "просто відкладаємо")
  due_date                 date,          -- NULL => без дедлайну
  monthly_fixed_minor      bigint,        -- якщо задано — фіксований внесок замість розрахованого
  on_payout                fund_payout not null default 'refill',
  buffer_pct               numeric(5,2) not null default 0,   -- 0..20, запас до цільової суми
  linked_recurring_plan_id uuid references recurring_plans(id) on delete set null,
  priority                 int not null default 100,
  icon                     text,
  is_archived              boolean not null default false,
  created_at               timestamptz not null default now()
);
create index on funds (household_id, is_archived);
alter table recurring_plans add constraint recurring_plans_fund_fk
  foreign key (fund_id) references funds(id) on delete set null;

-- ------------------------------------------------------------- 8. БОРГИ --
-- v1: простий трекер залишку. APR необов'язковий — багато сімейних боргів під 0%.
create table debts (
  id                    uuid primary key default gen_random_uuid(),
  household_id          uuid not null references households(id) on delete cascade,
  name                  text not null,
  counterparty          text,
  principal_minor       bigint not null,      -- початкова сума
  currency              char(3) not null default 'UAH',
  monthly_payment_minor bigint,               -- планований щомісячний внесок
  target_date           date,
  envelope_id           uuid references envelopes(id),
  order_index           int not null default 100,
  opened_on             date not null default current_date,
  closed_on             date,
  note                  text,
  created_at            timestamptz not null default now()
);
create index on debts (household_id, closed_on);

-- ------------------------------------- 9. ЄДИНА ТАБЛИЦЯ РУХУ ГРОШЕЙ --
-- Усі фактичні гроші проходять сюди: витрати, доходи, внески у фонди,
-- виплати боргів. Одна таблиця = одна форма швидкого вводу, одна історія,
-- одна база для аналітики.
--
-- ПРАВИЛО КУРСУ: потік (flow) заморожує курс на момент запису. Ніколи не
-- перераховувати історію за сьогоднішнім курсом.
create table entries (
  id                uuid primary key default gen_random_uuid(),
  household_id      uuid not null references households(id) on delete cascade,
  kind              entry_kind not null,
  occurred_on       date not null default current_date,
  amount_minor      bigint not null check (amount_minor > 0),
  currency          char(3) not null default 'UAH',
  fx_rate_to_base   numeric(20,10) not null default 1,
  amount_base_minor bigint not null,          -- заморожене значення в базовій валюті
  envelope_id       uuid references envelopes(id),
  fund_id           uuid references funds(id),
  debt_id           uuid references debts(id),
  occurrence_id     uuid references occurrences(id) on delete set null,
  trip_id           uuid,                      -- FK нижче: похід по магазинах
  note              text,
  created_by        uuid not null references profiles(id),
  created_at        timestamptz not null default now(),
  -- цілісність: у кожного виду свій обов'язковий зв'язок
  check (
    (kind = 'expense'        and envelope_id is not null) or
    (kind = 'income'         and envelope_id is not null) or
    (kind in ('fund_in','fund_out')  and fund_id is not null) or
    (kind in ('debt_payment','debt_adjustment') and debt_id is not null)
  )
);
create index on entries (household_id, occurred_on desc);
create index on entries (household_id, envelope_id, occurred_on);
create index on entries (household_id, fund_id);
create index on entries (household_id, debt_id);
alter table occurrences add constraint occurrences_entry_fk
  foreign key (entry_id) references entries(id) on delete set null;

-- ------------------------------------------------- 10. ЗНІМКИ ГОТІВКИ --
-- Залишки (stock) — на відміну від потоків — ПЕРЕОЦІНЮЮТЬСЯ.
-- Раз на місяць вводимо "у нас $2 300 і 41 000 ₴". Дає чесну лінію "скільки в нас є".
create table cash_snapshots (
  id                uuid primary key default gen_random_uuid(),
  household_id      uuid not null references households(id) on delete cascade,
  as_of             date not null,
  label             text not null default 'Готівка',  -- 'Картка', 'Готівка USD', 'Банка'
  currency          char(3) not null,
  amount_minor      bigint not null,
  fx_rate_to_base   numeric(20,10) not null default 1,
  amount_base_minor bigint not null,
  created_by        uuid references profiles(id),
  created_at        timestamptz not null default now(),
  unique (household_id, as_of, label)
);

-- ------------------------------------------------------------ 11. ЗАДАЧІ --
-- Модель Linear, зрізана до двох людей: статус, пріоритет, виконавець,
-- дедлайн, defer, один рівень підзадач.
create table task_templates (
  id                  uuid primary key default gen_random_uuid(),
  household_id        uuid not null references households(id) on delete cascade,
  title               text not null,
  notes               text,
  area                text,                   -- 'Дім' | 'Авто' | 'Гроші' | 'Адмін' ...
  labels              text[] not null default '{}',
  effort              smallint not null default 1 check (effort between 1 and 3),
  schedule_kind       schedule_kind not null default 'after_completion',
  -- fixed:
  freq                freq_kind,
  interval_n          int default 1,
  byday               smallint[],
  bymonthday          smallint,
  bymonth             smallint,
  dtstart             date not null default current_date,
  -- after_completion:
  interval_days       int,
  last_completed_at   timestamptz,
  -- політика:
  horizon_days        int not null default 21,
  rotation            rotation_mode not null default 'least_loaded',
  default_assignee_id uuid references profiles(id),
  is_active           boolean not null default true,
  paused_until        date,
  created_at          timestamptz not null default now()
);
create index on task_templates (household_id, is_active);

create table tasks (
  id             uuid primary key default gen_random_uuid(),
  household_id   uuid not null references households(id) on delete cascade,
  template_id    uuid references task_templates(id) on delete cascade,
  occurrence_key date,                        -- локальна дата екземпляра
  title          text not null,
  notes          text,
  status         task_status not null default 'todo',
  priority       smallint not null default 0 check (priority between 0 and 4), -- 0=немає (сортується ОСТАННІМ), 1=Терміново .. 4=Низький
  assignee_id    uuid references profiles(id),   -- NULL = "вільна, хто візьме"
  area           text,
  labels         text[] not null default '{}',
  due_date       date,
  defer_until    date,                        -- ховати зі списку до цієї дати
  effort         smallint not null default 1 check (effort between 1 and 3),
  parent_id      uuid references tasks(id) on delete cascade,  -- рівно 1 рівень вкладеності
  is_detached    boolean not null default false,
  created_by     uuid not null references profiles(id),
  created_at     timestamptz not null default now(),
  completed_at   timestamptz,
  completed_by   uuid references profiles(id),
  unique (template_id, occurrence_key)        -- ← ідемпотентна генерація
);
create index on tasks (household_id, status, due_date);
create index on tasks (household_id, assignee_id, status);
create index on tasks (household_id, completed_at);

-- --------------------------------------------------- 12. СПИСОК ПОКУПОК --
create table shopping_trips (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  store        text,
  shopped_by   uuid references profiles(id),
  completed_at timestamptz not null default now(),
  total_minor  bigint,
  currency     char(3) not null default 'UAH',
  entry_id     uuid references entries(id) on delete set null
);
alter table entries add constraint entries_trip_fk
  foreign key (trip_id) references shopping_trips(id) on delete set null;

create table shopping_items (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  name         text not null,
  qty          text,
  category     text,                          -- 'Молочне', 'Овочі' — для сортування за відділами
  note         text,
  added_by     uuid not null references profiles(id),
  added_at     timestamptz not null default now(),
  checked_at   timestamptz,
  checked_by   uuid references profiles(id),
  trip_id      uuid references shopping_trips(id) on delete set null
);
create index on shopping_items (household_id, trip_id, checked_at);

-- --------------------------------------------- 13. РИТУАЛ ЗАКРИТТЯ МІСЯЦЯ --
create table month_closes (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  period_month date not null,
  step         text not null default 'income',  -- income|obligations|variables|funds|debts|cash|review
  completed_at timestamptz,
  completed_by uuid references profiles(id),
  unique (household_id, period_month)
);

-- ------------------------------------------------ 14. ЖУРНАЛ ЗМІН (легкий) --
create table change_log (
  id           bigserial primary key,
  household_id uuid not null references households(id) on delete cascade,
  entity       text not null,
  entity_id    uuid,
  summary      text not null,
  actor_id     uuid references profiles(id),
  at           timestamptz not null default now()
);
create index on change_log (household_id, at desc);
