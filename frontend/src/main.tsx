import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import AuthGate from "./AuthGate";
import "./styles.css";

const savedTheme = localStorage.getItem("mydgx-theme");
document.documentElement.dataset.theme = savedTheme === "light" || savedTheme === "dark"
  ? savedTheme
  : (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthGate />
  </StrictMode>,
);
