import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { fakeEventSources } from "@/test/fakeEventSource";
import { useRunEvents } from "./useRunEvents";

const progress = { totalScenarios: 2, finishedScenarios: 1, passed: 1, failed: 0, error: 0, skipped: 0, cancelled: 0, running: 1, waiting: 0 };

function setup(afterSeq = 10, enabled = true) {
  const fake = fakeEventSources();
  const onEvent = vi.fn();
  const hook = renderHook(() => useRunEvents({ runId: "r1", afterSeq, enabled, onEvent, createEventSource: fake.factory }));
  return { fake, onEvent, hook };
}

describe("useRunEvents", () => {
  it("스냅샷의 lastEventSeq로 연결한다", () => {
    const { fake } = setup(42);
    expect(fake.last()?.url).toBe("/api/v1/runs/r1/events?afterSeq=42");
  });

  it("afterSeq 이하와 같은 seq를 두 번 받으면 버린다 (재연결 중복)", () => {
    const { fake, onEvent } = setup(10);
    const source = fake.last()!;
    source.emit("log", { kind: "UI", message: "이미 본 것" }, 9);
    source.emit("log", { kind: "UI", message: "새 것" }, 11);
    source.emit("log", { kind: "UI", message: "새 것" }, 11);
    source.emit("log", { kind: "API", message: "다음" }, 12);
    expect(onEvent.mock.calls.map(([e, seq]) => [e.message, seq])).toEqual([
      ["새 것", 11],
      ["다음", 12],
    ]);
  });

  it("heartbeat와 형식이 틀린 이벤트는 넘긴다", () => {
    const { fake, onEvent } = setup();
    fake.last()!.emit("heartbeat", {});
    fake.last()!.emit("step.status", { caseResultId: "c" }, 11);
    expect(onEvent).not.toHaveBeenCalled();
  });

  it("끊기면 재연결 중, 다시 열리면 받는 중, 닫히면 연결 끊김", () => {
    const { fake, hook } = setup();
    const source = fake.last()!;
    expect(hook.result.current).toBe("connecting");
    source.open();
    expect(hook.result.current).toBe("open");
    source.fail(0);
    expect(hook.result.current).toBe("reconnecting");
    source.open();
    expect(hook.result.current).toBe("open");
    source.fail(2);
    expect(hook.result.current).toBe("closed");
  });

  it("끝난 상태의 run.status를 받으면 닫고 더 받지 않는다", () => {
    const { fake, onEvent, hook } = setup();
    const source = fake.last()!;
    source.open();
    source.emit("run.status", { status: "RUNNING", progress }, 11);
    expect(source.closed).toBe(false);
    source.emit("run.status", { status: "FAILED", progress }, 12);
    expect(source.closed).toBe(true);
    expect(hook.result.current).toBe("ended");
    source.fail(0); // 닫은 뒤의 오류로 재연결 중 표시가 되지 않는다
    expect(hook.result.current).toBe("ended");
    source.emit("log", { kind: "UI", message: "늦은 이벤트" }, 13);
    expect(onEvent).toHaveBeenCalledTimes(2);
  });

  it("이미 끝난 실행이면 연결하지 않는다", () => {
    const { fake, hook } = setup(10, false);
    expect(fake.sources).toHaveLength(0);
    expect(hook.result.current).toBe("ended");
  });
});
