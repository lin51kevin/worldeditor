/**
 * Sandbox guard — static safety analysis for external plugin bundles.
 *
 * External plugins are untrusted third-party JavaScript that we execute in the
 * application realm via a `<script src=blob:>` tag (see {@link ./pluginLoader}).
 * The browser realm exposes powerful capabilities (`eval`, raw network access,
 * `localStorage`, cookies, DOM, navigation) that a plugin has no legitimate need
 * for — the plugin's entire supported surface is the typed `PluginContext`.
 *
 * This module scans a bundle's source *before* it is injected and rejects
 * bundles that reference forbidden capabilities. It is a defense-in-depth layer
 * that complements the manifest permission model:
 *
 *   manifest permissions  → governs *which contributions* a plugin may register
 *   sandbox guard (this)  → governs *which platform capabilities* it may touch
 *
 * Limitations (by design — documented honestly):
 *   - Static analysis cannot defeat a determined attacker who obfuscates access
 *     (e.g. `window['ev' + 'al']`). The guard intentionally also flags the
 *     dynamic-property-access escape hatches commonly used for that, but full
 *     isolation requires running plugins in a separate realm (Web Worker /
 *     sandboxed iframe with `postMessage` RPC). That is a browser-validated
 *     follow-up tracked separately.
 *   - The guard never executes plugin code, so it is fully unit-testable in a
 *     headless (jsdom/node) environment.
 */

/** Category of a detected sandbox violation. */
export type SandboxViolationKind =
  | 'dynamic-eval'
  | 'network'
  | 'storage'
  | 'navigation'
  | 'dom-escape'
  | 'node-runtime'
  | 'prototype-pollution'
  | 'realm-escape';

/** A single detected unsafe construct in a plugin bundle. */
export interface SandboxViolation {
  /** Stable category used for grouping / messaging. */
  kind: SandboxViolationKind;
  /** The literal source token that triggered the rule (e.g. `eval(`). */
  match: string;
  /** Human-readable explanation of why the construct is forbidden. */
  reason: string;
}

interface Rule {
  kind: SandboxViolationKind;
  /** Pattern matched against the (comment-stripped) source. Must be global. */
  pattern: RegExp;
  reason: string;
}

/**
 * Forbidden-capability rules. Each pattern targets a platform capability that a
 * well-behaved plugin never needs because the equivalent functionality is (or
 * should be) provided through the typed `PluginContext` API instead.
 */
const RULES: readonly Rule[] = [
  // ── Dynamic code evaluation ────────────────────────────────────────────────
  {
    kind: 'dynamic-eval',
    pattern: /\beval\s*\(/g,
    reason: 'Dynamic code evaluation (eval) is forbidden for plugins.',
  },
  {
    kind: 'dynamic-eval',
    pattern: /\bnew\s+Function\s*\(/g,
    reason: 'The Function constructor evaluates arbitrary code and is forbidden.',
  },
  {
    kind: 'dynamic-eval',
    pattern: /\bsetTimeout\s*\(\s*['"`]/g,
    reason: 'String-argument setTimeout evaluates code and is forbidden.',
  },
  {
    kind: 'dynamic-eval',
    pattern: /\bsetInterval\s*\(\s*['"`]/g,
    reason: 'String-argument setInterval evaluates code and is forbidden.',
  },

  // ── Raw network access ─────────────────────────────────────────────────────
  {
    kind: 'network',
    pattern: /\bfetch\s*\(/g,
    reason: 'Direct network access (fetch) is forbidden; use the host API.',
  },
  {
    kind: 'network',
    pattern: /\bXMLHttpRequest\b/g,
    reason: 'Direct network access (XMLHttpRequest) is forbidden.',
  },
  {
    kind: 'network',
    pattern: /\bnew\s+WebSocket\s*\(/g,
    reason: 'Opening raw WebSocket connections is forbidden.',
  },
  {
    kind: 'network',
    pattern: /\bnavigator\s*\.\s*sendBeacon\b/g,
    reason: 'navigator.sendBeacon exfiltrates data and is forbidden.',
  },

  // ── Persistent storage / credentials ───────────────────────────────────────
  {
    kind: 'storage',
    pattern: /\b(local|session)Storage\b/g,
    reason: 'Direct Web Storage access is forbidden; plugin state must go through the host.',
  },
  {
    kind: 'storage',
    pattern: /\bindexedDB\b/g,
    reason: 'Direct IndexedDB access is forbidden.',
  },
  {
    kind: 'storage',
    pattern: /\bdocument\s*\.\s*cookie\b/g,
    reason: 'Reading or writing cookies is forbidden.',
  },

  // ── Navigation / top-level redirection ─────────────────────────────────────
  {
    kind: 'navigation',
    pattern: /\b(window|document|self|top|parent)\s*\.\s*location\b/g,
    reason: 'Navigating or reading the window location is forbidden.',
  },
  {
    kind: 'navigation',
    pattern: /\blocation\s*\.\s*(href|assign|replace|reload)\b/g,
    reason: 'Navigating the page is forbidden.',
  },

  // ── DOM / script-graph escape ──────────────────────────────────────────────
  {
    kind: 'dom-escape',
    pattern: /\bdocument\s*\.\s*write\b/g,
    reason: 'document.write can inject arbitrary markup and is forbidden.',
  },
  {
    kind: 'dom-escape',
    pattern: /\.\s*innerHTML\s*=/g,
    reason: 'Assigning innerHTML can inject scripts and is forbidden.',
  },
  {
    kind: 'dom-escape',
    pattern: /\bimportScripts\s*\(/g,
    reason: 'importScripts loads external code and is forbidden.',
  },

  // ── Node / bundler runtime escape ──────────────────────────────────────────
  {
    kind: 'node-runtime',
    pattern: /\brequire\s*\(/g,
    reason: 'CommonJS require is not available to sandboxed plugins.',
  },
  {
    kind: 'node-runtime',
    pattern: /\bprocess\s*\.\s*(env|exit|binding)\b/g,
    reason: 'Access to the Node process object is forbidden.',
  },
  {
    kind: 'node-runtime',
    pattern: /\b__dirname\b|\b__filename\b/g,
    reason: 'Node module globals are forbidden.',
  },

  // ── Prototype pollution ────────────────────────────────────────────────────
  {
    kind: 'prototype-pollution',
    pattern: /\b__proto__\b/g,
    reason: 'Touching __proto__ risks prototype pollution and is forbidden.',
  },
  {
    kind: 'prototype-pollution',
    pattern: /\bconstructor\s*\.\s*prototype\b/g,
    reason: 'Mutating constructor.prototype is forbidden.',
  },

  // ── Obfuscated realm escape ────────────────────────────────────────────────
  {
    kind: 'realm-escape',
    pattern: /\b(globalThis|window|self)\s*\[/g,
    reason: 'Dynamic bracket access on the global object is a known eval-escape and is forbidden.',
  },
];

/**
 * Remove string and comment content so that benign mentions of forbidden tokens
 * inside string literals or comments (for example documentation or error
 * messages) do not produce false positives.
 *
 * This is a deliberately conservative lexer: it understands `//` and block
 * comments and single/double/backtick string literals with backslash escapes.
 * Template-literal `${...}` substitutions are preserved as code so that
 * forbidden calls hidden inside interpolations are still caught.
 */
export function stripStringsAndComments(source: string): string {
  let out = '';
  let i = 0;
  const n = source.length;

  while (i < n) {
    const c = source[i];
    const next = source[i + 1];

    // Line comment
    if (c === '/' && next === '/') {
      i += 2;
      while (i < n && source[i] !== '\n') i++;
      continue;
    }
    // Block comment
    if (c === '/' && next === '*') {
      i += 2;
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    // Single / double quoted strings — collapse to an empty literal so that the
    // surrounding quote (a signal for e.g. string-argument setTimeout) survives,
    // while the potentially-forbidden content inside is discarded.
    if (c === '"' || c === "'") {
      i++;
      while (i < n && source[i] !== c) {
        if (source[i] === '\\') i++;
        i++;
      }
      i++;
      out += c + c;
      continue;
    }
    // Template literal — keep `${...}` interpolations as code
    if (c === '`') {
      i++;
      while (i < n && source[i] !== '`') {
        if (source[i] === '\\') {
          i += 2;
          continue;
        }
        if (source[i] === '$' && source[i + 1] === '{') {
          // Copy the interpolation verbatim (balanced braces).
          out += '${';
          i += 2;
          let depth = 1;
          while (i < n && depth > 0) {
            if (source[i] === '{') depth++;
            else if (source[i] === '}') depth--;
            if (depth > 0) out += source[i];
            i++;
          }
          out += '}';
          continue;
        }
        i++;
      }
      i++;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/**
 * Statically scan a plugin bundle's source for forbidden capability usage.
 *
 * @param source Raw JavaScript source of the plugin bundle.
 * @returns A list of violations (empty when the source is considered safe).
 */
export function scanPluginSource(source: string): SandboxViolation[] {
  const code = stripStringsAndComments(source);
  const violations: SandboxViolation[] = [];
  const seen = new Set<string>();

  for (const rule of RULES) {
    // RegExp with the `g` flag is stateful; reset before each use.
    rule.pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = rule.pattern.exec(code)) !== null) {
      const match = m[0].replace(/\s+/g, ' ').trim();
      const dedupeKey = `${rule.kind}:${match}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      violations.push({ kind: rule.kind, match, reason: rule.reason });
    }
  }
  return violations;
}

/**
 * Throw a descriptive error if a plugin bundle references forbidden
 * capabilities. Used by the loader before injecting an external plugin.
 *
 * @param pluginId Plugin identifier (for the error message).
 * @param source   Raw bundle source.
 * @throws Error listing every detected violation.
 */
export function assertPluginSourceSafe(pluginId: string, source: string): void {
  const violations = scanPluginSource(source);
  if (violations.length === 0) return;

  const details = violations
    .map((v) => `  • [${v.kind}] ${v.match} — ${v.reason}`)
    .join('\n');
  throw new Error(
    `[Sandbox] Plugin '${pluginId}' was rejected: it uses ${violations.length} ` +
      `forbidden capabilit${violations.length === 1 ? 'y' : 'ies'}:\n${details}`,
  );
}
