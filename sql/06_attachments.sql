-- ============================================================================
-- FAMILY HUB — зображення та файли (Supabase Storage)
-- Виконати після 03_functions.sql
--
-- Модель: один приватний бакет на все. Шлях завжди починається з household_id,
-- тому RLS на storage.objects — це одна перевірка першої папки.
--   шлях:  <household_id>/<uuid>.<ext>
-- ============================================================================

-- --------------------------------------------------------------- БАКЕТ --
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'family',
  'family',
  false,                                   -- приватний: доступ тільки через підписані URL
  26214400,                                -- 25 МБ на файл (ліміт трансформацій Supabase)
  array['image/jpeg','image/png','image/webp','image/avif','image/heic','image/gif','application/pdf']
)
on conflict (id) do nothing;

-- ------------------------------------------------------------ ТАБЛИЦЯ --
-- Універсальна: одне зображення може висіти на задачі, на витраті, на боргу,
-- або лежати просто в спільній галереї (entity_type = 'space').
create type attachment_entity as enum ('space','task','entry','occurrence','fund','debt','shopping_item');

create table attachments (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  storage_path text not null unique,       -- '<household_id>/<uuid>.jpg'
  file_name    text not null,
  mime_type    text not null,
  size_bytes   bigint not null,
  width        int,
  height       int,
  entity_type  attachment_entity not null default 'space',
  entity_id    uuid,                       -- null для 'space'
  album        text,                       -- вільна назва добірки в галереї
  caption      text,
  uploaded_by  uuid not null references profiles(id),
  created_at   timestamptz not null default now(),
  check ((entity_type = 'space' and entity_id is null)
      or (entity_type <> 'space' and entity_id is not null))
);
create index on attachments (household_id, entity_type, entity_id);
create index on attachments (household_id, created_at desc);

alter table attachments enable row level security;

create policy attachments_select on attachments for select to authenticated
  using (household_id = my_household_id());
create policy attachments_insert on attachments for insert to authenticated
  with check (household_id = my_household_id() and uploaded_by = auth.uid());
create policy attachments_update on attachments for update to authenticated
  using (household_id = my_household_id()) with check (household_id = my_household_id());
create policy attachments_delete on attachments for delete to authenticated
  using (household_id = my_household_id());

-- ------------------------------------------------- RLS НА САМІ ФАЙЛИ --
-- Перша папка у шляху має дорівнювати household_id користувача.
create policy family_objects_select on storage.objects for select to authenticated
  using (bucket_id = 'family'
         and (storage.foldername(name))[1] = my_household_id()::text);

create policy family_objects_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'family'
              and (storage.foldername(name))[1] = my_household_id()::text);

create policy family_objects_update on storage.objects for update to authenticated
  using (bucket_id = 'family'
         and (storage.foldername(name))[1] = my_household_id()::text)
  with check (bucket_id = 'family'
              and (storage.foldername(name))[1] = my_household_id()::text);

create policy family_objects_delete on storage.objects for delete to authenticated
  using (bucket_id = 'family'
         and (storage.foldername(name))[1] = my_household_id()::text);

-- ------------------------------------------------------------ ХЕЛПЕР --
-- Клієнт спершу заливає файл у storage, потім кличе це, щоб зареєструвати запис.
create or replace function public.register_attachment(
  p_path        text,
  p_file_name   text,
  p_mime        text,
  p_size        bigint,
  p_width       int  default null,
  p_height      int  default null,
  p_entity_type attachment_entity default 'space',
  p_entity_id   uuid default null,
  p_album       text default null,
  p_caption     text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare h uuid; aid uuid;
begin
  h := my_household_id();
  if h is null then raise exception 'no household'; end if;
  -- шлях мусить лежати в папці свого домогосподарства
  if split_part(p_path, '/', 1) <> h::text then
    raise exception 'path outside household folder';
  end if;

  insert into attachments (household_id, storage_path, file_name, mime_type, size_bytes,
                           width, height, entity_type, entity_id, album, caption, uploaded_by)
  values (h, p_path, p_file_name, p_mime, p_size,
          p_width, p_height, p_entity_type, p_entity_id, p_album, p_caption, auth.uid())
  returning id into aid;

  insert into change_log (household_id, entity, entity_id, summary, actor_id)
  values (h, 'attachment', aid, 'додано ' || p_file_name, auth.uid());

  return aid;
end;
$$;
grant execute on function public.register_attachment(text,text,text,bigint,int,int,attachment_entity,uuid,text,text) to authenticated;

-- Видалення запису має прибирати і сам файл — робимо це тригером через storage API
-- не можна, тому клієнт видаляє в два кроки: storage.remove() → delete from attachments.
-- Підстраховка: осиротілі файли шукаються цим запитом.
--   select o.name from storage.objects o
--   left join attachments a on a.storage_path = o.name
--   where o.bucket_id = 'family' and a.id is null;

-- ============================================================================
-- ПРИМІТКИ ДЛЯ КЛІЄНТА
-- 1. Мініатюри в сітці — через трансформації Supabase (тариф Pro):
--      supabase.storage.from('family').createSignedUrl(path, 3600, {
--        transform: { width: 400, height: 400, resize: 'cover' } })
--    Це рахується як 1 origin image незалежно від кількості розмірів,
--    і не з'їдає квоту egress так, як віддача оригіналів.
-- 2. Оригінал показуємо тільки у повноекранному перегляді.
-- 3. Підписані URL живуть 1 година — не кешувати їх у базі.
-- ============================================================================
