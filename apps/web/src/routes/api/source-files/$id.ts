import { createFileRoute } from '@tanstack/react-router';
import { and, eq } from 'drizzle-orm';
import { getDb, sourceFiles } from '@finance/db';
import { getStorage } from '@finance/imports';
import { json, withErrors } from '../../../server/http';
import { requireWorkspace } from '../../../server/session.server';

/** An ASCII fallback name plus the UTF-8 original (RFC 6266), since headers cannot carry raw non-ASCII. */
const contentDisposition = (name: string) =>
  `inline; filename="${name.replace(/[^\x20-\x7e]|["\\]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`;

/** Streams a retained source file to its workspace owner (soft-deleted files remain inspectable). */
export const Route = createFileRoute('/api/source-files/$id')({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        withErrors(async () => {
          const { workspaceId } = await requireWorkspace(request);
          if (!/^[0-9a-f-]{36}$/.test(params.id)) return json({ error: 'Not found' }, 404);
          const [file] = await getDb()
            .select()
            .from(sourceFiles)
            .where(and(eq(sourceFiles.id, params.id), eq(sourceFiles.workspaceId, workspaceId)));
          if (!file) return json({ error: 'Not found' }, 404);
          const body = await getStorage().getStream(file.objectKey);
          return new Response(body, {
            headers: {
              'content-type': file.contentType,
              'content-disposition': contentDisposition(file.originalName),
              'cache-control': 'private, no-store',
              'x-content-type-options': 'nosniff',
            },
          });
        }),
    },
  },
});
