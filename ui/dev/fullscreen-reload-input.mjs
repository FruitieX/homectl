export default async function(cdp,{url,width}) {
 if(!url.startsWith('http://127.0.0.1:3021/'))throw Error('Isolated fixture required');
 const evaluate=async(expression)=>{const r=await cdp.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);return r.result.value;};
 const pause=ms=>new Promise(r=>setTimeout(r,ms));const until=async(fn,msg)=>{for(let i=0;i<100;i++){if(await fn())return;await pause(80);}throw Error(msg);};const checks=[];
 // Deterministic rejection models a browser denying restoration after reload.
 const {identifier}=await cdp.send('Page.addScriptToEvaluateOnNewDocument',{source:`window.__fullscreenRequests=0;Element.prototype.requestFullscreen=async()=>{window.__fullscreenRequests++;throw new DOMException('User gesture required','NotAllowedError')};`});
 await evaluate(`localStorage.setItem('fullscreen','true')`);
 await cdp.send('Page.reload');await pause(600);await until(()=>evaluate(`!!document.querySelector('[aria-label="Exit fullscreen"]')`),'Saved display mode restored');
 if(await evaluate(`!!document.querySelector('nav[aria-label="Main navigation"]')`))throw Error('Navigation visible in display mode');
 checks.push('Saved display layout restored across document reload');
 await until(()=>evaluate(`document.body.innerText.includes('Restore fullscreen')`),'Blocked restore shown');
 if(await evaluate('window.__fullscreenRequests')!==1)throw Error('Duplicate fullscreen request');checks.push('Denied browser restore is handled once with explicit restore control');
 if(await evaluate(`import('/lib/automaticReload.ts').then(m=>m.mayAutomaticallyReload(false))`))throw Error('Fullscreen auto-reload not guarded');checks.push('Automatic reload is blocked in display mode');
 await evaluate(`document.querySelector('[aria-label="Exit fullscreen"]').click()`);await until(()=>evaluate(`localStorage.getItem('fullscreen')==='false'`),'Exit saves preference');
 if(await evaluate('window.__fullscreenRequests')!==1)throw Error('Exit wrongly entered fullscreen');checks.push('Exit exits the layout even after browser fullscreen was lost');
 if(!await evaluate(`import('/lib/automaticReload.ts').then(m=>m.mayAutomaticallyReload(false)&&!m.mayAutomaticallyReload(true))`))throw Error('Normal reload/draft guard');checks.push('Normal reload allowed; unsaved drafts protected');
 const schedule=await evaluate(`import('/lib/automaticReload.ts').then(m=>[m.nextDailyRefresh(new Date(2026,8,29,2)).getDate(),m.nextDailyRefresh(new Date(2026,8,29,5)).getDate()])`);if(schedule[0]!==29||schedule[1]!==30)throw Error('Daily schedule wrong');checks.push('04:00 schedule uses today before 04:00 and tomorrow afterwards');
 await cdp.send('Page.removeScriptToEvaluateOnNewDocument',{identifier});
 const kiosk=await cdp.send('Page.addScriptToEvaluateOnNewDocument',{source:`const original=window.matchMedia.bind(window);window.matchMedia=q=>q==='(display-mode: fullscreen)'?{matches:true}:original(q);window.__fullscreenRequests=0;Element.prototype.requestFullscreen=async()=>{window.__fullscreenRequests++};`});
 await evaluate(`localStorage.setItem('fullscreen','true')`);await cdp.send('Page.reload');await pause(600);await until(()=>evaluate(`!!document.querySelector('[aria-label="Exit fullscreen"]')`),'Kiosk layout');
 if(await evaluate('window.__fullscreenRequests')!==0)throw Error('Kiosk entered nested DOM fullscreen');checks.push('Existing browser fullscreen does not request nested DOM fullscreen');
 await evaluate(`document.querySelector('[aria-label="Exit fullscreen"]').click()`);await cdp.send('Page.removeScriptToEvaluateOnNewDocument',{identifier:kiosk.identifier});await cdp.send('Page.reload');await pause(700);
 return {passed:true,checks,width};
}
