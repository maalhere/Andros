// ============================================================================
// ANDROS ARENA — CAPA DE DATOS (Supabase + respaldo local)
//
// · Con Supabase y las tablas `arena_posts` / `arena_submissions` creadas
//   (supabase/schema.sql), todo se lee y escribe en la nube.
// · Si faltan las tablas, no hay sesión o no hay red, se guarda en
//   localStorage y se mezcla con las publicaciones de ejemplo: el flujo
//   publicar → etiquetar → filtrar → postular funciona igual en el navegador.
// ============================================================================

import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type {
  ArenaAnalyzeResponse,
  ArenaFilterQuery,
  ArenaPost,
  ArenaPostDraft,
  ArenaSubmission,
  PortfolioSnapshot,
} from "@/types/arena";
import { EXAMPLE_POSTS, EXAMPLE_SUBMISSIONS } from "./seed";

const POSTS_KEY = "andros.arena.posts.v1";
const SUBMISSIONS_KEY = "andros.arena.submissions.v1";

export const ARENA_SETUP_HINT =
  "Ejecuta supabase/schema.sql en el SQL Editor de Supabase para activar la Arena en la nube.";

// ----------------------------------------------------------------------------
// localStorage
// ----------------------------------------------------------------------------

function readList<T>(key: string): T[] {
  try {
    const raw = window.localStorage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function writeList<T>(key: string, list: T[]) {
  try {
    window.localStorage.setItem(key, JSON.stringify(list));
  } catch {
    // Sin almacenamiento disponible: los datos viven solo en memoria.
  }
}

const localPosts = () => readList<ArenaPost>(POSTS_KEY).filter((p) => p && p.id && p.tags);
const localSubmissions = () => readList<ArenaSubmission>(SUBMISSIONS_KEY).filter((s) => s && s.id && s.snapshot);

// ----------------------------------------------------------------------------
// Filas de Supabase
// ----------------------------------------------------------------------------

interface PostRow {
  id: string;
  type: ArenaPost["type"];
  title: string;
  organization: string;
  description: string;
  stipend: string | null;
  location: string | null;
  tags: ArenaPost["tags"];
  moderation: ArenaPost["moderation"];
  ai_engine: string | null;
  author_name: string | null;
  created_at: string;
}

const POST_COLUMNS = "id, type, title, organization, description, stipend, location, tags, moderation, ai_engine, author_name, created_at";

const rowToPost = (r: PostRow): ArenaPost => ({
  id: r.id,
  type: r.type,
  title: r.title,
  organization: r.organization,
  description: r.description,
  stipend: r.stipend ?? undefined,
  location: r.location ?? undefined,
  tags: { type: r.type, discipline: r.tags?.discipline ?? [], level: r.tags?.level ?? [], skills: r.tags?.skills ?? [] },
  moderation: r.moderation ?? { status: "approved", qualityScore: 70, issues: [], suggestions: [] },
  engine: r.ai_engine === "gemini" ? "gemini" : "keywords",
  authorName: r.author_name ?? undefined,
  createdAt: r.created_at,
});

interface SubmissionRow {
  id: string;
  post_id: string;
  workspace_id: string | null;
  note: string | null;
  applicant_name: string | null;
  snapshot: PortfolioSnapshot;
  is_public: boolean;
  created_at: string;
}

const SUBMISSION_COLUMNS = "id, post_id, workspace_id, note, applicant_name, snapshot, is_public, created_at";

const rowToSubmission = (r: SubmissionRow): ArenaSubmission => ({
  id: r.id,
  postId: r.post_id,
  workspaceId: r.workspace_id,
  note: r.note ?? "",
  applicantName: r.applicant_name ?? "Participante",
  snapshot: r.snapshot,
  isPublic: r.is_public,
  createdAt: r.created_at,
});

function errorText(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    const m = (error as { message: unknown }).message;
    if (typeof m === "string" && m) return m;
  }
  return "error desconocido";
}

/** `true` si el error es "la tabla no existe" (sin migrar). */
function isMissingTable(error: unknown): boolean {
  const code = error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : "";
  return code === "42P01" || code === "PGRST205" || /does not exist|could not find the table/i.test(errorText(error));
}

/** Quita caracteres que romperían el filtro `or()` de PostgREST. */
const safeLike = (q: string) => q.replace(/[,()*%\\:"']/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);

// ----------------------------------------------------------------------------
// API pública
// ----------------------------------------------------------------------------

export interface ArenaLoadResult {
  posts: ArenaPost[];
  /** La nube respondió (tablas creadas). */
  cloudReady: boolean;
  notice?: string;
}

function mergePosts(cloud: ArenaPost[]): ArenaPost[] {
  const local = localPosts().map((p) => ({ ...p, isLocal: true }));
  const seen = new Set<string>();
  return [...cloud, ...local, ...EXAMPLE_POSTS].filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)));
}

/**
 * Carga las publicaciones. Con `filters`, la nube filtra en la base de datos
 * (texto, tipo, disciplina, nivel); las locales y de ejemplo se filtran en el cliente.
 */
export async function loadArenaPosts(filters?: ArenaFilterQuery): Promise<ArenaLoadResult> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) {
    return { posts: mergePosts([]), cloudReady: false, notice: "Modo local: sin Supabase configurado, las publicaciones se guardan en este navegador." };
  }
  try {
    let query = supabase.from("arena_posts").select(POST_COLUMNS).neq("moderation_status", "rejected").order("created_at", { ascending: false }).limit(200);
    if (filters?.type) query = query.eq("type", filters.type);
    if (filters?.discipline) query = query.contains("tags", { discipline: [filters.discipline] });
    if (filters?.level) query = query.contains("tags", { level: [filters.level] });
    const q = filters?.text ? safeLike(filters.text) : "";
    if (q) query = query.or(`title.ilike.%${q}%,description.ilike.%${q}%,organization.ilike.%${q}%`);
    const { data, error } = await query;
    if (error) {
      return {
        posts: mergePosts([]),
        cloudReady: false,
        notice: isMissingTable(error) ? `Modo local: la Arena aún no tiene tablas en la nube. ${ARENA_SETUP_HINT}` : `Modo local (la nube respondió: ${errorText(error)}).`,
      };
    }
    return { posts: mergePosts(((data ?? []) as PostRow[]).map(rowToPost)), cloudReady: true };
  } catch (error) {
    return { posts: mergePosts([]), cloudReady: false, notice: `Modo local: sin conexión con la nube (${errorText(error)}).` };
  }
}

export interface PublishResult {
  post: ArenaPost;
  notice: string;
}

export async function publishArenaPost(
  draft: ArenaPostDraft,
  analysis: ArenaAnalyzeResponse,
  user: { id: string; name: string } | null,
  cloudReady: boolean
): Promise<PublishResult> {
  const base: Omit<ArenaPost, "id" | "createdAt"> = {
    ...draft,
    tags: analysis.tags,
    moderation: analysis.moderation,
    engine: analysis.engine,
    authorName: user?.name || "Tú",
  };
  const saveLocal = (notice: string): PublishResult => {
    const post: ArenaPost = { ...base, id: `local-${Date.now()}`, createdAt: new Date().toISOString(), isLocal: true };
    writeList(POSTS_KEY, [post, ...localPosts()].slice(0, 100));
    return { post, notice };
  };

  const supabase = getSupabaseBrowserClient();
  if (!supabase || !user) {
    return saveLocal("Publicado en este navegador. Inicia sesión con Google para publicarlo en la nube de la Arena.");
  }
  if (!cloudReady) return saveLocal(`Publicado en este navegador. ${ARENA_SETUP_HINT}`);

  const { data, error } = await supabase
    .from("arena_posts")
    .insert({
      type: draft.type,
      title: draft.title,
      organization: draft.organization,
      description: draft.description,
      stipend: draft.stipend ?? null,
      location: draft.location ?? null,
      tags: analysis.tags,
      moderation: analysis.moderation,
      moderation_status: analysis.moderation.status,
      ai_engine: analysis.engine,
      author_name: user.name || null,
    })
    .select(POST_COLUMNS)
    .single();
  if (error || !data) return saveLocal(`Publicado solo en este navegador (la nube respondió: ${errorText(error)}).`);
  return { post: rowToPost(data as PostRow), notice: "¡Publicado en Andros Arena!" };
}

export function deleteLocalPost(id: string) {
  writeList(POSTS_KEY, localPosts().filter((p) => p.id !== id));
  writeList(SUBMISSIONS_KEY, localSubmissions().filter((s) => s.postId !== id));
}

/** Soluciones visibles de una publicación: ejemplo + locales + nube. */
export async function loadSubmissions(post: ArenaPost, cloudReady: boolean): Promise<ArenaSubmission[]> {
  const examples = EXAMPLE_SUBMISSIONS.filter((s) => s.postId === post.id);
  const local = localSubmissions()
    .filter((s) => s.postId === post.id)
    .map((s) => ({ ...s, isLocal: true }));
  let cloud: ArenaSubmission[] = [];
  const supabase = getSupabaseBrowserClient();
  if (supabase && cloudReady && !post.isExample && !post.isLocal) {
    const { data, error } = await supabase
      .from("arena_submissions")
      .select(SUBMISSION_COLUMNS)
      .eq("post_id", post.id)
      .order("created_at", { ascending: false })
      .limit(100);
    if (!error) cloud = ((data ?? []) as SubmissionRow[]).map(rowToSubmission);
  }
  return [...local, ...cloud, ...examples];
}

export interface SubmitInput {
  post: ArenaPost;
  workspaceId: string | null;
  note: string;
  snapshot: PortfolioSnapshot;
  isPublic: boolean;
}

export async function submitToArena(
  input: SubmitInput,
  user: { id: string; name: string } | null,
  cloudReady: boolean
): Promise<{ submission: ArenaSubmission; notice: string }> {
  const saveLocal = (notice: string) => {
    const submission: ArenaSubmission = {
      id: `local-sub-${Date.now()}`,
      postId: input.post.id,
      workspaceId: input.workspaceId,
      note: input.note,
      applicantName: user?.name || "Tú",
      snapshot: input.snapshot,
      isPublic: input.isPublic,
      createdAt: new Date().toISOString(),
      isLocal: true,
    };
    writeList(SUBMISSIONS_KEY, [submission, ...localSubmissions()].slice(0, 200));
    return { submission, notice };
  };

  const supabase = getSupabaseBrowserClient();
  if (input.post.isExample) {
    return saveLocal("¡Listo! Es una publicación de ejemplo, así que tu portafolio se guardó en este navegador y ya aparece en «Soluciones».");
  }
  if (input.post.isLocal) return saveLocal("Postulación guardada en este navegador junto a la publicación local.");
  if (!supabase || !user) return saveLocal("Guardada en este navegador. Inicia sesión con Google para enviarla a quien publicó.");
  if (!cloudReady) return saveLocal(`Guardada en este navegador. ${ARENA_SETUP_HINT}`);

  // Solo se enlaza el espacio si es un UUID de la nube (el lienzo local no lo es).
  const workspaceId = input.workspaceId && /^[0-9a-f-]{36}$/i.test(input.workspaceId) ? input.workspaceId : null;
  const { data, error } = await supabase
    .from("arena_submissions")
    .insert({
      post_id: input.post.id,
      workspace_id: workspaceId,
      note: input.note || null,
      applicant_name: user.name || null,
      snapshot: input.snapshot,
      is_public: input.isPublic,
    })
    .select(SUBMISSION_COLUMNS)
    .single();
  if (error || !data) {
    if ((error as { code?: string } | null)?.code === "23505") {
      return saveLocal("Ya habías enviado una solución a esta publicación; esta nueva versión quedó guardada en tu navegador.");
    }
    return saveLocal(`Guardada en este navegador (la nube respondió: ${errorText(error)}).`);
  }
  return { submission: rowToSubmission(data as SubmissionRow), notice: "¡Enviado! Tu espacio de Andros va como portafolio verificable." };
}
