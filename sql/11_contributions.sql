-- ============================================================================
-- FAMILY HUB — внесок у фонд стає таким самим платежем, як рахунок
--
-- Виконувати ПІСЛЯ 01–10. Ідемпотентний.
--
-- ЧОМУ. Досі внесок у фонд не належав жодному конверту: у місяці його не
-- було видно, а конверти виду sinking і savings висіли в плані з вічним
-- нулем у факті. Виплата боргу при цьому конверт мала — тобто дві схожі
-- речі поводились по-різному, і це збивало з пантелику.
--
-- Тепер внесок породжує occurrence — ту саму сутність, що й рахунок. Отже
-- безкоштовно отримує: рядок у чеклісті місяця, рядок у списку задач,
-- виконавця, ротацію і підтвердження в один тап.
-- ============================================================================

-- Куди лягає внесок і якого числа нагадувати
alter table funds add column if not exists envelope_id uuid references envelopes(id);
alter table funds add column if not exists contribution_day smallint
  check (contribution_day between 1 and 31);

comment on column funds.envelope_id is
  'Конверт, до якого належить внесок. NULL => внески не нагадуються.';
comment on column funds.contribution_day is
  'Число місяця для нагадування. NULL => перше.';

-- Платіж, який ПОПОВНЮЄ фонд.
-- Не плутати з recurring_plans.fund_id — там протилежний напрям:
-- «цей рахунок оплачується З фонду».
alter table occurrences add column if not exists fund_id uuid references funds(id) on delete set null;

comment on column occurrences.fund_id is
  'Фонд, який цей платіж поповнює (fund_in). Протилежне до recurring_plans.fund_id.';

create index if not exists occurrences_fund_idx on occurrences (household_id, fund_id);

-- ============================================================================
-- ПЕРЕВІРКА:
--   select column_name from information_schema.columns
--   where table_schema='public' and
--         ((table_name='funds' and column_name in ('envelope_id','contribution_day'))
--       or (table_name='occurrences' and column_name='fund_id'))
--   order by 1;
-- Має бути три рядки.
-- ============================================================================
