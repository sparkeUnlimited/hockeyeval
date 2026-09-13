// Cognito auth with plain fetch against the Cognito IDP JSON API. No SDK, no Amplify.
//
// Primary sign-in: email + one-time code (USER_AUTH flow, EMAIL_OTP). Fallback: email + password
// (USER_AUTH flow, PASSWORD choice), used by CLI-created accounts, scripts and the dry run.
// Tokens live in safeStorage; the ID token is refreshed with the refresh token when it nears expiry.
// Every storage access is wrapped: iOS Safari private mode throws on localStorage.
import { config } from "./config.js";
export { config };

/** localStorage when it works, an in-memory Map when it throws. */
export const safeStorage = (() => {
  try {
    const probe = "__tryout_probe__";
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    return {
      getItem: (k) => { try { return window.localStorage.getItem(k); } catch { return null; } },
      setItem: (k, v) => { try { window.localStorage.setItem(k, v); } catch { /* full or private */ } },
      removeItem: (k) => { try { window.localStorage.removeItem(k); } catch { /* ignore */ } },
    };
  } catch {
    const m = new Map();
    return {
      getItem: (k) => (m.has(k) ? m.get(k) : null),
      setItem: (k, v) => m.set(k, String(v)),
      removeItem: (k) => m.delete(k),
    };
  }
})();

/** JSON helpers on top of safeStorage. */
export const store = {
  get(key, fallback = null) {
    const raw = safeStorage.getItem(key);
    if (raw === null) return fallback;
    try { return JSON.parse(raw); } catch { return fallback; }
  },
  set(key, value) { safeStorage.setItem(key, JSON.stringify(value)); },
  remove(key) { safeStorage.removeItem(key); },
};

export class AuthFlowError extends Error {
  constructor(message, code) { super(message); this.name = "AuthFlowError"; this.code = code || "AuthError"; }
}

function decodeJwtPayload(token) {
  try {
    const b64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const bytes = Uint8Array.from(atob(b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), "=")), (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch { return {}; }
}

// ---------------------------------------------------------------------------- Real Cognito
function cognitoImpl() {
  const TOKENS_KEY = "auth:tokens";
  const endpoint = `https://cognito-idp.${config.region}.amazonaws.com/`;
  const ClientId = config.userPoolClientId;

  async function idp(action, body) {
    let res;
    try {
      res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/x-amz-json-1.1", "x-amz-target": `AWSCognitoIdentityProviderService.${action}` },
        body: JSON.stringify(body),
      });
    } catch (e) {
      throw new AuthFlowError("No connection", "NetworkError");
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new AuthFlowError(data.message || data.Message || `${action} failed`, String(data.__type || "").split("#").pop() || "AuthError");
    return data;
  }

  function saveTokens(result) {
    const prev = store.get(TOKENS_KEY) || {};
    const tokens = {
      idToken: result.IdToken,
      accessToken: result.AccessToken,
      refreshToken: result.RefreshToken || prev.refreshToken || null,
      expiresAt: Date.now() + (Number(result.ExpiresIn) || 3600) * 1000,
    };
    store.set(TOKENS_KEY, tokens);
    return tokens;
  }

  /** Tokens, refreshed when within a minute of expiry. null when signed out or refresh was refused. */
  async function getSession() {
    const t = store.get(TOKENS_KEY);
    if (!t || !t.idToken) return null;
    if (Date.now() < t.expiresAt - 60_000) return t;
    if (!t.refreshToken) { store.remove(TOKENS_KEY); return null; }
    try {
      const r = await idp("InitiateAuth", { AuthFlow: "REFRESH_TOKEN_AUTH", ClientId, AuthParameters: { REFRESH_TOKEN: t.refreshToken } });
      return saveTokens(r.AuthenticationResult);
    } catch (e) {
      if (e.code === "NetworkError") return t; // offline: hand back the stale token; the API call will fail as a network error, not a sign-out
      store.remove(TOKENS_KEY);
      return null;
    }
  }

  const getIdToken = async () => (await getSession())?.idToken || null;
  const groupsOf = (idToken) => { const g = decodeJwtPayload(idToken)["cognito:groups"]; return Array.isArray(g) ? g : []; };

  async function whoAmI() {
    const s = await getSession();
    if (!s) return null;
    const p = decodeJwtPayload(s.idToken);
    return { sub: p.sub, groups: groupsOf(s.idToken), email: p.email || "" };
  }

  function finish(r) {
    if (!r.AuthenticationResult) throw new AuthFlowError(`Unexpected step ${r.ChallengeName || ""}`.trim(), "UnsupportedChallenge");
    const t = saveTokens(r.AuthenticationResult);
    return groupsOf(t.idToken);
  }

  /** Step 1 of code sign-in: ask Cognito to email a one-time code. */
  async function startEmailCode(email) {
    const USERNAME = email.trim().toLowerCase();
    let r = await idp("InitiateAuth", { AuthFlow: "USER_AUTH", ClientId, AuthParameters: { USERNAME, PREFERRED_CHALLENGE: "EMAIL_OTP" } });
    if (r.ChallengeName === "SELECT_CHALLENGE") {
      r = await idp("RespondToAuthChallenge", { ClientId, ChallengeName: "SELECT_CHALLENGE", Session: r.Session, ChallengeResponses: { USERNAME, ANSWER: "EMAIL_OTP" } });
    }
    if (r.ChallengeName !== "EMAIL_OTP") throw new AuthFlowError("Code sign-in is not available for this account. Use a password instead.", "UnsupportedChallenge");
    return { session: r.Session, destination: r.ChallengeParameters?.CODE_DELIVERY_DESTINATION || "" };
  }

  /** Step 2: submit the code. Resolves to the caller's groups. */
  async function completeEmailCode(email, code, session) {
    const USERNAME = email.trim().toLowerCase();
    const r = await idp("RespondToAuthChallenge", {
      ClientId, ChallengeName: "EMAIL_OTP", Session: session,
      ChallengeResponses: { USERNAME, EMAIL_OTP_CODE: code.trim() },
    });
    return finish(r);
  }

  /** Password fallback. Resolves { kind: "ok", groups } or { kind: "newPassword", complete(newPassword) }. */
  async function signInWithPassword(email, password) {
    const USERNAME = email.trim().toLowerCase();
    let r = await idp("InitiateAuth", { AuthFlow: "USER_AUTH", ClientId, AuthParameters: { USERNAME, PASSWORD: password, PREFERRED_CHALLENGE: "PASSWORD" } });
    if (r.ChallengeName === "SELECT_CHALLENGE") {
      r = await idp("RespondToAuthChallenge", { ClientId, ChallengeName: "SELECT_CHALLENGE", Session: r.Session, ChallengeResponses: { USERNAME, ANSWER: "PASSWORD", PASSWORD: password } });
    }
    if (r.ChallengeName === "NEW_PASSWORD_REQUIRED") {
      const session = r.Session;
      return {
        kind: "newPassword",
        complete: async (newPassword) => finish(await idp("RespondToAuthChallenge", {
          ClientId, ChallengeName: "NEW_PASSWORD_REQUIRED", Session: session,
          ChallengeResponses: { USERNAME, NEW_PASSWORD: newPassword }, // no extra attributes, and never a name
        })),
      };
    }
    return { kind: "ok", groups: finish(r) };
  }

  async function signOut() {
    const t = store.get(TOKENS_KEY);
    store.remove(TOKENS_KEY);
    if (t?.refreshToken) { try { await idp("RevokeToken", { ClientId, Token: t.refreshToken }); } catch { /* best effort */ } }
  }

  return { getSession, getIdToken, whoAmI, startEmailCode, completeEmailCode, signInWithPassword, signOut };
}

// ---------------------------------------------------------------------------- Mock (local dev only)
// Active only when config.mock === true (scripts/dev-server.js). Any email works; addresses starting with
// "admin" are admins. The one-time code is always 123456. Password "temp" exercises the new-password flow.
function mockImpl() {
  const KEY = "mock:session";
  const subFor = (email) => "mock-" + email.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);
  const groupsFor = (email) => (email.toLowerCase().startsWith("admin") ? ["admin"] : ["evaluator"]);
  const session = () => store.get(KEY);
  const establish = (email) => { const s = { sub: subFor(email), groups: groupsFor(email), email: email.toLowerCase() }; store.set(KEY, s); return s; };
  const requireEmail = (email) => { if (!/^[^\s@]+@[^\s@]+$/.test(email.trim())) throw new AuthFlowError("Enter a valid email.", "InvalidParameterException"); };
  return {
    getSession: async () => session(),
    getIdToken: async () => { const s = session(); return s ? `mock ${JSON.stringify(s)}` : null; },
    whoAmI: async () => session(),
    startEmailCode: async (email) => { requireEmail(email); return { session: "mock-session", destination: "m***@" + email.split("@")[1] }; },
    completeEmailCode: async (email, code) => { if (code.trim() !== "123456") throw new AuthFlowError("That code is not right.", "CodeMismatchException"); return establish(email).groups; },
    signInWithPassword: async (email, password) => {
      requireEmail(email);
      if (password === "temp") return { kind: "newPassword", complete: async () => establish(email).groups };
      return { kind: "ok", groups: establish(email).groups };
    },
    signOut: async () => store.remove(KEY),
  };
}

const impl = config.mock === true ? mockImpl() : cognitoImpl();
export const getSession = impl.getSession;
export const getIdToken = impl.getIdToken;
/** { sub, groups, email } or null. */
export const whoAmI = impl.whoAmI;
export const startEmailCode = impl.startEmailCode;
export const completeEmailCode = impl.completeEmailCode;
export const signInWithPassword = impl.signInWithPassword;
export const signOut = impl.signOut;

export function homeFor(groups) {
  return groups.includes("admin") ? "admin.html" : "evaluate.html";
}

/** Human message for a Cognito error. */
export function friendlyAuthError(ex) {
  const code = ex?.code || ex?.name || "";
  switch (code) {
    case "CodeMismatchException": return "That code is not right. Check the email and try again.";
    case "ExpiredCodeException": return "That code has expired. Send a new one.";
    case "NotAuthorizedException": return "Sign-in failed. Check the email address, or ask the convenor whether your login exists.";
    case "UserNotFoundException": return "No login for that email. Ask the convenor to add you.";
    case "PasswordResetRequiredException": return "Your password was reset. Sign in with a code instead, or ask the convenor.";
    case "InvalidPasswordException": return "Password needs at least 8 characters including a number.";
    case "InvalidParameterException": return ex.message || "Something in the form is not valid.";
    case "LimitExceededException": case "TooManyRequestsException": return "Too many attempts. Wait a minute and try again.";
    case "NetworkError": return "No connection. Check Wi-Fi and try again.";
    case "UnsupportedChallenge": return ex.message;
    default: return ex?.message || "Sign-in failed.";
  }
}

/**
 * Gate a page. Redirects to the login page when signed out and to the right home when the
 * caller lacks the required group. Resolves to { sub, groups, email }.
 */
export async function requireAuth({ admin = false } = {}) {
  const me = await whoAmI();
  if (!me) { location.replace("index.html"); return new Promise(() => {}); }
  if (admin && !me.groups.includes("admin")) { location.replace(homeFor(me.groups)); return new Promise(() => {}); }
  return me;
}
