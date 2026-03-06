export type JsonRecord = Record<string, unknown>;

const DEFAULT_SUCCESS_RESULT_CODES = new Set(['00', 'INFO-000', 'NORMAL_SERVICE']);

export function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function compactText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function toPositiveInt(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return Math.floor(value);
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
  }
  return fallback;
}

export function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.floor(value)));
}

export function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export function toArray(value: unknown): JsonRecord[] {
  if (Array.isArray(value)) {
    return value.filter((row): row is JsonRecord => isRecord(row));
  }
  if (isRecord(value)) {
    return [value];
  }
  return [];
}

export function pickString(
  row: JsonRecord,
  keys: string[],
  normalizer: (value: string) => string = compactText
): string | null {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === 'string') {
      const normalized = normalizer(value);
      if (normalized) return normalized;
    }
  }
  return null;
}

export function pickNumber(row: JsonRecord, keys: string[]): number | null {
  for (const key of keys) {
    const value = toNumber(row[key]);
    if (value !== null) return value;
  }
  return null;
}

export function extractRowsFromCommonJson(raw: unknown): JsonRecord[] {
  if (Array.isArray(raw)) return toArray(raw);
  if (!isRecord(raw)) return [];

  const dataRows = toArray(raw.data);
  if (dataRows.length > 0) return dataRows;

  const listRows = toArray(raw.list);
  if (listRows.length > 0) return listRows;

  const response = isRecord(raw.response) ? raw.response : null;
  const bodyCandidates = [
    response && isRecord(response.body) ? response.body : null,
    isRecord(raw.body) ? raw.body : null,
  ].filter((candidate): candidate is JsonRecord => Boolean(candidate));

  for (const body of bodyCandidates) {
    for (const items of [body.items, body.Items]) {
      if (isRecord(items)) {
        const itemRows = toArray(items.item);
        if (itemRows.length > 0) return itemRows;

        const upperItemRows = toArray(items.Item);
        if (upperItemRows.length > 0) return upperItemRows;
      }

      const bodyRows = toArray(items);
      if (bodyRows.length > 0) return bodyRows;
    }

    const nestedDataRows = toArray(body.data);
    if (nestedDataRows.length > 0) return nestedDataRows;

    const nestedListRows = toArray(body.list);
    if (nestedListRows.length > 0) return nestedListRows;
  }

  for (const rawItems of [raw.items, raw.Items]) {
    if (isRecord(rawItems)) {
      const rawItemRows = toArray(rawItems.item);
      if (rawItemRows.length > 0) return rawItemRows;

      const upperRawItemRows = toArray(rawItems.Item);
      if (upperRawItemRows.length > 0) return upperRawItemRows;
    }

    const rawRows = toArray(rawItems);
    if (rawRows.length > 0) return rawRows;
  }

  const itemRows = toArray(raw.item);
  if (itemRows.length > 0) return itemRows;

  const upperItemRows = toArray(raw.Item);
  if (upperItemRows.length > 0) return upperItemRows;

  return [];
}

export function extractTotalCountFromCommonJson(raw: unknown): number | null {
  if (!isRecord(raw)) return null;

  const response = isRecord(raw.response) ? raw.response : null;
  const responseBody = response && isRecord(response.body) ? response.body : null;
  const topLevelBody = isRecord(raw.body) ? raw.body : null;

  const candidates: unknown[] = [
    responseBody?.totalCount,
    topLevelBody?.totalCount,
    raw.totalCount,
    raw.count,
    response?.count,
  ];

  for (const candidate of candidates) {
    const parsed = toPositiveInt(candidate, 0);
    if (parsed > 0) return parsed;
  }

  return null;
}

export function extractResultWarningFromCommonJson(
  raw: unknown,
  sourceLabel: string,
  successCodes: ReadonlySet<string> = DEFAULT_SUCCESS_RESULT_CODES
): string | null {
  if (!isRecord(raw)) return null;

  const response = isRecord(raw.response) ? raw.response : null;
  const header = (
    (response && isRecord(response.header) ? response.header : null)
    ?? (isRecord(raw.header) ? raw.header : null)
  );

  const codeRaw = typeof header?.resultCode === 'string' ? header.resultCode : null;
  const code = codeRaw ? codeRaw.trim() : null;
  const message = typeof header?.resultMsg === 'string' ? header.resultMsg.trim() : null;

  if (!code || successCodes.has(code)) return null;

  return `${sourceLabel} [${code}] ${message || 'Unknown error'}`;
}
