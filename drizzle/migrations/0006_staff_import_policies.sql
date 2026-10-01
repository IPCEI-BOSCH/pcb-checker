CREATE POLICY "subs manager insert" ON public.submissions FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND EXISTS (SELECT 1 FROM public.students s WHERE s.id = submissions.student_id AND public.can_manage_group(auth.uid(), s.group_id)));
CREATE POLICY "slots manager insert" ON public.student_fabrication_slots FOR INSERT TO authenticated
  WITH CHECK (uploaded_by = auth.uid() AND EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_fabrication_slots.student_id AND public.can_manage_group(auth.uid(), s.group_id)));
CREATE POLICY "slots manager update" ON public.student_fabrication_slots FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_fabrication_slots.student_id AND public.can_manage_group(auth.uid(), s.group_id)))
  WITH CHECK (uploaded_by = auth.uid());