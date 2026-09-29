// Run with ui/dev/cdp-probe.mjs --driver-file <this file> against everyday.html.
// This verifies the isolated design study; it never opens a production URL.
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const destination = fileURLToPath(new URL('./previews/everyday/', import.meta.url));
export default async function verify(cdp, { url }) {
  if (!url.startsWith('file:') || !url.includes('/everyday.html'))
    throw new Error('This driver only runs against the local everyday study.');
  await mkdir(destination, { recursive: true });
  const evaluate = async expression => {
    const result = await cdp.send('Runtime.evaluate', { expression: `(()=>eval(${JSON.stringify(expression)}))()`, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const settle = () => new Promise(resolve => setTimeout(resolve, 45));
  const go = async route => { await evaluate(`location.hash=${JSON.stringify(route)}`); await settle(); };
  const shot = async name => {
    const result = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile(destination + name + '.png', Buffer.from(result.data, 'base64'));
  };
  const routes = await evaluate('[...document.querySelectorAll("#study-view option")].map(e=>e.value)');
  const checks = [];
  for (const width of [1440, 390, 360]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width < 700 });
    for (const route of routes) {
      await go(route);
      const result = await evaluate(`({ title:document.querySelector('h1')?.textContent, width:document.documentElement.scrollWidth, viewport:innerWidth, rings:[...document.querySelectorAll('.state-ring')].map(e=>{const r=e.getBoundingClientRect();return Math.abs(r.width-r.height)<2}), unnamed:[...document.querySelectorAll('button')].filter(e=>!e.textContent.trim()&&!e.getAttribute('aria-label')&&!e.getAttribute('title')).length })`);
      checks.push({ name: `${route} at ${width}`, passed: !!result.title && result.width <= result.viewport && result.rings.every(Boolean) && result.unnamed === 0, ...result });
      if (width !== 360) await shot(`${route}-${width===1440?'desktop':'phone'}`);
    }
  }
  const assert = async (name, expression) => checks.push({ name, passed: !!await evaluate(expression) });
  await go('devices');
  await evaluate(`document.querySelector('[data-filter-input]').value='climate';document.querySelector('[data-filter-input]').dispatchEvent(new Event('input',{bubbles:true}))`);
  await assert('Device search includes sensors', `[...document.querySelectorAll('[data-filter]')].filter(e=>!e.hidden).length===2`);
  await evaluate(`document.querySelector('[data-filter-input]').value='not-a-device';document.querySelector('[data-filter-input]').dispatchEvent(new Event('input',{bubbles:true}))`);
  await assert('Search shows an empty state', `!document.querySelector('#filter-empty').hidden`);
  await go('room');
  await evaluate(`document.querySelector('[data-open="light"]').click()`);
  await assert('Device row opens shared controls', `document.querySelector('#overlay').open && !!document.querySelector('#overlay [data-brightness]')`);
  await evaluate(`const slider=document.querySelector('#overlay [data-brightness]');slider.value='73';slider.dispatchEvent(new Event('input',{bubbles:true}))`);
  await assert('Brightness updates the control and preview', `document.querySelector('#overlay [data-control-level]').textContent==='73%' && document.querySelector('#overlay .state-ring.large').style.getPropertyValue('--level')==='73'`);
  await cdp.send('Input.dispatchKeyEvent', { type:'keyDown', key:'Escape', code:'Escape', windowsVirtualKeyCode:27 });
  await cdp.send('Input.dispatchKeyEvent', { type:'keyUp', key:'Escape', code:'Escape', windowsVirtualKeyCode:27 });
  await assert('Escape dismisses the control sheet', `!document.querySelector('#overlay').open`);
  await evaluate(`document.querySelector('[data-scene="reading"]').click()`);
  await assert('Scene activation is visible', `document.querySelector('[data-scene="reading"]').classList.contains('active')`);
  await go('heater');
  await evaluate(`const name=document.querySelector('[data-timer][data-key="name"]');name.value='Early commute';name.dispatchEvent(new Event('input',{bubbles:true}))`);
  await go('room'); await go('heater');
  await assert('Timer draft survives navigation', `document.querySelector('[data-timer][data-key="name"]').value==='Early commute' && document.querySelector('#timer-save-state').textContent==='Unsaved changes'`);
  await evaluate(`document.querySelector('[data-action="timer-discard"]').click()`);
  await assert('Discard restores the saved schedule', `document.querySelector('[data-timer][data-key="name"]').value==='Weekday commute'`);
  await evaluate(`document.querySelector('[data-action="timer-add"]').click();document.querySelector('[data-action="timer-save"]').click()`);
  await assert('Added timer saves explicitly', `document.querySelectorAll('.timer-row').length===3 && document.querySelector('#timer-save-state').textContent==='Saved'`);
  await go('capture');
  await evaluate(`const name=document.querySelector('#capture-name');name.value='';name.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('[data-action="capture-save"]').click()`);
  await assert('Capture requires a name', `document.activeElement.id==='capture-name' && !document.querySelector('.tag.green')`);
  await evaluate(`const name=document.querySelector('#capture-name');name.value='Dinner lights';name.dispatchEvent(new Event('input',{bubbles:true}))`);
  await go('map'); await go('capture');
  await assert('Capture draft survives route navigation', `document.querySelector('#capture-name').value==='Dinner lights'`);
  await evaluate(`document.querySelector('[data-action="capture-save"]').click()`);
  await assert('Capture shows save result', `document.querySelector('.tag.green').textContent==='Saved in this demo'`);
  await go('sensor');
  await evaluate(`document.querySelector('#advanced').click()`);
  await assert('Advanced toggle hides raw details', `[...document.querySelectorAll('.technical')].every(e=>getComputedStyle(e).display==='none')`);
  await evaluate(`document.querySelector('#advanced').click()`);
  await cdp.send('Input.dispatchKeyEvent', { type:'keyDown', key:'k', code:'KeyK', windowsVirtualKeyCode:75, modifiers:2 });
  await cdp.send('Input.dispatchKeyEvent', { type:'keyUp', key:'k', code:'KeyK', windowsVirtualKeyCode:75, modifiers:2 });
  await assert('Ctrl+K opens search and focuses input', `document.querySelector('#overlay').open && document.activeElement.id==='global-search'`);
  await evaluate(`document.querySelector('#global-search').value='climate';document.querySelector('#global-search').dispatchEvent(new Event('input',{bubbles:true}))`);
  await cdp.send('Input.dispatchKeyEvent', {type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  await cdp.send('Input.dispatchKeyEvent', {type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  await settle();
  await assert('Enter follows the filtered search result', `location.hash==='#sensor' && !document.querySelector('#overlay').open`);
  await go('assistant');
  await evaluate(`document.querySelector('[data-proposal]').click()`);
  await assert('Assistant apply reflects selection', `document.querySelector('[data-action="assistant-apply"]').textContent==='Apply to 2 lights'`);
  await evaluate(`document.querySelector('[data-action="assistant-apply"]').click()`);
  await assert('Assistant shows applied state', `document.querySelector('[data-action="assistant-apply"]').disabled && document.querySelector('.tag.green').textContent==='Applied in this demo'`);
  await cdp.send('Emulation.setDeviceMetricsOverride', {width:390,height:1000,deviceScaleFactor:1,mobile:true});
  await go('room');
  await evaluate(`document.querySelector('[data-open="light"]').click()`); await shot('light-sheet-phone');
  await evaluate(`document.querySelector('[data-action="close-dialog"]').click();document.querySelector('#theme').value='dark';document.querySelector('#theme').dispatchEvent(new Event('change',{bubbles:true}))`);
  await shot('room-dark-phone');
  await cdp.send('Emulation.setDeviceMetricsOverride', {width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await go('home'); await shot('home-dark-desktop');
  await evaluate(`document.querySelector('#theme').value='light';document.querySelector('#theme').dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('[data-open="prices"]').click()`);
  await shot('prices-dialog-desktop');
  const result = { passed:checks.every(c=>c.passed), checks, scope:'Local synthetic prototype; geometry checks, native Escape/Ctrl+K/Enter, DOM-driven control interactions. Not production acceptance or a full accessibility audit.' };
  await writeFile(destination+'verification.json', JSON.stringify(result,null,2)+'\n');
  return result;
}
