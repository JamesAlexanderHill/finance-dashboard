import { createFileRoute } from '@tanstack/react-router';
import { MAX_UPLOAD_BYTES } from '@finance/contracts';
import { getDb } from '@finance/db';
import { createStatementUpload, DuplicateUploadError, getStorage } from '@finance/imports';
import { json, withErrors } from '../../../server/http';
import { requireWorkspace } from '../../../server/session';

const contentTypeFor = (file: File) =>
  file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
    ? 'application/pdf'
    : file.type === 'text/csv' || file.name.toLowerCase().endsWith('.csv')
      ? 'text/csv'
      : null;

export const Route = createFileRoute('/api/statements/')({
  server: {
    handlers: {
      /** Multipart upload of one or more statement files (`files` fields). */
      POST: ({ request }) =>
        withErrors(async () => {
          const { workspaceId, userId } = await requireWorkspace(request);
          const form = await request.formData();
          const files = form.getAll('files').filter((f): f is File => f instanceof File);
          if (files.length === 0) return json({ error: 'No files uploaded' }, 400);

          const results = [];
          for (const file of files) {
            const contentType = contentTypeFor(file);
            if (!contentType) {
              results.push({ fileName: file.name, error: 'Only PDF and CSV statements are supported' });
              continue;
            }
            if (file.size > MAX_UPLOAD_BYTES) {
              results.push({ fileName: file.name, error: 'File is larger than 25 MB' });
              continue;
            }
            try {
              const bytes = new Uint8Array(await file.arrayBuffer());
              const { statement, job } = await createStatementUpload(getDb(), getStorage(), {
                workspaceId,
                userId,
                fileName: file.name,
                contentType,
                bytes,
              });
              results.push({ fileName: file.name, statementId: statement.id, jobId: job.id });
            } catch (err) {
              if (err instanceof DuplicateUploadError) results.push({ fileName: file.name, error: err.message });
              else throw err;
            }
          }
          return json({ results });
        }),
    },
  },
});
