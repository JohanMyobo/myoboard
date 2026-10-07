import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { LayoutTemplate, Trash2 } from 'lucide-react'
import { api } from '../api'
import type { TemplateSummary, User } from '../api'
import type { BoardObject } from '../model/types'
import { BUILT_IN_TEMPLATES } from '../templates'
import { Modal } from './Modal'
import { TemplatePreview } from './TemplatePreview'

/** A template to insert: built in, or one the team saved (its objects come from the server). */
export type TemplateChoice = { kind: 'built-in'; key: string } | { kind: 'team'; id: string }

interface TemplatesDialogProps {
  user: User
  /** Editors can insert and save templates; viewers only browse. */
  canEdit: boolean
  selectionCount: number
  onInsert(choice: TemplateChoice): void
  /** Saves the selection, or the whole board, as a team template. */
  onSave(name: string, description: string): Promise<void>
  onClose(): void
}

export function TemplatesDialog({ user, canEdit, selectionCount, onInsert, onSave, onClose }: TemplatesDialogProps) {
  const [team, setTeam] = useState<TemplateSummary[] | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const previews = useMemo(() => new Map(BUILT_IN_TEMPLATES.map((t) => [t.key, t.build()])), [])

  const load = () =>
    api
      .templates()
      .then(({ templates }) => setTeam(templates))
      .catch((err: Error) => setProblem(err.message))
  useEffect(() => {
    void load()
  }, [])

  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    setProblem(null)
    try {
      await onSave(name.trim(), description.trim())
      setName('')
      setDescription('')
      await load()
    } catch (err) {
      setProblem((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const remove = async (template: TemplateSummary) => {
    try {
      await api.deleteTemplate(template.id)
      await load()
    } catch (err) {
      setProblem((err as Error).message)
    }
  }

  return (
    <Modal title="Templates" onClose={onClose} width={760}>
      {problem && (
        <p className="form-error" role="alert">
          {problem}
        </p>
      )}
      <h3 className="dialog-subtitle">Workshops</h3>
      <div className="template-grid">
        {BUILT_IN_TEMPLATES.map((template) => (
          <button
            key={template.key}
            type="button"
            className="template-card"
            disabled={!canEdit}
            aria-label={`Insert ${template.name}`}
            onClick={() => onInsert({ kind: 'built-in', key: template.key })}
          >
            <TemplatePreview objects={previews.get(template.key) as BoardObject[]} />
            <strong>{template.name}</strong>
            <span>{template.description}</span>
          </button>
        ))}
      </div>

      <h3 className="dialog-subtitle">Your team’s templates</h3>
      {team === null ? (
        <p className="muted">Loading…</p>
      ) : team.length === 0 ? (
        <p className="muted">None yet. Save a board you like as a template for everyone below.</p>
      ) : (
        <div className="template-grid">
          {team.map((template) => (
            <div key={template.id} className="template-card team">
              <button type="button" className="template-insert" disabled={!canEdit} aria-label={`Insert ${template.name}`} onClick={() => onInsert({ kind: 'team', id: template.id })}>
                <span className="template-icon" aria-hidden>
                  <LayoutTemplate size={28} strokeWidth={1.5} />
                </span>
                <strong>{template.name}</strong>
                <span>{template.description || `${template.count} objects`}</span>
                <span className="template-by">by {template.ownerId === user.id ? 'you' : template.ownerName}</span>
              </button>
              {template.ownerId === user.id && (
                <button type="button" className="icon-button tiny danger template-delete" aria-label={`Delete template ${template.name}`} onClick={() => remove(template)}>
                  <Trash2 size={14} strokeWidth={1.75} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {canEdit && (
        <form className="save-template" onSubmit={save}>
          <h3 className="dialog-subtitle">Save as a template</h3>
          <div className="save-template-row">
            <input type="text" placeholder="Template name" aria-label="Template name" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
            <input type="text" placeholder="What is it for? (optional)" aria-label="Template description" maxLength={300} value={description} onChange={(e) => setDescription(e.target.value)} />
            <button type="submit" className="primary-button" disabled={!name.trim() || saving}>
              {selectionCount > 0 ? 'Save the selection' : 'Save this board'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  )
}
