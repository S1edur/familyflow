-- ============================================================================
-- FAMILY HUB — Row Level Security
--
-- КЛЮЧОВЕ ПРАВИЛО: жодна політика не має робити SELECT з таблиці, на якій вона
-- висить — це нескінченна рекурсія (найпоширеніша помилка Lovable+Supabase).
-- Тому належність до домогосподарства визначає ОДНА security definer функція.
-- ============================================================================

-- ------------------------------------------------------------- ХЕЛПЕРИ --
create or replace function public.my_household_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select household_id
  from household_members
  where profile_id = auth.uid()
  limit 1;
$$;

revoke all on function public.my_household_id() from public;
grant execute on function public.my_household_id() to authenticated;

-- Автостворення профілю після реєстрації
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email,'@',1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ------------------------------------------------------ УВІМКНУТИ RLS --
alter table profiles          enable row level security;
alter table households        enable row level security;
alter table household_members enable row level security;
alter table household_invites enable row level security;
alter table fx_rates          enable row level security;
alter table envelopes         enable row level security;
alter table plan_lines        enable row level security;
alter table recurring_plans   enable row level security;
alter table occurrences       enable row level security;
alter table funds             enable row level security;
alter table debts             enable row level security;
alter table entries           enable row level security;
alter table cash_snapshots    enable row level security;
alter table task_templates    enable row level security;
alter table tasks             enable row level security;
alter table shopping_trips    enable row level security;
alter table shopping_items    enable row level security;
alter table month_closes      enable row level security;
alter table change_log        enable row level security;

-- ------------------------------------------------------------ ПРОФІЛІ --
create policy profiles_select on profiles for select to authenticated
  using (
    id = auth.uid()
    or id in (select profile_id from household_members where household_id = my_household_id())
  );
create policy profiles_insert on profiles for insert to authenticated
  with check (id = auth.uid());
create policy profiles_update on profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- --------------------------------------------------- ДОМОГОСПОДАРСТВО --
create policy households_select on households for select to authenticated
  using (id = my_household_id());
create policy households_insert on households for insert to authenticated
  with check (true);                       -- створення першого household при онбордингу
create policy households_update on households for update to authenticated
  using (id = my_household_id()) with check (id = my_household_id());

create policy members_select on household_members for select to authenticated
  using (household_id = my_household_id() or profile_id = auth.uid());
create policy members_insert on household_members for insert to authenticated
  with check (profile_id = auth.uid());    -- себе додаєш сам (через створення або інвайт)
create policy members_update on household_members for update to authenticated
  using (household_id = my_household_id()) with check (household_id = my_household_id());
create policy members_delete on household_members for delete to authenticated
  using (profile_id = auth.uid());

create policy invites_select on household_invites for select to authenticated
  using (household_id = my_household_id());
create policy invites_insert on household_invites for insert to authenticated
  with check (household_id = my_household_id());
create policy invites_update on household_invites for update to authenticated
  using (true);                            -- прийняття інвайту робиться через RPC accept_invite()

-- ------------------------------------------------------------- КУРСИ --
create policy fx_select on fx_rates for select to authenticated using (true);
create policy fx_insert on fx_rates for insert to authenticated with check (true);
create policy fx_update on fx_rates for update to authenticated using (true) with check (true);

-- ---------------------------------- УСІ ТАБЛИЦІ ДАНИХ ДОМОГОСПОДАРСТВА --
-- Генеруємо однакові 4 політики (SELECT/INSERT/UPDATE/DELETE) для кожної.
-- НЕ обмежуємось SELECT — неповний набір політик це друга за частотою
-- помилка після рекурсії.
do $$
declare t text;
begin
  foreach t in array array[
    'envelopes','plan_lines','recurring_plans','occurrences','funds','debts',
    'entries','cash_snapshots','task_templates','tasks','shopping_trips',
    'shopping_items','month_closes','change_log'
  ]
  loop
    execute format($f$
      create policy %1$s_select on %1$s for select to authenticated
        using (household_id = my_household_id());
      create policy %1$s_insert on %1$s for insert to authenticated
        with check (household_id = my_household_id());
      create policy %1$s_update on %1$s for update to authenticated
        using (household_id = my_household_id())
        with check (household_id = my_household_id());
      create policy %1$s_delete on %1$s for delete to authenticated
        using (household_id = my_household_id());
    $f$, t);
  end loop;
end $$;

-- ============================================================================
-- ПЕРЕВІРКА ПЕРЕД ЗАПУСКОМ (виконати і переконатись, що rls_enabled = true
-- і policy_count = 3..4 для КОЖНОЇ таблиці):
--
--   select c.relname as table_name,
--          c.relrowsecurity as rls_enabled,
--          count(p.polname) as policy_count
--   from pg_class c
--   join pg_namespace n on n.oid = c.relnamespace
--   left join pg_policy p on p.polrelid = c.oid
--   where n.nspname = 'public' and c.relkind = 'r'
--   group by 1,2 order by 3, 1;
--
-- Таблиця з rls_enabled = true і policy_count = 0 — це не "захищено",
-- це "порожній екран після логіну".
-- ============================================================================
