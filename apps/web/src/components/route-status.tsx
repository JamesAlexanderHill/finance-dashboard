import { Link, type ErrorComponentProps } from '@tanstack/react-router';
import { Card } from './ui';

/** Shown in place of a page whose loader or render failed, e.g. a link to an account that no longer exists. */
export function RouteError({ error }: ErrorComponentProps) {
  return (
    <Card className="p-6">
      <h1 className="font-semibold">Something went wrong</h1>
      <p className="text-muted mt-1 text-sm">{error instanceof Error ? error.message : 'This page could not be loaded.'}</p>
      <Link to="/" className="mt-3 inline-block text-sm underline">
        Back to the dashboard
      </Link>
    </Card>
  );
}

export function NotFound() {
  return (
    <Card className="p-6">
      <h1 className="font-semibold">Page not found</h1>
      <Link to="/" className="mt-3 inline-block text-sm underline">
        Back to the dashboard
      </Link>
    </Card>
  );
}
