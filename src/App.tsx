import { useCallback, useEffect, useState } from 'react'
import { api } from './api'
import type { AuthInfo, User } from './api'
import { BoardScreen } from './BoardScreen'
import { navigate, safeNext, useLocation } from './router'
import { HomeScreen } from './screens/HomeScreen'
import { LoginScreen } from './screens/LoginScreen'
import { MessageScreen } from './screens/MessageScreen'
import { isValidBoardId } from './sync/session'

type Session = { user: User | null; auth: AuthInfo }

function Redirect({ to }: { to: string }) {
  useEffect(() => navigate(to, { replace: true }), [to])
  return null
}

/** `/login` signs in, `/` lists your boards, `/b/<id>` opens one. Everything needs a signed-in user. */
export function App() {
  const { pathname, params } = useLocation()
  const [session, setSession] = useState<Session | null>(null)
  const [unreachable, setUnreachable] = useState(false)

  const load = useCallback(() => {
    setUnreachable(false)
    api
      .me()
      .then(setSession)
      .catch(() => setUnreachable(true))
  }, [])
  useEffect(load, [load])

  const signOut = useCallback(async () => {
    await api.signOut().catch(() => {})
    setSession((s) => (s ? { ...s, user: null } : s))
    navigate('/login', { replace: true })
  }, [])

  if (unreachable) {
    return (
      <MessageScreen title="Can’t reach Myoboard" actions={[{ label: 'Try again', onClick: load }]}>
        The server is not answering. Check your connection, or that the server is running.
      </MessageScreen>
    )
  }
  if (!session) return <div className="loading">Loading…</div>

  const { user, auth } = session
  const boardMatch = /^\/b\/([^/]+)\/?$/.exec(pathname)

  if (!user || pathname === '/login') {
    const next = pathname === '/login' ? safeNext(params.get('next')) : pathname + location.search
    if (user) return <Redirect to={next} />
    return (
      <LoginScreen
        auth={auth}
        next={next}
        error={params.get('error')}
        onSignedIn={(signedIn) => {
          setSession({ auth, user: signedIn })
          navigate(next, { replace: true })
        }}
      />
    )
  }

  if (boardMatch) {
    if (!isValidBoardId(boardMatch[1])) {
      return (
        <MessageScreen title="Board not found" actions={[{ label: 'Go to my boards', onClick: () => navigate('/') }]}>
          This address does not point to a board.
        </MessageScreen>
      )
    }
    return <BoardScreen key={boardMatch[1]} boardId={boardMatch[1]} user={user} onSignOut={signOut} />
  }

  if (pathname !== '/') return <Redirect to="/" />
  return <HomeScreen user={user} onSignOut={signOut} />
}
