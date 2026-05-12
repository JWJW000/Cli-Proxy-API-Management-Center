import { apiClient } from './client';

export type KiroAuthMethod = 'social' | 'idc';

export interface KiroTokenImportRequest {
  email: string;
  access_token: string;
  refresh_token?: string;
  auth_method: KiroAuthMethod;
  provider?: string;
  region: string;
  start_url?: string;
  client_id?: string;
  client_secret?: string;
  profile_arn?: string;
  expires_at?: number;
  machine_id?: string;
}

export interface KiroTokenSummary {
  email: string;
  auth_method: KiroAuthMethod;
  provider?: string;
  region: string;
  start_url?: string;
  expires_at?: number;
  is_expired?: boolean;
  needs_refresh?: boolean;
  created_at?: number;
  updated_at?: number;
}

export interface KiroTokenInfo extends KiroTokenSummary {
  profile_arn?: string;
  has_refresh_token?: boolean;
}

export interface KiroTokenListResponse {
  tokens?: KiroTokenSummary[];
  count?: number;
}

export interface KiroTokenImportResponse {
  message?: string;
  email: string;
  auth_method: KiroAuthMethod;
  region: string;
}

export interface KiroTokenTestResponse {
  message?: string;
  email: string;
  model?: string;
  model_tested?: boolean;
  is_expired?: boolean;
  needs_refresh?: boolean;
  response_preview?: string;
}

export interface KiroModelDefinition {
  id: string;
  display_name?: string;
  type?: string;
  owned_by?: string;
}

export const kiroApi = {
  importToken: (payload: KiroTokenImportRequest) =>
    apiClient.post<KiroTokenImportResponse>('/auth/kiro/import', payload),

  listTokens: () => apiClient.get<KiroTokenListResponse>('/auth/kiro/list'),

  getTokenInfo: (email: string) =>
    apiClient.get<KiroTokenInfo>('/auth/kiro/info', {
      params: { email }
    }),

  listModels: async () => {
    const data = await apiClient.get<Record<string, unknown>>('/model-definitions/kiro');
    const models = data.models ?? data['models'];
    return Array.isArray(models) ? (models as KiroModelDefinition[]) : [];
  },

  testToken: (email: string, model?: string) =>
    apiClient.post<KiroTokenTestResponse>('/auth/kiro/test', {
      email,
      ...(model ? { model } : {})
    }),

  deleteToken: (email: string) =>
    apiClient.delete<{ message?: string; email: string }>('/auth/kiro/delete', {
      params: { email }
    })
};
