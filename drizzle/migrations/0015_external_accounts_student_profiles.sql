CREATE OR REPLACE FUNCTION public.ensure_profile()
RETURNS SETOF public.app_role LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _email text;
  _name text;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT lower(email), coalesce(raw_user_meta_data->>'full_name', raw_user_meta_data->>'name') INTO _email, _name FROM auth.users WHERE id = _uid AND (email_confirmed_at IS NOT NULL OR confirmed_at IS NOT NULL);
  IF _email IS NULL OR position('@' in _email) < 2 THEN RAISE EXCEPTION 'verified_email_required'; END IF;
  INSERT INTO public.profiles(id,email,full_name) VALUES (_uid,_email,_name)
    ON CONFLICT (id) DO UPDATE SET email=excluded.email, full_name=coalesce(public.profiles.full_name,excluded.full_name);
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=_uid) THEN
    INSERT INTO public.user_roles(user_id,role) VALUES (_uid,'student') ON CONFLICT DO NOTHING;
  END IF;
  RETURN QUERY SELECT role FROM public.user_roles WHERE user_id=_uid;
END $$;
REVOKE EXECUTE ON FUNCTION public.ensure_profile() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.ensure_profile() TO authenticated;
COMMENT ON FUNCTION public.ensure_profile() IS 'Verified accounts from any email domain get a profile and student role only. Existing roles are preserved; first admin is provisioned separately by the secured setup flow.';