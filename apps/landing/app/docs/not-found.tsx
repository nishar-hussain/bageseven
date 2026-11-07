import Link from 'next/link';
export default function DocumentationNotFound() {
  return <article className="docs-article"><div className="docs-eyebrow">Documentation</div><h1>Page not found</h1><p>This documentation page does not exist.</p><Link href="/docs/introduction">Back to introduction →</Link></article>;
}
