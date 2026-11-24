// ============================================================================
// ANDROS — CONTRATOS DE LA LIBRERÍA DE FICHAS REPLICABLES
// Un «formato» (plantilla) define título, categoría y campos tipados SIN
// valores. Replicarlo crea un `form-sheet-node` con esos campos vacíos.
// ============================================================================

import type { FormFieldType } from "./workspace";

/** Campo de un formato: igual que `FormField` pero sin valor ni fotos. */
export interface FormFieldDef {
  id: string;
  fieldKey: string;
  label: string;
  type: FormFieldType;
  unit?: string;
  options?: string[];
}

export interface FormTemplate {
  id: string;
  title: string;
  category: string;
  /** Texto corto que explica para qué sirve (se muestra en la librería). */
  description?: string;
  fields: FormFieldDef[];
  /** `true` en los 4 formatos iniciales (se pueden editar, borrar y restaurar). */
  builtIn?: boolean;
  /** Marca de tiempo (ms) de la última edición: gana la versión más reciente. */
  updatedAt: number;
}
