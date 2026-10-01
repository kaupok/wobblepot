import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CustomItemInput } from './CustomItemInput'
import { toast } from 'sonner'
import { createQueryWrapper } from '@/test/query-wrapper'

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))

function renderInput(props: Partial<Parameters<typeof CustomItemInput>[0]> = {}) {
  const { wrapper } = createQueryWrapper()
  return render(<CustomItemInput onItemAdded={vi.fn()} {...props} />, { wrapper })
}

function respondWith(body: unknown, status: number) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: status < 400, status, json: () => Promise.resolve(body) }),
  )
}

describe('CustomItemInput', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.mocked(toast.error).mockClear()
  })

  it('renders the input with placeholder', () => {
    renderInput()
    expect(screen.getByPlaceholderText('Add an item…')).toBeInTheDocument()
  })

  it('has proper aria label', () => {
    renderInput()
    expect(screen.getByLabelText('Add custom item to shopping list')).toBeInTheDocument()
  })

  it('does not submit empty input', async () => {
    const user = userEvent.setup()
    const onItemAdded = vi.fn()
    renderInput({ onItemAdded })

    const input = screen.getByPlaceholderText('Add an item…')
    await user.click(input)
    await user.keyboard('{Enter}')

    expect(onItemAdded).not.toHaveBeenCalled()
  })

  it('disables input when disabled prop is true', () => {
    renderInput({ disabled: true })
    expect(screen.getByPlaceholderText('Add an item…')).toBeDisabled()
  })

  it('adds the item, clears the input and hands it to the list', async () => {
    respondWith(
      {
        item: {
          id: 'item-1',
          name: 'Oat milk',
          checked: false,
          ingredientId: 'ing-1',
          ingredient: { category: 'dairy' },
          createdAt: '2026-09-29T09:00:00.000Z',
        },
      },
      201,
    )
    const user = userEvent.setup()
    const onItemAdded = vi.fn()
    renderInput({ onItemAdded })

    const input = screen.getByPlaceholderText('Add an item…')
    await user.type(input, 'Oat milk{Enter}')

    await vi.waitFor(() =>
      expect(onItemAdded).toHaveBeenCalledWith({
        id: 'item-1',
        name: 'Oat milk',
        checked: false,
        ingredientId: 'ing-1',
        ingredientCategory: 'dairy',
        createdAt: '2026-09-29T09:00:00.000Z',
      }),
    )
    expect(input).toHaveValue('')
  })

  it('says the item is already on the list for a 409 and keeps the input', async () => {
    respondWith({ error: 'Item already exists' }, 409)
    const user = userEvent.setup()
    const onItemAdded = vi.fn()
    renderInput({ onItemAdded })

    const input = screen.getByPlaceholderText('Add an item…')
    await user.type(input, 'Oat milk{Enter}')

    await vi.waitFor(() => expect(toast.error).toHaveBeenCalledWith('Item already on the list'))
    expect(onItemAdded).not.toHaveBeenCalled()
    expect(input).toHaveValue('Oat milk')
  })

  it('toasts the translated failure for a bodiless 500', async () => {
    respondWith({}, 500)
    const user = userEvent.setup()
    renderInput()

    await user.type(screen.getByPlaceholderText('Add an item…'), 'Oat milk{Enter}')

    await vi.waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to add item'))
  })

  it("toasts the translated failure, not the route's error text", async () => {
    respondWith({ error: 'Validation failed' }, 400)
    const user = userEvent.setup()
    renderInput()

    await user.type(screen.getByPlaceholderText('Add an item…'), 'Oat milk{Enter}')

    await vi.waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to add item'))
    expect(toast.error).not.toHaveBeenCalledWith('Validation failed')
  })
})
