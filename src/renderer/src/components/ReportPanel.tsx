import { marked } from 'marked'

interface ReportContent {
  format: 'html' | 'md'
  content: string
}

interface ReportPanelProps {
  content: ReportContent | null
  onClose: () => void
}

export function ReportPanel({ content, onClose }: ReportPanelProps): JSX.Element | null {
  if (!content) return null

  const mdHtml = content.format === 'md' ? (marked.parse(content.content, { async: false }) as string) : ''
  const htmlDoc = content.format === 'html'
    ? `<!DOCTYPE html><html><head><style>
        body { font-family: 'JetBrains Mono', monospace; font-size: 13px; padding: 16px; color: #1e3a5f; background: #f0f7ff; }
        h1,h2,h3 { color: #0369a1; }
        pre { background: rgba(3,105,161,0.06); padding: 8px; border-radius: 4px; overflow: auto; }
      </style></head><body>${content.content}</body></html>`
    : ''

  const downloadContent = (): void => {
    const ext = content.format === 'html' ? 'html' : 'md'
    const blob = new Blob([content.content], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `jarvis-report.${ext}`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div style={{
      position: 'absolute', bottom: 0, left: 0, right: 0, height: '42vh',
      background: 'var(--ov-bg)',
      borderTop: '1px solid var(--ov-border)',
      display: 'flex', flexDirection: 'column', zIndex: 60,
      animation: 'overlayIn 0.22s cubic-bezier(0.16,1,0.3,1) forwards',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 16px', borderBottom: '1px solid var(--ov-separator)',
      }}>
        <span style={{ fontFamily: 'var(--font-hud)', fontSize: '10px', letterSpacing: '0.12em', color: 'var(--ov-text-dim)' }}>
          REPORT
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={downloadContent} className="pill-btn pill-btn--sm">DOWNLOAD</button>
          <button onClick={onClose} className="pill-btn pill-btn--sm">CLOSE</button>
        </div>
      </div>
      <div style={{ flex: 1, overflow: 'hidden' }}>
        {content.format === 'html' ? (
          <iframe
            srcDoc={htmlDoc}
            sandbox="allow-same-origin"
            style={{ width: '100%', height: '100%', border: 'none', background: 'transparent' }}
            title="Jarvis report"
          />
        ) : (
          <div style={{ height: '100%', overflow: 'auto', padding: '12px 16px',
            fontFamily: 'var(--font-hud)', fontSize: '12px', color: 'var(--ov-text)' }}
            dangerouslySetInnerHTML={{ __html: mdHtml }} />
        )}
      </div>
    </div>
  )
}
