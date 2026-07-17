import { test, expect } from '@playwright/test';

function isNMLog(text) {
  const prefixes = [
    '[NM:ctor]', '[NM:audio:', '[NM:_ensureAudioReady]',
    '[NM:socket:', '[NM:visibilitychange]', '[NM:updateState]',
    '[NM:startRinging]', '[NM:stopRinging]', '[NM:resume]',
    '[NM:playReminder]', '[NM:destroy]',
  ];
  return prefixes.some(p => text.startsWith(p));
}

test.describe('Notification Lifecycle Instrumentation', () => {

  test('first notification vs second notification — timeline comparison', async ({ page }) => {
    const allLogs = [];
    page.on('console', (msg) => {
      const text = msg.text();
      if (isNMLog(text)) {
        allLogs.push({ type: msg.type(), text, ts: Date.now() });
        // Print immediately so we see the timeline in real time
        console.log(`[CONSOLE:${msg.type()}] ${text}`);
      }
    });
    page.on('pageerror', (err) => {
      allLogs.push({ type: 'error', text: `[PAGE_ERROR] ${err.message}`, ts: Date.now() });
      console.error(`[PAGE_ERROR] ${err.message}`);
    });

    // --- Login as vendor ---
    await page.goto('/login');
    await page.waitForLoadState('load');

    await page.locator('input[name="email"]').fill('vendor@college.com');
    await page.locator('input[name="password"]').fill('vendor@1');

    // Use Promise.all to handle the navigation
    await Promise.all([
      page.waitForURL('**/vendor/**', { timeout: 15000 }),
      page.locator('button[type="submit"]').click(),
    ]);

    await page.waitForLoadState('load');
    console.log(`\n=== LOGGED IN, on page: ${page.url()} ===\n`);

    // Wait for NotificationManager to be ready
    await page.waitForFunction(() => {
      const nm = window._notificationManager;
      return nm && nm.socket && nm.socket.connected;
    }, { timeout: 15000 });

    console.log(`=== NotificationManager ready ===\n`);

    // Wait for initial pending-count handshake to complete
    await page.waitForTimeout(1000);

    // =====================================================================
    // FIRST NOTIFICATION — simulate pending-count: 1
    // =====================================================================
    console.log(`========== FIRST NOTIFICATION @ t=${Date.now()} ==========\n`);

    const visBefore1 = await page.evaluate(() => ({
      visibilityState: document.visibilityState,
      hidden: document.hidden,
      hasFocus: document.hasFocus(),
    }));
    console.log(`[TEST] Visibility before first notification:`, JSON.stringify(visBefore1));

    // Trigger the notification via the socket's internal callback (same code path as real IO)
    await page.evaluate(() => {
      const nm = window._notificationManager;
      // Directly invoke the pending-count handler the same way socket.io would
      const handlers = nm.socket && nm.socket._callbacks && nm.socket._callbacks['$pending-count'];
      if (handlers && handlers.length > 0) {
        handlers.forEach(fn => fn(1));
      }
    });

    await page.waitForTimeout(3000);

    const audioState1 = await page.evaluate(() => {
      const nm = window._notificationManager;
      return {
        isPlaying: nm.isPlaying,
        pendingOrderCount: nm.pendingOrderCount,
        audioReadyState: nm.audio ? nm.audio.readyState : 'no-audio',
        audioNetworkState: nm.audio ? nm.audio.networkState : 'no-audio',
        visibilityState: document.visibilityState,
      };
    });
    console.log(`[TEST] Audio state after first notification:`, JSON.stringify(audioState1));
    console.log(`\n--- End of first notification timeline ---\n`);

    // =====================================================================
    // VENDOR CLICK (simulates Accept action + user gesture)
    // =====================================================================
    console.log(`========== VENDOR CLICK (Accept) @ t=${Date.now()} ==========\n`);

    // Click on the page to generate a user gesture
    await page.mouse.click(150, 150);
    await page.waitForTimeout(500);

    // Set pending count to 0 (order accepted)
    await page.evaluate(() => {
      const nm = window._notificationManager;
      const handlers = nm.socket && nm.socket._callbacks && nm.socket._callbacks['$pending-count'];
      if (handlers && handlers.length > 0) {
        handlers.forEach(fn => fn(0));
      }
    });

    await page.waitForTimeout(1000);

    const audioStateAccept = await page.evaluate(() => {
      const nm = window._notificationManager;
      return {
        isPlaying: nm.isPlaying,
        pendingOrderCount: nm.pendingOrderCount,
        audioReadyState: nm.audio ? nm.audio.readyState : 'no-audio',
        audioNetworkState: nm.audio ? nm.audio.networkState : 'no-audio',
      };
    });
    console.log(`[TEST] Audio state after accept:`, JSON.stringify(audioStateAccept));
    console.log(`\n--- End of Accept timeline ---\n`);

    // =====================================================================
    // SECOND NOTIFICATION — simulate pending-count: 1 again
    // =====================================================================
    console.log(`========== SECOND NOTIFICATION @ t=${Date.now()} ==========\n`);

    const visBefore2 = await page.evaluate(() => ({
      visibilityState: document.visibilityState,
      hidden: document.hidden,
      hasFocus: document.hasFocus(),
    }));
    console.log(`[TEST] Visibility before second notification:`, JSON.stringify(visBefore2));

    await page.evaluate(() => {
      const nm = window._notificationManager;
      const handlers = nm.socket && nm.socket._callbacks && nm.socket._callbacks['$pending-count'];
      if (handlers && handlers.length > 0) {
        handlers.forEach(fn => fn(1));
      }
    });

    await page.waitForTimeout(2000);

    const audioState2 = await page.evaluate(() => {
      const nm = window._notificationManager;
      return {
        isPlaying: nm.isPlaying,
        pendingOrderCount: nm.pendingOrderCount,
        audioReadyState: nm.audio ? nm.audio.readyState : 'no-audio',
        audioNetworkState: nm.audio ? nm.audio.networkState : 'no-audio',
        visibilityState: document.visibilityState,
      };
    });
    console.log(`[TEST] Audio state after second notification:`, JSON.stringify(audioState2));

    // =====================================================================
    // CHRONOLOGICAL TIMELINE
    // =====================================================================
    console.log(`\n\n========== COMPLETE CHRONOLOGICAL TIMELINE ==========`);
    console.log(`Total events captured: ${allLogs.length}`);
    console.log(`\n`);

    for (let i = 0; i < allLogs.length; i++) {
      const log = allLogs[i];
      // Clean up the log text by removing function name prefixes for readability
      console.log(`[${i}] ${log.text}`);
    }

    console.log(`\n========== END TIMELINE ==========`);

    // Verify the NotificationManager was exercised
    const finalState = await page.evaluate(() => {
      const nm = window._notificationManager;
      return {
        isPlaying: nm.isPlaying,
        hasAudio: !!nm.audio,
        pendingOrderCount: nm.pendingOrderCount,
        audioCreated: !!(nm.audio),
        audioReadyState: nm.audio ? nm.audio.readyState : -1,
      };
    });
    console.log(`[TEST] Final state:`, JSON.stringify(finalState));

    expect(finalState.isPlaying).toBe(true);
    expect(finalState.hasAudio).toBe(true);

    // Verify we got at least 2 startRinging calls
    const ringCalls = allLogs.filter(l => l.text.includes('[NM:startRinging]') && !l.text.includes('SKIP'));
    expect(ringCalls.length).toBeGreaterThanOrEqual(2);

    console.log(`\n=== Instrumentation complete. ${allLogs.length} events logged. ===`);
  });
});
