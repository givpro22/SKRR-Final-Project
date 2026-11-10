/** 2.4MB, 820KB 형식 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)}KB`;
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)}MB`;
}

const timeFormatter = new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });

/** 10:42 형식 (사용자 시간대) */
export function formatClock(iso: string): string {
  return timeFormatter.format(new Date(iso));
}

const numberFormatter = new Intl.NumberFormat("ko-KR");

export function formatNumber(value: number): string {
  return numberFormatter.format(value);
}

/** 3분 전, 방금 전 형식 */
export function formatRelative(iso: string, now: Date = new Date()): string {
  const diffSec = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 1000));
  if (diffSec < 60) return "방금 전";
  const min = Math.floor(diffSec / 60);
  if (min < 60) return `${min}분 전`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour}시간 전`;
  return `${Math.floor(hour / 24)}일 전`;
}
