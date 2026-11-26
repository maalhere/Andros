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
--   9. (Sprint 11) Vista Invitado: enlace público de solo lectura sin cuenta
--      → workspaces.public_share_token / public_share_enabled y la función
--        get_public_workspace(token) (SECURITY DEFINER, solo lectura).
--  10. (Sprint 12) Librería de fichas replicables
--      → profiles.form_library (JSONB) y el tipo de nodo "form-sheet-node".
--        Sin ejecutar esto, la librería sigue funcionando en localStorage.
--  11. (Sprint 13) Fichas de Fórmula LaTeX reactivas
--      → el tipo de nodo "formula-sheet-node" en el check de workspace_nodes.
--        La Vista Invitado ya recibe los cables (`connections`) para calcularlas.
--  12. (Sprint 16) Roles de acceso estilo Google Docs + comentarios
--      → workspace_members.role ('editor' | 'commenter' | 'viewer'),
--        get_workspace_role() / can_edit_workspace() / can_comment_workspace()
--        (SECURITY DEFINER) y la tabla workspace_comments con su RLS.
--        Dueño y Editor escriben nodos, cables y tinta; Comentarista y
--        Solo lectura únicamente leen (Comentarista además comenta).
--  17B. (Sprint 17B) Blindaje: salas Realtime solo para miembros (§8b),
--        funciones auxiliares sin acceso anónimo, Arena y comentarios con
--        autor tomado del perfil (triggers) y `public_share_token` visible
--        solo para el dueño (get/set_workspace_public_share, §9).
--  18. (Sprint 18) Entorno de Datos Común (CDE) centrado en las personas
--      → workspace_members.work_area + workspaces.work_areas / owner_work_area
--        (áreas de trabajo nominales del arranque en 3 pasos) y la tabla
--        workspace_chat_messages (chat del lienzo con @Área, @usuario y @IA)
--        con RLS y autor + área rellenados por trigger desde el perfil (§18).
--  21. (Sprint 21) Suscripciones Plan Básico / Andros Pro y límites reales
--      → user_subscriptions (RLS: solo lectura propia; escribe el webhook
--        firmado con service_role), user_plan(), workspace_live_cap() (3 / 6
--        personas en vivo según el plan del dueño) y el trigger
--        workspaces_enforce_plan_limit (máx. 2 espacios en Plan Básico).
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
  -- (Sprint 12) Librería personal de fichas: { version, templates[], deleted{} }.
  form_library jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Para bases de datos ya creadas: anade la columna si falta.
alter table public.profiles add column if not exists preferences jsonb not null default '{}'::jsonb;
alter table public.profiles add column if not exists form_library jsonb not null default '{}'::jsonb;

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
                     'resource-link-node', 'code-lab-node', 'ai-chat-node',
                     'form-sheet-node', 'formula-sheet-node'
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
-- SPRINT 13: se agregó "formula-sheet-node" (Ficha de Fórmula LaTeX reactiva).
-- Su `payload` guarda LaTeX, expresión, variables (alias, valor manual y enlace
-- a un campo de otra tarjeta). El resultado NO se guarda: se calcula en vivo.
-- SPRINT 12: se agregó "form-sheet-node" (Ficha estructurada con fotos). Sus
-- fotos viajan comprimidas (WebP/JPEG ≤ 1280 px) dentro de `payload`.
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
      'resource-link-node', 'code-lab-node', 'ai-chat-node',
      'form-sheet-node', 'formula-sheet-node'
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

-- WORKSPACE_MEMBERS: personas añadidas a un espacio (el dueño es implícito,
-- nunca tiene fila aquí). (Sprint 16) Roles estilo Google Docs:
--   · editor     → lee y edita nodos, cables y tinta.
--   · commenter  → solo lee el lienzo, pero puede comentar.
--   · viewer     → solo lee el lienzo y los comentarios.
create table if not exists public.workspace_members (
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  user_id       uuid not null references auth.users (id) on delete cascade,
  role          text not null default 'editor' check (role in ('editor', 'commenter', 'viewer')),
  added_by      uuid default auth.uid() references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create index if not exists workspace_members_user_idx on public.workspace_members (user_id);

-- Bases ya creadas (Sprint 7.6 aceptaba 'owner' | 'editor'): se normaliza a los
-- 3 roles nuevos sin perder a nadie. Idempotente.
alter table public.workspace_members add column if not exists role text not null default 'editor';
alter table public.workspace_members drop constraint if exists workspace_members_role_check;
update public.workspace_members
  set role = 'editor'
  where role is null or role not in ('editor', 'commenter', 'viewer');
alter table public.workspace_members alter column role set default 'editor';
alter table public.workspace_members add constraint workspace_members_role_check
  check (role in ('editor', 'commenter', 'viewer'));

-- Al cambiar el rol de alguien solo puede cambiar `role` (nunca la persona ni
-- el espacio: así nadie convierte una fila en acceso para un desconocido).
create or replace function public.workspace_members_guard_update()
returns trigger
language plpgsql
as $$
begin
  if new.workspace_id is distinct from old.workspace_id
     or new.user_id is distinct from old.user_id
     or new.added_by is distinct from old.added_by
     or new.created_at is distinct from old.created_at then
    raise exception 'Solo se puede cambiar el rol o el área de trabajo de un miembro.';
  end if;
  return new;
end;
$$;

drop trigger if exists workspace_members_guard_update on public.workspace_members;
create trigger workspace_members_guard_update
  before update on public.workspace_members
  for each row execute function public.workspace_members_guard_update();

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

-- (Sprint 16) Rol de la persona actual en un espacio:
--   'owner' | 'editor' | 'commenter' | 'viewer' | NULL (sin acceso).
create or replace function public.get_workspace_role(ws_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when auth.uid() is null then null
    when exists (select 1 from public.workspaces w where w.id = ws_id and w.owner_id = auth.uid())
      then 'owner'
    else (
      select m.role from public.workspace_members m
      where m.workspace_id = ws_id and m.user_id = auth.uid()
    )
  end;
$$;

-- Escribir nodos, cables y tinta: solo dueño y editores.
create or replace function public.can_edit_workspace(ws_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.get_workspace_role(ws_id) in ('owner', 'editor'), false);
$$;

-- Crear comentarios: dueño, editores y comentaristas (nunca «Solo lectura»).
create or replace function public.can_comment_workspace(ws_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.get_workspace_role(ws_id) in ('owner', 'editor', 'commenter'), false);
$$;

revoke all on function public.get_workspace_role(uuid) from public, anon;
revoke all on function public.can_edit_workspace(uuid) from public, anon;
revoke all on function public.can_comment_workspace(uuid) from public, anon;
grant execute on function public.get_workspace_role(uuid) to authenticated;
grant execute on function public.can_edit_workspace(uuid) to authenticated;
grant execute on function public.can_comment_workspace(uuid) to authenticated;

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

-- (Sprint 17B) Las funciones auxiliares SECURITY DEFINER solo las ejecuta
-- quien tiene sesión (las políticas RLS las llaman como `authenticated`).
-- Ningún visitante anónimo puede usarlas para sondear espacios o amistades.
revoke execute on function public.workspace_owner_id(uuid) from public, anon;
revoke execute on function public.is_workspace_member(uuid) from public, anon;
revoke execute on function public.are_friends(uuid, uuid) from public, anon;
revoke execute on function public.can_read_workspace_file(text) from public, anon;
grant execute on function public.workspace_owner_id(uuid) to authenticated;
grant execute on function public.is_workspace_member(uuid) to authenticated;
grant execute on function public.are_friends(uuid, uuid) to authenticated;
grant execute on function public.can_read_workspace_file(text) to authenticated;

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
  -- (Sprint 18) Las áreas de trabajo nominales (§18) solo las cambia el dueño.
  -- Se leen vía to_jsonb para no fallar en bases aún sin esas columnas.
  if auth.uid() is distinct from old.owner_id
     and (to_jsonb(new) -> 'work_areas' is distinct from to_jsonb(old) -> 'work_areas'
          or to_jsonb(new) -> 'owner_work_area' is distinct from to_jsonb(old) -> 'owner_work_area') then
    raise exception 'Solo el dueño puede cambiar las áreas de trabajo del espacio.';
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
-- (Sprint 16) Solo dueño y editores: la tinta (`canvas_strokes`) vive en esta
-- fila, así que Comentarista y Solo lectura tampoco pueden dibujar.
create policy "workspaces_update_member" on public.workspaces
  for update to authenticated
  using (public.can_edit_workspace(id))
  with check (public.can_edit_workspace(id));

drop policy if exists "workspaces_delete_own" on public.workspaces;
create policy "workspaces_delete_own" on public.workspaces
  for delete to authenticated using (owner_id = (select auth.uid()));

-- WORKSPACE_NODES ------------------------------------------------------------
-- `owner_id` de cada fila = dueño del ESPACIO (también cuando escribe un
-- miembro): el lienzo sigue siendo del dueño aunque otra persona lo edite.
-- (Sprint 16) Leer: cualquier miembro. Escribir: solo dueño y editores.
drop policy if exists "nodes_select_own" on public.workspace_nodes;
drop policy if exists "nodes_select_member" on public.workspace_nodes;
create policy "nodes_select_member" on public.workspace_nodes
  for select to authenticated using (public.is_workspace_member(workspace_id));

drop policy if exists "nodes_insert_own" on public.workspace_nodes;
drop policy if exists "nodes_insert_member" on public.workspace_nodes;
create policy "nodes_insert_member" on public.workspace_nodes
  for insert to authenticated
  with check (
    public.can_edit_workspace(workspace_id)
    and owner_id = public.workspace_owner_id(workspace_id)
  );

drop policy if exists "nodes_update_own" on public.workspace_nodes;
drop policy if exists "nodes_update_member" on public.workspace_nodes;
create policy "nodes_update_member" on public.workspace_nodes
  for update to authenticated
  using (public.can_edit_workspace(workspace_id))
  with check (
    public.can_edit_workspace(workspace_id)
    and owner_id = public.workspace_owner_id(workspace_id)
  );

drop policy if exists "nodes_delete_own" on public.workspace_nodes;
drop policy if exists "nodes_delete_member" on public.workspace_nodes;
create policy "nodes_delete_member" on public.workspace_nodes
  for delete to authenticated using (public.can_edit_workspace(workspace_id));

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
    public.can_edit_workspace(workspace_id)
    and owner_id = public.workspace_owner_id(workspace_id)
  );

drop policy if exists "connections_update_own" on public.workspace_connections;
drop policy if exists "connections_update_member" on public.workspace_connections;
create policy "connections_update_member" on public.workspace_connections
  for update to authenticated
  using (public.can_edit_workspace(workspace_id))
  with check (
    public.can_edit_workspace(workspace_id)
    and owner_id = public.workspace_owner_id(workspace_id)
  );

drop policy if exists "connections_delete_own" on public.workspace_connections;
drop policy if exists "connections_delete_member" on public.workspace_connections;
create policy "connections_delete_member" on public.workspace_connections
  for delete to authenticated using (public.can_edit_workspace(workspace_id));

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
    and role in ('editor', 'commenter', 'viewer')
    and added_by = (select auth.uid())
    and public.are_friends((select auth.uid()), user_id)
  );

-- (Sprint 16) Solo el dueño cambia el rol de un miembro (el disparador
-- workspace_members_guard_update impide tocar cualquier otra columna).
drop policy if exists "workspace_members_update_owner" on public.workspace_members;
create policy "workspace_members_update_owner" on public.workspace_members
  for update to authenticated
  using (public.workspace_owner_id(workspace_id) = (select auth.uid()))
  with check (
    public.workspace_owner_id(workspace_id) = (select auth.uid())
    and role in ('editor', 'commenter', 'viewer')
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

-- (Sprint 17B) Nombre visible de una persona según SU perfil (nunca el que
-- mande el navegador): nombre completo o, si no tiene, su @usuario.
create or replace function public.profile_display_name(uid uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select left(coalesce(nullif(btrim(p.full_name), ''), '@' || nullif(btrim(p.username), '')), 120)
  from public.profiles p
  where p.id = uid;
$$;

revoke execute on function public.profile_display_name(uuid) from public, anon;
grant execute on function public.profile_display_name(uuid) to authenticated;

-- (Sprint 17B) Lo que publica el NAVEGADOR nunca llega aprobado ni firmado
-- con otro nombre: entra «en revisión», con el motor «keywords» y con el
-- nombre de autor de su propio perfil. El SQL Editor / service role (sin
-- auth.uid()) puede seguir moderando.
create or replace function public.arena_posts_guard_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  new.owner_id := auth.uid();
  new.moderation_status := 'needs_review';
  new.ai_engine := 'keywords';
  if jsonb_typeof(new.moderation) = 'object' then
    new.moderation := jsonb_set(new.moderation, '{status}', '"needs_review"'::jsonb);
  else
    new.moderation := jsonb_build_object('status', 'needs_review');
  end if;
  new.author_name := public.profile_display_name(auth.uid());
  return new;
end;
$$;

drop trigger if exists arena_posts_guard_insert on public.arena_posts;
create trigger arena_posts_guard_insert
  before insert on public.arena_posts
  for each row execute function public.arena_posts_guard_insert();

-- Al editar desde el navegador no se puede auto-aprobar ni cambiar el autor.
create or replace function public.arena_posts_guard_update()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if new.owner_id is distinct from old.owner_id
     or new.moderation_status is distinct from old.moderation_status
     or new.moderation is distinct from old.moderation
     or new.ai_engine is distinct from old.ai_engine
     or new.author_name is distinct from old.author_name then
    raise exception 'La moderación y el autor de una publicación no se pueden cambiar desde la app.';
  end if;
  return new;
end;
$$;

drop trigger if exists arena_posts_guard_update on public.arena_posts;
create trigger arena_posts_guard_update
  before update on public.arena_posts
  for each row execute function public.arena_posts_guard_update();

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
--      efímeros. (Sprint 17B) Cada persona con permiso (dueño o editor)
--      guarda SOLO sus propios cambios con su RLS; lo recibido no se guarda.
--
--    Requisito: Realtime activo en el proyecto (Project Settings → Realtime).
--    Los canales son privados: necesitan las políticas de la sección 8b.
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
-- 8b. REALTIME PRIVADO (Sprint 8 → 17B): salas SOLO para miembros
--     La app abre los canales SIEMPRE con `config: { private: true }` y ya no
--     vuelve a un canal público si estas políticas faltan (Sprint 17B).
--     El tema de cada canal lleva el espacio o el dueño de la carpeta:
--       · andros-collab:w-<workspaceId>          → sala de un espacio suelto
--       · andros-collab:f-<ownerId>-<hash>       → sala de una carpeta
--     Reglas:
--       · Leer (SELECT): sala de espacio → is_workspace_member(ws_id).
--                        sala de carpeta → dueño o miembro de al menos un
--                        espacio de ese dueño.
--       · Emitir (INSERT): cambios de lienzo (node:*, edge:*, alert:*) →
--         can_edit_workspace(ws_id); avisos de comentarios (comment:*) →
--         cualquier miembro (Comentarista incluido: solo piden «vuelve a
--         leer»); access:changed → solo el dueño; presencia, cursores, voz y
--         pantalla → cualquier miembro.
--     Nota: Realtime evalúa estas políticas al ENTRAR al canal (con `event`
--     vacío) y guarda el resultado mientras dura la conexión, así que en la
--     práctica entra cualquier miembro y la regla por evento es una defensa
--     extra. Por eso la app, además, aplica en memoria solo los cambios de
--     quien tiene permiso de edición VERIFICADO en la base y NUNCA guarda en la
--     nube lo que llega por la sala (cada quien guarda lo suyo con su RLS).
--     Idempotente: se puede ejecutar varias veces.
-- ============================================================================

-- Espacio de una sala `andros-collab:w-<uuid>` (NULL si el tema no es de espacio).
create or replace function public.collab_topic_workspace_id(topic text)
returns uuid
language sql
immutable
as $$
  select case
    when topic ~ '^andros-collab:w-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      then substring(topic from 17)::uuid
  end;
$$;

-- Dueño de una sala `andros-collab:f-<uuid>-<hash>` (NULL si no es de carpeta).
create or replace function public.collab_topic_owner_id(topic text)
returns uuid
language sql
immutable
as $$
  select case
    when topic ~ '^andros-collab:f-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}-[0-9a-z]{1,16}$'
      then substring(topic from 17 for 36)::uuid
  end;
$$;

-- ¿Eres el dueño o miembro de al menos un espacio de `owner`?
create or replace function public.can_join_collab_folder(owner uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and owner is not null and (
    owner = auth.uid()
    or exists (
      select 1
      from public.workspace_members m
      join public.workspaces w on w.id = m.workspace_id
      where w.owner_id = owner and m.user_id = auth.uid()
    )
  );
$$;

-- Decide si quien llama puede leer (`for_write` = false) o emitir el evento
-- `event` (true) en el canal `topic`.
create or replace function public.can_use_collab_topic(topic text, for_write boolean, event text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  ws uuid := public.collab_topic_workspace_id(topic);
  owner uuid := public.collab_topic_owner_id(topic);
begin
  if auth.uid() is null then
    return false;
  end if;
  if ws is not null then
    if not public.is_workspace_member(ws) then
      return false;
    end if;
    if not for_write then
      return true;
    end if;
    if event in ('node:upsert', 'node:delete', 'edge:upsert', 'edge:delete', 'alert:upsert', 'alert:resolve') then
      return public.can_edit_workspace(ws);
    end if;
    if event in ('access:changed', 'cde:changed') then
      return public.workspace_owner_id(ws) = auth.uid();
    end if;
    -- (Sprint 18) Aviso «hay mensajes nuevos en el chat»: solo quien puede escribir.
    if event = 'chat:new' then
      return public.can_comment_workspace(ws);
    end if;
    -- comment:* (solo avisos), presencia, cursores, voz, pantalla o entrada al canal.
    return true;
  end if;
  if owner is not null then
    return public.can_join_collab_folder(owner);
  end if;
  return false;
end;
$$;

revoke execute on function public.can_join_collab_folder(uuid) from public, anon;
revoke execute on function public.can_use_collab_topic(text, boolean, text) from public, anon;
grant execute on function public.can_join_collab_folder(uuid) to authenticated;
grant execute on function public.can_use_collab_topic(text, boolean, text) to authenticated;

drop policy if exists "andros_collab_receive" on realtime.messages;
create policy "andros_collab_receive"
  on realtime.messages
  for select
  to authenticated
  using (
    realtime.messages.extension in ('broadcast', 'presence')
    and public.can_use_collab_topic((select realtime.topic()), false, null)
  );

drop policy if exists "andros_collab_send" on realtime.messages;
create policy "andros_collab_send"
  on realtime.messages
  for insert
  to authenticated
  with check (
    realtime.messages.extension in ('broadcast', 'presence')
    and public.can_use_collab_topic((select realtime.topic()), true, realtime.messages.event)
  );

-- ============================================================================
-- 9. VISTA INVITADO (Sprint 11): enlace público de SOLO LECTURA, sin cuenta
--    · El dueño lo activa o desactiva desde «Compartir espacio». Desactivarlo
--      lo apaga al instante; «Generar enlace nuevo» cambia el token y el
--      enlace anterior deja de funcionar para siempre.
--    · `public_share_token`: 32 caracteres aleatorios (base64url, 192 bits)
--      generados con crypto.getRandomValues en el navegador del dueño.
--    · Nadie lee las tablas de forma anónima: la ÚNICA puerta es la función
--      get_public_workspace(token) (SECURITY DEFINER, solo SELECT), que
--      devuelve el nombre del espacio, sus nodos y sus cables. Nunca devuelve
--      correos, perfiles, ids de usuario, rutas de archivos, el historial de
--      los chats IA ni datos de otros espacios.
--    Idempotente: se puede ejecutar varias veces sin perder datos.
-- ============================================================================
alter table public.workspaces
  add column if not exists public_share_token text unique;

alter table public.workspaces
  add column if not exists public_share_enabled boolean not null default false;

alter table public.workspaces drop constraint if exists workspaces_public_share_token_format;
alter table public.workspaces add constraint workspaces_public_share_token_format
  check (public_share_token is null or public_share_token ~ '^[A-Za-z0-9_-]{24,64}$');

-- Solo el DUEÑO activa, desactiva o cambia el enlace público (los miembros no).
create or replace function public.workspaces_guard_public_share()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is null then
    return new; -- SQL Editor / service role
  end if;
  if (new.public_share_token is distinct from old.public_share_token
      or new.public_share_enabled is distinct from old.public_share_enabled)
     and auth.uid() is distinct from old.owner_id then
    raise exception 'Solo el dueño puede cambiar el enlace público de este espacio.';
  end if;
  if new.public_share_enabled and new.public_share_token is null then
    raise exception 'Un enlace público activo necesita un token.';
  end if;
  return new;
end;
$$;

drop trigger if exists workspaces_guard_public_share on public.workspaces;
create trigger workspaces_guard_public_share
  before update on public.workspaces
  for each row execute function public.workspaces_guard_public_share();

-- Lectura pública del tablero (anon y authenticated), solo si el token
-- coincide y el enlace está activo. Devuelve NULL en cualquier otro caso.
create or replace function public.get_public_workspace(share_token text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'name', w.name,
    'updatedAt', w.updated_at,
    'nodes', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', n.id,
          'type', n.type,
          'title', n.title,
          'codeTag', n.code_tag,
          'summary', n.summary,
          'x', n.position_x,
          'y', n.position_y,
          'payload', case n.type
            -- Archivos: solo nombre, tipo y medidas (nunca la ruta del bucket).
            when 'file-node' then
              n.payload - 'storagePath' - 'downloadUrl' - 'errorMessage' - 'checksum'
            -- Chats IA: solo el resumen visible, nunca la conversación.
            when 'ai-chat-node' then
              jsonb_build_object('summary', n.payload -> 'summary')
            else n.payload
          end
        )
        order by n.sort_order desc
      )
      from public.workspace_nodes n
      where n.workspace_id = w.id
    ), '[]'::jsonb),
    'connections', coalesce((
      select jsonb_agg(
        jsonb_build_object('id', c.id, 'from', c.from_node_id, 'to', c.to_node_id, 'label', c.label)
      )
      from public.workspace_connections c
      where c.workspace_id = w.id
    ), '[]'::jsonb)
  )
  from public.workspaces w
  where share_token ~ '^[A-Za-z0-9_-]{24,64}$'
    and w.public_share_enabled
    and w.public_share_token = share_token
  limit 1;
$$;

revoke all on function public.get_public_workspace(text) from public;
grant execute on function public.get_public_workspace(text) to anon, authenticated;

-- (Sprint 17B) El token del enlace público es SOLO del dueño. Los miembros
-- del espacio pueden leer su fila (`workspaces_select_member`), así que la
-- columna `public_share_token` se oculta con privilegios por columna y el
-- dueño la lee o la cambia únicamente con las dos funciones de abajo.
-- IMPORTANTE: si en el futuro se añade una columna a `workspaces` que la app
-- deba leer, agrégala también a este GRANT.
revoke select on public.workspaces from anon, authenticated;
grant select (
  id, owner_id, name, created_at, updated_at, canvas_strokes, folder, public_share_enabled
) on public.workspaces to authenticated;

-- Estado del enlace público de UN espacio propio: { enabled, token } o NULL.
create or replace function public.get_workspace_public_share(ws_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('enabled', w.public_share_enabled, 'token', w.public_share_token)
  from public.workspaces w
  where w.id = ws_id and auth.uid() is not null and w.owner_id = auth.uid();
$$;

-- Activa, desactiva o renueva el enlace. Solo el dueño (NULL si no lo es).
create or replace function public.set_workspace_public_share(ws_id uuid, share_enabled boolean, share_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  if auth.uid() is null then
    return null;
  end if;
  if share_token is not null and share_token !~ '^[A-Za-z0-9_-]{24,64}$' then
    raise exception 'El token del enlace público no tiene un formato válido.';
  end if;
  update public.workspaces w
     set public_share_enabled = share_enabled,
         public_share_token = share_token
   where w.id = ws_id and w.owner_id = auth.uid()
  returning jsonb_build_object('enabled', w.public_share_enabled, 'token', w.public_share_token)
    into result;
  return result;
end;
$$;

revoke execute on function public.get_workspace_public_share(uuid) from public, anon;
revoke execute on function public.set_workspace_public_share(uuid, boolean, text) from public, anon;
grant execute on function public.get_workspace_public_share(uuid) to authenticated;
grant execute on function public.set_workspace_public_share(uuid, boolean, text) to authenticated;

-- ============================================================================
-- 12. COMENTARIOS DEL TABLERO (Sprint 16): roles estilo Google Docs
--     · Dueño, Editor y Comentarista leen y crean comentarios.
--     · Solo lectura (viewer) únicamente los lee.
--     · Dueño, Editor y el propio autor marcan como resuelto o borran.
--     · `node_id` NULL = comentario general; con valor = anclado a una tarjeta
--       (sin FK: si la tarjeta se borra, el hilo sigue visible como «tarjeta
--       eliminada» hasta que alguien lo resuelva o lo borre).
--     · En vivo: la app avisa a la sala con Broadcast (`comment:upsert`,
--       `comment:resolve`, `comment:delete`); esta tabla es la fuente de verdad.
--     Idempotente: se puede ejecutar varias veces sin perder datos.
-- ============================================================================
create table if not exists public.workspace_comments (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  node_id       text check (node_id is null or char_length(node_id) between 1 and 120),
  author_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  author_name   text not null default '' check (char_length(author_name) <= 120),
  body          text not null check (char_length(btrim(body)) between 1 and 2000),
  resolved      boolean not null default false,
  created_at    timestamptz not null default now()
);

create index if not exists workspace_comments_ws_idx
  on public.workspace_comments (workspace_id, created_at desc);

-- Al actualizar solo puede cambiar `resolved` (el texto y el autor son fijos).
create or replace function public.workspace_comments_guard_update()
returns trigger
language plpgsql
as $$
begin
  if new.workspace_id is distinct from old.workspace_id
     or new.node_id is distinct from old.node_id
     or new.author_id is distinct from old.author_id
     or new.author_name is distinct from old.author_name
     or new.body is distinct from old.body
     or new.created_at is distinct from old.created_at then
    raise exception 'Solo se puede marcar un comentario como resuelto o pendiente.';
  end if;
  return new;
end;
$$;

drop trigger if exists workspace_comments_guard_update on public.workspace_comments;
create trigger workspace_comments_guard_update
  before update on public.workspace_comments
  for each row execute function public.workspace_comments_guard_update();

-- (Sprint 17B) El autor y su nombre visible salen de la sesión y del perfil,
-- nunca del navegador: nadie puede firmar un comentario con otro nombre.
create or replace function public.workspace_comments_fill_author()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new; -- SQL Editor / service role
  end if;
  new.author_id := auth.uid();
  new.author_name := coalesce(public.profile_display_name(auth.uid()), '');
  return new;
end;
$$;

drop trigger if exists workspace_comments_fill_author on public.workspace_comments;
create trigger workspace_comments_fill_author
  before insert on public.workspace_comments
  for each row execute function public.workspace_comments_fill_author();

alter table public.workspace_comments enable row level security;

-- Leer: cualquier persona con acceso al espacio (incluye «Solo lectura»).
drop policy if exists "workspace_comments_select" on public.workspace_comments;
create policy "workspace_comments_select" on public.workspace_comments
  for select to authenticated
  using (public.is_workspace_member(workspace_id));

-- Crear: dueño, editores y comentaristas, siempre como uno mismo y sin resolver.
drop policy if exists "workspace_comments_insert" on public.workspace_comments;
create policy "workspace_comments_insert" on public.workspace_comments
  for insert to authenticated
  with check (
    public.can_comment_workspace(workspace_id)
    and author_id = (select auth.uid())
    and resolved = false
  );

-- Resolver / reabrir: dueño, editores o el propio autor (si sigue en el espacio).
drop policy if exists "workspace_comments_update" on public.workspace_comments;
create policy "workspace_comments_update" on public.workspace_comments
  for update to authenticated
  using (
    public.can_edit_workspace(workspace_id)
    or (author_id = (select auth.uid()) and public.is_workspace_member(workspace_id))
  )
  with check (
    public.can_edit_workspace(workspace_id)
    or (author_id = (select auth.uid()) and public.is_workspace_member(workspace_id))
  );

-- Borrar: dueño, editores o el propio autor (si sigue en el espacio).
drop policy if exists "workspace_comments_delete" on public.workspace_comments;
create policy "workspace_comments_delete" on public.workspace_comments
  for delete to authenticated
  using (
    public.can_edit_workspace(workspace_id)
    or (author_id = (select auth.uid()) and public.is_workspace_member(workspace_id))
  );

-- ============================================================================
-- 18. (Sprint 18) ENTORNO DE DATOS COMÚN (CDE) CENTRADO EN LAS PERSONAS
--     · Áreas de trabajo nominales (Logística, Presupuesto, Diseño…):
--         workspaces.work_areas       → lista de áreas activas del espacio.
--         workspaces.owner_work_area  → área del dueño (no tiene fila en members).
--         workspace_members.work_area → área de cada miembro.
--       Solo el dueño las cambia (workspaces_guard_shared_update y la política
--       workspace_members_update_owner).
--     · workspace_chat_messages: chat del lienzo con menciones @Área, @usuario
--       y @IA. Lo leen todos los miembros (también «Solo lectura»); escriben
--       dueño, Editor y Comentarista. El autor, su nombre y su área los pone el
--       trigger desde `profiles` y `workspace_members` (nunca el navegador).
--       `kind = 'ai-alert'` guarda la evaluación de la IA de un reporte
--       («@IA se retrasó el proveedor…») como alerta trazable del espacio.
--     · En vivo: la app solo emite `chat:new` (aviso de «vuelve a leer»); cada
--       quien relee la tabla con su RLS (regla 17B: nada se guarda por otro).
--     Idempotente: se puede ejecutar varias veces sin perder datos.
-- ============================================================================

alter table public.workspace_members add column if not exists work_area text not null default '';
alter table public.workspace_members drop constraint if exists workspace_members_work_area_len;
alter table public.workspace_members add constraint workspace_members_work_area_len
  check (char_length(work_area) <= 32);

alter table public.workspaces add column if not exists work_areas jsonb not null default '[]'::jsonb;
alter table public.workspaces add column if not exists owner_work_area text not null default '';
alter table public.workspaces drop constraint if exists workspaces_work_areas_shape;
alter table public.workspaces add constraint workspaces_work_areas_shape
  check (jsonb_typeof(work_areas) = 'array' and jsonb_array_length(work_areas) <= 12);
alter table public.workspaces drop constraint if exists workspaces_owner_work_area_len;
alter table public.workspaces add constraint workspaces_owner_work_area_len
  check (char_length(owner_work_area) <= 32);

create table if not exists public.workspace_chat_messages (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces (id) on delete cascade,
  author_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  author_name     text not null default '' check (char_length(author_name) <= 120),
  author_area     text not null default '' check (char_length(author_area) <= 32),
  body            text not null check (char_length(btrim(body)) between 1 and 2000),
  mentions        jsonb not null default '[]'::jsonb,
  linked_node_id  text check (linked_node_id is null or char_length(linked_node_id) between 1 and 120),
  kind            text not null default 'message',
  alert           jsonb,
  created_at      timestamptz not null default now()
);

-- Bases donde la tabla ya existía con menos columnas.
alter table public.workspace_chat_messages add column if not exists author_area text not null default '';
alter table public.workspace_chat_messages add column if not exists mentions jsonb not null default '[]'::jsonb;
alter table public.workspace_chat_messages add column if not exists linked_node_id text;
alter table public.workspace_chat_messages add column if not exists kind text not null default 'message';
alter table public.workspace_chat_messages add column if not exists alert jsonb;

alter table public.workspace_chat_messages drop constraint if exists workspace_chat_messages_kind_check;
alter table public.workspace_chat_messages add constraint workspace_chat_messages_kind_check
  check (kind in ('message', 'ai-alert'));
alter table public.workspace_chat_messages drop constraint if exists workspace_chat_messages_mentions_shape;
alter table public.workspace_chat_messages add constraint workspace_chat_messages_mentions_shape
  check (jsonb_typeof(mentions) = 'array' and jsonb_array_length(mentions) <= 30);
alter table public.workspace_chat_messages drop constraint if exists workspace_chat_messages_alert_shape;
alter table public.workspace_chat_messages add constraint workspace_chat_messages_alert_shape
  check (
    (kind = 'message' and alert is null)
    or (kind = 'ai-alert' and jsonb_typeof(alert) = 'object' and octet_length(alert::text) <= 8000)
  );

create index if not exists workspace_chat_messages_ws_idx
  on public.workspace_chat_messages (workspace_id, created_at desc);

-- Autor, nombre visible y área: SIEMPRE de la sesión, del perfil y de la fila
-- de miembro (o del área del dueño). Nadie firma con otro nombre ni otra área.
create or replace function public.workspace_chat_fill_author()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new; -- SQL Editor / service role
  end if;
  new.author_id := auth.uid();
  new.author_name := coalesce(public.profile_display_name(auth.uid()), '');
  new.author_area := coalesce(
    (select nullif(btrim(m.work_area), '') from public.workspace_members m
      where m.workspace_id = new.workspace_id and m.user_id = auth.uid()),
    (select nullif(btrim(w.owner_work_area), '') from public.workspaces w
      where w.id = new.workspace_id and w.owner_id = auth.uid()),
    ''
  );
  new.created_at := now();
  return new;
end;
$$;

drop trigger if exists workspace_chat_fill_author on public.workspace_chat_messages;
create trigger workspace_chat_fill_author
  before insert on public.workspace_chat_messages
  for each row execute function public.workspace_chat_fill_author();

-- Los mensajes no se editan (trazabilidad): solo se borran.
create or replace function public.workspace_chat_block_update()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Los mensajes del chat no se editan: bórralo y escribe uno nuevo.';
end;
$$;

drop trigger if exists workspace_chat_block_update on public.workspace_chat_messages;
create trigger workspace_chat_block_update
  before update on public.workspace_chat_messages
  for each row execute function public.workspace_chat_block_update();

alter table public.workspace_chat_messages enable row level security;

-- Leer: cualquier persona con acceso al espacio (incluye «Solo lectura»).
drop policy if exists "workspace_chat_select" on public.workspace_chat_messages;
create policy "workspace_chat_select" on public.workspace_chat_messages
  for select to authenticated
  using (public.is_workspace_member(workspace_id));

-- Escribir: dueño, Editor y Comentarista, siempre como uno mismo.
drop policy if exists "workspace_chat_insert" on public.workspace_chat_messages;
create policy "workspace_chat_insert" on public.workspace_chat_messages
  for insert to authenticated
  with check (
    public.can_comment_workspace(workspace_id)
    and author_id = (select auth.uid())
  );

-- Sin política de UPDATE: nadie edita mensajes (además lo bloquea el trigger).
drop policy if exists "workspace_chat_update" on public.workspace_chat_messages;

-- Borrar: el propio autor (si sigue en el espacio) o el dueño.
drop policy if exists "workspace_chat_delete" on public.workspace_chat_messages;
create policy "workspace_chat_delete" on public.workspace_chat_messages
  for delete to authenticated
  using (
    (author_id = (select auth.uid()) and public.is_workspace_member(workspace_id))
    or public.workspace_owner_id(workspace_id) = (select auth.uid())
  );

-- ============================================================================
-- 21. (Sprint 21) SUSCRIPCIONES (PLAN BASICO / ANDROS PRO) Y LIMITES REALES
--     · user_subscriptions: una fila por cuenta con su plan y el estado que
--       informa el proveedor de pagos (Merchant of Record). Andros NUNCA
--       guarda datos de tarjeta: solo ids del proveedor y fechas.
--     · RLS: cada persona solo LEE su propia fila. No hay politicas de
--       INSERT/UPDATE/DELETE para el navegador y ademas se revocan esos
--       permisos: solo el servidor (service_role, desde el webhook firmado
--       /api/billing/webhook) escribe. Nadie puede auto-asignarse 'pro'.
--     · user_plan(uid): plan efectivo ('free' | 'pro'), igual que
--       planFromSubscription() en src/lib/billing/planLimits.ts (estados con
--       acceso Pro y 72 h de margen tras current_period_end). Uso interno.
--     · workspace_live_cap(ws_id): tope de personas en vivo del espacio segun
--       el plan de su DUENO (3 Basico / 6 Pro). Solo para miembros.
--     · Trigger workspaces_enforce_plan_limit: el Plan Basico no puede crear
--       un 3.er espacio propio aunque alguien salte la interfaz.
--     Idempotente: se puede ejecutar varias veces sin perder datos.
-- ============================================================================

create table if not exists public.user_subscriptions (
  user_id                   uuid primary key references auth.users (id) on delete cascade,
  plan                      text not null default 'free',
  status                    text not null default 'inactive',
  billing_cycle             text,
  provider                  text,
  provider_customer_id      text,
  provider_subscription_id  text,
  current_period_end        timestamptz,
  updated_at                timestamptz not null default now()
);

-- Bases donde la tabla ya existia con menos columnas.
alter table public.user_subscriptions add column if not exists plan text not null default 'free';
alter table public.user_subscriptions add column if not exists status text not null default 'inactive';
alter table public.user_subscriptions add column if not exists billing_cycle text;
alter table public.user_subscriptions add column if not exists provider text;
alter table public.user_subscriptions add column if not exists provider_customer_id text;
alter table public.user_subscriptions add column if not exists provider_subscription_id text;
alter table public.user_subscriptions add column if not exists current_period_end timestamptz;
alter table public.user_subscriptions add column if not exists updated_at timestamptz not null default now();

alter table public.user_subscriptions drop constraint if exists user_subscriptions_plan_check;
alter table public.user_subscriptions add constraint user_subscriptions_plan_check
  check (plan in ('free','pro'));
alter table public.user_subscriptions drop constraint if exists user_subscriptions_cycle_check;
alter table public.user_subscriptions add constraint user_subscriptions_cycle_check
  check (billing_cycle is null or billing_cycle in ('monthly','annual'));
alter table public.user_subscriptions drop constraint if exists user_subscriptions_text_len;
alter table public.user_subscriptions add constraint user_subscriptions_text_len
  check (
    char_length(status) <= 32
    and (provider is null or char_length(provider) <= 32)
    and (provider_customer_id is null or char_length(provider_customer_id) <= 64)
    and (provider_subscription_id is null or char_length(provider_subscription_id) <= 64)
  );

drop trigger if exists user_subscriptions_set_updated_at on public.user_subscriptions;
create trigger user_subscriptions_set_updated_at
  before update on public.user_subscriptions
  for each row execute function public.set_updated_at();

alter table public.user_subscriptions enable row level security;

-- Leer: solo la fila propia.
drop policy if exists "user_subscriptions_select_own" on public.user_subscriptions;
create policy "user_subscriptions_select_own" on public.user_subscriptions
  for select to authenticated
  using (user_id = (select auth.uid()));

-- Escribir: NADIE desde el navegador (sin politicas y sin permisos).
drop policy if exists "user_subscriptions_insert" on public.user_subscriptions;
drop policy if exists "user_subscriptions_update" on public.user_subscriptions;
drop policy if exists "user_subscriptions_delete" on public.user_subscriptions;
revoke insert, update, delete, truncate on public.user_subscriptions from anon, authenticated;
revoke all on public.user_subscriptions from anon;
grant select on public.user_subscriptions to authenticated;
grant all on public.user_subscriptions to service_role;

-- Plan efectivo de una cuenta (uso interno de las funciones de abajo).
create or replace function public.user_plan(uid uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when exists (
      select 1 from public.user_subscriptions s
      where s.user_id = uid
        and s.plan = 'pro'
        and s.status in ('active', 'on_trial', 'past_due', 'cancelled')
        and (s.current_period_end is null or s.current_period_end + interval '72 hours' > now())
    ) then 'pro'
    else 'free'
  end;
$$;

-- Nadie consulta el plan de otra cuenta desde el navegador.
revoke all on function public.user_plan(uuid) from public, anon, authenticated;

-- Tope de personas en vivo del espacio (plan del DUENO): 3 Basico / 6 Pro.
-- NULL si quien pregunta no es miembro del espacio.
create or replace function public.workspace_live_cap(ws_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select case
    when not public.is_workspace_member(ws_id) then null
    when public.user_plan(public.workspace_owner_id(ws_id)) = 'pro' then 6
    else 3
  end;
$$;

revoke all on function public.workspace_live_cap(uuid) from public, anon;
grant execute on function public.workspace_live_cap(uuid) to authenticated;

-- Plan Basico: hasta 2 espacios propios (los compartidos contigo no cuentan).
create or replace function public.workspaces_enforce_plan_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  owned integer;
begin
  if auth.uid() is null then
    return new; -- SQL Editor / service role
  end if;
  if public.user_plan(new.owner_id) = 'pro' then
    return new;
  end if;
  -- Serializa las altas de la misma cuenta (dos pestanas a la vez).
  perform pg_advisory_xact_lock(hashtext('andros-ws-limit:' || new.owner_id::text));
  select count(*) into owned from public.workspaces where owner_id = new.owner_id;
  if owned >= 2 then
    raise exception 'Plan Básico: hasta 2 espacios activos. Pasa a Andros Pro para crear más.'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke all on function public.workspaces_enforce_plan_limit() from public, anon, authenticated;

drop trigger if exists workspaces_enforce_plan_limit on public.workspaces;
create trigger workspaces_enforce_plan_limit
  before insert on public.workspaces
  for each row execute function public.workspaces_enforce_plan_limit();
