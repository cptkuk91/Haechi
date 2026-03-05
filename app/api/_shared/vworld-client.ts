import { isFeatureCollection, isValidPointFeature } from '@/app/api/_shared/geojson-utils';
import { toPositiveInt } from '@/app/api/_shared/parse-primitives';

const VWORLD_ENDPOINT = 'https://api.vworld.kr/req/data';

interface VWorldError {
  code?: string;
  text?: string;
}

interface VWorldResponsePayload {
  response?: {
    status?: string;
    page?: {
      total?: string | number;
      current?: string | number;
      size?: string | number;
    };
    result?: {
      featureCollection?: GeoJSON.FeatureCollection;
    };
    error?: VWorldError;
  };
}

export interface VWorldPageFetchResult {
  features: GeoJSON.Feature[];
  totalPages: number;
  warning?: string;
}

export interface FetchVWorldFeaturePageArgs {
  dataset: string;
  key: string;
  page: number;
  pageSize: number;
  geomFilter: string;
  warningLabel: string;
  domain?: string;
  attrFilter?: string;
  pointOnly?: boolean;
  sanitizeFeature?: (feature: GeoJSON.Feature, index: number) => GeoJSON.Feature;
}

export async function fetchVWorldFeaturePage(
  args: FetchVWorldFeaturePageArgs
): Promise<VWorldPageFetchResult> {
  const url = new URL(VWORLD_ENDPOINT);
  url.searchParams.set('service', 'data');
  url.searchParams.set('version', '2.0');
  url.searchParams.set('request', 'GetFeature');
  url.searchParams.set('key', args.key);
  url.searchParams.set('format', 'json');
  url.searchParams.set('errorFormat', 'json');
  url.searchParams.set('size', String(args.pageSize));
  url.searchParams.set('page', String(args.page));
  url.searchParams.set('data', args.dataset);
  url.searchParams.set('geomFilter', args.geomFilter);
  url.searchParams.set('geometry', 'true');
  url.searchParams.set('attribute', 'true');
  url.searchParams.set('crs', 'EPSG:4326');

  if (args.domain) url.searchParams.set('domain', args.domain);
  if (args.attrFilter) url.searchParams.set('attrFilter', args.attrFilter);

  const response = await fetch(url.toString(), {
    method: 'GET',
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    return {
      features: [],
      totalPages: 1,
      warning: `${args.warningLabel} upstream responded ${response.status}`,
    };
  }

  const raw = (await response.json()) as VWorldResponsePayload;
  const status = raw.response?.status ?? 'ERROR';
  if (status === 'ERROR') {
    const error = raw.response?.error;
    const code = error?.code ?? 'UNKNOWN_ERROR';
    const text = error?.text ?? 'VWorld API error';
    return {
      features: [],
      totalPages: 1,
      warning: `${args.warningLabel} error [${code}] ${text}`,
    };
  }

  if (status === 'NOT_FOUND') {
    return {
      features: [],
      totalPages: 1,
    };
  }

  const featureCollection = raw.response?.result?.featureCollection;
  if (!isFeatureCollection(featureCollection)) {
    return {
      features: [],
      totalPages: 1,
      warning: `${args.warningLabel} response missing featureCollection`,
    };
  }

  const totalPages = toPositiveInt(raw.response?.page?.total, 1);

  const sourceFeatures = args.pointOnly
    ? featureCollection.features.filter((feature): feature is GeoJSON.Feature => isValidPointFeature(feature))
    : featureCollection.features;

  const sanitizeFeature = args.sanitizeFeature ?? ((feature: GeoJSON.Feature) => feature);

  return {
    features: sourceFeatures.map((feature, index) => sanitizeFeature(feature, index)),
    totalPages,
  };
}
