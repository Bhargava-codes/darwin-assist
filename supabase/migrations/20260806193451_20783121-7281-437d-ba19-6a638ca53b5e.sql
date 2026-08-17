revoke all on function public.current_employee_id() from public, anon;
revoke all on function public.is_hr_ops() from public, anon;
revoke all on function public.tenure_months(uuid) from public, anon;
revoke all on function public.match_policy_chunks(vector, float, int, text[], text) from public, anon;
grant execute on function public.current_employee_id() to authenticated, service_role;
grant execute on function public.is_hr_ops() to authenticated, service_role;
grant execute on function public.tenure_months(uuid) to authenticated, service_role;
grant execute on function public.match_policy_chunks(vector, float, int, text[], text) to authenticated, service_role;