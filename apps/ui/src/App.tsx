import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createBrowserRouter, isRouteErrorResponse, Link, RouterProvider, useRouteError, type RouteObject } from "react-router";
import { Layout } from "@/components/Layout";
import { NotFoundState } from "@/components/States";
import { Button } from "@/components/ui/button";
import { ApiContext, ApiError, defaultApi, type Api } from "@/lib/api";
import { useTitle } from "@/lib/title";
import { Edition } from "@/routes/Edition";
import { FeedArchive } from "@/routes/FeedArchive";
import { Favorites } from "@/routes/Favorites";
import { Stories } from "@/routes/Stories";
import { Story } from "@/routes/Story";
import { Today } from "@/routes/Today";

function NotFound() {
  useTitle("Not found");
  return <NotFoundState />;
}

function RouteError() {
  const err = useRouteError();
  if (isRouteErrorResponse(err) && err.status === 404) return <NotFound />;
  return (
    <div role="alert" className="mx-auto max-w-xl py-16 text-center">
      <h1 className="headline text-3xl font-semibold">Something broke on this page</h1>
      <p className="mt-3 text-muted-foreground">Reloading usually helps. If it keeps happening, the edition data may be unusual.</p>
      <div className="mt-6 flex justify-center gap-3">
        <Button onClick={() => location.reload()}>Reload</Button>
        <Button asChild variant="outline">
          <Link to="/">Today</Link>
        </Button>
      </div>
    </div>
  );
}

export const routes: RouteObject[] = [
  {
    element: <Layout />,
    errorElement: <RouteError />,
    children: [
      {
        errorElement: <RouteError />,
        children: [
          { index: true, element: <Today /> },
          { path: "stories", element: <Stories /> },
          { path: "e/:editionId", element: <Edition /> },
          { path: "s/:storyId", element: <Story /> },
          { path: "favorites", element: <Favorites /> },
          { path: "f/:feed", element: <FeedArchive /> },
          { path: "*", element: <NotFound /> },
        ],
      },
    ],
  },
];

export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60_000,
        refetchOnWindowFocus: false,
        // Don't retry what won't change: 4xx (bad id, not found). Network errors and 5xx get two more tries.
        retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
      },
    },
  });
}

export function App({ api = defaultApi, queryClient }: { api?: Api; queryClient?: QueryClient }) {
  const [router] = useState(() => createBrowserRouter(routes));
  const [qc] = useState(() => queryClient ?? makeQueryClient());
  return (
    <ApiContext.Provider value={api}>
      <QueryClientProvider client={qc}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ApiContext.Provider>
  );
}
