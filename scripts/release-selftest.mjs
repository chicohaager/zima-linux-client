/**
 * Positive and negative controls for the release gate: every rule must be able to go red,
 * and an intact release must stay green. Run with `node scripts/verify-release.mjs --self-test`.
 */
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CHECKS,
  checkArtefactsPresent,
  checkBuildClaimNamesCommit,
  checkChecksumFile,
  checkNewerThanCode,
  checkNoNewerUncommittedInput,
  checkNoSpaceInNames,
  checkNoStrayChecksums,
  checkOneRun,
  checkVersionAgreement,
  sha256,
} from "./release-checks.mjs";

// --- self-test: every rule must be able to go red -----------------------------------------

export const selfTest = () => {
  const base = mkdtempSync(join(tmpdir(), "verify-release-selftest-"));
  const results = [];

  /** Builds a minimal, INTACT world; the mutator then breaks exactly one property. */
  const world = (mutate) => {
    const dir = mkdtempSync(join(base, "w-"));
    const dist = join(dir, "dist");
    const docs = join(dir, "docs");
    mkdirSync(dist, { recursive: true });
    mkdirSync(docs, { recursive: true });

    const expected = ["app_1.0.0_amd64.deb", "app-1.0.0.x86_64.rpm"];
    const now = Math.floor(Date.now() / 1000);
    for (const name of expected) {
      writeFileSync(join(dist, name), `payload of ${name}`);
      utimesSync(join(dist, name), now, now);
    }
    const sums = expected
      .map((n) => `${sha256(join(dist, n))}  ${n}`)
      .join("\n");
    writeFileSync(join(dist, "SHA256SUMS-1.0.0.txt"), `${sums}\n`);
    writeFileSync(
      join(docs, "V2-STATUS.md"),
      "```\nPakete  deb · rpm gebaut aus abc1234\n```\n",
    );
    writeFileSync(
      join(docs, "TESTER.md"),
      "Run `sha256sum -c SHA256SUMS-1.0.0.txt`.\n",
    );

    const ctx = {
      root: dir,
      distDir: dist,
      docsDir: docs,
      statusFile: join(docs, "V2-STATUS.md"),
      sumsName: "SHA256SUMS-1.0.0.txt",
      version: "1.0.0",
      expected,
      codeCommit: "abc1234",
      codeCommitTime: now - 3600,
      dirtyBuildInputs: [],
      packageBuildFieldsChanged: false,
      maxSpreadMinutes: 60,
    };
    mutate?.(ctx, dist, docs);
    return ctx;
  };

  const expectRed = (name, check, mutate) => {
    const ctx = world(mutate);
    const r = check(ctx);
    results.push({ name, ok: r.ok === false, detail: r.detail });
  };

  /**
   * The other half. A gate that flags everything passes every positive control and is still
   * useless — it gets switched off after the third false alarm, and takes the true findings
   * with it. Each of these constructs a situation that must NOT fire.
   */
  const expectGreen = (name, check, mutate) => {
    const ctx = world(mutate);
    const r = check(ctx);
    results.push({
      name: `must NOT fire: ${name}`,
      ok: r.ok === true,
      detail: r.detail,
    });
  };

  // The negative control first: an intact world must be green on ALL checks. Without it, a
  // check that always fails would pass every positive control below and look rigorous.
  const intact = world();
  const greens = CHECKS.map((c) => c(intact));
  results.push({
    name: "negative control — an intact release passes every check",
    ok: greens.every((g) => g.ok),
    detail:
      greens
        .filter((g) => !g.ok)
        .map((g) => g.label)
        .join(", ") || "all green",
  });

  expectRed(
    "a missing artefact is caught",
    checkArtefactsPresent,
    (ctx, dist) => rmSync(join(dist, ctx.expected[0])),
  );
  expectRed(
    "an artefact older than the code commit is caught",
    checkNewerThanCode,
    (ctx, dist) => {
      const old = ctx.codeCommitTime - 600;
      utimesSync(join(dist, ctx.expected[0]), old, old);
    },
  );
  expectRed(
    "artefacts from two different runs are caught",
    checkOneRun,
    (ctx, dist) => {
      const long = Math.floor(Date.now() / 1000) - 6 * 3600;
      utimesSync(join(dist, ctx.expected[0]), long, long);
    },
  );
  expectRed(
    "a build input changed after the build is caught",
    checkNoNewerUncommittedInput,
    (ctx) => {
      const f = join(ctx.root, "src.ts");
      writeFileSync(f, "changed after packaging");
      const later = Math.floor(Date.now() / 1000) + 600;
      utimesSync(f, later, later);
      ctx.dirtyBuildInputs = ["src.ts"];
    },
  );
  expectRed(
    "a stale checksum in the sums file is caught",
    checkChecksumFile,
    (ctx, dist) => {
      writeFileSync(join(dist, ctx.expected[0]), "REBUILT — different bytes");
    },
  );
  expectRed(
    "an artefact missing from the sums file is caught",
    checkChecksumFile,
    (ctx, dist) => {
      const only = `${sha256(join(dist, ctx.expected[0]))}  ${ctx.expected[0]}\n`;
      writeFileSync(join(dist, ctx.sumsName), only);
    },
  );
  expectRed(
    "a checksum copied into a document is caught",
    checkNoStrayChecksums,
    (_ctx, _d, docs) => {
      writeFileSync(
        join(docs, "TESTER.md"),
        "Sollwert: 3fee2b8668ad25c76921bfb44d2eefaafc85074bf6b8dad26decf5663220ed35  …_amd64.deb\n",
      );
    },
  );
  expectRed(
    "a build claim without a commit is caught",
    checkBuildClaimNamesCommit,
    (ctx) =>
      writeFileSync(
        ctx.statusFile,
        "```\nPakete  deb · rpm · pacman · AppImage · tar.gz gebaut\n```\n",
      ),
  );
  expectRed(
    "a build claim naming the wrong commit is caught",
    checkBuildClaimNamesCommit,
    (ctx) =>
      writeFileSync(
        ctx.statusFile,
        "```\nPakete  deb · rpm gebaut aus 9999999\n```\n",
      ),
  );
  expectRed(
    "removing the status line entirely is caught",
    checkBuildClaimNamesCommit,
    (ctx) =>
      writeFileSync(
        ctx.statusFile,
        "```\nnpm run verify  ✓\n```\n\nPakete gibt es hier nur in Prosa.\n",
      ),
  );
  expectRed(
    "a filename with the wrong version is caught",
    checkVersionAgreement,
    (ctx) => {
      ctx.expected = ["app_0.9.9_amd64.deb"];
    },
  );

  expectRed(
    "an artefact name with a space is caught",
    checkNoSpaceInNames,
    (ctx) => {
      ctx.expected = ["App Name-1.0.0.AppImage"];
    },
  );

  // --- counter-controls: situations that must stay green ---------------------------------

  expectGreen(
    "prose outside the fence that talks about packages",
    checkBuildClaimNamesCommit,
    (ctx) =>
      writeFileSync(
        ctx.statusFile,
        "```\nPakete  deb · rpm gebaut aus abc1234\n```\n\nPakete aus drei Läufen standen hier\neinen Tag lang unter der falschen Überschrift.\n",
      ),
  );
  expectGreen(
    "package.json edited only in `scripts`",
    checkNoNewerUncommittedInput,
    (ctx) => {
      ctx.dirtyBuildInputs = ["package.json"];
      ctx.packageBuildFieldsChanged = false;
    },
  );
  expectRed(
    "package.json edited in a build-relevant field",
    checkNoNewerUncommittedInput,
    (ctx) => {
      ctx.dirtyBuildInputs = ["package.json"];
      ctx.packageBuildFieldsChanged = true;
    },
  );
  expectGreen(
    "a document quoting a checksum that IS shipped",
    checkNoStrayChecksums,
    (ctx, dist, docs) =>
      writeFileSync(
        join(docs, "TESTER.md"),
        `Sollwert: ${sha256(join(dist, ctx.expected[0]))}\n`,
      ),
  );

  rmSync(base, { recursive: true, force: true });

  console.log("release gate — self-test\n");
  for (const r of results)
    console.log(
      `  ${r.ok ? "ok  " : "FAIL"}  ${r.name}${r.ok ? "" : ` — ${r.detail}`}`,
    );
  const failed = results.filter((r) => !r.ok).length;
  console.log(
    `\n${failed === 0 ? "self-test: clean" : `self-test: ${failed} of ${results.length} FAILED`}`,
  );
  return failed === 0 ? 0 : 1;
};
