// Several launch/open tools build a cmd.exe command line of the form
//   start "" "<value>"      (or)   code "<value>"
// where <value> is a path or URI. A literal double-quote lets the value break
// out of its quotes and append arbitrary commands; `%` triggers cmd.exe
// environment expansion; CR/LF can inject new command lines. Those characters
// never appear in a legitimate Windows path or the URIs we launch, so we reject
// them before interpolation. (`&`, `|`, `<`, `>` are deliberately allowed — they
// are inert while inside the surrounding double-quotes, and `&` is common in
// real folder names like "Rock & Roll". Spaces are fine — that is exactly why
// the value is wrapped in quotes.)
const SHELL_BREAKOUT_RE = /["%\r\n]/

export function hasShellBreakout(value: string): boolean {
  return SHELL_BREAKOUT_RE.test(value)
}

/**
 * Throws if `value` contains a character that could break out of a quoted
 * cmd.exe argument. Returns the value unchanged when safe, so it can be used
 * inline: `start "" "${assertNoShellBreakout(target, 'launch target')}"`.
 */
export function assertNoShellBreakout(value: string, label = 'value'): string {
  if (hasShellBreakout(value)) {
    throw new Error(`Refusing to run: ${label} contains an unsafe character (a quote, percent, or line break)`)
  }
  return value
}
