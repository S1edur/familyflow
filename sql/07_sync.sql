-- ============================================================================
-- FAMILY HUB — підготовка до офлайну з синхронізацією
--
-- Виконувати ПІСЛЯ 01–06. Файл ідемпотентний: можна ганяти повторно.
--
-- Дві колонки на кожну таблицю, яка синхронізується:
--
--   updated_at  коли рядок востаннє змінювали. Це те, на чому стоїть
--               «останній запис виграє». Досі в схемі воно було рівно
--               ОДИН раз (plan_lines), тож зводити зміни з двох пристроїв
--               було просто нічим.
--
--   deleted_at  мітка видалення замість фізичного DELETE. Без неї видалення
--               на офлайновому пристрої не доїде до іншого: там нічого не
--               зміниться, і рядок воскресне при наступній синхронізації.
--
-- Журнал change_log НЕ для цього: він містить entity/summary/actor/at,
-- тобто людський опис події без даних операції. Це аудит, не синхронізація.
-- ============================================================================

-- ------------------------------------------------------------- ТРИГЕР --
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ------------------------------------------------- КОЛОНКИ І ТРИГЕРИ --
do $$
declare t text;
  -- Тільки дані домогосподарства. Поза списком свідомо:
  --   profiles, households, household_members, household_invites — керуються
  --     входом і запрошеннями, не синхронізуються як дані;
  --   fx_rates — довідник курсів, спільний і лише доповнюваний;
  --   change_log — журнал аудиту, append-only за визначенням.
  tables text[] := array[
    'envelopes', 'plan_lines', 'recurring_plans', 'occurrences',
    'funds', 'debts', 'entries', 'cash_snapshots',
    'task_templates', 'tasks', 'shopping_trips', 'shopping_items',
    'month_closes'
  ];
begin
  foreach t in array tables loop
    execute format('alter table %I add column if not exists updated_at timestamptz not null default now()', t);
    execute format('alter table %I add column if not exists deleted_at timestamptz', t);

    -- індекс під вибірку «що змінилось після мого останнього синку»
    execute format('create index if not exists %I on %I (household_id, updated_at)', t || '_sync_idx', t);

    execute format('drop trigger if exists %I on %I', t || '_touch', t);
    execute format(
      'create trigger %I before update on %I for each row execute function public.touch_updated_at()',
      t || '_touch', t);
  end loop;
end $$;

-- ============================================================================
-- ПЕРЕВІРКА. Кожна з 13 таблиць має показати updated_at, deleted_at і тригер:
--
--   select c.relname,
--          count(*) filter (where a.attname = 'updated_at') as has_updated,
--          count(*) filter (where a.attname = 'deleted_at') as has_deleted,
--          (select count(*) from pg_trigger g
--             where g.tgrelid = c.oid and not g.tgisinternal) as triggers
--   from pg_class c
--   join pg_namespace n on n.oid = c.relnamespace
--   join pg_attribute a on a.attrelid = c.oid and a.attnum > 0
--   where n.nspname = 'public' and c.relkind = 'r'
--   group by c.relname, c.oid
--   order by 2, 1;
--
-- Таблиця без updated_at не зможе розв'язати конфлікт і мовчки візьме
-- те, що приїхало останнім по мережі, а не те, що змінили останнім.
-- ============================================================================
