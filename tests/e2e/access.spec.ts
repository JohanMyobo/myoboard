import { expect, test } from '@playwright/test'
import { addSticky, boardIdFor, objectsOfType, openBoard, signIn, texts } from './helpers'

test('sign in, find your boards, create and delete one', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
  await page.getByLabel('Your name').fill('Rosa Parks')
  await page.getByLabel('Work email').fill(`rosa.${Date.now().toString(36)}@example.com`)
  await page.getByRole('button', { name: 'Continue' }).click()

  await expect(page.getByRole('heading', { name: 'Boards' })).toBeVisible()
  await expect(page.getByText('No boards yet.')).toBeVisible()

  await page.getByRole('button', { name: 'New board' }).click()
  await expect(page).toHaveURL(/\/b\/[A-Za-z0-9_-]+$/)
  await page.waitForFunction(() => window.__myoboard?.session.provider.synced === true)
  await page.getByRole('textbox', { name: 'Board title' }).fill('Quarterly planning')
  await page.getByRole('textbox', { name: 'Board title' }).press('Enter')

  await page.getByRole('link', { name: 'All boards' }).click()
  const row = page.getByRole('listitem').filter({ hasText: 'Quarterly planning' })
  await expect(row).toBeVisible()
  await expect(row.getByText('Owner')).toBeVisible()

  await row.getByRole('button', { name: 'Delete Quarterly planning' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Delete board' }).click()
  await expect(page.getByText('No boards yet.')).toBeVisible()

  // Signing out leads back to the sign-in page.
  await page.getByRole('button', { name: /Signed in as/ }).click()
  await page.getByRole('menuitem', { name: 'Sign out' }).click()
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
})

test('owners decide who can view or edit, and changes apply live', async ({ browser }, info) => {
  const boardId = boardIdFor(info)
  const alice = await (await browser.newContext()).newPage()
  const bob = await (await browser.newContext()).newPage()
  await openBoard(alice, boardId)
  const bobAccount = await signIn(bob, 'Bob Viewer')

  // Alice makes the link view-only.
  await alice.getByRole('button', { name: 'Share' }).click()
  await alice.getByRole('combobox', { name: 'General access' }).selectOption('view')
  await alice.getByRole('button', { name: 'Done' }).click()

  // Bob can look, and sees Alice's changes live, but cannot change anything.
  await bob.goto(`/b/${boardId}`)
  await bob.waitForFunction(() => window.__myoboard?.session.provider.synced === true)
  await expect(bob.getByText('View only')).toBeVisible()
  await expect(bob.getByRole('navigation', { name: 'Tools' }).getByRole('button')).toHaveCount(2)
  await addSticky(alice, { x: 500, y: 400 }, 'From Alice')
  await expect.poll(() => texts(bob)).toContain('From Alice')

  await bob.keyboard.press('s')
  await bob.mouse.click(700, 500)
  const [note] = await objectsOfType(bob, 'sticky')
  await bob.keyboard.press('Control+a')
  await bob.keyboard.press('Delete')
  await bob.waitForTimeout(300)
  expect(await objectsOfType(bob, 'sticky')).toEqual([note])
  expect(await objectsOfType(alice, 'sticky')).toHaveLength(1)

  // Alice invites Bob as an editor: his page switches to editing by itself.
  await alice.getByRole('button', { name: 'Share' }).click()
  await alice.getByRole('textbox', { name: 'Email to invite' }).fill(bobAccount.email)
  await alice.getByRole('button', { name: 'Invite' }).click()
  await expect(alice.getByRole('list', { name: 'People with access' })).toContainText('Bob Viewer')
  await alice.getByRole('button', { name: 'Done' }).click()
  await expect(bob.getByText('View only')).toBeHidden()
  await addSticky(bob, { x: 800, y: 500 }, 'From Bob')
  await expect.poll(() => texts(alice)).toContain('From Bob')

  // Alice restricts the board and removes Bob: he is shown the door.
  await alice.getByRole('button', { name: 'Share' }).click()
  await alice.getByRole('combobox', { name: 'General access' }).selectOption('none')
  await alice.getByRole('button', { name: `Remove ${bobAccount.email}` }).click()
  await alice.getByRole('button', { name: 'Done' }).click()
  await expect(bob.getByRole('heading', { name: 'You don’t have access to this board' })).toBeVisible()
})
