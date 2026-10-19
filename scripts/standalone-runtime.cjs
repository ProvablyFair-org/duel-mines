// Ported from the sibling LIQD Mines package; the unit-count constant lives in src/loader.ts here.
// Bundled modules receive their original directory paths for evidence-file lookup.
const __path = require('node:path');
const __createRequire = require('node:module').createRequire;
const __cache = new Map();
function __load(id) {
  if (__cache.has(id)) return __cache.get(id).exports;
  if (!Object.hasOwn(__modules, id)) throw new Error(`Missing bundled module: ${id}`);
  const filename = __path.join(__dirname, id);
  const diskRequire = __createRequire(filename);
  const module = { exports: {} };
  __cache.set(id, module);
  const localRequire = spec => {
    if (!spec.startsWith('.')) return diskRequire(spec);
    const joined = __path.posix.normalize(__path.posix.join(__path.posix.dirname(id), spec));
    const target = [joined, joined + '.js', joined + '/index.js']
      .find(candidate => Object.hasOwn(__modules, candidate));
    return target ? __load(target) : diskRequire(spec);
  };
  __modules[id](module, module.exports, localRequire, filename, __path.dirname(filename));
  return module.exports;
}

// The unit sources use Mocha's describe/it interface and synchronous timeout settings.
// Node's built-in runner supplies assertion reporting and a nonzero failure exit status.
//
// TEST-COUNT PARITY. Node's runner exits 0 when every spec that RAN passed, so a describe block
// that was skipped, cancelled or never registered leaves the run green with fewer specs. Every
// `it` body that returns (or resolves) without throwing is counted here, and at exit the count
// must equal EXPECTED_UNIT_TESTS from src/loader.ts — a code constant, changed in a diff. A count
// that differs, or a bundle with no such constant, sets a nonzero exit status.
function __installTestGlobals() {
  const test = require('node:test');
  const context = () => ({ timeout() {}, slow() {}, retries() {} });
  const wrap = fn => typeof fn === 'function' ? function () { return fn.call(context()); } : fn;
  let passed = 0;
  const counted = fn => typeof fn === 'function' ? function () {
    const out = fn.call(context());
    if (out && typeof out.then === 'function') return out.then(v => { passed++; return v; });
    passed++;
    return out;
  } : fn;
  const bindIt = f => (title, callback) => f(title, counted(callback));
  const bindDescribe = f => (title, callback) => f(title, wrap(callback));
  for (const [name, bind] of [['describe', bindDescribe], ['it', bindIt]]) {
    const bound = bind(test[name]);
    for (const modifier of ['skip', 'only', 'todo']) bound[modifier] = bind(test[name][modifier]);
    globalThis[name] = bound;
  }
  for (const name of ['before', 'after', 'beforeEach', 'afterEach']) {
    globalThis[name] = callback => test[name](wrap(callback));
  }
  process.on('exit', () => {
    const pins = Object.hasOwn(__modules, 'src/loader.js') ? __load('src/loader.js') : {};
    const expected = pins.EXPECTED_UNIT_TESTS;
    if (!Number.isInteger(expected)) {
      console.error('[standalone] FAIL: EXPECTED_UNIT_TESTS is not declared in src/loader.ts — the passing count cannot be checked.');
      process.exitCode = 1;
    } else if (passed !== expected) {
      console.error(`[standalone] FAIL: ${passed} unit specs passed, ${expected} declared (src/loader.ts EXPECTED_UNIT_TESTS).`);
      process.exitCode = 1;
    } else {
      console.log(`[standalone] ${passed}/${expected} unit specs passed (src/loader.ts EXPECTED_UNIT_TESTS).`);
    }
  });
}
