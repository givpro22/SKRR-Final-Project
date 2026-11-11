import clsx from "clsx";
import { ArrowRight, Check, CircleAlert, Sparkles } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { ApiError, errorMessage, hasErrorCode } from "@/api/errors";
import { useKnowledgeBase } from "@/api/queries/knowledgeBase";
import { useCreateTestRequest, useSelectRefinedRequest, useTestRequest } from "@/api/queries/requests";
import type { TestRequest } from "@/api/types";
import { Button } from "@/components/Button";
import { Modal } from "@/components/Modal";
import { Spinner } from "@/components/Spinner";
import { ErrorBlock } from "@/components/StateViews";

const MAX_TEXT = 500;

type Step = { kind: "input"; text: string } | { kind: "request"; requestId: string };

interface Props {
  projectId: string;
  /** 이어서 볼 요청. 없으면 새 요청 입력부터 시작한다 */
  resumeRequestId?: string | null;
  onClose: () => void;
  /** 생성 완료 모달에서 확인을 누르면 */
  onDone: (testRequestId: string) => void;
}

/**
 * UI-02-1 입력 → 후보 대기 → UI-02-1B 선택 → 생성 대기 → 생성 완료.
 * 모달을 닫아도 요청은 서버에서 계속 진행된다. 다시 열 때 resumeRequestId로 이어서 보여 준다.
 */
export function RequestFlowModal({ projectId, resumeRequestId, onClose, onDone }: Props) {
  const [step, setStep] = useState<Step>(
    resumeRequestId ? { kind: "request", requestId: resumeRequestId } : { kind: "input", text: "" },
  );

  if (step.kind === "input") {
    return (
      <InputStep
        projectId={projectId}
        initialText={step.text}
        onClose={onClose}
        onCreated={(request) => setStep({ kind: "request", requestId: request.id })}
      />
    );
  }
  return (
    <RequestStep
      projectId={projectId}
      requestId={step.requestId}
      onClose={onClose}
      onDone={onDone}
      onBack={(text) => setStep({ kind: "input", text })}
    />
  );
}

function InputStep({
  projectId,
  initialText,
  onClose,
  onCreated,
}: {
  projectId: string;
  initialText: string;
  onClose: () => void;
  onCreated: (request: TestRequest) => void;
}) {
  const [text, setText] = useState(initialText);
  const create = useCreateTestRequest(projectId);
  const kb = useKnowledgeBase(projectId);
  const kbReady = kb.data?.status === "READY";
  const trimmed = text.trim();

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (!trimmed || !kbReady) return;
    create.mutate(trimmed, { onSuccess: onCreated });
  };

  const notReady = (kb.data && !kbReady) || hasErrorCode(create.error, "KNOWLEDGE_BASE_NOT_READY");
  const fieldError = create.error instanceof ApiError ? create.error.fieldError("text") : undefined;
  const otherError =
    create.error && !fieldError && !hasErrorCode(create.error, "KNOWLEDGE_BASE_NOT_READY") ? errorMessage(create.error) : null;

  return (
    <Modal
      open
      width="md"
      title="테스트 시나리오 입력"
      description="평소 말하듯 적어 주세요. AI가 등록된 명세를 찾아 선택지로 정리합니다."
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>취소</Button>
          <Button
            variant="primary"
            icon={create.isPending ? <Spinner className="size-4" /> : <Sparkles aria-hidden className="size-4" />}
            disabled={!trimmed || !kbReady || create.isPending}
            onClick={() => submit()}
          >
            생성하기
          </Button>
        </>
      }
    >
      <form onSubmit={submit} noValidate>
        {notReady && (
          <div role="alert" className="mb-4 flex gap-2 rounded-xl bg-warning-soft px-4 py-3 text-xs text-warning">
            <CircleAlert aria-hidden className="mt-px size-4 shrink-0" />
            <p>
              지식 베이스가 최신 상태가 아니어서 요청을 받을 수 없습니다.{" "}
              <Link to={`/projects/${projectId}/documents`} className="font-semibold underline">
                문서 · 지식
              </Link>
              에서 지식 베이스를 구축한 뒤 다시 시도해 주세요.
            </p>
          </div>
        )}
        <label htmlFor="request-text" className="text-[13px] font-bold">
          테스트 요청
        </label>
        <textarea
          id="request-text"
          value={text}
          maxLength={MAX_TEXT}
          rows={2}
          autoFocus
          aria-invalid={fieldError ? true : undefined}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              submit();
            }
          }}
          className="mt-2 block min-h-[62px] w-full resize-none rounded-xl border-2 border-line-strong/60 bg-surface px-4 py-3 text-sm outline-none focus:border-accent"
        />
        <p className="mt-2 text-right font-mono text-xs text-muted">
          {text.length} / {MAX_TEXT}자
        </p>
        {(fieldError || otherError) && (
          <p role="alert" className="mt-1 text-xs text-danger">
            {fieldError ?? otherError}
          </p>
        )}
      </form>
    </Modal>
  );
}

function RequestStep({
  projectId,
  requestId,
  onClose,
  onDone,
  onBack,
}: {
  projectId: string;
  requestId: string;
  onClose: () => void;
  onDone: (testRequestId: string) => void;
  onBack: (text: string) => void;
}) {
  const request = useTestRequest(requestId);

  if (!request.data) {
    return (
      <Modal open width="md" title="테스트 요청" onClose={onClose}>
        {request.isError ? (
          <ErrorBlock error={request.error} onRetry={() => void request.refetch()} />
        ) : (
          <WaitingView label="요청을 불러오는 중" />
        )}
      </Modal>
    );
  }

  const data = request.data;
  switch (data.status) {
    case "REFINING":
      return (
        <Modal open width="md" title="테스트 시나리오 입력" onClose={onClose}>
          <WaitingView label="등록된 명세에서 비슷한 시나리오를 찾고 있습니다" rawText={data.rawText} />
        </Modal>
      );
    case "AWAITING_SELECTION":
      return <SelectStep projectId={projectId} request={data} onClose={onClose} onBack={() => onBack(data.rawText)} />;
    case "GENERATING":
      return (
        <Modal open width="lg" title="테스트 케이스 생성 중" onClose={onClose}>
          <WaitingView
            label="선택한 시나리오로 테스트 케이스를 만들고 있습니다"
            rawText={data.selectedText ?? data.rawText}
          />
        </Modal>
      );
    case "GENERATED":
      return (
        <Modal
          open
          width="lg"
          hideTitle
          title="테스트 케이스 생성이 완료되었습니다"
          onClose={onClose}
        >
          <div className="flex flex-col items-center pt-8 text-center">
            <span className="flex size-12 items-center justify-center rounded-full bg-success-soft text-success">
              <Check aria-hidden className="size-6" />
            </span>
            <p aria-hidden className="mt-5 text-lg font-bold">
              테스트 케이스 생성이 완료되었습니다
            </p>
            {/* ADR-012: 후보 1개에서 시나리오 여러 개가 나올 수 있어 캡처 문구 대신 이 문구를 쓴다 */}
            <p className="mt-2 text-[13px] text-muted">
              시나리오 {data.scenarioCount}개, 테스트 케이스 {data.testCaseCount}개를 만들었어요.
            </p>
            <Button variant="primary" className="mt-7 h-11 w-full" onClick={() => onDone(data.id)}>
              확인
            </Button>
          </div>
        </Modal>
      );
    case "FAILED":
      return (
        <Modal
          open
          width="md"
          title="요청을 처리하지 못했습니다"
          onClose={onClose}
          footer={
            <>
              <Button onClick={onClose}>닫기</Button>
              <Button variant="primary" onClick={() => onBack(data.rawText)}>
                다시 입력
              </Button>
            </>
          }
        >
          <div role="alert" className="flex gap-2 rounded-xl bg-danger-soft px-4 py-3 text-[13px] text-danger">
            <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
            <div>
              <p>{data.errorMessage ?? "AI 서버가 요청을 처리하지 못했습니다."}</p>
              <p className="mt-1 text-xs text-ink/70">실패한 요청은 다시 시도할 수 없어 새 요청으로 만듭니다.</p>
            </div>
          </div>
          <RawTextBox text={data.rawText} className="mt-4" />
        </Modal>
      );
  }
}

function RawTextBox({ text, className }: { text: string; className?: string }) {
  return (
    <div className={clsx("rounded-xl bg-page px-4 py-3.5", className)}>
      <p className="text-xs text-muted">입력한 요청</p>
      <p className="mt-1.5 text-sm font-semibold">{text}</p>
    </div>
  );
}

function WaitingView({ label, rawText }: { label: string; rawText?: string }) {
  return (
    <div>
      {rawText && <RawTextBox text={rawText} />}
      <div role="status" className="flex flex-col items-center gap-3 py-10 text-center">
        <Spinner className="size-6 text-accent" />
        <p className="text-[13px] font-medium">{label}</p>
        <p className="text-xs text-muted">창을 닫아도 서버에서 계속 진행됩니다. 테스트 요청 목록에서 이어서 볼 수 있어요.</p>
      </div>
    </div>
  );
}

const CUSTOM = "custom";

function SelectStep({
  projectId,
  request,
  onClose,
  onBack,
}: {
  projectId: string;
  request: TestRequest;
  onClose: () => void;
  onBack: () => void;
}) {
  const candidates = [...request.candidates].sort((a, b) => a.order - b.order);
  const [selected, setSelected] = useState<string | null>(candidates[0]?.id ?? CUSTOM);
  const [customText, setCustomText] = useState("");
  const select = useSelectRefinedRequest(projectId);

  const canSubmit = selected === CUSTOM ? customText.trim().length > 0 : selected !== null;

  const submit = () => {
    if (!canSubmit || !selected) return;
    select.mutate({
      testRequestId: request.id,
      selection: selected === CUSTOM ? { customText: customText.trim() } : { candidateId: selected },
    });
  };

  const fieldError = select.error instanceof ApiError ? select.error.fieldError("customText") : undefined;

  return (
    <Modal
      open
      width="lg"
      title="테스트 시나리오 선택"
      description="입력한 요청과 비슷한 시나리오 중 테스트할 내용을 하나 골라 주세요."
      onClose={onClose}
      footer={
        <>
          {/* "이전"은 화면만 되돌린다. 이 요청은 AWAITING_SELECTION으로 남는다 (state-machines.md TestRequest) */}
          <Button onClick={onBack}>이전</Button>
          <Button
            variant="primary"
            icon={select.isPending ? <Spinner className="size-4" /> : <ArrowRight aria-hidden className="size-4" />}
            disabled={!canSubmit || select.isPending}
            onClick={submit}
          >
            테스트 케이스 생성하기
          </Button>
        </>
      }
    >
      <RawTextBox text={request.rawText} />
      <fieldset className="mt-5 flex flex-col gap-2">
        <legend className="sr-only">시나리오 후보</legend>
        {candidates.length === 0 && (
          <p className="rounded-xl border border-line px-4 py-3 text-[13px] text-muted">
            비슷한 시나리오를 찾지 못했습니다. 직접 입력해 주세요.
          </p>
        )}
        {candidates.map((candidate) => (
          <CandidateOption
            key={candidate.id}
            checked={selected === candidate.id}
            onChange={() => setSelected(candidate.id)}
            label={candidate.refinedText}
            refs={candidate.references.map((r) => r.sourceId)}
          />
        ))}
        <label
          className={clsx(
            "flex cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-3",
            selected === CUSTOM ? "border-accent bg-accent-row" : "border-line-strong/40 hover:bg-page",
          )}
        >
          <RadioDot checked={selected === CUSTOM} />
          <input
            type="radio"
            name="candidate"
            className="sr-only"
            checked={selected === CUSTOM}
            onChange={() => setSelected(CUSTOM)}
          />
          <span className="text-[13px] font-bold">기타</span>
          {selected === CUSTOM ? (
            <input
              aria-label="직접 입력"
              value={customText}
              maxLength={MAX_TEXT}
              autoFocus
              placeholder="테스트할 내용을 직접 적어 주세요"
              onChange={(event) => setCustomText(event.target.value)}
              className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted"
            />
          ) : (
            <span className="text-[13px] text-muted">직접 입력</span>
          )}
        </label>
      </fieldset>
      {(fieldError || (select.error && !fieldError)) && (
        <p role="alert" className="mt-3 text-xs text-danger">
          {fieldError ?? errorMessage(select.error)}
        </p>
      )}
    </Modal>
  );
}

function RadioDot({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden
      className={clsx(
        "flex size-5 shrink-0 items-center justify-center rounded-full border-2",
        checked ? "border-accent" : "border-line-strong",
      )}
    >
      {checked && <span className="size-2.5 rounded-full bg-accent" />}
    </span>
  );
}

function CandidateOption({
  checked,
  onChange,
  label,
  refs,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
  refs: string[];
}) {
  return (
    <label
      className={clsx(
        "flex cursor-pointer items-start gap-3 rounded-xl border px-3.5 py-3",
        checked ? "border-2 border-accent bg-accent-row px-[13px] py-[11px]" : "border-line-strong/40 hover:bg-page",
      )}
    >
      <RadioDot checked={checked} />
      <input type="radio" name="candidate" className="sr-only" checked={checked} onChange={onChange} />
      <span className="min-w-0">
        <span className={clsx("block text-[13px]", checked && "font-semibold")}>{label}</span>
        {refs.length > 0 && (
          <span className="mt-1 block font-mono text-[11px] text-muted">근거 {refs.join(" · ")}</span>
        )}
      </span>
    </label>
  );
}
