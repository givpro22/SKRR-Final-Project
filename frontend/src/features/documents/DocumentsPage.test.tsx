import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { MOCK_PROJECT_ID } from "@/mocks/db";
import { problem } from "@/mocks/handlers";
import { server } from "@/mocks/server";
import { renderRoute } from "@/test/render";

const PATH = `/projects/${MOCK_PROJECT_ID}/documents`;

async function renderPage() {
  const utils = renderRoute(PATH);
  await screen.findByRole("heading", { name: "테스트 기준 문서 등록" });
  await screen.findByTestId("document-row-REQUIREMENT");
  return utils;
}

describe("UI-01 문서 등록", () => {
  it("필수 문서가 빠지면 배너로 알리고, 빠진 행을 강조하고, 구축을 막는다 (FR-01)", async () => {
    await renderPage();

    const banner = await screen.findByText("필수 문서 1개가 빠져 등록할 수 없습니다");
    expect(banner.parentElement).toHaveTextContent("카탈로그(화면 요소 · data-testid 목록)를 추가하면 지식 베이스 구축이 활성화됩니다.");

    const catalogRow = screen.getByTestId("document-row-CATALOG");
    expect(catalogRow).toHaveAttribute("data-missing", "true");
    expect(within(catalogRow).getByRole("button", { name: "카탈로그 파일 선택" })).toBeEnabled();
    expect(screen.getByTestId("document-row-API_SPEC")).not.toHaveAttribute("data-missing");

    expect(screen.getByRole("button", { name: "지식 베이스 구축" })).toBeDisabled();
    expect(screen.getByText("필수 3개 중 2개 등록 · 선택 1개")).toBeInTheDocument();
  });

  it("문서 상태를 계약 문구로 표시한다", async () => {
    await renderPage();
    expect(within(screen.getByTestId("document-row-REQUIREMENT")).getByText("인덱싱 완료")).toBeInTheDocument();
    expect(within(screen.getByTestId("document-row-API_SPEC")).getByText("구축 대기")).toBeInTheDocument();
    expect(within(screen.getByTestId("document-row-TEST_DATA")).getByText("등록됨")).toBeInTheDocument();
    expect(screen.getByText("requirements_v3.pdf · 2.4MB · 요구사항 42개")).toBeInTheDocument();
    expect(screen.getByText("seed_accounts.json · 40KB · 변수 12개 · 비밀값 3개")).toBeInTheDocument();
  });

  it("빠진 문서를 올리면 배너가 사라지고 구축할 수 있게 된다", async () => {
    const user = userEvent.setup();
    await renderPage();

    await user.click(screen.getByRole("button", { name: "카탈로그 파일 선택" }));
    const file = new File(['[{"testid":"cart-add-button"}]'], "catalog.json", { type: "application/json" });
    await user.upload(screen.getByTestId("row-file-input"), file);

    await waitFor(() => expect(screen.queryByText(/필수 문서 \d개가 빠져/)).not.toBeInTheDocument());
    const catalogRow = screen.getByTestId("document-row-CATALOG");
    await within(catalogRow).findByText(/catalog\.json/);
    expect(catalogRow).not.toHaveAttribute("data-missing");
    await waitFor(() => expect(screen.getByRole("button", { name: "지식 베이스 구축" })).toBeEnabled());
  });

  it("서버가 409 MISSING_REQUIRED_DOCUMENTS로 거부하면 다시 읽은 빠진 항목을 배너로 보여 준다", async () => {
    let calls = 0;
    server.use(
      http.get("*/api/v1/projects/:projectId/knowledge-base", ({ params }) => {
        calls += 1;
        // 첫 조회는 구축 가능, 거부 후 조회는 요구사항 명세서가 빠진 상태
        return HttpResponse.json({
          projectId: String(params.projectId),
          status: "NOT_BUILT",
          chunkCount: 0,
          requirementCount: 0,
          apiCount: 0,
          uiElementCount: 0,
          lastSyncedAt: null,
          errorMessage: null,
          readiness: [],
          missingDocumentTypes: calls === 1 ? [] : ["REQUIREMENT"],
          canBuild: calls === 1,
        });
      }),
      http.post("*/api/v1/projects/:projectId/knowledge-base/build", () =>
        problem(409, "MISSING_REQUIRED_DOCUMENTS", "필수 문서 누락", "필수 문서가 빠져 있습니다: REQUIREMENT"),
      ),
    );
    const user = userEvent.setup();
    await renderPage();

    const build = await screen.findByRole("button", { name: "지식 베이스 구축" });
    await waitFor(() => expect(build).toBeEnabled());
    await user.click(build);

    expect(await screen.findByText("필수 문서 1개가 빠져 등록할 수 없습니다")).toBeInTheDocument();
    expect(screen.getByTestId("document-row-REQUIREMENT")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "지식 베이스 구축" })).toBeDisabled());
  });

  it("20MB를 넘는 파일은 서버에 보내지 않고 안내한다", async () => {
    let uploaded = false;
    server.use(
      http.post("*/api/v1/projects/:projectId/documents", () => {
        uploaded = true;
        return HttpResponse.json({}, { status: 500 });
      }),
    );
    const user = userEvent.setup();
    await renderPage();

    const big = new File(["x"], "huge.json", { type: "application/json" });
    Object.defineProperty(big, "size", { value: 21 * 1024 * 1024 });
    await user.click(screen.getByRole("button", { name: "카탈로그 파일 선택" }));
    await user.upload(screen.getByTestId("row-file-input"), big);

    expect(await screen.findByText("huge.json: 파일당 20MB 이하만 올릴 수 있습니다.")).toBeInTheDocument();
    expect(uploaded).toBe(false);
  });

  it("종류에 맞지 않는 형식은 서버에 보내지 않고 안내한다", async () => {
    const user = userEvent.setup({ applyAccept: false });
    await renderPage();

    await user.click(screen.getByRole("button", { name: "카탈로그 파일 선택" }));
    expect(screen.getByTestId("row-file-input")).toHaveAttribute("accept", ".csv,.json");
    await user.upload(screen.getByTestId("row-file-input"), new File(["%PDF"], "catalog.pdf", { type: "application/pdf" }));

    expect(await screen.findByText("catalog.pdf: 카탈로그는 CSV, JSON 파일만 올릴 수 있습니다.")).toBeInTheDocument();
  });

  it("서버의 413 응답도 안내한다", async () => {
    server.use(
      http.post("*/api/v1/projects/:projectId/documents", () => problem(413, "FILE_TOO_LARGE", "파일 크기 초과")),
    );
    const user = userEvent.setup();
    await renderPage();

    await user.click(screen.getByRole("button", { name: "카탈로그 파일 선택" }));
    await user.upload(screen.getByTestId("row-file-input"), new File(["{}"], "catalog.json", { type: "application/json" }));

    expect(await screen.findByText("catalog.json: 파일당 20MB 이하만 올릴 수 있습니다.")).toBeInTheDocument();
  });

  it("끌어다 놓은 파일은 문서 종류를 확인한 뒤 올린다", async () => {
    const user = userEvent.setup();
    await renderPage();

    await user.upload(screen.getByTestId("dropzone-input"), new File(["a,b"], "elements.csv", { type: "text/csv" }));
    const pendingList = await screen.findByRole("list", { name: "올릴 파일" });
    expect(within(pendingList).getByRole("combobox", { name: "문서 종류" })).toHaveValue("CATALOG");
    await user.click(within(pendingList).getByRole("button", { name: "올리기" }));

    await within(screen.getByTestId("document-row-CATALOG")).findByText(/elements\.csv/);
  });

  it("대상 사이트 URL을 바꾸면 저장한 뒤 연결을 확인한다", async () => {
    const user = userEvent.setup();
    await renderPage();

    const input = screen.getByRole("textbox", { name: "대상 사이트 URL" });
    expect(input).toHaveValue("https://shop-mock.skrr.dev");
    expect(screen.getByText("연결 확인")).toBeInTheDocument();
    expect(screen.queryByText(/Playwright/)).not.toBeInTheDocument();
    expect(screen.getByTestId("target-check-result")).toHaveTextContent(/^연결됨 · HTTP 200 · \d{2}:\d{2} 확인$/);

    await user.clear(input);
    await user.type(input, "https://unreachable.skrr.dev{Enter}");
    expect(await screen.findByText("연결 실패")).toBeInTheDocument();
    expect(screen.getByTestId("target-check-result")).toHaveTextContent("연결 시간 초과 (10초)");

    await user.clear(input);
    await user.type(input, "not-a-url{Enter}");
    expect(await screen.findByText("http:// 또는 https://로 시작하는 주소를 입력해 주세요.")).toBeInTheDocument();
  });

  it("4xx 응답도 연결됨으로 보고 상태 코드를 보여 준다 (ADR-019)", async () => {
    const user = userEvent.setup();
    await renderPage();

    const input = screen.getByRole("textbox", { name: "대상 사이트 URL" });
    await user.clear(input);
    await user.type(input, "https://auth.skrr.dev{Enter}");

    await waitFor(() => expect(screen.getByTestId("target-check-result")).toHaveTextContent(/^연결됨 · HTTP 401/));
    expect(screen.getByText("연결 확인")).toBeInTheDocument();
  });

  it("저장된 연결 확인 결과는 새로고침해도 보인다", async () => {
    server.use(
      http.get("*/api/v1/projects/:projectId", ({ params }) =>
        HttpResponse.json({
          id: String(params.projectId),
          name: "목업 쇼핑몰 v1.2",
          targetUrl: "https://shop-mock.skrr.dev",
          targetUrlStatus: "UNREACHABLE",
          targetCheckedAt: "2026-11-10T01:42:00Z",
          targetCheckStatusCode: 503,
          targetCheckMessage: "서버 오류 응답 (HTTP 503)",
          queryApiBaseUrl: null,
          testControlUrl: null,
          createdAt: "2026-11-09T00:00:00Z",
          updatedAt: "2026-11-10T01:42:00Z",
        }),
      ),
    );
    await renderPage();

    const result = await screen.findByTestId("target-check-result");
    expect(result).toHaveTextContent("서버 오류 응답 (HTTP 503)");
    expect(result).toHaveTextContent("HTTP 503");
    expect(screen.getByRole("button", { name: "다시 확인" })).toBeInTheDocument();
  });

  it("실행기 장애(503)는 판정하지 않고 서버 문구를 보여 준다", async () => {
    const user = userEvent.setup();
    await renderPage();

    const input = screen.getByRole("textbox", { name: "대상 사이트 URL" });
    await user.clear(input);
    await user.type(input, "https://runner-down.skrr.dev{Enter}");

    expect(await screen.findByText(/실행기에 연결할 수 없어 확인하지 못했습니다/)).toBeInTheDocument();
    expect(screen.queryByText("연결 실패")).not.toBeInTheDocument();
  });

  it("구축 중 한 문서가 실패하면 실패·건너뜀과 사유, 재구축 안내를 보여 준다 (ADR-020)", async () => {
    const user = userEvent.setup();
    await renderPage();

    await user.click(screen.getByRole("button", { name: "카탈로그 파일 선택" }));
    await user.upload(screen.getByTestId("row-file-input"), new File(["a,b"], "catalog_broken.csv", { type: "text/csv" }));
    const build = screen.getByRole("button", { name: "지식 베이스 구축" });
    await waitFor(() => expect(build).toBeEnabled());
    await user.click(build);

    const catalogRow = screen.getByTestId("document-row-CATALOG");
    await within(catalogRow).findByText("인덱싱 실패", undefined, { timeout: 8000 });
    expect(within(catalogRow).getByText(/DOCUMENT_PARSE_FAILED/)).toBeInTheDocument();
    const reqRow = screen.getByTestId("document-row-REQUIREMENT");
    expect(within(reqRow).getByText("건너뜀")).toBeInTheDocument();
    expect(within(reqRow).getByText(/catalog_broken\.csv 오류로 이번 구축에서 처리하지 않았습니다/)).toBeInTheDocument();
    expect(screen.getByText(/인덱싱 실패·건너뜀 문서는 지식 베이스를 다시 구축하면 다시 처리합니다/)).toBeInTheDocument();
    expect(screen.getByText("구축 실패")).toBeInTheDocument();
    expect(within(screen.getByTestId("document-row-TEST_DATA")).getByText("등록됨")).toBeInTheDocument();
  }, 15000);

  it("409 응답의 missingDocumentTypes로 배너를 바로 그린다", async () => {
    server.use(
      http.get("*/api/v1/projects/:projectId/knowledge-base", ({ params }) =>
        HttpResponse.json({
          projectId: String(params.projectId),
          status: "NOT_BUILT",
          chunkCount: 0,
          requirementCount: 0,
          apiCount: 0,
          uiElementCount: 0,
          lastSyncedAt: null,
          errorMessage: null,
          readiness: [],
          missingDocumentTypes: [],
          canBuild: true,
        }),
      ),
      http.post("*/api/v1/projects/:projectId/knowledge-base/build", () =>
        HttpResponse.json(
          { status: 409, code: "MISSING_REQUIRED_DOCUMENTS", title: "필수 문서 누락", missingDocumentTypes: ["API_SPEC"] },
          { status: 409, headers: { "Content-Type": "application/problem+json" } },
        ),
      ),
    );
    const user = userEvent.setup();
    await renderPage();
    const build = screen.getByRole("button", { name: "지식 베이스 구축" });
    await waitFor(() => expect(build).toBeEnabled());
    await user.click(build);

    const banner = await screen.findByText("필수 문서 1개가 빠져 등록할 수 없습니다");
    expect(banner.parentElement).toHaveTextContent("API 명세서(엔드포인트와 DB 확인용 조회 API)를 추가하면");
  });

  it("문서 목록을 불러오지 못하면 오류와 다시 시도를 보여 준다", async () => {
    server.use(
      http.get("*/api/v1/projects/:projectId/documents", () => problem(500, "INTERNAL_ERROR", "서버 오류", "잠시 후 다시 시도해 주세요.")),
    );
    renderRoute(PATH);
    expect(await screen.findByText("잠시 후 다시 시도해 주세요.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "다시 시도" })).toBeInTheDocument();
  });

  it("사이드바에 현재 사용자와 지식 베이스 상태를 표시한다", async () => {
    await renderPage();
    expect(await screen.findByText("박영서")).toBeInTheDocument();
    expect(screen.getByText("QA 담당자")).toBeInTheDocument();
    expect(await screen.findByText(/청크 1,284개 · \d+분 전 동기화/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "문서 · 지식" })).toHaveAttribute("aria-current", "page");
  });
});
