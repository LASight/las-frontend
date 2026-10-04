import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { useAuth } from "./auth-context";
import { ApiError } from "./services/http-client";
import { bindQuerySession } from "./services/query-session";

function SessionQueries({ children }: { children: ReactNode }) {
  const [client] = useState(() => {
    const client = new QueryClient({
      defaultOptions: {
        queries: {
          refetchOnWindowFocus: false,
          retry: (failureCount, error) => {
            if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
            return failureCount < 1;
          },
          networkMode: "always",
        },
        mutations: { networkMode: "always" },
      },
    });
    bindQuerySession(client);
    return client;
  });
  // Do not clear durable drafts or another session's stores. Cancellation stops
  // query publication; this client is never handed to the next account.
  useEffect(() => () => { void client.cancelQueries(); }, [client]);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

export function SessionQueryProvider({ children }: { children: ReactNode }) {
  const { user, sessionGeneration } = useAuth();
  return <SessionQueries key={`${user?.user_id ?? "anonymous"}:${sessionGeneration}`}>{children}</SessionQueries>;
}
