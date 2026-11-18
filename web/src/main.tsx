import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { startHeartbeat } from "./desktop";
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-500.css";
import "@fontsource/inter/latin-600.css";
import "@fontsource/inter/latin-700.css";
import "@fontsource/cinzel/latin-600.css";
import "@fontsource/cinzel/latin-700.css";
import "@fontsource/noto-serif/latin-400.css";
import "@fontsource/noto-serif/latin-600.css";
import "@fontsource/noto-serif/latin-700.css";
import "@fontsource/noto-serif/latin-400-italic.css";
import "@fontsource/inter/latin-ext-400.css";
import "@fontsource/inter/latin-ext-500.css";
import "@fontsource/inter/latin-ext-600.css";
import "@fontsource/inter/latin-ext-700.css";
import "@fontsource/cinzel/latin-ext-600.css";
import "@fontsource/cinzel/latin-ext-700.css";
import "@fontsource/noto-serif/latin-ext-400.css";
import "@fontsource/noto-serif/latin-ext-600.css";
import "@fontsource/noto-serif/latin-ext-700.css";
import "@fontsource/noto-serif/latin-ext-400-italic.css";
import "./theme.css";
import "./styles.css";
import "./book.css";
import "./calendar.css";
import "./chrome.css";
import "./a11y.css";

startHeartbeat();


ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
