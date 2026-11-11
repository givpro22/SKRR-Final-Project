// 실행 SSE 목. msw의 sse()는 EventSource가 있는 브라우저에서만 만들 수 있어 browser.ts에서만 쓴다.
// 테스트(jsdom)는 가짜 EventSource를 화면에 넣어 이벤트를 직접 보낸다.
import { sse } from "msw";
import type { RunEventType } from "@/features/runs/runEvents";
import { elapsed } from "./runDb";
import { findRun } from "./runHandlers";

const API = "*/api/v1";
type SseEvents = { [K in RunEventType]: string };

export const runSseHandlers = [
  // SSE (docs/contracts/events.md). 브라우저 개발 모드에서만 쓰인다. 테스트는 가짜 EventSource를 넣는다
  sse<SseEvents>(`${API}/runs/:runId/events`, ({ params, request, client }) => {
    const run = findRun(params.runId);
    if (!run) {
      client.close();
      return;
    }
    const url = new URL(request.url);
    let sentSeq = Number(request.headers.get("Last-Event-ID") ?? url.searchParams.get("afterSeq") ?? 0);
    let timers: ReturnType<typeof setTimeout>[] = [];
    let scriptLength = run.script.length;
    const schedule = () => {
      timers.forEach(clearTimeout);
      const now = elapsed(run);
      timers = run.script
        .filter((e) => e.seq > sentSeq)
        .map((e) =>
          setTimeout(() => {
            sentSeq = e.seq;
            client.send({ id: String(e.seq), event: e.type, data: JSON.stringify(e.data) });
            const status = e.type === "run.status" ? String(e.data.status) : "";
            if (["PASSED", "FAILED", "CANCELLED", "ERROR"].includes(status)) client.close();
          }, Math.max(0, e.at - now)),
        );
    };
    schedule();
    // 중단하면 대본이 바뀌므로 다시 맞춘다
    const watch = setInterval(() => {
      if (run.script.length !== scriptLength) {
        scriptLength = run.script.length;
        schedule();
      }
    }, 300);
    const heartbeat = setInterval(() => client.send({ event: "heartbeat", data: "{}" }), 15_000);
    request.signal.addEventListener("abort", () => {
      timers.forEach(clearTimeout);
      clearInterval(watch);
      clearInterval(heartbeat);
    });
  }),
];
