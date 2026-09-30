create type public.app_role as enum ('admin','series_manager','instructor','student','cam_tech');
create type public.project_variant as enum ('SMT','THT');

create table public.profiles (
  id uuid primary key,
  email text not null,
  full_name text,
  created_at timestamptz not null default now()
);
create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  role public.app_role not null,
  unique(user_id, role)
);
create table public.academic_years (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create table public.series (
  id uuid primary key default gen_random_uuid(),
  academic_year_id uuid not null references public.academic_years(id) on delete cascade,
  name text not null,
  default_variant public.project_variant not null default 'SMT',
  is_archived boolean not null default false,
  created_at timestamptz not null default now()
);
create table public.series_managers (
  id uuid primary key default gen_random_uuid(),
  series_id uuid not null references public.series(id) on delete cascade,
  user_id uuid not null,
  unique(series_id, user_id)
);
create table public.groups (
  id uuid primary key default gen_random_uuid(),
  series_id uuid not null references public.series(id) on delete cascade,
  name text not null,
  open_enrollment boolean not null default true,
  is_archived boolean not null default false,
  created_at timestamptz not null default now()
);
create table public.group_instructors (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null,
  unique(group_id, user_id)
);
create table public.students (
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
create table public.submissions (
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
create table public.audit_log (
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

create policy "profiles self or staff read" on public.profiles for select to authenticated using (id = auth.uid() or public.is_staff(auth.uid()));
create policy "profiles self update" on public.profiles for update to authenticated using (id = auth.uid());

create policy "roles self or staff read" on public.user_roles for select to authenticated using (user_id = auth.uid() or public.is_staff(auth.uid()));

create policy "years read" on public.academic_years for select to authenticated using (true);
create policy "years admin write" on public.academic_years for all to authenticated using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));

create policy "series read" on public.series for select to authenticated using (true);
create policy "series admin insert" on public.series for insert to authenticated with check (public.has_role(auth.uid(),'admin'));
create policy "series manage update" on public.series for update to authenticated using (public.manages_series(auth.uid(), id));
create policy "series admin delete" on public.series for delete to authenticated using (public.has_role(auth.uid(),'admin'));

create policy "sm read" on public.series_managers for select to authenticated using (true);
create policy "sm admin write" on public.series_managers for all to authenticated using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));

create policy "groups read" on public.groups for select to authenticated using (true);
create policy "groups manage insert" on public.groups for insert to authenticated with check (public.manages_series(auth.uid(), series_id));
create policy "groups manage update" on public.groups for update to authenticated using (public.manages_series(auth.uid(), series_id));
create policy "groups manage delete" on public.groups for delete to authenticated using (public.manages_series(auth.uid(), series_id));

create policy "gi read" on public.group_instructors for select to authenticated using (true);
create policy "gi manage write" on public.group_instructors for all to authenticated using (public.can_manage_group(auth.uid(), group_id)) with check (public.can_manage_group(auth.uid(), group_id));

create policy "students read" on public.students for select to authenticated using (user_id = auth.uid() or public.can_view_group(auth.uid(), group_id));
create policy "students self enroll" on public.students for insert to authenticated with check (
  (user_id = auth.uid() and status = 'pending')
  or public.can_manage_group(auth.uid(), group_id));
create policy "students staff update" on public.students for update to authenticated using (public.can_view_group(auth.uid(), group_id)) with check (public.can_view_group(auth.uid(), group_id));
create policy "students manage delete" on public.students for delete to authenticated using (public.can_manage_group(auth.uid(), group_id));

create policy "subs read" on public.submissions for select to authenticated using (
  user_id = auth.uid() or exists (select 1 from public.students s where s.id = student_id and public.can_view_group(auth.uid(), s.group_id)));
create policy "subs own insert" on public.submissions for insert to authenticated with check (
  user_id = auth.uid() and review_status = 'pending' and exists (select 1 from public.students s where s.id = student_id and s.user_id = auth.uid()));
create policy "subs staff update" on public.submissions for update to authenticated using (
  exists (select 1 from public.students s where s.id = student_id and public.can_view_group(auth.uid(), s.group_id)));

create policy "audit insert own" on public.audit_log for insert to authenticated with check (actor_id = auth.uid());
create policy "audit admin read" on public.audit_log for select to authenticated using (public.has_role(auth.uid(),'admin'));

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

create policy "gerbers own upload" on storage.objects for insert to authenticated with check (bucket_id = 'gerbers' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "gerbers read" on storage.objects for select to authenticated using (
  bucket_id = 'gerbers' and ((storage.foldername(name))[1] = auth.uid()::text or exists (
    select 1 from public.students s where s.user_id::text = (storage.foldername(name))[1] and public.can_view_group(auth.uid(), s.group_id))));

insert into public.academic_years(name) values ('2026-2027');