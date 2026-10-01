ALTER TABLE public.academic_years ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
CREATE POLICY "slots admin write" ON public.student_fabrication_slots FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "subs admin insert" ON public.submissions FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "subs admin delete" ON public.submissions FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE POLICY "pf admin delete" ON public.project_files FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));