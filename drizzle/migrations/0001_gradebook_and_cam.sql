-- Manual (teacher-owned) grade columns on students. Never overwritten by sheet sync.
ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS grade_schema numeric,
  ADD COLUMN IF NOT EXISTS grade_doc numeric,
  ADD COLUMN IF NOT EXISTS grade_final numeric,
  ADD COLUMN IF NOT EXISTS teacher_notes text;

COMMENT ON COLUMN public.students.grade_schema IS 'Manual column: protected during Google Sheets / Excel sync.';
COMMENT ON COLUMN public.students.grade_doc IS 'Manual column: protected during Google Sheets / Excel sync.';
COMMENT ON COLUMN public.students.grade_final IS 'Manual column: protected during Google Sheets / Excel sync.';
COMMENT ON COLUMN public.students.teacher_notes IS 'Manual column: protected during Google Sheets / Excel sync.';

-- Spreadsheet binding per series (CEF2-Proiect_Situatie)
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

CREATE POLICY "sheet links read" ON public.sheet_links FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "sheet links manage" ON public.sheet_links FOR ALL TO authenticated
  USING (public.manages_series(auth.uid(), series_id))
  WITH CHECK (public.manages_series(auth.uid(), series_id));

-- CAM panel jobs
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

CREATE POLICY "cam panels read" ON public.cam_panels FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()) OR public.has_role(auth.uid(), 'cam_tech'::app_role));
CREATE POLICY "cam panels insert" ON public.cam_panels FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid() AND (public.manages_series(auth.uid(), series_id) OR public.has_role(auth.uid(), 'cam_tech'::app_role)));
CREATE POLICY "cam panels update" ON public.cam_panels FOR UPDATE TO authenticated
  USING (public.manages_series(auth.uid(), series_id) OR public.has_role(auth.uid(), 'cam_tech'::app_role));
CREATE POLICY "cam panels delete" ON public.cam_panels FOR DELETE TO authenticated
  USING (public.manages_series(auth.uid(), series_id) OR public.has_role(auth.uid(), 'admin'::app_role));