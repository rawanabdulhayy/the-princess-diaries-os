-- ============================================================
-- PRINCESS DIARIES OS — SUPABASE SCHEMA
-- A brand-new, separate Supabase project from your work monitor.
-- Run this entire file once in your Supabase SQL Editor.
-- ============================================================

-- ------------------------------------------------------------
-- 1. EXERCISE INVENTORY — your living V1→V10+ library
-- ------------------------------------------------------------
create table if not exists inventory_items (
  id            uuid primary key default gen_random_uuid(),
  category      text not null,           -- 'Calves & Feet','Neck','Shoulders & Back',
                                          -- 'Back & Core','Arms','Hips','Hamstrings',
                                          -- 'Quads','Glutes','Jaws', or a custom one you add
  version_tag   text not null default '', -- 'V1','V7``','V9`','V10', etc. — free text, your own notation
  name          text not null,
  cues          text not null default '', -- form notes / technique cues
  sets_reps     text not null default '', -- '3x10', '3x30 second-hold', '?' — free text, varies too much to constrain
  active        boolean not null default true, -- retire old variants without deleting history/links
  display_order integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists inventory_items_category_idx on inventory_items(category);

-- ------------------------------------------------------------
-- 2. LOG ENTRIES — one row per diary day
-- ------------------------------------------------------------
create table if not exists log_entries (
  id            uuid primary key default gen_random_uuid(),
  entry_date    date not null,
  day_number    integer,                  -- auto-suggested (max+1) but editable/overridable
  day_type      text not null default '', -- 'Home Workout' | 'Stretching' | 'Physical Therapy' |
                                           -- 'Hair Wash' | 'Off' | 'Other' | '' (blank allowed)
  day_type_custom text default null,      -- free text when day_type = 'Other'
  cycle_phase   text default null,        -- 'Follicular' | 'Ovulation' | 'Luteal' |
                                           -- 'Late Luteal/Menstrual' | 'Irregular' | null
  headline      text not null default '', -- the short "-> ..." summary line
  journal       text not null default '', -- the long free-text narrative, totally unstructured
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists log_entries_date_idx on log_entries(entry_date desc);

-- 2a. Body-area updates — repeatable per entry
create table if not exists log_body_updates (
  id            uuid primary key default gen_random_uuid(),
  log_id        uuid not null references log_entries(id) on delete cascade,
  area          text not null,           -- 'Feet & Calves','Knees','Shoulders','Back & Core',
                                          -- 'Hips','Jaw', or any custom area you type in
  note          text not null default '',
  display_order integer not null default 0
);
create index if not exists log_body_updates_log_id_idx on log_body_updates(log_id);

-- 2b. Flare notes — symptom + suspected cause(s), kept distinct from plain updates
create table if not exists log_flare_notes (
  id              uuid primary key default gen_random_uuid(),
  log_id          uuid not null references log_entries(id) on delete cascade,
  symptom         text not null default '',
  suspected_causes text not null default '', -- free text, can list multiple ("stress, new shoes, upped reps")
  area_link       uuid references log_body_updates(id) on delete set null, -- optional tie back to a body update
  display_order   integer not null default 0
);
create index if not exists log_flare_notes_log_id_idx on log_flare_notes(log_id);

-- 2c. Newly introduced — hard-linked to inventory items
create table if not exists log_newly_introduced (
  id              uuid primary key default gen_random_uuid(),
  log_id          uuid not null references log_entries(id) on delete cascade,
  inventory_id    uuid references inventory_items(id) on delete set null, -- nullable: item may get deleted later
  inventory_label_snapshot text default null, -- name captured at time of linking, survives inventory edits/deletes
  description     text not null default '',
  display_order   integer not null default 0
);
create index if not exists log_newly_introduced_log_id_idx on log_newly_introduced(log_id);

-- 2d. Attachments — link-outs (ChatGPT shares, photos, etc.)
create table if not exists log_attachments (
  id            uuid primary key default gen_random_uuid(),
  log_id        uuid not null references log_entries(id) on delete cascade,
  url           text not null,
  label         text default null,
  display_order integer not null default 0
);
create index if not exists log_attachments_log_id_idx on log_attachments(log_id);

-- ------------------------------------------------------------
-- 3. DAY-PLANNER TEMPLATES — reusable named day shapes
-- ------------------------------------------------------------
create table if not exists planner_templates (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,           -- 'Session Day A','Off/Stretch Day B', etc.
  description   text default null,
  display_order integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- 3a. Blocks within a template
create table if not exists planner_blocks (
  id            uuid primary key default gen_random_uuid(),
  template_id   uuid not null references planner_templates(id) on delete cascade,
  start_time    text not null default '', -- free text e.g. '8:00 AM' — avoids timezone fuss for a personal planner
  end_time      text not null default '',
  label         text not null default '',
  display_order integer not null default 0
);
create index if not exists planner_blocks_template_id_idx on planner_blocks(template_id);

-- 3b. Day-plan instances — picking a template (or freeform) for an actual date
create table if not exists planner_days (
  id            uuid primary key default gen_random_uuid(),
  plan_date     date not null,
  template_id   uuid references planner_templates(id) on delete set null,
  blocks_snapshot jsonb not null default '[]', -- editable copy of blocks for that specific day,
                                                -- so tweaking today doesn't alter the saved template
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index if not exists planner_days_date_idx on planner_days(plan_date);

-- ------------------------------------------------------------
-- 4. ARCHIVE LOG — audit trail of export/overflow-mitigation events
-- ------------------------------------------------------------
create table if not exists archive_log (
  id            uuid primary key default gen_random_uuid(),
  archived_from date not null,
  archived_to   date not null,
  row_count     integer not null default 0,
  note          text default null,
  created_at    timestamptz not null default now()
);

-- ============================================================
-- ROW LEVEL SECURITY
-- Single-user app: allow all operations with anon key.
-- Tighten this later if you ever add login / shared access.
-- ============================================================
alter table inventory_items      enable row level security;
alter table log_entries          enable row level security;
alter table log_body_updates     enable row level security;
alter table log_flare_notes      enable row level security;
alter table log_newly_introduced enable row level security;
alter table log_attachments      enable row level security;
alter table planner_templates    enable row level security;
alter table planner_blocks       enable row level security;
alter table planner_days         enable row level security;
alter table archive_log          enable row level security;

create policy "allow_all_inventory_items"      on inventory_items      for all using (true) with check (true);
create policy "allow_all_log_entries"          on log_entries          for all using (true) with check (true);
create policy "allow_all_log_body_updates"     on log_body_updates     for all using (true) with check (true);
create policy "allow_all_log_flare_notes"      on log_flare_notes      for all using (true) with check (true);
create policy "allow_all_log_newly_introduced" on log_newly_introduced for all using (true) with check (true);
create policy "allow_all_log_attachments"      on log_attachments      for all using (true) with check (true);
create policy "allow_all_planner_templates"    on planner_templates    for all using (true) with check (true);
create policy "allow_all_planner_blocks"       on planner_blocks       for all using (true) with check (true);
create policy "allow_all_planner_days"         on planner_days         for all using (true) with check (true);
create policy "allow_all_archive_log"          on archive_log          for all using (true) with check (true);

-- ============================================================
-- SEED — exercise inventory, extracted from your Rehab/Workout Plan PDF
-- ============================================================
insert into inventory_items (category, version_tag, name, cues, sets_reps, display_order) values
-- Calves & Feet
('Calves & Feet','V3','Toe Gripping Crumbled Tissue Paper / Towel Scrunching','V7`` update: forward grip and sideways twist','3x10',1),
('Calves & Feet','V2','Seated Calf Raises','V7`` update: both medial and lateral stances','3x12',2),
('Calves & Feet','V2','Single Standing Right Leg Balance','','3x30 second-hold',3),
('Calves & Feet','V2','Arch Hold','','?',4),
('Calves & Feet','V2','Feet Circles','','1x10',5),
('Calves & Feet','V2','4D Resistance','','3x10',6),
('Calves & Feet','V3','Laying Dorsi-flexion and Plantar Flexion Stretches','Calves and shins','',7),
-- Neck
('Neck','V1','2D Sideway Look-Overs','','',8),
('Neck','V1','2D Sideway 45°','','',9),
('Neck','V1','2D Diagonals 45°','','',10),
('Neck','V7`','Chin Tuck-Ins','','3x10',11),
('Neck','V7`','Hindi-Guy Nods','','3x10',12),
('Neck','V7`','Look-to-The-Sides','','3x10',13),
-- Shoulders & Back
('Shoulders & Back','V1','Arm Mobility Rolls','2D. Update: lumbrical engagement awareness','1x10',14),
('Shoulders & Back','V1','Arm Front Raises','Update: lumbrical engagement awareness','1x10',15),
('Shoulders & Back','V1','Arm Sideway Swipes','Update: lumbrical engagement awareness','1x10',16),
('Shoulders & Back','V1','Arm/Shoulders Overheads','Update: lumbrical engagement awareness','1x10x10',17),
('Shoulders & Back','V2','Standing Pink Long Standard Therapy Band (L/STB) Dynamic Shoulder Overheads','Plus static down/mid/upper holds — shoulder blades locked/back, flipped wrists extension, open chest','3x10',18),
('Shoulders & Back','V3','Shoulder External Rotations Stretch Holds','','',19),
('Shoulders & Back','V2','Neck/Chest Opener Stretch','Upper-back driven. V7`` update: triceps engagement','3x30 second-hold',20),
('Shoulders & Back','V9``','Shoulder Pinwheel','Unilateral','1x10',21),
('Shoulders & Back','V9``','Robot Man Dance','Unilateral','1x10',22),
('Shoulders & Back','V9``','Shoulder Dislocates','Isometric holds to start — front, up, back','',23),
-- Back & Core
('Back & Core','V2','Seated Pink Long Standard Therapy Band (L/STB) Stretches','Right dynamic + left static','3x10 / 3x30 second-hold',24),
('Back & Core','V2','Standing Lumbar Left Side Stretch','','',25),
('Back & Core','V3','Cow-Cat Stretch','','3x30 second-hold',26),
('Back & Core','V3','Superman''s','','3x30 second-hold',27),
('Back & Core','V4','Sideway Back Twist Stretch','From right to left','',28),
('Back & Core','V7','Bird Dog','Variation: legs-only / static kickback-alike','',29),
('Back & Core','V9`','Isolated Locust Pose','Iliac crest isolation, glutes maximus, posterior thigh/calves/soleus, abdominal external obliques','',30),
('Back & Core','V10','Dynamic Donkey Kicks','','2x3',31),
('Back & Core','V10','Dynamic Side Kicks','','2x3',32),
-- Arms
('Arms','V1','Wrist Circles','','1x10',33),
('Arms','V6','Lumbricals (Insides Together / Outsides Together)','L/STB','3x30 second-hold',34),
('Arms','V1','Elbow Circles','','1x10',35),
('Arms','V2','Static Cobra Pose','Bi/tri/chest/back-driven','3x30 second-hold',36),
('Arms','V5','Progression — Static Cobra Pose','','',37),
('Arms','V2','Dynamic Cobra Pose','','3x10',38),
('Arms','V4','Static Wrist and Elbow Stretch','','3x30 second-hold',39),
-- Hips
('Hips','V1','2D Controlled Hip Circles','','1x10',40),
('Hips','V2','Laying 90/90 Hip Openers','Internal and external rotation','',41),
('Hips','V2','Back-lying Clamshells','Abduction and adduction','3x10',42),
('Hips','V5','Easing Into — Child''s Pose','','',43),
('Hips','V8','Back-lying Butterfly Pose','','',44),
-- Hamstrings
('Hamstrings','V2','Seated Forward Fold','Knee straightened, feet dorsi-flexed','',45),
('Hamstrings','V2','Knee Flexion / Extension','Flexion strengthens hamstrings for bending the knee toward the buttock; extension strengthens quads to straighten the leg and stabilize the kneecap','',46),
('Hamstrings','V7``','Internal Hip Rotation','Knees pressing into a ball/block/box','3x10',47),
('Hamstrings','V8','Single Knee-to-Chest','','3x30 second-hold',48),
-- Quads
('Quads','V2','Straight Leg Raises','','3x10',49),
('Quads','V2','Knee Flexion / Extension','Same as hamstrings entry — strengthens both hamstrings and quads depending on direction','',50),
('Quads','V3','Step-ups','Back and neck straight, upward movement, quad/ham/glutes engagement','',51),
('Quads','V7','Step-Ups/Downs + Other Leg Knee-Raise','','',52),
('Quads','V5','Wall-sit Squats','15° angle','3x30 second-hold',53),
('Quads','V7','Easing Into — Kneeling Squat','With a pillow + assisted kneel for balance','',54),
('Quads','V9','Lateral Step-ups','','',55),
-- Glutes
('Glutes','V2','Glute Bridges','Maximus','',56),
('Glutes','V3','Side-lying Clamshells','Medius','',57),
('Glutes','V4','Side-lying Leg Raises','Medius / lateral quads / lateral hams','',58),
('Glutes','V8','Back-lying Cross-Legged Glute Hug','Piriformis','3x30 second-hold',59),
-- Jaws
('Jaws','V10`','O','','',60),
('Jaws','V10`','A','','',61),
('Jaws','V10`','I','','',62),
('Jaws','V10`','Sideway O','Both sides','',63);

-- ============================================================
-- SEED — day-planner templates, derived from your four described day-types
-- ============================================================
insert into planner_templates (name, description, display_order) values
('Session Day — Wake 6', 'PT session day. Earlier wake-up, two work blocks before the session, full workout split across the day.', 1),
('Session Day — Wake 7', 'PT session day, later wake-up variant. Same session window, compressed morning.', 2),
('Off/Stretching Day — Wake 6', 'No PT session. Stretching split into three parts across the day, more open work hours.', 3),
('Off/Stretching Day — Wake 7', 'No PT session, later wake-up variant. Includes flexibility for meetings.', 4);

-- Blocks for Session Day — Wake 6
insert into planner_blocks (template_id, start_time, end_time, label, display_order)
select id, b.start_time, b.end_time, b.label, b.ord from planner_templates,
  (values
    ('6:00 AM','7:00 AM','Part 1 WO: Light Stretch + Feet Exercises',1),
    ('7:00 AM','7:30 AM','Breakfast',2),
    ('7:30 AM','8:00 AM','Change into workout clothes, pack bag, refill bottle',3),
    ('8:00 AM','10:00 AM','Pure Work Hours (5 min break every 30 min)',4),
    ('10:00 AM','11:00 AM','Part 2 WO: Abs and Side-Lying Glutes',5),
    ('11:00 AM','11:40 AM','Protein shake + banana, get dressed',6),
    ('11:40 AM','12:40 PM','Work Hour',7),
    ('12:40 PM','1:40 PM','Commuting',8),
    ('1:40 PM','2:00 PM','Changing + banana 2',9),
    ('2:00 PM','4:00 PM','Part 3 WO: Session',10),
    ('4:00 PM','4:20 PM','Changing + uber',11),
    ('4:30 PM','5:30 PM','Getting home',12),
    ('5:30 PM','6:00 PM','Changing and unwinding',13),
    ('6:00 PM','7:00 PM','Lunch + making a drink',14),
    ('7:00 PM','8:30 PM','Work Hour (follow-ups and mails)',15),
    ('8:30 PM','9:00 PM','Skincare',16),
    ('9:00 PM','9:45 PM','Stretching',17),
    ('9:00 PM','10:00 PM','Bed — stretch & breathe, then sleep',18)
  ) as b(start_time,end_time,label,ord)
where planner_templates.name='Session Day — Wake 6';

-- Blocks for Session Day — Wake 7
insert into planner_blocks (template_id, start_time, end_time, label, display_order)
select id, b.start_time, b.end_time, b.label, b.ord from planner_templates,
  (values
    ('7:00 AM','7:30 AM','Breakfast',1),
    ('7:30 AM','8:00 AM','Change into workout clothes, set up, pack bag, refill bottle',2),
    ('8:00 AM','10:00 AM','Pure Work Hours (5 min break every 30 min) + banana 1',3),
    ('10:00 AM','11:00 AM','Part 1 WO: Feet Exercises',4),
    ('11:00 AM','11:40 AM','Work Hour',5),
    ('11:40 AM','12:40 PM','Part 2 WO: Abs and Side-Lying Glutes + get dressed + protein shake',6),
    ('12:40 PM','1:40 PM','Commuting',7),
    ('1:40 PM','2:00 PM','Changing',8),
    ('2:00 PM','4:00 PM','Part 3 WO: Session',9),
    ('4:00 PM','4:20 PM','Changing + uber',10),
    ('4:30 PM','5:30 PM','Getting home',11),
    ('5:30 PM','6:00 PM','Changing and unwinding',12),
    ('6:00 PM','7:00 PM','Lunch + making a drink',13),
    ('7:00 PM','8:30 PM','Work Hour (follow-ups and mails)',14),
    ('8:30 PM','9:00 PM','Skincare',15),
    ('9:00 PM','9:45 PM','Stretching',16)
  ) as b(start_time,end_time,label,ord)
where planner_templates.name='Session Day — Wake 7';

-- Blocks for Off/Stretching Day — Wake 6
insert into planner_blocks (template_id, start_time, end_time, label, display_order)
select id, b.start_time, b.end_time, b.label, b.ord from planner_templates,
  (values
    ('6:00 AM','7:00 AM','Part 1 Stretching: Upper Body',1),
    ('7:00 AM','7:30 AM','Breakfast',2),
    ('7:30 AM','8:00 AM','Change into workout clothes, pack bag, refill bottle',3),
    ('8:00 AM','10:00 AM','Pure Work Hours (5 min break every 30 min)',4),
    ('10:00 AM','11:00 AM','Part 2 Stretching: Qigong and bed-lying breathing',5),
    ('11:00 AM','11:20 AM','Protein shake + banana + a drink',6),
    ('11:20 AM','1:00 PM','Work Hour',7),
    ('1:00 PM','2:00 PM','Part 3 Stretching: Bed Stretching',8),
    ('2:00 PM','4:00 PM','Work Hour',9),
    ('4:00 PM','4:20 PM','Refreshments — a good stretch, a drink',10),
    ('4:30 PM','6:00 PM','Work Hour',11),
    ('6:00 PM','7:00 PM','Lunch + making a drink',12),
    ('7:00 PM','8:30 PM','Unwind, or Work Hour if needed',13),
    ('8:30 PM','9:00 PM','Skincare',14),
    ('9:00 PM','9:45 PM','Stretching',15)
  ) as b(start_time,end_time,label,ord)
where planner_templates.name='Off/Stretching Day — Wake 6';

-- Blocks for Off/Stretching Day — Wake 7
insert into planner_blocks (template_id, start_time, end_time, label, display_order)
select id, b.start_time, b.end_time, b.label, b.ord from planner_templates,
  (values
    ('7:00 AM','7:30 AM','Breakfast',1),
    ('7:30 AM','8:00 AM','Change into workout clothes, pack bag, refill bottle',2),
    ('8:00 AM','10:30 AM','Pure Work Hours (5 min break every 30 min)',3),
    ('10:30 AM','10:45 AM','Banana 1 + filler',4),
    ('10:45 AM','11:45 AM','Part 1 Stretching: Upper Body & Qigong',5),
    ('11:45 AM','12:45 PM','Work Hour',6),
    ('12:45 PM','1:00 PM','Protein shake + banana + a drink',7),
    ('1:00 PM','3:00 PM','Meeting (if any), otherwise Part 3 Stretching: Bed Stretching',8),
    ('3:00 PM','5:00 PM','Work hours (or Part 3 Stretching if it shifted earlier)',9),
    ('5:00 PM','6:30 PM','Lunch',10),
    ('7:00 PM','8:30 PM','Unwind, or Work Hour if needed',11),
    ('8:30 PM','9:00 PM','Skincare',12),
    ('9:00 PM','9:45 PM','Stretching',13)
  ) as b(start_time,end_time,label,ord)
where planner_templates.name='Off/Stretching Day — Wake 7';
