export type OAuthProvider = 'google' | 'github';

export const oauthProviders: Array<{ provider: OAuthProvider; label: string }> = [
  { provider: 'google', label: 'Google' },
  { provider: 'github', label: 'GitHub' },
];

export function getOAuthStartPath(provider: OAuthProvider): string {
  return `/api/auth/oauth/${provider}/start`;
}

export function getOAuthErrorMessage(code: string | null): string {
  switch (code) {
    case 'callback_failed':
      return 'OAuth callback failed. Try again.';
    case 'oauth_failed':
      return 'Could not complete OAuth sign-in. Try again.';
    case 'email_required':
      return 'OAuth account must include an email address.';
    case 'oauth_disabled':
      return 'OAuth is not enabled for this environment.';
    default:
      return '';
  }
}
