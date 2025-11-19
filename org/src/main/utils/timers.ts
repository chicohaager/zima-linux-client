const intervalTimers: Set<NodeJS.Timeout> = new Set()
const timeoutTimers: Set<NodeJS.Timeout> = new Set()

/**
 * Creates an interval timer and tracks it for later management.
 *
 * @param callback - The function to execute at each interval.
 * @param ms - The time, in milliseconds, between each execution.
 * @returns for use with {@link clearIntervalTask} or {@link clearIntervalTasks}.
 */
export function setIntervalTask(callback: () => void, ms: number): NodeJS.Timeout {
  const timer = setInterval(callback, ms)
  intervalTimers.add(timer)
  return timer
}

/**
 * Creates a timeout timer and tracks it for later management. Automatically removes it after execution.
 *
 * @param callback - The function to execute after the timeout period.
 * @param ms - The time, in milliseconds, before execution.
 * @returns for use with {@link clearTimeoutTask} or {@link clearTimeoutTasks}.
 */
export function setTimeoutTask(callback: () => void, ms: number): NodeJS.Timeout {
  const timer = setTimeout(() => {
    timeoutTimers.delete(timer)
    callback()
  }, ms)
  timeoutTimers.add(timer)
  return timer
}

/**
 * Clears a specific interval timer and removes it from tracking.
 *
 * @param timer - The interval timer to clear.
 */
export function clearIntervalTask(timer: NodeJS.Timeout): void {
  clearInterval(timer)
  intervalTimers.delete(timer)
}

/**
 * Clears multiple interval timers and removes them from tracking.
 * @param timers - The interval timers to clear.
 */
export function clearIntervalTasks(timers: NodeJS.Timeout[]): void {
  for (const timer of timers) {
    clearIntervalTask(timer)
  }
}

/**
 * Clears a specific timeout timer and removes it from tracking.
 *
 * @param timer - The timeout timer to clear.
 */
export function clearTimeoutTask(timer: NodeJS.Timeout): void {
  clearTimeout(timer)
  timeoutTimers.delete(timer)
}

/**
 * Clears multiple timeout timers and removes them from tracking.
 * @param timers - The timeout timers to clear.
 */
export function clearTimeoutTasks(timers: NodeJS.Timeout[]): void {
  for (const timer of timers) {
    clearTimeoutTask(timer)
  }
}

/**
 * Clears all interval timers and removes them from tracking.
 */
export function clearAllIntervalTasks(): void {
  const timers = Array.from(intervalTimers)
  for (const timer of timers) {
    clearInterval(timer)
    intervalTimers.delete(timer)
  }
}

/**
 * Clears all timeout timers and removes them from tracking.
 */
export function clearAllTimeoutTasks(): void {
  const timers = Array.from(timeoutTimers)
  for (const timer of timers) {
    clearTimeout(timer)
    timeoutTimers.delete(timer)
  }
}

/**
 * Clears all tracked interval and timeout timers.
 */
export function clearAllTasks(): void {
  clearAllIntervalTasks()
  clearAllTimeoutTasks()
}
