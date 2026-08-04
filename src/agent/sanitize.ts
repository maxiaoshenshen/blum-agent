export function sanitizeModelText(value: string): string {
  let text = value.replace(/^\uFEFF/, "");
  let removedUnsafeContent = false;

  text = text.replace(
    /<(think|analysis)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,
    "",
  );
  text = text.replace(/<(think|analysis)\b[^>]*>[\s\S]*$/gi, "");
  text = text.replace(/<\/?(?:think|analysis)\b[^>]*>/gi, "");
  text = text.trim();

  const fenced = text.match(
    /^```(?:markdown|md|text)?[ \t]*\n?([\s\S]*?)\n?```$/,
  );
  if (fenced) text = fenced[1].trim();

  text = text.replace(
    /<(?:script|style|iframe|object|embed|svg|math)\b[^>]*>[\s\S]*?<\/\s*(?:script|style|iframe|object|embed|svg|math)\s*>/gi,
    () => {
      removedUnsafeContent = true;
      return "";
    },
  );
  text = text.replace(
    /<\/?(?:script|style|iframe|object|embed|svg|math|img|link|meta|base|form|input|button|video|audio)\b[^>]*>/gi,
    () => {
      removedUnsafeContent = true;
      return "";
    },
  );
  text = text.replace(
    /\b(?:javascript|vbscript|data\s*:\s*text\/html)\s*:[^\s<]*/gi,
    () => {
      removedUnsafeContent = true;
      return "";
    },
  );
  text = text.replace(/\n{3,}/g, "\n\n").trim();

  return removedUnsafeContent
    ? `${text}${text ? " " : ""}[已过滤不安全内容]`.trim()
    : text;
}
