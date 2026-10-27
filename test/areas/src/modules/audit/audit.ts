// Audit trail for every money movement.

import type { Note } from "./note";

export function audit(text: string): Note {
  return { text };
}
