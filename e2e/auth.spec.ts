import { test, expect } from '@playwright/test'
import { loginWithMagicLink, deleteUser, enableVirtualAuthenticator } from './helpers'

/**
 * Auth flows in a real browser against the dedicated db_test database.
 * Covers the route guard, magic-link sign-in/out, and passkey register +
 * sign-in (via a CDP virtual authenticator).
 */

test.describe('authentication', () => {
  test('unauthenticated visitors are redirected to /login', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL(/\/login$/)
    await expect(page.getByRole('button', { name: 'Send magic link' })).toBeVisible()

    // A protected page redirects too.
    await page.goto('/settings')
    await expect(page).toHaveURL(/\/login$/)
  })

  test('a user can sign in with a magic link and sign out', async ({ page }) => {
    const email = 'magic-login@authtest.example'
    await deleteUser(email)

    await loginWithMagicLink(page, email)

    // The dashboard renders and the sidebar shows the signed-in user.
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
    await expect(page.getByText(email)).toBeVisible()

    // Open the quick-action menu and sign out.
    await page.getByRole('button', { name: new RegExp(email) }).click()
    await page.getByRole('menuitem', { name: 'Logout' }).click()

    await expect(page).toHaveURL(/\/login$/)

    // Session is gone — visiting a protected page bounces back to /login.
    await page.goto('/')
    await expect(page).toHaveURL(/\/login$/)
  })

  test('the quick-action menu navigates to account settings', async ({ page }) => {
    const email = 'menu-nav@authtest.example'
    await deleteUser(email)
    await loginWithMagicLink(page, email)

    await page.getByRole('button', { name: new RegExp(email) }).click()
    await page.getByRole('menuitem', { name: 'Account settings' }).click()

    await expect(page).toHaveURL(/\/settings$/)
    await expect(page.getByRole('heading', { name: 'Account settings' })).toBeVisible()
    // Scope to the page body — the email also appears in the sidebar menu.
    await expect(page.getByRole('main').getByText(email)).toBeVisible()
  })

  test('a user can register a passkey and then sign in with it', async ({ page }) => {
    const email = 'passkey-user@authtest.example'
    await deleteUser(email)

    const authenticator = await enableVirtualAuthenticator(page)
    try {
      // Sign in with magic link, then register a passkey from settings.
      await loginWithMagicLink(page, email)
      await page.goto('/settings', { waitUntil: 'networkidle' })
      await expect(page.getByRole('heading', { name: 'Account settings' })).toBeVisible()

      await page.getByLabel('Name (optional)').fill('Test Authenticator')
      await page.getByRole('button', { name: 'Add passkey' }).click()

      // The new passkey appears in the list.
      await expect(page.getByText('Test Authenticator')).toBeVisible()

      // Sign out, then sign back in using only the passkey.
      await page.getByRole('button', { name: new RegExp(email) }).click()
      await page.getByRole('menuitem', { name: 'Logout' }).click()
      await expect(page).toHaveURL(/\/login$/)
      // The session is fully cleared, so reaching the dashboard below can only
      // happen via the passkey assertion that follows.
      await expect(page.getByRole('button', { name: 'Send magic link' })).toBeVisible()

      await page.getByRole('button', { name: 'Sign in with a passkey' }).click()

      await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
      await expect(page).not.toHaveURL(/\/login$/)
    } finally {
      await authenticator.disable()
    }
  })
})
