#!/usr/bin/env node
/**
 * Guards the claim "these packages are this commit's build".
 *
 * The reason this exists: on 2026-08-09 `dist/` held five files all named `2.0.0-alpha.1`
 * that came from three different runs — AppImage and tar.gz were six commits old, deb/rpm/
 * pacman five. The status document said `Pakete  deb · rpm · pacman · AppImage · tar.gz
 * gebaut` under the heading "the state of THIS commit". Nothing was wrong with any single
 * file; what was wrong was the sentence next to them. Artefacts age one at a time, under an
 * unchanged name, and a claim that names an action ("built") without naming what it was
 * built FROM becomes false with the next commit without anyone touching it.
 *
 * Second half of the same incident: the two SHA256 values lived in six documents as copied
 * prose. After a rebuild all six pointed at a package that no longer existed — and
 * `install.sh` compares automatically, so a tester would have been told the download looks
 * tampered with, for what was a maintenance slip.
 *
 * So the checks below never ask "does the file exist" alone. They ask whether the artefacts
 * can possibly be what the repository says they are.
 *
 *   node scripts/verify-release.mjs              # gate: exit 0 clean, 1 on any failure
 *   node scripts/verify-release.mjs --self-test  # positive controls: every rule must fire
 *
 * The self-test is not decoration. A gate that has never been red is an assurance without a
 * check — see docs/V2-STATUS.md and the privacy gate that reported "clean" for months while
 * its allowlist covered the very pattern it searched for.
 *
 * Note on searching: this script walks the tree with node:fs on purpose. The interactive
 * `grep` in this environment is a shell function that redirects to `ugrep --ignore-files`,
 * which silently skips ignored paths — during this very session it reported "no matches" for
 * a checksum that was sitting in docs/TEST-PROTOCOL-EN.md. A completeness check may not rest
 * on a tool that filters without saying so.
 */
import { execFileSync } from "node:child_process";
import { createHash as hash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

// --- helpers -----------------------------------------------------------------------------

const git = (args, cwd) =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

/** Files whose change invalidates a build. Docs and screenshots do not. */
const BUILD_INPUTS = [
  "src",
  "package.json",
  "electron.vite.config.ts",
  "build",
  "bin",
];

const sha256 = (path) => {
  const h = hash("sha256");
  h.update(readFileSync(path));
  return h.digest("hex");
};

/** Recursive walk — no ignore-file semantics, no shell, nothing filtered behind our back. */
const walk = (dir, filter, out = []) => {
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
const checkArtefactsPresent = (ctx) => {
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
const checkNewerThanCode = (ctx) => {
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
const checkOneRun = (ctx) => {
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
const checkNoNewerUncommittedInput = (ctx) => {
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
const checkChecksumFile = (ctx) => {
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
const checkNoStrayChecksums = (ctx) => {
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
const checkBuildClaimNamesCommit = (ctx) => {
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
const checkVersionAgreement = (ctx) => {
  const wrong = ctx.expected.filter((n) => !n.includes(ctx.version));
  return {
    ok: wrong.length === 0,
    label: "filenames carry the package.json version",
    detail: wrong.length ? `off-version: ${wrong.join(", ")}` : ctx.version,
  };
};

const CHECKS = [
  checkArtefactsPresent,
  checkNewerThanCode,
  checkOneRun,
  checkNoNewerUncommittedInput,
  checkChecksumFile,
  checkNoStrayChecksums,
  checkBuildClaimNamesCommit,
  checkVersionAgreement,
];

// --- context from the real repository -----------------------------------------------------

const buildRealContext = (root) => {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const version = pkg.version;
  const product = pkg.build.productName;
  const targets = pkg.build.linux.target;

  // electron-builder's own naming, per target.
  const nameFor = {
    deb: `zima-linux-client_${version}_amd64.deb`,
    rpm: `zima-linux-client-${version}.x86_64.rpm`,
    pacman: `zima-linux-client-${version}.pacman`,
    "tar.gz": `zima-linux-client-${version}.tar.gz`,
    AppImage: `${product}-${version}.AppImage`,
  };
  const expected = targets.map((t) => {
    if (!nameFor[t])
      throw new Error(
        `unknown target "${t}" — teach verify-release.mjs its filename`,
      );
    return nameFor[t];
  });

  const inputs = BUILD_INPUTS.filter((p) => existsSync(join(root, p)));
  const BUILD_FIELDS = ["version", "main", "dependencies", "build"];

  /**
   * The newest commit that can have changed the packaged bytes.
   *
   * A commit touching only package.json's `scripts` (registering this gate, say) is skipped:
   * counting it would declare a perfectly current build stale and demand a 100 MB rebuild for
   * a one-line script entry. A gate that cries wolf gets switched off.
   */
  const findCodeCommit = () => {
    const log = git(
      ["log", "--format=%h %ct", "-n", "100", "--", ...inputs],
      root,
    ).split("\n");
    for (const line of log.filter(Boolean)) {
      const [h, t] = line.split(" ");
      const touched = git(["show", "--name-only", "--format=", "-1", h], root)
        .split("\n")
        .filter(Boolean)
        .filter((f) => inputs.some((i) => f === i || f.startsWith(`${i}/`)));
      if (touched.some((f) => f !== "package.json")) return { h, t: Number(t) };
      try {
        const now = JSON.parse(git(["show", `${h}:package.json`], root));
        const before = JSON.parse(git(["show", `${h}^:package.json`], root));
        if (
          BUILD_FIELDS.some(
            (f) => JSON.stringify(now[f]) !== JSON.stringify(before[f]),
          )
        )
          return { h, t: Number(t) };
      } catch {
        return { h, t: Number(t) }; // cannot compare (root commit) — treat as build-relevant
      }
    }
    const [h, t] = log[0].split(" ");
    return { h, t: Number(t) };
  };

  const { h: codeCommit, t: codeCommitTime } = findCodeCommit();

  const dirtyBuildInputs = git(["status", "--porcelain"], root)
    .split("\n")
    .filter(Boolean)
    .map((l) => l.slice(3).trim())
    .filter((p) => inputs.some((i) => p === i || p.startsWith(`${i}/`)));

  // Same field list as above: only these can change the packaged bytes.
  let packageBuildFieldsChanged = false;
  try {
    const committed = JSON.parse(
      git(["show", `${codeCommit}:package.json`], root),
    );
    packageBuildFieldsChanged = BUILD_FIELDS.some(
      (f) => JSON.stringify(pkg[f]) !== JSON.stringify(committed[f]),
    );
  } catch {
    packageBuildFieldsChanged = true; // cannot read the committed side — assume the worst
  }

  return {
    root,
    distDir: join(root, "dist"),
    docsDir: join(root, "docs"),
    statusFile: join(root, "docs", "V2-STATUS.md"),
    sumsName: `SHA256SUMS-${version}.txt`,
    version,
    expected,
    codeCommit,
    codeCommitTime,
    dirtyBuildInputs,
    packageBuildFieldsChanged,
    maxSpreadMinutes: 60,
  };
};

// --- self-test: every rule must be able to go red -----------------------------------------

const selfTest = () => {
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

// --- main ----------------------------------------------------------------------------------

const root = process.cwd();

if (process.argv.includes("--self-test")) {
  process.exit(selfTest());
}

const ctx = buildRealContext(root);
const results = CHECKS.map((c) => c(ctx));

console.log(
  `release gate — ${ctx.version}, build inputs last changed in ${ctx.codeCommit}\n`,
);
for (const r of results) {
  console.log(
    `  ${r.ok ? "ok  " : "FAIL"}  ${r.label}${r.detail ? ` (${r.detail})` : ""}`,
  );
}
const failed = results.filter((r) => !r.ok);
console.log(
  `\n${failed.length === 0 ? "release gate: clean" : `release gate: ${failed.length} FAILED`}`,
);
process.exit(failed.length === 0 ? 0 : 1);
