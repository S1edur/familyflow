-- ============================================================================
-- FAMILY HUB — створення дому однією операцією
--
-- Виконувати ПІСЛЯ 01–08. Ідемпотентний.
--
-- ЧОМУ RPC, А НЕ ТРИ ЗАПИТИ З КЛІЄНТА.
-- households_select каже: бачиш дім, якщо id = my_household_id(). А
-- my_household_id() читає household_members. Отже поки ти не учасник —
-- щойно створений тобою дім тобі НЕ видно, і insert().select() повертає 403.
--
-- Те саме стосується конвертів: їхня політика теж спирається на членство.
--
-- Тому все троє — дім, членство, стартові конверти — робиться тут, в одній
-- транзакції. Якщо щось упаде, не лишиться дому-сироти без учасника.
-- ============================================================================

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

  -- Стартові конверти під український побут. Це вміст 05_seed.sql, який
  -- не можна було виконати руками: там заглушка '<household>' замість
  -- ідентифікатора, бо дім існує тільки з цієї миті.
  insert into envelopes (household_id, name, kind, sort_order) values
    (h, 'Дохід',              'income',   0),
    (h, 'Оренда / іпотека',   'fixed',   10),
    (h, 'Комуналка',          'fixed',   20),
    (h, 'Інтернет і звʼязок', 'fixed',   30),
    (h, 'Підписки',           'fixed',   40),
    (h, 'Продукти',           'variable',50),
    (h, 'Транспорт / паливо', 'variable',60),
    (h, 'Побут і дім',        'variable',70),
    (h, 'Здоровʼя',           'variable',80),
    (h, 'Розваги',            'variable',90),
    (h, 'Нерегулярне',        'sinking', 100),
    (h, 'Накопичення',        'savings', 110),
    (h, 'Борги',              'debt',    120);

  return h;
end;
$$;

revoke all on function public.create_household(text) from public;
grant execute on function public.create_household(text) to authenticated;

-- ============================================================================
-- ПЕРЕВІРКА:
--   select proname, prosecdef from pg_proc p
--   join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public'
--     and proname in ('create_household','create_invite','accept_invite');
-- Має бути три рядки, у всіх prosecdef = true.
-- ============================================================================
