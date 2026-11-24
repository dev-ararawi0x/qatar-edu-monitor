import { QueryClient } from "@tanstack/react-query";
import { hc } from "hono/client";
import { createAuthClient } from "better-auth/react";
import type { AppType } from "@qatar-edu/api/rpc";

export const API_BASE_URL =
  import.meta.env.VITE_API_URL ?? "http://localhost:3001";

/** Typed Hono RPC client — full end-to-end type safety with the API. */
export const api = hc<AppType>(API_BASE_URL, {
  fetch: (input: RequestInfo | URL, init?: RequestInit) =>
    fetch(input, { ...init, credentials: "include" }),
});

/** better-auth React client (email/password auth + session). */
export const authClient = createAuthClient({
  baseURL: API_BASE_URL,
});

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: true,
      retry: 1,
    },
  },
});
