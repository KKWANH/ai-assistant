import { Cpu } from "lucide-react";
import { Tooltip } from "./Tooltip";

export interface TokenEstimateProps {
  tokens: number;
  label?: string;
  className?: string;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toString();
}

export function TokenEstimate({
  tokens,
  label = "est. tokens",
  className = "",
}: TokenEstimateProps) {
  return (
    <Tooltip content={`${tokens.toLocaleString()} tokens (estimated)`}>
      <span
        className={[
          "inline-flex items-center gap-1 text-xs font-mono text-muted-foreground",
          className,
        ].join(" ")}
        aria-label={`${tokens.toLocaleString()} ${label}`}
      >
        <Cpu className="h-3 w-3 shrink-0" aria-hidden="true" />
        {formatTokens(tokens)}
      </span>
    </Tooltip>
  );
}
