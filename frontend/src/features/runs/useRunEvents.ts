import { createContext, useContext, useEffect, useRef, useState } from "react";
import { isRunFinished } from "@/api/queries/runs";
import { parseRunEvent, RUN_EVENT_TYPES, type RunEvent } from "./runEvents";

/** 브라우저 EventSource 중 이 훅이 쓰는 부분. 테스트에서 가짜로 바꿔 끼운다 */
export interface EventSourceLike {
  readyState: number;
  onopen: ((event: Event) => void) | null;
  onerror: ((event: Event) => void) | null;
  addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void;
  close(): void;
}

export type EventSourceFactory = (url: string) => EventSourceLike;

const CLOSED = 2;

export const browserEventSource: EventSourceFactory = (url) => new EventSource(url);

/** 화면이 쓸 EventSource 생성기. 테스트는 Provider로 가짜를 넣는다 */
export const EventSourceFactoryContext = createContext<EventSourceFactory>(browserEventSource);

/** connecting: 첫 연결 중, open: 받는 중, reconnecting: 끊겨 브라우저가 다시 붙는 중, closed: 다시 붙지 못함, ended: 실행이 끝나 닫음 */
export type ConnectionState = "connecting" | "open" | "reconnecting" | "closed" | "ended";

interface Options {
  runId: string;
  /** 스냅샷의 lastEventSeq. 이보다 작거나 같은 seq는 이미 반영된 것으로 본다 */
  afterSeq: number;
  /** 스냅샷이 이미 끝난 실행이면 연결하지 않는다 */
  enabled: boolean;
  onEvent: (event: RunEvent, seq: number | null) => void;
  /** 없으면 EventSourceFactoryContext 값을 쓴다 */
  createEventSource?: EventSourceFactory;
}

/**
 * UI-03 실시간 이벤트 (docs/contracts/events.md).
 * - 스냅샷 뒤 `?afterSeq=`로 연결하고, 재연결은 브라우저 기본 동작(Last-Event-ID)에 맡긴다
 * - 이벤트 seq(id)를 기억해 중복을 버린다
 * - 끝난 상태의 run.status를 받으면 연결을 닫는다. 닫지 않으면 브라우저가 계속 다시 붙는다
 */
export function useRunEvents({ runId, afterSeq, enabled, onEvent, createEventSource: override }: Options): ConnectionState {
  const fromContext = useContext(EventSourceFactoryContext);
  const createEventSource = override ?? fromContext;
  const [state, setState] = useState<ConnectionState>(enabled ? "connecting" : "ended");
  const onEventRef = useRef(onEvent);
  useEffect(() => {
    onEventRef.current = onEvent;
  });

  useEffect(() => {
    if (!enabled) return;
    let lastSeq = afterSeq;
    let ended = false;
    // 스냅샷이 바뀌면 화면이 이 훅을 쓰는 컴포넌트를 새로 만든다(key). 그래서 처음 상태(connecting)를 다시 둘 필요가 없다
    const source = createEventSource(`/api/v1/runs/${runId}/events?afterSeq=${afterSeq}`);
    source.onopen = () => {
      if (!ended) setState("open");
    };
    source.onerror = () => {
      if (ended) return;
      setState(source.readyState === CLOSED ? "closed" : "reconnecting");
    };
    for (const type of RUN_EVENT_TYPES) {
      source.addEventListener(type, (message) => {
        if (ended) return;
        if (type === "heartbeat") return;
        const seq = message.lastEventId ? Number(message.lastEventId) : null;
        if (seq !== null && Number.isFinite(seq)) {
          if (seq <= lastSeq) return; // 재연결로 다시 온 이벤트
          lastSeq = seq;
        }
        const event = parseRunEvent(type, message.data);
        if (!event) return;
        onEventRef.current(event, seq);
        if (event.type === "run.status" && isRunFinished(event.status)) {
          ended = true;
          source.close();
          setState("ended");
        }
      });
    }
    return () => {
      ended = true;
      source.close();
    };
  }, [runId, afterSeq, enabled, createEventSource]);

  return state;
}
