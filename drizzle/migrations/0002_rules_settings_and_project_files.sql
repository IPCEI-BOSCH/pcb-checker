CREATE TABLE public.drc_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  series_id uuid REFERENCES public.series(id) ON DELETE CASCADE,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX drc_settings_scope_uidx ON public.drc_settings (coalesce(series_id, '00000000-0000-0000-0000-000000000000'::uuid));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.drc_settings TO authenticated;
GRANT ALL ON public.drc_settings TO service_role;
ALTER TABLE public.drc_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "drc settings read" ON public.drc_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "drc settings insert" ON public.drc_settings FOR INSERT TO authenticated
  WITH CHECK (CASE WHEN series_id IS NULL THEN public.has_role(auth.uid(),'admin') ELSE public.manages_series(auth.uid(), series_id) END);
CREATE POLICY "drc settings update" ON public.drc_settings FOR UPDATE TO authenticated
  USING (CASE WHEN series_id IS NULL THEN public.has_role(auth.uid(),'admin') ELSE public.manages_series(auth.uid(), series_id) END);
CREATE POLICY "drc settings delete" ON public.drc_settings FOR DELETE TO authenticated
  USING (CASE WHEN series_id IS NULL THEN public.has_role(auth.uid(),'admin') ELSE public.manages_series(auth.uid(), series_id) END);

CREATE TABLE public.project_files (
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
CREATE POLICY "pf read" ON public.project_files FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND public.can_view_group(auth.uid(), s.group_id)));
CREATE POLICY "pf insert own" ON public.project_files FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND points IS NULL AND EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND s.user_id = auth.uid()));
CREATE POLICY "pf update" ON public.project_files FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND public.can_view_group(auth.uid(), s.group_id)));
CREATE POLICY "pf delete own" ON public.project_files FOR DELETE TO authenticated
  USING (user_id = auth.uid() AND points IS NULL);

-- students may not grade themselves
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
CREATE TRIGGER pf_guard_points BEFORE UPDATE ON public.project_files FOR EACH ROW EXECUTE FUNCTION public.pf_guard_points();

CREATE POLICY "gerbers delete own" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'gerbers' AND (storage.foldername(name))[1] = auth.uid()::text);