/** Presentation only. Always retain the complete identity in requests and storage. */
export function identityLabel(value: string | null | undefined): string {
  if (!value) return '—';
  const id = value;
  const compact = id.length > 28 ? `${id.slice(0, 10)}…${id.slice(-6)}` : id;
  return compact;
}
