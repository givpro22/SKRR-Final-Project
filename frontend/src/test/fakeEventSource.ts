import { act } from "@testing-library/react";
import type { EventSourceFactory, EventSourceLike } from "@/features/runs/useRunEvents";

/** 테스트용 EventSource. 연결·끊김·이벤트를 테스트가 직접 일으킨다 */
export class FakeEventSource implements EventSourceLike {
  readyState = 0;
  onopen: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  closed = false;
  private listeners = new Map<string, ((event: MessageEvent<string>) => void)[]>();

  constructor(readonly url: string) {}

  addEventListener(type: string, listener: (event: MessageEvent<string>) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  close() {
    this.closed = true;
    this.readyState = 2;
  }

  open() {
    act(() => {
      this.readyState = 1;
      this.onopen?.(new Event("open"));
    });
  }

  emit(type: string, data: Record<string, unknown>, id?: number) {
    act(() => {
      const event = new MessageEvent<string>(type, {
        data: JSON.stringify({ runId: "run", occurredAt: "2026-11-10T01:52:38Z", ...data }),
        lastEventId: id === undefined ? "" : String(id),
      });
      for (const listener of this.listeners.get(type) ?? []) listener(event);
    });
  }

  /** readyState 0: 브라우저가 다시 붙는 중, 2: 닫힘 */
  fail(readyState: 0 | 2) {
    act(() => {
      this.readyState = readyState;
      this.onerror?.(new Event("error"));
    });
  }
}

export function fakeEventSources() {
  const sources: FakeEventSource[] = [];
  const factory: EventSourceFactory = (url) => {
    const source = new FakeEventSource(url);
    sources.push(source);
    return source;
  };
  return { sources, factory, last: () => sources.at(-1) };
}
