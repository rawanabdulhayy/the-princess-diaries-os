# Princess Diaries OS — Setup

Three files, same pattern as your work monitor:

- `princess-os.html` — the app shell (open this)
- `app.js` — all the logic; must sit in the **same folder** as the HTML file
- `princess-os-supabase-schema.sql` — run once in a **new, separate** Supabase project

## 1. Create the Supabase project

This is intentionally a brand-new project, isolated from your work monitor's database.

1. Go to supabase.com → New Project.
2. Once it's up, open the SQL Editor and paste in the entire contents of `princess-os-supabase-schema.sql`. Run it once.
   - This creates all tables (log entries + their sub-tables, inventory, planner templates/blocks/days, archive log), enables row-level security with an "allow all" policy (fine for a single-user app), and seeds:
     - your full exercise inventory, pulled from the Rehab/Workout Plan PDF
     - four day-planner templates, pulled from the four day-shapes in your voice note
3. Go to Project Settings → API. Copy the **Project URL** and the **anon public key**.

## 2. Connect the app to your project

Open `princess-os.html` in a text editor and find this block near the bottom:

```js
const SUPABASE_URL = 'YOUR_NEW_SUPABASE_PROJECT_URL';
const SUPABASE_ANON_KEY = 'YOUR_NEW_SUPABASE_ANON_KEY';
```

Paste in your real values. Save.

## 3. Run it

- **Locally**: just open `princess-os.html` in a browser (keep `app.js` next to it).
- **On Cloudflare Pages** (matching your other project): create a new Pages project, upload both `princess-os.html` and `app.js` to the same deploy folder. If you want it at a clean URL, you can rename `princess-os.html` to `index.html` before uploading — just don't rename `app.js`.

## What's in each tab

**Log** — your daily entries. Date, optional day-number, day-type (Home Workout / Stretching / Physical Therapy / Hair Wash / Off / Other), optional cycle-phase, a one-line headline, repeatable body-area updates, repeatable flare notes (symptom + suspected cause — kept separate from plain updates on purpose, since you flagged that causal reasoning as its own recurring move), newly-introduced items hard-linked to your inventory, a free-text journal box with zero structure imposed, and optional attachment links. Filter by day-type, cycle-phase, or flare-only.

**Inventory** — your living V1→V10+ exercise library, grouped by category. Add new variations any time, edit existing ones, or "retire" old ones without deleting them (so log entries that reference them keep working).

**Day Plan** — pick a saved template for any date, tweak the blocks freely for that day without touching the saved template, or start from a blank slate. Add new templates of your own.

**Archive** — your free-tier overflow plan:
- **Export Everything** downloads one JSON file with all your data.
- **Export & Clear a Date Range** lets you export older log entries, then — only after you confirm — delete them from the live database to keep it small. Inventory and planner templates are never touched by this.
- **Import** lets you load any exported JSON file back in, either to browse it read-only (no live connection) or to restore it into a database (best on a fresh/empty project, to avoid duplicating rows).

## A note on the cycle-phase field

It's a manual select on purpose — you specifically wanted room for irregular cycles, which the "Irregular" option covers. When something flares and you suspect it's not cycle-related, that's what the **flare notes** are for: log the symptom and whatever you suspect caused it (stress, new shoes, upped reps, etc.) as its own entry, separate from the cycle-phase tag.
