import { StrictMode, Component, type ReactNode, type ErrorInfo } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App'
import { AuthProvider } from './context/AuthContext'

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props)
    this.state = { error: null }
  }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[DermAI] Render error:', error, info)
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: '2rem', fontFamily: 'monospace', background: '#fff1f2', minHeight: '100vh' }}>
          <h1 style={{ color: '#A0195A', marginBottom: '1rem' }}>⚠️ DermAI — Render Error</h1>
          <pre style={{ background: '#fff', border: '1px solid #fca5a5', borderRadius: '8px', padding: '1rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: '#7f1d1d' }}>
            {this.state.error.toString()}
            {this.state.error.stack}
          </pre>
          <p style={{ marginTop: '1rem', color: '#6b0f3c', fontSize: '0.875rem' }}>Check the browser console for more details.</p>
        </div>
      )
    }
    return this.props.children
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
)