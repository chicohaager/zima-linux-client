import { BASE, FILES } from '@main/zima/endpoints'
import type { Probe } from './liveProbes'

/**
 * The probes of `npm run verify:live` that CHANGE something on the device — split out of
 * `liveProbes.ts` so the read-only table and the writing one cannot be confused for each
 * other at a glance. Everything here runs only with `--write`.
 *
 * The bodies are measured shapes, not guesses; each one carries the rejection that taught
 * it. See the comments below.
 */

const files = (path: string): string => `${BASE.files}${path}`

/**
 * Write probes, only with `--write`.
 *
 * Everything happens inside `<PROBE_ROOT>/zima-client-verify-<stamp>`, so the run cannot
 * touch anything the user cares about, and the folder is removed at the end. The stamp
 * comes from outside because a fixed name would collide with an interrupted earlier run.
 *
 * Each body below is a *candidate* shape: the shipped SDK proves the path and the method
 * but carries no request schema, so the shape is what the measurement decides. A 400 here
 * is a result, not a failure — it tells us the field names are different, and the report
 * says so instead of the client shipping a guess.
 */
export const writeProbes = (scratch: string, fileName: string): readonly Probe[] => [
  {
    id: 'write.create-folder',
    method: 'POST',
    path: files(FILES.folder),
    body: { path: scratch },
    asks: 'body shape of folder creation (measured call site in the UI: {path})',
  },
  {
    id: 'write.create-file',
    method: 'POST',
    path: files(FILES.entry),
    body: { path: `${scratch}/${fileName}` },
    asks: 'body shape of file creation',
  },
  {
    id: 'write.list-scratch',
    method: 'GET',
    path: files(FILES.entry),
    query: { path: scratch, index: 1, size: 10 },
    expect: 200,
    asks: 'positive control — the created entry must actually appear in the listing',
  },
  {
    id: 'write.copy-task-enum-probe',
    method: 'POST',
    path: files(FILES.taskCopy),
    // Deliberately invalid `user_select`: the OpenAPI validator answers with the list of
    // values it accepts, which is a far better source for an enum than picking the string
    // that sounds right. Expected to be rejected — that rejection IS the measurement.
    body: {
      src: [`${scratch}/${fileName}`],
      dst: scratch,
      user_select: 'zima-client-invalid-on-purpose',
    },
    expect: 400,
    asks: 'the allowed values of user_select, read off the validator instead of guessed',
  },
  {
    id: 'write.copy-task',
    method: 'POST',
    path: files(FILES.taskCopy),
    // Measured 2026-07-30, two rejections deep: `{src_files, dst}` answered `Error at
    // "/src": property "src" is missing`, then `{src, dst}` answered `Error at
    // "/user_select": property "user_select" is missing`. The gateway validates against
    // its OpenAPI schema and names the field it wants, so this shape was read off the
    // device rather than invented. `user_select` is the conflict policy.
    body: { src: [`${scratch}/${fileName}`], dst: scratch, user_select: 'skip' },
    asks: 'body shape of the copy task, and the task id it returns',
  },
  {
    id: 'write.move-to-trash',
    method: 'DELETE',
    path: files(FILES.moveToTrash),
    // Measured: an object body answers `value must be an array`. The body is a bare array
    // of paths — worth having in a comment, because "delete takes an object" is the
    // assumption every other endpoint here would suggest.
    body: [`${scratch}/${fileName}`],
    asks: 'body shape for moving to trash rather than deleting outright',
  },
  {
    id: 'write.delete-folder',
    method: 'DELETE',
    path: files(FILES.folder),
    body: [scratch],
    asks: 'cleanup — and the body shape of folder deletion (also a bare array)',
  },
]

/**
 * Deletes folders left behind by an interrupted run.
 *
 * Exists because the first `--write` run could not clean up: its delete body was the wrong
 * shape, so two scratch folders stayed on the device. A measurement tool that can litter
 * needs a way to tidy up through the same API it is measuring — deleting them by hand over
 * SSH would have hidden the fact that the client's delete path was broken.
 */
export const cleanupProbes = (paths: readonly string[]): readonly Probe[] =>
  paths.map((path, index) => ({
    id: `cleanup.folder-${index}`,
    method: 'DELETE' as const,
    path: files(FILES.folder),
    body: [path],
    expect: 200,
    asks: 'removes a scratch folder from an earlier interrupted run',
  }))

/**
 * Moves leftover FILES to the trash — used to tidy up after an upload measurement.
 *
 * Deliberately the trash and not the irreversible delete: a cleanup step that can destroy
 * data has no business running inside a measurement tool.
 */
export const cleanupFileProbes = (paths: readonly string[]): readonly Probe[] =>
  paths.map((path, index) => ({
    id: `cleanup.file-${index}`,
    method: 'DELETE' as const,
    path: files(FILES.moveToTrash),
    body: [path],
    expect: 200,
    asks: 'moves a leftover measurement file to the trash',
  }))
