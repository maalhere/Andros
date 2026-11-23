"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  Check,
  Copy,
  Download,
  Folder,
  FolderInput,
  FolderOpen,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  Upload,
  Users,
  X,
} from "lucide-react";
import { useCloudStore } from "@/store/useCloudStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import {
  useWorkspaceManagerStore,
  type WorkspaceSummary,
} from "@/store/useWorkspaceManagerStore";
import {
  createCloudWorkspace,
  deleteCloudWorkspace,
  duplicateCloudWorkspace,
  moveCloudWorkspace,
  openCloudWorkspace,
  renameCloudFolder,
  refreshCloudWorkspaceList,
  renameCloudWorkspace,
} from "@/hooks/useCloudSync";
import { useSocialStore } from "@/store/useSocialStore";
import { SOCIAL_SETUP_HINT } from "@/lib/social/repository";

/** JSZip (~100 KB) solo se descarga al exportar o importar un paquete .zip. */
const loadWorkspaceZip = () => import("@/lib/export/workspaceZip");

// ============================================================================
// ANDROS — GESTOR DE ESPACIOS DE TRABAJO
//   · Crear, renombrar, duplicar, mover a carpetas y borrar espacios.
//   · Descargar el espacio abierto como `.andros.zip` y abrir paquetes.
// Con sesión de Google los espacios viven en la tabla `workspaces`; sin
// sesión solo están disponibles las funciones de .zip.
// ============================================================================

const NO_FOLDER = "";
const BTN =
  "min-h-[36px] px-3 rounded-xl text-[11px] font-medium flex items-center justify-center gap-1.5 border border-andros-border bg-andros-surface text-andros-primary hover:border-andros-border-active active:scale-95 spring-micro disabled:opacity-50 disabled:pointer-events-none";
const ICON_BTN =
  "p-1.5 rounded-lg text-andros-muted hover:text-andros-primary hover:bg-andros-border/40 active:scale-95 spring-micro disabled:opacity-40";
const INPUT =
  "w-full h-9 px-2.5 rounded-lg bg-andros-canvas border border-andros-border text-xs text-andros-primary placeholder:text-andros-muted focus:outline-none focus:border-andros-border-active";

type Editing =
  | { kind: "workspace"; id: string; value: string }
  | { kind: "move"; id: string; value: string }
  | { kind: "folder"; from: string; value: string }
  | { kind: "delete"; id: string }
  | null;

export const WorkspaceManagerDrawer: React.FC = () => {
  const open = useWorkspaceManagerStore((s) => s.drawerOpen);
  const setOpen = useWorkspaceManagerStore((s) => s.setDrawerOpen);
  const workspaces = useWorkspaceManagerStore((s) => s.workspaces);
  const sharedWorkspaces = useWorkspaceManagerStore((s) => s.sharedWorkspaces);
  const socialSetupMissing = useSocialStore((s) => s.setupMissing);
  const foldersSupported = useWorkspaceManagerStore((s) => s.foldersSupported);
  const busy = useWorkspaceManagerStore((s) => s.busy);
  const message = useWorkspaceManagerStore((s) => s.message);
  const setMessage = useWorkspaceManagerStore((s) => s.setMessage);
  const user = useCloudStore((s) => s.user);
  const activeId = useCloudStore((s) => s.workspaceId);
  const reduced = useSettingsStore((s) => s.animations) === "reduced";

  const [newName, setNewName] = useState("");
  const [newFolder, setNewFolder] = useState(NO_FOLDER);
  const [editing, setEditing] = useState<Editing>(null);
  const [zipBusy, setZipBusy] = useState<null | "export" | "import">(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // Al abrir se actualiza «Compartidos conmigo» (por si alguien te añadió).
  useEffect(() => {
    if (open) void refreshCloudWorkspaceList();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  const folders = useMemo(() => {
    const names = [...new Set(workspaces.map((w) => w.folder))].filter((f) => f !== NO_FOLDER);
    names.sort((a, b) => a.localeCompare(b, "es"));
    return names;
  }, [workspaces]);

  const grouped = useMemo(() => {
    const groups: { folder: string; items: WorkspaceSummary[] }[] = [];
    for (const folder of [...folders, NO_FOLDER]) {
      const items = workspaces.filter((w) => w.folder === folder);
      if (items.length > 0) groups.push({ folder, items });
    }
    return groups;
  }, [workspaces, folders]);

  const locked = busy || zipBusy !== null;

  const handleCreate = async () => {
    const ok = await createCloudWorkspace(newName, newFolder);
    if (ok) {
      setNewName("");
      setOpen(false);
    }
  };

  const handleExport = async () => {
    setZipBusy("export");
    setMessage(null);
    try {
      const { downloadWorkspaceZip } = await loadWorkspaceZip();
      const result = await downloadWorkspaceZip();
      if (!result.downloaded) {
        setMessage({ kind: "info", text: `Descarga cancelada: no se guardó ${result.fileName}.` });
        return;
      }
      const parts = [
        `Descargado ${result.fileName}`,
        `${result.fileCount} archivo(s)`,
        `${result.noteCount} nota(s)`,
      ];
      const skip = result.skipped.length
        ? ` No se pudieron incluir: ${result.skipped.join(", ")}.`
        : "";
      setMessage({ kind: result.skipped.length ? "error" : "info", text: parts.join(" · ") + "." + skip });
    } catch (error) {
      setMessage({
        kind: "error",
        text: `No se pudo crear el paquete: ${error instanceof Error ? error.message : "error desconocido"}`,
      });
    } finally {
      setZipBusy(null);
    }
  };

  const handleImport = async (file: File) => {
    setZipBusy("import");
    setMessage(null);
    try {
      const { applyImportedProject, readWorkspaceZip } = await loadWorkspaceZip();
      const project = await readWorkspaceZip(file);
      const where = await applyImportedProject(project);
      const missing = project.missingFiles.length
        ? ` Faltaban archivos: ${project.missingFiles.join(", ")}.`
        : "";
      if (where === "cloud-failed") {
        // El error ya lo mostró el gestor; el lienzo no cambió.
        return;
      }
      setMessage({
        kind: project.missingFiles.length ? "error" : "info",
        text:
          where === "cloud"
            ? `"${project.name}" se abrió como espacio nuevo y sus archivos se están subiendo a tu nube.${missing}`
            : `"${project.name}" se abrió en este lienzo (modo local).${missing}`,
      });
      if (!missing) setOpen(false);
    } catch (error) {
      setMessage({
        kind: "error",
        text: error instanceof Error ? error.message : "No se pudo abrir el archivo.",
      });
    } finally {
      setZipBusy(null);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const commitEdit = async () => {
    if (!editing) return;
    const current = editing;
    setEditing(null);
    if (current.kind === "workspace") await renameCloudWorkspace(current.id, current.value);
    else if (current.kind === "move") await moveCloudWorkspace(current.id, current.value);
    else if (current.kind === "folder") await renameCloudFolder(current.from, current.value);
    else await deleteCloudWorkspace(current.id);
  };

  if (typeof document === "undefined") return null;

  const renderRow = (w: WorkspaceSummary) => {
    const isActive = w.id === activeId;
    const edit = editing && "id" in editing && editing.id === w.id ? editing : null;

    return (
      <li
        key={w.id}
        className={`rounded-xl border p-2 ${
          isActive
            ? "border-andros-accent/60 bg-andros-accent/5"
            : "border-andros-border bg-andros-surface"
        }`}
      >
        {edit && edit.kind !== "delete" ? (
          <form
            className="flex items-center gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              void commitEdit();
            }}
          >
            <input
              autoFocus
              list={edit.kind === "move" ? "andros-folder-list" : undefined}
              value={edit.value}
              placeholder={edit.kind === "move" ? "Carpeta (vacío = sin carpeta)" : "Nombre"}
              onChange={(e) => setEditing({ ...edit, value: e.target.value })}
              className={INPUT}
              maxLength={80}
            />
            <button type="submit" aria-label="Guardar" className={ICON_BTN}>
              <Check className="w-4 h-4" />
            </button>
            <button
              type="button"
              aria-label="Cancelar"
              onClick={() => setEditing(null)}
              className={ICON_BTN}
            >
              <X className="w-4 h-4" />
            </button>
          </form>
        ) : edit?.kind === "delete" ? (
          <div className="flex items-center justify-between gap-2 text-[11px]">
            <span className="text-andros-primary">
              ¿Borrar &quot;{w.name}&quot; y sus archivos?
            </span>
            <span className="flex gap-1 shrink-0">
              <button type="button" className={BTN} onClick={() => void commitEdit()}>
                Borrar
              </button>
              <button type="button" className={BTN} onClick={() => setEditing(null)}>
                No
              </button>
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={locked}
              onClick={() => {
                void openCloudWorkspace(w.id).then(() => setOpen(false));
              }}
              className="flex-1 min-w-0 text-left px-1.5 py-1 rounded-lg hover:bg-andros-border/30 spring-micro"
              title="Abrir este espacio"
            >
              <span className="flex items-center gap-1.5 text-xs font-medium text-andros-primary">
                <span className="truncate">{w.name}</span>
                {isActive && (
                  <span className="shrink-0 text-[9px] font-mono uppercase px-1.5 py-0.5 rounded bg-andros-accent/15 text-andros-accent-ink">
                    abierto
                  </span>
                )}
              </span>
              <span className="block text-[10px] font-mono text-andros-muted">
                {w.updatedAt ? new Date(w.updatedAt).toLocaleDateString("es") : ""}
              </span>
            </button>
            <button
              type="button"
              disabled={locked}
              aria-label={`Renombrar ${w.name}`}
              title="Renombrar"
              className={ICON_BTN}
              onClick={() => setEditing({ kind: "workspace", id: w.id, value: w.name })}
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              disabled={locked}
              aria-label={`Mover ${w.name} a una carpeta`}
              title="Mover a carpeta"
              className={ICON_BTN}
              onClick={() => setEditing({ kind: "move", id: w.id, value: w.folder })}
            >
              <FolderInput className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              disabled={locked}
              aria-label={`Duplicar ${w.name}`}
              title="Duplicar"
              className={ICON_BTN}
              onClick={() => void duplicateCloudWorkspace(w.id)}
            >
              <Copy className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              disabled={locked}
              aria-label={`Borrar ${w.name}`}
              title="Borrar"
              className={ICON_BTN}
              onClick={() => setEditing({ kind: "delete", id: w.id })}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </li>
    );
  };

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[80] flex justify-start bg-black/40 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduced ? 0 : 0.18 }}
          onPointerDown={() => setOpen(false)}
        >
          <motion.aside
            role="dialog"
            aria-modal="true"
            aria-label="Gestor de espacios de trabajo"
            onPointerDown={(e) => e.stopPropagation()}
            initial={{ x: -32, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -24, opacity: 0 }}
            transition={
              reduced ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 34, mass: 0.8 }
            }
            className="w-full max-w-sm h-full overflow-y-auto bg-andros-card border-r border-andros-border shadow-hud-light dark:shadow-hud-dark p-5 space-y-5"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-andros-primary">
                <FolderOpen className="w-4 h-4 text-andros-accent-ink" />
                <h2 className="text-sm font-semibold">Espacios de trabajo</h2>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Cerrar gestor"
                className={ICON_BTN}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Paquete portable */}
            <section className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-andros-primary">
                Proyecto portable
              </h3>
              <p className="text-[11px] text-andros-muted">
                Guarda el espacio abierto en tu computadora (nodos, tinta, modelos 3D y notas) o
                abre un paquete .andros.zip.
              </p>
              <div className="grid grid-cols-1 gap-2">
                <button type="button" className={BTN} disabled={locked} onClick={() => void handleExport()}>
                  {zipBusy === "export" ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Download className="w-3.5 h-3.5" />
                  )}
                  Descargar Proyecto (.zip)
                </button>
                <button
                  type="button"
                  className={BTN}
                  disabled={locked}
                  onClick={() => fileInput.current?.click()}
                >
                  {zipBusy === "import" ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Upload className="w-3.5 h-3.5" />
                  )}
                  Abrir archivo .andros.zip
                </button>
                <input
                  ref={fileInput}
                  type="file"
                  accept=".zip,application/zip"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void handleImport(file);
                  }}
                />
              </div>
            </section>

            {message && (
              <p
                role="status"
                className={`text-[11px] rounded-lg px-2.5 py-2 border ${
                  message.kind === "error"
                    ? "border-andros-accent/50 text-andros-accent-ink bg-andros-accent/5"
                    : "border-andros-border text-andros-muted"
                }`}
              >
                {message.text}
              </p>
            )}

            {/* Espacios en la nube */}
            {user ? (
              <>
                <section className="space-y-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-andros-primary">
                    Nuevo espacio
                  </h3>
                  <form
                    className="space-y-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void handleCreate();
                    }}
                  >
                    <input
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      placeholder="Nombre de la investigación"
                      maxLength={80}
                      className={INPUT}
                    />
                    {foldersSupported && (
                      <input
                        value={newFolder}
                        onChange={(e) => setNewFolder(e.target.value)}
                        list="andros-folder-list"
                        placeholder="Carpeta (opcional, escribe para crear una)"
                        maxLength={60}
                        className={INPUT}
                      />
                    )}
                    <button type="submit" className={BTN + " w-full"} disabled={locked}>
                      <Plus className="w-3.5 h-3.5" />
                      Crear y abrir
                    </button>
                  </form>
                  <datalist id="andros-folder-list">
                    {folders.map((f) => (
                      <option key={f} value={f} />
                    ))}
                  </datalist>
                </section>

                <section className="space-y-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-andros-primary flex items-center gap-2">
                    Mis espacios
                    {busy && <Loader2 className="w-3 h-3 animate-spin text-andros-muted" />}
                  </h3>
                  {!foldersSupported && (
                    <p className="text-[11px] text-andros-muted">
                      Para usar carpetas, ejecuta de nuevo supabase/schema.sql en el SQL Editor de
                      Supabase.
                    </p>
                  )}
                  {grouped.length === 0 && (
                    <p className="text-[11px] text-andros-muted">Aún no hay espacios guardados.</p>
                  )}
                  {grouped.map((group) => (
                    <div key={group.folder || "__root"} className="space-y-1.5">
                      {group.folder !== NO_FOLDER && (
                        <div className="flex items-center gap-1.5 text-[11px] font-mono text-andros-muted">
                          <Folder className="w-3.5 h-3.5" />
                          {editing?.kind === "folder" && editing.from === group.folder ? (
                            <form
                              className="flex items-center gap-1 flex-1"
                              onSubmit={(e) => {
                                e.preventDefault();
                                void commitEdit();
                              }}
                            >
                              <input
                                autoFocus
                                value={editing.value}
                                onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                                className={INPUT}
                                maxLength={60}
                              />
                              <button type="submit" aria-label="Guardar carpeta" className={ICON_BTN}>
                                <Check className="w-4 h-4" />
                              </button>
                            </form>
                          ) : (
                            <>
                              <span className="truncate">{group.folder}</span>
                              <button
                                type="button"
                                disabled={locked}
                                aria-label={`Renombrar carpeta ${group.folder}`}
                                className={ICON_BTN}
                                onClick={() =>
                                  setEditing({ kind: "folder", from: group.folder, value: group.folder })
                                }
                              >
                                <Pencil className="w-3 h-3" />
                              </button>
                            </>
                          )}
                        </div>
                      )}
                      <ul className="space-y-1.5">{group.items.map(renderRow)}</ul>
                    </div>
                  ))}
                </section>

                {/* Espacios de otras cuentas donde eres miembro */}
                <section className="space-y-2" aria-labelledby="andros-shared-with-me">
                  <h3
                    id="andros-shared-with-me"
                    className="text-xs font-semibold uppercase tracking-wider text-andros-primary flex items-center gap-2"
                  >
                    <Users className="w-3.5 h-3.5 text-andros-muted" aria-hidden="true" />
                    Compartidos conmigo
                  </h3>
                  {socialSetupMissing ? (
                    <p className="text-[11px] text-andros-warning">{SOCIAL_SETUP_HINT}</p>
                  ) : sharedWorkspaces.length === 0 ? (
                    <p className="text-[11px] text-andros-muted">
                      Cuando una amistad te añada a su espacio, aparecerá aquí.
                    </p>
                  ) : (
                    <ul className="space-y-1.5">
                      {sharedWorkspaces.map((w) => {
                        const isActive = w.id === activeId;
                        return (
                          <li
                            key={w.id}
                            className={`rounded-xl border p-2 ${
                              isActive
                                ? "border-andros-accent/60 bg-andros-accent/5"
                                : "border-andros-border bg-andros-surface"
                            }`}
                          >
                            <button
                              type="button"
                              disabled={locked}
                              onClick={() => {
                                void openCloudWorkspace(w.id).then(() => setOpen(false));
                              }}
                              className="w-full min-w-0 text-left px-1.5 py-1 rounded-lg hover:bg-andros-border/30 spring-micro"
                              title="Abrir este espacio compartido"
                            >
                              <span className="flex items-center gap-1.5 text-xs font-medium text-andros-primary">
                                <span className="truncate">{w.name}</span>
                                {isActive && (
                                  <span className="shrink-0 text-[9px] font-mono uppercase px-1.5 py-0.5 rounded bg-andros-accent/15 text-andros-accent-ink">
                                    abierto
                                  </span>
                                )}
                              </span>
                              <span className="block truncate text-[11px] text-andros-muted">
                                de {w.ownerName}
                                {w.folder ? ` · carpeta ${w.folder}` : ""}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>
              </>
            ) : (
              <p className="text-[11px] text-andros-muted rounded-xl border border-andros-border p-3">
                Inicia sesión con Google para guardar varios espacios en carpetas dentro de tu
                cuenta. Mientras tanto puedes descargar y abrir paquetes .andros.zip.
              </p>
            )}
          </motion.aside>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
};
