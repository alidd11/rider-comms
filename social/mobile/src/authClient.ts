/**
 * Shared Rider Comms account API client for the separately installed Social app.
 * No local user table, password cache, guest identity, token in URL, or token logging.
 */
export const RIDER_API_ORIGIN = 'https://backend-production-7fa0.up.railway.app';
export const SOCIAL_TERMS_URL = 'https://alidd11.github.io/rider-comms/terms.html';
export const SOCIAL_GUIDELINES_URL = 'https://alidd11.github.io/rider-comms/guidelines.html';
export const RESET_SENT_TEXT = "If that email has an account, we've sent a reset link.";

export interface AccountIdentity {
  riderId: string;
  username: string;
  emailVerified: boolean;
  termsAccepted: boolean;
  termsVersion: string;
}
export interface LoginReply {
  riderId: string;
  token: string;
  emailVerified: boolean;
  termsAccepted: boolean;
}
export interface TokenStorage {
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
  clear(): Promise<void>;
}
export interface SharedFriend {
  riderId?: string;
  id?: string;
  handle?: string;
  displayName?: string;
}
export interface SharedConversation {
  withRiderId?: string;
  riderId?: string;
  lastMessage?: string;
  unreadCount?: number;
}
export class AccountApiError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(status: number, code: string) {
    super(code);
    this.name = 'AccountApiError';
    this.code = code;
    this.status = status;
  }
}
export function accountErrorMessage(error: unknown): string {
  if (!(error instanceof AccountApiError)) return 'Could not connect to Rider Comms. Check your connection and try again.';
  const messages: Record<string, string> = {
    invalid_credentials: 'Username or password is incorrect.',
    account_suspended: 'This account is suspended. Contact Rider Comms support.',
    username_taken: 'That username is already registered.',
    email_taken: 'That email is already registered.',
    invalid_username: 'Choose a different username.',
    invalid_email: 'Enter a valid email address.',
    weak_password: 'Choose a stronger password.',
    objectionable_username: 'That username is not allowed.',
    terms_not_accepted: 'Please accept the Terms and Community Guidelines.',
    invalid_terms_version: 'The Terms have changed. Review the latest version and try again.',
    terms_version_mismatch: 'The Terms have changed. Review the latest version and try again.',
    not_verified: 'Verify your email before using this feature.',
    full_account_required: 'Sign in to a full Rider Comms account to use Social.',
  };
  if (error.status === 429) return 'Too many attempts. Try again in a few minutes.';
  if (error.status === 401) return 'Your session has ended. Sign in again.';
  if (error.status === 403) return messages[error.code] ?? 'Verify your email to message riders.';
  return messages[error.code] ?? 'Could not complete this request. Try again.';
}
type Fetcher = (url: string, init: RequestInit) => Promise<Response>;
type RawIdentity = Partial<AccountIdentity> & { username?: unknown };
const isAccount = (raw: RawIdentity): raw is AccountIdentity =>
  typeof raw.riderId === 'string' && raw.riderId.length > 0 &&
  typeof raw.username === 'string' && raw.username.trim().length > 0 &&
  typeof raw.emailVerified === 'boolean' &&
  typeof raw.termsAccepted === 'boolean' &&
  typeof raw.termsVersion === 'string' && raw.termsVersion.length > 0;

export class RiderAccountClient {
  private token: string | null = null;
  private user: AccountIdentity | null = null;
  private onExpired: (() => void) | null = null;
  constructor(
    private readonly storage: TokenStorage,
    private readonly transport: Fetcher = (url, init) => fetch(url, init),
    private readonly origin: string = RIDER_API_ORIGIN,
  ) {}
  get identity(): AccountIdentity | null { return this.user; }
  setSessionExpiredHandler(handler: (() => void) | null) { this.onExpired = handler; }
  private async clear(): Promise<void> {
    this.token = null;
    this.user = null;
    try { await this.storage.clear(); } finally { this.onExpired?.(); }
  }
  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown, required = false): Promise<T> {
    if (required && !this.token) throw new AccountApiError(401, 'not_signed_in');
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (required) headers.Authorization = 'Bearer ' + this.token;
    // Redirects are disabled to prevent forwarding an Authorization header.
    const response = await this.transport(this.origin + path, {
      method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      credentials: 'omit', cache: 'no-store', redirect: 'error',
    });
    if (response.status === 401 && required) await this.clear();
    if (!response.ok) {
      let code = 'request_failed';
      try {
        const parsed = await response.json() as { error?: unknown };
        if (typeof parsed?.error === 'string') code = parsed.error;
      } catch { /* A non-JSON error is still a failed request. */ }
      throw new AccountApiError(response.status, code);
    }
    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  }
  private async readIdentity(): Promise<AccountIdentity> {
    const raw = await this.request<RawIdentity>('GET', '/auth/me', undefined, true);
    if (!isAccount(raw)) {
      await this.clear();
      throw new AccountApiError(401, 'full_account_required');
    }
    this.user = raw;
    return raw;
  }
  /** On cold launch only a validated, non-guest /auth/me account may enter Social. */
  async restore(): Promise<AccountIdentity | null> {
    const existing = await this.storage.read();
    if (!existing) return null;
    this.token = existing;
    try { return await this.readIdentity(); }
    catch (error) {
      if (error instanceof AccountApiError && error.status === 401) return null;
      throw error; // Temporary outage: don't erase a valid session.
    }
  }
  private async commitSession(session: LoginReply): Promise<AccountIdentity> {
    if (typeof session?.token !== 'string' || !session.token ||
        typeof session.riderId !== 'string' || !session.riderId) {
      throw new AccountApiError(502, 'invalid_session_response');
    }
    this.token = session.token;
    try {
      const identity = await this.readIdentity();
      if (identity.riderId !== session.riderId) throw new AccountApiError(502, 'identity_mismatch');
      await this.storage.write(session.token);
      return identity;
    } catch (error) {
      await this.clear();
      throw error;
    }
  }
  async login(username: string, password: string, deviceName: string): Promise<AccountIdentity> {
    const session = await this.request<LoginReply>('POST', '/auth/login', { username: username.trim(), password, deviceName });
    return this.commitSession(session);
  }
  async signup(username: string, email: string, password: string, deviceName: string, accepted: boolean): Promise<AccountIdentity> {
    if (!accepted) throw new AccountApiError(400, 'terms_not_accepted');
    const session = await this.request<LoginReply>('POST', '/auth/signup', {
      username: username.trim(), email: email.trim(), password, deviceName, acceptTerms: true,
    });
    return this.commitSession(session);
  }
  async acceptTerms(version: string): Promise<AccountIdentity> {
    if (!version || this.user?.termsVersion !== version) throw new AccountApiError(409, 'invalid_terms_version');
    await this.request('POST', '/auth/accept-terms', { version }, true);
    return this.readIdentity();
  }
  async resendVerification(): Promise<void> {
    await this.request('POST', '/auth/resend-verification', {}, true);
  }
  async requestPasswordReset(email: string): Promise<void> {
    await this.request('POST', '/auth/password-reset/request', { email: email.trim() });
  }
  async logout(): Promise<void> {
    try {
      if (this.token) await this.request('POST', '/auth/logout', {}, true);
    } finally { await this.clear(); }
  }
  async friends(): Promise<{ friends: SharedFriend[]; nextCursor?: string | null }> {
    const riderId = this.user?.riderId;
    if (!riderId) throw new AccountApiError(401, 'not_signed_in');
    return this.request('GET', '/riders/' + encodeURIComponent(riderId) + '/friends?limit=50', undefined, true);
  }
  async conversations(): Promise<{ conversations: SharedConversation[]; nextCursor?: string | null }> {
    return this.request('GET', '/conversations?limit=50', undefined, true);
  }
}
