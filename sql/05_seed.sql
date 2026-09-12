-- ============================================================================
-- FAMILY HUB — стартові дані. Виконати ОДИН раз після реєстрації першого
-- користувача. Замінити :household на реальний uuid.
-- ============================================================================

-- 1) Створити домогосподарство і додати себе (виконується застосунком при онбордингу):
-- insert into households (name, base_currency) values ('Наша сім''я','UAH') returning id;
-- insert into household_members (household_id, profile_id) values ('<household>', auth.uid());

-- 2) Конверти під український побут
insert into envelopes (household_id, name, kind, sort_order) values
  ('<household>','Дохід',            'income',   0),
  ('<household>','Оренда / іпотека', 'fixed',   10),
  ('<household>','Комуналка',        'fixed',   20),
  ('<household>','Інтернет і зв''язок','fixed', 30),
  ('<household>','Підписки',         'fixed',   40),
  ('<household>','Продукти',         'variable',50),
  ('<household>','Транспорт / паливо','variable',60),
  ('<household>','Побут і дім',      'variable',70),
  ('<household>','Здоров''я',        'variable',80),
  ('<household>','Розваги',          'variable',90),
  ('<household>','Кишенькові — я',   'personal',100),
  ('<household>','Кишенькові — партнер','personal',110),
  ('<household>','Нерегулярне',      'sinking',120),
  ('<household>','Накопичення',      'savings',130),
  ('<household>','Борги',            'debt',   140);

-- 3) Типові регулярні платежі (приклад — 5 числа щомісяця)
-- insert into recurring_plans (household_id, name, envelope_id, expected_amount_minor,
--                              freq, bymonthday, amount_mode)
-- values ('<household>','Оренда','<envelope_rent>', 2500000, 'monthly', 5, 'fixed'),
--        ('<household>','Комуналка','<envelope_utils>', 180000, 'monthly', 20, 'variable');

-- 4) Типові фонди на нерегулярне
-- insert into funds (household_id, name, kind, target_amount_minor, due_date, buffer_pct) values
--   ('<household>','Страховка авто','sinking', 1400000, '2027-02-12', 5),
--   ('<household>','ТО авто',       'sinking',  800000, '2027-05-01', 10),
--   ('<household>','Подарунки',     'sinking',  600000, '2026-12-20', 0),
--   ('<household>','Відпустка',     'goal',    5000000, '2027-07-01', 5),
--   ('<household>','Подушка',       'emergency', null,  null,         0);

-- 5) Типові повторювані побутові задачі
-- insert into task_templates (household_id, title, area, effort, schedule_kind, interval_days) values
--   ('<household>','Пропилососити','Дім',2,'after_completion',7),
--   ('<household>','Змінити постіль','Дім',2,'after_completion',14),
--   ('<household>','Помити холодильник','Дім',3,'after_completion',60);
-- insert into task_templates (household_id, title, area, effort, schedule_kind, freq, byday) values
--   ('<household>','Винести сміття','Дім',1,'fixed','weekly','{2,5}');

-- 6) Курси валют (оновлювати раз на місяць вручну або через Edge Function)
-- insert into fx_rates (base_ccy, quote_ccy, rate_date, rate, source)
-- values ('USD','UAH', current_date, 41.5, 'manual'),
--        ('EUR','UAH', current_date, 45.0, 'manual');
