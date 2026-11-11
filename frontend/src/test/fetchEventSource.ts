// 통합 테스트용 EventSource: jsdom·Node에는 EventSource가 없어 fetch 스트림으로 text/event-stream을 읽는다.
// 재연결은 하지 않는다(스트림이 끝나면 닫힘으로 알린다). 화면 코드가 받는 이벤트 모양은 브라우저와 같다.
import type { EventSourceFactory, EventSourceLike } from "@/features/runs/useRunEvents";

class FetchEventSource implements EventSourceLike {
  readyState = 0;
  onopen: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  private listeners = new Map<string, ((event: MessageEvent<string>) => void)[]>();
  private controller = new AbortController();
  private lastEventId = "";
  readonly received: { type: string; id: string }[] = [];

  constructor(url: string, base: string) {
    void this.run(new URL(url, base).toString());
  }

  addEventListener(type: string, listener: (event: MessageEvent<string>) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  close() {
    this.readyState = 2;
    this.controller.abort();
  }

  private dispatch(type: string, data: string) {
    this.received.push({ type, id: this.lastEventId });
    const event = new MessageEvent<string>(type, { data, lastEventId: this.lastEventId });
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  private async run(url: string) {
    try {
      const res = await fetch(url, { headers: { Accept: "text/event-stream" }, signal: this.controller.signal });
      if (!res.ok || !res.body) throw new Error(`SSE ${res.status}`);
      this.readyState = 1;
      this.onopen?.(new Event("open"));
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        let index: number;
        while ((index = buffer.search(/\r?\n\r?\n/)) >= 0) {
          const block = buffer.slice(0, index);
          buffer = buffer.slice(index).replace(/^\r?\n\r?\n/, "");
          let type = "message";
          const data: string[] = [];
          for (const line of block.split(/\r?\n/)) {
            if (line.startsWith("event:")) type = line.slice(6).trim();
            else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
            else if (line.startsWith("id:")) this.lastEventId = line.slice(3).trim();
          }
          if (data.length) this.dispatch(type, data.join("\n"));
        }
      }
    } catch {
      // 닫았거나 연결 실패
    }
    if (this.readyState !== 2) {
      this.readyState = 2;
      this.onerror?.(new Event("error"));
    }
  }
}

export function fetchEventSources(base: string) {
  const sources: FetchEventSource[] = [];
  const factory: EventSourceFactory = (url) => {
    const source = new FetchEventSource(url, base);
    sources.push(source);
    return source;
  };
  return { sources, factory };
}
