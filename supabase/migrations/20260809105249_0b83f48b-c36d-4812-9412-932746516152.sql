REVOKE EXECUTE ON FUNCTION public.match_policy_small(vector, integer) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.match_policy_small(vector, integer) TO authenticated, service_role;