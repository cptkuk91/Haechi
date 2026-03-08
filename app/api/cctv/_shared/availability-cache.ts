import type { Collection, Document } from 'mongodb';

const DB_NAME = 'haechi';
const COLLECTION_NAME = 'cctv_utic_availability';
const HIDE_DURATION_MS = 6 * 60 * 60 * 1000;
const FAILURE_HIDE_THRESHOLD = 1;

interface CctvAvailabilityDocument extends Document {
  uticId: string;
  playable: boolean;
  failCount: number;
  hiddenUntil: Date | null;
  lastCheckedAt: Date;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
  lastError: string | null;
  updatedAt: Date;
}

const memoryStore = new Map<string, CctvAvailabilityDocument>();
let mongoWarningLogged = false;

function logMongoWarning(message: string) {
  if (mongoWarningLogged) return;
  mongoWarningLogged = true;
  console.warn(`[CCTV:availability] ${message}`);
}

async function getAvailabilityCollection(): Promise<Collection<CctvAvailabilityDocument> | null> {
  if (!process.env.MONGODB_URL) {
    return null;
  }

  try {
    const mongodbModule = await import('@/lib/mongodb');
    const client = await mongodbModule.default;
    return client.db(DB_NAME).collection<CctvAvailabilityDocument>(COLLECTION_NAME);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    logMongoWarning(`Mongo collection unavailable: ${message}`);
    return null;
  }
}

function cloneDoc(doc: CctvAvailabilityDocument): CctvAvailabilityDocument {
  return {
    ...doc,
    hiddenUntil: doc.hiddenUntil ? new Date(doc.hiddenUntil) : null,
    lastCheckedAt: new Date(doc.lastCheckedAt),
    lastSuccessAt: doc.lastSuccessAt ? new Date(doc.lastSuccessAt) : null,
    lastFailureAt: doc.lastFailureAt ? new Date(doc.lastFailureAt) : null,
    updatedAt: new Date(doc.updatedAt),
  };
}

function applyAvailabilityUpdate(args: {
  current: CctvAvailabilityDocument | null;
  uticId: string;
  playable: boolean;
  reason: string | null;
  now: Date;
}): CctvAvailabilityDocument {
  const base: CctvAvailabilityDocument = args.current
    ? cloneDoc(args.current)
    : {
        uticId: args.uticId,
        playable: false,
        failCount: 0,
        hiddenUntil: null,
        lastCheckedAt: args.now,
        lastSuccessAt: null,
        lastFailureAt: null,
        lastError: null,
        updatedAt: args.now,
      };

  if (args.playable) {
    return {
      ...base,
      uticId: args.uticId,
      playable: true,
      failCount: 0,
      hiddenUntil: null,
      lastCheckedAt: args.now,
      lastSuccessAt: args.now,
      lastError: null,
      updatedAt: args.now,
    };
  }

  const nextFailCount = (base.failCount ?? 0) + 1;
  return {
    ...base,
    uticId: args.uticId,
    playable: false,
    failCount: nextFailCount,
    hiddenUntil:
      nextFailCount >= FAILURE_HIDE_THRESHOLD
        ? new Date(args.now.getTime() + HIDE_DURATION_MS)
        : null,
    lastCheckedAt: args.now,
    lastFailureAt: args.now,
    lastError: args.reason,
    updatedAt: args.now,
  };
}

export async function listHiddenUticIds(now = new Date()): Promise<Set<string>> {
  const collection = await getAvailabilityCollection();
  if (collection) {
    try {
      const docs = await collection
        .find({
          playable: false,
          hiddenUntil: { $gt: now },
        })
        .project({ uticId: 1 })
        .toArray();
      return new Set(
        docs
          .map((doc) => (typeof doc.uticId === 'string' ? doc.uticId.trim() : ''))
          .filter(Boolean)
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      logMongoWarning(`Failed to read hidden CCTV ids: ${message}`);
    }
  }

  const hidden = new Set<string>();
  for (const [uticId, doc] of memoryStore.entries()) {
    if (!doc.hiddenUntil) continue;
    if (doc.hiddenUntil.getTime() <= now.getTime()) continue;
    if (doc.playable) continue;
    hidden.add(uticId);
  }
  return hidden;
}

export async function markUticAvailability(args: {
  uticId: string;
  playable: boolean;
  reason?: string | null;
}): Promise<void> {
  const uticId = args.uticId.trim();
  if (!uticId) return;

  const now = new Date();
  const reason = typeof args.reason === 'string' && args.reason.trim() ? args.reason.trim() : null;
  const collection = await getAvailabilityCollection();

  if (collection) {
    try {
      const current = await collection.findOne({ uticId });
      const next = applyAvailabilityUpdate({
        current,
        uticId,
        playable: args.playable,
        reason,
        now,
      });
      await collection.updateOne(
        { uticId },
        {
          $set: {
            playable: next.playable,
            failCount: next.failCount,
            hiddenUntil: next.hiddenUntil,
            lastCheckedAt: next.lastCheckedAt,
            lastSuccessAt: next.lastSuccessAt,
            lastFailureAt: next.lastFailureAt,
            lastError: next.lastError,
            updatedAt: next.updatedAt,
          },
        },
        { upsert: true }
      );
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      logMongoWarning(`Failed to write CCTV availability: ${message}`);
    }
  }

  const current = memoryStore.get(uticId) ?? null;
  const next = applyAvailabilityUpdate({
    current,
    uticId,
    playable: args.playable,
    reason,
    now,
  });
  memoryStore.set(uticId, next);
}
