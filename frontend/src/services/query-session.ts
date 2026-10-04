import type { QueryClient } from "@tanstack/react-query";
import { getSessionScope, isCurrentSession, type SessionScope } from "./session-scope";

const owners = new WeakMap<QueryClient, SessionScope>();

export function bindQuerySession(client: QueryClient): void {
  if (!owners.has(client)) owners.set(client, getSessionScope());
}

export function assertQuerySession(client: QueryClient): void {
  bindQuerySession(client);
  if (!isCurrentSession(owners.get(client)!)) throw new Error("Session changed. This workspace belongs to the previous session.");
}
