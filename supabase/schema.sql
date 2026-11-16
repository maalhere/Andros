-- ============================================================================
-- ANDROS — ESQUEMA DE SUPABASE (PRIORIDAD 1A: LOGIN CON GOOGLE + NUBE)
--
-- Cómo usarlo: Supabase → SQL Editor → New query → pegar TODO este archivo
-- → botón "Run". Se puede ejecutar varias veces sin romper nada.
--
-- Contiene:
--   1. profiles               → un perfil por usuario de Google
--   2. workspaces             → lienzos de cada usuario
--   3. workspace_nodes        → nodos del lienzo (archivo, cuaderno, cálculo)
--   4. workspace_connections  → cables entre nodos
--   5. Seguridad RLS: cada usuario solo ve y edita lo suyo (auth.uid())
--   6. Bucket de Storage `print-files` (privado) para archivos 3D y otros
-- ============================================================================

create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- Utilidad: mantener `updated_at` al día en cada UPDATE
-- ----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ============================================================================
-- 1. PROFILES
-- ============================================================================
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text,
  full_name   text,
  avatar_url  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Crea (o actualiza) el perfil automáticamente cuando alguien entra con Google.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture')
  )
  on conflict (id) do update
    set email      = excluded.email,
        full_name  = excluded.full_name,
        avatar_url = excluded.avatar_url;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================================
-- 2. WORKSPACES
-- ============================================================================
create table if not exists public.workspaces (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name        text not null default 'workspace-delta-01',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists workspaces_owner_idx on public.workspaces (owner_id);

-- BLOQUE 2: trazos de tinta libre (Lápiz D) dibujados sobre el lienzo.
-- Lista JSON de trazos: [{ id, color, tip, width, pressure, points: [{x, y, p?}] }]
alter table public.workspaces
  add column if not exists canvas_strokes jsonb not null default '[]'::jsonb;

drop trigger if exists workspaces_set_updated_at on public.workspaces;
create trigger workspaces_set_updated_at
  before update on public.workspaces
  for each row execute function public.set_updated_at();

-- ============================================================================
-- 3. WORKSPACE_NODES
--    `id` es el identificador que genera la app (ej. "node-1731600000000").
--    `payload` guarda fileData / sketchNoteData / calcLatexData según `type`.
-- ============================================================================
create table if not exists public.workspace_nodes (
  workspace_id   uuid not null references public.workspaces (id) on delete cascade,
  id             text not null,
  owner_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  type           text not null check (
                   type in (
                     'file-node', 'sketch-note-node', 'calc-latex-node',
                     'resource-link-node', 'code-lab-node'
                   )
                 ),
  title          text not null default '',
  code_tag       text not null default '',
  summary        text,
  action_label   text,
  metrics        jsonb,
  position_x     double precision not null default 0,
  position_y     double precision not null default 0,
  payload        jsonb not null default '{}'::jsonb,
  updated_label  text,
  sort_order     integer not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  primary key (workspace_id, id)
);

create index if not exists workspace_nodes_owner_idx on public.workspace_nodes (owner_id);

drop trigger if exists workspace_nodes_set_updated_at on public.workspace_nodes;
create trigger workspace_nodes_set_updated_at
  before update on public.workspace_nodes
  for each row execute function public.set_updated_at();

-- BLOQUE 3: se agregaron los nodos "resource-link-node" (Enlace / Fuente) y
-- "code-lab-node" (Código / Cálculo). En una base ya creada, `create table if
-- not exists` no actualiza el check existente, así que se reemplaza aparte.
alter table public.workspace_nodes drop constraint if exists workspace_nodes_type_check;
alter table public.workspace_nodes add constraint workspace_nodes_type_check
  check (
    type in (
      'file-node', 'sketch-note-node', 'calc-latex-node',
      'resource-link-node', 'code-lab-node'
    )
  );

-- ============================================================================
-- 4. WORKSPACE_CONNECTIONS
-- ============================================================================
create table if not exists public.workspace_connections (
  workspace_id   uuid not null references public.workspaces (id) on delete cascade,
  id             text not null,
  owner_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  from_node_id   text not null,
  to_node_id     text not null,
  from_port      text not null check (from_port in ('top', 'right', 'bottom', 'left')),
  to_port        text not null check (to_port in ('top', 'right', 'bottom', 'left')),
  label          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  primary key (workspace_id, id),
  foreign key (workspace_id, from_node_id)
    references public.workspace_nodes (workspace_id, id) on delete cascade,
  foreign key (workspace_id, to_node_id)
    references public.workspace_nodes (workspace_id, id) on delete cascade
);

create index if not exists workspace_connections_owner_idx on public.workspace_connections (owner_id);

drop trigger if exists workspace_connections_set_updated_at on public.workspace_connections;
create trigger workspace_connections_set_updated_at
  before update on public.workspace_connections
  for each row execute function public.set_updated_at();

-- ============================================================================
-- 5. SEGURIDAD (ROW LEVEL SECURITY)
--    Regla única: solo el dueño (auth.uid()) puede leer, crear, editar o borrar.
-- ============================================================================
alter table public.profiles              enable row level security;
alter table public.workspaces            enable row level security;
alter table public.workspace_nodes       enable row level security;
alter table public.workspace_connections enable row level security;

-- PROFILES -------------------------------------------------------------------
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select to authenticated using (id = (select auth.uid()));

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
  for insert to authenticated with check (id = (select auth.uid()));

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- WORKSPACES -----------------------------------------------------------------
drop policy if exists "workspaces_select_own" on public.workspaces;
create policy "workspaces_select_own" on public.workspaces
  for select to authenticated using (owner_id = (select auth.uid()));

drop policy if exists "workspaces_insert_own" on public.workspaces;
create policy "workspaces_insert_own" on public.workspaces
  for insert to authenticated with check (owner_id = (select auth.uid()));

drop policy if exists "workspaces_update_own" on public.workspaces;
create policy "workspaces_update_own" on public.workspaces
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

drop policy if exists "workspaces_delete_own" on public.workspaces;
create policy "workspaces_delete_own" on public.workspaces
  for delete to authenticated using (owner_id = (select auth.uid()));

-- WORKSPACE_NODES ------------------------------------------------------------
drop policy if exists "nodes_select_own" on public.workspace_nodes;
create policy "nodes_select_own" on public.workspace_nodes
  for select to authenticated using (owner_id = (select auth.uid()));

drop policy if exists "nodes_insert_own" on public.workspace_nodes;
create policy "nodes_insert_own" on public.workspace_nodes
  for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and exists (
      select 1 from public.workspaces w
      where w.id = workspace_id and w.owner_id = (select auth.uid())
    )
  );

drop policy if exists "nodes_update_own" on public.workspace_nodes;
create policy "nodes_update_own" on public.workspace_nodes
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (
    owner_id = (select auth.uid())
    and exists (
      select 1 from public.workspaces w
      where w.id = workspace_id and w.owner_id = (select auth.uid())
    )
  );

drop policy if exists "nodes_delete_own" on public.workspace_nodes;
create policy "nodes_delete_own" on public.workspace_nodes
  for delete to authenticated using (owner_id = (select auth.uid()));

-- WORKSPACE_CONNECTIONS ------------------------------------------------------
drop policy if exists "connections_select_own" on public.workspace_connections;
create policy "connections_select_own" on public.workspace_connections
  for select to authenticated using (owner_id = (select auth.uid()));

drop policy if exists "connections_insert_own" on public.workspace_connections;
create policy "connections_insert_own" on public.workspace_connections
  for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and exists (
      select 1 from public.workspaces w
      where w.id = workspace_id and w.owner_id = (select auth.uid())
    )
  );

drop policy if exists "connections_update_own" on public.workspace_connections;
create policy "connections_update_own" on public.workspace_connections
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (
    owner_id = (select auth.uid())
    and exists (
      select 1 from public.workspaces w
      where w.id = workspace_id and w.owner_id = (select auth.uid())
    )
  );

drop policy if exists "connections_delete_own" on public.workspace_connections;
create policy "connections_delete_own" on public.workspace_connections
  for delete to authenticated using (owner_id = (select auth.uid()));

-- ============================================================================
-- 6. STORAGE: bucket privado `print-files`
--    Ruta de cada archivo: <id del usuario>/<id del workspace>/<id del nodo>/<archivo>
--    La primera carpeta DEBE ser el id del usuario: así nadie puede leer
--    ni pisar archivos ajenos.
-- ============================================================================
insert into storage.buckets (id, name, public)
values ('print-files', 'print-files', false)
on conflict (id) do nothing;

drop policy if exists "print_files_select_own" on storage.objects;
create policy "print_files_select_own" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'print-files'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "print_files_insert_own" on storage.objects;
create policy "print_files_insert_own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'print-files'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "print_files_update_own" on storage.objects;
create policy "print_files_update_own" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'print-files'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'print-files'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "print_files_delete_own" on storage.objects;
create policy "print_files_delete_own" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'print-files'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
