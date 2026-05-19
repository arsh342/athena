create extension if not exists "uuid-ossp";

create table if not exists public.users (
  id bigserial primary key,
  email text unique not null,
  password_hash text not null,
  failed_attempts integer not null default 0,
  locked_until timestamptz,
  supabase_user_id text unique,
  created_at timestamptz not null default now()
);

create table if not exists public.scans (
  id bigserial primary key,
  scan_id text unique not null,
  user_id bigint not null references public.users(id) on delete cascade,
  repo_name text not null,
  repo_url text not null,
  status text not null,
  created_at timestamptz not null,
  ai_percentage integer not null,
  flagged_units integer not null,
  files_scanned integer not null,
  total_units integer not null,
  findings jsonb not null,
  risk_density jsonb not null,
  duration integer not null
);

create table if not exists public.scan_findings (
  id bigserial primary key,
  scan_id text not null references public.scans(scan_id) on delete cascade,
  severity text not null,
  type text not null,
  category text not null,
  message text not null,
  file text not null,
  line integer not null,
  "column" integer not null,
  source text not null,
  ai_score integer not null,
  code text not null,
  rule_id text not null,
  top_signals jsonb not null
);

create table if not exists public.scan_terminal_lines (
  id bigserial primary key,
  scan_id text not null references public.scans(scan_id) on delete cascade,
  seq integer not null,
  kind text not null,
  text text not null,
  created_at timestamptz not null default now(),
  unique (scan_id, seq)
);

create table if not exists public.scan_reports (
  scan_id text primary key references public.scans(scan_id) on delete cascade,
  user_id bigint not null references public.users(id) on delete cascade,
  markdown text not null,
  created_at timestamptz not null default now(),
  version integer not null default 1
);

create index if not exists idx_scan_reports_user_created_at
  on public.scan_reports(user_id, created_at desc);

alter table public.scans enable row level security;
alter table public.scan_findings enable row level security;
alter table public.scan_terminal_lines enable row level security;

drop policy if exists scans_select_own on public.scans;
create policy scans_select_own on public.scans
  for select using (
    auth.uid()::text = (
      select u.supabase_user_id::text
      from public.users u
      where u.id = user_id
    )
  );

drop policy if exists scan_findings_select_own on public.scan_findings;
create policy scan_findings_select_own on public.scan_findings
  for select using (
    exists (
      select 1
      from public.scans s
      join public.users u on u.id = s.user_id
      where s.scan_id = public.scan_findings.scan_id
        and auth.uid()::text = u.supabase_user_id::text
    )
  );

drop policy if exists scan_terminal_lines_select_own on public.scan_terminal_lines;
create policy scan_terminal_lines_select_own on public.scan_terminal_lines
  for select using (
    exists (
      select 1
      from public.scans s
      join public.users u on u.id = s.user_id
      where s.scan_id = public.scan_terminal_lines.scan_id
        and auth.uid()::text = u.supabase_user_id::text
    )
  );
