import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type ResourceKind =
  | "auth_user"
  | "evaluation_run"
  | "evaluation_schema_version"
  | "evidence_record"
  | "storage_object";

export type ResourceEntry = {
  kind: ResourceKind;
  id: string;
  /** Optional bucket name when kind === "storage_object". */
  bucket?: string;
  /** Free-form annotation for debugging (e.g., test title). */
  note?: string;
};

const REGISTRY_PATH =
  process.env.E2E_REGISTRY_PATH || join(process.cwd(), ".playwright/e2e-registry.json");

function ensureDir(filePath: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function readAll(): ResourceEntry[] {
  if (!existsSync(REGISTRY_PATH)) {
    return [];
  }
  try {
    const raw = readFileSync(REGISTRY_PATH, "utf-8");
    if (!raw.trim()) {
      return [];
    }
    return JSON.parse(raw) as ResourceEntry[];
  } catch {
    return [];
  }
}

function writeAll(entries: ResourceEntry[]): void {
  ensureDir(REGISTRY_PATH);
  writeFileSync(REGISTRY_PATH, JSON.stringify(entries, null, 2), "utf-8");
}

export function recordResource(entry: ResourceEntry): void {
  const entries = readAll();
  const exists = entries.some(
    (e) =>
      e.kind === entry.kind && e.id === entry.id && (e.bucket || "") === (entry.bucket || "")
  );
  if (!exists) {
    entries.push(entry);
    writeAll(entries);
  }
}

export function listResources(): ResourceEntry[] {
  return readAll();
}

export function clearRegistry(): void {
  writeAll([]);
}

export function registryPath(): string {
  return REGISTRY_PATH;
}
