-- ============================================================================
-- FAMILY HUB — функції, автоматизації та в'юхи
-- ============================================================================

-- --------------------------------------------------- 1. РОЗГОРТАННЯ ДАТ --
-- Замість повного RRULE — структуровані поля. Покриває все, що треба сім'ї.
create or replace function public.expand_dates(
  p_freq       freq_kind,
  p_interval   int,
  p_byday      smallint[],
  p_bymonthday smallint,
  p_bymonth    smallint,
  p_dtstart    date,
  p_from       date,
  p_to         date
) returns setof date
language plpgsql immutable as $$
declare
  d date;
  m date;
  target_day int;
  months_diff int;
begin
  p_interval := greatest(coalesce(p_interval, 1), 1);

  if p_freq = 'daily' then
    for d in
      select gs::date from generate_series(p_dtstart, p_to, make_interval(days => p_interval)) gs
    loop
      if d >= p_from then return next d; end if;
    end loop;

  elsif p_freq = 'weekly' then
    for d in select gs::date from generate_series(greatest(p_dtstart, p_from - 7), p_to, interval '1 day') gs
    loop
      if d < p_from then continue; end if;
      if p_byday is not null and array_length(p_byday,1) > 0 then
        if not (extract(isodow from d)::smallint = any(p_byday)) then continue; end if;
      else
        if extract(isodow from d) <> extract(isodow from p_dtstart) then continue; end if;
      end if;
      if (floor((d - date_trunc('week', p_dtstart)::date) / 7.0)::int % p_interval) <> 0 then continue; end if;
      return next d;
    end loop;

  elsif p_freq = 'monthly' then
    target_day := coalesce(p_bymonthday, extract(day from p_dtstart)::int);
    for m in select gs::date from generate_series(
               date_trunc('month', greatest(p_dtstart, p_from))::date,
               date_trunc('month', p_to)::date, interval '1 month') gs
    loop
      months_diff := (extract(year from m)::int - extract(year from p_dtstart)::int) * 12
                   + (extract(month from m)::int - extract(month from p_dtstart)::int);
      if months_diff % p_interval <> 0 then continue; end if;
      -- клампимо 31 до кінця місяця, ніколи не пропускаємо лютий
      d := m + (least(target_day, extract(day from (m + interval '1 month - 1 day'))::int) - 1);
      if d between p_from and p_to then return next d; end if;
    end loop;

  elsif p_freq = 'yearly' then
    target_day := coalesce(p_bymonthday, extract(day from p_dtstart)::int);
    for m in select gs::date from generate_series(
               date_trunc('year', greatest(p_dtstart, p_from))::date,
               date_trunc('year', p_to)::date, make_interval(years => p_interval)) gs
    loop
      d := make_date(extract(year from m)::int, coalesce(p_bymonth, extract(month from p_dtstart)::int), 1);
      d := d + (least(target_day, extract(day from (d + interval '1 month - 1 day'))::int) - 1);
      if d between p_from and p_to then return next d; end if;
    end loop;
  end if;
end;
$$;

-- ------------------------------------------- 2. ГЕНЕРАЦІЯ ПЛАТЕЖІВ --
-- Ідемпотентна: unique(recurring_plan_id, due_date) + on conflict do nothing.
-- Можна викликати скільки завгодно разів — дублікатів не буде.
create or replace function public.materialize_occurrences(p_household uuid, p_months int default 13)
returns int
language plpgsql security definer set search_path = public as $$
declare
  r record; d date; n int := 0;
  horizon date := (date_trunc('month', current_date) + make_interval(months => p_months))::date;
begin
  for r in select * from recurring_plans where household_id = p_household and is_active loop
    for d in select * from expand_dates(r.freq, r.interval_n, r.byday, r.bymonthday, r.bymonth,
                                        r.anchor_date, date_trunc('month', current_date)::date, horizon)
    loop
      if r.end_date is not null and d > r.end_date then continue; end if;
      insert into occurrences (household_id, recurring_plan_id, envelope_id, name, due_date,
                               expected_amount_minor, currency, status, assignee_id)
      values (p_household, r.id, r.envelope_id, r.name, d,
              r.expected_amount_minor, r.currency,
              case when d <= current_date then 'due' else 'projected' end,
              r.assignee_id)
      on conflict (recurring_plan_id, due_date) do nothing;
      if found then n := n + 1; end if;
    end loop;
  end loop;

  -- projected → due, коли настав час
  update occurrences set status = 'due'
   where household_id = p_household and status = 'projected' and due_date <= current_date;

  return n;
end;
$$;

-- ---------------------------------------------- 3. ГЕНЕРАЦІЯ ЗАДАЧ --
create or replace function public.materialize_tasks(p_household uuid)
returns int
language plpgsql security definer set search_path = public as $$
declare
  r record; d date; n int := 0; who uuid; open_cnt int;
begin
  for r in select * from task_templates
            where household_id = p_household and is_active
              and (paused_until is null or paused_until <= current_date) loop

    -- хто виконує: least_loaded = хто менше закрив за 28 днів
    who := r.default_assignee_id;
    if r.rotation = 'least_loaded' then
      select hm.profile_id into who
      from household_members hm
      left join tasks t on t.completed_by = hm.profile_id
                       and t.completed_at > now() - interval '28 days'
      where hm.household_id = p_household
      group by hm.profile_id
      order by coalesce(sum(t.effort),0) asc, random()
      limit 1;
    end if;

    if r.schedule_kind = 'after_completion' then
      -- рівно ОДИН відкритий екземпляр за раз → накопичення прострочень неможливе
      select count(*) into open_cnt from tasks
       where template_id = r.id and status not in ('done','dropped');
      if open_cnt = 0 then
        d := coalesce(r.last_completed_at::date, r.dtstart) + coalesce(r.interval_days, 7);
        insert into tasks (household_id, template_id, occurrence_key, title, notes, area, labels,
                           effort, due_date, assignee_id, created_by, status)
        values (p_household, r.id, d, r.title, r.notes, r.area, r.labels,
                r.effort, d, who, coalesce(r.default_assignee_id, who), 'todo')
        on conflict (template_id, occurrence_key) do nothing;
        n := n + 1;
      end if;

    elsif r.schedule_kind = 'fixed' then
      for d in select * from expand_dates(r.freq, r.interval_n, r.byday, r.bymonthday, r.bymonth,
                                          r.dtstart, current_date, current_date + r.horizon_days)
      loop
        insert into tasks (household_id, template_id, occurrence_key, title, notes, area, labels,
                           effort, due_date, assignee_id, created_by, status)
        values (p_household, r.id, d, r.title, r.notes, r.area, r.labels,
                r.effort, d, who, coalesce(r.default_assignee_id, who), 'todo')
        on conflict (template_id, occurrence_key) do nothing;
        n := n + 1;
      end loop;
    end if;
  end loop;
  return n;
end;
$$;

-- Викликати з клієнта при кожному відкритті застосунку. Ідемпотентно і дешево.
create or replace function public.ensure_materialized()
returns json
language plpgsql security definer set search_path = public as $$
declare h uuid; a int; b int;
begin
  h := my_household_id();
  if h is null then return json_build_object('ok', false); end if;
  a := materialize_occurrences(h);
  b := materialize_tasks(h);
  return json_build_object('ok', true, 'occurrences', a, 'tasks', b);
end;
$$;
grant execute on function public.ensure_materialized() to authenticated;

-- -------------------------------------- 4. ПІДТВЕРДЖЕННЯ ПЛАТЕЖУ (1 тап) --
create or replace function public.confirm_occurrence(
  p_occurrence uuid,
  p_amount     bigint default null,   -- null => беремо очікувану суму
  p_paid_on    date   default null,
  p_rate       numeric default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare o occurrences%rowtype; amt bigint; rate numeric; eid uuid; f uuid; dbt uuid;
begin
  select * into o from occurrences where id = p_occurrence and household_id = my_household_id();
  if not found then raise exception 'occurrence not found'; end if;

  amt  := coalesce(p_amount, o.expected_amount_minor);
  rate := coalesce(p_rate, current_rate(o.currency));

  -- Платіж, що гасить борг, — це ОДИН запис debt_payment, який несе і конверт,
  -- і борг: v_debt_status читає його як виплату, v_envelope_month — як витрату
  -- місяця. Два записи про одну подію довелось би тримати в синхроні.
  select debt_id into dbt from recurring_plans where id = o.recurring_plan_id;

  insert into entries (household_id, kind, occurred_on, amount_minor, currency,
                       fx_rate_to_base, amount_base_minor, envelope_id, debt_id, occurrence_id, created_by)
  values (o.household_id,
          case when dbt is not null then 'debt_payment'::entry_kind else 'expense'::entry_kind end,
          coalesce(p_paid_on, current_date), amt, o.currency,
          rate, round(amt * rate), o.envelope_id, dbt, o.id, auth.uid())
  returning id into eid;

  update occurrences
     set status = 'paid', paid_on = coalesce(p_paid_on, current_date),
         actual_amount_minor = amt, paid_by = auth.uid(), entry_id = eid
   where id = o.id;

  -- якщо платіж фінансується фондом — списуємо з фонду, а не рахуємо витрату двічі
  select fund_id into f from recurring_plans where id = o.recurring_plan_id;
  if f is not null then
    insert into entries (household_id, kind, occurred_on, amount_minor, currency,
                         fx_rate_to_base, amount_base_minor, fund_id, occurrence_id, created_by)
    values (o.household_id, 'fund_out', coalesce(p_paid_on, current_date), amt, o.currency,
            rate, round(amt * rate), f, o.id, auth.uid());

    update funds set due_date = case when on_payout = 'refill'
                                     then (select min(due_date) from occurrences
                                            where recurring_plan_id = o.recurring_plan_id
                                              and due_date > o.due_date)
                                     else due_date end
     where id = f;
  end if;

  -- змінна сума → підтягуємо очікування наступного разу до медіани останніх 6
  update recurring_plans rp
     set expected_amount_minor = sub.med
    from (select round(percentile_cont(0.5) within group (order by actual_amount_minor))::bigint as med
          from (select actual_amount_minor from occurrences
                 where recurring_plan_id = o.recurring_plan_id and status = 'paid'
                 order by paid_on desc limit 6) x) sub
   where rp.id = o.recurring_plan_id and rp.amount_mode = 'variable' and sub.med is not null;

  return eid;
end;
$$;
grant execute on function public.confirm_occurrence(uuid,bigint,date,numeric) to authenticated;

-- Пропустити платіж — це стан, а не видалення. "Ми не платили в серпні" — це інформація.
create or replace function public.skip_occurrence(p_occurrence uuid, p_note text default null)
returns void language sql security definer set search_path = public as $$
  update occurrences set status = 'skipped', note = coalesce(p_note, note), is_detached = true
   where id = p_occurrence and household_id = my_household_id();
$$;
grant execute on function public.skip_occurrence(uuid,text) to authenticated;

-- --------------------------------------------------- 5. КУРС ВАЛЮТИ --
create or replace function public.current_rate(p_ccy char(3))
returns numeric
language plpgsql stable security definer set search_path = public as $$
declare base char(3); r numeric;
begin
  select base_currency into base from households where id = my_household_id();
  if p_ccy = coalesce(base,'UAH') then return 1; end if;
  select rate into r from fx_rates
   where base_ccy = p_ccy and quote_ccy = coalesce(base,'UAH')
   order by rate_date desc limit 1;
  return coalesce(r, 1);
end;
$$;
grant execute on function public.current_rate(char) to authenticated;

-- ------------------------------------------- 6. ЗАВЕРШЕННЯ ЗАДАЧІ --
create or replace function public.complete_task(p_task uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare t tasks%rowtype;
begin
  select * into t from tasks where id = p_task and household_id = my_household_id();
  if not found then raise exception 'task not found'; end if;

  update tasks set status = 'done', completed_at = now(), completed_by = auth.uid() where id = p_task;

  if t.template_id is not null then
    update task_templates set last_completed_at = now() where id = t.template_id;
    perform materialize_tasks(t.household_id);   -- одразу породжує наступний екземпляр
  end if;
end;
$$;
grant execute on function public.complete_task(uuid) to authenticated;

-- ---------------------------------------- 7. ЗАВЕРШЕННЯ ПОХОДУ В МАГАЗИН --
-- Один загальний чек → одна витрата. НЕ просимо ціну кожного товару.
create or replace function public.finish_shopping(
  p_store text, p_total bigint, p_envelope uuid,
  p_currency char(3) default 'UAH', p_rate numeric default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare h uuid; trip uuid; eid uuid; rate numeric;
begin
  h := my_household_id();
  rate := coalesce(p_rate, current_rate(p_currency));

  insert into shopping_trips (household_id, store, shopped_by, total_minor, currency)
  values (h, p_store, auth.uid(), p_total, p_currency) returning id into trip;

  insert into entries (household_id, kind, occurred_on, amount_minor, currency,
                       fx_rate_to_base, amount_base_minor, envelope_id, trip_id, created_by, note)
  values (h, 'expense', current_date, p_total, p_currency,
          rate, round(p_total * rate), p_envelope, trip, auth.uid(), coalesce(p_store,'Покупки'))
  returning id into eid;

  update shopping_trips set entry_id = eid where id = trip;
  update shopping_items set trip_id = trip where household_id = h and checked_at is not null and trip_id is null;

  return trip;
end;
$$;
grant execute on function public.finish_shopping(text,bigint,uuid,char,numeric) to authenticated;

-- ============================================================================
-- 8. В'ЮХИ. Усе похідне рахується на читанні. Нічого не денормалізуємо:
--    збережений "monthly_contribution" або "current_balance" протухає при
--    першому ж пропущеному внеску і мовчки ламає всі цифри.
-- ============================================================================

-- Фонди: скільки треба класти ЦЬОГО місяця, щоб встигнути
create or replace view v_fund_status as
select
  f.id, f.household_id, f.name, f.kind, f.currency, f.due_date, f.priority, f.is_archived,
  round(coalesce(f.target_amount_minor,0) * (1 + f.buffer_pct/100))::bigint as target_with_buffer_minor,
  coalesce(sum(case when e.kind = 'fund_in'  then e.amount_minor else 0 end),0)
  - coalesce(sum(case when e.kind = 'fund_out' then e.amount_minor else 0 end),0) as balance_minor,
  greatest(1, coalesce(
    (extract(year from f.due_date)::int - extract(year from current_date)::int) * 12
    + (extract(month from f.due_date)::int - extract(month from current_date)::int) + 1, 1)) as months_left,
  coalesce(f.monthly_fixed_minor,
    greatest(0, ceil(
      (round(coalesce(f.target_amount_minor,0) * (1 + f.buffer_pct/100))
       - (coalesce(sum(case when e.kind='fund_in' then e.amount_minor else 0 end),0)
          - coalesce(sum(case when e.kind='fund_out' then e.amount_minor else 0 end),0))
      )::numeric
      / greatest(1, coalesce(
          (extract(year from f.due_date)::int - extract(year from current_date)::int) * 12
        + (extract(month from f.due_date)::int - extract(month from current_date)::int) + 1, 1))
    )::bigint)
  ) as required_this_month_minor
from funds f
left join entries e on e.fund_id = f.id
group by f.id;

-- Конверти: план vs факт по місяцях
create or replace view v_envelope_month as
select
  en.household_id, en.id as envelope_id, en.name, en.kind, en.owner_id,
  p.period_month,
  coalesce(pl.planned_minor,0) as planned_minor,
  coalesce(sum(e.amount_base_minor) filter (where e.kind in ('expense','debt_payment')),0) as actual_minor,
  coalesce(pl.planned_minor,0)
    - coalesce(sum(e.amount_base_minor) filter (where e.kind in ('expense','debt_payment')),0) as remaining_minor
from envelopes en
cross join (select distinct date_trunc('month', occurred_on)::date as period_month from entries
            union select distinct period_month from plan_lines) p
left join plan_lines pl on pl.envelope_id = en.id and pl.period_month = p.period_month
left join entries e on e.envelope_id = en.id and date_trunc('month', e.occurred_on)::date = p.period_month
where not en.is_archived
group by en.household_id, en.id, en.name, en.kind, en.owner_id, p.period_month, pl.planned_minor;

-- Борги: залишок, прогрес, прогнозна дата закриття
create or replace view v_debt_status as
select
  d.id, d.household_id, d.name, d.counterparty, d.currency, d.target_date, d.closed_on,
  d.principal_minor,
  coalesce(sum(e.amount_minor) filter (where e.kind = 'debt_payment'),0)
  - coalesce(sum(e.amount_minor) filter (where e.kind = 'debt_adjustment'),0) as paid_minor,
  d.principal_minor
    - coalesce(sum(e.amount_minor) filter (where e.kind = 'debt_payment'),0)
    + coalesce(sum(e.amount_minor) filter (where e.kind = 'debt_adjustment'),0) as remaining_minor,
  round(100.0 * coalesce(sum(e.amount_minor) filter (where e.kind='debt_payment'),0)
        / nullif(d.principal_minor,0), 1) as progress_pct,
  case when coalesce(d.monthly_payment_minor,0) > 0 then
    (current_date + make_interval(months => ceil(
      (d.principal_minor - coalesce(sum(e.amount_minor) filter (where e.kind='debt_payment'),0))::numeric
      / d.monthly_payment_minor)::int))::date
  end as projected_payoff_date
from debts d
left join entries e on e.debt_id = d.id
group by d.id;

-- Головне число місяця: скільки лишається вільним після зобов'язань
create or replace view v_month_summary as
select
  h.id as household_id,
  date_trunc('month', current_date)::date as period_month,
  (select coalesce(sum(e.amount_base_minor),0) from entries e
    where e.household_id = h.id and e.kind = 'income'
      and date_trunc('month', e.occurred_on) = date_trunc('month', current_date)) as income_minor,
  (select coalesce(sum(o.expected_amount_minor),0) from occurrences o
    where o.household_id = h.id and o.status in ('due','projected')
      and date_trunc('month', o.due_date) = date_trunc('month', current_date)) as obligations_left_minor,
  (select coalesce(sum(vf.required_this_month_minor),0) from v_fund_status vf
    where vf.household_id = h.id and not vf.is_archived) as funds_required_minor,
  (select coalesce(sum(d.monthly_payment_minor),0) from debts d
    where d.household_id = h.id and d.closed_on is null) as debt_due_minor
from households h;

-- Баланс навантаження по задачах за 28 днів (нейтральна смуга 40–60%)
create or replace view v_fairness as
select
  hm.household_id, hm.profile_id, p.display_name,
  coalesce(sum(t.effort) filter (where t.completed_at > now() - interval '28 days'),0) as effort_done,
  count(t.id) filter (where t.created_by = hm.profile_id
                        and t.created_at > now() - interval '28 days') as tasks_created
from household_members hm
join profiles p on p.id = hm.profile_id
left join tasks t on t.completed_by = hm.profile_id and t.household_id = hm.household_id
group by hm.household_id, hm.profile_id, p.display_name;
