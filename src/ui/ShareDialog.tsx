import { useState } from 'react'
import type { FormEvent } from 'react'
import { Check, Globe2, Link, Lock, Trash2 } from 'lucide-react'
import { ROLE_LABEL, api } from '../api'
import type { BoardAccess, LinkAccess, MemberRole } from '../api'
import { Modal } from './Modal'
import { initials } from './UserMenu'

const LINK_LABEL: Record<LinkAccess, string> = {
  none: 'Only people invited',
  view: 'Anyone signed in with the link can view',
  edit: 'Anyone signed in with the link can edit',
}

interface ShareDialogProps {
  access: BoardAccess
  title: string
  onChange(access: BoardAccess): void
  onClose(): void
}

/** Who can open the board: invited people with a role, plus what the link gives everyone else. */
export function ShareDialog({ access, title, onChange, onClose }: ShareDialogProps) {
  const { board, role, members } = access
  const isOwner = role === 'owner'
  const [email, setEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<MemberRole>('editor')
  const [problem, setProblem] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const link = `${location.origin}/b/${board.id}`

  const run = async (change: () => Promise<BoardAccess>): Promise<boolean> => {
    setProblem(null)
    try {
      onChange(await change())
      return true
    } catch (err) {
      setProblem((err as Error).message)
      return false
    }
  }

  const invite = async (e: FormEvent) => {
    e.preventDefault()
    if (!email.trim()) return
    if (await run(() => api.setMember(board.id, email.trim(), inviteRole))) setEmail('')
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link)
    } catch {
      window.prompt('Copy this link to share the board', link)
    }
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }

  return (
    <Modal
      title={`Share “${title}”`}
      onClose={onClose}
      width={520}
      footer={
        <>
          <button type="button" className="secondary-button" onClick={copy}>
            {copied ? <Check size={16} strokeWidth={2} /> : <Link size={16} strokeWidth={2} />}
            {copied ? 'Link copied' : 'Copy link'}
          </button>
          <button type="button" className="primary-button" onClick={onClose}>
            Done
          </button>
        </>
      }
    >
      {isOwner && (
        <form className="invite-row" onSubmit={invite}>
          <input type="email" placeholder="Add people by email" aria-label="Email to invite" value={email} onChange={(e) => setEmail(e.target.value)} />
          <select aria-label="Role for the invited person" value={inviteRole} onChange={(e) => setInviteRole(e.target.value as MemberRole)}>
            <option value="editor">Can edit</option>
            <option value="viewer">Can view</option>
          </select>
          <button type="submit" className="primary-button">
            Invite
          </button>
        </form>
      )}
      {problem && (
        <p className="form-error" role="alert">
          {problem}
        </p>
      )}

      <h3 className="dialog-subtitle">People with access</h3>
      <ul className="people" aria-label="People with access">
        {board.owner && (
          <li>
            <span className="avatar small">{initials(board.owner.name)}</span>
            <span className="person">
              <strong>{board.owner.name}</strong>
              <span>{board.owner.email}</span>
            </span>
            <span className="person-role">Owner</span>
          </li>
        )}
        {members.map((member) => (
          <li key={member.email}>
            <span className="avatar small muted-avatar">{initials(member.name ?? member.email)}</span>
            <span className="person">
              <strong>{member.name ?? member.email}</strong>
              {member.name && <span>{member.email}</span>}
            </span>
            {isOwner ? (
              <>
                <select
                  aria-label={`Role for ${member.email}`}
                  value={member.role}
                  onChange={(e) => run(() => api.setMember(board.id, member.email, e.target.value as MemberRole))}
                >
                  <option value="editor">Can edit</option>
                  <option value="viewer">Can view</option>
                </select>
                <button type="button" className="icon-button danger" aria-label={`Remove ${member.email}`} onClick={() => run(() => api.removeMember(board.id, member.email))}>
                  <Trash2 size={16} strokeWidth={1.75} />
                </button>
              </>
            ) : (
              <span className="person-role">{ROLE_LABEL[member.role]}</span>
            )}
          </li>
        ))}
      </ul>

      <h3 className="dialog-subtitle">General access</h3>
      <div className="general-access">
        {board.linkAccess === 'none' ? <Lock size={18} strokeWidth={1.75} /> : <Globe2 size={18} strokeWidth={1.75} />}
        {isOwner ? (
          <select aria-label="General access" value={board.linkAccess} onChange={(e) => run(() => api.setLinkAccess(board.id, e.target.value as LinkAccess))}>
            {(Object.keys(LINK_LABEL) as LinkAccess[]).map((value) => (
              <option key={value} value={value}>
                {LINK_LABEL[value]}
              </option>
            ))}
          </select>
        ) : (
          <span>{LINK_LABEL[board.linkAccess]}</span>
        )}
      </div>
      <p className="fine-print">
        Invited people find the board in their list once they sign in with that email. Myoboard sends no email: share the link
        with them.
      </p>
    </Modal>
  )
}
