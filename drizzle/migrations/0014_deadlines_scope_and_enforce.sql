DROP POLICY IF EXISTS deadlines_select ON public.deadlines;
CREATE POLICY deadlines_select ON public.deadlines FOR SELECT TO authenticated USING (
  public.is_staff(auth.uid())
  OR (group_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.students s WHERE s.group_id = deadlines.group_id AND s.user_id = auth.uid()))
  OR (series_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.students s JOIN public.groups g ON g.id = s.group_id WHERE g.series_id = deadlines.series_id AND s.user_id = auth.uid()))
);

CREATE OR REPLACE FUNCTION public.enforce_submission_deadline()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _group uuid; _series uuid; _ext timestamptz; _hard timestamptz;
BEGIN
  IF NEW.kind <> 'OFFICIAL' OR public.is_staff(auth.uid()) OR auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT s.group_id, g.series_id, s.deadline_extension_until INTO _group, _series, _ext
    FROM public.students s JOIN public.groups g ON g.id = s.group_id WHERE s.id = NEW.student_id;
  SELECT hard_deadline INTO _hard FROM public.deadlines WHERE group_id = _group AND hard_deadline IS NOT NULL LIMIT 1;
  IF _hard IS NULL THEN
    SELECT hard_deadline INTO _hard FROM public.deadlines WHERE series_id = _series AND group_id IS NULL AND hard_deadline IS NOT NULL LIMIT 1;
  END IF;
  IF _ext IS NOT NULL AND (_hard IS NULL OR _ext > _hard) AND _hard IS NOT NULL THEN
    _hard := _ext;
  END IF;
  IF _hard IS NOT NULL AND now() > _hard THEN
    RAISE EXCEPTION 'Termenul limită pentru predarea oficială a expirat.';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_enforce_submission_deadline ON public.submissions;
CREATE TRIGGER trg_enforce_submission_deadline BEFORE INSERT ON public.submissions
FOR EACH ROW EXECUTE FUNCTION public.enforce_submission_deadline();