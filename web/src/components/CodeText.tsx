import { useMemo } from "react";
import { tones, type syntaxOf } from "../data/tone";

/** A line of code with its comments muted and strings dimmed. */
export function CodeText({
  text,
  syntax,
  className = "code-text",
}: {
  text: string;
  syntax: ReturnType<typeof syntaxOf>;
  className?: string;
}) {
  const pieces = useMemo(() => tones(text, syntax), [text, syntax]);
  return (
    <span className={className}>
      {pieces.map((p, i) => (p.tone === "code" ? p.text : <span key={i} className={`tone-${p.tone}`}>{p.text}</span>))}
    </span>
  );
}
