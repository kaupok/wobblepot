import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { AuthMethodDivider, GoogleSignInButton, googleErrorCallbackURL } from './GoogleSignInButton'

describe('GoogleSignInButton', () => {
  it('is a plain button that calls onClick', async () => {
    const onClick = vi.fn()
    render(<GoogleSignInButton onClick={onClick} />)

    const button = screen.getByRole('button', { name: 'Continue with Google' })
    expect(button).toHaveAttribute('type', 'button')
    await userEvent.setup({ delay: null }).click(button)

    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('says the page is opening Google while pending, and takes no click', () => {
    render(<GoogleSignInButton onClick={vi.fn()} pending />)

    expect(screen.getByRole('button', { name: 'Opening Google…' })).toBeDisabled()
  })

  it('hides the Google mark from assistive technology', () => {
    const { container } = render(<GoogleSignInButton onClick={vi.fn()} />)

    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  })
})

describe('AuthMethodDivider', () => {
  it('reads "or"', () => {
    render(<AuthMethodDivider />)

    expect(screen.getByText('or')).toBeInTheDocument()
  })
})

describe('googleErrorCallbackURL', () => {
  it('keeps the query and drops an earlier error', () => {
    const params = new URLSearchParams(
      'returnUrl=%2Fpantry&error=signup_disabled&error_description=x',
    )

    expect(googleErrorCallbackURL('/sign-in', params)).toBe('/sign-in?returnUrl=%2Fpantry')
  })

  it('is the bare path with no query', () => {
    expect(googleErrorCallbackURL('/sign-up', new URLSearchParams())).toBe('/sign-up')
  })
})
