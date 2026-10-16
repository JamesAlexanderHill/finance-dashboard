import { redirect, type ParsedLocation } from '@tanstack/react-router';

/** `beforeLoad` for a page's old path: a permanent redirect to `to`, keeping the query string. */
export const movedTo =
  (to: (location: ParsedLocation) => string) =>
  ({ location }: { location: ParsedLocation }) => {
    throw redirect({ href: `${to(location)}${location.searchStr}`, statusCode: 301 });
  };
