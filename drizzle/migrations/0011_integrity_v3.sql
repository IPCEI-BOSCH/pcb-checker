CREATE TABLE public.layout_similarity_pairs (
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
CREATE POLICY "staff view pairs" ON public.layout_similarity_pairs FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.students s WHERE s.id IN (student_a, student_b) AND public.can_view_group(auth.uid(), s.group_id)));
CREATE POLICY "staff insert pairs" ON public.layout_similarity_pairs FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.students s WHERE s.id IN (student_a, student_b) AND public.can_view_group(auth.uid(), s.group_id)));
CREATE POLICY "staff update pairs" ON public.layout_similarity_pairs FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.students s WHERE s.id IN (student_a, student_b) AND public.can_view_group(auth.uid(), s.group_id)));
CREATE POLICY "managers delete pairs" ON public.layout_similarity_pairs FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.students s WHERE s.id IN (student_a, student_b) AND public.can_manage_group(auth.uid(), s.group_id)));

CREATE TABLE public.integrity_references (
  student_id uuid PRIMARY KEY REFERENCES public.students(id) ON DELETE CASCADE,
  note text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.integrity_references TO authenticated;
GRANT ALL ON public.integrity_references TO service_role;
ALTER TABLE public.integrity_references ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff view refs" ON public.integrity_references FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND public.can_view_group(auth.uid(), s.group_id)));
CREATE POLICY "managers insert refs" ON public.integrity_references FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid() AND EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND public.can_manage_group(auth.uid(), s.group_id)));
CREATE POLICY "managers delete refs" ON public.integrity_references FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND public.can_manage_group(auth.uid(), s.group_id)));

CREATE TABLE public.integrity_alerts (
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
CREATE POLICY "staff view alerts" ON public.integrity_alerts FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND public.can_view_group(auth.uid(), s.group_id)));
CREATE POLICY "staff update alerts" ON public.integrity_alerts FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND public.can_view_group(auth.uid(), s.group_id)));