// Cognito auth via amazon-cognito-identity-js (loaded as a global from vendor/). No Amplify.
// Every storage access is wrapped: iOS Safari private mode throws on localStorage.
import { config } from "./config.js";
export { config };

const C = window.AmazonCognitoIdentity;
if (!C && config.mock !== true) throw new Error("amazon-cognito-identity.min.js must be loaded before auth.js");

/** localStorage when it works, an in-memory Map when it throws. Same interface Cognito expects. */
export const safeStorage = (() => {
  try {
    const probe = "__tryout_probe__";
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    return {
      getItem: (k) => { try { return window.localStorage.getItem(k); } catch { return null; } },
      setItem: (k, v) => { try { window.localStorage.setItem(k, v); } catch { /* full or private */ } },
      removeItem: (k) => { try { window.localStorage.removeItem(k); } catch { /* ignore */ } },
      clear: () => { try { window.localStorage.clear(); } catch { /* ignore */ } },
    };
  } catch {
    const m = new Map();
    return {
      getItem: (k) => (m.has(k) ? m.get(k) : null),
      setItem: (k, v) => m.set(k, String(v)),
      removeItem: (k) => m.delete(k),
      clear: () => m.clear(),
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


// ---------------------------------------------------------------------------- Mock mode (local dev only)
// Enabled only when config.mock === true (scripts/dev-server.js serves such a config). Never true in production.
// Any email signs in; addresses starting with "admin" are admins. Password "temp" exercises the first-login flow.
function mockImpl() {
  const KEY = "mock:session";
  const subFor = (email) => "mock-" + email.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);
  const groupsFor = (email) => (email.toLowerCase().startsWith("admin") ? ["admin"] : ["evaluator"]);
  const session = () => store.get(KEY);
  const establish = (email) => { const s = { sub: subFor(email), groups: groupsFor(email), email: email.toLowerCase() }; store.set(KEY, s); return s; };
  return {
    getSession: async () => session(),
    getIdToken: async () => { const s = session(); return s ? `mock ${JSON.stringify(s)}` : null; },
    whoAmI: async () => session(),
    signIn: async (email, password) => {
      if (!email) throw Object.assign(new Error("Email or password is incorrect."), { code: "NotAuthorizedException" });
      if (password === "temp") return { kind: "newPassword", complete: async () => establish(email).groups };
      return { kind: "ok", groups: establish(email).groups };
    },
    signOut: () => store.remove(KEY),
  };
}

function cognitoImpl() {
  const pool = new C.CognitoUserPool({
    UserPoolId: config.userPoolId,
    ClientId: config.userPoolClientId,
    Storage: safeStorage,
  });

  function currentUser() {
    return pool.getCurrentUser();
  }

  /** Current session, refreshed with the refresh token if the ID token has expired. null if signed out. */
  function getSession() {
    return new Promise((resolve) => {
      const user = currentUser();
      if (!user) return resolve(null);
      user.getSession((err, session) => {
        if (err || !session || !session.isValid()) return resolve(null);
        resolve(session);
      });
    });
  }

  async function getIdToken() {
    const s = await getSession();
    return s ? s.getIdToken().getJwtToken() : null;
  }

  function groupsOf(session) {
    const g = session.getIdToken().payload["cognito:groups"];
    return Array.isArray(g) ? g : [];
  }

  /** { sub, groups, email } or null. */
  async function whoAmI() {
    const s = await getSession();
    if (!s) return null;
    const p = s.getIdToken().payload;
    return { sub: p.sub, groups: groupsOf(s), email: p.email || "" };
  }


  /**
   * Sign in. Resolves to { kind: "ok", groups } or, on a first login with a temporary password,
   * { kind: "newPassword", complete(newPassword) } where complete() resolves to groups.
   */
  function signIn(email, password) {
    const user = new C.CognitoUser({ Username: email.toLowerCase(), Pool: pool, Storage: safeStorage });
    const details = new C.AuthenticationDetails({ Username: email.toLowerCase(), Password: password });
    return new Promise((resolve, reject) => {
      user.authenticateUser(details, {
        onSuccess: (session) => resolve({ kind: "ok", groups: groupsOf(session) }),
        onFailure: reject,
        newPasswordRequired: (userAttributes) => {
          // Cognito rejects these two if sent back; we require no other attributes (and never a name).
          delete userAttributes.email_verified;
          delete userAttributes.email;
          resolve({
            kind: "newPassword",
            complete: (newPassword) => new Promise((res, rej) => {
              user.completeNewPasswordChallenge(newPassword, {}, {
                onSuccess: (session) => res(groupsOf(session)),
                onFailure: rej,
              });
            }),
          });
        },
      });
    });
  }

  function signOut() {
    const user = currentUser();
    if (user) user.signOut();
  }
  return { getSession, getIdToken, whoAmI, signIn, signOut };
}

const impl = config.mock === true ? mockImpl() : cognitoImpl();
/** Current session (refreshed if needed) or null. */
export const getSession = impl.getSession;
export const getIdToken = impl.getIdToken;
/** { sub, groups, email } or null. */
export const whoAmI = impl.whoAmI;
/** Resolves to { kind: "ok", groups } or { kind: "newPassword", complete(newPassword) }. */
export const signIn = impl.signIn;
export const signOut = impl.signOut;

export function homeFor(groups) {
  return groups.includes("admin") ? "admin.html" : "evaluate.html";
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
