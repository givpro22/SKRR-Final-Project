import { screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { MOCK_PROJECT_ID } from "@/mocks/db";
import { server } from "@/mocks/server";
import { renderRoute } from "@/test/render";

describe("라우팅", () => {
  it("첫 화면은 첫 프로젝트의 문서 등록으로 보낸다", async () => {
    const { router } = renderRoute("/");
    await waitFor(() => expect(router.state.location.pathname).toBe(`/projects/${MOCK_PROJECT_ID}/documents`));
  });

  it("프로젝트가 없으면 만들기 화면을 보여 준다", async () => {
    server.use(http.get("*/api/v1/projects", () => HttpResponse.json({ items: [] })));
    renderRoute("/");
    expect(await screen.findByRole("heading", { name: "첫 프로젝트 만들기" })).toBeInTheDocument();
  });

  it("없는 프로젝트는 안내한다", async () => {
    renderRoute("/projects/00000000-0000-4000-8000-000000000000/documents");
    expect(await screen.findByText("프로젝트를 찾을 수 없습니다.")).toBeInTheDocument();
  });
});
