/**
 * The nine checks of the release gate and the helpers they share.
 *
 * Split out of verify-release.mjs so the gate (verify-release.mjs) and its positive controls
 * (release-selftest.mjs) import the same functions. Why the gate exists: see verify-release.mjs.
 */
import { execFileSync } from "node:child_process";
import { createHash as hash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// --- helpers -----------------------------------------------------------------------------

export const git = (args, cwd) =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

/** Files whose change invalidates a build. Docs and screenshots do not. */
export const BUILD_INPUTS = [
  "src",
  "package.json",
  "electron.vite.config.ts",
  "build",
  "bin",
];

export const sha256 = (path) => {
  const h = hash("sha256");
  h.update(readFileSync(path));
  return h.digest("hex");
};

/** Recursive walk — no ignore-file semantics, no shell, nothing filtered behind our back. */
export const walk = (dir, filter, out = []) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      walk(path, filter, out);
    } else if (filter(path)) out.push(path);
  }
  return out;
};

const SHA256_IN_TEXT = /\b[0-9a-f]{64}\b/g;

// --- the checks --------------------------------------------------------------------------
//
// Each check takes a context and returns {ok, label, detail}. The context is explicit so the
// self-test can hand them a constructed world instead of the real repository.

/** 1 — every artefact the packaging config promises is actually on disk. */
export const checkArtefactsPresent = (ctx) => {
  const missing = ctx.expected.filter((a) => !existsSync(join(ctx.distDir, a)));
  return {
    ok: missing.length === 0,
    label: "every configured target produced a file",
    detail: missing.length
      ? `missing: ${missing.join(", ")}`
      : `${ctx.expected.length} files`,
  };
};

/** 2 — the artefacts are younger than the last commit that can change a build. */
export const checkNewerThanCode = (ctx) => {
  const stale = [];
  for (const name of ctx.expected) {
    const path = join(ctx.distDir, name);
    if (!existsSync(path)) continue;
    const mtime = Math.floor(statSync(path).mtimeMs / 1000);
    if (mtime < ctx.codeCommitTime)
      stale.push(`${name} predates ${ctx.codeCommit}`);
  }
  return {
    ok: stale.length === 0,
    label: "no artefact predates the last build-input commit",
    detail: stale.length
      ? stale.join("; ")
      : `all newer than ${ctx.codeCommit}`,
  };
};

/** 3 — they come from ONE run, not from three afternoons. */
export const checkOneRun = (ctx) => {
  const times = ctx.expected
    .map((n) => join(ctx.distDir, n))
    .filter((p) => existsSync(p))
    .map((p) => statSync(p).mtimeMs);
  if (times.length < 2)
    return { ok: true, label: "artefacts come from one run", detail: "n/a" };
  const spreadMin = (Math.max(...times) - Math.min(...times)) / 60000;
  return {
    ok: spreadMin <= ctx.maxSpreadMinutes,
    label: "artefacts come from one run",
    detail: `spread ${spreadMin.toFixed(1)} min (limit ${ctx.maxSpreadMinutes})`,
  };
};

/**
 * 4 — uncommitted build inputs newer than the packages: the build is already behind.
 *
 * package.json is treated by CONTENT, not by timestamp: editing `scripts` (adding this very
 * gate, for instance) cannot change a single byte of the packaged app, while `version`,
 * `main`, `dependencies` and `build` can. Comparing mtime here would demand a 100 MB rebuild
 * for a one-line script entry — and a gate that fires on things that cannot go wrong gets
 * switched off, taking the cases where it is right with it.
 */
export const checkNoNewerUncommittedInput = (ctx) => {
  const oldest = ctx.expected
    .map((n) => join(ctx.distDir, n))
    .filter((p) => existsSync(p))
    .reduce((min, p) => Math.min(min, statSync(p).mtimeMs), Infinity);
  const ahead = ctx.dirtyBuildInputs.filter((p) => {
    if (p === "package.json") return ctx.packageBuildFieldsChanged;
    const full = join(ctx.root, p);
    return existsSync(full) && statSync(full).mtimeMs > oldest;
  });
  return {
    ok: ahead.length === 0,
    label: "no uncommitted build input is newer than the packages",
    detail: ahead.length
      ? `changed since the build: ${ahead.join(", ")}`
      : "working tree settled",
  };
};

/** 5 — the checksum file covers exactly the artefacts, and every value is correct. */
export const checkChecksumFile = (ctx) => {
  const sumsPath = join(ctx.distDir, ctx.sumsName);
  if (!existsSync(sumsPath)) {
    return {
      ok: false,
      label: "checksum file is present and correct",
      detail: `no ${ctx.sumsName}`,
    };
  }
  const listed = new Map();
  for (const line of readFileSync(sumsPath, "utf8").split("\n")) {
    const m = line.match(/^([0-9a-f]{64})\s+\*?(.+)$/);
    if (m) listed.set(m[2].trim(), m[1]);
  }
  const problems = [];
  for (const name of ctx.expected) {
    const path = join(ctx.distDir, name);
    if (!existsSync(path)) continue;
    if (!listed.has(name)) problems.push(`not listed: ${name}`);
    else if (listed.get(name) !== sha256(path))
      problems.push(`checksum stale: ${name}`);
  }
  for (const name of listed.keys()) {
    if (!ctx.expected.includes(name))
      problems.push(`listed but not an artefact: ${name}`);
  }
  return {
    ok: problems.length === 0,
    label: "checksum file is present and correct",
    detail: problems.length
      ? problems.join("; ")
      : `${listed.size} entries verified`,
  };
};

/** 6 — no document repeats a checksum that no longer belongs to any shipped file. */
export const checkNoStrayChecksums = (ctx) => {
  const valid = new Set(
    ctx.expected
      .map((n) => join(ctx.distDir, n))
      .filter((p) => existsSync(p))
      .map((p) => sha256(p)),
  );
  const strays = [];
  for (const file of walk(ctx.docsDir, (p) => /\.(md|html|txt)$/.test(p))) {
    const text = readFileSync(file, "utf8");
    for (const found of text.match(SHA256_IN_TEXT) ?? []) {
      if (!valid.has(found))
        strays.push(`${relative(ctx.root, file)}: ${found.slice(0, 12)}…`);
    }
  }
  return {
    ok: strays.length === 0,
    label: "no document carries a checksum of a file that is not shipped",
    detail: strays.length
      ? strays.join("; ")
      : "documents point at the checksum file",
  };
};

/**
 * 7 — a status line claiming a build must name the commit it was built from.
 *
 * Only lines inside a fenced block count. The first version of this check read every line
 * starting with "Pakete", and promptly flagged the prose sentence explaining the incident
 * ("Pakete aus drei Läufen…") as a build claim. An unanchored pattern is as wide as its
 * prefix; the status table is the fenced block, so that is the scope.
 */
export const checkBuildClaimNamesCommit = (ctx) => {
  if (!existsSync(ctx.statusFile)) {
    return {
      ok: false,
      label: "build claims name their commit",
      detail: `no ${ctx.statusFile}`,
    };
  }
  const problems = [];
  let inFence = false;
  let claims = 0;
  for (const line of readFileSync(ctx.statusFile, "utf8").split("\n")) {
    if (line.trimStart().startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (!inFence) continue;
    if (!/^(Pakete|Packages)\s/.test(line.trim())) continue;
    claims += 1;
    const m = line.match(/\b([0-9a-f]{7,40})\b/);
    if (!m)
      problems.push(
        `claims a build without a commit: "${line.trim().slice(0, 60)}"`,
      );
    else if (
      !ctx.codeCommit.startsWith(m[1]) &&
      !m[1].startsWith(ctx.codeCommit)
    )
      problems.push(
        `claims build from ${m[1]}, build inputs last changed in ${ctx.codeCommit}`,
      );
  }
  // Without this, the rule could be escaped by moving the line out of the fenced block —
  // the narrowing above would then simply stop looking, and silence would read as compliance.
  if (claims === 0)
    problems.push('the status table has no "Pakete"/"Packages" line to check');
  return {
    ok: problems.length === 0,
    label: "build claims name their commit",
    detail: problems.length ? problems.join("; ") : `matches ${ctx.codeCommit}`,
  };
};

/** 8 — the version in the filenames is the version in package.json. */
export const checkVersionAgreement = (ctx) => {
  const wrong = ctx.expected.filter((n) => !n.includes(ctx.version));
  return {
    ok: wrong.length === 0,
    label: "filenames carry the package.json version",
    detail: wrong.length ? `off-version: ${wrong.join(", ")}` : ctx.version,
  };
};

/**
 * 9 — no artefact name contains a space. Added 2026-10-08: GitHub renames a space to a dot on
 * upload, so `SHA256SUMS-2.0.2.txt` named `ZimaOS Client-2.0.2.AppImage` while every user
 * downloaded `ZimaOS.Client-2.0.2.AppImage`. Measured on the published release: `sha256sum -c`
 * → "FAILED open or read" for the AppImage, and with `--ignore-missing` it was skipped
 * silently — the only file that could never be verified looked verified.
 */
export const checkNoSpaceInNames = (ctx) => {
  const spaced = ctx.expected.filter((n) => /\s/.test(n));
  return {
    ok: spaced.length === 0,
    label: "artefact names survive the upload unchanged (no spaces)",
    detail: spaced.length ? `renamed on upload: ${spaced.join(", ")}` : "none",
  };
};

export const CHECKS = [
  checkArtefactsPresent,
  checkNewerThanCode,
  checkOneRun,
  checkNoNewerUncommittedInput,
  checkChecksumFile,
  checkNoStrayChecksums,
  checkBuildClaimNamesCommit,
  checkVersionAgreement,
  checkNoSpaceInNames,
];
