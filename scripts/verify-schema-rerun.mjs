/**
 * Verifies that supabase/schema.sql and every migration can be applied in ANY
 * order, and re-applied any number of times, against a REAL PostgreSQL.
 *
 * Regression guard for:
 *   Failed to run sql query: ERROR: 42P16: cannot drop columns from view
 *
 * `create or replace view` refuses to drop columns the installed view already
 * has, so re-running supabase/schema.sql on a database that had picked up
 * feedback_rating/feedback_message/feedback_created_at (migration 0004/0006)
 * aborted the whole script. Every file here must therefore converge on the
 * same `student_profiles_full` shape instead of narrowing it.
 *
 * Uses PGlite (Postgres compiled to WASM) — there is no Postgres in CI.
 *
 *   node scripts/verify-schema-rerun.mjs      (npm run verify:schema)
 *
 * Exits non-zero if any check fails.
 */
import { PGlite } from '@electric-sql/pglite'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) =>
  // pgcrypto is preinstalled on Supabase; PGlite ships no such extension file.
  fs.readFileSync(path.join(REPO, p), 'utf-8').replace(/create extension if not exists "pgcrypto";/gi, '')

const SCHEMA = 'supabase/schema.sql'
const M = (n) => `supabase/migrations/${n}`
const M02 = M('0002_profile_avatar_and_full_view.sql')
const M03 = M('0003_profile_prn.sql')
const M04 = M('0004_feedback_submissions.sql')
const M05 = M('0005_help_requests.sql')
const M06 = M('0006_admin_attempted_and_stats.sql')
const M07 = M('0007_egress_query_hardening.sql')

/** The one shape every file must converge on (migration 0006 / schema.sql). */
const CANONICAL_VIEW = [
  'student_id', 'email', 'role', 'full_name', 'prn', 'phone', 'dob', 'gender',
  'degree', 'college', 'institution_id', 'graduation_year', 'cgpa', 'skills',
  'linkedin_url', 'github_url', 'ai_avatar', 'profile_created_at',
  'profile_updated_at', 'resume_id', 'resume_storage_key', 'resume_score',
  'resume_parsed', 'resume_feedback', 'resume_created_at',
  'assessment_session_id', 'talent_score', 'grade', 'percentile',
  'assessment_scores', 'assessment_ai_feedback', 'verifiable_hash',
  'report_storage_key', 'assessment_created_at', 'assessment_attempted',
  'feedback_rating', 'feedback_message', 'feedback_created_at',
]
const ADMIN_STATS = ['total_students', 'assessed_students', 'scored_students', 'avg_score', 'colleges']
const PROBE = [
  'profiles_count', 'results_count', 'resumes_count', 'sessions_count', 'feedback_count',
  'profiles_stamp', 'results_stamp', 'resumes_stamp', 'sessions_stamp', 'feedback_stamp',
]

/* ------------------------------------------------------------------ */

async function boot() {
  const db = await PGlite.create()
  // Supabase platform stubs: auth schema + auth.uid(), storage schema.
  await db.exec(`
    create schema if not exists auth;
    create table auth.users (
      id uuid primary key default gen_random_uuid(),
      email text,
      raw_user_meta_data jsonb default '{}'::jsonb,
      email_confirmed_at timestamptz,
      last_sign_in_at timestamptz,
      created_at timestamptz default now()
    );
    create or replace function auth.uid() returns uuid
      language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin;
    create schema if not exists storage;
    create table storage.buckets (id text primary key, name text, public boolean default false);
    create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
    alter table storage.objects enable row level security;
    create or replace function storage.foldername(name text) returns text[]
      language sql immutable as $fn$ select string_to_array(name, '/') $fn$;
  `)
  return db
}

async function columns(db, relation) {
  const res = await db.query(
    `select column_name
       from information_schema.columns
      where table_schema = 'public' and table_name = $1
      order by ordinal_position`,
    [relation],
  )
  return res.rows.map((r) => r.column_name)
}

let failures = 0
let checks = 0
const fail = (msg) => { failures++; console.log(`  ✗ ${msg}`) }
const pass = (msg) => { checks++; console.log(`  ✓ ${msg}`) }

/**
 * Applies `steps` in order to a fresh database, then asserts nothing errored
 * and the three export views have the expected shape. A step is either a repo
 * path to a .sql file or `{ name, sql }` for an inline statement.
 */
async function scenario(name, files, opts = {}) {
  // `null` means "this relation must NOT exist at this point".
  const expectView = opts.view === undefined ? CANONICAL_VIEW : opts.view
  const expectStats = opts.stats === undefined ? ADMIN_STATS : opts.stats
  const expectProbe = opts.probe === undefined ? PROBE : opts.probe
  console.log(`\n${name}`)
  const db = await boot()
  for (const step of files) {
    const label = typeof step === 'string' ? path.basename(step) : step.name
    try {
      await db.exec(typeof step === 'string' ? read(step) : step.sql)
    } catch (err) {
      fail(`${label} → ${String(err.message || err).split('\n')[0]}`)
      return
    }
  }
  pass(`${files.length} step(s) applied without error`)

  const shape = async (relation, expected, label) => {
    const cols = await columns(db, relation)
    if (expected === null) {
      return cols.length === 0
        ? pass(`${relation} is absent, as expected here`)
        : fail(`${relation} still exists (${cols.length} cols) but should have been dropped`)
    }
    if (cols.join(',') !== expected.join(',')) {
      const missing = expected.filter((c) => !cols.includes(c))
      const extra = cols.filter((c) => !expected.includes(c))
      return fail(`${label} is ${cols.length} cols, expected ${expected.length}`
        + (missing.length ? ` (missing: ${missing.join(', ')})` : '')
        + (extra.length ? ` (unexpected: ${extra.join(', ')})` : ''))
    }
    pass(`${label} has all ${expected.length} columns in order`)
  }

  await shape('student_profiles_full', expectView, 'student_profiles_full')
  await shape('admin_stats', expectStats, 'admin_stats')
  await shape('admin_change_probe', expectProbe, 'admin_change_probe')

  if (expectStats === null) return
  // The views must actually be readable end to end.
  const statsRow = await db.query('select * from public.admin_stats')
  statsRow.rows.length === 1
    ? pass('select * from admin_stats returns one row')
    : fail(`select * from admin_stats returned ${statsRow.rows.length} rows`)
}

// 0002/0003 only alter tables that schema.sql creates (there is no standalone
// 0001), so the base schema always comes first.
const ALL_MIGRATIONS = [M02, M03, M04, M05, M06, M07]
const LATER_MIGRATIONS = [M04, M05, M06, M07]

// 1. The documented fresh-project path, and re-running it.
await scenario('1. schema.sql on a fresh project, applied three times', [SCHEMA, SCHEMA, SCHEMA])

// 2. The failing report: migrations first, then schema.sql again.
await scenario('2. base + 0004..0007, then schema.sql re-applied (the reported failure)', [
  SCHEMA, ...LATER_MIGRATIONS, SCHEMA, SCHEMA,
])

// 3. schema.sql first (README's fresh path), then the migrations, then all of
//    it again — the order scripts/verify-student-report.mjs uses.
await scenario('3. schema.sql then migrations, everything twice', [
  SCHEMA, ...ALL_MIGRATIONS, SCHEMA, ...ALL_MIGRATIONS,
])

// 4. Re-running a single early migration must not narrow the installed view.
await scenario('4. full chain, then 0002 / 0003 / 0004 re-run on their own', [
  SCHEMA, ...ALL_MIGRATIONS, M02, M03, M04,
])

// 5. Everything in reverse: the newest migrations first, the oldest last.
await scenario('5. reverse order — 0007, 0006, 0005, 0004, 0003, 0002 on top of schema.sql', [
  SCHEMA, M07, M06, M05, M04, M03, M02,
])

// 6. Only part of the chain: schema.sql + 0004 (feedback columns, and the
//    original report's second failing shape).
await scenario('6. schema.sql + 0004, then schema.sql again', [SCHEMA, M04, SCHEMA])

// 7. Rebuild the view from scratch through the migrations: this is the only
//    path that executes the CREATE VIEW branch inside 0002 / 0003 / 0004.
await scenario('7. view dropped, then rebuilt by 0002 → 0003 → 0004 → 0006 → 0007', [
  SCHEMA,
  {
    name: 'drop the export views (simulate a pre-0002 database)',
    sql: 'drop view if exists public.admin_stats; drop view if exists public.student_profiles_full cascade;',
  },
  M02, M03, M04, M05, M06, M07,
])

// 8. A database left in the shape an earlier copy of 0004 produced (feedback
//    columns but no assessment_attempted) is widened by re-running 0004 alone.
const LEGACY_VIEW_COLS = CANONICAL_VIEW.filter((c) => c !== 'assessment_attempted').join(', ')
const legacyShape = {
  name: 'recreate the view without assessment_attempted (old 0004 shape)',
  sql: `drop view if exists public.admin_stats;
        alter view public.student_profiles_full rename to _spf_legacy;
        create view public.student_profiles_full with (security_invoker = on)
          as select ${LEGACY_VIEW_COLS} from public._spf_legacy;`,
}
await scenario('8. pre-fix 0004 shape (37 cols) rebuilt by 0004 on its own',
  [SCHEMA, legacyShape, M04],
  { stats: null },   // 0004's cascade dropped admin_stats; 0006 re-creates it
)

// 9. …and the same starting point converges once the rest of the chain runs.
await scenario('9. pre-fix 0004 shape, then 0004 → 0006 → 0007', [
  SCHEMA,
  legacyShape,
  M04,
  { name: 'drop the legacy stand-in view', sql: 'drop view if exists public._spf_legacy;' },
  M06,
  M07,
])

console.log(`\n${checks} checks passed, ${failures} failed`)
if (failures) process.exit(1)
