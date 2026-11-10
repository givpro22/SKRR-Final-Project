import { Check, Globe } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useUpdateProject, useVerifyTargetSite } from "@/api/queries/projects";
import { ApiError, errorMessage } from "@/api/errors";
import type { Project } from "@/api/types";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { Spinner } from "@/components/Spinner";
import { formatClock } from "@/lib/format";
import { targetStatusView } from "./statusLabels";

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function TargetUrlField({ project }: { project: Project }) {
  const update = useUpdateProject(project.id);
  const verify = useVerifyTargetSite(project.id);
  // null이면 저장된 값을 보여 준다.
  const [draft, setDraft] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  const saved = project.targetUrl ?? "";
  const value = draft ?? saved;
  const dirty = draft !== null && draft.trim() !== saved;
  const checking = verify.isPending || project.targetUrlStatus === "CHECKING";
  const busy = update.isPending || checking;

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    const next = value.trim();
    if (!next) {
      setLocalError("대상 사이트 URL을 입력해 주세요.");
      return;
    }
    if (!isHttpUrl(next)) {
      setLocalError("http:// 또는 https://로 시작하는 주소를 입력해 주세요.");
      return;
    }
    setLocalError(null);
    verify.reset();
    if (!dirty) {
      verify.mutate();
      return;
    }
    update.mutate(
      { targetUrl: next },
      {
        onSuccess: () => {
          setDraft(null);
          verify.mutate();
        },
      },
    );
  };

  const updateError = update.error instanceof ApiError ? (update.error.fieldError("targetUrl") ?? update.error.message) : update.error && errorMessage(update.error);
  const verifyError = verify.error ? errorMessage(verify.error) : null;
  const message = localError ?? updateError ?? verifyError;

  let trailing;
  if (busy) {
    trailing = (
      <Badge tone="accent" icon={<Spinner className="size-3" />}>
        {update.isPending ? "저장 중" : targetStatusView.CHECKING.label}
      </Badge>
    );
  } else if (dirty || project.targetUrlStatus === "UNVERIFIED" || !saved) {
    trailing = (
      <Button type="submit" size="sm" disabled={!value.trim()}>
        {dirty ? "저장 후 연결 확인하기" : "연결 확인하기"}
      </Button>
    );
  } else if (project.targetUrlStatus === "REACHABLE") {
    trailing = (
      <Badge tone="success" icon={<Check aria-hidden className="size-3" />}>
        {targetStatusView.REACHABLE.label}
      </Badge>
    );
  } else {
    trailing = (
      <span className="flex items-center gap-2">
        <Badge tone="danger">{targetStatusView.UNREACHABLE.label}</Badge>
        <Button type="submit" size="sm">
          다시 확인
        </Button>
      </span>
    );
  }

  const showResult = !busy && !dirty && (project.targetUrlStatus === "REACHABLE" || project.targetUrlStatus === "UNREACHABLE");
  // 판정 결과는 Project에 저장된 값으로 그린다. 새로고침해도 사유와 상태 코드가 남는다 (ADR-019).
  const resultMeta = [
    project.targetCheckStatusCode != null ? `HTTP ${project.targetCheckStatusCode}` : null,
    project.targetCheckedAt ? `${formatClock(project.targetCheckedAt)} 확인` : null,
  ].filter((part): part is string => part !== null);
  // 서버 문장에 이미 "HTTP 503"이 있으면 상태 코드를 한 번만 보인다.
  const unreachableMeta = resultMeta.filter((part) => !(part.startsWith("HTTP ") && project.targetCheckMessage?.includes(part)));

  return (
    <section aria-labelledby="target-url-label">
      <h2 id="target-url-label" className="text-[13px] font-bold">
        대상 사이트 URL
      </h2>
      <form
        noValidate
        onSubmit={submit}
        className="mt-3 flex h-[50px] items-center gap-3 rounded-xl border border-line-strong bg-surface pr-3 pl-4 focus-within:border-focus"
      >
        <Globe aria-hidden className="size-4 shrink-0 text-muted" />
        <input
          aria-labelledby="target-url-label"
          aria-invalid={message ? true : undefined}
          type="url"
          inputMode="url"
          placeholder="https://"
          value={value}
          maxLength={500}
          disabled={update.isPending}
          onChange={(event) => {
            setDraft(event.target.value);
            setLocalError(null);
          }}
          className="h-full min-w-0 flex-1 bg-transparent font-mono text-[13px] outline-none placeholder:text-muted"
        />
        {trailing}
      </form>
      {message && (
        <p role="alert" className="mt-2 text-xs text-danger">
          {message}
        </p>
      )}
      {!message && showResult && project.targetUrlStatus === "REACHABLE" && (
        <p data-testid="target-check-result" className="mt-2 text-xs text-muted">
          {/* 도달 가능일 때 서버 문장("연결 확인 성공 (HTTP 401)")은 상태 코드와 겹치므로 줄에 넣지 않고 툴팁으로만 둔다 */}
          <span title={project.targetCheckMessage ?? undefined}>{["연결됨", ...resultMeta].join(" · ")}</span>
        </p>
      )}
      {!message && showResult && project.targetUrlStatus === "UNREACHABLE" && (
        <p data-testid="target-check-result" className="mt-2 text-xs text-danger">
          {project.targetCheckMessage ?? "대상 사이트에 접속하지 못했습니다. 주소와 사이트 상태를 확인해 주세요."}
          {unreachableMeta.length > 0 && <span className="ml-1 text-muted">· {unreachableMeta.join(" · ")}</span>}
        </p>
      )}
    </section>
  );
}
