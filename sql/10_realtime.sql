-- ============================================================================
-- FAMILY HUB — увімкнути реалтайм на таблицях даних
--
-- Виконувати ПІСЛЯ 01–09. Ідемпотентний.
--
-- Підписка з клієнта мовчатиме, поки таблиця не входить у публікацію
-- supabase_realtime. Помилки при цьому НЕ буде — просто нічого не приходить,
-- і це найгірший різновид: виглядає як «реалтайм не працює», а насправді
-- ніхто його й не вмикав.
--
-- RLS діє й тут: подія доїде лише тому, кому видно рядок. Тобто чужий дім
-- ніяких сповіщень не отримає.
-- ============================================================================

do $$
declare t text;
  tables text[] := array[
    'envelopes', 'plan_lines', 'recurring_plans', 'occurrences',
    'funds', 'debts', 'entries',
    'task_templates', 'tasks', 'shopping_trips', 'shopping_items',
    'household_members'
  ];
begin
  foreach t in array tables loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- Щоб у події про ВИДАЛЕННЯ приїжджав не лише id, а весь рядок.
-- Без цього видалення на іншому пристрої неможливо зіставити з локальним.
do $$
declare t text;
  tables text[] := array[
    'envelopes', 'plan_lines', 'recurring_plans', 'occurrences',
    'funds', 'debts', 'entries',
    'task_templates', 'tasks', 'shopping_trips', 'shopping_items'
  ];
begin
  foreach t in array tables loop
    execute format('alter table public.%I replica identity full', t);
  end loop;
end $$;

-- ============================================================================
-- ПЕРЕВІРКА: має бути 12 рядків
--
--   select tablename from pg_publication_tables
--   where pubname = 'supabase_realtime' and schemaname = 'public'
--   order by 1;
-- ============================================================================
