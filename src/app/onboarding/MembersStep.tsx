'use client'

import { Children, useEffect, useId, useRef } from 'react'
import { Check, Plus, X } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Heading, Body } from '@/components/ui/typography'

export type PortionType = 'adult' | 'child'

export interface MemberDraft {
  /** Stable key, so removing a row does not move typed text into its neighbour. */
  id: number
  name: string
  portionType: PortionType
  /** An open text field; otherwise the row shows the name as text, like the user's own. */
  editing: boolean
}

/** The household's size limit at onboarding, the signed-up user included. */
export const MAX_MEMBERS = 10

interface MembersStepProps {
  userName: string
  /** The members after the user, in the order they were added. */
  members: MemberDraft[]
  /** The name each member gets when its field is left empty ("Child 1"). */
  defaultNameOf: (member: MemberDraft) => string
  /** Returns the new member's id, or `null` when the household is full. */
  onAdd: (portionType: PortionType) => number | null
  onRemove: (id: number) => void
  onNameChange: (id: number, name: string) => void
  onEditingChange: (id: number, editing: boolean) => void
  disabled: boolean
}

/**
 * Who eats at the household's table: adults and children in two groups, each
 * with its own Add button. The groups carry the portion type, so a row needs
 * no Adult / Child toggle and a family of four is three taps. Each Add button
 * sits in its group's heading row, above the rows it adds, so it stays under
 * the pointer for the next tap (a stepper below the rows moved with each one).
 *
 * A member row opens as a text field with a Done button and settles into the
 * name as text once done, so the user sees the name was taken (HON-1134).
 */
export function MembersStep({
  userName,
  members,
  defaultNameOf,
  onAdd,
  onRemove,
  onNameChange,
  onEditingChange,
  disabled,
}: MembersStepProps) {
  const t = useTranslations('onboarding')
  const isFull = members.length + 1 >= MAX_MEMBERS
  const addRefs = {
    adult: useRef<HTMLButtonElement>(null),
    child: useRef<HTMLButtonElement>(null),
  }

  // Adding, finishing or reopening a row swaps the focused control for one that
  // renders with the parent's next state, so the target is noted here and
  // focused once that render lands. Without it focus falls to the body
  // (CLAUDE.md → Focus management).
  const fieldRefs = useRef(new Map<number, HTMLInputElement>())
  const nameRefs = useRef(new Map<number, HTMLButtonElement>())
  const pendingFocus = useRef<{ id: number; target: 'field' | 'name' } | null>(null)
  useEffect(() => {
    const pending = pendingFocus.current
    if (!pending) return
    pendingFocus.current = null
    const refs = pending.target === 'field' ? fieldRefs : nameRefs
    refs.current.get(pending.id)?.focus()
  })

  const handleAdd = (portionType: PortionType) => {
    const id = onAdd(portionType)
    if (id !== null) pendingFocus.current = { id, target: 'field' }
  }

  const handleDone = (member: MemberDraft) => {
    pendingFocus.current = { id: member.id, target: 'name' }
    onEditingChange(member.id, false)
  }

  const handleEdit = (member: MemberDraft) => {
    pendingFocus.current = { id: member.id, target: 'field' }
    onEditingChange(member.id, true)
  }

  // The removed row's button goes with it, which would drop focus to the body;
  // the group's Add button is the one control that is always there.
  const handleRemove = (member: MemberDraft) => {
    onRemove(member.id)
    addRefs[member.portionType].current?.focus()
  }

  const groups: { type: PortionType; heading: string; addLabel: string }[] = [
    { type: 'adult', heading: t('adultsHeading'), addLabel: t('addAdult') },
    { type: 'child', heading: t('childrenHeading'), addLabel: t('addChild') },
  ]

  return (
    <div className="flex flex-col gap-6">
      {groups.map((group) => (
        <MemberGroup
          key={group.type}
          heading={group.heading}
          addLabel={group.addLabel}
          addRef={addRefs[group.type]}
          onAdd={() => handleAdd(group.type)}
          disabled={disabled}
          full={isFull}
        >
          {group.type === 'adult' && (
            <li key="you" className="h-touch flex items-center md:h-10">
              <Body>{t('you', { name: userName })}</Body>
            </li>
          )}
          {members
            .filter((member) => member.portionType === group.type)
            .map((member) => (
              <MemberRow
                key={member.id}
                member={member}
                defaultName={defaultNameOf(member)}
                fieldRef={(el) => {
                  if (el) fieldRefs.current.set(member.id, el)
                  else fieldRefs.current.delete(member.id)
                }}
                nameRef={(el) => {
                  if (el) nameRefs.current.set(member.id, el)
                  else nameRefs.current.delete(member.id)
                }}
                onNameChange={(name) => onNameChange(member.id, name)}
                onCommit={() => onEditingChange(member.id, false)}
                onDone={() => handleDone(member)}
                onEdit={() => handleEdit(member)}
                onRemove={() => handleRemove(member)}
                disabled={disabled}
              />
            ))}
        </MemberGroup>
      ))}

      <Body variant="muted">{isFull ? t('membersFull') : t('membersHelper')}</Body>
    </div>
  )
}

interface MemberRowProps {
  member: MemberDraft
  /** "Adult 2": the placeholder, and the name shown and saved for an empty field. */
  defaultName: string
  fieldRef: React.RefCallback<HTMLInputElement>
  nameRef: React.RefCallback<HTMLButtonElement>
  onNameChange: (name: string) => void
  /** Finishes the row where focus is already moving elsewhere. */
  onCommit: () => void
  /** Finishes the row from Done or Enter, with focus to the name. */
  onDone: () => void
  onEdit: () => void
  onRemove: () => void
  disabled: boolean
}

function MemberRow({
  member,
  defaultName,
  fieldRef,
  nameRef,
  onNameChange,
  onCommit,
  onDone,
  onEdit,
  onRemove,
  disabled,
}: MemberRowProps) {
  const t = useTranslations('onboarding')
  const inputRef = useRef<HTMLInputElement>(null)
  const doneRef = useRef<HTMLButtonElement>(null)
  const typed = member.name.trim()
  const label = typed || defaultName

  // Leaving the open field or its Done finishes a named row, so Continue
  // straight from the field works and Tab past Done shows the name. Not on a
  // move between the two: finishing removes both while one takes focus. Not
  // when the window loses focus either (another app or tab): the browser
  // returns focus to the field, which must still be there.
  const handleLeave = (next: EventTarget | null, sibling: HTMLElement | null) => {
    if (!typed || next === sibling || !document.hasFocus()) return
    onCommit()
  }

  // Remove is the last child in both states, so it stays the same element and
  // keeps focus when Tab past Done finishes the row on the way to it.
  return (
    <li className="flex items-center gap-2">
      {member.editing ? (
        <>
          <Input
            ref={(el) => {
              inputRef.current = el
              fieldRef(el)
            }}
            type="text"
            value={member.name}
            onChange={(e) => onNameChange(e.target.value)}
            onKeyDown={(e) => {
              // Enter finishes the row. Without `preventDefault` it submits the
              // form, which is Continue on this step (HON-836).
              if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
              e.preventDefault()
              onDone()
            }}
            onBlur={(e) => handleLeave(e.relatedTarget, doneRef.current)}
            placeholder={defaultName}
            disabled={disabled}
            maxLength={100}
            autoComplete="off"
            className="flex-1"
            aria-label={t('memberNameAria', { label: defaultName })}
          />
          <Button
            ref={doneRef}
            type="button"
            variant="ghost"
            size="icon"
            // Keeps focus in the field on a pointer press, so its blur does not
            // finish the row and remove this button before the click lands.
            onMouseDown={(e) => e.preventDefault()}
            onClick={onDone}
            onBlur={(e) => handleLeave(e.relatedTarget, inputRef.current)}
            disabled={disabled}
            aria-label={t('doneMemberAria', { label })}
          >
            <Check aria-hidden="true" />
          </Button>
        </>
      ) : (
        // A `<p>` cannot sit inside a button, so the muted default name takes
        // the button's `quiet` tone rather than `Body variant="muted"`.
        <Button
          ref={nameRef}
          type="button"
          variant={typed ? 'ghost' : 'quiet'}
          className="min-w-0 flex-1 justify-start"
          onClick={onEdit}
          disabled={disabled}
          aria-label={t('editMemberAria', { label })}
        >
          <span className="truncate">{label}</span>
        </Button>
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={onRemove}
        disabled={disabled}
        aria-label={t('removeMemberAria', { label })}
      >
        <X aria-hidden="true" />
      </Button>
    </li>
  )
}

interface MemberGroupProps {
  heading: string
  addLabel: string
  addRef: React.Ref<HTMLButtonElement>
  onAdd: () => void
  /** While the household is being created. */
  disabled: boolean
  /** At `MAX_MEMBERS`. */
  full: boolean
  children: React.ReactNode
}

function MemberGroup({
  heading,
  addLabel,
  addRef,
  onAdd,
  disabled,
  full,
  children,
}: MemberGroupProps) {
  const headingId = useId()
  const rows = Children.toArray(children)
  return (
    <section className="flex flex-col gap-2" aria-labelledby={headingId}>
      <div className="flex items-center justify-between gap-2">
        <Heading variant="section" as="h2" id={headingId}>
          {heading}
        </Heading>
        {/* `aria-disabled` when full, not `disabled`: the tap that fills the
            household lands on this button, and a disabled one would drop that
            focus to the body (CLAUDE.md → Focus management). */}
        <Button
          ref={addRef}
          type="button"
          variant="outline"
          onClick={() => {
            if (!full) onAdd()
          }}
          disabled={disabled}
          aria-disabled={full || undefined}
        >
          <Plus aria-hidden="true" />
          {addLabel}
        </Button>
      </div>
      {rows.length > 0 && <ul className="flex flex-col gap-2">{rows}</ul>}
    </section>
  )
}
