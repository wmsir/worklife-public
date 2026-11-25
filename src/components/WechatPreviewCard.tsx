import { Fragment, type ReactNode } from "react";

function renderInlineSegments(text: string): ReactNode[] {
  const tokenRe =
    /(<font\s+color=["'](info|warning|comment)["']>([\s\S]*?)<\/font>|\*\*([\s\S]+?)\*\*|`([^`]+?)`)/g;
  const nodes: ReactNode[] = [];
  let lastIdx = 0;
  let m: RegExpExecArray | null;
  let keyIdx = 0;

  while ((m = tokenRe.exec(text)) !== null) {
    if (m.index > lastIdx) {
      nodes.push(text.slice(lastIdx, m.index));
    }
    if (m[2] !== undefined) {
      const color = m[2];
      const cls =
        color === "info"
          ? "font-medium text-emerald-600"
          : color === "warning"
            ? "font-medium text-amber-600"
            : "text-gray-400";
      nodes.push(
        <span key={`f-${keyIdx++}`} className={cls}>
          {renderInlineSegments(m[3] || "")}
        </span>,
      );
    } else if (m[4] !== undefined) {
      nodes.push(
        <strong key={`b-${keyIdx++}`} className="font-semibold text-gray-900">
          {m[4]}
        </strong>,
      );
    } else if (m[5] !== undefined) {
      nodes.push(
        <code
          key={`c-${keyIdx++}`}
          className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[11px] text-slate-700"
        >
          {m[5]}
        </code>,
      );
    }
    lastIdx = tokenRe.lastIndex;
  }

  if (lastIdx < text.length) {
    nodes.push(text.slice(lastIdx));
  }
  return nodes;
}

export function WechatPreviewCard({ content }: { content: string }) {
  const lines = content.split(/\r?\n/);

  return (
    <div className="rounded-xl border border-emerald-200/80 bg-gradient-to-br from-emerald-50/40 via-white to-slate-50/70 p-3 text-xs leading-relaxed text-gray-700 shadow-2xs">
      <div className="space-y-1">
        {lines.map((raw, idx) => {
          const line = raw;
          if (!line.trim()) {
            return <div key={idx} className="h-1.5" />;
          }
          if (line.startsWith("### ")) {
            return (
              <div key={idx} className="text-[13px] font-bold text-gray-900">
                {renderInlineSegments(line.slice(4))}
              </div>
            );
          }
          if (line.startsWith("> ")) {
            return (
              <div
                key={idx}
                className="border-l-2 border-emerald-400 bg-emerald-50/50 py-0.5 pl-2 text-[11px] text-gray-700"
              >
                {renderInlineSegments(line.slice(2))}
              </div>
            );
          }
          if (/^[*•-]\s+/.test(line.trimStart())) {
            const stripped = line.replace(/^\s*[*•-]\s+/, "");
            return (
              <div key={idx} className="flex items-start gap-1.5 pl-1">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-gray-400" />
                <span className="min-w-0 flex-1 break-words">
                  {renderInlineSegments(stripped)}
                </span>
              </div>
            );
          }
          return (
            <Fragment key={idx}>
              <div className="break-words whitespace-pre-wrap">
                {renderInlineSegments(line)}
              </div>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}
