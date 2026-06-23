import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
// KaTeX stylesheet — styles the math HTML that rehype-katex emits in the
// document reader (MarkdownContent). Global so the pdf-viewer markdown stays
// dependency-light and unit tests don't pull the stylesheet into jsdom.
import "katex/dist/katex.min.css";

createRoot(document.getElementById("root")!).render(<App />);
