'use client'

import { Children, useId, useRef } from 'react'
import { Plus, X } from 'lucide-react'
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
}

/** The household's size limit at onboarding, the signed-up user included. */
export const MAX_MEMBERS = 10

interface MembersStepProps {
  userName: string
  /** The members after the user, in the order they were added. */
  members: MemberDraft[]
  /** The name each member gets when its field is left empty ("Child 1"). */
  defaultNameOf: (member: MemberDraft) => string
  onAdd: (portionType: PortionType) => void
  onRemove: (id: number) => void
  onNameChange: (id: number, name: string) => void
  disabled: boolean
}

/**
 * Who eats at the household's table: adults and children in two groups, each
 * with its own Add button. The groups carry the portion type, so a row needs
 * no Adult / Child toggle and a family of four is three taps. Each Add button
 * sits in its group's heading row, above the rows it adds, so it stays under
 * the pointer for the next tap (a stepper below the rows moved with each one).
 */
export function MembersStep({
  userName,
  members,
  defaultNameOf,
  onAdd,
  onRemove,
  onNameChange,
  disabled,
}: MembersStepProps) {
  const t = useTranslations('onboarding')
  const isFull = members.length + 1 >= MAX_MEMBERS
  const addRefs = {
    adult: useRef<HTMLButtonElement>(null),
    child: useRef<HTMLButtonElement>(null),
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
          onAdd={() => onAdd(group.type)}
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
            .map((member) => {
              const label = defaultNameOf(member)
              return (
                <li key={member.id} className="flex items-center gap-2">
                  <Input
                    type="text"
                    value={member.name}
                    onChange={(e) => onNameChange(member.id, e.target.value)}
                    placeholder={label}
                    disabled={disabled}
                    maxLength={100}
                    autoComplete="off"
                    className="flex-1"
                    aria-label={t('memberNameAria', { label })}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => handleRemove(member)}
                    disabled={disabled}
                    aria-label={t('removeMemberAria', { label: member.name.trim() || label })}
                  >
                    <X aria-hidden="true" />
                  </Button>
                </li>
              )
            })}
        </MemberGroup>
      ))}

      <Body variant="muted">{isFull ? t('membersFull') : t('membersHelper')}</Body>
    </div>
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
