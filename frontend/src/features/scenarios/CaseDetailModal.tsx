import clsx from "clsx";
import { CircleAlert, Pencil, Plus, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { ApiError, errorMessage } from "@/api/errors";
import { isScenarioProcessing, useTestCase, useUpdateTestCase } from "@/api/queries/scenarios";
import type { Scenario, TestCase, TestCaseType, VerificationScope } from "@/api/types";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { CodeText } from "@/components/CodeText";
import { Modal } from "@/components/Modal";
import { ErrorBlock, LoadingBlock } from "@/components/StateViews";
import { emptyDraft, toDraft, toExpectedValue, validateDrafts, type ExpectedValueDraft } from "./expectedValues";
import { SCOPE_ORDER, testCaseTypeView } from "./labels";
import { ScopeChips } from "./ScopeChips";

const TYPES = ["NORMAL", "EXCEPTION", "BOUNDARY"] as const satisfies readonly TestCaseType[];

interface Props {
  scenario: Scenario;
  testCase: TestCase;
  onClose: () => void;
}

/** 케이스 상세 (캡처에 없음). 사용자가 승인할 기대값(expectedValues)을 보여 주고 고친다 (ADR-017) */
export function CaseDetailModal({ scenario, testCase: initial, onClose }: Props) {
  const query = useTestCase(initial.id, initial);
  const [editing, setEditing] = useState(false);
  const testCase = query.data;
  const locked = isScenarioProcessing(scenario.status) || !initial.isActive;

  return (
    <Modal open width="xl" title={`${initial.code} ${initial.title}`} onClose={onClose}>
      {query.isError && !testCase ? (
        <ErrorBlock error={query.error} onRetry={() => void query.refetch()} />
      ) : !testCase ? (
        <LoadingBlock />
      ) : editing ? (
        <CaseEditForm
          scenario={scenario}
          testCase={testCase}
          onCancel={() => setEditing(false)}
          onSaved={() => setEditing(false)}
        />
      ) : (
        <CaseView testCase={testCase} locked={locked} onEdit={() => setEditing(true)} scenario={scenario} />
      )}
    </Modal>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-5">
      <h3 className="text-[13px] font-bold">{title}</h3>
      <div className="mt-2">{children}</div>
    </section>
  );
}

function CaseView({
  scenario,
  testCase,
  locked,
  onEdit,
}: {
  scenario: Scenario;
  testCase: TestCase;
  locked: boolean;
  onEdit: () => void;
}) {
  const type = testCaseTypeView[testCase.type];
  const consistencyCount = testCase.expectedValues.filter((v) => v.consistencyOnly).length;
  return (
    <div>
      <div className="flex items-center gap-2">
        <Badge tone={type.tone}>{type.label}</Badge>
        <ScopeChips scopes={testCase.scopes} />
        <span className="ml-auto font-mono text-[11px] text-muted">
          {scenario.code} · v{testCase.version}
        </span>
      </div>

      {(testCase.preconditions?.length ?? 0) > 0 && (
        <Section title="사전 조건">
          <ul className="list-disc pl-5 text-[13px] text-ink/80">
            {testCase.preconditions?.map((item, i) => (
              <li key={i}>
                <CodeText text={item} />
              </li>
            ))}
          </ul>
        </Section>
      )}
      {(testCase.steps?.length ?? 0) > 0 && (
        <Section title="단계">
          <ol className="list-decimal pl-5 text-[13px] text-ink/80">
            {testCase.steps?.map((item, i) => (
              <li key={i}>
                <CodeText text={item} />
              </li>
            ))}
          </ol>
        </Section>
      )}
      <Section title="예상 결과">
        <p className="text-[13px] text-ink/80">
          <CodeText text={testCase.expectedResult} />
        </p>
      </Section>

      <Section title={`승인할 기대값 ${testCase.expectedValues.length}`}>
        {consistencyCount > 0 && (
          <p className="mb-2 flex items-center gap-1.5 text-xs text-warning">
            <CircleAlert aria-hidden className="size-3.5" />
            {consistencyCount}개 항목은 값을 미리 정하지 않고 화면·API·DB가 서로 같은지만 확인합니다. 이유를 확인해 주세요.
          </p>
        )}
        <table className="w-full text-left text-[13px]">
          <thead>
            <tr className="border-b border-line text-xs text-ink/70">
              <th className="w-[38%] py-2 font-medium">검증 항목</th>
              <th className="py-2 font-medium">기대값</th>
            </tr>
          </thead>
          <tbody>
            {testCase.expectedValues.map((value, i) => (
              <tr
                key={`${value.label}-${i}`}
                data-consistency-only={value.consistencyOnly || undefined}
                className={clsx("border-b border-line last:border-b-0", value.consistencyOnly && "bg-warning-soft/50")}
              >
                <td className="py-2.5 pr-3 align-top font-medium">{value.label}</td>
                <td className="py-2.5 align-top">
                  {value.consistencyOnly ? (
                    <span className="flex flex-col gap-1">
                      <Badge tone="warning" className="h-5 self-start">
                        일관성만 확인
                      </Badge>
                      <span className="text-xs text-ink/80">이유: {value.reason}</span>
                    </span>
                  ) : (
                    <span className="font-mono">{value.expected}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <div className="mt-6 flex items-center justify-between gap-3">
        <p className="text-xs text-muted">
          {locked
            ? !testCase.isActive
              ? "다시 생성되어 대체된 케이스라 고칠 수 없습니다."
              : "시나리오를 만드는 중에는 고칠 수 없습니다."
            : scenario.status === "APPROVED"
              ? "고치면 시나리오 승인이 풀려 다시 승인해야 합니다."
              : "기대값을 확인하고 필요하면 고쳐 주세요."}
        </p>
        <Button disabled={locked} icon={<Pencil aria-hidden className="size-4" />} onClick={onEdit}>
          수정
        </Button>
      </div>
    </div>
  );
}

function lines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function CaseEditForm({
  scenario,
  testCase,
  onCancel,
  onSaved,
}: {
  scenario: Scenario;
  testCase: TestCase;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const update = useUpdateTestCase(scenario.testRequestId);
  const [title, setTitle] = useState(testCase.title);
  const [type, setType] = useState<TestCaseType>(testCase.type);
  const [scopes, setScopes] = useState<VerificationScope[]>(testCase.scopes);
  const [preconditions, setPreconditions] = useState((testCase.preconditions ?? []).join("\n"));
  const [steps, setSteps] = useState((testCase.steps ?? []).join("\n"));
  const [expectedResult, setExpectedResult] = useState(testCase.expectedResult);
  const [drafts, setDrafts] = useState<ExpectedValueDraft[]>(() => testCase.expectedValues.map(toDraft));
  const [showErrors, setShowErrors] = useState(false);

  const validation = validateDrafts(drafts);
  const formError =
    !title.trim()
      ? "케이스 이름을 입력해 주세요."
      : !expectedResult.trim()
        ? "예상 결과를 입력해 주세요."
        : scopes.length === 0
          ? "검증 범위를 1개 이상 고르세요."
          : (validation.list ?? (Object.keys(validation.rows).length > 0 ? "기대값을 확인해 주세요." : null));

  const patch = (key: string, change: Partial<ExpectedValueDraft>) =>
    setDrafts((prev) => prev.map((d) => (d.key === key ? { ...d, ...change } : d)));

  const save = () => {
    setShowErrors(true);
    if (formError) return;
    update.mutate(
      {
        testCaseId: testCase.id,
        body: {
          title: title.trim(),
          type,
          scopes: SCOPE_ORDER.filter((s) => scopes.includes(s)),
          preconditions: lines(preconditions),
          steps: lines(steps),
          expectedResult: expectedResult.trim(),
          expectedValues: drafts.map(toExpectedValue),
        },
      },
      { onSuccess: onSaved },
    );
  };

  const serverError =
    update.error instanceof ApiError && update.error.problem?.fieldErrors?.length
      ? update.error.problem.fieldErrors.map((e) => `${e.field}: ${e.message}`).join("\n")
      : update.error
        ? errorMessage(update.error)
        : null;

  const inputClass = "h-9 w-full rounded-lg border border-line-strong/60 bg-surface px-3 text-[13px] outline-none focus:border-focus";

  return (
    <div>
      {scenario.status === "APPROVED" && (
        <p className="mb-4 flex items-center gap-1.5 rounded-xl bg-warning-soft px-4 py-2.5 text-xs text-warning">
          <CircleAlert aria-hidden className="size-3.5" />
          저장하면 시나리오 승인이 풀려 &apos;검토 필요&apos;로 돌아갑니다.
        </p>
      )}
      <label className="block text-xs font-semibold" htmlFor="case-title">
        케이스 이름
      </label>
      <input id="case-title" className={clsx(inputClass, "mt-1.5")} value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />

      <div className="mt-4 grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-semibold" htmlFor="case-type">
            유형
          </label>
          <select
            id="case-type"
            className={clsx(inputClass, "mt-1.5")}
            value={type}
            onChange={(e) => {
              const next = TYPES.find((t) => t === e.target.value);
              if (next) setType(next);
            }}
          >
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {testCaseTypeView[t].label}
              </option>
            ))}
          </select>
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
                  onChange={(e) =>
                    setScopes((prev) => (e.target.checked ? [...prev, scope] : prev.filter((s) => s !== scope)))
                  }
                />
                {scope}
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-semibold" htmlFor="case-preconditions">
            사전 조건 <span className="font-normal text-muted">(한 줄에 하나)</span>
          </label>
          <textarea id="case-preconditions" rows={3} className={clsx(inputClass, "mt-1.5 h-auto py-2")} value={preconditions} onChange={(e) => setPreconditions(e.target.value)} />
        </div>
        <div>
          <label className="block text-xs font-semibold" htmlFor="case-steps">
            단계 <span className="font-normal text-muted">(한 줄에 하나)</span>
          </label>
          <textarea id="case-steps" rows={3} className={clsx(inputClass, "mt-1.5 h-auto py-2")} value={steps} onChange={(e) => setSteps(e.target.value)} />
        </div>
      </div>

      <label className="mt-4 block text-xs font-semibold" htmlFor="case-expected-result">
        예상 결과
      </label>
      <input id="case-expected-result" className={clsx(inputClass, "mt-1.5")} value={expectedResult} onChange={(e) => setExpectedResult(e.target.value)} />

      <h3 className="mt-5 text-[13px] font-bold">승인할 기대값</h3>
      <ul aria-label="기대값" className="mt-2 flex flex-col gap-2">
        {drafts.map((draft, index) => {
          const rowError = showErrors ? validation.rows[draft.key] : undefined;
          return (
            <li key={draft.key} className={clsx("rounded-xl border px-3 py-2.5", draft.mode === "consistency" ? "border-warning-soft bg-warning-soft/40" : "border-line")}>
              <div className="flex items-center gap-2">
                <input
                  aria-label={`기대값 ${index + 1} 검증 항목`}
                  placeholder="검증 항목 (예: 무선 이어폰 수량)"
                  className={clsx(inputClass, "flex-[1.2]")}
                  value={draft.label}
                  onChange={(e) => patch(draft.key, { label: e.target.value })}
                />
                <select
                  aria-label={`기대값 ${index + 1} 방식`}
                  className={clsx(inputClass, "w-[120px] shrink-0")}
                  value={draft.mode}
                  onChange={(e) => patch(draft.key, { mode: e.target.value === "consistency" ? "consistency" : "value" })}
                >
                  <option value="value">값 지정</option>
                  <option value="consistency">일관성만</option>
                </select>
                {draft.mode === "value" ? (
                  <input
                    aria-label={`기대값 ${index + 1} 값`}
                    placeholder="기대값"
                    className={clsx(inputClass, "flex-1 font-mono")}
                    value={draft.expected}
                    onChange={(e) => patch(draft.key, { expected: e.target.value })}
                  />
                ) : (
                  <input
                    aria-label={`기대값 ${index + 1} 이유`}
                    placeholder="값을 미리 알 수 없는 이유"
                    className={clsx(inputClass, "flex-1")}
                    value={draft.reason}
                    onChange={(e) => patch(draft.key, { reason: e.target.value })}
                  />
                )}
                <button
                  type="button"
                  aria-label={`기대값 ${index + 1} 삭제`}
                  onClick={() => setDrafts((prev) => prev.filter((d) => d.key !== draft.key))}
                  className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-page hover:text-danger"
                >
                  <Trash2 aria-hidden className="size-4" />
                </button>
              </div>
              {rowError && <p className="mt-1.5 text-xs text-danger">{rowError}</p>}
            </li>
          );
        })}
      </ul>
      <Button size="sm" variant="ghost" className="mt-2" icon={<Plus aria-hidden className="size-3.5" />} onClick={() => setDrafts((prev) => [...prev, emptyDraft()])}>
        기대값 추가
      </Button>

      {((showErrors && formError) || serverError) && (
        <p role="alert" className="mt-3 text-xs whitespace-pre-line text-danger">
          {showErrors && formError ? formError : serverError}
        </p>
      )}

      <div className="mt-6 flex justify-end gap-2">
        <Button onClick={onCancel}>취소</Button>
        <Button variant="primary" disabled={update.isPending} onClick={save}>
          {update.isPending ? "저장 중" : "저장"}
        </Button>
      </div>
    </div>
  );
}
