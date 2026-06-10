import React from 'react'

function App(): JSX.Element {
  return (
    <div style={{
      width: '100%',
      height: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: '#0a0e27',
      color: '#00ff9f',
      fontFamily: 'Orbitron, monospace',
      margin: 0,
      padding: 0,
    }}>
      <div style={{ textAlign: 'center' }}>
        <h1>JARVIS</h1>
        <p>Personal AI Assistant</p>
      </div>
    </div>
  )
}

export default App
