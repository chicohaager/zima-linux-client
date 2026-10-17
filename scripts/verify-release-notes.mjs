#!/usr/bin/env node
/**
 * Release-notes gate: does every "fixed" section describe a fault users actually had?
 *
 * 🔴 Why this exists. The first draft of the 2.0.4 notes (2026-10-17) had a section "Remote
 * ID card keeps what you typed" — a fix for a fault introduced by 5dd8198, AFTER v2.0.3. No
 * release ever carried it; the section would have told users about a bug they never saw.
 * It was caught by hand, and nothing in the process would have caught it the next time.
 *
 * Two mechanisms that do NOT work, both measured on that very case:
 *  - "is the fix commit newer than the last tag?" — every fix is.
 *  - `git blame` on the lines the fix replaces — b5aeca7 replaced `{remoteOpen && (` and
 *    `)}`, lines that stood word for word in v2.0.3. The fault was not in those lines; it
 *    came from 5dd8198 moving the state into a component that unmounts. Line provenance
 *    reported "2 of 2 replaced lines were in v2.0.3" for a fault no release had.
 *
 * What works is asking the behaviour: run the regression tests the fix ADDS against the code
 * of the last release. ALL of them green there ⇒ nothing shows the fault in that release ⇒
 * the section is wrong (any single green test proves nothing: counter-case tests pass on old
 * code by design). At least one red is weaker evidence — a test of new behaviour is red on
 * old code too — so it only means "not refuted". A test that cannot even load on the old
 * code is reported as inconclusive, never as red: a missing import must not read as a
 * shipped fault.
 *
 * Contract for the notes: every `### ` section names its commits in an HTML comment, which
 * GitHub does not render:
 *
 *     <!-- fixes: <hash> [path-prefix ...] -->   a fault users had; the fix must carry a regression test
 *     <!-- new: <hash> -->                       new behaviour; must not be in the last release already
 *     <!-- none -->                              sections with no code behind them (Verified, Install)
 *     <!-- fixes: <hash> checked: <how> -->       no regression test; the hand check is printed verbatim
 *
 * Path prefixes pick the tests that belong to the section, for a commit that serves several:
 * b5aeca7 carries the Remote ID tests AND the Photos count-line tests, and the latter are red
 * on v2.0.3 for a reason of their own (the new text key). Without the prefix they vouched
 * for the Remote ID section.
 *
 * Usage: node scripts/verify-release-notes.mjs <notes.md> [--since <tag>] [--until <ref>]
 *        (--since: last release, default the newest tag; --until: the release described,
 *        default HEAD — pass the new tag once it exists)
 *        node scripts/verify-release-notes.mjs --self-test
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const git = (args, cwd) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
const isAncestor = (a, b, cwd) =>
  spawnSync("git", ["merge-base", "--is-ancestor", a, b], { cwd }).status === 0;

const isTestFile = (file) => file.includes("__tests__/") || /\.test\.[cm]?[jt]sx?$/.test(file);

/** Sections of the notes with their markers. */
export const parseNotes = (text) => {
  const sections = [];
  let current = null;
  for (const line of text.split("\n")) {
    const heading = line.match(/^### (.+)$/);
    if (heading) {
      current = { title: heading[1].trim(), markers: [] };
      sections.push(current);
      continue;
    }
    if (current === null) continue;
    for (const m of line.matchAll(/<!--\s*(fixes|new|none)\b:?([^>]*?)-->/g)) {
      const [spec, checked] = m[2].split(/\bchecked:/);
      const [hash, ...prefixes] = spec.trim().split(/\s+/).filter(Boolean);
      current.markers.push({ kind: m[1], hash: hash ?? null, prefixes, checked: checked?.trim() || null });
    }
  }
  return sections;
};

/** Test files the commit touches, and the names of the tests it adds to them. */
export const addedTests = (commit, cwd, prefixes = []) => {
  const files = new Map(); // file -> [test names]
  let file = null;
  for (const line of git(["diff", "-U0", "--no-renames", `${commit}^`, commit], cwd).split("\n")) {
    const header = line.match(/^\+\+\+ (?:b\/(.+)|\/dev\/null)$/);
    if (header) {
      file =
        header[1] && isTestFile(header[1]) &&
        (prefixes.length === 0 || prefixes.some((p) => header[1].startsWith(p)))
          ? header[1]
          : null;
      continue;
    }
    if (file === null) continue;
    const t = line.match(/^\+\s*(?:it|test)\(\s*(['"`])(.+?)\1/);
    if (t) files.set(file, [...(files.get(file) ?? []), t[2]]);
  }
  return files;
};

/**
 * Runs the given test files, as they are at `commit`, against the code of `tag`.
 * Returns test name -> "passed" | "failed" | "missing" (did not run: load error, renamed …).
 */
export const runAtTag = (commit, tests, tag, cwd) => {
  const tree = mkdtempSync(join(tmpdir(), "notes-gate-tree-"));
  rmSync(tree, { recursive: true });
  git(["worktree", "add", "-q", "--detach", tree, tag], cwd);
  try {
    symlinkSync(join(cwd, "node_modules"), join(tree, "node_modules"));
    for (const file of tests.keys()) {
      mkdirSync(dirname(join(tree, file)), { recursive: true });
      writeFileSync(join(tree, file), git(["show", `${commit}:${file}`], cwd));
    }
    const report = join(tree, "notes-gate-report.json");
    spawnSync(
      "npx",
      ["vitest", "run", ...tests.keys(), "--reporter=json", `--outputFile=${report}`],
      { cwd: tree, encoding: "utf8" },
    );
    const status = new Map();
    const json = existsSync(report) ? JSON.parse(readFileSync(report, "utf8")) : { testResults: [] };
    for (const fileResult of json.testResults ?? [])
      for (const a of fileResult.assertionResults ?? []) status.set(a.title, a.status);
    const out = new Map();
    for (const names of tests.values())
      for (const n of names) {
        const s = status.get(n);
        out.set(n, s === "passed" ? "passed" : s === "failed" ? "failed" : "missing");
      }
    return out;
  } finally {
    git(["worktree", "remove", "--force", tree], cwd);
  }
};

/** The verdict for one `fixes:` commit, from the per-test outcomes on the tag. */
export const judgeFix = (outcomes, tag) => {
  if (outcomes.size === 0)
    return { ok: false, why: "adds no regression test — whether users had the fault cannot be shown" };
  /*
   * ALL green refutes, not ANY green. A fix brings counter-case tests too — behaviour that
   * must stay as it was, and therefore passes on the old code by design (6dddb1d: "passes
   * name and size through unchanged"). The first version refused on any green test and
   * turned down that shipped fix. What shows the fault is a test that is RED on the tag;
   * only when none is red does nothing show the fault was ever there.
   */
  const failed = [...outcomes].filter(([, s]) => s === "failed").map(([n]) => n);
  const missing = [...outcomes].filter(([, s]) => s === "missing").map(([n]) => n);
  if (failed.length > 0)
    return {
      ok: true,
      why: `${failed.length} of ${outcomes.size} added test(s) red on ${tag} ("${failed[0]}") — the fault was there`,
    };
  if (missing.length > 0)
    return {
      ok: false,
      why: `inconclusive — "${missing[0]}" did not run on ${tag} (load error or renamed); check by hand`,
    };
  return {
    ok: false,
    why: `all ${outcomes.size} added test(s) pass on ${tag} — users never had this fault`,
  };
};

export const checkNotes = (text, since, cwd, run = runAtTag, until = "HEAD") => {
  const results = [];
  for (const section of parseNotes(text)) {
    const at = `"${section.title}"`;
    if (section.markers.length === 0) {
      results.push({ ok: false, line: `${at}: no <!-- fixes|new|none --> marker — which commit is this about?` });
      continue;
    }
    for (const m of section.markers) {
      if (m.kind === "none") {
        results.push({ ok: true, line: `${at}: none (no code claimed)` });
        continue;
      }
      if (m.hash === null) {
        results.push({ ok: false, line: `${at}: ${m.kind} without a commit` });
        continue;
      }
      const full = spawnSync("git", ["rev-parse", "--verify", "-q", `${m.hash}^{commit}`], {
        cwd,
        encoding: "utf8",
      }).stdout.trim();
      if (full === "") {
        results.push({ ok: false, line: `${at}: ${m.hash} is not a commit in this repository` });
        continue;
      }
      if (isAncestor(full, since, cwd)) {
        results.push({ ok: false, line: `${at}: ${m.hash} is already in ${since} — not part of this release` });
        continue;
      }
      // The other end. The 2.0.4 notes listed 6f31c85 and 0dc8f4d under "What else changed";
      // both came after the v2.0.4 tag (4156169), so the release did not contain them.
      if (!isAncestor(full, until, cwd)) {
        results.push({ ok: false, line: `${at}: ${m.hash} is not in ${until} — the release does not contain it` });
        continue;
      }
      if (m.kind === "new") {
        results.push({ ok: true, line: `${at}: new ${m.hash}` });
        continue;
      }
      if (m.checked !== null) {
        // Visible, never silent: the reason is printed word for word, so a reviewer reads
        // what stands in for the test. An empty `checked:` is no reason.
        results.push({ ok: true, line: `${at}: fixes ${m.hash} — checked by hand: ${m.checked}` });
        continue;
      }
      const tests = addedTests(full, cwd, m.prefixes);
      const verdict = judgeFix(tests.size ? run(full, tests, since, cwd) : new Map(), since);
      const scope = m.prefixes.length ? ` [${m.prefixes.join(" ")}]` : "";
      results.push({ ok: verdict.ok, line: `${at}: fixes ${m.hash}${scope} — ${verdict.why}` });
    }
  }
  return results;
};

// --- self-test ---------------------------------------------------------------------------

const selfTest = (root) => {
  const results = [];
  const record = (name, ok, detail) => results.push({ name, ok, detail });

  // 1 — the decision table, with a stand-in runner (no checkout, no vitest).
  const cases = [
    ["no regression test fails", new Map(), false, "adds no regression test"],
    ["all tests green on the tag fails", new Map([["keeps x", "passed"], ["y", "passed"]]), false, "users never had this fault"],
    ["a test that did not run is inconclusive", new Map([["x", "missing"]]), false, "inconclusive"],
    ["green and missing, nothing red: inconclusive", new Map([["x", "passed"], ["y", "missing"]]), false, "inconclusive"],
    ["all tests red on the tag pass", new Map([["x", "failed"], ["y", "failed"]]), true, "the fault was there"],
    ["one red among green counter-cases passes", new Map([["x", "failed"], ["unchanged", "passed"]]), true, "1 of 2"],
  ];
  for (const [name, outcomes, expectOk, reason] of cases) {
    const v = judgeFix(outcomes, "v1");
    record(name, v.ok === expectOk && v.why.includes(reason), v.why);
  }

  // 2 — the notes contract, against this repository's history with a stand-in runner.
  const red = () => new Map([["t", "failed"]]);
  const contract = [
    ["a section without marker fails", "### D\ntext\n", false, "no <!-- fixes|new|none --> marker"],
    ["a commit already in v2.0.3 fails", "### E\n<!-- new: 1b7efab -->\n", false, "is already in v2.0.3"],
    ["an unknown hash fails", "### F\n<!-- new: deadbee -->\n", false, "is not a commit"],
    ["none passes", "### Install\n<!-- none -->\n", true, "none (no code claimed)"],
    ["a hand check is printed verbatim", "### G\n<!-- fixes: 4156169 checked: v2.0.3 had ^43.7.9 -->\n", true, "checked by hand: v2.0.3 had ^43.7.9"],
    ["an empty hand check is no reason", "### H\n<!-- fixes: 4156169 checked: -->\n", false, "4156169"],
    ["a hand check does not excuse a released commit", "### I\n<!-- fixes: 1b7efab checked: x -->\n", false, "is already in v2.0.3"],
    ["a commit after the described release fails", "### J\n<!-- new: 0dc8f4d -->\n", false, "is not in v2.0.4"],
    ["a commit inside the described release passes", "### K\n<!-- new: 4156169 -->\n", true, "new 4156169"],
  ];
  for (const [name, notes, expectOk, reason] of contract) {
    const r = checkNotes(notes, "v2.0.3", root, red, "v2.0.4");
    record(name, r.length > 0 && r.every((x) => x.ok) === expectOk && r.some((x) => x.line.includes(reason)),
      r.map((x) => x.line).join("; "));
  }

  // 3 — the case this gate was written for, end to end with the real runner: b5aeca7 fixed a
  // fault that 5dd8198 introduced after v2.0.3. Its regression tests must pass on v2.0.3,
  // so the section must be refused. And the counter-case: 6dddb1d fixed `sort=modified`,
  // which v2.0.3 shipped — its tests must be red there, so that section must pass.
  if (spawnSync("git", ["rev-parse", "-q", "--verify", "b5aeca7^{commit}"], { cwd: root }).status === 0) {
    const unshipped = checkNotes(
      "### Remote ID\n<!-- fixes: b5aeca7 src/renderer/src/features/devices/ -->\n", "v2.0.3", root);
    record("end to end: the never-shipped Remote ID fix is refused",
      unshipped.length === 1 && !unshipped[0].ok && unshipped[0].line.includes("users never had this fault"),
      unshipped.map((x) => x.line).join("; "));
    const shipped = checkNotes("### sort\n<!-- fixes: 6dddb1d -->\n", "v2.0.3", root);
    record("end to end: the shipped sort=modified fix passes",
      shipped.length === 1 && shipped[0].ok, shipped.map((x) => x.line).join("; "));
    const elsewhere = checkNotes("### x\n<!-- fixes: b5aeca7 src/nowhere/ -->\n", "v2.0.3", root);
    record("a prefix that selects no test leaves the fix without a regression test",
      elsewhere.length === 1 && !elsewhere[0].ok && elsewhere[0].line.includes("adds no regression test"),
      elsewhere.map((x) => x.line).join("; "));
  }

  console.log("release-notes gate — self-test\n");
  for (const r of results) console.log(`  ${r.ok ? "ok  " : "FAIL"}  ${r.name}${r.ok ? "" : ` — ${r.detail}`}`);
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${failed === 0 ? "self-test: clean" : `self-test: ${failed} of ${results.length} FAILED`}`);
  return failed === 0 ? 0 : 1;
};

// --- main --------------------------------------------------------------------------------

const args = process.argv.slice(2);
const root = git(["rev-parse", "--show-toplevel"], process.cwd());
if (args[0] === "--self-test") process.exit(selfTest(root));
if (args.length === 0) {
  console.error("usage: verify-release-notes.mjs <notes.md> [--since <tag>] | --self-test");
  process.exit(2);
}
const sinceAt = args.indexOf("--since");
const since =
  sinceAt >= 0 ? args[sinceAt + 1] : git(["describe", "--tags", "--abbrev=0", "HEAD"], root);
const untilAt = args.indexOf("--until");
const until = untilAt >= 0 ? args[untilAt + 1] : "HEAD";
const results = checkNotes(readFileSync(args[0], "utf8"), since, root, runAtTag, until);
console.log(`release-notes gate — ${since}..${until}\n`);
for (const r of results) console.log(`  ${r.ok ? "ok  " : "FAIL"}  ${r.line}`);
if (results.length === 0) {
  console.log("\nrelease-notes gate: no ### sections found — nothing checked, that is not clean");
  process.exit(1);
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${failed === 0 ? "release-notes gate: clean" : `release-notes gate: ${failed} FAILED`}`);
process.exit(failed === 0 ? 0 : 1);
