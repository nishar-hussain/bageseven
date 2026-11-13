'use client';

import { useState } from 'react';
import { Copy } from 'lucide-react';
import styles from './landing.module.css';

const snippet = `import { BagsevenEmbed } from '@bagseven/sdk/react';

<BagsevenEmbed
  component="cmp_customer"
  apiUrl={bagsevenApiUrl}
  publishableKey={publishableKey}
  holder={customer.id}
  accessToken={customer.accessToken}
/>`;

export function IntegrationCode() {
  const [status, setStatus] = useState('Copy code');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(snippet);
      setStatus('Copied');
    } catch {
      setStatus('Select and copy the code below');
    }
  };
  return (
    <div className={styles.codeWindow}>
      <div className={styles.codeTop}>
        <span>billing.tsx</span>
        <button onClick={copy} aria-live="polite">
          <Copy size={13} /> {status}
        </button>
      </div>
      <pre>
        <code>{snippet}</code>
      </pre>
      <p>Set bagsevenApiUrl to your console’s /api/public endpoint. Issue customer tokens on your backend.</p>
    </div>
  );
}
