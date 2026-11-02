const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawn}=require('node:child_process'),assert=require('node:assert/strict');
const engine=require('./sudoku-engine.js');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{
 const profile=fs.mkdtempSync(path.join(os.tmpdir(),'sudoku-layout-'));
 const browser=spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',['--headless=new','--disable-gpu','--remote-debugging-port=0','--no-first-run','--no-default-browser-check','--disable-extensions','--disable-background-networking','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:['ignore','ignore','pipe']});
 let errors='';browser.stderr.on('data',chunk=>errors+=chunk.toString());let browserError;browser.on('error',error=>browserError=error);
 let socket;
 try {
  const portFile=path.join(profile,'DevToolsActivePort');let i=0;
  while(!fs.existsSync(portFile)&&i++<200){if(browserError)throw browserError;await wait(50);}
  if(!fs.existsSync(portFile))throw Error('Headless browser did not start: '+errors.slice(-1000));
  const [port,endpoint]=fs.readFileSync(portFile,'utf8').trim().split('\n');
  socket=new WebSocket('ws://127.0.0.1:'+port+endpoint);await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
  let id=0;const pending=new Map();const consoleErrors=[];
  socket.addEventListener('close',()=>{for(const task of pending.values())task.reject(Error('Headless browser connection closed: '+errors.slice(-700)));pending.clear();});
  socket.addEventListener('message',event=>{const message=JSON.parse(event.data);if(message.id){const task=pending.get(message.id);if(task){pending.delete(message.id);message.error?task.reject(Error(JSON.stringify(message.error))):task.resolve(message.result);}}if(message.method==='Runtime.exceptionThrown')consoleErrors.push(message.params.exceptionDetails.text);});
  const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const request=++id;pending.set(request,{resolve,reject});socket.send(JSON.stringify({id:request,method,params,...(sessionId?{sessionId}:{})}));});
  const target=await send('Target.createTarget',{url:'about:blank'});const attached=await send('Target.attachToTarget',{targetId:target.targetId,flatten:true});const sid=attached.sessionId;
  await send('Page.enable',{},sid);await send('Runtime.enable',{},sid);
  const evaluate=async expression=>{const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true},sid);if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);return result.result.value;};
  const settleDrawers=()=>evaluate("Promise.all([...document.querySelectorAll('dialog[open]')].flatMap(dialog=>dialog.getAnimations()).map(animation=>animation.finished.catch(()=>{})))");
  let setupId;
  async function load(width,height,{saved=false,dark=false,language='en',large=false}={}){
   const phone = width<=768 || (width<=1024 && height<=500);
   await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:phone},sid);
   await send('Emulation.setTouchEmulationEnabled',{enabled:phone},sid);
   if(setupId)await send('Page.removeScriptToEvaluateOnNewDocument',{identifier:setupId},sid);
   let progress=null;
   if(saved){const g=engine.generate('easy');progress={version:2,selectedDifficulty:'easy',config:g.config,puzzle:g.puzzle,answer:g.solution,values:g.puzzle.slice(),history:[],elapsedSeconds:123,mistakes:1,hintsUsed:0,paused:false,completed:false,selectedIndex:-1};}
   const initial=`localStorage.setItem('sudoku-game-settings',${JSON.stringify(JSON.stringify({language,darkMode:dark,largerText:large,largerButtons:large}))});localStorage.removeItem('sudoku-progress-v1');${progress?'localStorage.setItem("sudoku-progress-v1",'+JSON.stringify(JSON.stringify(progress))+');':''}`;
   setupId=(await send('Page.addScriptToEvaluateOnNewDocument',{source:initial},sid)).identifier;
   await send('Page.navigate',{url:'http://localhost:3000/'},sid);
   for(let n=0;n<100;n++){const ready=await evaluate('document.readyState === "complete" && !!document.querySelector(".preview-cell")');if(ready)break;await wait(50);}
   await evaluate('Promise.race([document.fonts.ready,new Promise(resolve=>setTimeout(resolve,2000))])');
  }
  const measure=()=>evaluate(`(()=>{const d=document.documentElement;return{width:innerWidth,height:innerHeight,scrollWidth:d.scrollWidth,clientWidth:d.clientWidth,pageHeight:d.scrollHeight,buttons:[...document.querySelectorAll('.landing-actions button')].filter(e=>!e.hidden).map(e=>({text:e.textContent.trim(),bottom:e.getBoundingClientRect().bottom,width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height})),dark:document.documentElement.dataset.theme,cardCount:document.querySelectorAll('.difficulty-option').length}})()`);
  const results=[];
  for(const [width,height]of [[320,568],[375,667],[390,844],[430,932],[768,1024],[667,375],[844,390],[1024,768],[1366,768],[1440,900]]){
   console.log('Checking '+width+'x'+height);
   await load(width,height,{saved:true,dark:true});const home=await measure();assert(home.scrollWidth<=home.clientWidth+1,JSON.stringify(home));
   const foldRequired=(width<=768&&height>=568)||(width<=1024&&height<=500);const buttonsFit=home.buttons.every(b=>b.bottom<=height+1);if(foldRequired)assert(buttonsFit,'Buttons below fold: '+JSON.stringify(home));
   await evaluate('showDifficulty()');const chooser=await measure();assert(chooser.scrollWidth<=chooser.clientWidth+1,'Difficulty overflow '+width);
   await evaluate("playing=false;selectDifficulty('hard')");
   const game=await evaluate(`(()=>{const b=document.querySelector('#board').getBoundingClientRect();return{width:innerWidth,scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth,boardWidth:b.width,boardHeight:b.height,keyButtons:[...document.querySelectorAll('#number-pad button')].filter(x=>!x.hidden).map(x=>{const r=x.getBoundingClientRect();return{top:r.top,width:r.width,height:r.height}})}})()`);assert(game.scrollWidth<=game.clientWidth+1,'Game overflow '+JSON.stringify(game));assert(Math.abs(game.boardWidth-game.boardHeight)<1,'Non-square board');
   if(width<=768||(width<=1024&&height<=500))assert.equal(new Set(game.keyButtons.map(b=>Math.round(b.top))).size,2);
   results.push({viewport:width+'x'+height,homeButtonsFit:buttonsFit,noOverflow:true,squareBoard:true});
  }
  console.log(JSON.stringify(results,null,2));
  for(const language of ['en','fil','ceb','es','fr','de','pt','zh-CN','zh-TW','ja','ko','ar','hi','id','th','vi','it','ru','ms','tr']) {
   await load(320,568,{saved:true,language});
   const home=await measure();assert(home.scrollWidth<=home.clientWidth+1,language+' homepage overflow');
   assert(home.buttons.every(b=>b.bottom<=569),language+' buttons below fold: '+JSON.stringify(home.buttons));
  }
  console.log('All 20 languages: saved-game buttons fit on a 320x568 phone.');
  for(const [width,height]of [[320,568],[390,844],[667,375],[844,390],[1366,768]]) {
   await load(width,height,{saved:true,dark:true,large:true,language:'de'});
   await evaluate('showDifficulty();openSettings({currentTarget:document.querySelector("#menu-toggle")})');
   await settleDrawers();
   const settings=await evaluate(`(()=>{const drawer=document.querySelector('#settings-dialog'),content=drawer.querySelector('.settings-content');const before=drawer.querySelector('.settings-heading').getBoundingClientRect().top;content.scrollTop=content.scrollHeight;const last=drawer.querySelector('#pref-mistake-limit').closest('.setting-row').getBoundingClientRect(),r=content.getBoundingClientRect(),d=drawer.getBoundingClientRect();return{left:d.left,right:d.right,width:innerWidth,headerFixed:before===drawer.querySelector('.settings-heading').getBoundingClientRect().top,lastVisible:last.bottom<=r.bottom+1&&last.top>=r.top-1,scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth,theme:document.documentElement.dataset.theme}})()`);
   assert(settings.left>=-1&&settings.right<=settings.width+1,'Settings outside viewport '+width+'x'+height+': '+JSON.stringify(settings));assert(settings.headerFixed);assert(settings.lastVisible,'Last setting clipped '+width);assert(settings.scrollWidth<=settings.clientWidth+1);
   await evaluate('closeSettings();leaveDifficultyFor("#how-to")');
   await settleDrawers();
   const instructions=await evaluate(`(()=>{const drawer=document.querySelector('#information-dialog'),r=drawer.getBoundingClientRect();return{left:r.left,right:r.right,width:innerWidth,groups:drawer.querySelectorAll('.grid-instructions').length,chooser:document.body.classList.contains('is-choosing')}})()`);
   assert(instructions.chooser);assert.equal(instructions.groups,3);assert(instructions.left>=-1&&instructions.right<=instructions.width+1);
   await evaluate('document.querySelector("#information-dialog").close();playing=false;selectDifficulty("easy");values=solution.slice();validateBoard()');
   const completion=await evaluate(`(()=>{const card=document.querySelector('.completion-card'),r=card.getBoundingClientRect();card.scrollTop=card.scrollHeight;const button=card.querySelector('button').getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight,buttonVisible:button.bottom<=r.bottom+1,bg:getComputedStyle(card).backgroundColor}})()`);
   assert(completion.left>=-1&&completion.right<=completion.width+1&&completion.top>=-1&&completion.bottom<=completion.height+1);assert(completion.buttonVisible);assert.equal(completion.bg,'rgb(40, 33, 40)');
  }
  console.log('Settings, long instructions and completion modals fit portrait/landscape/desktop with Dark Mode and larger accessibility controls.');
  console.log('Runtime errors:',JSON.stringify(consoleErrors));assert.equal(consoleErrors.length,0);
  fs.mkdirSync('.artifacts',{recursive:true});await load(390,844,{saved:true,dark:true});const shot=await send('Page.captureScreenshot',{format:'png'},sid);fs.writeFileSync('.artifacts/mobile-home-dark.png',Buffer.from(shot.data,'base64'));
  await send('Browser.close');socket.close();
 } finally {
  if(socket?.readyState===1)socket.close();browser.kill();await wait(250);
  const target=path.resolve(profile),base=path.resolve(os.tmpdir())+path.sep;if(target.startsWith(base)&&path.basename(target).startsWith('sudoku-layout-')){try{fs.rmSync(target,{recursive:true,force:true});}catch{}}
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
