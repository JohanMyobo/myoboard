import { useEffect, useRef, useState } from 'react'
import { Pause, Play, Plus, Square } from 'lucide-react'
import { useTicker } from '../hooks'
import { timeLeft } from '../model/facilitation'
import type { Facilitation, Facilitator, TimerState } from '../model/facilitation'
import { serverNow } from '../sync/clock'

const PRESETS = [1, 3, 5, 10, 15]

export function formatClock(ms: number): string {
  const total = Math.ceil(ms / 1000)
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

/** Two soft notes, synthesised: no sound file to ship. */
function chime(): void {
  try {
    const audio = new AudioContext()
    const start = audio.currentTime
    ;[880, 1318.5].forEach((frequency, i) => {
      const at = start + i * 0.18
      const oscillator = audio.createOscillator()
      const gain = audio.createGain()
      oscillator.type = 'sine'
      oscillator.frequency.value = frequency
      gain.gain.setValueAtTime(0, at)
      gain.gain.linearRampToValueAtTime(0.18, at + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.6)
      oscillator.connect(gain).connect(audio.destination)
      oscillator.start(at)
      oscillator.stop(at + 0.65)
    })
    window.setTimeout(() => void audio.close(), 1500)
  } catch {
    // No audio (blocked or unsupported): the countdown still shows it.
  }
}

interface TimerProps {
  facilitation: Facilitation
  timer: TimerState | null
  me: Facilitator
  readOnly: boolean
}

/** The menu behind the top bar's timer button: start one, or control the running one. */
export function TimerMenu({ facilitation, timer, me, readOnly, onDone }: TimerProps & { onDone(): void }) {
  const [minutes, setMinutes] = useState(5)
  useTicker(timer?.status === 'running')
  if (timer) {
    const left = timeLeft(timer, serverNow())
    return (
      <div className="timer-menu">
        <div className="timer-big" aria-label="Time left">
          {left > 0 ? formatClock(left) : 'Time’s up'}
        </div>
        {!readOnly && <TimerButtons facilitation={facilitation} timer={timer} />}
      </div>
    )
  }
  if (readOnly) return <p className="muted timer-menu">No timer running.</p>
  return (
    <div className="timer-menu">
      <span className="menu-title">Start a timer for everyone</span>
      <div className="preset-row">
        {PRESETS.map((m) => (
          <button
            key={m}
            type="button"
            className="chip"
            onClick={() => {
              facilitation.startTimer(m * 60_000, me, serverNow())
              onDone()
            }}
          >
            {m} min
          </button>
        ))}
      </div>
      <form
        className="custom-time"
        onSubmit={(e) => {
          e.preventDefault()
          if (minutes <= 0) return
          facilitation.startTimer(Math.min(minutes, 180) * 60_000, me, serverNow())
          onDone()
        }}
      >
        <input type="number" min={1} max={180} aria-label="Minutes" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} />
        <span>min</span>
        <button type="submit" className="primary-button">
          Start
        </button>
      </form>
    </div>
  )
}

function TimerButtons({ facilitation, timer }: { facilitation: Facilitation; timer: TimerState }) {
  const left = timeLeft(timer, serverNow())
  return (
    <div className="timer-buttons">
      {timer.status === 'running' && left > 0 && (
        <button type="button" className="icon-button" aria-label="Pause timer" title="Pause" onClick={() => facilitation.pauseTimer(serverNow())}>
          <Pause size={16} strokeWidth={2} />
        </button>
      )}
      {timer.status === 'paused' && (
        <button type="button" className="icon-button" aria-label="Resume timer" title="Resume" onClick={() => facilitation.resumeTimer(serverNow())}>
          <Play size={16} strokeWidth={2} />
        </button>
      )}
      <button type="button" className="icon-button" aria-label="Add a minute" title="Add a minute" onClick={() => facilitation.addTime(60_000, serverNow())}>
        <Plus size={16} strokeWidth={2} />
      </button>
      <button type="button" className="icon-button" aria-label="Stop timer" title="Stop" onClick={() => facilitation.stopTimer()}>
        <Square size={14} strokeWidth={2} />
      </button>
    </div>
  )
}

/** The countdown everyone sees while a timer is set, with a chime at zero. */
export function TimerPill({ facilitation, timer, readOnly }: Omit<TimerProps, 'me'>) {
  useTicker(timer?.status === 'running')
  const left = timer ? timeLeft(timer, serverNow()) : 0
  const chimedFor = useRef<number | null>(null)
  const sawRunning = useRef(false)

  useEffect(() => {
    if (!timer || timer.status !== 'running') return
    if (left > 0) sawRunning.current = true
    else if (sawRunning.current && chimedFor.current !== timer.endsAt) {
      chimedFor.current = timer.endsAt
      chime()
    }
  }, [timer, left])

  if (!timer) return null
  const done = left <= 0
  return (
    <div className={`panel timer-pill${done ? ' done' : ''}${timer.status === 'paused' ? ' paused' : ''}`} role="timer" aria-label="Shared timer">
      <span className="timer-time">{done ? 'Time’s up' : formatClock(left)}</span>
      {timer.status === 'paused' && <span className="timer-state">Paused</span>}
      {!readOnly && <TimerButtons facilitation={facilitation} timer={timer} />}
    </div>
  )
}
