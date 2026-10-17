import { createFileRoute } from '@tanstack/react-router';
import { movedTo } from '../lib/moved';

// Old path, kept so bookmarks still work.
export const Route = createFileRoute('/assets/')({ beforeLoad: movedTo(() => '/accounts/assets') });
