ALTER TABLE public.groups ADD COLUMN exam_mode boolean NOT NULL DEFAULT false;

CREATE TABLE public.exam_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  code text NOT NULL,
  label text,
  expires_at timestamptz NOT NULL,
  used_by uuid,
  used_at timestamptz,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (group_id, code)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.exam_tokens TO authenticated;
GRANT ALL ON public.exam_tokens TO service_role;

ALTER TABLE public.exam_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY exam_tokens_staff ON public.exam_tokens
  FOR ALL TO authenticated
  USING (public.can_manage_group(auth.uid(), group_id))
  WITH CHECK (public.can_manage_group(auth.uid(), group_id));

CREATE OR REPLACE FUNCTION public.redeem_exam_token(_code text, _student uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t public.exam_tokens%ROWTYPE;
  ok boolean;
BEGIN
  SELECT * INTO t FROM public.exam_tokens
   WHERE code = upper(trim(_code))
   ORDER BY created_at DESC
   LIMIT 1;
  IF NOT FOUND THEN RETURN false; END IF;
  IF t.used_at IS NOT NULL OR t.expires_at < now() THEN RETURN false; END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.students s
    WHERE s.id = _student AND s.group_id = t.group_id AND s.user_id = auth.uid()
  ) INTO ok;
  IF NOT ok THEN RETURN false; END IF;
  UPDATE public.exam_tokens SET used_by = auth.uid(), used_at = now() WHERE id = t.id;
  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.redeem_exam_token(text, uuid) TO authenticated;