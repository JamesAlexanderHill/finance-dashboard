import { createFileRoute } from '@tanstack/react-router';
import { MAX_UPLOAD_BYTES } from '@finance/contracts';
import { getDb } from '@finance/db';
import { createPriceImportUpload, DuplicateUploadError, getStorage } from '@finance/imports';
import { json, withErrors } from '../../../server/http';
import { requireWorkspace } from '../../../server/session.server';

export const Route = createFileRoute('/api/prices/')({
  server: {
    handlers: {
      /** Uploads one price CSV (`file` field). Importing waits for the user's column mapping. */
      POST: ({ request }) =>
        withErrors(async () => {
          const { workspaceId, userId } = await requireWorkspace(request);
          const file = (await request.formData()).get('file');
          if (!(file instanceof File)) return json({ error: 'No file uploaded' }, 400);
          if (!file.name.toLowerCase().endsWith('.csv') && file.type !== 'text/csv')
            return json({ error: 'Price imports must be CSV files' }, 400);
          if (file.size > MAX_UPLOAD_BYTES) return json({ error: 'File is larger than 25 MB' }, 400);
          try {
            const bytes = new Uint8Array(await file.arrayBuffer());
            return json(await createPriceImportUpload(getDb(), getStorage(), { workspaceId, userId, fileName: file.name, bytes }));
          } catch (err) {
            if (err instanceof DuplicateUploadError) return json({ error: err.message }, 409);
            throw err;
          }
        }),
    },
  },
});
