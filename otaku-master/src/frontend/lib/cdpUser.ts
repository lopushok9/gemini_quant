// Utilities for extracting normalized user info from CDP currentUser

export interface CdpAuthMethod {
  email?: string;
  name?: string;
}

export interface CdpSmsMethod {
  phoneNumber?: string;
  countryCode?: string;
}

export interface CdpAuthenticationMethods {
  email?: CdpAuthMethod;
  oauth?: CdpAuthMethod;
  google?: CdpAuthMethod;
  sms?: CdpSmsMethod;
}

export interface CdpUser {
  userId?: string;
  email?: string;
  name?: string;
  displayName?: string;
  authenticationMethods?: CdpAuthenticationMethods;
}

export interface CdpUserInfoOptions {
  isSignedIn?: boolean;
}

export interface CdpUserInfo {
  email?: string;
  username?: string;
  phoneNumber?: string;
}

export function extractEmailFromCdpUser(
  user: CdpUser | undefined,
  isSignedIn: boolean
): string | undefined {
  if (!user) return undefined;
  return (
    user.authenticationMethods?.email?.email ||
    user.authenticationMethods?.oauth?.email ||
    user.authenticationMethods?.google?.email ||
    user.email ||
    (isSignedIn && user.userId ? `${user.userId}@cdp.local` : undefined)
  );
}

export function extractUsernameFromCdpUser(
  user: CdpUser | undefined,
  emailForFallback?: string
): string | undefined {
  if (!user) return emailForFallback ? emailForFallback.split("@")[0] : undefined;
  return (
    user.authenticationMethods?.oauth?.name ||
    user.authenticationMethods?.google?.name ||
    user.authenticationMethods?.email?.name ||
    user.name ||
    user.displayName ||
    (emailForFallback ? emailForFallback.split("@")[0] : undefined)
  );
}

export function extractPhoneFromCdpUser(
  user: CdpUser | undefined
): string | undefined {
  if (!user) return undefined;
  const sms = user.authenticationMethods?.sms;
  if (!sms) return undefined;
  const raw = sms.phoneNumber;
  const cc = sms.countryCode;
  // Prefer provided E.164; otherwise compose from countryCode + local number
  const combined = raw?.startsWith('+') ? raw : (raw && cc ? `${cc}${raw}` : raw);
  if (!combined) return undefined;
  // Normalize to E.164 (+digits only)
  const digits = combined.replace(/[^0-9]/g, '');
  return digits ? `+${digits}` : undefined;
}

function generateEmailFromPhone(phone: string): string | undefined {
  if (!phone) return undefined;
  const digits = phone.replace(/[^0-9]/g, '');
  if (!digits) return undefined;
  return `p${digits}@cdp.local`;
}

export function resolveCdpUserInfo(
  user: CdpUser | undefined,
  options?: CdpUserInfoOptions
): CdpUserInfo {
  const phoneNumber = extractPhoneFromCdpUser(user);
  const email =
    extractEmailFromCdpUser(user, Boolean(options?.isSignedIn)) ||
    (phoneNumber ? generateEmailFromPhone(phoneNumber) : undefined) ||
    (Boolean(options?.isSignedIn) && user?.userId ? `${user.userId}@cdp.local` : undefined);
  const username = extractUsernameFromCdpUser(user, email);
  return { email, username, phoneNumber };
}


