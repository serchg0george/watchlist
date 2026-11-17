export function newId(): string {
  if (crypto && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  // Fallback for non-secure contexts.
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
