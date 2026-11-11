import clsx from "clsx";
import {
  ChevronsUpDown,
  CirclePlay,
  FileChartColumn,
  FolderOpen,
  ListChecks,
  ScanLine,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useKnowledgeBase } from "@/api/queries/knowledgeBase";
import { useCurrentUser, useProjects } from "@/api/queries/projects";
import type { KnowledgeBaseStatus } from "@/api/types";
import { formatNumber, formatRelative } from "@/lib/format";

interface NavItem {
  label: string;
  icon: LucideIcon;
  /** 프로젝트 아래 경로. 없으면 요청·실행을 고른 뒤에 열 수 있는 화면이다. */
  to?: string;
  /** 활성으로 보일 경로 (예: requests/:id/scenarios도 시나리오 승인) */
  match?: RegExp;
}

const navItems: NavItem[] = [
  { label: "문서 · 지식", icon: FolderOpen, to: "documents", match: /\/documents$/ },
  { label: "테스트 요청", icon: Sparkles, to: "requests", match: /\/requests$/ },
  { label: "시나리오 승인", icon: ListChecks, to: "scenarios", match: /\/scenarios$/ },
  { label: "실행 모니터", icon: CirclePlay, to: "monitor", match: /\/monitor$/ },
  { label: "리포트", icon: FileChartColumn, to: "report", match: /\/report$/ },
];

const kbDotClass: Record<KnowledgeBaseStatus, string> = {
  READY: "bg-success",
  BUILDING: "bg-accent animate-pulse",
  STALE: "bg-warning",
  FAILED: "bg-danger",
  NOT_BUILT: "bg-muted",
};

export function Sidebar({ projectId }: { projectId: string }) {
  const { pathname } = useLocation();
  return (
    <aside className="sticky top-0 flex h-screen w-62 shrink-0 flex-col border-r border-line bg-surface px-4 pt-6 pb-5">
      <div className="flex items-center gap-3 px-2">
        <span className="flex size-[30px] items-center justify-center rounded-lg bg-ink text-surface">
          <ScanLine aria-hidden className="size-4" />
        </span>
        <div>
          <p className="text-[15px] leading-tight font-bold">SKRR</p>
          <p className="font-mono text-[11px] text-muted">AI QA Studio</p>
        </div>
      </div>

      <ProjectSelect projectId={projectId} />

      <nav aria-label="주요 메뉴" className="mt-6 flex flex-col gap-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const inner = (
            <>
              <Icon aria-hidden className="size-4" strokeWidth={1.75} />
              {item.label}
            </>
          );
          if (!item.to) {
            return (
              <span
                key={item.label}
                aria-disabled="true"
                title="실행이 끝나면 열 수 있습니다"
                className="flex h-[38px] cursor-not-allowed items-center gap-3 rounded-xl px-3 text-sm text-muted"
              >
                {inner}
              </span>
            );
          }
          const active = item.match?.test(pathname) ?? false;
          return (
            <Link
              key={item.label}
              to={`/projects/${projectId}/${item.to}`}
              aria-current={active ? "page" : undefined}
              className={clsx(
                "flex h-[38px] items-center gap-3 rounded-xl px-3 text-sm transition-colors",
                active ? "bg-accent-soft font-semibold text-accent" : "text-ink/80 hover:bg-page",
              )}
            >
              {inner}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto flex flex-col gap-4">
        <KnowledgeBaseCard projectId={projectId} />
        <CurrentUser />
      </div>
    </aside>
  );
}

function ProjectSelect({ projectId }: { projectId: string }) {
  const projects = useProjects();
  const navigate = useNavigate();
  const current = projects.data?.find((p) => p.id === projectId);

  return (
    <label className="relative mt-8 block rounded-xl border border-line-strong/50 bg-field px-3 py-2.5 focus-within:border-focus">
      <span className="block text-[10px] text-muted">프로젝트</span>
      <span className="mt-0.5 block truncate pr-6 text-[13px] font-bold">
        {current?.name ?? (projects.isPending ? "불러오는 중" : "프로젝트 선택")}
      </span>
      <ChevronsUpDown aria-hidden className="absolute top-1/2 right-3 size-3.5 -translate-y-1/2 text-muted" />
      <select
        aria-label="프로젝트 선택"
        className="absolute inset-0 cursor-pointer opacity-0"
        value={projectId}
        disabled={!projects.data}
        onChange={(event) => navigate(`/projects/${event.target.value}/documents`)}
      >
        {projects.data?.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function KnowledgeBaseCard({ projectId }: { projectId: string }) {
  const kb = useKnowledgeBase(projectId);
  let detail = "불러오는 중";
  if (kb.isError) detail = "상태를 불러오지 못했습니다";
  if (kb.data) {
    const synced = kb.data.lastSyncedAt ? `${formatRelative(kb.data.lastSyncedAt)} 동기화` : "아직 구축하지 않음";
    detail = kb.data.status === "BUILDING" ? "구축 중" : `청크 ${formatNumber(kb.data.chunkCount)}개 · ${synced}`;
  }
  return (
    <div className="rounded-xl bg-page px-3.5 py-3.5">
      <p className="text-xs font-semibold">RAG 지식 베이스</p>
      <p className="mt-2 flex items-center gap-2 text-[11px] text-muted">
        <span aria-hidden className={clsx("size-1.5 rounded-full", kb.data ? kbDotClass[kb.data.status] : "bg-muted")} />
        {detail}
      </p>
    </div>
  );
}

function CurrentUser() {
  const me = useCurrentUser();
  if (!me.data) {
    return <div className="h-10 px-2 text-[11px] text-muted">{me.isError ? "사용자 정보를 불러오지 못했습니다" : ""}</div>;
  }
  return (
    <div className="flex items-center gap-3 px-2">
      <span className="flex size-[30px] items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent">
        {me.data.displayName.slice(0, 1)}
      </span>
      <div className="min-w-0">
        <p className="truncate text-[13px] font-semibold">{me.data.displayName}</p>
        <p className="truncate text-[11px] text-muted">{me.data.roleLabel}</p>
      </div>
    </div>
  );
}
