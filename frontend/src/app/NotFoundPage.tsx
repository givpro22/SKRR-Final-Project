import { Link } from "react-router-dom";

export function NotFoundPage() {
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-3 p-10 text-center">
      <p className="text-lg font-bold">페이지를 찾을 수 없습니다</p>
      <Link to="/" className="text-[13px] text-accent hover:underline">
        처음 화면으로
      </Link>
    </div>
  );
}
