import { UnauthorizedError } from './session.server';

export const json = (body: unknown, status = 200) => Response.json(body, { status });

/** Maps auth failures to 401 for raw server routes. */
export async function withErrors(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof UnauthorizedError) return json({ error: 'Unauthorized' }, 401);
    console.error(err);
    return json({ error: 'Internal error' }, 500);
  }
}
