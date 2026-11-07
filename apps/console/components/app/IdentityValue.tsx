'use client';

import { useState } from 'react';
import { identityLabel } from '../../lib/identity-label';

/** Compact on every viewport, with selectable full text and copy on demand. */
export function IdentityValue({ value, label }: { value?: string | null; label: string }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  if (!value) return <span className="text-[var(--muted)]">Not set</span>;
  return (
    <details className="min-w-0">
      <summary className="cursor-pointer break-all text-xs" title={value}>
        <code className="fi-mono">{identityLabel(value)}</code>
      </summary>
      <div className="mt-2 space-y-2 rounded-xl bg-[var(--soft)] p-3">
        <code className="fi-mono block break-all text-xs">{value}</code>
        <button type="button" className="text-xs font-medium text-[var(--blue)] underline" onClick={() => {
          void navigator.clipboard.writeText(value).then(() => { setCopied(true); setError(''); }).catch(() => setError('Select and copy the full value above.'));
        }}>Copy {label}</button>
        <span role="status" className="ml-2 text-xs text-[var(--muted)]">{error || (copied ? 'Copied' : '')}</span>
      </div>
    </details>
  );
}
