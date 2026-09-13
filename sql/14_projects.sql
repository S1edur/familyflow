-- ============================================================================
-- FAMILY HUB — усе проєкти
--
-- Виконувати ПІСЛЯ 01–13. Повторний запуск безпечний: структура — if not
-- exists, перенесення даних пропускає доми, де проєкти вже є.
--
-- Конверт, фонд і борг стають однією сутністю — проєктом. Різниця між ними
-- тепер налаштування (direction), а не таблиця. Запис про гроші має чотири
-- види: income, expense, transfer (не витрата — перекладання між проєктами),
-- repay. Специфікація: docs/superpowers/specs/2026-09-13-projects-model-design.md
--
-- Перенесення зберігає id: проєкт із конверта, фонду чи боргу має той самий
-- uuid, що й джерело. Тому всі посилання в записах, платежах і правилах
-- просто переїжджають у project_id, а синхронізація не бачить «нових» рядків.
-- Старі таблиці (envelopes, plan_lines, funds, debts) не видаляються —
-- лишаються історією, застосунок їх більше не читає.
-- ============================================================================

-- --------------------------------------------------------------- таблиця ----
create table if not exists projects (
  id                uuid primary key default gen_random_uuid(),
  household_id      uuid not null references households(id) on delete cascade,
  name              text not null,
  description       text,
  direction         text not null default 'spend' check (direction in ('spend','save','repay','none')),
  status            text not null default 'active' check (status in ('active','done','archived')),
  is_free           boolean not null default false,
  currency          char(3) not null default 'UAH',
  starts_on         date,
  ends_on           date,
  target_minor      bigint,
  monthly_minor     bigint,
  buffer_pct        numeric(5,2),
  counterparty      text,
  source_project_id uuid references projects(id) on delete set null,
  owner_id          uuid references profiles(id),
  sort_order        int not null default 100,
  pinned            boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz
);

-- «Вільні гроші» — рівно один живий на дім
create unique index if not exists projects_one_free
  on projects (household_id) where is_free and deleted_at is null;
create index if not exists projects_household_idx on projects (household_id);

alter table projects enable row level security;
drop policy if exists projects_select on projects;
drop policy if exists projects_insert on projects;
drop policy if exists projects_update on projects;
drop policy if exists projects_delete on projects;
create policy projects_select on projects for select to authenticated
  using (household_id = my_household_id());
create policy projects_insert on projects for insert to authenticated
  with check (household_id = my_household_id());
create policy projects_update on projects for update to authenticated
  using (household_id = my_household_id()) with check (household_id = my_household_id());
create policy projects_delete on projects for delete to authenticated
  using (household_id = my_household_id());

drop trigger if exists projects_touch on projects;
create trigger projects_touch before update on projects
  for each row execute function public.touch_updated_at();

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'projects'
  ) then
    alter publication supabase_realtime add table public.projects;
  end if;
end $$;
alter table projects replica identity full;

-- ----------------------------------------------------- нові посилання -------
alter table entries         add column if not exists project_id uuid references projects(id);
alter table entries         add column if not exists from_project_id uuid references projects(id);
alter table occurrences     add column if not exists project_id uuid references projects(id);
alter table recurring_plans add column if not exists project_id uuid references projects(id);
alter table recurring_plans add column if not exists flow text not null default 'out';
alter table tasks           add column if not exists project_id uuid references projects(id) on delete set null;
alter table task_templates  add column if not exists project_id uuid references projects(id) on delete set null;
alter table shopping_trips  add column if not exists project_id uuid references projects(id);

create index if not exists entries_project_idx     on entries (household_id, project_id);
create index if not exists occurrences_project_idx on occurrences (household_id, project_id);
create index if not exists tasks_project_idx       on tasks (household_id, project_id);

-- конверт більше не обовʼязковий: нові рядки його не мають
alter table occurrences     alter column envelope_id drop not null;
alter table recurring_plans alter column envelope_id drop not null;

-- ------------------------------------------------------ вид запису ----------
-- enum entry_kind не вміє нових значень у тій самій транзакції, де ними
-- користуються, тож колонка стає текстом із перевіркою.
alter table entries drop constraint if exists entries_check;
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'entries' and column_name = 'kind'
      and data_type <> 'text'
  ) then
    alter table entries alter column kind type text using kind::text;
  end if;
end $$;

-- ------------------------------------------------ перенесення даних ---------
do $$
declare
  h record;
  free_id uuid;
begin
  for h in select id from households loop
    if exists (select 1 from projects where household_id = h.id) then
      continue;
    end if;

    insert into projects (household_id, name, direction, is_free, sort_order)
    values (h.id, 'Вільні гроші', 'none', true, 0)
    returning id into free_id;

    -- Конверти, крім доходу → проєкти «витрачати». Орієнтир — останній план.
    -- Накопичувальні, заощадження й борги в архів: їхню роль тепер виконують
    -- проєкти з фондів і боргів, а записи за минуле лишаються на місці.
    insert into projects (id, household_id, name, direction, status, owner_id, sort_order, monthly_minor, deleted_at)
    select e.id, e.household_id, e.name, 'spend',
           case when e.is_archived or e.kind in ('sinking','savings','debt') then 'archived' else 'active' end,
           e.owner_id, 100 + e.sort_order,
           (select pl.planned_minor from plan_lines pl
             where pl.envelope_id = e.id and pl.planned_minor > 0
             order by pl.period_month desc limit 1),
           e.deleted_at
      from envelopes e
     where e.household_id = h.id and e.kind <> 'income';

    insert into projects (id, household_id, name, direction, status, currency, ends_on,
                          target_minor, monthly_minor, buffer_pct, sort_order, deleted_at)
    select f.id, f.household_id, f.name, 'save',
           case when f.is_archived then 'archived' else 'active' end,
           f.currency, f.due_date, f.target_amount_minor, f.monthly_fixed_minor,
           nullif(f.buffer_pct, 0), 300 + f.priority, f.deleted_at
      from funds f
     where f.household_id = h.id;

    insert into projects (id, household_id, name, direction, status, currency, starts_on, ends_on,
                          target_minor, monthly_minor, counterparty, sort_order, deleted_at)
    select d.id, d.household_id, d.name, 'repay',
           case when d.closed_on is not null then 'done' else 'active' end,
           d.currency, d.opened_on, d.target_date, d.principal_minor,
           d.monthly_payment_minor, d.counterparty, 500 + d.order_index, d.deleted_at
      from debts d
     where d.household_id = h.id;

    -- Правила: фонд і борг важать більше за конверт — саме вони кажуть,
    -- що платіж робить із грошима. Дохідний конверт → надходження у вільні.
    update recurring_plans rp
       set project_id = coalesce(rp.fund_id, rp.debt_id,
             case when env.kind = 'income' then free_id else rp.envelope_id end),
           flow = case when env.kind = 'income' then 'in' else 'out' end
      from envelopes env
     where rp.household_id = h.id and rp.project_id is null and env.id = rp.envelope_id;

    -- Витрата, фінансована фондом, була парою «витрата + fund_out».
    -- Тепер це одна витрата проєкту-фонду: вона й зменшує його баланс.
    update entries x
       set project_id = fo.fund_id
      from entries fo
     where x.household_id = h.id and fo.household_id = h.id
       and x.kind = 'expense' and fo.kind = 'fund_out'
       and fo.occurrence_id is not null and fo.occurrence_id = x.occurrence_id;
    update entries fo
       set deleted_at = now()
     where fo.household_id = h.id and fo.kind = 'fund_out' and fo.occurrence_id is not null
       and exists (select 1 from entries x
                    where x.occurrence_id = fo.occurrence_id and x.kind = 'expense' and x.id <> fo.id);

    update entries set project_id = free_id
     where household_id = h.id and kind = 'income' and project_id is null;
    update entries set kind = 'transfer', project_id = fund_id, from_project_id = free_id
     where household_id = h.id and kind = 'fund_in';
    update entries set kind = 'expense', project_id = fund_id
     where household_id = h.id and kind = 'fund_out';
    update entries set kind = 'repay', project_id = debt_id
     where household_id = h.id and kind in ('debt_payment','debt_adjustment');
    update entries x set project_id = x.envelope_id
      from envelopes env
     where x.household_id = h.id and x.kind = 'expense' and x.project_id is null
       and env.id = x.envelope_id and env.kind <> 'income';

    -- Згенеровані внески у фонди більше не існують: поповнення робить людина.
    -- Оплачені лишаються історією.
    update occurrences set deleted_at = now()
     where household_id = h.id and fund_id is not null
       and status in ('due','projected') and deleted_at is null;

    update occurrences o
       set project_id = coalesce(
             (select rp.project_id from recurring_plans rp where rp.id = o.recurring_plan_id),
             o.fund_id,
             (select case when env.kind = 'income' then free_id else env.id end
                from envelopes env where env.id = o.envelope_id))
     where o.household_id = h.id and o.project_id is null;

    update shopping_trips t
       set project_id = (select x.project_id from entries x where x.trip_id = t.id and x.project_id is not null limit 1)
     where t.household_id = h.id and t.project_id is null;
  end loop;
end $$;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'entries_kind_check') then
    alter table entries add constraint entries_kind_check
      check (kind in ('income','expense','transfer','repay'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'recurring_plans_flow_check') then
    alter table recurring_plans add constraint recurring_plans_flow_check
      check (flow in ('in','out'));
  end if;
end $$;

-- ------------------------------------------------ новий дім ----------------
-- Замість стартових конвертів — «Вільні гроші» і кілька проєктів «витрачати».
create or replace function public.create_household(p_name text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  h uuid;
begin
  if auth.uid() is null then
    raise exception 'Спершу треба увійти';
  end if;
  if my_household_id() is not null then
    raise exception 'Ви вже в домі';
  end if;

  insert into households (name)
  values (coalesce(nullif(btrim(p_name), ''), 'Наша сім''я'))
  returning id into h;

  insert into household_members (household_id, profile_id)
  values (h, auth.uid());

  insert into projects (household_id, name, direction, is_free, sort_order)
  values (h, 'Вільні гроші', 'none', true, 0);

  insert into projects (household_id, name, direction, sort_order) values
    (h, 'Житло',              'spend', 10),
    (h, 'Звʼязок і підписки', 'spend', 20),
    (h, 'Продукти',           'spend', 30),
    (h, 'Транспорт',          'spend', 40),
    (h, 'Дім і побут',        'spend', 50),
    (h, 'Здоровʼя',           'spend', 60),
    (h, 'Розваги',            'spend', 70);

  return h;
end;
$$;

revoke all on function public.create_household(text) from public;
grant execute on function public.create_household(text) to authenticated;

-- ПЕРЕВІРКА:
--   select direction, status, count(*) from projects group by 1, 2 order by 1, 2;
--   select kind, count(*) from entries where deleted_at is null group by 1;   -- лише income/expense/transfer/repay
--   select count(*) from entries where kind <> 'income' and kind <> 'transfer' and project_id is null and deleted_at is null;  -- 0
--   select count(*) from occurrences where project_id is null and deleted_at is null;  -- 0
