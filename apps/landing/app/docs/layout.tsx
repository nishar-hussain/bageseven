import { DocsShell } from '../../components/docs/DocsShell';
import { docsNavigation } from '../../lib/docs';
import './docs.css';

export default function DocumentationLayout({ children }: { children: React.ReactNode }) {
  const appUrl = (process.env.NEXT_PUBLIC_CONSOLE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  return <DocsShell pages={docsNavigation} appUrl={appUrl}>{children}</DocsShell>;
}
