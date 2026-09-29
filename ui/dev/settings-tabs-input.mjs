export default async function(cdp,{url,width}) {
 if(!url.startsWith('http://127.0.0.1:3021/'))throw Error('Isolated fixture required');
 const evaluate=async(expression)=>{const r=await cdp.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);return r.result.value;};
 const pause=ms=>new Promise(r=>setTimeout(r,ms));
 const click=async(label)=>{const p=await evaluate(`(()=>{const e=[...document.querySelectorAll('[role=tab]')].find(e=>e.textContent===${JSON.stringify(label)});e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...p});await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...p});await pause(300);};
 const checks=[];
 for(const other of ['Appearance','Behavior','About']) {
  await click('Assistant');await click(other);await click('Assistant');
  const samples=[];for(let i=0;i<30;i++){samples.push(await evaluate(`new URLSearchParams(location.search).get('tab')`));await pause(35);}
  if(samples.some(s=>s!=='assistant'))throw Error('Tab loop: '+JSON.stringify(samples));checks.push('Assistant → '+other+' → Assistant stays selected across 30 frames');
 }
 await click('Appearance');
 if(!await evaluate(`document.querySelector('[role=switch][aria-label="Show advanced details"]') !== null`))throw Error('Shared switch absent');
 checks.push('Appearance uses shared switches');
 if(!await evaluate('document.documentElement.scrollWidth<=innerWidth+1'))throw Error('Horizontal overflow');checks.push('No horizontal overflow');
 return {passed:true,checks,width};
}
