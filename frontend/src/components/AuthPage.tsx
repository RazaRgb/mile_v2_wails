import { useState } from 'react'
import type { FormEvent } from 'react'
import { api } from '../lib/api'

interface AuthPageProps {
  onAuthenticated: (token: string) => void
}

type Mode = 'login' | 'register'

export default function AuthPage({ onAuthenticated }: AuthPageProps) {
  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const res =
        mode === 'login'
          ? await api.login(email, password)
          : await api.register(email, username, password)
      onAuthenticated(res.token)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1 className="auth-brand">MILE</h1>
        <p className="auth-subtitle">
          {mode === 'login' ? 'Welcome back!' : 'Create your account'}
        </p>

        <form onSubmit={handleSubmit} className="auth-form">
          <input
            type="email"
            required
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          
          {mode === 'register' && (
            <input
              type="text"
              required
              minLength={1}
              placeholder="Username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          )}
          
          <input
            type="password"
            required
            minLength={6}
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          {error && (
            <div className="auth-error">{error}</div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="auth-submit"
          >
            {loading ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Create account'}
          </button>
        </form>

        <button
          type="button"
          onClick={() => {
            setMode(mode === 'login' ? 'register' : 'login')
            setError(null)
          }}
          className="auth-switch"
        >
          {mode === 'login' ? "Don't have an account? Register" : 'Already have an account? Log in'}
        </button>
      </div>
    </div>
  )
}
