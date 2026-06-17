import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = 'http://localhost:5173'
const OUT = process.argv[2] ?? '.playwright-shots'
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('console', (m) => m.type() === 'error' && console.log('PAGE ERROR:', m.text()))

await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
await page.fill('input[placeholder="your.username"]', 'admin')
await page.fill('input[type="password"]', 'password')
await page.click('button[type="submit"]')
await page.waitForURL('**/dashboard', { timeout: 20000 })

console.log('users list…')
await page.goto(`${BASE}/users`, { waitUntil: 'networkidle' })
await page.waitForTimeout(700)
await page.screenshot({ path: `${OUT}/users-list.png` })

console.log('add-user dialog…')
await page.getByRole('button', { name: 'Add user' }).click()
await page.waitForTimeout(500)
await page.screenshot({ path: `${OUT}/users-add.png` })
await page.keyboard.press('Escape')
await page.waitForTimeout(300)

console.log('import dialog…')
await page.getByRole('button', { name: 'Import' }).click()
await page.waitForTimeout(500)
await page.screenshot({ path: `${OUT}/users-import.png` })

await browser.close()
console.log('done')
