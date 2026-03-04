import { MongoClient } from 'mongodb';

const MONGODB_URL = process.env.MONGODB_URL;

if (!MONGODB_URL) {
  throw new Error('MONGODB_URL 환경변수가 설정되지 않았습니다.');
}

declare global {
  // eslint-disable-next-line no-var
  var __mongoClientPromise: Promise<MongoClient> | undefined;
}

const client = new MongoClient(MONGODB_URL);
const clientPromise: Promise<MongoClient> =
  globalThis.__mongoClientPromise ?? (globalThis.__mongoClientPromise = client.connect());

export default clientPromise;
