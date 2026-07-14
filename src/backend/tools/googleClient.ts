// Lazy, lightweight accessor for the Google APIs the backend actually uses
// (Gmail + Calendar + OAuth2).
//
// Requiring the `googleapis` meta-package costs ~10s — it eagerly pulls in
// every generated Google API client — and that cost is far worse on a
// OneDrive-synced node_modules. Loading it at the top of the bundle blocked
// startup (the `ready` signal missed the main process's 20s timeout). Loading
// it lazily fixed startup, but only moved the ~10s *synchronous* freeze to the
// first Gmail/Calendar call — which, with the calendar/email monitors enabled,
// fires on a poll right after the renderer connects and froze the event loop
// long enough to swallow the user's first text + push-to-talk requests.
//
// The fix is to never load the meta-package. The same clients are available as
// per-API subpaths that load in well under 2s combined (gmail pulls the shared
// deps once; calendar is then ~25ms), and `OAuth2` is just google-auth-library
// (~0.4s). Everything is still lazy, so a turn that never touches Google pays
// nothing, and the one-time cost on first use is small enough not to stall the
// UI.
import type { gmail_v1, calendar_v3 } from 'googleapis'
import type { OAuth2Client as OAuth2ClientType } from 'google-auth-library'

export type OAuth2Client = OAuth2ClientType

type GmailFn = typeof import('googleapis/build/src/apis/gmail')['gmail']
type CalendarFn = typeof import('googleapis/build/src/apis/calendar')['calendar']
type OAuth2Ctor = typeof import('google-auth-library')['OAuth2Client']

let gmailFn: GmailFn | null = null
let calendarFn: CalendarFn | null = null
let oauth2Ctor: OAuth2Ctor | null = null

function loadGmail(): GmailFn {
  if (!gmailFn) {
    gmailFn = (require('googleapis/build/src/apis/gmail') as { gmail: GmailFn }).gmail
  }
  return gmailFn
}

function loadCalendar(): CalendarFn {
  if (!calendarFn) {
    calendarFn = (require('googleapis/build/src/apis/calendar') as { calendar: CalendarFn }).calendar
  }
  return calendarFn
}

function loadOAuth2(): OAuth2Ctor {
  if (!oauth2Ctor) {
    oauth2Ctor = (require('google-auth-library') as { OAuth2Client: OAuth2Ctor }).OAuth2Client
  }
  return oauth2Ctor
}

interface GoogleShim {
  gmail(opts: { version: 'v1'; auth: OAuth2Client }): gmail_v1.Gmail
  calendar(opts: { version: 'v3'; auth: OAuth2Client }): calendar_v3.Calendar
  auth: { readonly OAuth2: OAuth2Ctor }
}

let shim: GoogleShim | null = null

// Drop-in replacement for the `google` namespace from `googleapis`, covering
// exactly the three entry points the codebase uses: `google().gmail(...)`,
// `google().calendar(...)`, and `new (google().auth.OAuth2)(...)`. Each loads
// its underlying module on first use.
export function google(): GoogleShim {
  if (!shim) {
    shim = {
      gmail: (opts) => loadGmail()(opts),
      calendar: (opts) => loadCalendar()(opts),
      auth: {
        get OAuth2() {
          return loadOAuth2()
        },
      },
    }
  }
  return shim
}
