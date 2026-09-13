-- ============================================================================
-- FAMILY HUB — прибирання після аудиту
--
-- Виконувати ПІСЛЯ 01–12. Ідемпотентний: безпечно запускати, навіть якщо
-- частини з 03/04 у вашій базі ніколи не було.
--
-- 1. ВʼЮХИ v_* ВІДДАВАЛИ ДАНІ ВСІХ ДОМІВ.
--    Звичайна вʼюха в Postgres виконується з правами власника (postgres),
--    тож RLS на таблицях під нею не діє. Supabase за замовчуванням дає SELECT
--    на нові обʼєкти ролям anon і authenticated — отже з публічним ключем
--    із бандла можна було прочитати чужі борги, доходи й імена.
--    Застосунок ці вʼюхи не використовує: усе похідне рахує клієнт.
--
-- 2. СЕРВЕРНА ГЕНЕРАЦІЯ ПЛАТЕЖІВ І ЗАДАЧ (03, 04) РОЗІЙШЛАСЬ ІЗ КЛІЄНТОМ.
--    Клієнт генерує рядки з детермінованими id (stableId), сервер — з
--    випадковими. Той самий платіж із двома id ламає чергу синхронізації
--    на unique(recurring_plan_id, due_date). Крім того, сервер не знає про
--    deleted_at (воскрешав видалені правила щоночі) і про внески у фонди,
--    а функції були security definer без перевірки дому — будь-хто міг їх
--    викликати для чужого дому. Клієнт жодної з них не викликає.
--    Генерація живе в одному місці — src/data/store.ts → materialize().
--
-- 3. ВСТУП У ДІМ ЛИШЕ ЗА ЗАПРОШЕННЯМ.
--    members_insert дозволяв додати себе в будь-який дім, знаючи його uuid.
--    Обидва законні шляхи — create_household і accept_invite — security
--    definer і політики не потребують.
-- ============================================================================

-- ---------------------------------------------------------------- cron ------
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'family-hub-nightly';
  end if;
end $$;

-- ---------------------------------------------------------------- вʼюхи -----
drop view if exists public.v_fairness;
drop view if exists public.v_month_summary;
drop view if exists public.v_debt_status;
drop view if exists public.v_envelope_month;
drop view if exists public.v_fund_status;

-- ---------------------------------------------- серверна генерація і RPC ----
-- Видаляємо за іменем, а не за сигнатурою: у різних версіях 03 вони відрізнялись.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'nightly_materialize', 'ensure_materialized',
        'materialize_occurrences', 'materialize_tasks', 'expand_dates',
        'confirm_occurrence', 'skip_occurrence', 'complete_task',
        'finish_shopping', 'current_rate'
      )
  loop
    execute format('drop function if exists %s cascade', f.sig);
  end loop;
end $$;

-- ---------------------------------------------------------------- RLS -------
drop policy if exists members_insert on public.household_members;
drop policy if exists invites_update on public.household_invites;

-- ПЕРЕВІРКА (має повернути нуль рядків у кожному):
--   select viewname from pg_views where schemaname = 'public' and viewname like 'v\_%';
--   select proname from pg_proc where proname like 'materialize%' or proname = 'nightly_materialize';
--   select policyname from pg_policies where policyname in ('members_insert', 'invites_update');
