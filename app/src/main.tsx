import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/tokens.css";
import "./keystone/keystone.css";
import "./styles/app.css";
import { AppProvider } from "./app/AppContext";
import { Shell } from "./app/Shell";
import { PublicRoot } from "./app/PublicRoot";
import { publicToken } from "./app/publicRoute";

// A public link (#r/<token>) never mounts the app: no testing identity, no anonymous session, no data load.
const token = publicToken();
// Moving between a public link and the app swaps the whole tree, so reload instead of re-rendering.
addEventListener("hashchange", () => { if ((publicToken() !== null) !== (token !== null)) location.reload(); });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {token ? <PublicRoot token={token} /> : <AppProvider><Shell /></AppProvider>}
  </StrictMode>,
);
