import { Check, Eye, Loader, RotateCcw, ShieldAlert, X, type LucideIcon } from "lucide-react";
import type { ScenarioStatus } from "@/api/types";
import { Badge } from "@/components/Badge";
import { scenarioStatusView } from "./labels";

const icon: Record<ScenarioStatus, LucideIcon> = {
  APPROVED: Check,
  REVIEW_REQUIRED: Eye,
  GUARD_RETRY: RotateCcw,
  GENERATING: Loader,
  REJECTED: X,
  GUARD_FAILED: ShieldAlert,
};

export function ScenarioStatusBadge({ status }: { status: ScenarioStatus }) {
  const view = scenarioStatusView[status];
  const Icon = icon[status];
  return (
    <Badge tone={view.tone} icon={<Icon aria-hidden className={status === "GENERATING" ? "size-3 animate-spin" : "size-3"} />}>
      {view.label}
    </Badge>
  );
}
