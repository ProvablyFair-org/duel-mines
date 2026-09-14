/**
 * ARTIFACTS OF RECORD — pinned.
 *
 * These files are shipped as evidence and their figures are quoted in the report, but until this
 * pin existed nothing hashed them: emptying, duplicating or shrinking any of them left the
 * verifier reporting PROVABLY FAIR — Full Pass, exit 0. A published artifact that nothing can
 * distinguish from a rewritten one is not evidence.
 *
 * outputs/verification-results.json is deliberately NOT pinned — it is this verifier's own
 * output and is rewritten on every run by construction.
 *
 * Regenerating an artifact legitimately means re-pinning it here, in the same commit, with the
 * run that produced it.
 */
export const ARTIFACT_PINS: Readonly<Record<string, string>> = Object.freeze({
  'chi-squared-results.json':
    'fd47c2d9ecc04c86ba3239b4b90c6e004829bece982c75abc48f9d2b5cfdc27e',
  'determinism-log.json':
    '7065a1fff6d9ba044a500b4b83e59ba14c15bd26125fda2b28ddf69cc76c74ab',
  'rtp-convergence.html':
    '6717671740b27e4f3b06d8fae1252ea7d84d1890a710f72a354b5c78fc914846',
  'simulation-results.json':
    'c13453f1545a2778e809ba2b38d61c9588ec6ae7f26d7afbf63d7c7c82361ab4',
});
