create or replace function public.is_member(_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = _uid)
$$;

drop policy if exists "years read" on public.academic_years;
create policy "years read" on public.academic_years for select to authenticated using (public.is_member(auth.uid()));

drop policy if exists "series read" on public.series;
create policy "series read" on public.series for select to authenticated using (public.is_member(auth.uid()));

drop policy if exists "groups read" on public.groups;
create policy "groups read" on public.groups for select to authenticated using (public.is_member(auth.uid()));

drop policy if exists "drc settings read" on public.drc_settings;
create policy "drc settings read" on public.drc_settings for select to authenticated using (public.is_member(auth.uid()));

drop policy if exists "sm read" on public.series_managers;
create policy "sm read" on public.series_managers for select to authenticated using (user_id = auth.uid() or public.is_staff(auth.uid()));

drop policy if exists "gi read" on public.group_instructors;
create policy "gi read" on public.group_instructors for select to authenticated using (user_id = auth.uid() or public.is_staff(auth.uid()));