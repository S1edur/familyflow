-- ============================================================================
-- FAMILY HUB — планові задачі (Supabase Cron / pg_cron)
-- Dashboard → Integrations → Cron, або просто виконати цей SQL.
--
-- ВАЖЛИВО: на безкоштовному тарифі Supabase проєкт паузиться після ~7 днів
-- тиші, і разом з ним МОВЧКИ зупиняється cron. Тому вся генерація також
-- викликається з клієнта через ensure_materialized() на кожному відкритті
-- застосунку. Cron — це підстраховка, а не єдиний механізм.
-- ============================================================================

create extension if not exists pg_cron;

create or replace function public.nightly_materialize()
returns void
language plpgsql security definer set search_path = public as $$
declare h record;
begin
  for h in select id from households loop
    perform materialize_occurrences(h.id);
    perform materialize_tasks(h.id);
  end loop;

  -- прострочені платежі переводимо в 'due' (не плодимо дублікати)
  update occurrences set status = 'due'
   where status = 'projected' and due_date <= current_date;
end;
$$;

-- 03:10 щодня за UTC
select cron.schedule('family-hub-nightly', '10 3 * * *', $$select public.nightly_materialize()$$);

-- Перевірити: select * from cron.job;
-- Історія:   select * from cron.job_run_details order by start_time desc limit 20;
