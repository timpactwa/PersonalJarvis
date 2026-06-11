import { describe, it, expect } from 'vitest'
import type { BackendEvent, RendererEvent, EmailDraft, EmailMessage, CalendarEventDraft } from '../../src/backend/types'

describe('event types', () => {
  it('BackendEvent state event has correct shape', () => {
    const event: BackendEvent = { type: 'state', state: 'idle' }
    expect(event.type).toBe('state')
  })

  it('BackendEvent transcript event has correct shape', () => {
    const event: BackendEvent = { type: 'transcript', role: 'assistant', text: 'Hello', partial: false }
    expect(event.type).toBe('transcript')
    expect(event.role).toBe('assistant')
    expect(event.partial).toBe(false)
  })

  it('BackendEvent confirm_request has id, action, detail', () => {
    const event: BackendEvent = { type: 'confirm_request', id: 'abc', action: 'Delete file', detail: '/tmp/x' }
    expect(event.type).toBe('confirm_request')
    expect(event.id).toBe('abc')
  })

  it('BackendEvent email_compose carries a full EmailDraft', () => {
    const draft: EmailDraft = { id: '1', to: 'a@b.com', cc: '', bcc: '', subject: 'Hi', body: 'Hello' }
    const event: BackendEvent = { type: 'email_compose', draft }
    expect(event.type).toBe('email_compose')
    expect(event.draft.to).toBe('a@b.com')
    expect(event.draft.subject).toBe('Hi')
  })

  it('BackendEvent email_view carries an array of EmailMessages', () => {
    const emails: EmailMessage[] = [
      { id: 'm1', from: 'sender@x.com', subject: 'Test', date: '2026-06-11', body: 'Body text' },
    ]
    const event: BackendEvent = { type: 'email_view', emails }
    expect(event.type).toBe('email_view')
    expect(event.emails).toHaveLength(1)
    expect(event.emails[0].from).toBe('sender@x.com')
  })

  it('BackendEvent event_compose carries a CalendarEventDraft', () => {
    const ev: CalendarEventDraft = { id: 'e1', title: 'Dinner', start: '2026-06-12T19:00:00', end: '2026-06-12T21:00:00', description: '' }
    const event: BackendEvent = { type: 'event_compose', event: ev }
    expect(event.type).toBe('event_compose')
    expect(event.event.title).toBe('Dinner')
  })

  it('RendererEvent audio event has correct shape', () => {
    const event: RendererEvent = { type: 'audio', data: Buffer.from([]) }
    expect(event.type).toBe('audio')
  })

  it('RendererEvent email_send carries a draft', () => {
    const draft: EmailDraft = { id: '2', to: 'b@c.com', cc: '', bcc: '', subject: 'Reply', body: 'Content' }
    const event: RendererEvent = { type: 'email_send', draft }
    expect(event.type).toBe('email_send')
    expect(event.draft.subject).toBe('Reply')
  })

  it('RendererEvent email_draft_save carries a draft', () => {
    const draft: EmailDraft = { id: '3', to: 'd@e.com', cc: '', bcc: '', subject: 'Draft', body: '...' }
    const event: RendererEvent = { type: 'email_draft_save', draft }
    expect(event.type).toBe('email_draft_save')
  })

  it('RendererEvent event_create carries a CalendarEventDraft', () => {
    const ev: CalendarEventDraft = { id: 'e2', title: 'Meeting', start: '2026-06-13T10:00:00', end: '2026-06-13T11:00:00', description: 'Standup' }
    const event: RendererEvent = { type: 'event_create', event: ev }
    expect(event.type).toBe('event_create')
    expect(event.event.title).toBe('Meeting')
  })

  it('RendererEvent confirm_response carries id and approved flag', () => {
    const event: RendererEvent = { type: 'confirm_response', id: 'xyz', approved: true }
    expect(event.type).toBe('confirm_response')
    expect(event.approved).toBe(true)
  })
})
