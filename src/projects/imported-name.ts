// Shared name resolution for XMI imports: the importer resolves the file's
// package/model name (or null); this helper applies the final fallback
// `Class Diagram <upload-timestamp>` formatted YYYY-MM-DD HH:mm:ss local time.
// Used by both the dashboard create-from-import flow and the
// replace-in-place project import.

export function defaultImportTimestamp(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

export function resolveImportedProjectName(name: string | null): string {
  return name ?? `Class Diagram ${defaultImportTimestamp()}`;
}
