import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { CatalogApp } from "./CatalogApp.js";
import "./standalone.css";

const root = document.getElementById("root");
if (!root) throw new Error("Catalog MFE root element is missing");

createRoot(root).render(
  <StrictMode>
    <CatalogApp />
  </StrictMode>
);
