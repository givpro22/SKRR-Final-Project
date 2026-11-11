import { ImageOff } from "lucide-react";
import { useArtifactLink } from "@/api/queries/runs";
import { Spinner } from "@/components/Spinner";

/** 현재 화면: 단계가 끝날 때마다 백엔드가 실행기에서 가져온 스크린샷 (events.md "현재 화면의 동작") */
export function CurrentScreen({ artifactId, path }: { artifactId: string | null; path: string | null }) {
  const link = useArtifactLink(artifactId);
  return (
    <section aria-labelledby="current-screen-title" className="overflow-hidden rounded-card border border-line bg-surface">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 id="current-screen-title" className="text-[13px] font-bold">
          현재 화면
        </h2>
        {path && <span className="font-mono text-xs text-muted">{path}</span>}
      </div>
      <div className="flex aspect-[16/10] items-center justify-center bg-page">
        {!artifactId ? (
          <p className="flex flex-col items-center gap-2 text-xs text-muted">
            <ImageOff aria-hidden className="size-5" />
            아직 찍힌 화면이 없습니다
          </p>
        ) : link.isPending ? (
          <Spinner className="size-5 text-muted" />
        ) : link.isError || !link.data ? (
          <p className="text-xs text-danger">화면을 불러오지 못했습니다</p>
        ) : (
          <img src={link.data.url} alt={`현재 화면 ${path ?? ""}`} className="size-full object-contain object-top" />
        )}
      </div>
    </section>
  );
}
