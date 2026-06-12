import React from 'react'

interface Props {
  plan: { id: string; steps: string[] }
  onConfirm: (id: string) => void
  onCancel: (id: string) => void
}

export default function PlanPreviewCard({ plan, onConfirm, onCancel }: Props) {
  return (
    <div style={{
      position: 'fixed',
      bottom: '120px',
      left: '50%',
      transform: 'translateX(-50%)',
      width: '420px',
      background: 'var(--ov-bg)',
      border: '1px solid var(--ov-border-hot)',
      borderRadius: 'var(--ov-radius)',
      boxShadow: 'var(--ov-shadow)',
      padding: '16px 20px',
      animation: 'overlayIn 0.22s cubic-bezier(0.16,1,0.3,1) forwards',
      zIndex: 300,
      fontFamily: 'var(--font-mono)',
    }}>
      <div style={{ color: 'var(--ov-text)', fontSize: '11px', letterSpacing: '0.1em', marginBottom: '12px' }}>
        ⚠ CONFIRM ACTIONS
      </div>
      <ol style={{ paddingLeft: '16px', margin: '0 0 16px', color: 'var(--ov-text-mid)', fontSize: '10px', lineHeight: '1.8' }}>
        {plan.steps.map((step, i) => (
          <li key={i} style={{ marginBottom: '2px' }}>{step}</li>
        ))}
      </ol>
      <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
        <button className="pill-btn pill-btn--danger" onClick={() => onCancel(plan.id)}>
          CANCEL
        </button>
        <button className="pill-btn pill-btn--active" onClick={() => onConfirm(plan.id)}>
          PROCEED
        </button>
      </div>
    </div>
  )
}
