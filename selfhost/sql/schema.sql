-- PCB Checker: generated from drizzle/migrations. Do not edit by hand.
-- Regenerate: bun run schema:selfhost
-- Requires the Supabase auth/storage schemas and roles (not bare PostgreSQL).
-- Additive replay: final RLS policies are updated without dropping tables or data.
BEGIN;

-- ==== drizzle/migrations/0000_pcb_checker_foundation.sql
DO $schema$
BEGIN
  IF to_regtype('public.app_role') IS NULL THEN
    create type public.app_role as enum ('admin','series_manager','instructor','student','cam_tech');
  END IF;
END
$schema$;

DO $schema$
BEGIN
  IF to_regtype('public.project_variant') IS NULL THEN
    create type public.project_variant as enum ('SMT','THT');
  END IF;
END
$schema$;

CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid primary key,
  email text not null,
  full_name text,
  created_at timestamptz not null default now()
);

CREATE TABLE IF NOT EXISTS public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  role public.app_role not null,
  unique(user_id, role)
);

CREATE TABLE IF NOT EXISTS public.academic_years (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

CREATE TABLE IF NOT EXISTS public.series (
  id uuid primary key default gen_random_uuid(),
  academic_year_id uuid not null references public.academic_years(id) on delete cascade,
  name text not null,
  default_variant public.project_variant not null default 'SMT',
  is_archived boolean not null default false,
  created_at timestamptz not null default now()
);

CREATE TABLE IF NOT EXISTS public.series_managers (
  id uuid primary key default gen_random_uuid(),
  series_id uuid not null references public.series(id) on delete cascade,
  user_id uuid not null,
  unique(series_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.groups (
  id uuid primary key default gen_random_uuid(),
  series_id uuid not null references public.series(id) on delete cascade,
  name text not null,
  open_enrollment boolean not null default true,
  is_archived boolean not null default false,
  created_at timestamptz not null default now()
);

CREATE TABLE IF NOT EXISTS public.group_instructors (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null,
  unique(group_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.students (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique,
  group_id uuid not null references public.groups(id) on delete restrict,
  full_name text not null,
  email text,
  file_prefix text,
  variant public.project_variant not null default 'SMT',
  theme_name text,
  theme_number int,
  status text not null default 'pending' check (status in ('pending','approved')),
  created_at timestamptz not null default now()
);

CREATE TABLE IF NOT EXISTS public.submissions (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  user_id uuid not null,
  revision int not null default 1,
  kind text not null default 'SELF_CHECK' check (kind in ('SELF_CHECK','OFFICIAL')),
  zip_path text,
  file_name text,
  variant public.project_variant not null default 'SMT',
  drc_score numeric(5,2),
  blocking_count int not null default 0,
  report jsonb,
  review_status text not null default 'pending' check (review_status in ('pending','approved','rejected')),
  review_reason text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

CREATE TABLE IF NOT EXISTS public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid,
  action text not null,
  target_entity text,
  target_id uuid,
  details jsonb,
  created_at timestamptz not null default now()
);

grant select, insert, update, delete on public.profiles, public.user_roles, public.academic_years, public.series, public.series_managers, public.groups, public.group_instructors, public.students, public.submissions, public.audit_log to authenticated;

grant all on public.profiles, public.user_roles, public.academic_years, public.series, public.series_managers, public.groups, public.group_instructors, public.students, public.submissions, public.audit_log to service_role;

alter table public.profiles enable row level security;

alter table public.user_roles enable row level security;

alter table public.academic_years enable row level security;

alter table public.series enable row level security;

alter table public.series_managers enable row level security;

alter table public.groups enable row level security;

alter table public.group_instructors enable row level security;

alter table public.students enable row level security;

alter table public.submissions enable row level security;

alter table public.audit_log enable row level security;

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
$$;

create or replace function public.is_staff(_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _uid and role in ('admin','series_manager','instructor','cam_tech'))
$$;

create or replace function public.manages_series(_uid uuid, _series uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_role(_uid,'admin') or exists (select 1 from public.series_managers where user_id=_uid and series_id=_series)
$$;

create or replace function public.can_view_group(_uid uuid, _group uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_role(_uid,'admin')
    or exists (select 1 from public.group_instructors where user_id=_uid and group_id=_group)
    or exists (select 1 from public.groups g join public.series_managers sm on sm.series_id=g.series_id where g.id=_group and sm.user_id=_uid)
$$;

create or replace function public.can_manage_group(_uid uuid, _group uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_role(_uid,'admin')
    or exists (select 1 from public.groups g join public.series_managers sm on sm.series_id=g.series_id where g.id=_group and sm.user_id=_uid)
$$;

create or replace function public.ensure_profile()
returns setof public.app_role language plpgsql security definer set search_path = public as $$
declare
  _uid uuid := auth.uid();
  _email text := lower(coalesce(auth.jwt() ->> 'email',''));
  _name text := coalesce(auth.jwt() -> 'user_metadata' ->> 'full_name', auth.jwt() -> 'user_metadata' ->> 'name');
begin
  if _uid is null then raise exception 'not authenticated'; end if;
  if not (_email like '%@upb.ro' or _email like '%.upb.ro' or _email like '%@cetti.ro') then
    raise exception 'domain_not_allowed';
  end if;
  insert into public.profiles(id, email, full_name) values (_uid, _email, _name)
    on conflict (id) do update set email = excluded.email, full_name = coalesce(public.profiles.full_name, excluded.full_name);
  if not exists (select 1 from public.user_roles where role = 'admin') then
    insert into public.user_roles(user_id, role) values (_uid, 'admin') on conflict do nothing;
  elsif not exists (select 1 from public.user_roles where user_id = _uid) and _email like '%@student.upb.ro' then
    insert into public.user_roles(user_id, role) values (_uid, 'student') on conflict do nothing;
  end if;
  return query select role from public.user_roles where user_id = _uid;
end $$;

create or replace function public.set_role(_target uuid, _role public.app_role, _grant boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (public.has_role(auth.uid(),'admin')
      or (_role = 'instructor' and public.has_role(auth.uid(),'series_manager'))) then
    raise exception 'forbidden';
  end if;
  if _grant then
    insert into public.user_roles(user_id, role) values (_target, _role) on conflict do nothing;
  else
    if _target = auth.uid() and _role = 'admin' then raise exception 'cannot_remove_own_admin'; end if;
    delete from public.user_roles where user_id = _target and role = _role;
  end if;
  insert into public.audit_log(actor_id, action, target_entity, target_id, details)
    values (auth.uid(), 'ROLE_ASSIGNMENT', 'user', _target, jsonb_build_object('role', _role, 'grant', _grant));
end $$;

revoke execute on function public.ensure_profile() from public, anon;

revoke execute on function public.set_role(uuid, public.app_role, boolean) from public, anon;

grant execute on function public.ensure_profile() to authenticated;

grant execute on function public.set_role(uuid, public.app_role, boolean) to authenticated;

insert into public.academic_years(name) values ('2026-2027') ON CONFLICT (name) DO NOTHING;

-- ==== drizzle/migrations/0001_gradebook_and_cam.sql
ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS grade_schema numeric,
  ADD COLUMN IF NOT EXISTS grade_doc numeric,
  ADD COLUMN IF NOT EXISTS grade_final numeric,
  ADD COLUMN IF NOT EXISTS teacher_notes text;

COMMENT ON COLUMN public.students.grade_schema IS 'Manual column: protected during Google Sheets / Excel sync.';

COMMENT ON COLUMN public.students.grade_doc IS 'Manual column: protected during Google Sheets / Excel sync.';

COMMENT ON COLUMN public.students.grade_final IS 'Manual column: protected during Google Sheets / Excel sync.';

COMMENT ON COLUMN public.students.teacher_notes IS 'Manual column: protected during Google Sheets / Excel sync.';

CREATE TABLE IF NOT EXISTS public.sheet_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  series_id uuid NOT NULL REFERENCES public.series(id) ON DELETE CASCADE,
  spreadsheet_id text NOT NULL,
  sheet_name text NOT NULL DEFAULT 'CEF2-Proiect_Situatie',
  last_synced_at timestamptz,
  last_direction text,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (series_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sheet_links TO authenticated;

GRANT ALL ON public.sheet_links TO service_role;

ALTER TABLE public.sheet_links ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.cam_panels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  series_id uuid NOT NULL REFERENCES public.series(id) ON DELETE CASCADE,
  name text NOT NULL,
  cols integer NOT NULL DEFAULT 7,
  rows integer NOT NULL DEFAULT 6,
  pitch_mm numeric NOT NULL DEFAULT 40.508,
  slots jsonb NOT NULL DEFAULT '[]'::jsonb,
  zip_path text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.cam_panels TO authenticated;

GRANT ALL ON public.cam_panels TO service_role;

ALTER TABLE public.cam_panels ENABLE ROW LEVEL SECURITY;

-- ==== drizzle/migrations/0002_rules_settings_and_project_files.sql
CREATE TABLE IF NOT EXISTS public.drc_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  series_id uuid REFERENCES public.series(id) ON DELETE CASCADE,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS drc_settings_scope_uidx ON public.drc_settings (coalesce(series_id, '00000000-0000-0000-0000-000000000000'::uuid));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.drc_settings TO authenticated;

GRANT ALL ON public.drc_settings TO service_role;

ALTER TABLE public.drc_settings ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.project_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  folder text NOT NULL DEFAULT 'project' CHECK (folder IN ('fabrication','project')),
  file_path text NOT NULL,
  file_name text NOT NULL,
  mime_type text,
  size_bytes bigint,
  description text,
  points numeric,
  points_note text,
  points_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_files TO authenticated;

GRANT ALL ON public.project_files TO service_role;

ALTER TABLE public.project_files ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.pf_guard_points() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF (NEW.points IS DISTINCT FROM OLD.points OR NEW.points_note IS DISTINCT FROM OLD.points_note) THEN
    IF NOT EXISTS (SELECT 1 FROM public.students s WHERE s.id = NEW.student_id AND public.can_view_group(auth.uid(), s.group_id)) THEN
      RAISE EXCEPTION 'forbidden';
    END IF;
    NEW.points_by := auth.uid();
  END IF;
  RETURN NEW;
END $$;

-- ==== drizzle/migrations/0003_fabrication_slots_and_drive.sql
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS drive_folder_id text, ADD COLUMN IF NOT EXISTS drive_layout_folder_id text, ADD COLUMN IF NOT EXISTS drive_project_folder_id text;

ALTER TABLE public.project_files ADD COLUMN IF NOT EXISTS drive_file_id text;

CREATE TABLE IF NOT EXISTS public.student_fabrication_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  slot_key text NOT NULL CHECK (slot_key IN ('BO','BOTTOM','DRILL','FAB','SMBOT','SMTOP','SPTOP','SSTOP','TOP')),
  file_name text NOT NULL,
  storage_path text NOT NULL,
  drive_file_id text,
  size_bytes bigint NOT NULL DEFAULT 0,
  uploaded_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (student_id, slot_key)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.student_fabrication_slots TO authenticated;

GRANT ALL ON public.student_fabrication_slots TO service_role;

ALTER TABLE public.student_fabrication_slots ENABLE ROW LEVEL SECURITY;

-- ==== drizzle/migrations/0004_history_and_demo.sql
ALTER TABLE public.academic_years ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;

-- ==== drizzle/migrations/0005_tighten_read_policies.sql
create or replace function public.is_member(_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = _uid)
$$;

-- ==== drizzle/migrations/0006_staff_import_policies.sql


-- ==== drizzle/migrations/0007_rule_test_runs.sql
CREATE TABLE IF NOT EXISTS public.rule_test_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  series_id uuid REFERENCES public.series(id) ON DELETE CASCADE,
  tested_by uuid NOT NULL,
  candidate jsonb NOT NULL,
  baseline jsonb,
  results jsonb NOT NULL DEFAULT '[]'::jsonb,
  project_count integer NOT NULL DEFAULT 0,
  confirmed_count integer NOT NULL DEFAULT 0,
  rejected_count integer NOT NULL DEFAULT 0,
  activated boolean NOT NULL DEFAULT false,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.rule_test_runs TO authenticated;

GRANT ALL ON public.rule_test_runs TO service_role;

ALTER TABLE public.rule_test_runs ENABLE ROW LEVEL SECURITY;

-- ==== drizzle/migrations/0008_manager_delete_policies.sql


-- ==== drizzle/migrations/0009_migration.sql
create or replace function public.guard_project_file_points()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (new.points is distinct from old.points or new.points_note is distinct from old.points_note) then
    if not public.is_staff(auth.uid()) then
      raise exception 'Doar cadrele didactice pot acorda puncte.';
    end if;
    new.points_by := auth.uid();
  end if;
  return new;
end $$;

-- ==== drizzle/migrations/0010_integrity_fingerprints.sql
CREATE TABLE IF NOT EXISTS public.layout_fingerprints (
  submission_id uuid PRIMARY KEY REFERENCES public.submissions(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  version integer NOT NULL,
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS layout_fingerprints_student_idx ON public.layout_fingerprints(student_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.layout_fingerprints TO authenticated;

GRANT ALL ON public.layout_fingerprints TO service_role;

ALTER TABLE public.layout_fingerprints ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.integrity_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_a uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  student_b uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('false_positive','discuss','confirmed')),
  note text,
  similarity numeric,
  reviewed_by uuid NOT NULL DEFAULT auth.uid(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (student_a, student_b)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.integrity_reviews TO authenticated;

GRANT ALL ON public.integrity_reviews TO service_role;

ALTER TABLE public.integrity_reviews ENABLE ROW LEVEL SECURITY;

-- ==== drizzle/migrations/0011_integrity_v3.sql
CREATE TABLE IF NOT EXISTS public.layout_similarity_pairs (
  submission_a uuid NOT NULL REFERENCES public.submissions(id) ON DELETE CASCADE,
  submission_b uuid NOT NULL REFERENCES public.submissions(id) ON DELETE CASCADE,
  student_a uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  student_b uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  version integer NOT NULL,
  total numeric NOT NULL,
  detail jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (submission_a, submission_b)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.layout_similarity_pairs TO authenticated;

GRANT ALL ON public.layout_similarity_pairs TO service_role;

ALTER TABLE public.layout_similarity_pairs ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.integrity_references (
  student_id uuid PRIMARY KEY REFERENCES public.students(id) ON DELETE CASCADE,
  note text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.integrity_references TO authenticated;

GRANT ALL ON public.integrity_references TO service_role;

ALTER TABLE public.integrity_references ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.integrity_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid NOT NULL REFERENCES public.submissions(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  other_student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  similarity numeric NOT NULL,
  adjusted numeric NOT NULL,
  detail jsonb NOT NULL,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','seen','dismissed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (submission_id, other_student_id)
);

GRANT SELECT, UPDATE ON public.integrity_alerts TO authenticated;

GRANT ALL ON public.integrity_alerts TO service_role;

ALTER TABLE public.integrity_alerts ENABLE ROW LEVEL SECURITY;

-- ==== drizzle/migrations/0012_phase5_deadlines_receipts_annotations_audit.sql
CREATE TABLE IF NOT EXISTS public.deadlines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  series_id uuid REFERENCES public.series(id) ON DELETE CASCADE,
  group_id uuid REFERENCES public.groups(id) ON DELETE CASCADE,
  soft_deadline timestamptz,
  hard_deadline timestamptz,
  late_penalty_per_day numeric NOT NULL DEFAULT 0,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT deadlines_scope_check CHECK (series_id IS NOT NULL OR group_id IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS deadlines_series_uidx ON public.deadlines (series_id) WHERE group_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS deadlines_group_uidx ON public.deadlines (group_id) WHERE group_id IS NOT NULL;

GRANT SELECT ON public.deadlines TO authenticated;

GRANT ALL ON public.deadlines TO service_role;

ALTER TABLE public.deadlines ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.students ADD COLUMN IF NOT EXISTS deadline_extension_until timestamptz;

ALTER TABLE public.students ADD COLUMN IF NOT EXISTS grade_interview numeric;

ALTER TABLE public.submissions ADD COLUMN IF NOT EXISTS zip_sha256 text;

ALTER TABLE public.submissions ADD COLUMN IF NOT EXISTS report_sha256 text;

ALTER TABLE public.submissions ADD COLUMN IF NOT EXISTS late_days integer;

CREATE TABLE IF NOT EXISTS public.review_annotations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  submission_id uuid REFERENCES public.submissions(id) ON DELETE SET NULL,
  x numeric NOT NULL,
  y numeric NOT NULL,
  note text NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, DELETE ON public.review_annotations TO authenticated;

GRANT ALL ON public.review_annotations TO service_role;

ALTER TABLE public.review_annotations ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.grade_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  field text NOT NULL,
  old_value text,
  new_value text,
  changed_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.grade_audit_logs TO authenticated;

GRANT ALL ON public.grade_audit_logs TO service_role;

ALTER TABLE public.grade_audit_logs ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.review_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  submission_id uuid REFERENCES public.submissions(id) ON DELETE CASCADE,
  message text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_by uuid,
  resolved_at timestamptz
);

GRANT SELECT, INSERT, UPDATE ON public.review_requests TO authenticated;

GRANT ALL ON public.review_requests TO service_role;

ALTER TABLE public.review_requests ENABLE ROW LEVEL SECURITY;

-- ==== drizzle/migrations/0013_phase6_exam_mode.sql
ALTER TABLE public.groups ADD COLUMN IF NOT EXISTS exam_mode boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.exam_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  code text NOT NULL,
  label text,
  expires_at timestamptz NOT NULL,
  used_by uuid,
  used_at timestamptz,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (group_id, code)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.exam_tokens TO authenticated;

GRANT ALL ON public.exam_tokens TO service_role;

ALTER TABLE public.exam_tokens ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.redeem_exam_token(_code text, _student uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t public.exam_tokens%ROWTYPE;
  ok boolean;
BEGIN
  SELECT * INTO t FROM public.exam_tokens
   WHERE code = upper(trim(_code))
   ORDER BY created_at DESC
   LIMIT 1;
  IF NOT FOUND THEN RETURN false; END IF;
  IF t.used_at IS NOT NULL OR t.expires_at < now() THEN RETURN false; END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.students s
    WHERE s.id = _student AND s.group_id = t.group_id AND s.user_id = auth.uid()
  ) INTO ok;
  IF NOT ok THEN RETURN false; END IF;
  UPDATE public.exam_tokens SET used_by = auth.uid(), used_at = now() WHERE id = t.id;
  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.redeem_exam_token(text, uuid) TO authenticated;

-- ==== drizzle/migrations/0014_deadlines_scope_and_enforce.sql
CREATE OR REPLACE FUNCTION public.enforce_submission_deadline()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _group uuid; _series uuid; _ext timestamptz; _hard timestamptz;
BEGIN
  IF NEW.kind <> 'OFFICIAL' OR public.is_staff(auth.uid()) OR auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT s.group_id, g.series_id, s.deadline_extension_until INTO _group, _series, _ext
    FROM public.students s JOIN public.groups g ON g.id = s.group_id WHERE s.id = NEW.student_id;
  SELECT hard_deadline INTO _hard FROM public.deadlines WHERE group_id = _group AND hard_deadline IS NOT NULL LIMIT 1;
  IF _hard IS NULL THEN
    SELECT hard_deadline INTO _hard FROM public.deadlines WHERE series_id = _series AND group_id IS NULL AND hard_deadline IS NOT NULL LIMIT 1;
  END IF;
  IF _ext IS NOT NULL AND (_hard IS NULL OR _ext > _hard) AND _hard IS NOT NULL THEN
    _hard := _ext;
  END IF;
  IF _hard IS NOT NULL AND now() > _hard THEN
    RAISE EXCEPTION 'Termenul limită pentru predarea oficială a expirat.';
  END IF;
  RETURN NEW;
END $$;

-- Final policy state (including policy replacements in historical migrations).
DO $schema$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'profiles' AND policyname = 'profiles self or staff read') THEN
    ALTER POLICY "profiles self or staff read" ON public.profiles TO authenticated using (id = auth.uid() or public.is_staff(auth.uid()));
  ELSE
    create policy "profiles self or staff read" on public.profiles for select to authenticated using (id = auth.uid() or public.is_staff(auth.uid()));
  END IF;
END
$schema$;

DO $schema$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'profiles' AND policyname = 'profiles self update') THEN
    ALTER POLICY "profiles self update" ON public.profiles TO authenticated using (id = auth.uid());
  ELSE
    create policy "profiles self update" on public.profiles for update to authenticated using (id = auth.uid());
  END IF;
END
$schema$;

DO $schema$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'user_roles' AND policyname = 'roles self or staff read') THEN
    ALTER POLICY "roles self or staff read" ON public.user_roles TO authenticated using (user_id = auth.uid() or public.is_staff(auth.uid()));
  ELSE
    create policy "roles self or staff read" on public.user_roles for select to authenticated using (user_id = auth.uid() or public.is_staff(auth.uid()));
  END IF;
END
$schema$;

DO $schema$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'academic_years' AND policyname = 'years admin write') THEN
    ALTER POLICY "years admin write" ON public.academic_years TO authenticated using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));
  ELSE
    create policy "years admin write" on public.academic_years for all to authenticated using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));
  END IF;
END
$schema$;

DO $schema$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'series' AND policyname = 'series admin insert') THEN
    ALTER POLICY "series admin insert" ON public.series TO authenticated with check (public.has_role(auth.uid(),'admin'));
  ELSE
    create policy "series admin insert" on public.series for insert to authenticated with check (public.has_role(auth.uid(),'admin'));
  END IF;
END
$schema$;

DO $schema$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'series' AND policyname = 'series manage update') THEN
    ALTER POLICY "series manage update" ON public.series TO authenticated using (public.manages_series(auth.uid(), id));
  ELSE
    create policy "series manage update" on public.series for update to authenticated using (public.manages_series(auth.uid(), id));
  END IF;
END
$schema$;

DO $schema$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'series' AND policyname = 'series admin delete') THEN
    ALTER POLICY "series admin delete" ON public.series TO authenticated using (public.has_role(auth.uid(),'admin'));
  ELSE
    create policy "series admin delete" on public.series for delete to authenticated using (public.has_role(auth.uid(),'admin'));
  END IF;
END
$schema$;

DO $schema$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'series_managers' AND policyname = 'sm admin write') THEN
    ALTER POLICY "sm admin write" ON public.series_managers TO authenticated using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));
  ELSE
    create policy "sm admin write" on public.series_managers for all to authenticated using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));
  END IF;
END
$schema$;

DO $schema$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'groups' AND policyname = 'groups manage insert') THEN
    ALTER POLICY "groups manage insert" ON public.groups TO authenticated with check (public.manages_series(auth.uid(), series_id));
  ELSE
    create policy "groups manage insert" on public.groups for insert to authenticated with check (public.manages_series(auth.uid(), series_id));
  END IF;
END
$schema$;

DO $schema$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'groups' AND policyname = 'groups manage update') THEN
    ALTER POLICY "groups manage update" ON public.groups TO authenticated using (public.manages_series(auth.uid(), series_id));
  ELSE
    create policy "groups manage update" on public.groups for update to authenticated using (public.manages_series(auth.uid(), series_id));
  END IF;
END
$schema$;

DO $schema$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'groups' AND policyname = 'groups manage delete') THEN
    ALTER POLICY "groups manage delete" ON public.groups TO authenticated using (public.manages_series(auth.uid(), series_id));
  ELSE
    create policy "groups manage delete" on public.groups for delete to authenticated using (public.manages_series(auth.uid(), series_id));
  END IF;
END
$schema$;

DO $schema$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'group_instructors' AND policyname = 'gi manage write') THEN
    ALTER POLICY "gi manage write" ON public.group_instructors TO authenticated using (public.can_manage_group(auth.uid(), group_id)) with check (public.can_manage_group(auth.uid(), group_id));
  ELSE
    create policy "gi manage write" on public.group_instructors for all to authenticated using (public.can_manage_group(auth.uid(), group_id)) with check (public.can_manage_group(auth.uid(), group_id));
  END IF;
END
$schema$;

DO $schema$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'students' AND policyname = 'students read') THEN
    ALTER POLICY "students read" ON public.students TO authenticated using (user_id = auth.uid() or public.can_view_group(auth.uid(), group_id));
  ELSE
    create policy "students read" on public.students for select to authenticated using (user_id = auth.uid() or public.can_view_group(auth.uid(), group_id));
  END IF;
END
$schema$;

DO $schema$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'students' AND policyname = 'students self enroll') THEN
    ALTER POLICY "students self enroll" ON public.students TO authenticated with check (
  (user_id = auth.uid() and status = 'pending')
  or public.can_manage_group(auth.uid(), group_id));
  ELSE
    create policy "students self enroll" on public.students for insert to authenticated with check (
  (user_id = auth.uid() and status = 'pending')
  or public.can_manage_group(auth.uid(), group_id));
  END IF;
END
$schema$;

DO $schema$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'students' AND policyname = 'students staff update') THEN
    ALTER POLICY "students staff update" ON public.students TO authenticated using (public.can_view_group(auth.uid(), group_id)) with check (public.can_view_group(auth.uid(), group_id));
  ELSE
    create policy "students staff update" on public.students for update to authenticated using (public.can_view_group(auth.uid(), group_id)) with check (public.can_view_group(auth.uid(), group_id));
  END IF;
END
$schema$;

DO $schema$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'students' AND policyname = 'students manage delete') THEN
    ALTER POLICY "students manage delete" ON public.students TO authenticated using (public.can_manage_group(auth.uid(), group_id));
  ELSE
    create policy "students manage delete" on public.students for delete to authenticated using (public.can_manage_group(auth.uid(), group_id));
  END IF;
END
$schema$;

DO $schema$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'submissions' AND policyname = 'subs read') THEN
    ALTER POLICY "subs read" ON public.submissions TO authenticated using (
  user_id = auth.uid() or exists (select 1 from public.students s where s.id = student_id and public.can_view_group(auth.uid(), s.group_id)));
  ELSE
    create policy "subs read" on public.submissions for select to authenticated using (
  user_id = auth.uid() or exists (select 1 from public.students s where s.id = student_id and public.can_view_group(auth.uid(), s.group_id)));
  END IF;
END
$schema$;

DO $schema$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'submissions' AND policyname = 'subs own insert') THEN
    ALTER POLICY "subs own insert" ON public.submissions TO authenticated with check (
  user_id = auth.uid() and review_status = 'pending' and exists (select 1 from public.students s where s.id = student_id and s.user_id = auth.uid()));
  ELSE
    create policy "subs own insert" on public.submissions for insert to authenticated with check (
  user_id = auth.uid() and review_status = 'pending' and exists (select 1 from public.students s where s.id = student_id and s.user_id = auth.uid()));
  END IF;
END
$schema$;

DO $schema$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'submissions' AND policyname = 'subs staff update') THEN
    ALTER POLICY "subs staff update" ON public.submissions TO authenticated using (
  exists (select 1 from public.students s where s.id = student_id and public.can_view_group(auth.uid(), s.group_id)));
  ELSE
    create policy "subs staff update" on public.submissions for update to authenticated using (
  exists (select 1 from public.students s where s.id = student_id and public.can_view_group(auth.uid(), s.group_id)));
  END IF;
END
$schema$;

DO $schema$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'audit_log' AND policyname = 'audit insert own') THEN
    ALTER POLICY "audit insert own" ON public.audit_log TO authenticated with check (actor_id = auth.uid());
  ELSE
    create policy "audit insert own" on public.audit_log for insert to authenticated with check (actor_id = auth.uid());
  END IF;
END
$schema$;

DO $schema$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'audit_log' AND policyname = 'audit admin read') THEN
    ALTER POLICY "audit admin read" ON public.audit_log TO authenticated using (public.has_role(auth.uid(),'admin'));
  ELSE
    create policy "audit admin read" on public.audit_log for select to authenticated using (public.has_role(auth.uid(),'admin'));
  END IF;
END
$schema$;

DO $schema$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'gerbers own upload') THEN
    ALTER POLICY "gerbers own upload" ON storage.objects TO authenticated with check (bucket_id = 'gerbers' and (storage.foldername(name))[1] = auth.uid()::text);
  ELSE
    create policy "gerbers own upload" on storage.objects for insert to authenticated with check (bucket_id = 'gerbers' and (storage.foldername(name))[1] = auth.uid()::text);
  END IF;
END
$schema$;

DO $schema$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'gerbers read') THEN
    ALTER POLICY "gerbers read" ON storage.objects TO authenticated using (
  bucket_id = 'gerbers' and ((storage.foldername(name))[1] = auth.uid()::text or exists (
    select 1 from public.students s where s.user_id::text = (storage.foldername(name))[1] and public.can_view_group(auth.uid(), s.group_id))));
  ELSE
    create policy "gerbers read" on storage.objects for select to authenticated using (
  bucket_id = 'gerbers' and ((storage.foldername(name))[1] = auth.uid()::text or exists (
    select 1 from public.students s where s.user_id::text = (storage.foldername(name))[1] and public.can_view_group(auth.uid(), s.group_id))));
  END IF;
END
$schema$;

DO $schema$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'sheet_links' AND policyname = 'sheet links read') THEN
    ALTER POLICY "sheet links read" ON public.sheet_links TO authenticated USING (public.is_staff(auth.uid()));
  ELSE
    CREATE POLICY "sheet links read" ON public.sheet_links FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
  END IF;
END
$schema$;

DO $schema$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'sheet_links' AND policyname = 'sheet links manage') THEN
    ALTER POLICY "sheet links manage" ON public.sheet_links TO authenticated USING (public.manages_series(auth.uid(), series_id))
  WITH CHECK (public.manages_series(auth.uid(), series_id));
  ELSE
    CREATE POLICY "sheet links manage" ON public.sheet_links FOR ALL TO authenticated
  USING (public.manages_series(auth.uid(), series_id))
  WITH CHECK (public.manages_series(auth.uid(), series_id));
  END IF;
END
$schema$;

DO $schema$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'cam_panels' AND policyname = 'cam panels read') THEN
    ALTER POLICY "cam panels read" ON public.cam_panels TO authenticated USING (public.is_staff(auth.uid()) OR public.has_role(auth.uid(), 'cam_tech'::app_role));
  ELSE
    CREATE POLICY "cam panels read" ON public.cam_panels FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()) OR public.has_role(auth.uid(), 'cam_tech'::app_role));
  END IF;
END
$schema$;

DO $schema$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'cam_panels' AND policyname = 'cam panels insert') THEN
    ALTER POLICY "cam panels insert" ON public.cam_panels TO authenticated WITH CHECK (created_by = auth.uid() AND (public.manages_series(auth.uid(), series_id) OR public.has_role(auth.uid(), 'cam_tech'::app_role)));
  ELSE
    CREATE POLICY "cam panels insert" ON public.cam_panels FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid() AND (public.manages_series(auth.uid(), series_id) OR public.has_role(auth.uid(), 'cam_tech'::app_role)));
  END IF;
END
$schema$;

DO $schema$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'cam_panels' AND policyname = 'cam panels update') THEN
    ALTER POLICY "cam panels update" ON public.cam_panels TO authenticated USING (public.manages_series(auth.uid(), series_id) OR public.has_role(auth.uid(), 'cam_tech'::app_role));
  ELSE
    CREATE POLICY "cam panels update" ON public.cam_panels FOR UPDATE TO authenticated
  USING (public.manages_series(auth.uid(), series_id) OR public.has_role(auth.uid(), 'cam_tech'::app_role));
  END IF;
END
$schema$;

DO $schema$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'cam_panels' AND policyname = 'cam panels delete') THEN
    ALTER POLICY "cam panels delete" ON public.cam_panels TO authenticated USING (public.manages_series(auth.uid(), series_id) OR public.has_role(auth.uid(), 'admin'::app_role));
  ELSE
    CREATE POLICY "cam panels delete" ON public.cam_panels FOR DELETE TO authenticated
  USING (public.manages_series(auth.uid(), series_id) OR public.has_role(auth.uid(), 'admin'::app_role));
  END IF;
END
$schema$;

DO $schema$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'drc_settings' AND policyname = 'drc settings insert') THEN
    ALTER POLICY "drc settings insert" ON public.drc_settings TO authenticated WITH CHECK (CASE WHEN series_id IS NULL THEN public.has_role(auth.uid(),'admin') ELSE public.manages_series(auth.uid(), series_id) END);
  ELSE
    CREATE POLICY "drc settings insert" ON public.drc_settings FOR INSERT TO authenticated
  WITH CHECK (CASE WHEN series_id IS NULL THEN public.has_role(auth.uid(),'admin') ELSE public.manages_series(auth.uid(), series_id) END);
  END IF;
END
$schema$;

DO $schema$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'drc_settings' AND policyname = 'drc settings update') THEN
    ALTER POLICY "drc settings update" ON public.drc_settings TO authenticated USING (CASE WHEN series_id IS NULL THEN public.has_role(auth.uid(),'admin') ELSE public.manages_series(auth.uid(), series_id) END);
  ELSE
    CREATE POLICY "drc settings update" ON public.drc_settings FOR UPDATE TO authenticated
  USING (CASE WHEN series_id IS NULL THEN public.has_role(auth.uid(),'admin') ELSE public.manages_series(auth.uid(), series_id) END);
  END IF;
END
$schema$;

DO $schema$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'drc_settings' AND policyname = 'drc settings delete') THEN
    ALTER POLICY "drc settings delete" ON public.drc_settings TO authenticated USING (CASE WHEN series_id IS NULL THEN public.has_role(auth.uid(),'admin') ELSE public.manages_series(auth.uid(), series_id) END);
  ELSE
    CREATE POLICY "drc settings delete" ON public.drc_settings FOR DELETE TO authenticated
  USING (CASE WHEN series_id IS NULL THEN public.has_role(auth.uid(),'admin') ELSE public.manages_series(auth.uid(), series_id) END);
  END IF;
END
$schema$;

DO $schema$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'project_files' AND policyname = 'pf read') THEN
    ALTER POLICY "pf read" ON public.project_files TO authenticated USING (user_id = auth.uid() OR EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND public.can_view_group(auth.uid(), s.group_id)));
  ELSE
    CREATE POLICY "pf read" ON public.project_files FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND public.can_view_group(auth.uid(), s.group_id)));
  END IF;
END
$schema$;

DO $schema$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'project_files' AND policyname = 'pf insert own') THEN
    ALTER POLICY "pf insert own" ON public.project_files TO authenticated WITH CHECK (user_id = auth.uid() AND points IS NULL AND EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND s.user_id = auth.uid()));
  ELSE
    CREATE POLICY "pf insert own" ON public.project_files FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND points IS NULL AND EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND s.user_id = auth.uid()));
  END IF;
END
$schema$;

DO $schema$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'project_files' AND policyname = 'pf update') THEN
    ALTER POLICY "pf update" ON public.project_files TO authenticated USING (user_id = auth.uid() OR EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND public.can_view_group(auth.uid(), s.group_id)));
  ELSE
    CREATE POLICY "pf update" ON public.project_files FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND public.can_view_group(auth.uid(), s.group_id)));
  END IF;
END
$schema$;

DO $schema$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'project_files' AND policyname = 'pf delete own') THEN
    ALTER POLICY "pf delete own" ON public.project_files TO authenticated USING (user_id = auth.uid() AND points IS NULL);
  ELSE
    CREATE POLICY "pf delete own" ON public.project_files FOR DELETE TO authenticated
  USING (user_id = auth.uid() AND points IS NULL);
  END IF;
END
$schema$;

DO $schema$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'gerbers delete own') THEN
    ALTER POLICY "gerbers delete own" ON storage.objects TO authenticated USING (bucket_id = 'gerbers' AND (storage.foldername(name))[1] = auth.uid()::text);
  ELSE
    CREATE POLICY "gerbers delete own" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'gerbers' AND (storage.foldername(name))[1] = auth.uid()::text);
  END IF;
END
$schema$;

DO $schema$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'student_fabrication_slots' AND policyname = 'slots read') THEN
    ALTER POLICY "slots read" ON public.student_fabrication_slots TO authenticated USING (EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND (s.user_id = auth.uid() OR public.can_view_group(auth.uid(), s.group_id) OR public.has_role(auth.uid(),'cam_tech'))));
  ELSE
    CREATE POLICY "slots read" ON public.student_fabrication_slots FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND (s.user_id = auth.uid() OR public.can_view_group(auth.uid(), s.group_id) OR public.has_role(auth.uid(),'cam_tech'))));
  END IF;
END
$schema$;

DO $schema$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'student_fabrication_slots' AND policyname = 'slots own insert') THEN
    ALTER POLICY "slots own insert" ON public.student_fabrication_slots TO authenticated WITH CHECK (uploaded_by = auth.uid() AND EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND s.user_id = auth.uid()));
  ELSE
    CREATE POLICY "slots own insert" ON public.student_fabrication_slots FOR INSERT TO authenticated
  WITH CHECK (uploaded_by = auth.uid() AND EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND s.user_id = auth.uid()));
  END IF;
END
$schema$;

DO $schema$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'student_fabrication_slots' AND policyname = 'slots own update') THEN
    ALTER POLICY "slots own update" ON public.student_fabrication_slots TO authenticated USING (EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND s.user_id = auth.uid()))
  WITH CHECK (uploaded_by = auth.uid());
  ELSE
    CREATE POLICY "slots own update" ON public.student_fabrication_slots FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND s.user_id = auth.uid()))
  WITH CHECK (uploaded_by = auth.uid());
  END IF;
END
$schema$;

DO $schema$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'student_fabrication_slots' AND policyname = 'slots own delete') THEN
    ALTER POLICY "slots own delete" ON public.student_fabrication_slots TO authenticated USING (EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND s.user_id = auth.uid()));
  ELSE
    CREATE POLICY "slots own delete" ON public.student_fabrication_slots FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND s.user_id = auth.uid()));
  END IF;
END
$schema$;

DO $schema$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'student_fabrication_slots' AND policyname = 'slots admin write') THEN
    ALTER POLICY "slots admin write" ON public.student_fabrication_slots TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
  ELSE
    CREATE POLICY "slots admin write" ON public.student_fabrication_slots FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
  END IF;
END
$schema$;

DO $schema$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'submissions' AND policyname = 'subs admin insert') THEN
    ALTER POLICY "subs admin insert" ON public.submissions TO authenticated WITH CHECK (public.has_role(auth.uid(),'admin'));
  ELSE
    CREATE POLICY "subs admin insert" ON public.submissions FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(),'admin'));
  END IF;
END
$schema$;

DO $schema$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'submissions' AND policyname = 'subs admin delete') THEN
    ALTER POLICY "subs admin delete" ON public.submissions TO authenticated USING (public.has_role(auth.uid(),'admin'));
  ELSE
    CREATE POLICY "subs admin delete" ON public.submissions FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));
  END IF;
END
$schema$;

DO $schema$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'project_files' AND policyname = 'pf admin delete') THEN
    ALTER POLICY "pf admin delete" ON public.project_files TO authenticated USING (public.has_role(auth.uid(),'admin'));
  ELSE
    CREATE POLICY "pf admin delete" ON public.project_files FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));
  END IF;
END
$schema$;

DO $schema$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'academic_years' AND policyname = 'years read') THEN
    ALTER POLICY "years read" ON public.academic_years TO authenticated using (public.is_member(auth.uid()));
  ELSE
    create policy "years read" on public.academic_years for select to authenticated using (public.is_member(auth.uid()));
  END IF;
END
$schema$;

DO $schema$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'series' AND policyname = 'series read') THEN
    ALTER POLICY "series read" ON public.series TO authenticated using (public.is_member(auth.uid()));
  ELSE
    create policy "series read" on public.series for select to authenticated using (public.is_member(auth.uid()));
  END IF;
END
$schema$;

DO $schema$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'groups' AND policyname = 'groups read') THEN
    ALTER POLICY "groups read" ON public.groups TO authenticated using (public.is_member(auth.uid()));
  ELSE
    create policy "groups read" on public.groups for select to authenticated using (public.is_member(auth.uid()));
  END IF;
END
$schema$;

DO $schema$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'drc_settings' AND policyname = 'drc settings read') THEN
    ALTER POLICY "drc settings read" ON public.drc_settings TO authenticated using (public.is_member(auth.uid()));
  ELSE
    create policy "drc settings read" on public.drc_settings for select to authenticated using (public.is_member(auth.uid()));
  END IF;
END
$schema$;

DO $schema$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'series_managers' AND policyname = 'sm read') THEN
    ALTER POLICY "sm read" ON public.series_managers TO authenticated using (user_id = auth.uid() or public.is_staff(auth.uid()));
  ELSE
    create policy "sm read" on public.series_managers for select to authenticated using (user_id = auth.uid() or public.is_staff(auth.uid()));
  END IF;
END
$schema$;

DO $schema$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'group_instructors' AND policyname = 'gi read') THEN
    ALTER POLICY "gi read" ON public.group_instructors TO authenticated using (user_id = auth.uid() or public.is_staff(auth.uid()));
  ELSE
    create policy "gi read" on public.group_instructors for select to authenticated using (user_id = auth.uid() or public.is_staff(auth.uid()));
  END IF;
END
$schema$;

DO $schema$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'submissions' AND policyname = 'subs manager insert') THEN
    ALTER POLICY "subs manager insert" ON public.submissions TO authenticated WITH CHECK (user_id = auth.uid() AND EXISTS (SELECT 1 FROM public.students s WHERE s.id = submissions.student_id AND public.can_manage_group(auth.uid(), s.group_id)));
  ELSE
    CREATE POLICY "subs manager insert" ON public.submissions FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND EXISTS (SELECT 1 FROM public.students s WHERE s.id = submissions.student_id AND public.can_manage_group(auth.uid(), s.group_id)));
  END IF;
END
$schema$;

DO $schema$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'student_fabrication_slots' AND policyname = 'slots manager insert') THEN
    ALTER POLICY "slots manager insert" ON public.student_fabrication_slots TO authenticated WITH CHECK (uploaded_by = auth.uid() AND EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_fabrication_slots.student_id AND public.can_manage_group(auth.uid(), s.group_id)));
  ELSE
    CREATE POLICY "slots manager insert" ON public.student_fabrication_slots FOR INSERT TO authenticated
  WITH CHECK (uploaded_by = auth.uid() AND EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_fabrication_slots.student_id AND public.can_manage_group(auth.uid(), s.group_id)));
  END IF;
END
$schema$;

DO $schema$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'student_fabrication_slots' AND policyname = 'slots manager update') THEN
    ALTER POLICY "slots manager update" ON public.student_fabrication_slots TO authenticated USING (EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_fabrication_slots.student_id AND public.can_manage_group(auth.uid(), s.group_id)))
  WITH CHECK (uploaded_by = auth.uid());
  ELSE
    CREATE POLICY "slots manager update" ON public.student_fabrication_slots FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_fabrication_slots.student_id AND public.can_manage_group(auth.uid(), s.group_id)))
  WITH CHECK (uploaded_by = auth.uid());
  END IF;
END
$schema$;

DO $schema$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'rule_test_runs' AND policyname = 'managers read test runs') THEN
    ALTER POLICY "managers read test runs" ON public.rule_test_runs TO authenticated USING (CASE WHEN series_id IS NULL THEN public.has_role(auth.uid(),'admin') ELSE public.manages_series(auth.uid(), series_id) END);
  ELSE
    CREATE POLICY "managers read test runs" ON public.rule_test_runs FOR SELECT TO authenticated
  USING (CASE WHEN series_id IS NULL THEN public.has_role(auth.uid(),'admin') ELSE public.manages_series(auth.uid(), series_id) END);
  END IF;
END
$schema$;

DO $schema$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'rule_test_runs' AND policyname = 'managers insert test runs') THEN
    ALTER POLICY "managers insert test runs" ON public.rule_test_runs TO authenticated WITH CHECK (tested_by = auth.uid() AND CASE WHEN series_id IS NULL THEN public.has_role(auth.uid(),'admin') ELSE public.manages_series(auth.uid(), series_id) END);
  ELSE
    CREATE POLICY "managers insert test runs" ON public.rule_test_runs FOR INSERT TO authenticated
  WITH CHECK (tested_by = auth.uid() AND CASE WHEN series_id IS NULL THEN public.has_role(auth.uid(),'admin') ELSE public.manages_series(auth.uid(), series_id) END);
  END IF;
END
$schema$;

DO $schema$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'submissions' AND policyname = 'subs manage delete') THEN
    ALTER POLICY "subs manage delete" ON public.submissions TO authenticated using (exists (select 1 from public.students s where s.id = submissions.student_id and public.can_manage_group(auth.uid(), s.group_id)));
  ELSE
    create policy "subs manage delete" on public.submissions for delete to authenticated using (exists (select 1 from public.students s where s.id = submissions.student_id and public.can_manage_group(auth.uid(), s.group_id)));
  END IF;
END
$schema$;

DO $schema$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'student_fabrication_slots' AND policyname = 'slots manage delete') THEN
    ALTER POLICY "slots manage delete" ON public.student_fabrication_slots TO authenticated using (exists (select 1 from public.students s where s.id = student_fabrication_slots.student_id and public.can_manage_group(auth.uid(), s.group_id)));
  ELSE
    create policy "slots manage delete" on public.student_fabrication_slots for delete to authenticated using (exists (select 1 from public.students s where s.id = student_fabrication_slots.student_id and public.can_manage_group(auth.uid(), s.group_id)));
  END IF;
END
$schema$;

DO $schema$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'project_files' AND policyname = 'pf manage delete') THEN
    ALTER POLICY "pf manage delete" ON public.project_files TO authenticated using (exists (select 1 from public.students s where s.id = project_files.student_id and public.can_manage_group(auth.uid(), s.group_id)));
  ELSE
    create policy "pf manage delete" on public.project_files for delete to authenticated using (exists (select 1 from public.students s where s.id = project_files.student_id and public.can_manage_group(auth.uid(), s.group_id)));
  END IF;
END
$schema$;

DO $schema$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'project_files' AND policyname = 'pf manage insert') THEN
    ALTER POLICY "pf manage insert" ON public.project_files TO authenticated with check (user_id = auth.uid() and exists (select 1 from public.students s where s.id = student_id and public.can_manage_group(auth.uid(), s.group_id)));
  ELSE
    create policy "pf manage insert" on public.project_files for insert to authenticated
with check (user_id = auth.uid() and exists (select 1 from public.students s where s.id = student_id and public.can_manage_group(auth.uid(), s.group_id)));
  END IF;
END
$schema$;

DO $schema$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'gerbers manager upload') THEN
    ALTER POLICY "gerbers manager upload" ON storage.objects TO authenticated with check (bucket_id = 'gerbers' and exists (select 1 from public.students s where s.user_id::text = (storage.foldername(name))[1] and public.can_manage_group(auth.uid(), s.group_id)));
  ELSE
    create policy "gerbers manager upload" on storage.objects for insert to authenticated
with check (bucket_id = 'gerbers' and exists (select 1 from public.students s where s.user_id::text = (storage.foldername(name))[1] and public.can_manage_group(auth.uid(), s.group_id)));
  END IF;
END
$schema$;

DO $schema$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'layout_fingerprints' AND policyname = 'staff view fingerprints') THEN
    ALTER POLICY "staff view fingerprints" ON public.layout_fingerprints TO authenticated USING (EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND public.can_view_group(auth.uid(), s.group_id)));
  ELSE
    CREATE POLICY "staff view fingerprints" ON public.layout_fingerprints FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND public.can_view_group(auth.uid(), s.group_id)));
  END IF;
END
$schema$;

DO $schema$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'layout_fingerprints' AND policyname = 'staff insert fingerprints') THEN
    ALTER POLICY "staff insert fingerprints" ON public.layout_fingerprints TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND public.can_view_group(auth.uid(), s.group_id)));
  ELSE
    CREATE POLICY "staff insert fingerprints" ON public.layout_fingerprints FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND public.can_view_group(auth.uid(), s.group_id)));
  END IF;
END
$schema$;

DO $schema$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'layout_fingerprints' AND policyname = 'staff update fingerprints') THEN
    ALTER POLICY "staff update fingerprints" ON public.layout_fingerprints TO authenticated USING (EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND public.can_view_group(auth.uid(), s.group_id)));
  ELSE
    CREATE POLICY "staff update fingerprints" ON public.layout_fingerprints FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND public.can_view_group(auth.uid(), s.group_id)));
  END IF;
END
$schema$;

DO $schema$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'layout_fingerprints' AND policyname = 'managers delete fingerprints') THEN
    ALTER POLICY "managers delete fingerprints" ON public.layout_fingerprints TO authenticated USING (EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND public.can_manage_group(auth.uid(), s.group_id)));
  ELSE
    CREATE POLICY "managers delete fingerprints" ON public.layout_fingerprints FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND public.can_manage_group(auth.uid(), s.group_id)));
  END IF;
END
$schema$;

DO $schema$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'integrity_reviews' AND policyname = 'staff view reviews') THEN
    ALTER POLICY "staff view reviews" ON public.integrity_reviews TO authenticated USING (EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_a AND public.can_view_group(auth.uid(), s.group_id)));
  ELSE
    CREATE POLICY "staff view reviews" ON public.integrity_reviews FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_a AND public.can_view_group(auth.uid(), s.group_id)));
  END IF;
END
$schema$;

DO $schema$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'integrity_reviews' AND policyname = 'staff write reviews') THEN
    ALTER POLICY "staff write reviews" ON public.integrity_reviews TO authenticated WITH CHECK (reviewed_by = auth.uid() AND EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_a AND public.can_view_group(auth.uid(), s.group_id)));
  ELSE
    CREATE POLICY "staff write reviews" ON public.integrity_reviews FOR INSERT TO authenticated
  WITH CHECK (reviewed_by = auth.uid() AND EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_a AND public.can_view_group(auth.uid(), s.group_id)));
  END IF;
END
$schema$;

DO $schema$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'integrity_reviews' AND policyname = 'staff update reviews') THEN
    ALTER POLICY "staff update reviews" ON public.integrity_reviews TO authenticated USING (EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_a AND public.can_view_group(auth.uid(), s.group_id)))
  WITH CHECK (reviewed_by = auth.uid());
  ELSE
    CREATE POLICY "staff update reviews" ON public.integrity_reviews FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_a AND public.can_view_group(auth.uid(), s.group_id)))
  WITH CHECK (reviewed_by = auth.uid());
  END IF;
END
$schema$;

DO $schema$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'integrity_reviews' AND policyname = 'staff delete reviews') THEN
    ALTER POLICY "staff delete reviews" ON public.integrity_reviews TO authenticated USING (EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_a AND public.can_view_group(auth.uid(), s.group_id)));
  ELSE
    CREATE POLICY "staff delete reviews" ON public.integrity_reviews FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_a AND public.can_view_group(auth.uid(), s.group_id)));
  END IF;
END
$schema$;

DO $schema$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'layout_similarity_pairs' AND policyname = 'staff view pairs') THEN
    ALTER POLICY "staff view pairs" ON public.layout_similarity_pairs TO authenticated USING (EXISTS (SELECT 1 FROM public.students s WHERE s.id IN (student_a, student_b) AND public.can_view_group(auth.uid(), s.group_id)));
  ELSE
    CREATE POLICY "staff view pairs" ON public.layout_similarity_pairs FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.students s WHERE s.id IN (student_a, student_b) AND public.can_view_group(auth.uid(), s.group_id)));
  END IF;
END
$schema$;

DO $schema$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'layout_similarity_pairs' AND policyname = 'staff insert pairs') THEN
    ALTER POLICY "staff insert pairs" ON public.layout_similarity_pairs TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM public.students s WHERE s.id IN (student_a, student_b) AND public.can_view_group(auth.uid(), s.group_id)));
  ELSE
    CREATE POLICY "staff insert pairs" ON public.layout_similarity_pairs FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.students s WHERE s.id IN (student_a, student_b) AND public.can_view_group(auth.uid(), s.group_id)));
  END IF;
END
$schema$;

DO $schema$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'layout_similarity_pairs' AND policyname = 'staff update pairs') THEN
    ALTER POLICY "staff update pairs" ON public.layout_similarity_pairs TO authenticated USING (EXISTS (SELECT 1 FROM public.students s WHERE s.id IN (student_a, student_b) AND public.can_view_group(auth.uid(), s.group_id)));
  ELSE
    CREATE POLICY "staff update pairs" ON public.layout_similarity_pairs FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.students s WHERE s.id IN (student_a, student_b) AND public.can_view_group(auth.uid(), s.group_id)));
  END IF;
END
$schema$;

DO $schema$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'layout_similarity_pairs' AND policyname = 'managers delete pairs') THEN
    ALTER POLICY "managers delete pairs" ON public.layout_similarity_pairs TO authenticated USING (EXISTS (SELECT 1 FROM public.students s WHERE s.id IN (student_a, student_b) AND public.can_manage_group(auth.uid(), s.group_id)));
  ELSE
    CREATE POLICY "managers delete pairs" ON public.layout_similarity_pairs FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.students s WHERE s.id IN (student_a, student_b) AND public.can_manage_group(auth.uid(), s.group_id)));
  END IF;
END
$schema$;

DO $schema$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'integrity_references' AND policyname = 'staff view refs') THEN
    ALTER POLICY "staff view refs" ON public.integrity_references TO authenticated USING (EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND public.can_view_group(auth.uid(), s.group_id)));
  ELSE
    CREATE POLICY "staff view refs" ON public.integrity_references FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND public.can_view_group(auth.uid(), s.group_id)));
  END IF;
END
$schema$;

DO $schema$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'integrity_references' AND policyname = 'managers insert refs') THEN
    ALTER POLICY "managers insert refs" ON public.integrity_references TO authenticated WITH CHECK (created_by = auth.uid() AND EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND public.can_manage_group(auth.uid(), s.group_id)));
  ELSE
    CREATE POLICY "managers insert refs" ON public.integrity_references FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid() AND EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND public.can_manage_group(auth.uid(), s.group_id)));
  END IF;
END
$schema$;

DO $schema$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'integrity_references' AND policyname = 'managers delete refs') THEN
    ALTER POLICY "managers delete refs" ON public.integrity_references TO authenticated USING (EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND public.can_manage_group(auth.uid(), s.group_id)));
  ELSE
    CREATE POLICY "managers delete refs" ON public.integrity_references FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND public.can_manage_group(auth.uid(), s.group_id)));
  END IF;
END
$schema$;

DO $schema$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'integrity_alerts' AND policyname = 'staff view alerts') THEN
    ALTER POLICY "staff view alerts" ON public.integrity_alerts TO authenticated USING (EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND public.can_view_group(auth.uid(), s.group_id)));
  ELSE
    CREATE POLICY "staff view alerts" ON public.integrity_alerts FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND public.can_view_group(auth.uid(), s.group_id)));
  END IF;
END
$schema$;

DO $schema$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'integrity_alerts' AND policyname = 'staff update alerts') THEN
    ALTER POLICY "staff update alerts" ON public.integrity_alerts TO authenticated USING (EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND public.can_view_group(auth.uid(), s.group_id)));
  ELSE
    CREATE POLICY "staff update alerts" ON public.integrity_alerts FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND public.can_view_group(auth.uid(), s.group_id)));
  END IF;
END
$schema$;

DO $schema$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'deadlines' AND policyname = 'deadlines_write') THEN
    ALTER POLICY deadlines_write ON public.deadlines TO authenticated USING (
  (series_id IS NOT NULL AND public.manages_series(auth.uid(), series_id))
  OR (group_id IS NOT NULL AND public.can_manage_group(auth.uid(), group_id))
) WITH CHECK (
  (series_id IS NOT NULL AND public.manages_series(auth.uid(), series_id))
  OR (group_id IS NOT NULL AND public.can_manage_group(auth.uid(), group_id))
);
  ELSE
    CREATE POLICY deadlines_write ON public.deadlines FOR ALL TO authenticated USING (
  (series_id IS NOT NULL AND public.manages_series(auth.uid(), series_id))
  OR (group_id IS NOT NULL AND public.can_manage_group(auth.uid(), group_id))
) WITH CHECK (
  (series_id IS NOT NULL AND public.manages_series(auth.uid(), series_id))
  OR (group_id IS NOT NULL AND public.can_manage_group(auth.uid(), group_id))
);
  END IF;
END
$schema$;

DO $schema$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'review_annotations' AND policyname = 'ra_select') THEN
    ALTER POLICY ra_select ON public.review_annotations TO authenticated USING (
  EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND (s.user_id = auth.uid() OR public.can_view_group(auth.uid(), s.group_id)))
);
  ELSE
    CREATE POLICY ra_select ON public.review_annotations FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND (s.user_id = auth.uid() OR public.can_view_group(auth.uid(), s.group_id)))
);
  END IF;
END
$schema$;

DO $schema$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'review_annotations' AND policyname = 'ra_insert') THEN
    ALTER POLICY ra_insert ON public.review_annotations TO authenticated WITH CHECK (
  EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND public.can_manage_group(auth.uid(), s.group_id))
);
  ELSE
    CREATE POLICY ra_insert ON public.review_annotations FOR INSERT TO authenticated WITH CHECK (
  EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND public.can_manage_group(auth.uid(), s.group_id))
);
  END IF;
END
$schema$;

DO $schema$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'review_annotations' AND policyname = 'ra_delete') THEN
    ALTER POLICY ra_delete ON public.review_annotations TO authenticated USING (
  EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND public.can_manage_group(auth.uid(), s.group_id))
);
  ELSE
    CREATE POLICY ra_delete ON public.review_annotations FOR DELETE TO authenticated USING (
  EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND public.can_manage_group(auth.uid(), s.group_id))
);
  END IF;
END
$schema$;

DO $schema$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'grade_audit_logs' AND policyname = 'gal_select') THEN
    ALTER POLICY gal_select ON public.grade_audit_logs TO authenticated USING (
  EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND public.can_view_group(auth.uid(), s.group_id))
);
  ELSE
    CREATE POLICY gal_select ON public.grade_audit_logs FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND public.can_view_group(auth.uid(), s.group_id))
);
  END IF;
END
$schema$;

DO $schema$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'grade_audit_logs' AND policyname = 'gal_insert') THEN
    ALTER POLICY gal_insert ON public.grade_audit_logs TO authenticated WITH CHECK (
  EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND public.can_manage_group(auth.uid(), s.group_id))
);
  ELSE
    CREATE POLICY gal_insert ON public.grade_audit_logs FOR INSERT TO authenticated WITH CHECK (
  EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND public.can_manage_group(auth.uid(), s.group_id))
);
  END IF;
END
$schema$;

DO $schema$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'review_requests' AND policyname = 'rr_select') THEN
    ALTER POLICY rr_select ON public.review_requests TO authenticated USING (
  EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND (s.user_id = auth.uid() OR public.can_view_group(auth.uid(), s.group_id)))
);
  ELSE
    CREATE POLICY rr_select ON public.review_requests FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND (s.user_id = auth.uid() OR public.can_view_group(auth.uid(), s.group_id)))
);
  END IF;
END
$schema$;

DO $schema$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'review_requests' AND policyname = 'rr_insert') THEN
    ALTER POLICY rr_insert ON public.review_requests TO authenticated WITH CHECK (
  EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND s.user_id = auth.uid())
);
  ELSE
    CREATE POLICY rr_insert ON public.review_requests FOR INSERT TO authenticated WITH CHECK (
  EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND s.user_id = auth.uid())
);
  END IF;
END
$schema$;

DO $schema$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'review_requests' AND policyname = 'rr_update') THEN
    ALTER POLICY rr_update ON public.review_requests TO authenticated USING (
  EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND public.can_manage_group(auth.uid(), s.group_id))
) WITH CHECK (
  EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND public.can_manage_group(auth.uid(), s.group_id))
);
  ELSE
    CREATE POLICY rr_update ON public.review_requests FOR UPDATE TO authenticated USING (
  EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND public.can_manage_group(auth.uid(), s.group_id))
) WITH CHECK (
  EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND public.can_manage_group(auth.uid(), s.group_id))
);
  END IF;
END
$schema$;

DO $schema$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'exam_tokens' AND policyname = 'exam_tokens_staff') THEN
    ALTER POLICY exam_tokens_staff ON public.exam_tokens TO authenticated USING (public.can_manage_group(auth.uid(), group_id))
  WITH CHECK (public.can_manage_group(auth.uid(), group_id));
  ELSE
    CREATE POLICY exam_tokens_staff ON public.exam_tokens
  FOR ALL TO authenticated
  USING (public.can_manage_group(auth.uid(), group_id))
  WITH CHECK (public.can_manage_group(auth.uid(), group_id));
  END IF;
END
$schema$;

DO $schema$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'deadlines' AND policyname = 'deadlines_select') THEN
    ALTER POLICY deadlines_select ON public.deadlines TO authenticated USING (
  public.is_staff(auth.uid())
  OR (group_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.students s WHERE s.group_id = deadlines.group_id AND s.user_id = auth.uid()))
  OR (series_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.students s JOIN public.groups g ON g.id = s.group_id WHERE g.series_id = deadlines.series_id AND s.user_id = auth.uid()))
);
  ELSE
    CREATE POLICY deadlines_select ON public.deadlines FOR SELECT TO authenticated USING (
  public.is_staff(auth.uid())
  OR (group_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.students s WHERE s.group_id = deadlines.group_id AND s.user_id = auth.uid()))
  OR (series_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.students s JOIN public.groups g ON g.id = s.group_id WHERE g.series_id = deadlines.series_id AND s.user_id = auth.uid()))
);
  END IF;
END
$schema$;

-- Triggers are installed once; their functions above use CREATE OR REPLACE.
DO $schema$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.project_files'::regclass AND tgname = 'pf_guard_points' AND NOT tgisinternal) THEN
    CREATE TRIGGER pf_guard_points BEFORE UPDATE ON public.project_files FOR EACH ROW EXECUTE FUNCTION public.pf_guard_points();
  END IF;
END
$schema$;

DO $schema$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.project_files'::regclass AND tgname = 'trg_guard_project_file_points' AND NOT tgisinternal) THEN
    create trigger trg_guard_project_file_points before update on public.project_files
for each row execute function public.guard_project_file_points();
  END IF;
END
$schema$;

DO $schema$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.submissions'::regclass AND tgname = 'trg_enforce_submission_deadline' AND NOT tgisinternal) THEN
    CREATE TRIGGER trg_enforce_submission_deadline BEFORE INSERT ON public.submissions
FOR EACH ROW EXECUTE FUNCTION public.enforce_submission_deadline();
  END IF;
END
$schema$;

COMMIT;
