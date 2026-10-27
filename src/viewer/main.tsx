// The viewer's entry point, bundled into the page by build.ts.
import { createRoot } from "react-dom/client";
import { App } from "./App";

createRoot(document.getElementById("app")!).render(<App />);
