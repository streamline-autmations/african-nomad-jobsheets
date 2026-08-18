-- Migrated from the standalone Sourcing Engine repo on 2026-08-06, when the
-- sourcing tables moved into this project (`wnsjzxotknadqvznnijw`, "QuickBooks")
-- so job sheets and sourcing share one database. Original file: 202606270002_seed_more_suppliers.sql
--
-- Replayed in the original order rather than squashed, so the RLS history stays
-- readable. Verified before applying: the sourcing schema is disjoint from the
-- job-sheet schema -- no shared table, type or function names -- and nothing
-- here grants or revokes anything schema-wide.

-- Expand the supplier catalogue with the preferred SA retail + China import sources.
-- Idempotent: only inserts a supplier whose name does not already exist
-- (suppliers.name has no unique constraint, so we guard with NOT EXISTS).

insert into public.suppliers (name, category, website, location, preferred, lead_time, payment_terms, reliability_score, reliability_notes)
select v.name, v.category, v.website, v.location, v.preferred, v.lead_time, v.payment_terms, v.reliability_score, v.reliability_notes
from (values
  ('Builders Warehouse', 'Hardware & building', 'https://www.builders.co.za', 'National', true, '1-4 days', 'Card / account', 84, 'Strong for tools, hardware, building and DIY supplies.'),
  ('Game', 'General retail', 'https://www.game.co.za', 'National', true, '2-6 days', 'Card / EFT', 76, 'Broad general merchandise; good bulk availability.'),
  ('Yuppiechef', 'Kitchen & gifting', 'https://www.yuppiechef.com', 'National', true, '2-5 days', 'Card / EFT', 83, 'Premium kitchen, homeware and corporate gifting.'),
  ('Hirschs', 'Appliances & electronics', 'https://www.hirschs.co.za', 'National', true, '2-7 days', 'Card / account', 80, 'Appliances and electronics, in-store stock strong.'),
  ('Communica', 'Electronics & components', 'https://www.communica.co.za', 'National', true, '2-5 days', 'Card / EFT', 79, 'Electronic components, hobbyist and maker supplies.'),
  ('Everyshop', 'Retail marketplace', 'https://www.everyshop.co.za', 'National', false, '3-8 days', 'Card / EFT', 72, 'Takealot-group general retail; availability varies.'),
  ('BobShop', 'Online marketplace', 'https://www.bobshop.co.za', 'National', false, '3-10 days', 'Card / EFT', 65, 'Marketplace (ex-bidorbuy); seller quality varies, verify per listing.'),
  ('OneDayOnly', 'Deals & clearance', 'https://www.onedayonly.co.za', 'National', false, '3-10 days', 'Card / EFT', 68, 'Daily deals; great prices but stock is one-off and time-limited.'),
  ('WantItAll', 'Imports marketplace', 'https://www.wantitall.co.za', 'National (import)', false, '10-21 days', 'Card', 60, 'Imports US/Amazon catalogue; longer lead times and import costs.'),
  ('Alibaba', 'Bulk import (China)', 'https://www.alibaba.com', 'International (China)', false, '20-45 days', 'Trade Assurance / TT', 62, 'Best for high-volume bulk import; verify supplier rating and MOQ.'),
  ('Made-in-China', 'Bulk import (China)', 'https://www.made-in-china.com', 'International (China)', false, '20-45 days', 'TT / LC', 58, 'B2B bulk import; vet manufacturers carefully.'),
  ('1688', 'Bulk import (China domestic)', 'https://www.1688.com', 'International (China)', false, '25-50 days', 'Agent / TT', 55, 'Cheapest China-domestic prices; usually needs a sourcing agent.'),
  ('AliExpress', 'Small-batch import (China)', 'https://www.aliexpress.com', 'International (China)', false, '15-40 days', 'Card', 60, 'Good for samples and small quantities; per-unit cost higher than bulk.'),
  ('Temu', 'Low-cost import (China)', 'https://www.temu.com', 'International (China)', false, '10-25 days', 'Card', 52, 'Very cheap consumer goods; quality inconsistent, not for premium gifting.')
) as v(name, category, website, location, preferred, lead_time, payment_terms, reliability_score, reliability_notes)
where not exists (
  select 1 from public.suppliers s where lower(s.name) = lower(v.name)
);
