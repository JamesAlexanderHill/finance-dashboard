import { createFileRoute } from '@tanstack/react-router';
import { MAX_UPLOAD_BYTES } from '@finance/contracts';
import { getDb } from '@finance/db';
import { attachReceipt, DuplicateUploadError, getStorage, ReceiptError } from '@finance/imports';
import { json, withErrors } from '../../../server/http';
import { requireWorkspace } from '../../../server/session.server';

export const Route = createFileRoute('/api/receipts/')({
  server: {
    handlers: {
      /** Attaches one receipt (`file` field) to a transaction (`transactionId` field). */
      POST: ({ request }) =>
        withErrors(async () => {
          const { workspaceId, userId } = await requireWorkspace(request);
          const form = await request.formData();
          const file = form.get('file');
          const transactionId = form.get('transactionId');
          if (!(file instanceof File)) return json({ error: 'No file uploaded' }, 400);
          if (typeof transactionId !== 'string' || !/^[0-9a-f-]{36}$/.test(transactionId))
            return json({ error: 'Transaction not found' }, 404);
          if (file.size > MAX_UPLOAD_BYTES) return json({ error: 'File is larger than 25 MB' }, 400);
          try {
            const bytes = new Uint8Array(await file.arrayBuffer());
            return json(await attachReceipt(getDb(), getStorage(), { workspaceId, userId, transactionId, fileName: file.name, bytes }));
          } catch (err) {
            if (err instanceof DuplicateUploadError) return json({ error: err.message }, 409);
            if (err instanceof ReceiptError) return json({ error: err.message }, 400);
            throw err;
          }
        }),
    },
  },
});
