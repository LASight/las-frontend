import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "react-router-dom";

import { router } from "./app-router";
import { AuthProvider } from "./auth-context";
import { ApiError } from "./services/http-client";
import "./styles/tokens.css";
import "./styles/base.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Digitization polls a job only the server can advance, and analysis
      // payloads are large. Refetching on window focus would restart both for
      // no reason.
      refetchOnWindowFocus: false,

      // Never retry a client error. A 404 job will not appear on the second
      // attempt, and retrying it only delays the message the user needs — worse,
      // a retry that gets paused leaves the page blank indefinitely instead of
      // saying the job is gone. Server and network errors are still worth one
      // more try.
      retry: (failureCount, error) => {
        if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
          return false;
        }
        return failureCount < 1;
      },

      // Report the failure rather than waiting on connectivity the browser may
      // be wrong about: the backend is usually localhost, where `navigator.onLine`
      // means nothing.
      networkMode: "always",
    },
    mutations: {
      networkMode: "always",
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      {/* Outside the router, not inside it: the route guard reads the session,
          so the session has to exist before any route renders. */}
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>
  </React.StrictMode>
);
