import { redirect } from 'next/navigation';

/** Landing lives on :3001 — console is dashboard-only. */
export default function ConsoleRoot() {
  redirect('/app');
}
