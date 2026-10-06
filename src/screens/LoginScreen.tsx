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

/** One button per identity provider the server has, and the name-and-email form if it is on. */
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
        {auth.providers.map((provider, i) => (
          <a
            key={provider.id}
            className={`${i === 0 ? 'primary-button' : 'secondary-button'} wide`}
            href={`/auth/login?provider=${encodeURIComponent(provider.id)}&next=${encodeURIComponent(next)}`}
          >
            <LogIn size={16} strokeWidth={2} />
            Continue with {provider.name}
          </a>
        ))}
        {auth.local && auth.providers.length > 0 && (
          <div className="or-divider" role="separator">
            <span>or</span>
          </div>
        )}
        {auth.local && (
          <form className="login-form" onSubmit={submit}>
            <label>
              <span>Your name</span>
              <input autoFocus={auth.providers.length === 0} required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
            </label>
            <label>
              <span>Email</span>
              <input required type="email" maxLength={200} value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
            </label>
            <button type="submit" className={`${auth.providers.length > 0 ? 'secondary-button' : 'primary-button'} wide`} disabled={busy}>
              {busy ? 'Signing in…' : auth.providers.length > 0 ? 'Continue with name and email' : 'Continue'}
            </button>
            <p className="fine-print">
              {auth.providers.length > 0
                ? 'Nobody checks this address: keep this way of signing in for your own machine.'
                : 'Nobody checks this address, which is fine on your own machine. To sign in with Google or Microsoft accounts, see “Sign-in” in the README.'}
            </p>
          </form>
        )}
      </div>
    </main>
  )
}
