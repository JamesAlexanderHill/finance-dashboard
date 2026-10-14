import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { auth } from './auth';

export const getViewer = createServerFn({ method: 'GET' }).handler(async () => {
  const s = await auth.api.getSession({ headers: getRequest().headers });
  return s ? { id: s.user.id, email: s.user.email, name: s.user.name } : null;
});
