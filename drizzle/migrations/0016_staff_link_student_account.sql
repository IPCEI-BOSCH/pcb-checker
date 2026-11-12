CREATE OR REPLACE FUNCTION public.link_student_account(_student uuid, _account uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _group uuid; _current uuid; _email text;
BEGIN
 SELECT group_id,user_id INTO _group,_current FROM public.students WHERE id=_student FOR UPDATE;
 IF _group IS NULL OR NOT public.can_manage_group(auth.uid(),_group) THEN RAISE EXCEPTION 'forbidden'; END IF;
 IF _current IS NOT NULL AND _current <> _account THEN RAISE EXCEPTION 'student_already_linked'; END IF;
 IF EXISTS(SELECT 1 FROM public.students WHERE user_id=_account AND id<>_student) THEN RAISE EXCEPTION 'account_already_linked'; END IF;
 SELECT email INTO _email FROM public.profiles WHERE id=_account;
 IF _email IS NULL OR NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=_account AND role='student') THEN RAISE EXCEPTION 'student_account_required'; END IF;
 UPDATE public.students SET user_id=_account,email=_email WHERE id=_student;
 INSERT INTO public.audit_log(actor_id,action,target_entity,target_id,details) VALUES(auth.uid(),'STUDENT_ACCOUNT_LINK','student',_student,jsonb_build_object('account_id',_account));
END $$;
REVOKE EXECUTE ON FUNCTION public.link_student_account(uuid,uuid) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.link_student_account(uuid,uuid) TO authenticated;