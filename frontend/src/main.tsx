import React from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";

import { router } from "./app-router";
import { AuthProvider } from "./auth-context";
import { SessionQueryProvider } from "./session-query-provider";
import "./styles/tokens.css";
import "./styles/base.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AuthProvider>
      <SessionQueryProvider>
        <RouterProvider router={router} />
      </SessionQueryProvider>
    </AuthProvider>
  </React.StrictMode>
);
