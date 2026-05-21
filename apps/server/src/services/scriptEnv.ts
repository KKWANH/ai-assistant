/**
 * Environment for user-authored workspace scripts.
 *
 * Scripts (.sh / .py) run with the server's environment MINUS its secrets —
 * a workspace script must never be able to read the AI-provider API keys (or
 * any other token/secret) straight out of its own `process.env`. Non-secret
 * vars (PATH, HOME, language, Ariadne's own config) are kept so scripts still
 * behave normally.
 */

const SECRET_KEY_RE = /key|token|secret|password|passwd|credential|cookie|session/i;

/** A child-process env with secret-looking variables stripped. */
export function scriptEnv(): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (SECRET_KEY_RE.test(name)) continue;
    out[name] = value;
  }
  return out;
}
