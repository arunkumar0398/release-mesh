import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { ReleaseApp } from "./ReleaseApp.js";
import "./standalone.css";

const root = document.getElementById("root");
if (!root) throw new Error("Release MFE root element is missing");

createRoot(root).render(
  <StrictMode>
    <ReleaseApp />
  </StrictMode>
);
