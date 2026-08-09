import { randomUUID } from "node:crypto";
import type { CellValue } from "./xlsx";

/** Holds a parsed-but-not-yet-committed workbook between the initial
 * upload and the follow-up override/append/resolve step, so re-importing
 * into an existing table doesn't require re-uploading the file just to
 * ask "override or append?" and, for append, which rows to overwrite.
 *
 * In-memory and per-process - fine for the single portal container this
 * stack runs as, but an abandoned import won't survive a restart or be
 * visible to a second replica. Entries expire on their own after TTL_MS
 * regardless, so nothing leaks forever. */
export interface PendingImport {
  tableName: string;
  columnNames: string[];
  rows: CellValue[][];
  keyColumn?: string;
  createdAt: number;
}

const TTL_MS = 15 * 60 * 1000;
const cache = new Map<string, PendingImport>();

function sweep(): void {
  const cutoff = Date.now() - TTL_MS;
  for (const [id, entry] of cache) {
    if (entry.createdAt < cutoff) cache.delete(id);
  }
}

export function savePendingImport(data: Omit<PendingImport, "createdAt">): string {
  sweep();
  const id = randomUUID();
  cache.set(id, { ...data, createdAt: Date.now() });
  return id;
}

export function getPendingImport(id: string): PendingImport | undefined {
  sweep();
  return cache.get(id);
}

export function updatePendingImport(id: string, patch: Partial<PendingImport>): void {
  const entry = cache.get(id);
  if (entry) cache.set(id, { ...entry, ...patch });
}

export function deletePendingImport(id: string): void {
  cache.delete(id);
}
