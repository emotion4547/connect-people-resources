import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { installErrorReporting } from "./lib/errorReporter";

installErrorReporting();

createRoot(document.getElementById("root")!).render(<App />);
