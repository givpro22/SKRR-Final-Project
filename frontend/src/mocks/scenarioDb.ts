// M2 목 데이터: 테스트 요청·시나리오·케이스. 초기 값은 UI-02-5 캡처 상황(승인 4, 검토 필요 1, 가드 재생성 1)을 재현한다.
// 화면 코드에는 쓰지 않는다.
import type {
  ExpectedValue,
  RequestCandidate,
  Scenario,
  ScenarioList,
  TestCase,
  TestCaseType,
  TestRequest,
  VerificationScope,
} from "@/api/types";
import { MOCK_PROJECT_ID } from "./db";

export const MOCK_REQUEST_ID = "c3000000-0000-4000-8000-000000000142";

interface Progress {
  polls: number;
  /** 재생성 결과. catalogGap이면 3회 실패로 끝난다 */
  outcome: "pass" | "catalogGap";
}

interface ScenarioDb {
  requests: TestRequest[];
  scenarios: Scenario[];
  /** 요청 id → 조회 횟수 (정제·생성 진행) */
  requestPolls: Map<string, number>;
  /** 시나리오 id → 재생성 진행 */
  regen: Map<string, Progress>;
  seq: number;
  requestSeq: number;
}

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const uuid = (prefix: string, n: number) => `${prefix}-0000-4000-8000-${n.toString().padStart(12, "0")}`;

function makeCase(
  scenarioId: string,
  n: number,
  order: number,
  title: string,
  type: TestCaseType,
  scopes: VerificationScope[],
  expectedResult: string,
  expectedValues: ExpectedValue[],
): TestCase {
  return {
    id: uuid("e5000000", n),
    code: `TC-${n.toString().padStart(2, "0")}`,
    scenarioId,
    title,
    type,
    scopes,
    preconditions: ["재고가 있는 상품이 1개 이상 있다"],
    steps: ["상품 상세 화면을 연다", "장바구니 담기 버튼을 누른다", "장바구니 화면으로 이동한다"],
    expectedResult,
    expectedValues,
    order,
    version: 1,
    isActive: true,
  };
}

function makeScenario(
  n: number,
  title: string,
  scopes: VerificationScope[],
  requirementRef: string,
  status: Scenario["status"],
  cases: (scenarioId: string) => TestCase[],
): Scenario {
  const id = uuid("d4000000", n);
  const testCases = cases(id);
  return {
    id,
    code: `SC-${n.toString().padStart(2, "0")}`,
    testRequestId: MOCK_REQUEST_ID,
    title,
    requirementRef,
    scopes,
    status,
    guard: { attempt: 1, maxAttempts: 3, message: null, catalogGap: false, failures: [] },
    references: [
      { sourceType: "REQUIREMENT", sourceId: requirementRef, title: title, excerpt: "요구사항 명세서의 해당 항목", score: 0.82 },
    ],
    version: 1,
    approvedAt: status === "APPROVED" ? minutesAgo(30) : null,
    caseCount: testCases.length,
    testCases,
  };
}

const qty = (label: string, expected: string): ExpectedValue => ({ label, expected });

function seedScenarios(): Scenario[] {
  return [
    makeScenario(1, "장바구니에 제품을 담는다", ["UI", "API", "DB"], "FR-CART-01", "APPROVED", (id) => [
      makeCase(id, 1, 1, "회원이 재고 있는 제품을 담는다", "NORMAL", ["UI", "API", "DB"], "장바구니 수량 +1, 항목 1건 저장", [
        qty("장바구니 항목 수", "1"),
        qty("무선 이어폰 수량", "1"),
        { label: "장바구니 ID", consistencyOnly: true, reason: "실행마다 새로 만들어져 값을 미리 알 수 없음" },
      ]),
      makeCase(id, 2, 2, "비회원이 재고 있는 제품을 담는다", "NORMAL", ["UI", "API"], "장바구니 수량 +1, 비회원 장바구니 유지", [qty("장바구니 항목 수", "1")]),
      makeCase(id, 3, 3, "이미 담긴 제품을 다시 담는다", "NORMAL", ["UI", "DB"], "항목은 1건 유지, 수량 2로 증가", [qty("무선 이어폰 수량", "2")]),
      makeCase(id, 4, 4, "필수 옵션을 고르지 않고 담는다", "EXCEPTION", ["UI"], "옵션 선택 안내, 장바구니 변경 없음", [qty("안내 문구", "옵션을 선택해 주세요")]),
      makeCase(id, 5, 5, "품절 제품을 담는다", "EXCEPTION", ["UI", "API"], "품절 안내, 장바구니 변경 없음", [qty("응답 코드", "409")]),
      makeCase(id, 6, 6, "최대 수량 99개를 초과해 담는다", "BOUNDARY", ["UI", "API"], "수량 초과 안내, 99개로 유지", [qty("무선 이어폰 수량", "99")]),
    ]),
    makeScenario(2, "장바구니 제품의 수량을 변경한다", ["UI", "DB"], "FR-CART-02", "APPROVED", (id) =>
      [7, 8, 9, 10].map((n, i) => makeCase(id, n, i + 1, `수량 변경 케이스 ${i + 1}`, "NORMAL", ["UI", "DB"], "수량이 바뀐다", [qty("수량", `${i + 2}`)])),
    ),
    makeScenario(3, "비회원 장바구니를 로그인 후 병합한다", ["UI", "API", "DB"], "FR-CART-03", "APPROVED", (id) =>
      [11, 12, 13].map((n, i) => makeCase(id, n, i + 1, `병합 케이스 ${i + 1}`, "NORMAL", ["UI", "API", "DB"], "회원 장바구니로 합쳐진다", [qty("항목 수", "2")])),
    ),
    makeScenario(4, "장바구니 제품을 결제한다", ["UI", "API"], "FR-ORD-01", "APPROVED", (id) =>
      [14, 15, 16, 17, 18].map((n, i) => makeCase(id, n, i + 1, `결제 케이스 ${i + 1}`, i === 4 ? "BOUNDARY" : "NORMAL", ["UI", "API"], "주문이 생성된다", [qty("주문 상태", "PAID")])),
    ),
    makeScenario(5, "쿠폰을 적용해 결제한다", ["UI", "API"], "FR-CPN-02", "REVIEW_REQUIRED", (id) => [
      makeCase(id, 19, 1, "정액 쿠폰을 적용해 결제한다", "NORMAL", ["UI", "API"], "결제 금액이 쿠폰만큼 줄어든다", [
        qty("결제 금액", "27000"),
        { label: "주문 번호", consistencyOnly: true, reason: "결제할 때 새로 발급됨" },
      ]),
      makeCase(id, 20, 2, "만료된 쿠폰을 적용한다", "EXCEPTION", ["UI"], "만료 안내, 할인 없음", [qty("안내 문구", "만료된 쿠폰입니다")]),
    ]),
    (() => {
      const sc = makeScenario(6, "장바구니에서 제품을 삭제한다", ["API"], "FR-CART-07", "GUARD_RETRY", () => []);
      sc.guard = {
        attempt: 2,
        maxAttempts: 3,
        message: "카탈로그에 'cart-remove-button' 요소가 없어 재생성 중",
        catalogGap: false,
        failures: [{ kind: "UNKNOWN_TEST_ID", message: "카탈로그에 'cart-remove-button' 요소가 없습니다", subject: "cart-remove-button" }],
      };
      return sc;
    })(),
  ];
}

function initial(): ScenarioDb {
  const scenarios = seedScenarios();
  return {
    requests: [
      {
        id: MOCK_REQUEST_ID,
        code: "REQ-0142",
        projectId: MOCK_PROJECT_ID,
        rawText: "비회원이 장바구니에 담은 상품, 로그인하고 나서도 그대로 결제되는지 봐줘",
        status: "GENERATED",
        selectionSource: "CANDIDATE",
        selectedText: "비회원 장바구니에 담은 상품이 로그인 후에도 유지되어 결제까지 완료되는지 확인해줘",
        candidates: [],
        scenarioCount: scenarios.length,
        testCaseCount: scenarios.reduce((sum, s) => sum + s.caseCount, 0),
        errorMessage: null,
        createdAt: minutesAgo(40),
      },
    ],
    scenarios,
    requestPolls: new Map(),
    // SC-06은 캡처처럼 재생성 중이며, 카탈로그에 요소가 없어 결국 3회 실패한다
    regen: new Map([[scenarios[5]?.id ?? "", { polls: 0, outcome: "catalogGap" }]]),
    seq: 100,
    requestSeq: 142,
  };
}

export let sdb: ScenarioDb = initial();

export function resetScenarioDb() {
  sdb = initial();
}

export function activeCases(scenario: Scenario): TestCase[] {
  return scenario.testCases.filter((c) => c.isActive);
}

export function viewScenario(scenario: Scenario): Scenario {
  const cases = activeCases(scenario);
  return { ...scenario, testCases: cases, caseCount: cases.length };
}

export function scenarioList(request: TestRequest): ScenarioList {
  const items = sdb.scenarios.filter((s) => s.testRequestId === request.id).map(viewScenario);
  const count = (status: Scenario["status"]) => items.filter((s) => s.status === status).length;
  return {
    testRequest: request,
    items,
    summary: {
      total: items.length,
      approved: count("APPROVED"),
      reviewRequired: count("REVIEW_REQUIRED"),
      guardRetry: count("GUARD_RETRY"),
      generating: count("GENERATING"),
      rejected: count("REJECTED"),
      guardFailed: count("GUARD_FAILED"),
    },
  };
}

function nextCaseNumber(requestId: string): number {
  const numbers = sdb.scenarios
    .filter((s) => s.testRequestId === requestId)
    .flatMap((s) => s.testCases.map((c) => Number(c.code.slice(3))));
  return Math.max(0, ...numbers) + 1;
}

function freshCases(scenario: Scenario, count: number): TestCase[] {
  const first = nextCaseNumber(scenario.testRequestId);
  return Array.from({ length: count }, (_, i) => {
    sdb.seq += 1;
    return {
      ...makeCase(scenario.id, first + i, i + 1, `${scenario.title} 케이스 ${i + 1}`, i === 0 ? "NORMAL" : "EXCEPTION", scenario.scopes, "기대한 결과가 화면과 DB에 반영된다", [
        qty("처리 결과", "성공"),
      ]),
      id: uuid("f6000000", sdb.seq),
    };
  });
}

/** 재생성 중인 시나리오를 한 단계씩 진행한다: GENERATING(1회) → GUARD_RETRY(2회) → 결과 */
export function advanceScenarios(requestId: string) {
  for (const scenario of sdb.scenarios.filter((s) => s.testRequestId === requestId)) {
    const progress = sdb.regen.get(scenario.id);
    if (!progress) continue;
    progress.polls += 1;
    if (progress.polls === 1 && scenario.status === "GENERATING") {
      scenario.status = "GUARD_RETRY";
      scenario.guard = {
        attempt: 2,
        maxAttempts: 3,
        message: "기대값이 없는 케이스가 있어 재생성 중",
        catalogGap: false,
        failures: [{ kind: "MISSING_EXPECTED", message: "기대값이 없는 케이스가 있습니다", subject: null }],
      };
    } else if (progress.polls >= 2) {
      sdb.regen.delete(scenario.id);
      if (progress.outcome === "catalogGap") {
        scenario.status = "GUARD_FAILED";
        scenario.guard = {
          attempt: 3,
          maxAttempts: 3,
          message: "카탈로그에 'cart-remove-button' 요소가 없습니다",
          catalogGap: true,
          failures: [{ kind: "CATALOG_GAP", message: "카탈로그에 'cart-remove-button' 요소가 없습니다", subject: "cart-remove-button" }],
        };
      } else {
        for (const c of scenario.testCases) c.isActive = false;
        scenario.testCases.push(...freshCases(scenario, 2));
        scenario.status = "REVIEW_REQUIRED";
        scenario.guard = { attempt: 1, maxAttempts: 3, message: null, catalogGap: false, failures: [] };
      }
    }
  }
}

export function startRegeneration(scenario: Scenario) {
  scenario.status = "GENERATING";
  scenario.version += 1;
  scenario.approvedAt = null;
  scenario.guard = { attempt: 1, maxAttempts: 3, message: null, catalogGap: false, failures: [] };
  sdb.regen.set(scenario.id, { polls: 0, outcome: scenario.title.includes("삭제") ? "catalogGap" : "pass" });
}

export function createRequest(projectId: string, text: string): TestRequest {
  sdb.requestSeq += 1;
  sdb.seq += 1;
  const request: TestRequest = {
    id: uuid("c3000000", sdb.seq),
    code: `REQ-${sdb.requestSeq.toString().padStart(4, "0")}`,
    projectId,
    rawText: text,
    status: "REFINING",
    selectionSource: null,
    selectedText: null,
    candidates: [],
    scenarioCount: 0,
    testCaseCount: 0,
    errorMessage: null,
    createdAt: new Date().toISOString(),
  };
  sdb.requests.unshift(request);
  return request;
}

function candidatesFor(request: TestRequest): RequestCandidate[] {
  const texts = [
    `${request.rawText} — 정상 흐름이 끝까지 완료되는지 확인해줘`,
    `${request.rawText} — 회원과 비회원 각각 확인해줘`,
    `${request.rawText} — 수량과 금액이 그대로인지 확인해줘`,
    `${request.rawText} — 실패했을 때 안내가 나오는지 확인해줘`,
  ];
  return texts.map((refinedText, i) => {
    sdb.seq += 1;
    return {
      id: uuid("a7000000", sdb.seq),
      order: i + 1,
      refinedText,
      references: [{ sourceType: "REQUIREMENT", sourceId: `FR-CART-0${i + 1}`, title: null, excerpt: "관련 요구사항", score: 0.8 - i * 0.1 }],
    };
  });
}

/** 조회할 때마다 정제·생성을 진행한다. 요청 문장에 "실패"가 있으면 정제가 실패한다 */
export function advanceRequest(request: TestRequest) {
  const polls = (sdb.requestPolls.get(request.id) ?? 0) + 1;
  sdb.requestPolls.set(request.id, polls);
  if (request.status === "REFINING" && polls >= 1) {
    if (request.rawText.includes("실패")) {
      request.status = "FAILED";
      request.errorMessage = "지식 베이스에서 관련 명세를 찾지 못했습니다. 지식 베이스를 다시 구축한 뒤 새 요청을 만들어 주세요.";
    } else {
      request.status = "AWAITING_SELECTION";
      request.candidates = candidatesFor(request);
    }
    sdb.requestPolls.set(request.id, 0);
  } else if (request.status === "GENERATING" && polls >= 2) {
    const base = sdb.scenarios.filter((s) => s.testRequestId === request.id).length;
    const made: Scenario[] = [1, 2].map((k) => {
      sdb.seq += 1;
      const scenario: Scenario = {
        id: uuid("b8000000", sdb.seq),
        code: `SC-${(base + k).toString().padStart(2, "0")}`,
        testRequestId: request.id,
        title: k === 1 ? "선택한 흐름을 정상적으로 완료한다" : "잘못된 입력에 안내를 보여 준다",
        requirementRef: "FR-CART-03",
        scopes: k === 1 ? ["UI", "API", "DB"] : ["UI"],
        status: "REVIEW_REQUIRED",
        guard: { attempt: 1, maxAttempts: 3, message: null, catalogGap: false, failures: [] },
        references: [],
        version: 1,
        approvedAt: null,
        caseCount: 0,
        testCases: [],
      };
      sdb.scenarios.push(scenario);
      scenario.testCases = freshCases(scenario, k === 1 ? 2 : 1);
      return scenario;
    });
    request.status = "GENERATED";
    request.scenarioCount = made.length;
    request.testCaseCount = made.reduce((sum, s) => sum + activeCases(s).length, 0);
  }
}

export function selectCandidate(request: TestRequest, selection: { candidateId?: string; customText?: string }): string | null {
  if (selection.customText !== undefined) {
    request.selectionSource = "CUSTOM";
    request.selectedText = selection.customText;
  } else {
    const candidate = request.candidates.find((c) => c.id === selection.candidateId);
    if (!candidate) return "이 요청의 후보가 아닙니다.";
    request.selectionSource = "CANDIDATE";
    request.selectedText = candidate.refinedText;
  }
  request.status = "GENERATING";
  sdb.requestPolls.set(request.id, 0);
  return null;
}
