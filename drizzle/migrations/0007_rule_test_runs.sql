CREATE TABLE public.rule_test_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  series_id uuid REFERENCES public.series(id) ON DELETE CASCADE,
  tested_by uuid NOT NULL,
  candidate jsonb NOT NULL,
  baseline jsonb,
  results jsonb NOT NULL DEFAULT '[]'::jsonb,
  project_count integer NOT NULL DEFAULT 0,
  confirmed_count integer NOT NULL DEFAULT 0,
  rejected_count integer NOT NULL DEFAULT 0,
  activated boolean NOT NULL DEFAULT false,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.rule_test_runs TO authenticated;
GRANT ALL ON public.rule_test_runs TO service_role;
ALTER TABLE public.rule_test_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "managers read test runs" ON public.rule_test_runs FOR SELECT TO authenticated
  USING (CASE WHEN series_id IS NULL THEN public.has_role(auth.uid(),'admin') ELSE public.manages_series(auth.uid(), series_id) END);
CREATE POLICY "managers insert test runs" ON public.rule_test_runs FOR INSERT TO authenticated
  WITH CHECK (tested_by = auth.uid() AND CASE WHEN series_id IS NULL THEN public.has_role(auth.uid(),'admin') ELSE public.manages_series(auth.uid(), series_id) END);