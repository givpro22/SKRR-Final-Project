import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import "./styles/app.css";

async function enableMocking() {
  // MSW 목은 개발 모드에서 VITE_USE_MOCK=true일 때만 켠다. 프로덕션 빌드에서는 이 분기가 제거된다.
  if (!import.meta.env.DEV || import.meta.env.VITE_USE_MOCK !== "true") return;
  const { worker } = await import("./mocks/browser");
  await worker.start({ onUnhandledRequest: "bypass" });
}

void enableMocking().then(() => {
  const root = document.getElementById("root");
  if (!root) throw new Error("#root 요소가 없습니다.");
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
