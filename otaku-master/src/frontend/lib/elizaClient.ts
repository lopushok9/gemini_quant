import { ElizaClient } from '@elizaos/api-client';

export const elizaClient = ElizaClient.create({
  baseUrl: window.location.origin,
  timeout: 30000,
  headers: {
    'Accept': 'application/json',
  },
  apiKey: localStorage.getItem('eliza-api-key') || undefined,
});

export function updateApiKey(newKey: string | null) {
  if (newKey) {
    localStorage.setItem('eliza-api-key', newKey);
  } else {
    localStorage.removeItem('eliza-api-key');
  }
}

