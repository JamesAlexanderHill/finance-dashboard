import { createFileRoute } from '@tanstack/react-router';
import { and, eq } from 'drizzle-orm';
import { getDb, sourceFiles } from '@finance/db';
import { getStorage } from '@finance/imports';
import { json, withErrors } from '../../../server/http';
import { requireWorkspace } from '../../../server/session.server';

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
              'content-disposition': `inline; filename="${file.originalName.replace(/"/g, '')}"`,
              'cache-control': 'private, no-store',
            },
          });
        }),
    },
  },
});
