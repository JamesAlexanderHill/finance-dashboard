import {
  HeadContent,
  Link,
  Outlet,
  Scripts,
  ScrollRestoration,
  createRootRoute,
} from "@tanstack/react-router";
import type { ReactNode } from "react";
import appCss from "../styles/app.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Finance Dashboard" },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  component: RootComponent,
});

function RootComponent() {
  return (
    <RootDocument>
      <Outlet />
    </RootDocument>
  );
}

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body className="bg-gray-50 text-gray-900">
        <Nav />
        <main className="max-w-6xl mx-auto px-4 py-6">{children}</main>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

function Nav() {
  const isDev = process.env.NODE_ENV === "development";
  const links = [
    { to: "/", label: "Dashboard" },
    { to: "/accounts", label: "Accounts" },
    { to: "/events", label: "Events" },
    { to: "/categories", label: "Categories" },
    { to: "/imports", label: "Imports" },
    ...(isDev ? [{ to: "/dev", label: "Dev" }] : []),
  ] as const;

  return (
    <nav className="bg-white border-b border-gray-200">
      <div className="max-w-6xl mx-auto px-4 flex gap-6 h-14 items-center">
        <span className="font-semibold text-gray-800 mr-2">Finance</span>
        {links.map((link) => (
          <Link
            key={link.to}
            to={link.to}
            className="text-sm text-gray-600 hover:text-gray-900"
            activeProps={{ className: "text-sm text-blue-600 font-medium" }}
          >
            {link.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
