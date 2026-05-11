import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useNotificationStore, useThemeStore } from '@/stores';
import { oauthApi, type OAuthProvider } from '@/services/api/oauth';
import { vertexApi, type VertexImportResponse } from '@/services/api/vertex';
import {
  kiroApi,
  type KiroAuthMethod,
  type KiroTokenImportRequest,
  type KiroTokenInfo,
  type KiroTokenSummary,
  type KiroTokenTestResponse
} from '@/services/api/kiro';
import { copyToClipboard } from '@/utils/clipboard';
import styles from './OAuthPage.module.scss';
import iconCodex from '@/assets/icons/codex.svg';
import iconClaude from '@/assets/icons/claude.svg';
import iconAntigravity from '@/assets/icons/antigravity.svg';
import iconGemini from '@/assets/icons/gemini.svg';
import iconKimiLight from '@/assets/icons/kimi-light.svg';
import iconKimiDark from '@/assets/icons/kimi-dark.svg';
import iconVertex from '@/assets/icons/vertex.svg';

interface ProviderState {
  url?: string;
  state?: string;
  status?: 'idle' | 'waiting' | 'success' | 'error';
  error?: string;
  polling?: boolean;
  projectId?: string;
  projectIdError?: string;
  kiroStartUrl?: string;
  kiroRegion?: string;
  kiroStartUrlError?: string;
  callbackUrl?: string;
  callbackSubmitting?: boolean;
  callbackStatus?: 'success' | 'error';
  callbackError?: string;
}

interface VertexImportResult {
  projectId?: string;
  email?: string;
  location?: string;
  authFile?: string;
}

interface VertexImportState {
  file?: File;
  fileName: string;
  location: string;
  loading: boolean;
  error?: string;
  result?: VertexImportResult;
}

interface KiroFormState {
  email: string;
  accessToken: string;
  refreshToken: string;
  authMethod: KiroAuthMethod;
  provider: string;
  region: string;
  profileArn: string;
  expiresAt: string;
  machineId: string;
  jsonDraft: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (isRecord(error) && typeof error.message === 'string') return error.message;
  return typeof error === 'string' ? error : '';
}

function getErrorStatus(error: unknown): number | undefined {
  if (!isRecord(error)) return undefined;
  return typeof error.status === 'number' ? error.status : undefined;
}

const PROVIDERS: {
  id: OAuthProvider;
  titleKey: string;
  titleDefault?: string;
  hintKey: string;
  hintDefault?: string;
  urlLabelKey: string;
  urlLabelDefault?: string;
  icon?: string | { light: string; dark: string };
  letterIcon?: string;
}[] = [
  { id: 'codex', titleKey: 'auth_login.codex_oauth_title', hintKey: 'auth_login.codex_oauth_hint', urlLabelKey: 'auth_login.codex_oauth_url_label', icon: iconCodex },
  { id: 'anthropic', titleKey: 'auth_login.anthropic_oauth_title', hintKey: 'auth_login.anthropic_oauth_hint', urlLabelKey: 'auth_login.anthropic_oauth_url_label', icon: iconClaude },
  { id: 'antigravity', titleKey: 'auth_login.antigravity_oauth_title', hintKey: 'auth_login.antigravity_oauth_hint', urlLabelKey: 'auth_login.antigravity_oauth_url_label', icon: iconAntigravity },
  { id: 'gemini-cli', titleKey: 'auth_login.gemini_cli_oauth_title', hintKey: 'auth_login.gemini_cli_oauth_hint', urlLabelKey: 'auth_login.gemini_cli_oauth_url_label', icon: iconGemini },
  { id: 'kimi', titleKey: 'auth_login.kimi_oauth_title', hintKey: 'auth_login.kimi_oauth_hint', urlLabelKey: 'auth_login.kimi_oauth_url_label', icon: { light: iconKimiLight, dark: iconKimiDark } },
  {
    id: 'kiro',
    titleKey: 'auth_login.kiro_oauth_title',
    titleDefault: 'Kiro IAM SSO Login',
    hintKey: 'auth_login.kiro_oauth_hint',
    hintDefault: 'Sign in with AWS IAM Identity Center, then paste the callback URL to save a Kiro token.',
    urlLabelKey: 'auth_login.kiro_oauth_url_label',
    urlLabelDefault: 'Kiro authorization URL',
    letterIcon: 'K'
  }
];

const CALLBACK_SUPPORTED: OAuthProvider[] = ['codex', 'anthropic', 'antigravity', 'gemini-cli', 'kiro'];
const SUCCESS_RESET_DELAY_MS = 5000;
const getProviderI18nPrefix = (provider: OAuthProvider) => provider.replace('-', '_');
const getAuthKey = (provider: OAuthProvider, suffix: string) =>
  `auth_login.${getProviderI18nPrefix(provider)}_${suffix}`;
const DEFAULT_KIRO_FORM: KiroFormState = {
  email: '',
  accessToken: '',
  refreshToken: '',
  authMethod: 'social',
  provider: 'google',
  region: 'us-east-1',
  profileArn: '',
  expiresAt: '',
  machineId: '',
  jsonDraft: ''
};

const getIcon = (icon: string | { light: string; dark: string }, theme: 'light' | 'dark') => {
  return typeof icon === 'string' ? icon : icon[theme];
};

const authTextDefault = (provider: OAuthProvider, suffix: string) => {
  if (provider !== 'kiro') return undefined;
  const defaults: Record<string, string> = {
    oauth_button: 'Start Kiro SSO Login',
    copy_link: 'Copy link',
    open_link: 'Open link',
    oauth_start_error: 'Failed to start Kiro SSO login.',
    oauth_status_success: 'Kiro token saved.',
    oauth_status_error: 'Kiro login failed.',
    oauth_status_waiting: 'Waiting for Kiro callback...'
  };
  return defaults[suffix];
};

const authTextOptions = (provider: OAuthProvider, suffix: string) => {
  const defaultValue = authTextDefault(provider, suffix);
  return defaultValue ? { defaultValue } : undefined;
};

const optionalString = (value: string) => {
  const text = value.trim();
  return text ? text : undefined;
};

const normalizeTimestamp = (value: unknown): string => {
  if (value === undefined || value === null || value === '') return '';
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return String(value);
  return String(numeric > 9999999999 ? Math.floor(numeric / 1000) : Math.floor(numeric));
};

const formatTimestamp = (value?: number) => {
  if (!value) return '-';
  const date = new Date(value * 1000);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString();
};

export function OAuthPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { showNotification } = useNotificationStore();
  const showConfirmation = useNotificationStore((state) => state.showConfirmation);
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const [states, setStates] = useState<Record<OAuthProvider, ProviderState>>({} as Record<OAuthProvider, ProviderState>);
  const [vertexState, setVertexState] = useState<VertexImportState>({
    fileName: '',
    location: '',
    loading: false
  });
  const [kiroForm, setKiroForm] = useState<KiroFormState>(DEFAULT_KIRO_FORM);
  const [kiroTokens, setKiroTokens] = useState<KiroTokenSummary[]>([]);
  const [kiroLoading, setKiroLoading] = useState(false);
  const [kiroImporting, setKiroImporting] = useState(false);
  const [kiroActionEmail, setKiroActionEmail] = useState<string | null>(null);
  const [kiroInfo, setKiroInfo] = useState<KiroTokenInfo | null>(null);
  const [kiroTestResult, setKiroTestResult] = useState<KiroTokenTestResponse | null>(null);
  const pollingTimers = useRef<Partial<Record<OAuthProvider, number>>>({});
  const successResetTimers = useRef<Partial<Record<OAuthProvider, number>>>({});
  const vertexFileInputRef = useRef<HTMLInputElement | null>(null);

  const tk = (key: string, defaultValue: string, values?: Record<string, unknown>) =>
    t(`kiro_auth.${key}`, { defaultValue, ...(values ?? {}) });

  const clearTimers = useCallback(() => {
    Object.values(pollingTimers.current).forEach((timer) => {
      if (timer !== undefined) window.clearInterval(timer);
    });
    Object.values(successResetTimers.current).forEach((timer) => {
      if (timer !== undefined) window.clearTimeout(timer);
    });
    pollingTimers.current = {};
    successResetTimers.current = {};
  }, []);

  useEffect(() => {
    return () => {
      clearTimers();
    };
  }, [clearTimers]);

  const loadKiroTokens = useCallback(
    async (silent = false) => {
      setKiroLoading(true);
      try {
        const res = await kiroApi.listTokens();
        setKiroTokens(res.tokens ?? []);
        if (!silent) {
          showNotification(t('kiro_auth.refresh_success', { defaultValue: 'Kiro tokens refreshed' }), 'success');
        }
      } catch (err: unknown) {
        const message = getErrorMessage(err);
        showNotification(
          message
            ? t('kiro_auth.refresh_failed_with_message', {
                defaultValue: 'Failed to load Kiro tokens: {{message}}',
                message
              })
            : t('kiro_auth.refresh_failed', { defaultValue: 'Failed to load Kiro tokens' }),
          'error'
        );
      } finally {
        setKiroLoading(false);
      }
    },
    [showNotification, t]
  );

  useEffect(() => {
    void loadKiroTokens(true);
  }, [loadKiroTokens]);

  const updateProviderState = (provider: OAuthProvider, next: Partial<ProviderState>) => {
    setStates((prev) => ({
      ...prev,
      [provider]: { ...(prev[provider] ?? {}), ...next }
    }));
  };

  const clearPollingTimer = (provider: OAuthProvider) => {
    const timer = pollingTimers.current[provider];
    if (timer !== undefined) {
      window.clearInterval(timer);
      delete pollingTimers.current[provider];
    }
  };

  const clearSuccessResetTimer = (provider: OAuthProvider) => {
    const timer = successResetTimers.current[provider];
    if (timer !== undefined) {
      window.clearTimeout(timer);
      delete successResetTimers.current[provider];
    }
  };

  const clearProviderTimers = (provider: OAuthProvider) => {
    clearPollingTimer(provider);
    clearSuccessResetTimer(provider);
  };

  const resetProviderAttempt = (provider: OAuthProvider) => {
    clearProviderTimers(provider);
    setStates((prev) => {
      const current = prev[provider] ?? {};
      const next: ProviderState = {};
      if (provider === 'gemini-cli' && current.projectId !== undefined) {
        next.projectId = current.projectId;
      }
      if (provider === 'kiro') {
        next.kiroStartUrl = current.kiroStartUrl;
        next.kiroRegion = current.kiroRegion;
      }
      return {
        ...prev,
        [provider]: next
      };
    });
  };

  const completeProviderAuth = (provider: OAuthProvider) => {
    clearPollingTimer(provider);
    clearSuccessResetTimer(provider);
    updateProviderState(provider, {
      url: undefined,
      state: undefined,
      status: 'success',
      error: undefined,
      polling: false,
      callbackUrl: '',
      callbackSubmitting: false,
      callbackStatus: undefined,
      callbackError: undefined
    });
    successResetTimers.current[provider] = window.setTimeout(() => {
      resetProviderAttempt(provider);
    }, SUCCESS_RESET_DELAY_MS);
  };

  const startPolling = (provider: OAuthProvider, state: string) => {
    clearPollingTimer(provider);
    const timer = window.setInterval(async () => {
      try {
        const res = await oauthApi.getAuthStatus(state);
        if (res.status === 'ok') {
          completeProviderAuth(provider);
          showNotification(
            t(getAuthKey(provider, 'oauth_status_success'), authTextOptions(provider, 'oauth_status_success')),
            'success'
          );
        } else if (res.status === 'error') {
          updateProviderState(provider, { status: 'error', error: res.error, polling: false });
          showNotification(
            `${t(getAuthKey(provider, 'oauth_status_error'), authTextOptions(provider, 'oauth_status_error'))} ${res.error || ''}`,
            'error'
          );
          window.clearInterval(timer);
          delete pollingTimers.current[provider];
        }
      } catch (err: unknown) {
        updateProviderState(provider, { status: 'error', error: getErrorMessage(err), polling: false });
        window.clearInterval(timer);
        delete pollingTimers.current[provider];
      }
    }, 3000);
    pollingTimers.current[provider] = timer;
  };

  const startAuth = async (provider: OAuthProvider) => {
    clearProviderTimers(provider);
    const geminiState = provider === 'gemini-cli' ? states[provider] : undefined;
    const kiroState = provider === 'kiro' ? states[provider] : undefined;
    const rawProjectId = provider === 'gemini-cli' ? (geminiState?.projectId || '').trim() : '';
    const projectId = rawProjectId
      ? rawProjectId.toUpperCase() === 'ALL'
        ? 'ALL'
        : rawProjectId
      : undefined;
    const kiroStartUrl = provider === 'kiro' ? (kiroState?.kiroStartUrl || '').trim() : '';
    const kiroRegion = provider === 'kiro' ? (kiroState?.kiroRegion || 'us-east-1').trim() : undefined;
    // Project ID is optional: blank selects the first available project; ALL fetches every project.
    if (provider === 'gemini-cli') {
      updateProviderState(provider, { projectIdError: undefined });
    }
    if (provider === 'kiro') {
      if (!kiroStartUrl) {
        updateProviderState(provider, {
          kiroStartUrlError: t('auth_login.kiro_start_url_required', {
            defaultValue: 'SSO Start URL is required'
          })
        });
        return;
      }
      updateProviderState(provider, { kiroStartUrlError: undefined });
    }
    updateProviderState(provider, {
      url: undefined,
      state: undefined,
      status: 'waiting',
      polling: true,
      error: undefined,
      callbackStatus: undefined,
      callbackError: undefined,
      callbackUrl: ''
    });
    try {
      const res = await oauthApi.startAuth(
        provider,
        provider === 'gemini-cli'
          ? { projectId: projectId || undefined }
          : provider === 'kiro'
            ? { startUrl: kiroStartUrl, region: kiroRegion || undefined }
            : undefined
      );
      if (!res.state) {
        const message = t('auth_login.missing_state');
        updateProviderState(provider, {
          url: res.url,
          state: undefined,
          status: 'error',
          error: message,
          polling: false
        });
        showNotification(message, 'error');
        return;
      }
      updateProviderState(provider, { url: res.url, state: res.state, status: 'waiting', polling: true });
      startPolling(provider, res.state);
    } catch (err: unknown) {
      const message = getErrorMessage(err);
      updateProviderState(provider, { status: 'error', error: message, polling: false });
      showNotification(
        `${t(getAuthKey(provider, 'oauth_start_error'), {
          defaultValue: authTextDefault(provider, 'oauth_start_error')
        })}${message ? ` ${message}` : ''}`,
        'error'
      );
    }
  };

  const copyLink = async (url?: string) => {
    if (!url) return;
    const copied = await copyToClipboard(url);
    showNotification(
      t(copied ? 'notification.link_copied' : 'notification.copy_failed'),
      copied ? 'success' : 'error'
    );
  };

  const submitCallback = async (provider: OAuthProvider) => {
    const redirectUrl = (states[provider]?.callbackUrl || '').trim();
    if (!redirectUrl) {
      showNotification(t('auth_login.oauth_callback_required'), 'warning');
      return;
    }
    updateProviderState(provider, {
      callbackSubmitting: true,
      callbackStatus: undefined,
      callbackError: undefined
    });
    try {
      await oauthApi.submitCallback(provider, redirectUrl);
      updateProviderState(provider, { callbackSubmitting: false, callbackStatus: 'success' });
      showNotification(t('auth_login.oauth_callback_success'), 'success');
    } catch (err: unknown) {
      const status = getErrorStatus(err);
      const message = getErrorMessage(err);
      const errorMessage =
        status === 404
          ? t('auth_login.oauth_callback_upgrade_hint', {
              defaultValue: 'Please update CLI Proxy API or check the connection.'
            })
          : message || undefined;
      updateProviderState(provider, {
        callbackSubmitting: false,
        callbackStatus: 'error',
        callbackError: errorMessage
      });
      const notificationMessage = errorMessage
        ? `${t('auth_login.oauth_callback_error')} ${errorMessage}`
        : t('auth_login.oauth_callback_error');
      showNotification(notificationMessage, 'error');
    }
  };

  const handleVertexFilePick = () => {
    vertexFileInputRef.current?.click();
  };

  const handleVertexFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.name.endsWith('.json')) {
      showNotification(t('vertex_import.file_required'), 'warning');
      event.target.value = '';
      return;
    }
    setVertexState((prev) => ({
      ...prev,
      file,
      fileName: file.name,
      error: undefined,
      result: undefined
    }));
    event.target.value = '';
  };

  const handleVertexImport = async () => {
    if (!vertexState.file) {
      const message = t('vertex_import.file_required');
      setVertexState((prev) => ({ ...prev, error: message }));
      showNotification(message, 'warning');
      return;
    }
    const location = vertexState.location.trim();
    setVertexState((prev) => ({ ...prev, loading: true, error: undefined, result: undefined }));
    try {
      const res: VertexImportResponse = await vertexApi.importCredential(
        vertexState.file,
        location || undefined
      );
      const result: VertexImportResult = {
        projectId: res.project_id,
        email: res.email,
        location: res.location,
        authFile: res['auth-file'] ?? res.auth_file
      };
      setVertexState((prev) => ({ ...prev, loading: false, result }));
      showNotification(t('vertex_import.success'), 'success');
    } catch (err: unknown) {
      const message = getErrorMessage(err);
      setVertexState((prev) => ({
        ...prev,
        loading: false,
        error: message || t('notification.upload_failed')
      }));
      const notification = message
        ? `${t('notification.upload_failed')}: ${message}`
        : t('notification.upload_failed');
      showNotification(notification, 'error');
    }
  };

  const updateKiroForm = <K extends keyof KiroFormState>(key: K, value: KiroFormState[K]) => {
    setKiroForm((prev) => ({ ...prev, [key]: value }));
  };

  const parseKiroJsonDraft = () => {
    if (!kiroForm.jsonDraft.trim()) {
      showNotification(tk('json_required', 'Paste a Kiro token JSON payload first'), 'warning');
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(kiroForm.jsonDraft);
    } catch {
      showNotification(tk('json_invalid', 'Kiro token JSON is invalid'), 'error');
      return;
    }

    const source = isRecord(parsed) && isRecord(parsed.token) ? parsed.token : parsed;
    if (!isRecord(source)) {
      showNotification(tk('json_invalid_object', 'Kiro token JSON must be an object'), 'error');
      return;
    }

    const readString = (...keys: string[]) => {
      for (const key of keys) {
        const value = source[key];
        if (typeof value === 'string' && value.trim()) return value;
        if (typeof value === 'number' && Number.isFinite(value)) return String(value);
      }
      return '';
    };

    const authMethod = readString('auth_method', 'authMethod');
    setKiroForm((prev) => ({
      ...prev,
      email: readString('email', 'username', 'user') || prev.email,
      accessToken: readString('access_token', 'accessToken') || prev.accessToken,
      refreshToken: readString('refresh_token', 'refreshToken') || prev.refreshToken,
      authMethod: authMethod === 'idc' ? 'idc' : 'social',
      provider: readString('provider') || prev.provider,
      region: readString('region') || prev.region,
      profileArn: readString('profile_arn', 'profileArn') || prev.profileArn,
      expiresAt: normalizeTimestamp(readString('expires_at', 'expiresAt', 'expires')) || prev.expiresAt,
      machineId: readString('machine_id', 'machineId') || prev.machineId
    }));
    showNotification(tk('json_applied', 'Kiro JSON fields applied'), 'success');
  };

  const buildKiroPayload = (): KiroTokenImportRequest | null => {
    const email = kiroForm.email.trim();
    const accessToken = kiroForm.accessToken.trim();
    const region = kiroForm.region.trim();
    if (!email || !accessToken || !region) {
      showNotification(tk('required_fields', 'Email, access token, and region are required'), 'warning');
      return null;
    }

    let expiresAt: number | undefined;
    if (kiroForm.expiresAt.trim()) {
      const parsed = Number(kiroForm.expiresAt.trim());
      if (!Number.isFinite(parsed) || parsed <= 0) {
        showNotification(tk('expires_invalid', 'Expires At must be a Unix timestamp in seconds'), 'warning');
        return null;
      }
      expiresAt = Math.floor(parsed > 9999999999 ? parsed / 1000 : parsed);
    }

    return {
      email,
      access_token: accessToken,
      refresh_token: optionalString(kiroForm.refreshToken),
      auth_method: kiroForm.authMethod,
      provider: optionalString(kiroForm.provider),
      region,
      profile_arn: optionalString(kiroForm.profileArn),
      expires_at: expiresAt,
      machine_id: optionalString(kiroForm.machineId)
    };
  };

  const importKiroToken = async () => {
    const payload = buildKiroPayload();
    if (!payload) return;

    setKiroImporting(true);
    try {
      await kiroApi.importToken(payload);
      setKiroForm((prev) => ({
        ...DEFAULT_KIRO_FORM,
        jsonDraft: prev.jsonDraft
      }));
      setKiroInfo(null);
      setKiroTestResult(null);
      await loadKiroTokens(true);
      showNotification(tk('import_success', 'Kiro token imported successfully'), 'success');
    } catch (err: unknown) {
      const message = getErrorMessage(err);
      showNotification(
        message
          ? tk('import_failed_with_message', 'Failed to import Kiro token: {{message}}', { message })
          : tk('import_failed', 'Failed to import Kiro token'),
        'error'
      );
    } finally {
      setKiroImporting(false);
    }
  };

  const showKiroInfo = async (email: string) => {
    setKiroActionEmail(email);
    try {
      const info = await kiroApi.getTokenInfo(email);
      setKiroInfo(info);
      setKiroTestResult(null);
    } catch (err: unknown) {
      const message = getErrorMessage(err);
      showNotification(
        message
          ? tk('info_failed_with_message', 'Failed to load Kiro token details: {{message}}', { message })
          : tk('info_failed', 'Failed to load Kiro token details'),
        'error'
      );
    } finally {
      setKiroActionEmail(null);
    }
  };

  const testKiroToken = async (email: string) => {
    setKiroActionEmail(email);
    try {
      const result = await kiroApi.testToken(email);
      setKiroTestResult(result);
      showNotification(tk('test_success', 'Kiro token structure is valid'), 'success');
    } catch (err: unknown) {
      const message = getErrorMessage(err);
      showNotification(
        message
          ? tk('test_failed_with_message', 'Kiro token test failed: {{message}}', { message })
          : tk('test_failed', 'Kiro token test failed'),
        'error'
      );
    } finally {
      setKiroActionEmail(null);
    }
  };

  const deleteKiroToken = (email: string) => {
    showConfirmation({
      title: tk('delete_title', 'Delete Kiro token'),
      message: tk('delete_confirm', 'Delete Kiro token for {{email}}?', { email }),
      confirmText: t('common.delete'),
      variant: 'danger',
      onConfirm: async () => {
        await kiroApi.deleteToken(email);
        if (kiroInfo?.email === email) setKiroInfo(null);
        if (kiroTestResult?.email === email) setKiroTestResult(null);
        await loadKiroTokens(true);
        showNotification(tk('delete_success', 'Kiro token deleted'), 'success');
      }
    });
  };

  return (
    <div className={styles.container}>
      <h1 className={styles.pageTitle}>{t('nav.oauth', { defaultValue: 'OAuth' })}</h1>

      <div className={styles.content}>
        {PROVIDERS.map((provider) => {
          const state = states[provider.id] || {};
          const canSubmitCallback = CALLBACK_SUPPORTED.includes(provider.id) && Boolean(state.url);
          const loginButtonLabel =
            state.status === 'success'
              ? t('auth_login.login_another_account')
              : t(getAuthKey(provider.id, 'oauth_button'), authTextOptions(provider.id, 'oauth_button'));
          const statusBadgeClassName = [
            'status-badge',
            state.status === 'success' ? 'success' : '',
            state.status === 'error' ? 'error' : ''
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <div key={provider.id}>
              <Card
                title={
                  <span className={styles.cardTitle}>
                    {provider.icon ? (
                      <img
                        src={getIcon(provider.icon, resolvedTheme)}
                        alt=""
                        className={styles.cardTitleIcon}
                      />
                    ) : (
                      <span className={styles.kiroIcon} aria-hidden="true">
                        {provider.letterIcon}
                      </span>
                    )}
                    {t(provider.titleKey, { defaultValue: provider.titleDefault })}
                  </span>
                }
                extra={
                  <Button onClick={() => startAuth(provider.id)} loading={state.polling}>
                    {loginButtonLabel}
                  </Button>
                }
              >
                <div className={styles.cardContent}>
                  <div className={styles.cardHint}>{t(provider.hintKey, { defaultValue: provider.hintDefault })}</div>
                  {provider.id === 'gemini-cli' && (
                    <div className={styles.geminiProjectField}>
                      <Input
                        label={t('auth_login.gemini_cli_project_id_label')}
                        hint={t('auth_login.gemini_cli_project_id_hint')}
                        value={state.projectId || ''}
                        error={state.projectIdError}
                        disabled={Boolean(state.polling)}
                        onChange={(e) =>
                          updateProviderState(provider.id, {
                            projectId: e.target.value,
                            projectIdError: undefined
                          })
                        }
                        placeholder={t('auth_login.gemini_cli_project_id_placeholder')}
                      />
                    </div>
                  )}
                  {provider.id === 'kiro' && (
                    <div className={styles.kiroOAuthGrid}>
                      <Input
                        label={t('auth_login.kiro_start_url_label', {
                          defaultValue: 'SSO Start URL'
                        })}
                        hint={t('auth_login.kiro_start_url_hint', {
                          defaultValue: 'Use your AWS IAM Identity Center start URL.'
                        })}
                        value={state.kiroStartUrl || ''}
                        error={state.kiroStartUrlError}
                        disabled={Boolean(state.polling)}
                        onChange={(e) =>
                          updateProviderState(provider.id, {
                            kiroStartUrl: e.target.value,
                            kiroStartUrlError: undefined
                          })
                        }
                        placeholder="https://my-org.awsapps.com/start"
                      />
                      <Input
                        label={t('auth_login.kiro_region_label', {
                          defaultValue: 'Region'
                        })}
                        value={state.kiroRegion || 'us-east-1'}
                        disabled={Boolean(state.polling)}
                        onChange={(e) =>
                          updateProviderState(provider.id, {
                            kiroRegion: e.target.value
                          })
                        }
                        placeholder="us-east-1"
                      />
                    </div>
                  )}
                  {state.url && (
                    <div className={styles.authUrlBox}>
                      <div className={styles.authUrlLabel}>
                        {t(provider.urlLabelKey, { defaultValue: provider.urlLabelDefault })}
                      </div>
                      <div className={styles.authUrlValue}>{state.url}</div>
                      <div className={styles.authUrlActions}>
                        <Button variant="secondary" size="sm" onClick={() => copyLink(state.url!)}>
                          {t(getAuthKey(provider.id, 'copy_link'), authTextOptions(provider.id, 'copy_link'))}
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => window.open(state.url, '_blank', 'noopener,noreferrer')}
                        >
                          {t(getAuthKey(provider.id, 'open_link'), authTextOptions(provider.id, 'open_link'))}
                        </Button>
                      </div>
                    </div>
                  )}
                  {canSubmitCallback && (
                    <div className={styles.callbackSection}>
                      <Input
                        label={t('auth_login.oauth_callback_label')}
                        hint={t('auth_login.oauth_callback_hint')}
                        value={state.callbackUrl || ''}
                        onChange={(e) =>
                          updateProviderState(provider.id, {
                            callbackUrl: e.target.value,
                            callbackStatus: undefined,
                            callbackError: undefined
                          })
                        }
                        placeholder={t('auth_login.oauth_callback_placeholder')}
                      />
                      <div className={styles.callbackActions}>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => submitCallback(provider.id)}
                          loading={state.callbackSubmitting}
                        >
                          {t('auth_login.oauth_callback_button')}
                        </Button>
                      </div>
                      {state.callbackStatus === 'success' && state.status === 'waiting' && (
                        <div className="status-badge success">
                          {t('auth_login.oauth_callback_status_success')}
                        </div>
                      )}
                      {state.callbackStatus === 'error' && (
                        <div className="status-badge error">
                          {t('auth_login.oauth_callback_status_error')} {state.callbackError || ''}
                        </div>
                      )}
                    </div>
                  )}
                  {state.status && state.status !== 'idle' && (
                    <div className={statusBadgeClassName}>
                      {state.status === 'success'
                        ? t(getAuthKey(provider.id, 'oauth_status_success'), authTextOptions(provider.id, 'oauth_status_success'))
                        : state.status === 'error'
                          ? `${t(getAuthKey(provider.id, 'oauth_status_error'), authTextOptions(provider.id, 'oauth_status_error'))} ${state.error || ''}`
                          : t(getAuthKey(provider.id, 'oauth_status_waiting'), authTextOptions(provider.id, 'oauth_status_waiting'))}
                    </div>
                  )}
                  {state.status === 'success' && (
                    <div className={styles.successActions}>
                      <Button variant="secondary" size="sm" onClick={() => navigate('/auth-files')}>
                        {t('auth_login.view_auth_files')}
                      </Button>
                    </div>
                  )}
                </div>
              </Card>
            </div>
          );
        })}

        <Card
          title={
            <span className={styles.cardTitle}>
              <span className={styles.kiroIcon} aria-hidden="true">
                K
              </span>
              {tk('title', 'Kiro Token Login')}
            </span>
          }
          extra={
            <div className={styles.cardActions}>
              <Button variant="secondary" onClick={() => loadKiroTokens()} loading={kiroLoading}>
                {t('common.refresh')}
              </Button>
              <Button onClick={importKiroToken} loading={kiroImporting}>
                {tk('import_button', 'Import Kiro Token')}
              </Button>
            </div>
          }
        >
          <div className={styles.cardContent}>
            <div className={styles.cardHint}>
              {tk(
                'description',
                'Import Kiro access credentials into auth-dir/kiro-<email>.json for the Kiro executor.'
              )}
            </div>

            <div className={styles.kiroFormGrid}>
              <Input
                label={tk('email_label', 'Email')}
                value={kiroForm.email}
                onChange={(e) => updateKiroForm('email', e.target.value)}
                placeholder={tk('email_placeholder', 'user@example.com')}
              />
              <div className={styles.formItem}>
                <label className={styles.formItemLabel}>{tk('auth_method_label', 'Auth Method')}</label>
                <select
                  className="input"
                  value={kiroForm.authMethod}
                  onChange={(e) => updateKiroForm('authMethod', e.target.value as KiroAuthMethod)}
                >
                  <option value="social">{tk('auth_method_social', 'social')}</option>
                  <option value="idc">{tk('auth_method_idc', 'idc')}</option>
                </select>
              </div>
              <Input
                label={tk('provider_label', 'Provider')}
                value={kiroForm.provider}
                onChange={(e) => updateKiroForm('provider', e.target.value)}
                placeholder="google"
              />
              <Input
                label={tk('region_label', 'Region')}
                value={kiroForm.region}
                onChange={(e) => updateKiroForm('region', e.target.value)}
                placeholder="us-east-1"
              />
              <Input
                label={tk('profile_arn_label', 'Profile ARN (optional)')}
                value={kiroForm.profileArn}
                onChange={(e) => updateKiroForm('profileArn', e.target.value)}
                placeholder="arn:aws:..."
              />
              <Input
                label={tk('expires_at_label', 'Expires At (optional)')}
                hint={tk('expires_at_hint', 'Unix timestamp in seconds. Milliseconds are converted automatically.')}
                value={kiroForm.expiresAt}
                onChange={(e) => updateKiroForm('expiresAt', e.target.value)}
                placeholder="1735689600"
                inputMode="numeric"
              />
              <Input
                label={tk('machine_id_label', 'Machine ID (optional)')}
                value={kiroForm.machineId}
                onChange={(e) => updateKiroForm('machineId', e.target.value)}
                placeholder="a1b2c3d4e5f6g7h8"
              />
            </div>

            <div className={styles.kiroSecretGrid}>
              <div className={styles.formItem}>
                <label className={styles.formItemLabel}>{tk('access_token_label', 'Access Token')}</label>
                <textarea
                  className={`input ${styles.tokenTextarea}`}
                  value={kiroForm.accessToken}
                  onChange={(e) => updateKiroForm('accessToken', e.target.value)}
                  placeholder="eyJ..."
                />
              </div>
              <div className={styles.formItem}>
                <label className={styles.formItemLabel}>{tk('refresh_token_label', 'Refresh Token (optional)')}</label>
                <textarea
                  className={`input ${styles.tokenTextarea}`}
                  value={kiroForm.refreshToken}
                  onChange={(e) => updateKiroForm('refreshToken', e.target.value)}
                  placeholder={tk('refresh_token_placeholder', 'Paste refresh token if available')}
                />
              </div>
            </div>

            <div className={styles.formItem}>
              <label className={styles.formItemLabel}>{tk('json_label', 'Token JSON Helper')}</label>
              <textarea
                className={`input ${styles.jsonTextarea}`}
                value={kiroForm.jsonDraft}
                onChange={(e) => updateKiroForm('jsonDraft', e.target.value)}
                placeholder={tk('json_placeholder', 'Paste exported Kiro token JSON, then apply it to the form')}
              />
              <div className={styles.cardHintSecondary}>
                {tk('json_hint', 'Accepts snake_case or camelCase fields such as access_token/accessToken.')}
              </div>
              <div className={styles.inlineActions}>
                <Button variant="secondary" size="sm" onClick={parseKiroJsonDraft}>
                  {tk('json_apply', 'Apply JSON')}
                </Button>
              </div>
            </div>

            <div className={styles.kiroTokenHeader}>
              <div className={styles.connectionLabel}>
                {tk('saved_tokens', 'Saved Kiro Tokens')} ({kiroTokens.length})
              </div>
            </div>
            {kiroLoading && <div className="status-badge">{t('common.loading')}</div>}
            {!kiroLoading && kiroTokens.length === 0 && (
              <div className={styles.cardHintSecondary}>{tk('empty_tokens', 'No Kiro tokens saved yet.')}</div>
            )}
            {kiroTokens.length > 0 && (
              <div className={styles.kiroTokenList}>
                {kiroTokens.map((token) => (
                  <div key={token.email} className={styles.kiroTokenItem}>
                    <div className={styles.kiroTokenMain}>
                      <div>
                        <div className={styles.kiroTokenEmail}>{token.email}</div>
                        <div className={styles.kiroTokenMeta}>
                          {token.auth_method} / {token.provider || '-'} / {token.region}
                        </div>
                      </div>
                      <div className={styles.kiroBadges}>
                        {token.is_expired && <span className="status-badge error">{tk('expired', 'Expired')}</span>}
                        {!token.is_expired && token.needs_refresh && (
                          <span className="status-badge">{tk('needs_refresh', 'Needs refresh')}</span>
                        )}
                        {!token.is_expired && !token.needs_refresh && (
                          <span className="status-badge success">{tk('usable', 'Usable')}</span>
                        )}
                      </div>
                    </div>
                    <div className={styles.keyValueList}>
                      <div className={styles.keyValueItem}>
                        <span className={styles.keyValueKey}>{tk('expires_at_short', 'Expires')}</span>
                        <span className={styles.keyValueValue}>{formatTimestamp(token.expires_at)}</span>
                      </div>
                      <div className={styles.keyValueItem}>
                        <span className={styles.keyValueKey}>{tk('updated_at_short', 'Updated')}</span>
                        <span className={styles.keyValueValue}>{formatTimestamp(token.updated_at)}</span>
                      </div>
                    </div>
                    <div className={styles.inlineActions}>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => showKiroInfo(token.email)}
                        loading={kiroActionEmail === token.email}
                      >
                        {tk('details_button', 'Details')}
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => testKiroToken(token.email)}
                        loading={kiroActionEmail === token.email}
                      >
                        {tk('test_button', 'Test')}
                      </Button>
                      <Button variant="danger" size="sm" onClick={() => deleteKiroToken(token.email)}>
                        {t('common.delete')}
                      </Button>
                    </div>

                    {kiroInfo?.email === token.email && (
                      <div className={styles.connectionBox}>
                        <div className={styles.connectionLabel}>{tk('details_title', 'Token details')}</div>
                        <div className={styles.keyValueList}>
                          <div className={styles.keyValueItem}>
                            <span className={styles.keyValueKey}>{tk('profile_arn_short', 'Profile ARN')}</span>
                            <span className={styles.keyValueValue}>{kiroInfo.profile_arn || '-'}</span>
                          </div>
                          <div className={styles.keyValueItem}>
                            <span className={styles.keyValueKey}>{tk('has_refresh_token', 'Refresh token')}</span>
                            <span className={styles.keyValueValue}>
                              {kiroInfo.has_refresh_token ? t('common.yes') : t('common.no')}
                            </span>
                          </div>
                          <div className={styles.keyValueItem}>
                            <span className={styles.keyValueKey}>{tk('created_at_short', 'Created')}</span>
                            <span className={styles.keyValueValue}>{formatTimestamp(kiroInfo.created_at)}</span>
                          </div>
                        </div>
                      </div>
                    )}

                    {kiroTestResult?.email === token.email && (
                      <div className="status-badge success">
                        {kiroTestResult.message || tk('test_success', 'Kiro token structure is valid')}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>

        <Card
          title={
            <span className={styles.cardTitle}>
              <img src={iconVertex} alt="" className={styles.cardTitleIcon} />
              {t('vertex_import.title')}
            </span>
          }
          extra={
            <Button onClick={handleVertexImport} loading={vertexState.loading}>
              {t('vertex_import.import_button')}
            </Button>
          }
        >
          <div className={styles.cardContent}>
            <div className={styles.cardHint}>{t('vertex_import.description')}</div>
            <Input
              label={t('vertex_import.location_label')}
              hint={t('vertex_import.location_hint')}
              value={vertexState.location}
              onChange={(e) =>
                setVertexState((prev) => ({
                  ...prev,
                  location: e.target.value
                }))
              }
              placeholder={t('vertex_import.location_placeholder')}
            />
            <div className={styles.formItem}>
              <label className={styles.formItemLabel}>{t('vertex_import.file_label')}</label>
              <div className={styles.filePicker}>
                <Button variant="secondary" size="sm" onClick={handleVertexFilePick}>
                  {t('vertex_import.choose_file')}
                </Button>
                <div
                  className={`${styles.fileName} ${
                    vertexState.fileName ? '' : styles.fileNamePlaceholder
                  }`.trim()}
                >
                  {vertexState.fileName || t('vertex_import.file_placeholder')}
                </div>
              </div>
              <div className={styles.cardHintSecondary}>{t('vertex_import.file_hint')}</div>
              <input
                ref={vertexFileInputRef}
                type="file"
                accept=".json,application/json"
                style={{ display: 'none' }}
                onChange={handleVertexFileChange}
              />
            </div>
            {vertexState.error && (
              <div className="status-badge error">
                {vertexState.error}
              </div>
            )}
            {vertexState.result && (
              <div className={styles.connectionBox}>
                <div className={styles.connectionLabel}>{t('vertex_import.result_title')}</div>
                <div className={styles.keyValueList}>
                  {vertexState.result.projectId && (
                    <div className={styles.keyValueItem}>
                      <span className={styles.keyValueKey}>{t('vertex_import.result_project')}</span>
                      <span className={styles.keyValueValue}>{vertexState.result.projectId}</span>
                    </div>
                  )}
                  {vertexState.result.email && (
                    <div className={styles.keyValueItem}>
                      <span className={styles.keyValueKey}>{t('vertex_import.result_email')}</span>
                      <span className={styles.keyValueValue}>{vertexState.result.email}</span>
                    </div>
                  )}
                  {vertexState.result.location && (
                    <div className={styles.keyValueItem}>
                      <span className={styles.keyValueKey}>{t('vertex_import.result_location')}</span>
                      <span className={styles.keyValueValue}>{vertexState.result.location}</span>
                    </div>
                  )}
                  {vertexState.result.authFile && (
                    <div className={styles.keyValueItem}>
                      <span className={styles.keyValueKey}>{t('vertex_import.result_file')}</span>
                      <span className={styles.keyValueValue}>{vertexState.result.authFile}</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
