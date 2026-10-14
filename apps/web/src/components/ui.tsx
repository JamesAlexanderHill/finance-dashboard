import type { ButtonHTMLAttributes, ReactNode } from 'react';

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-xl font-semibold">{title}</h1>
        {description && <p className="text-muted mt-1 text-sm">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`border-line bg-surface rounded-lg border ${className}`}>{children}</div>;
}

export function Button({
  variant = 'secondary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger' }) {
  const styles = {
    primary: 'bg-accent text-accent-ink',
    secondary: 'border-line bg-surface border',
    ghost: 'text-muted hover:text-ink',
    danger: 'border-line bg-surface text-negative border',
  }[variant];
  return <button className={`rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${styles} ${className}`} {...props} />;
}

export function Badge({ tone = 'neutral', children }: { tone?: 'neutral' | 'positive' | 'negative' | 'warning'; children: ReactNode }) {
  const styles = {
    neutral: 'bg-surface-2 text-muted',
    positive: 'bg-surface-2 text-positive',
    negative: 'bg-surface-2 text-negative',
    warning: 'bg-surface-2 text-warning',
  }[tone];
  return <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ${styles}`}>{children}</span>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="text-muted px-4 py-10 text-center text-sm">{children}</p>;
}
