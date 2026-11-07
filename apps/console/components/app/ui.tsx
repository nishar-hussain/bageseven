import Link from 'next/link';
import type { ReactNode } from 'react';

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0 max-w-2xl">
        <h1 className="text-[1.75rem] font-semibold tracking-tight text-[var(--ink)] md:text-[2rem]">{title}</h1>
        {description ? <p className="mt-1.5 text-[13.5px] leading-relaxed text-[var(--muted)]">{description}</p> : null}
      </div>
      {action ? <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div> : null}
    </div>
  );
}

export function SoftCard({
  children,
  className = '',
  id,
}: {
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section id={id} className={`rounded-2xl border border-[var(--line)] bg-white shadow-[var(--sh)] ${className}`}>
      {children}
    </section>
  );
}

export function StatusPill({
  tone = 'neutral',
  children,
}: {
  tone?: 'good' | 'warn' | 'neutral' | 'deny';
  children: ReactNode;
}) {
  const cls =
    tone === 'good'
      ? 'bg-[var(--good-t)] text-[var(--good)]'
      : tone === 'warn'
        ? 'bg-[var(--warn-t)] text-[var(--warn)]'
        : tone === 'deny'
          ? 'bg-red-50 text-[var(--deny)]'
          : 'bg-[var(--soft)] text-[var(--muted)]';
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${cls}`}>
      {children}
    </span>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex rounded-full border border-[var(--line)] bg-[var(--soft)] p-0.5 text-[12px] font-medium">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`rounded-full px-3 py-1.5 transition ${
            value === o.value ? 'bg-[var(--ink)] text-white shadow-sm' : 'text-[var(--muted)] hover:text-[var(--ink)]'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function PrimaryButton({
  href,
  children,
  onClick,
  disabled,
  type = 'button',
}: {
  href?: string;
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  type?: 'button' | 'submit';
}) {
  const className =
    'inline-flex items-center justify-center rounded-full bg-[var(--ink)] px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-black disabled:opacity-50';
  if (href) {
    return (
      <Link href={href} className={className}>
        {children}
      </Link>
    );
  }
  return (
    <button type={type} disabled={disabled} onClick={onClick} className={className}>
      {children}
    </button>
  );
}

export function SecondaryButton({
  href,
  children,
  onClick,
  disabled,
  type = 'button',
}: {
  href?: string;
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  type?: 'button' | 'submit';
}) {
  const className =
    'inline-flex items-center justify-center rounded-full border border-[var(--line)] bg-white px-3.5 py-2 text-[13px] font-medium text-[var(--ink)] hover:bg-[var(--soft)] disabled:opacity-50';
  if (href) {
    return (
      <Link href={href} className={className}>
        {children}
      </Link>
    );
  }
  return (
    <button type={type} disabled={disabled} onClick={onClick} className={className}>
      {children}
    </button>
  );
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="px-6 py-14 text-center">
      <p className="text-sm font-semibold text-[var(--ink)]">{title}</p>
      <p className="mx-auto mt-1 max-w-sm text-[13px] text-[var(--muted)]">{body}</p>
      {action ? <div className="mt-4 flex justify-center gap-2">{action}</div> : null}
    </div>
  );
}
