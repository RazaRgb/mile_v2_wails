import { useEffect, useState } from 'react'
import AuthPage from './components/AuthPage'
import TabLayout from './components/TabLayout'
import { clearToken, getToken, setToken } from './lib/api'

export default function App() {
  const [token, setTokenState] = useState<string | null>(() => getToken())

  // Any API 401 (stale/expired session) returns us to the login page.
  useEffect(() => {
    const onAuthExpired = () => setTokenState(null)
    window.addEventListener('auth-expired', onAuthExpired)
    return () => window.removeEventListener('auth-expired', onAuthExpired)
  }, [])

  function handleAuthenticated(newToken: string) {
    setToken(newToken)
    setTokenState(newToken)
  }

  function handleLogout() {
    clearToken()
    setTokenState(null)
  }

  return token ? (
    <TabLayout token={token} onLogout={handleLogout} />
  ) : (
    <AuthPage onAuthenticated={handleAuthenticated} />
  )
}
