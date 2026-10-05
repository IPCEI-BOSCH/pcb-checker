-- Staff who manage the group can add files to a student's folders
create policy "pf manage insert" on public.project_files for insert to authenticated
with check (user_id = auth.uid() and exists (select 1 from public.students s where s.id = student_id and public.can_manage_group(auth.uid(), s.group_id)));

-- Only staff may set points/observations on folder files
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
drop trigger if exists trg_guard_project_file_points on public.project_files;
create trigger trg_guard_project_file_points before update on public.project_files
for each row execute function public.guard_project_file_points();

-- Staff can store files in the folder of a student they manage
create policy "gerbers manager upload" on storage.objects for insert to authenticated
with check (bucket_id = 'gerbers' and exists (select 1 from public.students s where s.user_id::text = (storage.foldername(name))[1] and public.can_manage_group(auth.uid(), s.group_id)));