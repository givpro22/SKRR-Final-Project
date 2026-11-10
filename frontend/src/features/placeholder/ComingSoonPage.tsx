import { PageHeader } from "@/components/PageHeader";
import { useProjectContext } from "@/app/useProjectContext";
import { EmptyBlock } from "@/components/StateViews";

/** 이번 범위(FR-01) 밖의 화면. 다음 작업에서 구현한다. */
export function ComingSoonPage({ title }: { title: string }) {
  const { project } = useProjectContext();
  return (
    <>
      <PageHeader breadcrumb={[project.name, title]} title={title} />
      <div className="mt-8 rounded-card border border-line bg-surface">
        <EmptyBlock>이 화면은 아직 준비 중입니다.</EmptyBlock>
      </div>
    </>
  );
}
