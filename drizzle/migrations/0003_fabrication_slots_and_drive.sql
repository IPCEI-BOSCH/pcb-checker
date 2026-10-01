ALTER TABLE public.students ADD COLUMN IF NOT EXISTS drive_folder_id text, ADD COLUMN IF NOT EXISTS drive_layout_folder_id text, ADD COLUMN IF NOT EXISTS drive_project_folder_id text;
ALTER TABLE public.project_files ADD COLUMN IF NOT EXISTS drive_file_id text;

CREATE TABLE public.student_fabrication_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  slot_key text NOT NULL CHECK (slot_key IN ('BO','BOTTOM','DRILL','FAB','SMBOT','SMTOP','SPTOP','SSTOP','TOP')),
  file_name text NOT NULL,
  storage_path text NOT NULL,
  drive_file_id text,
  size_bytes bigint NOT NULL DEFAULT 0,
  uploaded_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (student_id, slot_key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.student_fabrication_slots TO authenticated;
GRANT ALL ON public.student_fabrication_slots TO service_role;
ALTER TABLE public.student_fabrication_slots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "slots read" ON public.student_fabrication_slots FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND (s.user_id = auth.uid() OR public.can_view_group(auth.uid(), s.group_id) OR public.has_role(auth.uid(),'cam_tech'))));
CREATE POLICY "slots own insert" ON public.student_fabrication_slots FOR INSERT TO authenticated
  WITH CHECK (uploaded_by = auth.uid() AND EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND s.user_id = auth.uid()));
CREATE POLICY "slots own update" ON public.student_fabrication_slots FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND s.user_id = auth.uid()))
  WITH CHECK (uploaded_by = auth.uid());
CREATE POLICY "slots own delete" ON public.student_fabrication_slots FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND s.user_id = auth.uid()));