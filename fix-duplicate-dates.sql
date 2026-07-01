-- ============================================================
-- DUPLICATE-DATE RESOLUTION
-- Run this once, AFTER the main log import has completed successfully.
--
-- Background: 4 calendar dates ended up with two log_entries rows each.
-- All 4 trace back to genuine inconsistencies in the original source
-- text (typo'd dates, or two separate mentions of the same date with
-- different content) — NOT a duplicate import. Verified by inspecting
-- the actual journal content of each pair before writing this script.
--
-- Resolution rule (as decided):
--   - TRUE DUPLICATE (same/overlapping content, one side near-empty):
--     delete the empty/redundant row, keep the substantive one.
--   - DATE MISCALCULATION (genuinely different content, numbering
--     disagrees with itself): keep BOTH entries, but shift the second
--     one to the next calendar day and flag it as date-uncertain so
--     the app can visually mark it (dashed border) rather than hiding
--     the ambiguity.
-- ============================================================

begin;

-- ---------- 1. Add the uncertainty flag (safe if it already exists) ----------
alter table log_entries
  add column if not exists entry_date_uncertain boolean not null default false;

-- ---------- 2. 2025-09-07 → Day 13 / Day 14 ----------
-- Day 13 and Day 14 are clearly sequential, different workouts.
-- Day 14 was almost certainly meant to be logged as 2025-09-08.
-- Shift Day 14's date forward by one day and flag it uncertain.
update log_entries
set entry_date = '2025-09-08',
    entry_date_uncertain = true,
    updated_at = now()
where entry_date = '2025-09-07'
  and day_number = 14;

-- ---------- 3. 2025-11-22 → Day 86 / Day 89 ----------
-- Day 86 belongs to a multi-day "Off Days" range that legitimately
-- includes 11/22. Day 89 is a separate, later-numbered single-day
-- mention of the same calendar date with different (shorter) content —
-- a numbering slip in the original notes. Shift Day 89 forward one day.
update log_entries
set entry_date = '2025-11-23',
    entry_date_uncertain = true,
    updated_at = now()
where entry_date = '2025-11-22'
  and day_number = 89;

-- ---------- 4. 2025-12-28 → two "Off" entries, neither has a day_number ----------
-- Both are short multi-day-range fragments wrapped in different Week
-- headers ("Week (1)" vs "Week (2)"), so they're not the same note
-- duplicated — they're two distinct mentions of the same date from
-- overlapping off-period ranges in the source. Shift the SECOND one
-- (matched by its distinct journal text mentioning "Week (2)") forward
-- one day and flag it.
update log_entries
set entry_date = '2025-12-29',
    entry_date_uncertain = true,
    updated_at = now()
where entry_date = '2025-12-28'
  and journal like '%Week (2)%';

-- ---------- 5. 2026-03-04 → true duplicate (one row is just a stray '-') ----------
-- One row's entire journal is the single character '-' (a parsing
-- artifact with no real content); the other has the full substantive
-- entry. This is a genuine duplicate, not a miscalculation — delete
-- the empty one and keep the real one.
delete from log_entries
where entry_date = '2026-03-04'
  and journal = '-';

commit;

-- ============================================================
-- VERIFICATION — run these after the above to confirm the fix landed:
--
--   select count(*) from log_entries;
--   -- expect 271 (272 minus the one true duplicate that was deleted)
--
--   select entry_date, count(*) from log_entries
--   group by entry_date having count(*) > 1;
--   -- expect ZERO rows now
--
--   select entry_date, day_number, day_type, entry_date_uncertain
--   from log_entries where entry_date_uncertain = true
--   order by entry_date;
--   -- expect exactly 3 rows: 2025-09-08, 2025-11-23, 2025-12-29
-- ============================================================
