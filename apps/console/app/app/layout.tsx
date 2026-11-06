import { DashboardShell } from '../../components/app/DashboardShell';

export default function ProductLayout({ children }: { children: React.ReactNode }) {
  return <DashboardShell>{children}</DashboardShell>;
}
