import { describe, it, expect, beforeEach } from 'vitest'
import { useUiStore } from '@/stores/ui'

describe('ui store', () => {
  beforeEach(() => {
    document.documentElement.classList.remove('dark')
    useUiStore.setState({ theme: 'system', sidebarCollapsed: false })
  })

  it('applies .dark to <html> when theme is dark', () => {
    useUiStore.getState().setTheme('dark')
    expect(useUiStore.getState().theme).toBe('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('removes .dark when theme is light', () => {
    useUiStore.getState().setTheme('dark')
    useUiStore.getState().setTheme('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('toggles sidebar collapse', () => {
    expect(useUiStore.getState().sidebarCollapsed).toBe(false)
    useUiStore.getState().toggleSidebar()
    expect(useUiStore.getState().sidebarCollapsed).toBe(true)
  })
})
