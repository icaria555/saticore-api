import { config } from '../config';
import { logger } from '../utils/logger';

interface OWClientConfig {
  baseUrl: string;
  apiKey: string;
  appId: string;
  appSecret: string;
}

interface OWUser {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  external_user_id: string | null;
}

interface OWTokenResponse {
  access_token: string;
  token_type: string;
  expires_at: string;
}

interface OWTimeSeriesSample {
  timestamp: string;
  type: string;
  value: number;
  unit: string;
  source?: {
    provider: string;
    device?: string;
  };
}

interface OWConnection {
  id: string;
  provider: string;
  status: string;
  last_synced_at: string | null;
}

function getConfig(): OWClientConfig {
  return {
    baseUrl: config.ow.baseUrl,
    apiKey: config.ow.apiKey,
    appId: config.ow.appId,
    appSecret: config.ow.appSecret,
  };
}

function getHeaders(sdkToken?: string): Record<string, string> {
  const owConfig = getConfig();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (sdkToken) {
    headers['Authorization'] = `Bearer ${sdkToken}`;
  }
  if (owConfig.apiKey) {
    headers['X-Open-Wearables-API-Key'] = owConfig.apiKey;
  }
  return headers;
}

async function requestWithRetry<T>(
  url: string,
  options: RequestInit,
  maxAttempts: number = 3,
): Promise<T> {
  const delays = [1000, 2000, 4000];

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const response = await fetch(url, options);

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(
          `OW API error ${response.status}: ${body || response.statusText}`,
        );
      }

      return (await response.json()) as T;
    } catch (error) {
      const isLastAttempt = attempt === maxAttempts - 1;
      if (isLastAttempt) {
        throw error;
      }

      const delay = delays[attempt] ?? 4000;
      logger.warn(`OW API request failed, retrying in ${delay}ms`, {
        attempt: attempt + 1,
        error: error instanceof Error ? error.message : 'Unknown',
      });
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw new Error('Max retry attempts reached');
}

export async function createUser(externalUserId: string): Promise<OWUser> {
  const owConfig = getConfig();
  const url = `${owConfig.baseUrl}/api/v1/users`;

  return requestWithRetry<OWUser>(url, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ external_user_id: externalUserId }),
  });
}

export async function getSdkToken(
  owUserId: string,
): Promise<{ token: string; expiresAt: string }> {
  const owConfig = getConfig();
  const url = `${owConfig.baseUrl}/api/v1/users/${owUserId}/token`;

  const data = await requestWithRetry<OWTokenResponse>(url, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({
      app_id: owConfig.appId,
      app_secret: owConfig.appSecret,
    }),
  });

  return {
    token: data.access_token,
    expiresAt: data.expires_at,
  };
}

export async function refreshTokenIfNeeded(
  owUserId: string,
  currentExpiry: Date | null,
): Promise<{ token: string; expiresAt: string } | null> {
  if (currentExpiry && currentExpiry.getTime() > Date.now() + 60_000) {
    return null;
  }
  return getSdkToken(owUserId);
}

export interface NormalizedHealthSample {
  heartRate: number | null;
  hrv: number | null;
  respiratoryRate: number | null;
  timestamp: string;
}

export async function fetchTimeSeries(
  owUserId: string,
  sdkToken: string,
  startTime: string,
  endTime: string,
  types: string[] = ['heart_rate', 'heart_rate_variability_rmssd', 'respiratory_rate'],
): Promise<NormalizedHealthSample[]> {
  const owConfig = getConfig();
  const params = new URLSearchParams({
    start_time: startTime,
    end_time: endTime,
    resolution: 'raw',
  });
  types.forEach((t) => params.append('types', t));

  const url = `${owConfig.baseUrl}/api/v1/users/${owUserId}/timeseries?${params.toString()}`;

  const data = await requestWithRetry<{
    data: OWTimeSeriesSample[];
  }>(url, {
    method: 'GET',
    headers: getHeaders(sdkToken),
  });

  // Group samples by timestamp and normalize
  const byTimestamp = new Map<string, NormalizedHealthSample>();

  for (const sample of data.data) {
    const existing = byTimestamp.get(sample.timestamp) ?? {
      heartRate: null,
      hrv: null,
      respiratoryRate: null,
      timestamp: sample.timestamp,
    };

    switch (sample.type) {
      case 'heart_rate':
        existing.heartRate = sample.value;
        break;
      case 'heart_rate_variability_rmssd':
        existing.hrv = sample.value;
        break;
      case 'respiratory_rate':
        existing.respiratoryRate = sample.value;
        break;
    }

    byTimestamp.set(sample.timestamp, existing);
  }

  return Array.from(byTimestamp.values()).sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );
}

export async function fetchUserConnections(
  owUserId: string,
  sdkToken: string,
): Promise<OWConnection[]> {
  const owConfig = getConfig();
  const url = `${owConfig.baseUrl}/api/v1/users/${owUserId}/connections`;

  const data = await requestWithRetry<{ data: OWConnection[] }>(url, {
    method: 'GET',
    headers: getHeaders(sdkToken),
  });

  return data.data;
}

export function isConfigured(): boolean {
  const owConfig = getConfig();
  return !!(owConfig.apiKey && owConfig.appId && owConfig.appSecret);
}
