/**
 * THE SIMULATION PLAN — shared by src/simulate.ts (which runs it) and the verifier (which binds the
 * committed artifact to it and replays part of it). Until this module existed the constants lived
 * inside the simulator only, and the verifier read the configuration count and rounds per config
 * back out of the artifact it was scoring (`pass1.configs ?? pass1.targets ?? 24`), so a shrunken
 * experiment described itself as complete.
 */

/** Pass 1 mine counts: every configuration the game offers, 1-24. */
export const SIM_CONFIGS: number[] = Array.from({ length: 24 }, (_, i) => i + 1);
/** The profile floor (MINES-20): at least 1,000,000 rounds per mine count. */
export const SIM_ROUNDS_PER_CONFIG = 1_000_000;
/** Pass 2: nonces per revealed casino seed (profile floor 10,000). */
export const SIM_NONCES_PER_SEED = 10_000;
/** Pass 2 early window = the captured epoch, nonces 0..49. */
export const SIM_EPOCH_LENGTH = 50;
/** Pass 2 Tests A/B: a representative 3-mine board (~88% win chance). Test C uses the served configs. */
export const SIM_PASS2_MINE_COUNT = 3;

// ── Pinned simulation seeds — one unique pair per config (24 total) ─────────
// Generated once via crypto.randomBytes(32) / crypto.randomBytes(16).
// Each config gets its own HMAC stream to avoid cross-config correlation.
export const SIM_SEEDS: Array<{ server: string; client: string }> = [
  { server: 'e33ac56577654adb77e9ed4cad54142bb99f12a85b93ac4b473ec687631d584a', client: '857902ce8e141aff4bd073ede94cc708' },
  { server: 'e2a6b8999929cb7a99313e7e8030c77913f656bdcd8b13e4138a7d83732f1018', client: '788fd3d35a196357da74e1f89a82bbaf' },
  { server: 'e7fd02dd9662ad142310ab99a02ba70692d2a38b1024ccbbe9001d6633f01f45', client: '29cbc576e54475c5b5f835103da9bda4' },
  { server: '3dda4af8d5357e02c72cd519b926edda4dfc778d6bdca163da3041b0b3889bf9', client: '0c013271e4ef52b6b1a2b438b92a1bb2' },
  { server: 'ba25a980d1864a79fa48e6e0cca024b98c2fb7ae65b3121f5ee9711d256e0604', client: '0ddab1966a7665cc748b5549ed64f25b' },
  { server: '209c5e731a54a9a965878470734413c125565fc3c293ebb044817a2b54693169', client: '1d4e7e5c727a7cf3c5d6f8953acf84fd' },
  { server: '83942545c1955c65e006a5de832a91ee03b836f8a5abb2f288a008fe28861286', client: 'bf9683faf3a5402d7892bf54fa580eb1' },
  { server: '7841a0bb58560a06041bedf515a583ea2f0bdc727355cadf8c9a1a3c4c91209d', client: '72e614128ed88ec96bf4962cb5dd85f9' },
  { server: '4e5cd18cdab2de5651cf149e5412e9feede36d78ec5039b74906ef1fd0f1e7b8', client: '9e2137ebbef65ed9908c34810dd74670' },
  { server: '7211a77594b9c72c8d0af70ff1373aa67fe1ecb1126b99ba8c09681c9b857703', client: 'd7d5bafe6725fa4b253eee4b0252d40d' },
  { server: '0aff11f1565fd3afded9c92885581349afa3642c7c1dde5f5d916d66e0f7a626', client: '611cf27c8b063d4fa733470ff5d772b4' },
  { server: 'ec9fcbdfe5acd5ef5cfd0bebc9752d655511df8a9b65e1b0a41f42ab973e9c4a', client: '3601e88684f35fb47af89b4fae3b2d52' },
  { server: '24fc9d3cace2b46399bd38b5e7d68c13f8b154be30375e78674a15021b8337eb', client: 'f91e3ee8298ec3b38b031e351661e740' },
  { server: '354773c619131a80bb7512240549ff136baa5156c683effb03e969bc1eca2848', client: 'c5285b4b1d4a29f9affedd61bb432f02' },
  { server: '5483493f63480fd8044f6e5966e72b65b52c1465dfb8f00ace1346c3da1ccf0a', client: '509894e56ad0deab437f42b1cae16d8e' },
  { server: '66088acbe9911b6ff1b47673747ef659ee013e9b8eaad998e6e021c95f10f9d1', client: '464082f7d4fffd0d75afe26d5972c97c' },
  { server: '2803c817a798190e267d6cc48c6bce3e950f9c4bec672e61e895f9b143d2795a', client: '59cfbc0567db630502855832a6b9acfd' },
  { server: '5da951294acab67c7ef0b721a044033e9211b5a23228c8f60862317f3a4362ee', client: 'b1537dbd5aa53e01468f6a7c608c62fd' },
  { server: '94c15866f997286b86aa19af4b7596c77dc33c5e2da362e183f60c38d1963fee', client: 'd377bdeb83e51d33203c2077e1983ebf' },
  { server: '53baf9f6110a4a414ba5412460a75a908773aaa655ac7728307840d8c505d8de', client: '312e44f0ee59d094700a566a63dc121a' },
  { server: '6ca2113b0edb45518f94b56ff662231c032f05bc6ed1b50f51c98cd82468aa2e', client: 'e71f9fafc749aa5c212ef454ec014f8c' },
  { server: '0b04a819aba2d96240f43d5e8e939a428472e9b1edaf7fdce7c37f251734e8e0', client: '68e84344537d466a9252cdf9d08bb9de' },
  { server: '37c937299a80cce0282fc3bb6b67155d3e2cca2844395606509c93cb57004bee', client: '0e4a3fd4d2351361ca27c5a007ac99a7' },
  { server: '6c29a22b66fdf269afaca5f439412c97b28bc5577dd42fdcee896b917e8f7fa4', client: 'd4a1e18a7b78022b97ece31e87b79228' },
];
