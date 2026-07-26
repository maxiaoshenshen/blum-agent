export function sanitizeModelText(value: string): string {
  let text = value.replace(/^\uFEFF/, "");

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

  return text.replace(/\n{3,}/g, "\n\n").trim();
}
