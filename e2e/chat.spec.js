const { test, expect } = require('@playwright/test');

const password = 'e2e-strong-password-123';

async function register(page, name, email) {
  await page.goto('/');
  await page.getByRole('button', { name: 'New here? Create an account' }).click();
  await page.getByLabel('Display name').fill(name);
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel(/^Password/).fill(password);
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Connected');
}

test('two authenticated users chat live, see typing/read receipts, restore history and sign out', async ({ browser }) => {
  const suffix = Date.now();
  const aliceContext = await browser.newContext({ baseURL: 'http://localhost:3101' });
  const bobContext = await browser.newContext({ baseURL: 'http://localhost:3101' });
  const alice = await aliceContext.newPage();
  const bob = await bobContext.newPage();
  const errors = [];
  alice.on('pageerror', (error) => errors.push(error.message));
  bob.on('pageerror', (error) => errors.push(error.message));
  try {
    await register(alice, 'Alice', `alice-${suffix}@example.test`);
    await register(bob, 'Bob', `bob-${suffix}@example.test`);
    await alice.getByRole('button', { name: 'New chat', exact: true }).click();
    await alice.getByRole('button', { name: 'Select Bob' }).click();
    await alice.getByRole('button', { name: 'Start chat', exact: true }).click();
    await bob.getByRole('button', { name: 'Open chat with Alice' }).click();
    await alice.getByLabel('Message', { exact: true }).fill('Hello from Alice');
    await expect(bob.getByText('Alice is typing...')).toBeVisible();
    await alice.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(bob.getByRole('log')).toContainText('Hello from Alice');
    await expect(alice.getByLabel('Read by everyone')).toBeVisible();
    await bob.getByLabel('Message', { exact: true }).fill('Hello back from Bob');
    await bob.getByLabel('Message', { exact: true }).press('Enter');
    await expect(alice.getByRole('log')).toContainText('Hello back from Bob');
    await alice.reload();
    await expect(alice.getByRole('status')).toHaveText('Connected');
    await alice.getByRole('button', { name: 'Open chat with Bob' }).click();
    await expect(alice.getByRole('log')).toContainText('Hello from Alice');
    await expect(alice.getByRole('log')).toContainText('Hello back from Bob');
    await alice.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(alice.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
    await expect(alice.getByRole('alert')).toHaveCount(0);
    await expect(bob.getByText('Offline', { exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await aliceContext.close();
    await bobContext.close();
  }
});

test('mobile layout supports a group conversation and navigating back to chats', async ({ browser }) => {
  const suffix = Date.now();
  const context = await browser.newContext({ baseURL: 'http://localhost:3101', viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  try {
    for (const [index, name] of ['Group friend one', 'Group friend two'].entries()) {
      const response = await context.request.post('/api/auth/register', {
        headers: { Origin: 'http://localhost:3101' },
        data: { name, email: `group-${index}-${suffix}@example.test`, password },
      });
      expect(response.status()).toBe(201);
    }
    await context.clearCookies();
    await register(page, 'Mobile user', `mobile-${suffix}@example.test`);
    await page.getByRole('button', { name: 'New chat', exact: true }).click();
    await page.getByRole('button', { name: 'Select Group friend one' }).click();
    await page.getByRole('button', { name: 'Select Group friend two' }).click();
    await page.getByLabel('Group name').fill('Weekend crew');
    await page.getByRole('button', { name: 'Start chat', exact: true }).click();
    await expect(page.getByText('3 members')).toBeVisible();
    await page.getByLabel('Message', { exact: true }).fill('Group hello');
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(page.getByRole('log')).toContainText('Group hello');
    await page.getByRole('button', { name: 'Back to chats' }).click();
    await expect(page.getByRole('button', { name: 'Open chat with Weekend crew' })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    expect(overflow).toBe(false);
  } finally { await context.close(); }
});
