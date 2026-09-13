-- ============================================================================
-- FAMILY HUB — пуш-сповіщення
--
-- Виконувати ПІСЛЯ 01–11. Ідемпотентний: можна запускати повторно.
--
-- Дві таблиці:
--   push_subscriptions — куди слати: одна підписка = один браузер/телефон.
--   push_log           — що вже надіслано, щоб щоденний підсумок і «вам
--                        призначили» не приходили двічі.
--
-- Надсилає тільки сервер (Vercel, ключ service_role), тому push_log клієнту
-- не видно взагалі: RLS увімкнений, політик немає.
-- ============================================================================

create table if not exists public.push_subscriptions (
  endpoint    text primary key,
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now()
);

create index if not exists push_subscriptions_profile_idx
  on public.push_subscriptions (profile_id);

alter table public.push_subscriptions enable row level security;

-- Лише свої підписки. Політики дивляться на колонку, а не в інші таблиці —
-- рекурсії немає.
drop policy if exists push_subscriptions_select on public.push_subscriptions;
create policy push_subscriptions_select on public.push_subscriptions
  for select to authenticated using (profile_id = auth.uid());

drop policy if exists push_subscriptions_delete on public.push_subscriptions;
create policy push_subscriptions_delete on public.push_subscriptions
  for delete to authenticated using (profile_id = auth.uid());

-- Вставка — лише через save_push_subscription(). Прямий upsert ламається,
-- коли на тому самому пристрої раніше був інший акаунт: рядок із цим
-- endpoint належить йому, і RLS не дасть його перезаписати.
create or replace function public.save_push_subscription(
  p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Спершу треба увійти';
  end if;
  delete from push_subscriptions where endpoint = p_endpoint;
  insert into push_subscriptions (endpoint, profile_id, p256dh, auth, user_agent)
  values (p_endpoint, auth.uid(), p_p256dh, p_auth, p_user_agent);
end;
$$;

revoke all on function public.save_push_subscription(text, text, text, text) from public;
grant execute on function public.save_push_subscription(text, text, text, text) to authenticated;

create table if not exists public.push_log (
  key      text primary key,
  sent_at  timestamptz not null default now()
);

alter table public.push_log enable row level security;
-- політик немає навмисно: тільки service_role
