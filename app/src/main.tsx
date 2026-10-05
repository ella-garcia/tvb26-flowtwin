import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/tokens.css";
import "./keystone/keystone.css";
import "./styles/app.css";
import { AppProvider } from "./app/AppContext";
import { Shell } from "./app/Shell";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppProvider><Shell /></AppProvider>
  </StrictMode>,
);
