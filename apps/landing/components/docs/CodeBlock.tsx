'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

export function CodeBlock({ language, code }: { language: string; code: string }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true); setFailed(false);
      setTimeout(() => setCopied(false), 1800);
    } catch { setFailed(true); }
  }
  return <div className="docs-code">
    <div className="docs-code-bar"><span>{language}</span><button type="button" onClick={() => void copy()} aria-label={copied ? 'Code copied' : 'Copy code'}>{copied ? <Check size={14} /> : <Copy size={14} />}<span>{failed ? 'Select code to copy' : copied ? 'Copied' : 'Copy'}</span></button></div>
    <pre><code>{code}</code></pre>
    <span className="docs-sr-only" role="status">{copied ? 'Code copied to clipboard' : failed ? 'Clipboard unavailable. Select the code to copy it.' : ''}</span>
  </div>;
}
