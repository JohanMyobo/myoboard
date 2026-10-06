import { useState } from 'react'
import type { FormEvent } from 'react'
import { LogIn } from 'lucide-react'
import { api } from '../api'
import type { AuthInfo, User } from '../api'
import { Brand } from '../ui/Brand'

interface LoginScreenProps {
  auth: AuthInfo
  /** Where to go once signed in. */
  next: string
  /** An error passed back by the sign-in provider. */
  error: string | null
  onSignedIn(user: User): void
}

export function LoginScreen({ auth, next, error, onSignedIn }: LoginScreenProps) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [problem, setProblem] = useState<string | null>(error)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setProblem(null)
    try {
      const { user } = await api.signInLocal(name, email)
      onSignedIn(user)
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'Could not sign in')
      setBusy(false)
    }
  }

  return (
    <main className="page-center login-page">
      <div className="panel login-card">
        <Brand />
        <h1>Sign in</h1>
        <p className="muted">Whiteboards for your team, on your own server.</p>
        {problem && (
          <p className="form-error" role="alert">
            {problem}
          </p>
        )}
        {auth.mode === 'oidc' ? (
          <a className="primary-button wide" href={`/auth/login?next=${encodeURIComponent(next)}`}>
            <LogIn size={16} strokeWidth={2} />
            Continue with {auth.providerName}
          </a>
        ) : (
          <form className="login-form" onSubmit={submit}>
            <label>
              <span>Your name</span>
              <input autoFocus required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
            </label>
            <label>
              <span>Work email</span>
              <input required type="email" maxLength={200} value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
            </label>
            <button type="submit" className="primary-button wide" disabled={busy}>
              {busy ? 'Signing in…' : 'Continue'}
            </button>
            <p className="fine-print">
              This server has no single sign-on set up, so nobody checks this address. That is fine on your own machine;
              see the README to connect your company’s Google or Microsoft accounts before sharing it.
            </p>
          </form>
        )}
      </div>
    </main>
  )
}
