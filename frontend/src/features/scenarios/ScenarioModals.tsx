import clsx from "clsx";
import { CircleAlert } from "lucide-react";
import { useState } from "react";
import { ApiError, errorMessage } from "@/api/errors";
import { useRegenerateScenario, useUpdateScenario } from "@/api/queries/scenarios";
import type { Scenario, VerificationScope } from "@/api/types";
import { Button } from "@/components/Button";
import { Modal } from "@/components/Modal";
import { SCOPE_ORDER } from "./labels";

const inputClass = "h-9 w-full rounded-lg border border-line-strong/60 bg-surface px-3 text-[13px] outline-none focus:border-focus";

function ApprovalWarning({ scenario, text }: { scenario: Scenario; text: string }) {
  if (scenario.status !== "APPROVED") return null;
  return (
    <p className="mb-4 flex items-center gap-1.5 rounded-xl bg-warning-soft px-4 py-2.5 text-xs text-warning">
      <CircleAlert aria-hidden className="size-3.5 shrink-0" />
      {text}
    </p>
  );
}

/** 연필 아이콘: 시나리오 제목·요구사항 ID·검증 범위 수정 (updateScenario) */
export function ScenarioEditModal({ scenario, onClose }: { scenario: Scenario; onClose: () => void }) {
  const update = useUpdateScenario(scenario.testRequestId);
  const [title, setTitle] = useState(scenario.title);
  const [requirementRef, setRequirementRef] = useState(scenario.requirementRef ?? "");
  const [scopes, setScopes] = useState<VerificationScope[]>(scenario.scopes);
  const [touched, setTouched] = useState(false);

  const localError = !title.trim() ? "시나리오 이름을 입력해 주세요." : scopes.length === 0 ? "검증 범위를 1개 이상 고르세요." : null;
  const fieldErrors = update.error instanceof ApiError ? update.error.problem?.fieldErrors : undefined;
  const serverError = update.error ? (fieldErrors?.map((e) => e.message).join("\n") || errorMessage(update.error)) : null;

  const save = () => {
    setTouched(true);
    if (localError) return;
    update.mutate(
      {
        scenarioId: scenario.id,
        body: {
          title: title.trim(),
          scopes: SCOPE_ORDER.filter((s) => scopes.includes(s)),
          // 바뀐 경우에만 보낸다. 비우면 null로 지운다 (ScenarioUpdate.requirementRef)
          ...(requirementRef.trim() !== (scenario.requirementRef ?? "")
            ? { requirementRef: requirementRef.trim() || null }
            : {}),
        },
      },
      { onSuccess: onClose },
    );
  };

  return (
    <Modal
      open
      width="md"
      title={`${scenario.code} 수정`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>취소</Button>
          <Button variant="primary" disabled={update.isPending} onClick={save}>
            {update.isPending ? "저장 중" : "저장"}
          </Button>
        </>
      }
    >
      <ApprovalWarning scenario={scenario} text="저장하면 승인이 풀려 '검토 필요'로 돌아갑니다." />
      <label className="block text-xs font-semibold" htmlFor="scenario-title">
        시나리오 이름
      </label>
      <input id="scenario-title" className={clsx(inputClass, "mt-1.5")} value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
      <div className="mt-4 grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-semibold" htmlFor="scenario-ref">
            요구사항 ID
          </label>
          <input
            id="scenario-ref"
            className={clsx(inputClass, "mt-1.5 font-mono")}
            value={requirementRef}
            maxLength={50}
            placeholder="FR-CART-01"
            onChange={(e) => setRequirementRef(e.target.value)}
          />
        </div>
        <fieldset>
          <legend className="text-xs font-semibold">검증 범위</legend>
          <div className="mt-1.5 flex h-9 items-center gap-4">
            {SCOPE_ORDER.map((scope) => (
              <label key={scope} className="flex items-center gap-1.5 font-mono text-xs">
                <input
                  type="checkbox"
                  className="accent-ink"
                  checked={scopes.includes(scope)}
                  onChange={(e) => setScopes((prev) => (e.target.checked ? [...prev, scope] : prev.filter((s) => s !== scope)))}
                />
                {scope}
              </label>
            ))}
          </div>
        </fieldset>
      </div>
      {((touched && localError) || serverError) && (
        <p role="alert" className="mt-3 text-xs whitespace-pre-line text-danger">
          {touched && localError ? localError : serverError}
        </p>
      )}
    </Modal>
  );
}

/** 다시 생성 (regenerateScenario). 캡처에 없어 같은 스타일로 설계했다 */
export function RegenerateModal({ scenario, onClose }: { scenario: Scenario; onClose: () => void }) {
  const regenerate = useRegenerateScenario(scenario.testRequestId);
  const [feedback, setFeedback] = useState("");
  return (
    <Modal
      open
      width="md"
      title={`${scenario.code} 다시 생성`}
      description="기존 케이스는 비활성화되고 새 번호의 케이스로 바뀝니다. 시나리오 코드는 유지됩니다."
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>취소</Button>
          <Button
            variant="primary"
            disabled={regenerate.isPending}
            onClick={() => regenerate.mutate({ scenarioId: scenario.id, feedback }, { onSuccess: onClose })}
          >
            {regenerate.isPending ? "요청 중" : "다시 생성"}
          </Button>
        </>
      }
    >
      <ApprovalWarning scenario={scenario} text="다시 만들면 승인이 풀립니다." />
      <label className="block text-xs font-semibold" htmlFor="regenerate-feedback">
        고칠 점 <span className="font-normal text-muted">(선택)</span>
      </label>
      <textarea
        id="regenerate-feedback"
        rows={3}
        maxLength={500}
        value={feedback}
        placeholder="예: 품절 상품 케이스를 빼고 쿠폰 중복 적용을 확인해 줘"
        onChange={(e) => setFeedback(e.target.value)}
        className={clsx(inputClass, "mt-1.5 h-auto py-2")}
      />
      <p className="mt-1 text-right font-mono text-[11px] text-muted">{feedback.length} / 500자</p>
      {regenerate.error && (
        <p role="alert" className="mt-2 text-xs text-danger">
          {errorMessage(regenerate.error)}
        </p>
      )}
    </Modal>
  );
}
