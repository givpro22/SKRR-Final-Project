import clsx from "clsx";
import { Loader } from "lucide-react";

export function Spinner({ className }: { className?: string }) {
  return <Loader aria-hidden className={clsx("size-3.5 animate-spin", className)} />;
}
