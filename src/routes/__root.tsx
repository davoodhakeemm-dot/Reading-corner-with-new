import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { Toaster } from "sonner";

import { GlobalCallAndAlertLayer } from "../components/GlobalCallAndAlertLayer";
import { InstallProvider } from "../components/InstallApp";
import { StartupPermissionsPrompt } from "../components/StartupPermissionsPrompt";
import appCss from "../styles.css?url";
import { LibraryProvider } from "../lib/library-store";
import { SecretGesture } from "../components/SecretGesture";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { isDynamicImportError } from "../lib/social-logic";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

const CHUNK_RELOAD_KEY = "rc_chunk_reload_at";

function ErrorComponent({ error, reset }: { error: unknown; reset: () => void }) {
  const router = useRouter();
  const isChunkErr = isDynamicImportError(error);

  useEffect(() => {
    if (isChunkErr && typeof window !== "undefined") {
      try {
        const last = Number(window.sessionStorage.getItem(CHUNK_RELOAD_KEY) || "0");
        if (!last || Date.now() - last > 15_000) {
          window.sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()));
          window.location.reload();
          return;
        }
      } catch {
        /* ignore sessionStorage failures */
      }
    }
    console.error(error);
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error, isChunkErr]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      {
        name: "viewport",
        content:
          "width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content",
      },
      { name: "theme-color", content: "#7c3aed" },
      { title: "Reading Corner" },
      {
        name: "description",
        content: "Discover, read and explore amazing books. Join Reading Corner today!",
      },
      { property: "og:title", content: "Reading Corner – Read • Explore • Imagine" },
      { property: "og:site_name", content: "Reading Corner" },
      {
        property: "og:description",
        content: "Discover, read and explore amazing books. Join Reading Corner today!",
      },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://book-chi-jade.vercel.app/" },
      { property: "og:image", content: "https://book-chi-jade.vercel.app/og-image.png" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Reading Corner – Read • Explore • Imagine" },
      {
        name: "twitter:description",
        content: "Discover, read and explore amazing books. Join Reading Corner today!",
      },
      { name: "twitter:image", content: "https://book-chi-jade.vercel.app/og-image.png" },
    ],
    links: [
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/reader-180.png" },
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,700;9..144,800&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <LibraryProvider>
        <SecretGesture />
        <StartupPermissionsPrompt />
        <GlobalCallAndAlertLayer />
        <Toaster position="top-center" richColors />
        {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
        <InstallProvider>
          <Outlet />
        </InstallProvider>
      </LibraryProvider>
    </QueryClientProvider>
  );
}
