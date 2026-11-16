-- ============================================================================
-- ANDROS ARENA — retos de ingeniería y vacantes de empleo
-- Ejecuta este archivo UNA vez en el SQL Editor de Supabase (después de schema.sql).
-- ============================================================================

create table if not exists public.arena_opportunities (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null check (kind in ('challenge', 'job')),
  title text not null check (char_length(title) between 4 and 120),
  company text not null check (char_length(company) between 2 and 80),
  category text not null default 'general',
  description text not null check (char_length(description) between 10 and 2000),
  reward text,
  created_at timestamptz not null default now()
);

create table if not exists public.arena_applications (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.arena_opportunities(id) on delete cascade,
  applicant_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete set null,
  message text check (char_length(message) <= 1000),
  created_at timestamptz not null default now(),
  unique (opportunity_id, applicant_id)
);

alter table public.arena_opportunities enable row level security;
alter table public.arena_applications enable row level security;

drop policy if exists "arena_opps_select_all" on public.arena_opportunities;
create policy "arena_opps_select_all" on public.arena_opportunities
  for select to anon, authenticated using (true);

drop policy if exists "arena_opps_insert_own" on public.arena_opportunities;
create policy "arena_opps_insert_own" on public.arena_opportunities
  for insert to authenticated with check (owner_id = (select auth.uid()));

drop policy if exists "arena_opps_delete_own" on public.arena_opportunities;
create policy "arena_opps_delete_own" on public.arena_opportunities
  for delete to authenticated using (owner_id = (select auth.uid()));

-- Quien postula ve sus postulaciones; quien publicó el reto ve las recibidas.
drop policy if exists "arena_apps_select" on public.arena_applications;
create policy "arena_apps_select" on public.arena_applications
  for select to authenticated using (
    applicant_id = (select auth.uid())
    or exists (
      select 1 from public.arena_opportunities o
      where o.id = opportunity_id and o.owner_id = (select auth.uid())
    )
  );

drop policy if exists "arena_apps_insert_own" on public.arena_applications;
create policy "arena_apps_insert_own" on public.arena_applications
  for insert to authenticated with check (
    applicant_id = (select auth.uid())
    and (
      workspace_id is null
      or exists (
        select 1 from public.workspaces w
        where w.id = workspace_id and w.owner_id = (select auth.uid())
      )
    )
  );
