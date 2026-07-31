import { BrowserWindow, ipcMain } from 'electron'
import { channelSchemas, type ChannelName, type HandlerInput } from '@shared/contract'
import { appError, isErr, type AppError, type Result } from '@shared/result'
import { logger } from '@main/logging/logger'
import * as session from '@main/session'
import type { DeviceContext } from '@main/zima/client'

/**
 * The IPC boundary helpers, shared by every handler module.
 *
 * Two invariants live here, in one place, so no feature can forget them:
 *
 *  1. **Every request is validated** against its channel schema before a handler sees it.
 *  2. **Every answer is an envelope.** A throw, a validation failure and a device error all
 *     come back as `{ok:false, error}` with a kind and an i18n key — never as an empty list
 *     or a bare `null`, which the renderer cannot tell apart from "there is nothing".
 */

export type Wire<T> = { ok: true; value: T } | { ok: false; error: AppError }

/**
 * Runs `body` with address plus token for the active device.
 *
 * Every feature handler starts this way, so "no session" is answered in one place with one
 * error kind. Handlers that built their own context would each get to invent their own
 * behaviour for "not signed in", and one of them would return an empty list.
 */
export const withDevice = async <T>(
  body: (ctx: DeviceContext) => Promise<Result<T>>,
): Promise<Wire<T>> => {
  const ctx = await session.deviceContext()
  if (isErr(ctx)) return wireError(ctx.error)
  return toWire(await body(ctx.value))
}

/** The window that owns modal dialogs. A null is handled by callers, never assumed away. */
export const focusedWindow = (): BrowserWindow | null =>
  BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null

export const toWire = <T>(result: Result<T>): Wire<T> =>
  isErr(result)
    ? // `cause` is dropped on purpose: it can hold an Error with a stack, and structured
      // clone would either fail or ship internals to the renderer. The kind, message and
      // context survive — that is what the UI and the log need.
      { ok: false, error: { ...result.error, cause: undefined } }
    : { ok: true, value: result.value }

export const wireError = (error: AppError): Wire<never> => ({ ok: false, error })

/**
 * Registers one handler, with validation and a catch that reports instead of swallowing.
 *
 * 🔴 The handler receives the input **typed by the channel's schema**, not as `unknown`.
 *
 * It used to hand over `unknown`, and all 28 handlers opened with a hand-written
 * `input as { path: string; … }`. Those casts are assertions with nothing behind them: the
 * schema is the truth, the cast is a copy of it, and a copy is exactly what stops agreeing
 * when one side changes. Adding a field to a schema left the cast silently short; renaming one
 * left the handler reading `undefined` from a field the validator had just approved under its
 * new name — with no error anywhere, because zod validated the real shape and TypeScript
 * believed the cast. Deriving the type instead makes that a compile error.
 */
export const handle = <C extends ChannelName>(
  channel: C,
  run: (input: HandlerInput<C>) => Promise<Wire<unknown>>,
): void => {
  ipcMain.handle(channel, async (_event, rawInput: unknown) => {
    const parsed = channelSchemas[channel].request.safeParse(rawInput ?? {})
    if (!parsed.success) {
      logger.error('ipc.invalid-request', { channel, issues: parsed.error.issues })
      return wireError(
        appError('internal', `invalid request for ${channel}`, 'error.invalidRequest', {
          channel,
          // The first issue's path names the offending field, which turns "invalid request"
          // into something actionable in a bug report.
          field: parsed.error.issues[0]?.path.join('.') ?? '?',
        }),
      )
    }
    try {
      return await run(parsed.data as HandlerInput<C>)
    } catch (cause) {
      logger.error('ipc.handler-threw', { channel, cause: String(cause) })
      return wireError(
        appError('internal', `handler failed for ${channel}`, 'error.internal', { channel }),
      )
    }
  })
}
