import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App.js";

const rootElement = document.getElementById("root");
const requestedCandidate = new URL(window.location.href).searchParams.get("candidateVersion");
const candidateVersion = requestedCandidate === "v2" || requestedCandidate === "v2.1"
  ? requestedCandidate
  : undefined;

if (!rootElement) {
  throw new Error("Checkout root element is missing");
}

createRoot(rootElement).render(
  <StrictMode>
    <App
      candidateVersion={candidateVersion}
      pricingBaseUrl={import.meta.env.VITE_PRICING_BASE_URL || window.location.origin}
    />
  </StrictMode>
);
