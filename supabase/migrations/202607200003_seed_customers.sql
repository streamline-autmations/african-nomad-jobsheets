-- Seed initial customers for the Job Sheet app. customers.name has no unique
-- constraint (unlike companies.name), so guard each insert with NOT EXISTS
-- to keep this migration safely re-runnable.
--
-- Sibanye Stillwater mine/site customers are named "Sibanye Stillwater <site>"
-- deliberately — feeCalculations.ts matches any customer name that STARTS
-- WITH "Sibanye Stillwater" (case-insensitive) for the 2.5% invoice discount,
-- so every mine below automatically qualifies. Do not rename these off that
-- prefix without updating that matching logic too.
insert into public.customers (name)
select v.name
from (
  values
    ('Sibanye Stillwater'),
    ('Sibanye Stillwater East 3'),
    ('Sibanye Stillwater Kloof'),
    ('Sibanye Stillwater Driefontein'),
    ('Sibanye Stillwater Beatrix'),
    ('Harmony'),
    ('Harmony Kusasalethu'),
    ('Harmony Doornkop'),
    ('Harmony Masimong'),
    ('Harmony Tshepong')
) as v(name)
where not exists (
  select 1 from public.customers c where c.name = v.name
);
