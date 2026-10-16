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
 * Note on searching: the checks (release-checks.mjs) walk the tree with node:fs on purpose.
 * The interactive `grep` in this environment is a shell function that redirects to `ugrep --ignore-files`,
 * which silently skips ignored paths — during this very session it reported "no matches" for
 * a checksum that was sitting in docs/TEST-PROTOCOL-EN.md. A completeness check may not rest
 * on a tool that filters without saying so.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { BUILD_INPUTS, CHECKS, git } from "./release-checks.mjs";
import { selfTest } from "./release-selftest.mjs";

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
    // `build.appImage.artifactName` when set (2.0.3: no space — GitHub renames a space to a
    // dot on upload, and the checksum file then names a file nobody downloaded).
    AppImage: pkg.build.appImage?.artifactName
      ? pkg.build.appImage.artifactName.replace("${version}", version).replace("${ext}", "AppImage")
      : `${product}-${version}.AppImage`,
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

// --- main ----------------------------------------------------------------------------------

const root = process.cwd();

if (process.argv.includes("--self-test")) {
  process.exit(selfTest());
}

/**
 * What the tracker holds at the moment of a release — listed, not judged.
 *
 * On 2026-08-31 v2.0.1 fixed the 2.0.0 probe bug in the morning; at 18:18 a tester filed
 * issue #16 describing exactly that bug against 2.0.0, and it sat unanswered for 17 days.
 * The release notes named the fix; nobody looked at the tracker next to them. So the gate
 * prints every open issue and PR here, with the number of comments and who wrote the last
 * one — an unanswered report is visible as "0 comments" or "last: <reporter>".
 *
 * This never changes the exit code (a tracker is not a property of the artefacts), and it
 * never fails silently: if `gh` is missing or offline, that is said in the same place.
 */
const listTracker = () => {
  const run = (args) =>
    execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  try {
    const owner = run(["repo", "view", "--json", "owner", "-q", ".owner.login"]).trim();
    const issues = JSON.parse(
      run(["issue", "list", "--state", "open", "--json", "number,title,comments,author,createdAt"]),
    );
    const prs = JSON.parse(run(["pr", "list", "--state", "open", "--json", "number,title,comments,author,createdAt"]));
    const line = (kind, it) => {
      const last = it.comments.at(-1)?.author?.login;
      const reply = it.comments.length === 0 ? "0 comments" : `last: ${last}`;
      const flag = it.comments.length === 0 || last === it.author.login ? "  ← unanswered" : "";
      return `  ${kind} #${it.number}  ${it.createdAt.slice(0, 10)}  ${it.title.slice(0, 60)}  (${reply})${flag}`;
    };
    console.log(`\ntracker at release time (${owner}, listed, not judged):`);
    const all = [...issues.map((i) => line("issue", i)), ...prs.map((p) => line("pr   ", p))];
    console.log(all.length ? all.join("\n") : "  nothing open");
  } catch (cause) {
    console.log(
      `\ntracker at release time: could not be listed — ${cause instanceof Error ? cause.message.split("\n")[0] : String(cause)}`,
    );
  }
};

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
listTracker();
const failed = results.filter((r) => !r.ok);
console.log(
  `\n${failed.length === 0 ? "release gate: clean" : `release gate: ${failed.length} FAILED`}`,
);
process.exit(failed.length === 0 ? 0 : 1);
