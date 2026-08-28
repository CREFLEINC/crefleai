import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/fira-code/latin-500.css";
import "@fontsource/fira-code/latin-600.css";
import "@fontsource/fira-sans/latin-400.css";
import "@fontsource/fira-sans/latin-500.css";
import "@fontsource/fira-sans/latin-600.css";
import "@fontsource/fira-sans/latin-700.css";
import "./index.css";
import App from "./App.tsx";
import { applyTheme, getInitialTheme } from "./ui/theme.ts";

applyTheme(getInitialTheme());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
