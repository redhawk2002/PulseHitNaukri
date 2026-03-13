const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);
const config = require('./config');
const logger = require('./logger');
const path = require('path');
const { randomDelay } = require('./utils/time');

// ---------------------------------------------------------------------------
// Helper: Find and click the "Key skills" edit icon with precise selectors
// Based on actual Naukri DOM: section is div#lazyKeySkills.keySkills,
// heading is span.widgetTitle inside div.widgetHead, edit icon is span.edit.icon
// ---------------------------------------------------------------------------
async function findKeySkillsEditIcon(page) {
  // First scroll the Key Skills section into view
  logger.info('Scrolling to find Key Skills section...');
  try {
    // Use the unique #lazyKeySkills container to scroll precisely
    const keySkillsSection = page.locator('#lazyKeySkills, div.keySkills').first();
    if (await keySkillsSection.count() > 0) {
      await keySkillsSection.scrollIntoViewIfNeeded({ timeout: 5000 });
      await randomDelay(500, 1000);
      logger.info('Scrolled to #lazyKeySkills section.');
    } else {
      // Fallback: scroll to the "Key skills" widgetTitle heading
      const heading = page.locator('span.widgetTitle:text-is("Key skills")').first();
      if (await heading.count() > 0) {
        await heading.scrollIntoViewIfNeeded({ timeout: 5000 });
        await randomDelay(500, 1000);
        logger.info('Scrolled to span.widgetTitle "Key skills".');
      } else {
        await page.evaluate(() => window.scrollBy(0, 800));
        await randomDelay(1000, 1500);
        logger.warn('Could not find Key Skills section to scroll to, scrolled page manually.');
      }
    }
  } catch (e) {
    logger.warn(`Scroll failed: ${e.message}. Scrolling page manually.`);
    await page.evaluate(() => window.scrollBy(0, 800));
    await randomDelay(1000, 1500);
  }

  // Now find the edit icon using precise strategies (most specific first)
  const strategies = [
    {
      name: '#lazyKeySkills span.edit.icon',
      locator: () => page.locator('#lazyKeySkills span.edit.icon').first()
    },
    {
      name: 'div.keySkills span.edit.icon',
      locator: () => page.locator('div.keySkills span.edit.icon').first()
    },
    {
      name: '.widgetHead with "Key skills" widgetTitle > span.edit',
      locator: () => page.locator('.widgetHead:has(span.widgetTitle:text-is("Key skills")) span.edit').first()
    },
    {
      name: '#lazyKeySkills [class*="edit"]',
      locator: () => page.locator('#lazyKeySkills [class*="edit"]').first()
    },
    {
      name: 'div.keySkills [class*="edit"]',
      locator: () => page.locator('div.keySkills [class*="edit"]').first()
    },
    {
      name: '.widgetHead with exact "Key skills" text nearby edit',
      locator: () => {
        // widgetHead has 2 children: span.widgetTitle and span.edit.icon
        return page.locator('.widgetHead:has-text("Key skills")').locator('span.edit, span[class*="edit"]').first();
      }
    }
  ];

  for (const strategy of strategies) {
    try {
      const el = strategy.locator();
      if (await el.count() > 0 && await el.isVisible({ timeout: 2000 })) {
        logger.info(`Found edit icon using strategy: "${strategy.name}"`);
        return el;
      }
    } catch (e) {
      logger.info(`Strategy "${strategy.name}" failed, trying next...`);
    }
  }

  // Last resort: log debug info for remote troubleshooting
  try {
    const pageUrl = page.url();
    logger.warn(`Debug: URL=${pageUrl}`);
    const lazyExists = await page.locator('#lazyKeySkills').count();
    const keySkillsClassExists = await page.locator('div.keySkills').count();
    const editSpanCount = await page.locator('span.edit.icon').count();
    logger.warn(`Debug: #lazyKeySkills exists: ${lazyExists > 0}, div.keySkills exists: ${keySkillsClassExists > 0}, span.edit.icon count: ${editSpanCount}`);
  } catch (e) { /* ignore debug errors */ }

  return null;
}

// ---------------------------------------------------------------------------
// Helper: Safely scroll an element into view with fallback
// ---------------------------------------------------------------------------
async function safeScrollIntoView(page, element) {
  try {
    await element.scrollIntoViewIfNeeded({ timeout: 5000 });
  } catch (e) {
    logger.warn('scrollIntoViewIfNeeded failed, using JS fallback...');
    try {
      await element.evaluate(el => el.scrollIntoView({ behavior: 'smooth', block: 'center' }));
      await randomDelay(500, 1000);
    } catch (jsErr) {
      logger.warn(`JS scrollIntoView also failed: ${jsErr.message}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Helper: Wait for the profile page to be fully loaded and ready
// ---------------------------------------------------------------------------
async function waitForProfileReady(page) {
  try {
    await page.waitForLoadState('networkidle', { timeout: 15000 });
  } catch (e) {
    logger.warn('networkidle timeout, continuing anyway...');
  }
  // Wait for a known profile page element to confirm the page is ready
  try {
    await page.waitForSelector('text="Key skills"', { state: 'visible', timeout: 15000 });
    logger.info('Profile page loaded — "Key skills" section visible.');
  } catch (e) {
    logger.warn('Could not confirm "Key skills" section visibility. Proceeding anyway...');
  }
  await randomDelay(1000, 2000);
}

// ---------------------------------------------------------------------------
// Helper: Take a debug screenshot (saved to logs dir)
// ---------------------------------------------------------------------------
async function takeDebugScreenshot(page, label) {
  try {
    const fs = require('fs');
    const logsDir = path.join(__dirname, '../logs');
    if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
    const dateStr = new Date().toISOString().replace(/[:.]/g, '-');
    const screenshotPath = path.join(logsDir, `debug-${label}-${dateStr}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    logger.info(`Debug screenshot saved: ${screenshotPath}`);
  } catch (e) {
    logger.warn(`Could not save debug screenshot: ${e.message}`);
  }
}

// ===========================================================================
// Main automation function
// ===========================================================================
async function runProfileUpdate() {
  logger.info('Starting Naukri Profile Update automation...');
  let browser;
  try {
    browser = await chromium.launch({
      headless: config.headless,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--start-maximized'
      ]
    });

    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });

    // 1. Inject saved session cookies to bypass login (avoids OTP on new IPs)
    const rawCookies = process.env.NAUKRI_COOKIES;
    if (!rawCookies) {
      throw new Error('NAUKRI_COOKIES env var is not set. Please export cookies from your browser and set this variable in Render.');
    }
    let cookies;
    try {
      cookies = JSON.parse(rawCookies);
    } catch (e) {
      throw new Error(`Failed to parse NAUKRI_COOKIES: ${e.message}`);
    }

    // Map cookie-editor format to Playwright format
    const playwrightCookies = cookies.map(c => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path || '/',
      expires: c.expirationDate ? Math.floor(c.expirationDate) : -1,
      httpOnly: c.httpOnly || false,
      secure: c.secure || false,
      sameSite: (() => {
        const s = (c.sameSite || '').toLowerCase();
        if (s === 'strict') return 'Strict';
        if (s === 'lax') return 'Lax';
        return 'None';
      })()
    }));

    await context.addCookies(playwrightCookies);
    logger.info(`Injected ${playwrightCookies.length} session cookies. Skipping login form.`);

    const page = await context.newPage();

    // 2. Verify session is valid by navigating to the user homepage
    logger.info('Verifying session by navigating to Naukri homepage...');
    await page.goto('https://www.naukri.com/mnjuser/homepage', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await randomDelay(2000, 3000);

    if (page.url().includes('login')) {
      throw new Error('Session cookies are expired or invalid. Please re-export cookies from your browser and update NAUKRI_COOKIES in Render.');
    }
    logger.info('Session verified. Logged in successfully via cookies.');
    
    // 3. Navigate to Profile
    logger.info('Navigating to profile page...');
    await page.goto('https://www.naukri.com/mnjuser/profile', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitForProfileReady(page);

    // 4. Implement Update logic — Key Skills Toggle
    logger.info('Applying profile update strategy: Key Skills Toggle...');
    try {
        // ============================================================
        // PASS 1: Open Key Skills, remove "Python" (if present), Save
        // ============================================================
        logger.info('=== PASS 1: Removing Python skill (if present) ===');
        
        const editIcon = await findKeySkillsEditIcon(page);
        if (!editIcon) {
            await takeDebugScreenshot(page, 'no-edit-icon-pass1');
            throw new Error('Could not find Key skills edit icon.');
        }

        logger.info('Clicking Key skills edit icon...');
        await editIcon.click();
        await randomDelay(3000, 4000);
        
        // Look for Python chip and remove it
        const allChips = page.locator('span, div, a').filter({ hasText: /^Python$/i });
        const chipCount = await allChips.count();
        
        if (chipCount > 0) {
            logger.info(`Found ${chipCount} element(s) matching "Python". Attempting removal...`);
            for (let i = 0; i < chipCount; i++) {
                const chip = allChips.nth(i);
                try {
                    if (await chip.isVisible()) {
                        const closeBtn = chip.locator('xpath=./following-sibling::*[1] | ..//*[contains(@class,"close") or contains(@class,"cross") or contains(@class,"remove") or contains(@class,"del")]').first();
                        
                        if (await closeBtn.count() > 0 && await closeBtn.isVisible()) {
                            logger.info('Found delete (✕) button for Python chip. Clicking...');
                            await closeBtn.click();
                            await randomDelay(1000, 2000);
                            logger.info('Python chip removed successfully.');
                            break;
                        } else {
                            const xText = chip.locator('xpath=..//span[text()="×" or text()="✕" or text()="x" or text()="X"]').first();
                            if (await xText.count() > 0) {
                                logger.info('Found ✕ text element. Clicking...');
                                await xText.click();
                                await randomDelay(1000, 2000);
                                logger.info('Python chip removed successfully.');
                                break;
                            }
                        }
                    }
                } catch (e) {
                    logger.warn(`Could not remove chip at index ${i}: ${e.message}`);
                }
            }
        } else {
            logger.info('No existing "Python" chip found. Skipping removal pass.');
        }
        
        // Save after removal (even if Python wasn't found, save to close the modal)
        logger.info('PASS 1: Clicking Save...');
        let saveBtn = page.getByRole('button', { name: 'Save' });
        if (await saveBtn.count() > 0 && await saveBtn.isVisible()) {
            await saveBtn.click();
        } else {
            const fallbackSave = page.locator('button:has-text("Save")').last();
            if (await fallbackSave.count() > 0 && await fallbackSave.isVisible({ timeout: 3000 })) {
                await fallbackSave.click();
            } else {
                logger.warn('PASS 1: Could not find Save button. Taking screenshot...');
                await takeDebugScreenshot(page, 'no-save-btn-pass1');
                throw new Error('PASS 1: Save button not found.');
            }
        }
        
        await randomDelay(5000, 7000);
        logger.info('PASS 1: Save completed. Python removed from profile.');
        
        // ============================================================
        // PASS 2: Re-open Key Skills popup and Add "Python" back
        // ============================================================
        logger.info('=== PASS 2: Re-adding Python skill ===');
        
        // Re-navigate to the clean profile URL (not the ?id=&altresid variant)
        await page.goto('https://www.naukri.com/mnjuser/profile', { waitUntil: 'domcontentloaded', timeout: 30000 });
        await waitForProfileReady(page);
        
        // Re-find the edit icon using the same robust helper
        const editIcon2 = await findKeySkillsEditIcon(page);
        if (!editIcon2) {
            await takeDebugScreenshot(page, 'no-edit-icon-pass2');
            throw new Error('PASS 2: Could not find Key skills edit icon.');
        }

        logger.info('PASS 2: Found Key skills edit icon! Clicking...');
        await editIcon2.click();
        await randomDelay(3000, 4000);
        
        // Find the "Add skills" input
        let skillInput = null;
        const selectors = [
            'input[placeholder*="Add skill" i]',
            'input[placeholder*="skill" i]',
            'input.sugInp',
            '#skillInput',
            '.inputDiv input',
            'input[type="text"]',
        ];
        
        for (const sel of selectors) {
            const el = page.locator(sel).first();
            try {
                if (await el.count() > 0 && await el.isVisible({ timeout: 2000 })) {
                    skillInput = el;
                    logger.info(`PASS 2: Found skill input using selector: "${sel}"`);
                    break;
                }
            } catch (e) { /* continue */ }
        }
        
        if (!skillInput) {
            const addSkillsText = page.getByPlaceholder('Add skills');
            if (await addSkillsText.count() > 0) {
                skillInput = addSkillsText;
                logger.info('PASS 2: Found skill input via getByPlaceholder.');
            } else {
                await takeDebugScreenshot(page, 'no-skill-input-pass2');
                throw new Error('PASS 2: Cannot locate the "Add skills" input field.');
            }
        }
        
        // Safely scroll into view and click input
        logger.info('PASS 2: Scrolling to and clicking "Add skills" input...');
        await safeScrollIntoView(page, skillInput);
        await randomDelay(500, 800);
        
        try {
            await skillInput.click({ timeout: 5000 });
        } catch (clickErr) {
            logger.warn('Normal click failed, trying force click...');
            await skillInput.click({ force: true, timeout: 5000 });
        }
        await randomDelay(1000, 1500);
        
        // Type Python
        logger.info('PASS 2: Typing "Python" using keyboard...');
        await page.keyboard.press('Control+a');
        await page.keyboard.press('Backspace');
        await randomDelay(500, 800);
        await page.keyboard.type('Python', { delay: 200 });
        logger.info('PASS 2: Finished typing "Python". Waiting for suggestions...');
        await randomDelay(3000, 4000);
        
        // Select from suggestions
        let suggestionClicked = false;
        const sugSelectors = [
            'ul.sugList li', '.sugList li', 'ul[class*="sug"] li',
            '.Sbody li', 'div[class*="suggestion"] li', 'li[class*="sug"]',
        ];
        
        for (const sugSel of sugSelectors) {
            const sug = page.locator(sugSel).filter({ hasText: /^Python$/i }).first();
            try {
                if (await sug.count() > 0 && await sug.isVisible({ timeout: 1000 })) {
                    logger.info(`PASS 2: Found exact "Python" suggestion using "${sugSel}". Clicking...`);
                    await sug.click();
                    suggestionClicked = true;
                    break;
                }
            } catch (e) { /* continue */ }
        }
        
        if (!suggestionClicked) {
            logger.info('PASS 2: No exact suggestion dropdown matched. Pressing Enter...');
            await page.keyboard.press('Enter');
            await randomDelay(1000, 1500);
            logger.info('PASS 2: Pressing Comma (,) to force chip creation...');
            await page.keyboard.press(',');
        }
        
        await randomDelay(2000, 3000);
        
        // Save after adding Python
        logger.info('PASS 2: Clicking Save...');
        saveBtn = page.getByRole('button', { name: 'Save' });
        if (await saveBtn.count() > 0 && await saveBtn.isVisible()) {
            await saveBtn.click();
        } else {
            const fallbackSave = page.locator('button:has-text("Save")').last();
            if (await fallbackSave.count() > 0 && await fallbackSave.isVisible({ timeout: 3000 })) {
                await fallbackSave.click();
            } else {
                await takeDebugScreenshot(page, 'no-save-btn-pass2');
                throw new Error('PASS 2: Save button not found.');
            }
        }
        
        await randomDelay(5000, 7000);
        logger.info('PASS 2: Save completed. Python re-added to profile.');
        logger.info('Successfully executed Key Skills two-pass toggle update.');
    } catch (e) {
        logger.warn(`Key Skills update failed: ${e.message}`);
        throw new Error(`Automation step failed: ${e.message}`);
    }

    // Wait for success toast or modal to close
    logger.info('Waiting for save to confirm...');
    await randomDelay(3000, 5000);

  } catch (error) {
    logger.error(`Automation failed: ${error.message}`);
    if (browser) {
      const contexts = browser.contexts();
      if (contexts.length > 0) {
        const pages = contexts[0].pages();
        if (pages.length > 0) {
            const dateStr = new Date().toISOString().replace(/[:.]/g, '-');
            const logsDir = path.join(__dirname, '../logs');
            const screenshotPath = path.join(logsDir, `error-${dateStr}.png`);
            await pages[0].screenshot({ path: screenshotPath, fullPage: true });
            logger.info(`Saved error screenshot to ${screenshotPath}`);
            
            // Cleanup: keep only the 3 most recent error screenshots to save disk space
            try {
              const fs = require('fs');
              const errorScreenshots = fs.readdirSync(logsDir)
                .filter(f => f.startsWith('error-') && f.endsWith('.png'))
                .sort()
                .reverse();
              errorScreenshots.slice(3).forEach(old => {
                fs.unlinkSync(path.join(logsDir, old));
                logger.info(`Cleaned up old error screenshot: ${old}`);
              });
            } catch (cleanupErr) { /* ignore cleanup errors */ }
        }
      }
    }
    throw error; // Rethrow to be caught by scheduler for retries
  } finally {
    if (browser) {
      await browser.close();
      logger.info('Browser closed.');
    }
  }
}

module.exports = {
  runProfileUpdate
};
