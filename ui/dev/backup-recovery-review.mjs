import { writeFile } from 'node:fs/promises';

// Only preview POSTs reach the synthetic fixture. Apply/export responses are
// intercepted; this driver never restores configuration or commands devices.
export default async function (cdp, { width, url }) {
  const origin = 'http://127.0.0.1:3021',
    base = origin + '/api/v1/config';
  const marker = await fetch(base + '/export');
  if (
    !url.startsWith(origin + '/') ||
    marker.headers.get('x-homectl-fixture') !== 'true'
  )
    throw Error('Marked fixture required');
  const original = (await marker.json()).data;
  const candidate = structuredClone(original);
  candidate.groups[0].name = 'Reviewed room';
  for (let i = 0; i < 205; i++)
    candidate.groups.push({
      id: `backup-review-${i}`,
      name: `Review room ${String(i).padStart(3, '0')}`,
      hidden: false,
      devices: [],
      linked_groups: [],
    });
  let reviewCalls = 0,
    applyCalls = 0,
    failReview = false,
    holdReview = false,
    heldReview,
    heldApply,
    exportCalls = 0;
  const errors = [],
    checks = [];
  const fulfill = (requestId, data, status = 200) =>
    cdp.send('Fetch.fulfillRequest', {
      requestId,
      responseCode: status,
      responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
      body: Buffer.from(JSON.stringify(data)).toString('base64'),
    });
  await cdp.send('Fetch.enable', {
    patterns: [
      { urlPattern: base + '/import*' },
      { urlPattern: base + '/export*' },
    ],
  });
  cdp.on('Fetch.requestPaused', (e) => {
    void (async () => {
      const path = new URL(e.request.url).pathname;
      if (path.endsWith('/export')) {
        exportCalls++;
        return fulfill(
          e.requestId,
          { success: false, error: 'Fixture export unavailable' },
          503,
        );
      }
      if (path.endsWith('/preview')) {
        reviewCalls++;
        if (holdReview) {
          heldReview = e.requestId;
          return;
        }
        if (failReview)
          return fulfill(
            e.requestId,
            { success: false, error: 'Fixture review unavailable' },
            503,
          );
        return cdp.send('Fetch.continueRequest', { requestId: e.requestId });
      }
      applyCalls++;
      heldApply = e.requestId;
    })().catch((e) => errors.push(e.message));
  });
  const evaluate = async (expression) => {
    const r = await cdp.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails)
      throw Error(
        r.exceptionDetails.exception?.description ?? r.exceptionDetails.text,
      );
    return r.result.value;
  };
  const pause = () => new Promise((r) => setTimeout(r, 140));
  const until = async (expression, message) => {
    for (let i = 0; i < 110; i++) {
      if (await evaluate(expression)) return;
      await pause();
    }
    throw Error(message);
  };
  const button = (text) =>
    `[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(text)})`;
  const file = `document.querySelector('input[type=file]')`;
  const click = async (expression) => {
    const p = await evaluate(
      `(()=>{const e=${expression};if(!e)throw Error('Missing target');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`,
    );
    for (const type of ['mousePressed', 'mouseReleased'])
      await cdp.send('Input.dispatchMouseEvent', {
        type,
        ...p,
        button: 'left',
        clickCount: 1,
      });
    await pause();
  };
  const key = async (key, code, modifiers = 0) => {
    for (const type of ['keyDown', 'keyUp'])
      await cdp.send('Input.dispatchKeyEvent', {
        type,
        key,
        windowsVirtualKeyCode: code,
        modifiers,
      });
    await pause();
  };
  const upload = async (name, body, mode = 'normal') => {
    await evaluate(
      `(()=>{const file=new File([${mode === 'oversize' ? 'new Uint8Array(33*1024*1024)' : JSON.stringify(typeof body === 'string' ? body : JSON.stringify(body))}],${JSON.stringify(name)},{type:'application/json'});if(${JSON.stringify(mode)}==='pending')Object.defineProperty(file,'text',{value:()=>new Promise((resolve,reject)=>{window.pendingFileRead={resolve,reject}})});const transfer=new DataTransfer();transfer.items.add(file);const input=${file};input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`,
    );
    await pause();
  };
  const assert = (name, ok) => {
    if (!ok) throw Error(name);
    checks.push({ name, passed: true });
  };
  const check = async (name, expression) =>
    assert(name, await evaluate(expression));
  const shot = async (state) => {
    const { data } = await cdp.send('Page.captureScreenshot', {
      format: 'png',
    });
    await writeFile(
      `/tmp/backup-recovery-${width}-${state}.png`,
      Buffer.from(data, 'base64'),
    );
  };
  const reviewReady = () =>
    until('!!' + button('Restore backup'), 'Review ready');
  const filter = `document.querySelector('input[placeholder="Name, category or change"]')`;
  const typeFilter = async (text) => {
    await click(filter);
    await key('a', 65, 2);
    await key('Backspace', 8);
    if (text) await cdp.send('Input.insertText', { text });
    await pause();
  };
  try {
    await cdp.send('Page.navigate', { url: origin + '/config/import-export' });
    await until('!!' + file, 'Backup page');
    await upload('many-rooms.json', candidate);
    await reviewReady();
    await check(
      'Large review initially renders 80 entries',
      'document.querySelectorAll(\'[aria-label="Affected entries"] li\').length===80',
    );
    await check(
      'Completed review receives focus',
      "document.activeElement.id==='backup-review-title'",
    );
    await click(
      "[...document.querySelectorAll('button')].find(e=>e.textContent.startsWith('Show more'))",
    );
    await check(
      'Show more reveals the next 80 entries',
      'document.querySelectorAll(\'[aria-label="Affected entries"] li\').length===160',
    );
    await typeFilter('Review room 204');
    await check(
      'Filter finds an entry beyond the rendered page',
      "document.querySelectorAll('[aria-label=\"Affected entries\"] li').length===1 && document.querySelector('[aria-label=\"Affected entries\"]').textContent.includes('Review room 204')",
    );
    await shot('filtered');
    await typeFilter('');
    await click(button('Restore backup'));
    await until('!!' + button('Restore and replace'), 'Confirmation');
    await key('Escape', 27);
    await until(
      "!document.querySelector('[role=dialog]')",
      'Confirmation closed',
    );
    await check(
      'Cancel restores keyboard focus to Restore',
      'document.activeElement===' + button('Restore backup'),
    );
    assert('Review and cancellation issue no apply request', applyCalls === 0);
    const before = reviewCalls;
    await upload('invalid.json', '{broken');
    await until(
      "document.body.textContent.includes('Could not read the backup')",
      'Invalid file feedback',
    );
    await check(
      'Invalid replacement cannot restore the previous file',
      button('Review again') +
        '.disabled && !' +
        button('Restore backup') +
        ' && document.body.textContent.includes("invalid.json") && !document.body.textContent.includes("many-rooms.json")',
    );
    assert('Invalid JSON is not sent for review', reviewCalls === before);
    await upload('too-large.json', null, 'oversize');
    await check(
      'Oversized file has a clear local error and disabled review',
      "document.body.textContent.includes('smaller than 32 MB') && " +
        button('Review again') +
        '.disabled',
    );
    assert('Oversized upload performs no request', reviewCalls === before);
    await upload('slow-invalid.json', null, 'pending');
    await check(
      'Pending file read has feedback and cannot restore',
      "document.body.textContent.includes('Reading backup…') && " +
        button('Reading…') +
        '.disabled',
    );
    await upload('newer.json', candidate);
    await reviewReady();
    await evaluate(
      "window.pendingFileRead.reject(new Error('Old read failed'))",
    );
    await pause();
    await check(
      'Superseded read failure cannot replace the newer review',
      "!document.body.textContent.includes('Old read failed') && document.body.textContent.includes('newer.json') && !!" +
        button('Restore backup'),
    );
    await upload('discard-reading.json', null, 'pending');
    const readBefore = reviewCalls;
    await click(button('Discard'));
    await evaluate(
      'window.pendingFileRead.resolve(' +
        JSON.stringify(JSON.stringify(candidate)) +
        ')',
    );
    await pause();
    assert(
      'Discarded file read never starts a review',
      reviewCalls === readBefore,
    );
    await check(
      'Discard clears the pending file and save bar',
      "!document.querySelector('[aria-label=\"Restore backup\"]') && !document.body.textContent.includes('Reading backup…')",
    );
    await upload('navigation-reading.json', null, 'pending');
    const history = await cdp.send('Page.getNavigationHistory');
    const entryId = history.entries[history.currentIndex].id;
    await click('document.querySelector(\'a[href="/config/migration"]\')');
    await until(
      "location.pathname==='/config/migration'",
      'Navigated during read',
    );
    const navigationBefore = reviewCalls;
    await evaluate(
      'window.pendingFileRead.resolve(' +
        JSON.stringify(JSON.stringify(candidate)) +
        ')',
    );
    await pause();
    assert(
      'Unmount cancels publication of a pending read',
      reviewCalls === navigationBefore,
    );
    await cdp.send('Page.navigateToHistoryEntry', { entryId });
    await until('!!' + file, 'Returned');
    await check(
      'Interrupted read gives a usable next step on return',
      "document.body.textContent.includes('Choose this file again') && " +
        button('Review again') +
        '.disabled',
    );
    await click(button('Discard'));
    holdReview = true;
    await upload('pending-review.json', candidate);
    await until(
      "document.body.textContent.includes('Reviewing backup…')",
      'Pending review',
    );
    await click(button('Discard'));
    holdReview = false;
    if (heldReview)
      await cdp
        .send('Fetch.continueRequest', { requestId: heldReview })
        .catch(() => {});
    await pause();
    await check(
      'Canceled review cannot restore the discarded candidate',
      '!document.querySelector(\'[aria-label="Restore backup"]\') && !document.querySelector(\'[aria-label="Affected entries"]\')',
    );
    failReview = true;
    await upload('retry-review.json', candidate);
    await until(
      "document.body.textContent.includes('Fixture review unavailable')",
      'Review error',
    );
    await check(
      'Failed review keeps the candidate for an explicit retry',
      button('Review again') +
        ' && !' +
        button('Review again') +
        '.disabled && document.body.textContent.includes("retry-review.json")',
    );
    failReview = false;
    await click(button('Review again'));
    await reviewReady();
    await click(button('Restore backup'));
    await until('!!' + button('Restore and replace'), 'Apply confirmation');
    await click(button('Restore and replace'));
    await until(
      "document.body.textContent.includes('Restoring…')",
      'Apply pending',
    );
    await check(
      'Pending apply locks file replacement, Discard and resubmission',
      file +
        '.disabled && ' +
        button('Discard') +
        '.disabled && ' +
        button('Restore backup') +
        '.disabled',
    );
    for (let i = 0; i < 50 && !heldApply; i++) await pause();
    assert(
      'Explicit confirmation sends one apply request',
      applyCalls === 1 && !!heldApply,
    );
    await fulfill(
      heldApply,
      { success: false, error: 'Fixture lifecycle failed' },
      503,
    );
    await until(
      '!!' +
        button('Review again') +
        ' && !' +
        button('Review again') +
        '.disabled',
      'Failed apply ready for review',
    );
    await check(
      'Failed apply keeps file and requires a fresh review',
      "document.body.textContent.includes('Fixture lifecycle failed') && document.body.textContent.includes('retry-review.json') && !" +
        button('Restore backup'),
    );
    await shot('apply-failed');
    await click(button('Download backup'));
    await until(
      "document.body.textContent.includes('Fixture export unavailable')",
      'Export error',
    );
    await check(
      'Export failure is shown in the download section',
      "[...document.querySelectorAll('section')].find(s=>s.textContent.includes('Download a backup')).textContent.includes('Fixture export unavailable')",
    );
    await click(button('Download backup'));
    assert('Export can be retried explicitly', exportCalls === 2);
    await check(
      'Recovery fits the viewport',
      'document.documentElement.scrollWidth<=innerWidth+1',
    );
    assert(
      'Read-only journey leaves fixture configuration unchanged',
      JSON.stringify((await (await fetch(base + '/export')).json()).data) ===
        JSON.stringify(original),
    );
    assert(
      'Interception completed without unexpected errors',
      errors.length === 0,
    );
    await click(button('Discard'));
    return {
      passed: true,
      checks,
      expectedErrors: 'Injected review/apply/export HTTP 503 responses',
    };
  } catch (error) {
    await shot('failure');
    throw error;
  } finally {
    await cdp.send('Fetch.disable');
  }
}
