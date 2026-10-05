CREATE TABLE public.layout_fingerprints (
  submission_id uuid PRIMARY KEY REFERENCES public.submissions(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  version integer NOT NULL,
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX layout_fingerprints_student_idx ON public.layout_fingerprints(student_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.layout_fingerprints TO authenticated;
GRANT ALL ON public.layout_fingerprints TO service_role;
ALTER TABLE public.layout_fingerprints ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff view fingerprints" ON public.layout_fingerprints FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND public.can_view_group(auth.uid(), s.group_id)));
CREATE POLICY "staff insert fingerprints" ON public.layout_fingerprints FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND public.can_view_group(auth.uid(), s.group_id)));
CREATE POLICY "staff update fingerprints" ON public.layout_fingerprints FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND public.can_view_group(auth.uid(), s.group_id)));
CREATE POLICY "managers delete fingerprints" ON public.layout_fingerprints FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND public.can_manage_group(auth.uid(), s.group_id)));

CREATE TABLE public.integrity_reviews (
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
CREATE POLICY "staff view reviews" ON public.integrity_reviews FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_a AND public.can_view_group(auth.uid(), s.group_id)));
CREATE POLICY "staff write reviews" ON public.integrity_reviews FOR INSERT TO authenticated
  WITH CHECK (reviewed_by = auth.uid() AND EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_a AND public.can_view_group(auth.uid(), s.group_id)));
CREATE POLICY "staff update reviews" ON public.integrity_reviews FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_a AND public.can_view_group(auth.uid(), s.group_id)))
  WITH CHECK (reviewed_by = auth.uid());
CREATE POLICY "staff delete reviews" ON public.integrity_reviews FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_a AND public.can_view_group(auth.uid(), s.group_id)));