create extension if not exists "uuid-ossp";
create extension if not exists vector;

create type public.employment_type   as enum ('full_time','contract','intern');
create type public.leave_code        as enum ('CL','SL','EL','ML','PL','BL','UL');
create type public.request_status    as enum ('PENDING','APPROVED','REJECTED','CANCELLED');
create type public.policy_area       as enum ('LEAVE','ATTENDANCE','WFH');
create type public.agent_name        as enum ('agent_1','agent_2','agent_3');
create type public.verdict_type      as enum ('FULL','PARTIAL','NONE','UNKNOWN');
create type public.conv_outcome      as enum ('ACTIVE','RESOLVED','ESCALATED','ABANDONED');
create type public.message_role      as enum ('user','assistant');
create type public.tool_risk         as enum ('LOW','MEDIUM','HIGH');
create type public.attendance_status as enum ('PRESENT','ABSENT','FLAGGED','WFH','LEAVE','HALF_DAY');

create table public.employees (
  id                uuid primary key default uuid_generate_v4(),
  auth_user_id      uuid unique,
  employee_code     text unique not null,
  full_name         text not null,
  employment_type   public.employment_type not null default 'full_time',
  date_of_joining   date not null,
  manager_name      text,
  geo               text not null default 'IN',
  grade_band        text,
  is_hr_ops         boolean not null default false,
  created_at        timestamptz not null default now()
);
grant select, insert, update, delete on public.employees to authenticated;
grant all on public.employees to service_role;
alter table public.employees enable row level security;

create or replace function public.current_employee_id()
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.employees where auth_user_id = auth.uid() limit 1;
$$;

create or replace function public.is_hr_ops()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_hr_ops from public.employees where auth_user_id = auth.uid() limit 1), false);
$$;

create or replace function public.tenure_months(emp uuid)
returns int language sql stable security definer set search_path = public as $$
  select (extract(year from age(now(), date_of_joining)) * 12
        + extract(month from age(now(), date_of_joining)))::int
  from public.employees where id = emp;
$$;

create policy own_employee on public.employees
  for select to authenticated using (auth_user_id = auth.uid() or public.is_hr_ops());

create table public.leave_balances (
  id            uuid primary key default uuid_generate_v4(),
  employee_id   uuid not null references public.employees(id) on delete cascade,
  leave_code    public.leave_code not null,
  cycle_year    int not null,
  entitled      numeric(5,1) not null default 0,
  used          numeric(5,1) not null default 0,
  available     numeric(5,1) generated always as (entitled - used) stored,
  updated_at    timestamptz not null default now(),
  unique (employee_id, leave_code, cycle_year)
);
grant select, insert, update, delete on public.leave_balances to authenticated;
grant all on public.leave_balances to service_role;
alter table public.leave_balances enable row level security;
create policy own_rows on public.leave_balances for all to authenticated
  using (employee_id = public.current_employee_id() or public.is_hr_ops())
  with check (employee_id = public.current_employee_id() or public.is_hr_ops());

create table public.leave_requests (
  id            uuid primary key default uuid_generate_v4(),
  employee_id   uuid not null references public.employees(id) on delete cascade,
  leave_code    public.leave_code not null,
  start_date    date not null,
  end_date      date not null,
  working_days  numeric(4,1) not null,
  half_day      text check (half_day in ('FIRST_HALF','SECOND_HALF')),
  reason        text,
  status        public.request_status not null default 'PENDING',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (end_date >= start_date)
);
grant select, insert, update, delete on public.leave_requests to authenticated;
grant all on public.leave_requests to service_role;
alter table public.leave_requests enable row level security;
create policy own_rows on public.leave_requests for all to authenticated
  using (employee_id = public.current_employee_id() or public.is_hr_ops())
  with check (employee_id = public.current_employee_id() or public.is_hr_ops());

create table public.attendance_records (
  id            uuid primary key default uuid_generate_v4(),
  employee_id   uuid not null references public.employees(id) on delete cascade,
  work_date     date not null,
  clock_in      time,
  clock_out     time,
  status        public.attendance_status not null default 'PRESENT',
  is_flagged    boolean not null default false,
  flag_reason   text,
  regularized   boolean not null default false,
  unique (employee_id, work_date)
);
grant select, insert, update, delete on public.attendance_records to authenticated;
grant all on public.attendance_records to service_role;
alter table public.attendance_records enable row level security;
create policy own_rows on public.attendance_records for all to authenticated
  using (employee_id = public.current_employee_id() or public.is_hr_ops())
  with check (employee_id = public.current_employee_id() or public.is_hr_ops());

create table public.attendance_regularizations (
  id                uuid primary key default uuid_generate_v4(),
  employee_id       uuid not null references public.employees(id) on delete cascade,
  work_date         date not null,
  corrected_in      time,
  corrected_out     time,
  reason            text not null,
  status            public.request_status not null default 'PENDING',
  created_at        timestamptz not null default now()
);
grant select, insert, update, delete on public.attendance_regularizations to authenticated;
grant all on public.attendance_regularizations to service_role;
alter table public.attendance_regularizations enable row level security;
create policy own_rows on public.attendance_regularizations for all to authenticated
  using (employee_id = public.current_employee_id() or public.is_hr_ops())
  with check (employee_id = public.current_employee_id() or public.is_hr_ops());

create table public.wfh_requests (
  id            uuid primary key default uuid_generate_v4(),
  employee_id   uuid not null references public.employees(id) on delete cascade,
  start_date    date not null,
  end_date      date not null,
  reason        text,
  status        public.request_status not null default 'PENDING',
  created_at    timestamptz not null default now(),
  check (end_date >= start_date)
);
grant select, insert, update, delete on public.wfh_requests to authenticated;
grant all on public.wfh_requests to service_role;
alter table public.wfh_requests enable row level security;
create policy own_rows on public.wfh_requests for all to authenticated
  using (employee_id = public.current_employee_id() or public.is_hr_ops())
  with check (employee_id = public.current_employee_id() or public.is_hr_ops());

create table public.conversations (
  id              uuid primary key default uuid_generate_v4(),
  employee_id     uuid not null references public.employees(id) on delete cascade,
  started_at      timestamptz not null default now(),
  last_active_at  timestamptz not null default now(),
  outcome         public.conv_outcome not null default 'ACTIVE',
  turn_count      int not null default 0,
  title           text,
  total_cost_usd  numeric(10,6) not null default 0,
  total_tokens    int not null default 0
);
grant select, insert, update, delete on public.conversations to authenticated;
grant all on public.conversations to service_role;
alter table public.conversations enable row level security;
create policy own_rows on public.conversations for all to authenticated
  using (employee_id = public.current_employee_id() or public.is_hr_ops())
  with check (employee_id = public.current_employee_id() or public.is_hr_ops());

create table public.messages (
  id               uuid primary key default uuid_generate_v4(),
  conversation_id  uuid not null references public.conversations(id) on delete cascade,
  turn_index       int not null,
  role             public.message_role not null,
  content          text not null,
  chips            jsonb,
  clause_refs      jsonb,
  card_type        text,
  verdict          public.verdict_type,
  pending          jsonb,
  created_at       timestamptz not null default now(),
  unique (conversation_id, turn_index, role)
);
grant select, insert, update, delete on public.messages to authenticated;
grant all on public.messages to service_role;
alter table public.messages enable row level security;
create policy via_conversation on public.messages for all to authenticated
  using (exists (select 1 from public.conversations c where c.id = messages.conversation_id
    and (c.employee_id = public.current_employee_id() or public.is_hr_ops())))
  with check (exists (select 1 from public.conversations c where c.id = messages.conversation_id
    and (c.employee_id = public.current_employee_id() or public.is_hr_ops())));

create table public.session_slots (
  conversation_id       uuid primary key references public.conversations(id) on delete cascade,
  current_intent        text,
  slots                 jsonb not null default '{}'::jsonb,
  missing_slots         text[] not null default '{}',
  pending_confirmation  jsonb,
  paused_intent         text,
  paused_slots          jsonb,
  probe_count           int not null default 0,
  last_tool_error       text,
  updated_at            timestamptz not null default now()
);
grant select, insert, update, delete on public.session_slots to authenticated;
grant all on public.session_slots to service_role;
alter table public.session_slots enable row level security;
create policy via_conversation on public.session_slots for all to authenticated
  using (exists (select 1 from public.conversations c where c.id = session_slots.conversation_id
    and (c.employee_id = public.current_employee_id() or public.is_hr_ops())))
  with check (exists (select 1 from public.conversations c where c.id = session_slots.conversation_id
    and (c.employee_id = public.current_employee_id() or public.is_hr_ops())));

create table public.turn_traces (
  id                  uuid primary key default uuid_generate_v4(),
  conversation_id     uuid not null references public.conversations(id) on delete cascade,
  turn_index          int not null,
  user_input          text not null,
  intent              text,
  verdict             public.verdict_type,
  d_line_fired        text,
  agents_called       public.agent_name[] not null default '{}',
  confirmation_token  boolean not null default false,
  path                text,
  total_latency_ms    int,
  total_tokens        int,
  cost_optimized_usd  numeric(10,6),
  cost_baseline_usd   numeric(10,6),
  created_at          timestamptz not null default now(),
  unique (conversation_id, turn_index)
);
grant select on public.turn_traces to authenticated;
grant all on public.turn_traces to service_role;
alter table public.turn_traces enable row level security;
create policy ops_only on public.turn_traces for select to authenticated using (public.is_hr_ops());

create table public.agent_steps (
  id              uuid primary key default uuid_generate_v4(),
  trace_id        uuid not null references public.turn_traces(id) on delete cascade,
  step_index      int not null,
  agent           public.agent_name not null,
  role            text,
  model           text not null,
  input_summary   text,
  output_summary  text,
  raw_input       jsonb,
  raw_output      jsonb,
  tokens_in       int not null default 0,
  tokens_cached   int not null default 0,
  tokens_out      int not null default 0,
  latency_ms      int,
  started_at      timestamptz,
  cost_usd        numeric(10,6)
);
grant select on public.agent_steps to authenticated;
grant all on public.agent_steps to service_role;
alter table public.agent_steps enable row level security;
create policy ops_only on public.agent_steps for select to authenticated using (public.is_hr_ops());

create table public.retrieval_logs (
  id             uuid primary key default uuid_generate_v4(),
  trace_id       uuid not null references public.turn_traces(id) on delete cascade,
  query_text     text not null,
  subjects       text[] not null default '{}',
  threshold      numeric(4,3) not null,
  chunks         jsonb not null,
  status         text not null,
  mode           text,
  model          text,
  latency_ms     int,
  max_similarity numeric(4,3)
);
grant select on public.retrieval_logs to authenticated;
grant all on public.retrieval_logs to service_role;
alter table public.retrieval_logs enable row level security;
create policy ops_only on public.retrieval_logs for select to authenticated using (public.is_hr_ops());

create table public.tool_calls (
  id            uuid primary key default uuid_generate_v4(),
  trace_id      uuid not null references public.turn_traces(id) on delete cascade,
  tool_name     text not null,
  risk          public.tool_risk not null,
  params        jsonb not null,
  result        jsonb,
  error_code    text,
  error_message text,
  attempts      int not null default 0,
  latency_ms    int
);
grant select on public.tool_calls to authenticated;
grant all on public.tool_calls to service_role;
alter table public.tool_calls enable row level security;
create policy ops_only on public.tool_calls for select to authenticated using (public.is_hr_ops());

create table public.hr_tickets (
  id              uuid primary key default uuid_generate_v4(),
  employee_id     uuid not null references public.employees(id) on delete cascade,
  conversation_id uuid,
  turn_id         uuid,
  question        text not null,
  offramp_code    text not null,
  d_line          text,
  status          text not null default 'OPEN',
  created_at      timestamptz not null default now()
);
grant select, insert, update, delete on public.hr_tickets to authenticated;
grant all on public.hr_tickets to service_role;
alter table public.hr_tickets enable row level security;
create policy own_rows on public.hr_tickets for all to authenticated
  using (employee_id = public.current_employee_id() or public.is_hr_ops())
  with check (employee_id = public.current_employee_id() or public.is_hr_ops());

create table public.policy_chunks (
  id              uuid primary key default uuid_generate_v4(),
  policy_version  text not null,
  clause_id       text not null,
  policy_area     public.policy_area not null,
  subject         text not null,
  heading         text not null,
  content         text not null,
  token_count     int,
  embedding       vector(1536),
  created_at      timestamptz not null default now(),
  unique (policy_version, clause_id)
);
grant select on public.policy_chunks to authenticated;
grant all on public.policy_chunks to service_role;
alter table public.policy_chunks enable row level security;
create policy read_all on public.policy_chunks for select to authenticated using (true);

create index policy_chunks_embedding_idx on public.policy_chunks
  using ivfflat (embedding vector_cosine_ops) with (lists = 10);
create index policy_chunks_subject_idx on public.policy_chunks (policy_version, subject);

create or replace function public.match_policy_chunks(
  query_embedding vector(1536),
  match_threshold float default 0.0,
  match_count     int default 6,
  filter_subjects text[] default null,
  version         text default 'FY26-v2'
)
returns table (
  clause_id  text,
  subject    text,
  heading    text,
  content    text,
  similarity float
)
language sql stable security definer set search_path = public as $$
  select pc.clause_id, pc.subject, pc.heading, pc.content,
         1 - (pc.embedding <=> query_embedding) as similarity
  from public.policy_chunks pc
  where pc.policy_version = version
    and pc.embedding is not null
    and (filter_subjects is null or pc.subject = any(filter_subjects))
    and 1 - (pc.embedding <=> query_embedding) > match_threshold
  order by pc.embedding <=> query_embedding
  limit match_count;
$$;

create index messages_conversation_idx on public.messages (conversation_id, turn_index);
create index turn_traces_conversation_idx on public.turn_traces (conversation_id, turn_index);
create index agent_steps_trace_idx on public.agent_steps (trace_id, step_index);
create index tool_calls_trace_idx on public.tool_calls (trace_id);
create index retrieval_logs_trace_idx on public.retrieval_logs (trace_id);
create index leave_requests_employee_idx on public.leave_requests (employee_id, status, start_date);
create index attendance_records_employee_idx on public.attendance_records (employee_id, work_date);
create index wfh_requests_employee_idx on public.wfh_requests (employee_id, start_date);
create index conversations_employee_idx on public.conversations (employee_id, last_active_at desc);

create view public.ops_conversations with (security_invoker = on) as
select c.id, c.started_at, c.last_active_at, c.outcome, c.turn_count,
       c.title, c.total_cost_usd, c.total_tokens,
       e.employee_code, e.full_name
from public.conversations c
join public.employees e on e.id = c.employee_id;
grant select on public.ops_conversations to authenticated;

create view public.ops_coverage_gaps with (security_invoker = on) as
select rl.query_text,
       count(*)               as ask_count,
       max(rl.max_similarity) as best_similarity,
       max(tt.created_at)     as last_asked
from public.retrieval_logs rl
join public.turn_traces tt on tt.id = rl.trace_id
where rl.status = 'NOT_IN_POLICY'
group by rl.query_text
order by ask_count desc;
grant select on public.ops_coverage_gaps to authenticated;

create view public.ops_grounding with (security_invoker = on) as
select (rl.chunks -> 0 ->> 'clause_id') as top_clause,
       count(*)                         as citation_count,
       avg(rl.max_similarity)           as avg_similarity,
       sum(case when rl.status = 'NOT_IN_POLICY' then 1 else 0 end) as abstentions
from public.retrieval_logs rl
group by 1
order by citation_count desc;
grant select on public.ops_grounding to authenticated;

create view public.ops_cost_summary with (security_invoker = on) as
select date_trunc('day', tt.created_at) as day,
       count(*)                         as turns,
       sum(tt.cost_optimized_usd)       as optimized_usd,
       sum(tt.cost_baseline_usd)        as baseline_usd,
       round(100 * (1 - sum(tt.cost_optimized_usd) / nullif(sum(tt.cost_baseline_usd), 0)), 1) as pct_saved
from public.turn_traces tt
group by 1
order by 1 desc;
grant select on public.ops_cost_summary to authenticated;

insert into public.employees (employee_code, full_name, employment_type, date_of_joining, manager_name, geo, grade_band, is_hr_ops)
values ('E-4471', 'Bhargava', 'full_time', (current_date - interval '26 months')::date, 'Priya Nair', 'IN', 'B2', true);

insert into public.leave_balances (employee_id, leave_code, cycle_year, entitled, used)
select e.id, v.code::public.leave_code, extract(year from current_date)::int, v.entitled, v.used
from public.employees e,
  (values ('CL', 12, 4), ('SL', 12, 2), ('EL', 18, 6)) as v(code, entitled, used)
where e.employee_code = 'E-4471';

insert into public.leave_requests (employee_id, leave_code, start_date, end_date, working_days, reason, status, created_at)
select e.id, v.code::public.leave_code,
       (current_date + v.s)::date, (current_date + v.en)::date, v.days, v.reason, v.status::public.request_status,
       now() - (v.ago || ' days')::interval
from public.employees e,
  (values
    ('CL', 12, 13, 2, 'Family function', 'PENDING', 1),
    ('EL', 24, 28, 4, 'Travel', 'PENDING', 3),
    ('SL', 4, 4, 1, 'Dental appointment', 'APPROVED', 6),
    ('EL', -18, -15, 3, 'Short break', 'APPROVED', 30),
    ('CL', -40, -39, 2, 'Personal', 'APPROVED', 46),
    ('SL', -58, -57, 2, 'Fever', 'APPROVED', 58)
  ) as v(code, s, en, days, reason, status, ago)
where e.employee_code = 'E-4471';

insert into public.attendance_records (employee_id, work_date, clock_in, clock_out, status, is_flagged, flag_reason)
select e.id, d::date,
  case
    when extract(isodow from d) >= 6 then null
    when d::date > current_date then null
    when extract(day from d)::int in (7, 14) then '10:47'::time
    when extract(day from d)::int = 20 then null
    else '09:32'::time
  end,
  case
    when extract(isodow from d) >= 6 then null
    when d::date > current_date then null
    when extract(day from d)::int in (7, 14) then null
    when extract(day from d)::int = 20 then null
    else '18:51'::time
  end,
  case
    when d::date > current_date or extract(isodow from d) >= 6 then 'PRESENT'::public.attendance_status
    when extract(day from d)::int in (7, 14) then 'FLAGGED'::public.attendance_status
    when extract(day from d)::int = 20 then 'ABSENT'::public.attendance_status
    when extract(day from d)::int in (10, 17) then 'WFH'::public.attendance_status
    else 'PRESENT'::public.attendance_status
  end,
  (extract(isodow from d) < 6 and d::date <= current_date and extract(day from d)::int in (7, 14)),
  case when extract(isodow from d) < 6 and d::date <= current_date and extract(day from d)::int = 7 then 'Missing clock-out'
       when extract(isodow from d) < 6 and d::date <= current_date and extract(day from d)::int = 14 then 'Late arrival, no clock-out'
       else null end
from public.employees e,
  generate_series(date_trunc('month', current_date), date_trunc('month', current_date) + interval '1 month' - interval '1 day', interval '1 day') as d
where e.employee_code = 'E-4471';

insert into public.attendance_regularizations (employee_id, work_date, corrected_in, corrected_out, reason, status)
select e.id, (date_trunc('month', current_date) + interval '2 days')::date, '09:15', '18:30', 'Client visit, forgot to clock in', 'APPROVED'
from public.employees e where e.employee_code = 'E-4471';

insert into public.wfh_requests (employee_id, start_date, end_date, reason, status)
select e.id, (current_date + v.offset_days)::date, (current_date + v.offset_days)::date, 'Focus day', 'APPROVED'
from public.employees e, (values (1), (3), (8)) as v(offset_days)
where e.employee_code = 'E-4471';