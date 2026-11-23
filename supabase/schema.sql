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
--   7. Andros Arena: arena_posts + arena_submissions (con RLS)
--   8. Sala en vivo (Sprint 7): notas sobre Realtime y nodos efímeros
--   4b. (Sprint 7.6) @usuario, amistades y espacios compartidos
--       → profiles.username, friendships, workspace_members y la función
--         is_workspace_member() que usan las políticas RLS de la sección 5.
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
  -- Ajustes de comodidad (tema, cuadricula, cables...) sincronizados entre dispositivos.
  preferences jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Para bases de datos ya creadas: anade la columna si falta.
alter table public.profiles add column if not exists preferences jsonb not null default '{}'::jsonb;

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

-- FASE 3: carpetas de proyectos. Cadena vacía = sin carpeta (raíz).
alter table public.workspaces
  add column if not exists folder text not null default '';

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
                     'resource-link-node', 'code-lab-node', 'ai-chat-node'
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

-- SPRINT 7: el nodo "screen-share-node" (pantalla compartida) es EFÍMERO de
-- sesión: vive solo en memoria mientras dura la transmisión y NUNCA se guarda
-- aquí, por eso NO se añade al check (así no quedan pantallas muertas en el
-- lienzo al cerrar). Si algún cliente intentara guardarlo, el check lo rechaza.
-- SPRINT 2: se agregó "ai-chat-node" (Conversación IA). Volver a ejecutar
-- este archivo actualiza el check sin tocar los datos existentes.
-- BLOQUE 3: se agregaron los nodos "resource-link-node" (Enlace / Fuente) y
-- "code-lab-node" (Código / Cálculo). En una base ya creada, `create table if
-- not exists` no actualiza el check existente, así que se reemplaza aparte.
alter table public.workspace_nodes drop constraint if exists workspace_nodes_type_check;
alter table public.workspace_nodes add constraint workspace_nodes_type_check
  check (
    type in (
      'file-node', 'sketch-note-node', 'calc-latex-node',
      'resource-link-node', 'code-lab-node', 'ai-chat-node'
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
-- 4b. SPRINT 7.6 — @USUARIO, AMISTADES Y ESPACIOS COMPARTIDOS
--     Todo es idempotente: se puede ejecutar de nuevo sin perder datos.
-- ============================================================================

-- PROFILES: @usuario (minúsculas, 3–20 caracteres: a-z, 0-9 y _) y correo.
alter table public.profiles add column if not exists username text;
alter table public.profiles add column if not exists email text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_username_format') then
    alter table public.profiles
      add constraint profiles_username_format
      check (username is null or username ~ '^[a-z0-9_]{3,20}$');
  end if;
end;
$$;

create unique index if not exists profiles_username_key on public.profiles (username);
create index if not exists profiles_email_lower_idx on public.profiles (lower(email));

-- FRIENDSHIPS: una sola fila por pareja (sin importar quién la pidió).
create table if not exists public.friendships (
  id            uuid primary key default gen_random_uuid(),
  requester_id  uuid not null default auth.uid() references auth.users (id) on delete cascade,
  addressee_id  uuid not null references auth.users (id) on delete cascade,
  status        text not null default 'pending'
                check (status in ('pending', 'accepted', 'rejected')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint friendships_not_self check (requester_id <> addressee_id)
);

create unique index if not exists friendships_pair_key
  on public.friendships (least(requester_id, addressee_id), greatest(requester_id, addressee_id));
create index if not exists friendships_requester_idx on public.friendships (requester_id);
create index if not exists friendships_addressee_idx on public.friendships (addressee_id);

drop trigger if exists friendships_set_updated_at on public.friendships;
create trigger friendships_set_updated_at
  before update on public.friendships
  for each row execute function public.set_updated_at();

-- Nadie puede cambiar quién pidió ni a quién se le pidió la amistad.
create or replace function public.friendships_guard_update()
returns trigger
language plpgsql
as $$
begin
  if new.requester_id is distinct from old.requester_id
     or new.addressee_id is distinct from old.addressee_id then
    raise exception 'No se puede cambiar a los participantes de una amistad.';
  end if;
  return new;
end;
$$;

drop trigger if exists friendships_guard_update on public.friendships;
create trigger friendships_guard_update
  before update on public.friendships
  for each row execute function public.friendships_guard_update();

-- WORKSPACE_MEMBERS: personas añadidas a un espacio (el dueño es implícito).
create table if not exists public.workspace_members (
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  user_id       uuid not null references auth.users (id) on delete cascade,
  role          text not null default 'editor' check (role in ('owner', 'editor')),
  added_by      uuid default auth.uid() references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create index if not exists workspace_members_user_idx on public.workspace_members (user_id);

-- ----------------------------------------------------------------------------
-- Funciones auxiliares SECURITY DEFINER: consultan `workspaces` y
-- `workspace_members` SIN pasar por RLS, así las políticas no se llaman a sí
-- mismas (sin recursión infinita). Solo devuelven sí/no o datos básicos.
-- ----------------------------------------------------------------------------
create or replace function public.workspace_owner_id(ws_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select w.owner_id from public.workspaces w where w.id = ws_id;
$$;

create or replace function public.is_workspace_member(ws_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and (
    exists (select 1 from public.workspaces w where w.id = ws_id and w.owner_id = auth.uid())
    or exists (
      select 1 from public.workspace_members m
      where m.workspace_id = ws_id and m.user_id = auth.uid()
    )
  );
$$;

create or replace function public.are_friends(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.friendships f
    where f.status = 'accepted'
      and ((f.requester_id = a and f.addressee_id = b) or (f.requester_id = b and f.addressee_id = a))
  );
$$;

-- Archivos del bucket: la 2.ª carpeta de la ruta es el id del espacio.
create or replace function public.can_read_workspace_file(object_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  ws text := split_part(object_name, '/', 2);
begin
  if ws !~ '^[0-9a-fA-F-]{36}$' then
    return false;
  end if;
  return public.is_workspace_member(ws::uuid);
end;
$$;

-- ¿Está libre este @usuario? (no revela nada más)
create or replace function public.username_available(candidate text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select candidate ~ '^[a-z0-9_]{3,20}$'
    and not exists (
      select 1 from public.profiles p
      where p.username = candidate and p.id is distinct from auth.uid()
    );
$$;

-- Búsqueda de perfiles: SOLO coincidencia exacta de @usuario o de correo.
-- Devuelve datos básicos (nunca el correo ni las preferencias) y como
-- máximo 5 filas: no sirve para listar correos de forma masiva.
create or replace function public.search_profiles(query text)
returns table (id uuid, username text, full_name text, avatar_url text)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.username, p.full_name, p.avatar_url
  from public.profiles p
  where auth.uid() is not null
    and p.id <> auth.uid()
    and char_length(trim(query)) between 3 and 254
    and (
      (p.username is not null and p.username = lower(ltrim(trim(query), '@')))
      or (p.email is not null and lower(p.email) = lower(trim(query)))
    )
  limit 5;
$$;

-- Datos básicos de personas RELACIONADAS contigo (amistades o compañeros de
-- un espacio compartido). Un id cualquiera no devuelve nada.
create or replace function public.get_basic_profiles(ids uuid[])
returns table (id uuid, username text, full_name text, avatar_url text)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.username, p.full_name, p.avatar_url
  from public.profiles p
  where auth.uid() is not null
    and p.id = any (ids)
    and (
      p.id = auth.uid()
      or exists (
        select 1 from public.friendships f
        where (f.requester_id = auth.uid() and f.addressee_id = p.id)
           or (f.addressee_id = auth.uid() and f.requester_id = p.id)
      )
      or exists (
        select 1
        from public.workspace_members m
        join public.workspaces w on w.id = m.workspace_id
        where (w.owner_id = auth.uid() and m.user_id = p.id)
           or (
             m.user_id = auth.uid()
             and (
               w.owner_id = p.id
               or exists (
                 select 1 from public.workspace_members m2
                 where m2.workspace_id = m.workspace_id and m2.user_id = p.id
               )
             )
           )
      )
    );
$$;

revoke all on function public.username_available(text) from public, anon;
revoke all on function public.search_profiles(text) from public, anon;
revoke all on function public.get_basic_profiles(uuid[]) from public, anon;
grant execute on function public.username_available(text) to authenticated;
grant execute on function public.search_profiles(text) to authenticated;
grant execute on function public.get_basic_profiles(uuid[]) to authenticated;

-- Un miembro puede editar el lienzo (nodos, cables y trazos de tinta en
-- `canvas_strokes`), pero solo el dueño renombra, mueve o cambia de dueño.
create or replace function public.workspaces_guard_shared_update()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is null then
    return new; -- SQL Editor / service role
  end if;
  if new.owner_id is distinct from old.owner_id then
    raise exception 'No se puede cambiar el dueño de un espacio.';
  end if;
  if auth.uid() is distinct from old.owner_id
     and (new.name is distinct from old.name or new.folder is distinct from old.folder) then
    raise exception 'Solo el dueño puede renombrar o mover este espacio.';
  end if;
  return new;
end;
$$;

drop trigger if exists workspaces_guard_shared_update on public.workspaces;
create trigger workspaces_guard_shared_update
  before update on public.workspaces
  for each row execute function public.workspaces_guard_shared_update();

-- ============================================================================
-- 5. SEGURIDAD (ROW LEVEL SECURITY)
--    · Perfiles: cada usuario lee y edita solo el suyo (la búsqueda de otros
--      va por las funciones search_profiles / get_basic_profiles).
--    · Espacios, nodos, cables y tinta: el dueño Y los miembros añadidos en
--      `workspace_members` (vía is_workspace_member, sin recursión).
-- ============================================================================
alter table public.profiles              enable row level security;
alter table public.workspaces            enable row level security;
alter table public.workspace_nodes       enable row level security;
alter table public.workspace_connections enable row level security;
alter table public.friendships           enable row level security;
alter table public.workspace_members     enable row level security;

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
-- Lectura y edición del lienzo: dueño o miembro. Crear y borrar: solo el dueño.
drop policy if exists "workspaces_select_own" on public.workspaces;
drop policy if exists "workspaces_select_member" on public.workspaces;
create policy "workspaces_select_member" on public.workspaces
  for select to authenticated
  using (owner_id = (select auth.uid()) or public.is_workspace_member(id));

drop policy if exists "workspaces_insert_own" on public.workspaces;
create policy "workspaces_insert_own" on public.workspaces
  for insert to authenticated with check (owner_id = (select auth.uid()));

drop policy if exists "workspaces_update_own" on public.workspaces;
drop policy if exists "workspaces_update_member" on public.workspaces;
create policy "workspaces_update_member" on public.workspaces
  for update to authenticated
  using (public.is_workspace_member(id))
  with check (public.is_workspace_member(id));

drop policy if exists "workspaces_delete_own" on public.workspaces;
create policy "workspaces_delete_own" on public.workspaces
  for delete to authenticated using (owner_id = (select auth.uid()));

-- WORKSPACE_NODES ------------------------------------------------------------
-- `owner_id` de cada fila = dueño del ESPACIO (también cuando escribe un
-- miembro): el lienzo sigue siendo del dueño aunque otra persona lo edite.
drop policy if exists "nodes_select_own" on public.workspace_nodes;
drop policy if exists "nodes_select_member" on public.workspace_nodes;
create policy "nodes_select_member" on public.workspace_nodes
  for select to authenticated using (public.is_workspace_member(workspace_id));

drop policy if exists "nodes_insert_own" on public.workspace_nodes;
drop policy if exists "nodes_insert_member" on public.workspace_nodes;
create policy "nodes_insert_member" on public.workspace_nodes
  for insert to authenticated
  with check (
    public.is_workspace_member(workspace_id)
    and owner_id = public.workspace_owner_id(workspace_id)
  );

drop policy if exists "nodes_update_own" on public.workspace_nodes;
drop policy if exists "nodes_update_member" on public.workspace_nodes;
create policy "nodes_update_member" on public.workspace_nodes
  for update to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (
    public.is_workspace_member(workspace_id)
    and owner_id = public.workspace_owner_id(workspace_id)
  );

drop policy if exists "nodes_delete_own" on public.workspace_nodes;
drop policy if exists "nodes_delete_member" on public.workspace_nodes;
create policy "nodes_delete_member" on public.workspace_nodes
  for delete to authenticated using (public.is_workspace_member(workspace_id));

-- WORKSPACE_CONNECTIONS ------------------------------------------------------
drop policy if exists "connections_select_own" on public.workspace_connections;
drop policy if exists "connections_select_member" on public.workspace_connections;
create policy "connections_select_member" on public.workspace_connections
  for select to authenticated using (public.is_workspace_member(workspace_id));

drop policy if exists "connections_insert_own" on public.workspace_connections;
drop policy if exists "connections_insert_member" on public.workspace_connections;
create policy "connections_insert_member" on public.workspace_connections
  for insert to authenticated
  with check (
    public.is_workspace_member(workspace_id)
    and owner_id = public.workspace_owner_id(workspace_id)
  );

drop policy if exists "connections_update_own" on public.workspace_connections;
drop policy if exists "connections_update_member" on public.workspace_connections;
create policy "connections_update_member" on public.workspace_connections
  for update to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (
    public.is_workspace_member(workspace_id)
    and owner_id = public.workspace_owner_id(workspace_id)
  );

drop policy if exists "connections_delete_own" on public.workspace_connections;
drop policy if exists "connections_delete_member" on public.workspace_connections;
create policy "connections_delete_member" on public.workspace_connections
  for delete to authenticated using (public.is_workspace_member(workspace_id));

-- FRIENDSHIPS ----------------------------------------------------------------
-- Solo las dos personas de la pareja leen, actualizan o borran la fila.
-- Quien pidió la amistad no puede aceptarla en nombre de la otra persona.
drop policy if exists "friendships_select_pair" on public.friendships;
create policy "friendships_select_pair" on public.friendships
  for select to authenticated
  using ((select auth.uid()) in (requester_id, addressee_id));

drop policy if exists "friendships_insert_requester" on public.friendships;
create policy "friendships_insert_requester" on public.friendships
  for insert to authenticated
  with check (requester_id = (select auth.uid()) and status = 'pending');

drop policy if exists "friendships_update_pair" on public.friendships;
create policy "friendships_update_pair" on public.friendships
  for update to authenticated
  using ((select auth.uid()) in (requester_id, addressee_id))
  with check (
    (select auth.uid()) in (requester_id, addressee_id)
    and (addressee_id = (select auth.uid()) or status = 'pending')
  );

drop policy if exists "friendships_delete_pair" on public.friendships;
create policy "friendships_delete_pair" on public.friendships
  for delete to authenticated
  using ((select auth.uid()) in (requester_id, addressee_id));

-- WORKSPACE_MEMBERS ----------------------------------------------------------
-- Ven la lista el dueño y los miembros. Solo el dueño añade (y solo a
-- amistades aceptadas); el dueño quita a cualquiera y cada miembro puede salir.
drop policy if exists "workspace_members_select" on public.workspace_members;
create policy "workspace_members_select" on public.workspace_members
  for select to authenticated
  using (user_id = (select auth.uid()) or public.is_workspace_member(workspace_id));

drop policy if exists "workspace_members_insert_owner" on public.workspace_members;
create policy "workspace_members_insert_owner" on public.workspace_members
  for insert to authenticated
  with check (
    public.workspace_owner_id(workspace_id) = (select auth.uid())
    and user_id <> (select auth.uid())
    and role = 'editor'
    and added_by = (select auth.uid())
    and public.are_friends((select auth.uid()), user_id)
  );

drop policy if exists "workspace_members_delete" on public.workspace_members;
create policy "workspace_members_delete" on public.workspace_members
  for delete to authenticated
  using (
    public.workspace_owner_id(workspace_id) = (select auth.uid())
    or user_id = (select auth.uid())
  );

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

-- Miembros de un espacio compartido: pueden LEER (descargar) los archivos de
-- ese espacio aunque los haya subido otra persona. Cada quien sigue subiendo,
-- cambiando y borrando solo en su propia carpeta.
drop policy if exists "print_files_select_member" on storage.objects;
create policy "print_files_select_member" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'print-files'
    and public.can_read_workspace_file(name)
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

-- ============================================================================
-- 7. ANDROS ARENA (Sprint 3): publicaciones con etiquetas IA y postulaciones
--    con un espacio de trabajo como portafolio.
--    · arena_posts       → retos, actividades, prácticas y empleos
--    · arena_submissions → soluciones / postulaciones (instantánea del lienzo)
--    Si estas tablas no existen, la app funciona en modo local (localStorage).
--    (Las tablas antiguas de supabase/arena.sql no se tocan.)
-- ============================================================================
create table if not exists public.arena_posts (
  id                 uuid primary key default gen_random_uuid(),
  owner_id           uuid not null default auth.uid() references auth.users (id) on delete cascade,
  type               text not null check (type in ('job', 'internship', 'activity', 'challenge')),
  title              text not null check (char_length(title) between 4 and 140),
  organization       text not null check (char_length(organization) between 2 and 100),
  description        text not null check (char_length(description) between 20 and 4000),
  stipend            text check (char_length(stipend) <= 80),
  location           text check (char_length(location) <= 80),
  -- { "type": "...", "discipline": [...], "level": [...], "skills": [...] }
  tags               jsonb not null default '{}'::jsonb,
  -- { "status": "...", "qualityScore": n, "issues": [...], "suggestions": [...] }
  moderation         jsonb not null default '{}'::jsonb,
  moderation_status  text not null default 'approved'
                     check (moderation_status in ('approved', 'needs_review', 'rejected')),
  ai_engine          text not null default 'keywords' check (ai_engine in ('gemini', 'keywords')),
  author_name        text check (char_length(author_name) <= 120),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists arena_posts_created_idx on public.arena_posts (created_at desc);
create index if not exists arena_posts_type_idx on public.arena_posts (type);
create index if not exists arena_posts_tags_idx on public.arena_posts using gin (tags jsonb_path_ops);

drop trigger if exists arena_posts_set_updated_at on public.arena_posts;
create trigger arena_posts_set_updated_at
  before update on public.arena_posts
  for each row execute function public.set_updated_at();

create table if not exists public.arena_submissions (
  id              uuid primary key default gen_random_uuid(),
  post_id         uuid not null references public.arena_posts (id) on delete cascade,
  applicant_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  workspace_id    uuid references public.workspaces (id) on delete set null,
  note            text check (char_length(note) <= 1500),
  applicant_name  text check (char_length(applicant_name) <= 120),
  -- Instantánea del lienzo: nº de nodos, insignias 3D/CodeLab/IA y mini-mapa.
  snapshot        jsonb not null default '{}'::jsonb,
  -- El postulante decide si su solución aparece en la galería pública.
  is_public       boolean not null default false,
  created_at      timestamptz not null default now(),
  unique (post_id, applicant_id)
);

create index if not exists arena_submissions_post_idx on public.arena_submissions (post_id);

alter table public.arena_posts enable row level security;
alter table public.arena_submissions enable row level security;

-- Publicaciones: cualquiera ve las no rechazadas; el autor ve también las suyas.
drop policy if exists "arena_posts_select" on public.arena_posts;
create policy "arena_posts_select" on public.arena_posts
  for select to anon, authenticated
  using (moderation_status <> 'rejected' or owner_id = (select auth.uid()));

-- Solo usuarios con sesión publican, siempre como ellos mismos y nunca algo rechazado.
drop policy if exists "arena_posts_insert_own" on public.arena_posts;
create policy "arena_posts_insert_own" on public.arena_posts
  for insert to authenticated
  with check (owner_id = (select auth.uid()) and moderation_status <> 'rejected');

drop policy if exists "arena_posts_update_own" on public.arena_posts;
create policy "arena_posts_update_own" on public.arena_posts
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()) and moderation_status <> 'rejected');

drop policy if exists "arena_posts_delete_own" on public.arena_posts;
create policy "arena_posts_delete_own" on public.arena_posts
  for delete to authenticated
  using (owner_id = (select auth.uid()));

-- Postulaciones: públicas si el postulante lo eligió; si no, solo el
-- postulante y quien publicó la oferta.
drop policy if exists "arena_submissions_select" on public.arena_submissions;
create policy "arena_submissions_select" on public.arena_submissions
  for select to anon, authenticated
  using (
    is_public
    or applicant_id = (select auth.uid())
    or exists (
      select 1 from public.arena_posts p
      where p.id = post_id and p.owner_id = (select auth.uid())
    )
  );

-- Solo se puede adjuntar un espacio propio.
drop policy if exists "arena_submissions_insert_own" on public.arena_submissions;
create policy "arena_submissions_insert_own" on public.arena_submissions
  for insert to authenticated
  with check (
    applicant_id = (select auth.uid())
    and (
      workspace_id is null
      or exists (
        select 1 from public.workspaces w
        where w.id = workspace_id and w.owner_id = (select auth.uid())
      )
    )
  );

drop policy if exists "arena_submissions_delete_own" on public.arena_submissions;
create policy "arena_submissions_delete_own" on public.arena_submissions
  for delete to authenticated
  using (applicant_id = (select auth.uid()));

-- ============================================================================
-- 8. SALA EN VIVO (Sprint 7): voz, pantalla compartida y edición conjunta
--    No necesita tablas nuevas: usa Supabase Realtime (Presence + Broadcast)
--    en el canal `andros-collab:<sala>` y WebRTC directo entre navegadores
--    (STUN público stun:stun.l.google.com:19302) → $0 USD para 2–6 personas.
--
--    · Sala de carpeta: f-<id del dueño>-<hash de la carpeta>
--    · Sala de espacio suelto: w-<id del workspace>
--    · Nada de la sala se guarda: presencia, cursores, audio y pantallas son
--      efímeros. Los cambios de nodos/cables los guarda SOLO el dueño del
--      espacio con sus propias políticas RLS (los invitados no escriben aquí).
--
--    Requisito: Realtime activo en el proyecto (Project Settings → Realtime).
--    Los canales Broadcast/Presence públicos no necesitan políticas extra.
--
--    SPRINT 7.5/7.6 — canal de voz persistente (estilo Discord):
--    · Al abrir un espacio, la app entra en PRESENCIA PASIVA del canal
--      ({ inCall: false }) sin pedir micrófono ni abrir WebRTC: así ves quién
--      está en voz antes de entrar.
--    · «Unirse a voz» cambia la presencia a { inCall: true } y solo entonces
--      se pide el micrófono y se conecta con quien ya está en la llamada.
--    · La cámara viaja por WebRTC igual que el audio (nunca por Supabase).
--    · Un espacio compartido (workspace_members) usa la sala de la carpeta
--      de su dueño, así dueño y miembros coinciden en el mismo canal.
-- ============================================================================

-- ============================================================================
-- 8b. REALTIME PRIVADO (Sprint 8): canales de la sala solo para autenticados
--     La app abre los canales con `config: { private: true }`. Para que
--     entren, Realtime exige estas políticas sobre `realtime.messages`
--     (Broadcast y Presence). Incluye a invitados con sesión anónima
--     (también son el rol `authenticated`). Sin ellas la app NO se rompe:
--     avisa en la consola y vuelve al canal público.
--     Ejecuta este bloque una vez en Supabase → SQL Editor.
-- ============================================================================

drop policy if exists "andros_collab_receive" on realtime.messages;
create policy "andros_collab_receive"
  on realtime.messages
  for select
  to authenticated
  using ( realtime.topic() like 'andros-collab:%' );

drop policy if exists "andros_collab_send" on realtime.messages;
create policy "andros_collab_send"
  on realtime.messages
  for insert
  to authenticated
  with check ( realtime.topic() like 'andros-collab:%' );
