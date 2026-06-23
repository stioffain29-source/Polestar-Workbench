import { createRoot } from "react-dom/client";
import { setAuthTokenGetter } from "@workspace/api-client-react";
import App from "./App";
import { getStoredAdminToken } from "@/lib/adminToken";
import "./index.css";

setAuthTokenGetter(() => {
  const token = getStoredAdminToken().trim();
  return token || null;
});

createRoot(document.getElementById("root")!).render(<App />);
