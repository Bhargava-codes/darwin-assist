-- 1) Owner-scoped read access for engine session data (HR Ops keeps existing ops_only policy)
CREATE POLICY "own_sessions_select" ON public.engine_sessions
  FOR SELECT TO authenticated
  USING (employee_id = public.current_employee_id());

CREATE POLICY "own_messages_select" ON public.engine_messages
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.engine_sessions s
    WHERE s.id = engine_messages.session_id
      AND s.employee_id = public.current_employee_id()
  ));

CREATE POLICY "own_trace_events_select" ON public.trace_events
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.engine_sessions s
    WHERE s.id = trace_events.session_id
      AND s.employee_id = public.current_employee_id()
  ));

-- 2) Retrieval RPCs are only ever called by trusted server-side code (service role).
REVOKE EXECUTE ON FUNCTION public.match_policy_small(vector, integer, double precision) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.match_policy_chunks(vector, double precision, integer, text[], text) FROM PUBLIC, anon, authenticated;