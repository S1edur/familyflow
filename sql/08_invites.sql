-- ============================================================================
-- FAMILY HUB — запрошення: створення коду і приєднання за ним
--
-- Виконувати ПІСЛЯ 01–07. Ідемпотентний.
--
-- ЧОМУ ЦЕ ОКРЕМИЙ ФАЙЛ. У 02_rls.sql политика invites_update посилається на
-- RPC accept_invite(), але самої функції в схемі не було. Без неї приєднатись
-- за кодом неможливо в принципі: invites_select вимагає household_id =
-- my_household_id(), а той, хто приєднується, ще НЕ в домі — тож він не може
-- навіть прочитати запрошення, щоб дізнатись, куди йому йти.
--
-- Обидві функції security definer: вони мусять бачити рядок, якого RLS
-- викликачу не показує. Тому всі перевірки — всередині них.
-- ============================================================================

-- --------------------------------------------------------- СТВОРЕННЯ --
create or replace function public.create_invite()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  h uuid;
  c text;
  tries int := 0;
begin
  h := my_household_id();
  if h is null then
    raise exception 'Спершу треба створити дім';
  end if;

  -- 8 шістнадцяткових символів: алфавіт без пар, які плутають на слух
  -- (немає ні O проти 0, ні I проти 1). 16^8 ≈ 4,3 млрд комбінацій.
  loop
    c := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    exit when not exists (select 1 from household_invites where code = c);
    tries := tries + 1;
    if tries > 10 then raise exception 'Не вдалось згенерувати код'; end if;
  end loop;

  insert into household_invites (household_id, code, created_by)
  values (h, c, auth.uid());

  return c;
end;
$$;

revoke all on function public.create_invite() from public;
grant execute on function public.create_invite() to authenticated;

-- ------------------------------------------------------- ПРИЄДНАННЯ --
create or replace function public.accept_invite(p_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  inv household_invites%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Спершу треба увійти';
  end if;

  -- одна людина — один дім: my_household_id() бере limit 1, і два доми
  -- зробили б її відповідь випадковою
  if my_household_id() is not null then
    raise exception 'Ви вже в домі';
  end if;

  select * into inv from household_invites
   where code = upper(trim(p_code));

  if not found then
    raise exception 'Код не знайдено';
  end if;
  if inv.used_at is not null then
    raise exception 'Код уже використано';
  end if;
  if inv.expires_at < now() then
    raise exception 'Термін дії коду минув';
  end if;

  insert into household_members (household_id, profile_id)
  values (inv.household_id, auth.uid())
  on conflict do nothing;

  -- позначаємо використаним ТІЛЬКИ після вдалого додавання, і лише якщо
  -- він досі вільний: інакше двоє, що ввели код одночасно, обидва пройдуть
  update household_invites
     set used_by = auth.uid(), used_at = now()
   where id = inv.id and used_at is null;

  if not found then
    raise exception 'Код щойно використали';
  end if;

  return inv.household_id;
end;
$$;

revoke all on function public.accept_invite(text) from public;
grant execute on function public.accept_invite(text) to authenticated;

-- ============================================================================
-- ПЕРЕВІРКА: обидві функції мають зʼявитись у списку
--
--   select p.proname, p.prosecdef as "security definer"
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.proname in ('create_invite','accept_invite');
-- ============================================================================
