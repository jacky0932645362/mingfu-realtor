export const TRACKING_CONSENT_STORAGE_KEY = "tracking_consent_v1";
export const TRACKING_CONSENT_VERSION = "tracking-consent-v1";
export const TRACKING_CONSENT_CHANGED_EVENT = "app:tracking-consent-changed";
export const TRACKING_CONSENT_OPEN_EVENT = "app:tracking-consent-open";
export const TRACKING_CONSENT_DECISION_COOKIE = "app_tracking_choice";

export type TrackingConsentDecision = {
  version: typeof TRACKING_CONSENT_VERSION;
  tracking: boolean;
  decidedAt: string;
};

export type TrackingConsentEvidence = {
  version: typeof TRACKING_CONSENT_VERSION;
  granted: boolean;
  decidedAt: Date;
  gaClientId: string | null;
  fbp: string | null;
  fbc: string | null;
};

let verifiedDecision: TrackingConsentDecision | null = null;

function cleanIdentifier(value: unknown, max = 200): string | null {
  const normalized = String(value || "").trim().slice(0, max);
  return normalized || null;
}

export function parseTrackingConsentDecision(raw: unknown): TrackingConsentDecision | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  if (value.version !== TRACKING_CONSENT_VERSION || typeof value.tracking !== "boolean") {
    return null;
  }
  const decidedAt = new Date(String(value.decidedAt || ""));
  if (!Number.isFinite(decidedAt.getTime())) return null;
  return {
    version: TRACKING_CONSENT_VERSION,
    tracking: value.tracking,
    decidedAt: decidedAt.toISOString(),
  };
}

export function publishVerifiedTrackingConsent(
  decision: TrackingConsentDecision,
): void {
  verifiedDecision = decision;
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(TRACKING_CONSENT_CHANGED_EVENT, { detail: decision }),
    );
  }
}

export function readVerifiedTrackingConsent(): TrackingConsentDecision | null {
  return verifiedDecision;
}

export function hasVerifiedTrackingConsent(): boolean {
  return verifiedDecision?.tracking === true;
}

export function normalizeGaClientId(value: unknown): string | null {
  const normalized = String(value || "").trim();
  return /^\d{1,20}\.\d{1,20}$/.test(normalized) ? normalized : null;
}

export function normalizeMetaBrowserId(value: unknown): string | null {
  const normalized = String(value || "").trim();
  return /^fb\.1\.\d{10,16}\.[A-Za-z0-9._-]{1,160}$/.test(normalized)
    ? normalized
    : null;
}

export function writeTrackingConsent(tracking: boolean): TrackingConsentDecision {
  const decision: TrackingConsentDecision = {
    version: TRACKING_CONSENT_VERSION,
    tracking,
    decidedAt: new Date().toISOString(),
  };
  window.localStorage.setItem(TRACKING_CONSENT_STORAGE_KEY, JSON.stringify(decision));
  return decision;
}

export function parseTrackingConsentEvidence(raw: unknown): TrackingConsentEvidence {
  const empty: TrackingConsentEvidence = {
    version: TRACKING_CONSENT_VERSION,
    granted: false,
    decidedAt: new Date(),
    gaClientId: null,
    fbp: null,
    fbc: null,
  };
  if (!raw || typeof raw !== "object") return empty;
  const value = raw as Record<string, unknown>;
  if (value.version !== TRACKING_CONSENT_VERSION || typeof value.granted !== "boolean") {
    return empty;
  }
  const decidedAt = new Date(String(value.decidedAt || ""));
  const now = Date.now();
  if (
    !Number.isFinite(decidedAt.getTime()) ||
    decidedAt.getTime() < now - 366 * 24 * 60 * 60_000 ||
    decidedAt.getTime() > now + 5 * 60_000
  ) {
    return empty;
  }
  if (!value.granted) {
    return {
      ...empty,
      decidedAt,
    };
  }
  return {
    version: TRACKING_CONSENT_VERSION,
    granted: true,
    decidedAt,
    gaClientId: cleanIdentifier(value.gaClientId),
    fbp: cleanIdentifier(value.fbp),
    fbc: cleanIdentifier(value.fbc),
  };
}
