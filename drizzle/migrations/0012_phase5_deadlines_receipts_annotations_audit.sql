-- Termene-limită per serie sau grupă
CREATE TABLE public.deadlines (
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
CREATE UNIQUE INDEX deadlines_series_uidx ON public.deadlines (series_id) WHERE group_id IS NULL;
CREATE UNIQUE INDEX deadlines_group_uidx ON public.deadlines (group_id) WHERE group_id IS NOT NULL;
GRANT SELECT ON public.deadlines TO authenticated;
GRANT ALL ON public.deadlines TO service_role;
ALTER TABLE public.deadlines ENABLE ROW LEVEL SECURITY;
CREATE POLICY deadlines_select ON public.deadlines FOR SELECT TO authenticated USING (true);
CREATE POLICY deadlines_write ON public.deadlines FOR ALL TO authenticated USING (
  (series_id IS NOT NULL AND public.manages_series(auth.uid(), series_id))
  OR (group_id IS NOT NULL AND public.can_manage_group(auth.uid(), group_id))
) WITH CHECK (
  (series_id IS NOT NULL AND public.manages_series(auth.uid(), series_id))
  OR (group_id IS NOT NULL AND public.can_manage_group(auth.uid(), group_id))
);

-- Derogare individuală + nota de interviu
ALTER TABLE public.students ADD COLUMN deadline_extension_until timestamptz;
ALTER TABLE public.students ADD COLUMN grade_interview numeric;

-- Recipisă criptografică + întârziere
ALTER TABLE public.submissions ADD COLUMN zip_sha256 text;
ALTER TABLE public.submissions ADD COLUMN report_sha256 text;
ALTER TABLE public.submissions ADD COLUMN late_days integer;

-- Adnotări spațiale (X,Y) pe placă
CREATE TABLE public.review_annotations (
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
CREATE POLICY ra_select ON public.review_annotations FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND (s.user_id = auth.uid() OR public.can_view_group(auth.uid(), s.group_id)))
);
CREATE POLICY ra_insert ON public.review_annotations FOR INSERT TO authenticated WITH CHECK (
  EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND public.can_manage_group(auth.uid(), s.group_id))
);
CREATE POLICY ra_delete ON public.review_annotations FOR DELETE TO authenticated USING (
  EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND public.can_manage_group(auth.uid(), s.group_id))
);

-- Jurnal de audit al notelor
CREATE TABLE public.grade_audit_logs (
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
CREATE POLICY gal_select ON public.grade_audit_logs FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND public.can_view_group(auth.uid(), s.group_id))
);
CREATE POLICY gal_insert ON public.grade_audit_logs FOR INSERT TO authenticated WITH CHECK (
  EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND public.can_manage_group(auth.uid(), s.group_id))
);

-- Solicitări de reevaluare / contestații
CREATE TABLE public.review_requests (
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
CREATE POLICY rr_select ON public.review_requests FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND (s.user_id = auth.uid() OR public.can_view_group(auth.uid(), s.group_id)))
);
CREATE POLICY rr_insert ON public.review_requests FOR INSERT TO authenticated WITH CHECK (
  EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND s.user_id = auth.uid())
);
CREATE POLICY rr_update ON public.review_requests FOR UPDATE TO authenticated USING (
  EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND public.can_manage_group(auth.uid(), s.group_id))
) WITH CHECK (
  EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND public.can_manage_group(auth.uid(), s.group_id))
);