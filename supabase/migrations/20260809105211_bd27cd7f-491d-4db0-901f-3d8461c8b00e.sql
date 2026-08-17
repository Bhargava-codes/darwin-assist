-- 1. Employee attributes needed for eligibility checks
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS gender text;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS work_location text;

-- 2. Idempotency keys on mock-HRMS write targets
ALTER TABLE public.leave_requests ADD COLUMN IF NOT EXISTS idempotency_key text;
ALTER TABLE public.wfh_requests ADD COLUMN IF NOT EXISTS idempotency_key text;
ALTER TABLE public.attendance_regularizations ADD COLUMN IF NOT EXISTS idempotency_key text;
CREATE UNIQUE INDEX IF NOT EXISTS leave_requests_idem_key ON public.leave_requests (idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS wfh_requests_idem_key ON public.wfh_requests (idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS attendance_reg_idem_key ON public.attendance_regularizations (idempotency_key) WHERE idempotency_key IS NOT NULL;

-- 3. Payslips
CREATE TABLE public.payslips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  pay_month date NOT NULL,
  gross_amount numeric NOT NULL,
  net_amount numeric NOT NULL,
  deductions jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, pay_month)
);
GRANT SELECT ON public.payslips TO authenticated;
GRANT ALL ON public.payslips TO service_role;
ALTER TABLE public.payslips ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own_payslips" ON public.payslips FOR SELECT TO authenticated
  USING (employee_id = public.current_employee_id() OR public.is_hr_ops());

-- 4. Engine sessions / messages / trace
CREATE TABLE public.engine_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  baseline_mode boolean NOT NULL DEFAULT false,
  pending_action jsonb,
  turn_count integer NOT NULL DEFAULT 0,
  total_cost_usd numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_active_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.engine_sessions TO authenticated;
GRANT ALL ON public.engine_sessions TO service_role;
ALTER TABLE public.engine_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ops_only" ON public.engine_sessions FOR SELECT TO authenticated USING (public.is_hr_ops());

CREATE TABLE public.engine_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.engine_sessions(id) ON DELETE CASCADE,
  turn_index integer NOT NULL,
  role text NOT NULL,
  actor text,
  content text NOT NULL,
  chips jsonb NOT NULL DEFAULT '[]'::jsonb,
  citations jsonb NOT NULL DEFAULT '[]'::jsonb,
  receipt jsonb,
  verdict text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX engine_messages_session_idx ON public.engine_messages (session_id, turn_index, created_at);
GRANT SELECT ON public.engine_messages TO authenticated;
GRANT ALL ON public.engine_messages TO service_role;
ALTER TABLE public.engine_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ops_only" ON public.engine_messages FOR SELECT TO authenticated USING (public.is_hr_ops());

CREATE TABLE public.trace_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.engine_sessions(id) ON DELETE CASCADE,
  turn_index integer NOT NULL,
  step_index integer NOT NULL,
  actor text NOT NULL,
  action text NOT NULL,
  model text,
  mode text,
  tokens_in integer NOT NULL DEFAULT 0,
  tokens_out integer NOT NULL DEFAULT 0,
  latency_ms integer NOT NULL DEFAULT 0,
  cost_usd numeric NOT NULL DEFAULT 0,
  status text NOT NULL,
  payload jsonb,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX trace_events_session_idx ON public.trace_events (session_id, turn_index, step_index);
GRANT SELECT ON public.trace_events TO authenticated;
GRANT ALL ON public.trace_events TO service_role;
ALTER TABLE public.trace_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ops_only" ON public.trace_events FOR SELECT TO authenticated USING (public.is_hr_ops());

-- 5. Engine policy corpus (text-embedding-3-small, 1536 dims)
CREATE TABLE public.policy_chunks_small (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chunk_id text NOT NULL UNIQUE,
  section text NOT NULL,
  heading text NOT NULL,
  content text NOT NULL,
  object_tags text[] NOT NULL DEFAULT '{}'::text[],
  token_count integer,
  embedding vector(1536),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX policy_chunks_small_tags_idx ON public.policy_chunks_small USING gin (object_tags);
GRANT SELECT ON public.policy_chunks_small TO authenticated;
GRANT ALL ON public.policy_chunks_small TO service_role;
ALTER TABLE public.policy_chunks_small ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read_all" ON public.policy_chunks_small FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.match_policy_small(query_embedding vector, match_count integer DEFAULT 6)
RETURNS TABLE(chunk_id text, section text, heading text, content text, object_tags text[], similarity double precision)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  select p.chunk_id, p.section, p.heading, p.content, p.object_tags,
         1 - (p.embedding <=> query_embedding) as similarity
  from public.policy_chunks_small p
  where p.embedding is not null
  order by p.embedding <=> query_embedding
  limit match_count;
$$;

-- 6. Seed demo employees for the engine
INSERT INTO public.employees (id, employee_code, full_name, employment_type, date_of_joining, manager_name, geo, grade_band, gender, work_location, is_hr_ops)
VALUES
  ('11111111-1111-4111-8111-111111111111', 'EMP001', 'Priya Sharma', 'full_time', '2025-11-15', 'Anil Kumar', 'IN', 'L3', 'female', 'Noida', false),
  ('22222222-2222-4222-8222-222222222222', 'EMP002', 'Rahul Verma', 'full_time', (current_date - INTERVAL '30 days')::date, 'Anil Kumar', 'IN', 'L2', 'male', 'Noida', false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.leave_balances (employee_id, leave_code, cycle_year, entitled, used)
VALUES
  ('11111111-1111-4111-8111-111111111111', 'CL', EXTRACT(YEAR FROM current_date)::int, 12, 4),
  ('11111111-1111-4111-8111-111111111111', 'SL', EXTRACT(YEAR FROM current_date)::int, 12, 2),
  ('11111111-1111-4111-8111-111111111111', 'EL', EXTRACT(YEAR FROM current_date)::int, 18, 5.5),
  ('22222222-2222-4222-8222-222222222222', 'CL', EXTRACT(YEAR FROM current_date)::int, 12, 0),
  ('22222222-2222-4222-8222-222222222222', 'SL', EXTRACT(YEAR FROM current_date)::int, 12, 0),
  ('22222222-2222-4222-8222-222222222222', 'EL', EXTRACT(YEAR FROM current_date)::int, 0, 0);

-- Approved leave next month, for the OVERLAP demo
INSERT INTO public.leave_requests (employee_id, leave_code, start_date, end_date, working_days, reason, status)
VALUES ('11111111-1111-4111-8111-111111111111', 'CL',
        (date_trunc('month', current_date) + INTERVAL '1 month' + INTERVAL '14 days')::date,
        (date_trunc('month', current_date) + INTERVAL '1 month' + INTERVAL '15 days')::date,
        2, 'Family function', 'APPROVED');

-- Flagged day: missing clock-out
INSERT INTO public.attendance_records (employee_id, work_date, clock_in, clock_out, status, is_flagged, flag_reason)
VALUES ('11111111-1111-4111-8111-111111111111', (date_trunc('month', current_date) + INTERVAL '4 days')::date,
        '09:35', NULL, 'FLAGGED', true, 'Missing clock-out');

-- 6 WFH days used this month
INSERT INTO public.wfh_requests (employee_id, start_date, end_date, reason, status)
SELECT '11111111-1111-4111-8111-111111111111',
       (date_trunc('month', current_date) + (n || ' days')::interval)::date,
       (date_trunc('month', current_date) + (n || ' days')::interval)::date,
       'Focus day', 'APPROVED'
FROM generate_series(0, 5) AS n;

-- 2 regularizations used this month
INSERT INTO public.attendance_regularizations (employee_id, work_date, corrected_in, corrected_out, reason, status)
VALUES
  ('11111111-1111-4111-8111-111111111111', (date_trunc('month', current_date) + INTERVAL '1 day')::date, '09:30', '18:30', 'Forgot to clock out', 'APPROVED'),
  ('11111111-1111-4111-8111-111111111111', (date_trunc('month', current_date) + INTERVAL '2 days')::date, '09:15', '18:45', 'Badge reader down', 'APPROVED');

-- 3 payslips
INSERT INTO public.payslips (employee_id, pay_month, gross_amount, net_amount, deductions)
VALUES
  ('11111111-1111-4111-8111-111111111111', (date_trunc('month', current_date) - INTERVAL '1 month')::date, 125000, 104500, '{"pf": 7500, "tds": 11000, "prof_tax": 200}'::jsonb),
  ('11111111-1111-4111-8111-111111111111', (date_trunc('month', current_date) - INTERVAL '2 months')::date, 125000, 104500, '{"pf": 7500, "tds": 11000, "prof_tax": 200}'::jsonb),
  ('11111111-1111-4111-8111-111111111111', (date_trunc('month', current_date) - INTERVAL '3 months')::date, 125000, 104500, '{"pf": 7500, "tds": 11000, "prof_tax": 200}'::jsonb);