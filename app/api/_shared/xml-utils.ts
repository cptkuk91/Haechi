const DEFAULT_SUCCESS_RESULT_CODES = new Set(['00', 'INFO-000', 'NORMAL_SERVICE']);

function escapeRegexToken(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function decodeXmlEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_m, num) => String.fromCharCode(Number(num)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

export interface ExtractXmlTagValueOptions {
  decodeEntities?: boolean;
  compactWhitespace?: boolean;
  trim?: boolean;
}

export function extractXmlTagValue(
  source: string,
  tag: string,
  options: ExtractXmlTagValueOptions = {}
): string | null {
  const {
    decodeEntities: shouldDecode = false,
    compactWhitespace = false,
    trim = true,
  } = options;

  const escapedTag = escapeRegexToken(tag);
  const match = source.match(new RegExp(`<${escapedTag}>([\\s\\S]*?)<\\/${escapedTag}>`, 'i'));
  if (!match?.[1]) return null;

  let value = match[1];
  if (shouldDecode) {
    value = decodeXmlEntities(value);
  }
  if (compactWhitespace) {
    value = value.replace(/\s+/g, ' ');
  }
  if (trim) {
    value = value.trim();
  }

  return value ? value : null;
}

export function extractXmlItems(source: string, itemTag = 'item'): string[] {
  const escapedTag = escapeRegexToken(itemTag);
  const pattern = new RegExp(`<${escapedTag}>[\\s\\S]*?<\\/${escapedTag}>`, 'gi');
  return source.match(pattern) ?? [];
}

export interface ExtractResultWarningFromXmlOptions {
  sourceLabel: string;
  codeTag?: string;
  messageTag?: string;
  decodeEntities?: boolean;
  compactWhitespace?: boolean;
  successCodes?: ReadonlySet<string>;
}

export function extractResultWarningFromXml(
  source: string,
  options: ExtractResultWarningFromXmlOptions
): string | null {
  const {
    sourceLabel,
    codeTag = 'resultCode',
    messageTag = 'resultMsg',
    decodeEntities,
    compactWhitespace,
    successCodes = DEFAULT_SUCCESS_RESULT_CODES,
  } = options;

  const codeRaw = extractXmlTagValue(source, codeTag, {
    decodeEntities,
    compactWhitespace,
  });
  const code = codeRaw ? codeRaw.trim() : null;
  const message = extractXmlTagValue(source, messageTag, {
    decodeEntities,
    compactWhitespace,
  });

  if (!code || successCodes.has(code)) return null;

  return `${sourceLabel} [${code}] ${message ?? 'Unknown error'}`;
}
