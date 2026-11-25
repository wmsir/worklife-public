import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import { Toaster } from "sonner";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <HashRouter>
      <App />
      <Toaster
        richColors
        position="top-right"
        toastOptions={{
          className: "rounded-xl border border-slate-200 shadow-lg text-xs",
        }}
      />
    </HashRouter>
  </StrictMode>,
);
