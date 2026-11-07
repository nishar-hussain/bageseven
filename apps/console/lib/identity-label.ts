/** Presentation only. Always retain the complete identity in requests and storage. */
export function identityLabel(value: string | null | undefined): string {
  if (!value) return '—';
  const world = value.startsWith('world:');
  const id = world ? value.slice(6) : value;
  const compact = id.length > 28 ? `${id.slice(0, 10)}…${id.slice(-6)}` : id;
  return world ? `World · ${compact}` : compact;
}
