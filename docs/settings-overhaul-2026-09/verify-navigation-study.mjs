/** Standalone concept interaction check; never touches the application API. */
export default async function (cdp, { url, width }) {
  if (
    !url.startsWith(
      "file:///home/rasse/homectl/docs/settings-overhaul-2026-09/navigation-study.html",
    )
  )
    throw Error("Standalone study required");
  const checks = [];
  const run = async (expression) => {
    const result = await cdp.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails)
      throw Error(
        result.exceptionDetails.exception?.description ||
          result.exceptionDetails.text,
      );
    return result.result.value;
  };
  const pause = (ms) => new Promise((r) => setTimeout(r, ms ?? 120));
  const assert = async (expression, name) => {
    if (!(await run(expression))) throw Error(name);
    checks.push(name);
  };
  const click = async (selector) => {
    const point = await run(
      `(()=>{const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.getBoundingClientRect().width);if(!e)throw Error('Missing visible target');const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`,
    );
    for (const type of ["mousePressed", "mouseReleased"])
      await cdp.send("Input.dispatchMouseEvent", {
        type,
        ...point,
        button: "left",
        buttons: type === "mousePressed" ? 1 : 0,
        clickCount: 1,
      });
    await pause();
  };
  await assert(
    "document.documentElement.scrollWidth<=innerWidth",
    "No horizontal document overflow",
  );
  if (width > 950) {
    await assert(
      "document.querySelector('.app-sidebar .settings-scroll').querySelectorAll('a').length===20",
      "Full sidebar includes all 19 sections and Overview",
    );
    await assert(
      "document.querySelectorAll('.app-sidebar .nav-item.active').length===1",
      "Full sidebar emphasizes one actual current page",
    );
    await click('[data-action="collapse"]');
    await assert(
      "document.querySelector('.workspace').getBoundingClientRect().left===76",
      "Collapsing gives the page a 76 px rail",
    );
    await click('.rail [data-action="panel"]');
    await assert(
      "document.querySelector('.rail-panel').getBoundingClientRect().width===248&&document.querySelector('.workspace').getBoundingClientRect().left===76",
      "Collapsed full sidebar opens settings without moving the page",
    );
    await run(
      "document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))",
    );
    await assert(
      "!document.querySelector('.rail-panel').getBoundingClientRect().width",
      "Escape closes the floating settings panel",
    );
    await click('[data-direction="rail"]');
    await assert(
      "document.querySelector('.workspace').getBoundingClientRect().left===324",
      "Pinned rail panel reserves its exact width",
    );
    await assert(
      "document.querySelector('.rail-panel .settings-scroll').querySelectorAll('a').length===20",
      "Rail panel preserves the complete settings catalog",
    );
    await click('[data-action="pin"]');
    await assert(
      "document.querySelector('.workspace').getBoundingClientRect().left===76",
      "Unpinning gives space back while keeping settings visible",
    );
    await click('.rail [data-view="map"]');
    await assert(
      "!!document.querySelector('.map-stage')&&document.querySelector('.workspace').getBoundingClientRect().left===76",
      "Floorplan and settings share a stable rail",
    );
    await click(".map-tools button");
    await assert(
      "!document.querySelector('.rail-panel').getBoundingClientRect().width",
      "Clicking outside dismisses an unpinned panel",
    );
    await click('.rail [data-action="panel"]');
    await click('[data-action="pin"]');
    await click('.rail-panel [data-category="logs"]');
    await assert(
      "document.querySelector('h1').textContent==='Logs'",
      "Category navigation updates heading and destination",
    );
  } else {
    await click('[data-action="open-mobile"]');
    await assert(
      "document.querySelector('.mobile-open .app-sidebar').getBoundingClientRect().width===340",
      "Phone drawer has explicit labels and a bounded width",
    );
    await assert(
      "[...document.querySelectorAll('.app-sidebar .settings-scroll .nav-item')].every(e=>e.getBoundingClientRect().height>=44)",
      "Every phone settings row has a 44 px touch target",
    );
    await click('[data-jump="3"]');
    await pause(450);
    await assert(
      "document.querySelector('.app-sidebar .settings-scroll').scrollTop>0",
      "Phone group shortcuts scroll to later settings",
    );
    await click('.app-sidebar [data-category="logs"]');
    await assert(
      "document.querySelector('h1').textContent==='Logs'&&!document.querySelector('.mobile-open')",
      "Selecting a category navigates and dismisses the drawer",
    );
    await click('[data-action="open-mobile"]');
    await assert(
      "(()=>{const a=document.querySelector('.app-sidebar a[aria-current=page]'),r=a.getBoundingClientRect(),c=a.closest('.settings-scroll').getBoundingClientRect();return r.top>=c.top&&r.bottom<=c.bottom})()",
      "Reopening brings the current category into view",
    );
    await click('[data-direction="rail"]');
    await assert(
      "!!document.querySelector('.mobile-open .app-sidebar').getBoundingClientRect().width",
      "Rail concept shares the same phone drawer",
    );
    await run(
      "document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))",
    );
    await assert(
      "!document.querySelector('.mobile-open')",
      "Escape closes phone navigation",
    );
  }
  await click("#theme");
  await assert(
    "document.body.dataset.theme==='dark'",
    "Theme preview changes without navigation changes",
  );
  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "k",
    code: "KeyK",
    modifiers: 2,
    windowsVirtualKeyCode: 75,
  });
  await pause();
  await assert(
    "document.querySelector('#search-dialog').open&&document.activeElement.id==='search-field'",
    "Ctrl+K opens and focuses global search",
  );
  await run(
    "document.querySelector('#search-field').value='backup';document.querySelector('#search-field').dispatchEvent(new Event('input',{bubbles:true}))",
  );
  await assert(
    "document.querySelectorAll('.search-result').length===1&&document.querySelector('.search-result').textContent.includes('Backups')",
    "Search finds settings without drilling through groups",
  );
  await click(".search-result");
  await assert(
    "document.querySelector('h1').textContent==='Backups & restore'&&!document.querySelector('#search-dialog').open",
    "Search result navigates and closes the palette",
  );
  await assert(
    "document.documentElement.scrollWidth<=innerWidth",
    "No horizontal overflow after navigation and theme changes",
  );
  return { passed: true, width, checks };
}
