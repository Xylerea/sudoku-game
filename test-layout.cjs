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
  if(process.argv.includes('--input-only')) {
   const press=async(key,options={})=>{
    const params={key,...(/^[1-9]$/.test(key)?{text:key}:{}),...options};
    await send('Input.dispatchKeyEvent',{type:'keyDown',...params},sid);
    await send('Input.dispatchKeyEvent',{type:'keyUp',key,...options},sid);
   };
   const tap=async(selector,mobile)=>{
    const point=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'nearest',behavior:'instant'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);
    if(mobile){
     await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]},sid);
     await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]},sid);
    }else{
     await send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point},sid);
     await send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point},sid);
    }
   };
   const checkCells=async()=>assert(await evaluate("[...board.querySelectorAll('input')].every(c=>c.readOnly&&c.inputMode==='none'&&!c.disabled)"),'Playable cells must suppress native editing while remaining focusable');
   let cases=0;
   for(const [width,height]of [[390,844],[1366,900]])for(const level of Object.keys(engine.levels)){
    const mobile=width<768;
    await load(width,height);
    await evaluate(`settings.soundEffects=false;settings.reducedMotion=true;applySettings();selectDifficulty('${level}')`);
    await checkCells();
    const {index,given,answer,size}=await evaluate('(()=>{const index=puzzle.findIndex(v=>!v);return{index,given:puzzle.findIndex(Boolean),answer:solution[index],size:gridConfig.size};})()');
    const cell=`#board [data-index="${index}"]`;
    await tap(`#board [data-index="${given}"]`,mobile);
    assert(await evaluate(`selectedIndex===${given}&&board.children[${given}].classList.contains('selected')`),'Given cells remain selectable');
    await tap(cell,mobile);
    assert(await evaluate(`selectedIndex===${index}&&document.activeElement===board.children[${index}]&&board.children[${index}].classList.contains('selected')`),'Tap must focus and highlight the cell');
    await send('Input.insertText',{text:'9'},sid);
    assert(await evaluate(`values[${index}]===0&&board.children[${index}].value===''&&history.length===0`),'Native text insertion must not edit the cell');
    await tap(`#number-pad [data-value="${answer}"]`,mobile);
    assert(await evaluate(`values[${index}]===${answer}&&board.children[${index}].value==='${answer}'&&history.length===1&&board.children[${index}].classList.contains('selected')`),'Number pad must update the move, display, history and highlight');
    await press('Backspace');
    assert(await evaluate(`values[${index}]===0&&board.children[${index}].value===''`),'Physical Backspace must erase');
    await press(String(answer));
    assert(await evaluate(`values[${index}]===${answer}&&board.children[${index}].value==='${answer}'`),'Physical digit keys must enter a number');
    await tap('#undo-button',mobile);await checkCells();
    assert(await evaluate(`values[${index}]===0&&board.children[${index}].value===''&&selectedIndex===${index}`),'Undo must restore the previous value and selection');
    await tap('#hint-button',mobile);
    assert(await evaluate(`values[${index}]===${answer}&&hintsUsed===1`),'Hint must still fill the selected cell');
    await tap('#erase-button',mobile);
    assert(await evaluate(`values[${index}]===0&&board.children[${index}].value===''`),'Erase must still clear the selected cell');
    await tap('#undo-button',mobile);
    assert(await evaluate(`values[${index}]===${answer}`),'Erasing must remain undoable');
    await press('0');
    assert(await evaluate(`values[${index}]===0&&board.children[${index}].value===''`),'Physical zero must retain its erase behavior');
    await press(String(answer),{code:'Numpad'+answer,isKeypad:true});
    assert(await evaluate(`values[${index}]===${answer}&&board.children[${index}].value==='${answer}'`),'Physical number pad keys must enter a number');
    await press('Delete');
    assert(await evaluate(`values[${index}]===0&&board.children[${index}].value===''`),'Physical Delete must erase');
    const before=await evaluate('JSON.stringify({values,history,mistakes})');
    for(const key of ['x',...(size<9?[String(size+1)]:[])])await press(key);
    for(const modifiers of [1,2,4])await press(String(answer),{modifiers,text:''});
    assert.equal(await evaluate('JSON.stringify({values,history,mistakes})'),before,'Invalid digits and modified shortcuts must not enter moves');
    await press(String(answer%size+1));
    assert(await evaluate(`mistakes===1&&board.children[${index}].classList.contains('invalid')&&board.children[${index}].getAttribute('aria-invalid')==='true'`),'Keyboard moves must run gameplay validation');
    await tap('#undo-button',mobile);
    assert(await evaluate(`values[${index}]===0&&!board.children[${index}].classList.contains('invalid')`));
    const navigation=await evaluate(`(()=>{const cases=[];for(const [key,step]of Object.entries({ArrowLeft:-1,ArrowRight:1,ArrowUp:-gridConfig.size,ArrowDown:gridConfig.size}))for(let from=0;from<puzzle.length;from++){if(puzzle[from])continue;let to=from+step;while(to>=0&&to<puzzle.length&&(Math.abs(step)!==1||Math.floor(to/gridConfig.size)===Math.floor(from/gridConfig.size))){if(!puzzle[to]){cases.push({key,from,to});break;}to+=step;}}return cases;})()`);
    for(const {key,from,to}of navigation){
     await evaluate(`board.children[${from}].focus()`);await press(key);
     assert(await evaluate(`selectedIndex===${to}&&document.activeElement===board.children[${to}]&&board.children[${to}].classList.contains('selected')`),'Arrow keys must skip givens and retain highlighting');
    }
    await tap('#pause-button',mobile);
    const pausedState=await evaluate('JSON.stringify({values,history,mistakes,hintsUsed})');
    await evaluate("numberPad.querySelector('button').click();eraseButton.click();hintButton.click();undoButton.click()");await press(String(answer));
    assert.equal(await evaluate('JSON.stringify({values,history,mistakes,hintsUsed})'),pausedState,'Paused games must reject input');
    await tap('#pause-button',mobile);await checkCells();
    await evaluate('returnHome();startGame()');await checkCells();
    await evaluate('resetButton.click()');await checkCells();
    assert(await evaluate('values.every((v,i)=>v===puzzle[i])&&history.length===0&&mistakes===0&&hintsUsed===0'),'Reset must preserve clean gameplay');
    await tap(cell,mobile);
    await evaluate(`values=solution.slice();values[${index}]=0;renderBoard();board.children[${index}].focus()`);
    await press(String(answer));
    assert(await evaluate("completed&&!!document.querySelector('#completion-dialog[open]')&&values.every((v,i)=>v===solution[i])"),'Keyboard entry must still complete the game');
    console.log('PASS: '+level+' '+(mobile?'mobile touch':'desktop mouse')+' selection, native editing suppression, number pad, physical keyboard, controls, pause, reset and completion');cases++;
   }
   assert.equal(consoleErrors.length,0,JSON.stringify(consoleErrors));console.log(cases+' cell input scenarios passed.');
   await send('Browser.close');socket.close();return;
  }
  if(process.argv.includes('--navigation-only')) {
   const openNavigation=async()=>{await evaluate("document.querySelector('#menu-toggle').click()");await settleDrawers();};
   const clickNavigation=selector=>evaluate(`new Promise(resolve=>{const d=document.querySelector('#navigation-dialog');d.addEventListener('close',()=>resolve(),{once:true});d.querySelector('${selector}').click();})`);
   let cases=0,scrollingCases=0;
   for(const [width,height]of [[320,568],[390,844],[768,1024],[667,375],[1366,768],[240,320],[360,240]])for(const dark of [false,true]) {
    await load(width,height,{saved:true,dark,large:width===240});
    for(const screen of ['home','choosing','playing']) {
     await evaluate(screen==='home'?'returnHome()':screen==='choosing'?'showDifficulty()':"document.body.classList.remove('is-choosing');startGame()");await openNavigation();
     for(const language of await evaluate('Object.keys(languageNames)')) {
      await evaluate(`applyLanguage(${JSON.stringify(language)})`);
      const layout=await evaluate(`(()=>{const d=document.querySelector('#navigation-dialog'),h=d.querySelector('.navigation-heading'),n=d.querySelector('nav'),f=d.querySelector('.navigation-footer'),brand=f.querySelector('strong'),tagline=f.querySelector('p'),rect=e=>{const r=e.getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};};n.scrollTop=0;const header=rect(h),footer=rect(f);n.scrollTop=n.scrollHeight;const menu=rect(n),last=rect(d.querySelector('#navigation-settings'));return{drawer:rect(d),header,footer,brand:rect(brand),tagline:rect(tagline),text:tagline.textContent,expected:translate('footerText'),order:[...n.children].map(e=>e.querySelector('[data-i18n]').dataset.i18n),weight:Number(getComputedStyle(brand).fontWeight),brandColor:getComputedStyle(brand).color,headingColor:getComputedStyle(h.querySelector('h2')).color,alignment:getComputedStyle(tagline).textAlign,divider:getComputedStyle(f).borderTopWidth,animation:getComputedStyle(d).animationName,overlay:getComputedStyle(d,'::backdrop').backgroundColor,overflow:d.scrollWidth>d.clientWidth,scroll:n.scrollTop,fixed:header.top===rect(h).top&&footer.bottom===rect(f).bottom,menuContained:menu.top>=header.bottom&&menu.bottom<=footer.top,lastVisible:last.top>=menu.top-1&&last.bottom<=menu.bottom+1};})()`);
      const context=screen+' '+language+' '+width+'x'+height+' '+JSON.stringify(layout);
      assert(Math.abs(layout.drawer.top)<1&&Math.abs(layout.drawer.bottom-height)<1,'Full-height drawer '+context);assert(Math.abs(layout.footer.bottom-height)<1,'Footer at bottom '+context);
      assert(layout.header.height>0&&layout.footer.height>0&&layout.fixed&&layout.menuContained&&layout.lastVisible&&!layout.overflow,'Scroll only the navigation area '+context);
      assert.equal(layout.text,layout.expected);assert.deepEqual(layout.order,['home','about','howToPlay','settings']);assert.equal(layout.alignment,'right');assert.equal(layout.divider,'1px');assert(layout.weight>=700);assert.equal(layout.brandColor,layout.headingColor);
      assert(layout.brand.right<=layout.tagline.left&&layout.tagline.right<=layout.footer.right&&layout.tagline.top>=layout.footer.top&&layout.tagline.bottom<=layout.footer.bottom,'Footer text fits '+context);
      assert.equal(layout.animation,'drawer-slide-in');assert.notEqual(layout.overlay,'rgba(0, 0, 0, 0)');if(layout.scroll>0)scrollingCases++;cases++;
     }
     if(screen==='home'&&((width===390&&dark)||(width===1366&&!dark))){await evaluate("applyLanguage('en')");const shot=await send('Page.captureScreenshot',{format:'png'},sid);fs.writeFileSync('.artifacts/navigation-'+width+'.png',Buffer.from(shot.data,'base64'));}
     await clickNavigation('#navigation-close');assert(await evaluate("!document.querySelector('#navigation-dialog').open&&document.querySelector('#menu-toggle').getAttribute('aria-expanded')==='false'"));
    }
   }
   assert(scrollingCases>0,'Test short screens that require menu scrolling');
   await load(390,844,{saved:true,dark:true});
   await evaluate("window.navigationScroll=[];const scrollIntoView=Element.prototype.scrollIntoView;Element.prototype.scrollIntoView=function(options){window.navigationScroll.push({id:this.id,behavior:options?.behavior});scrollIntoView.call(this,{...options,behavior:'instant'});}");
   for(const section of ['features','how-to']){await openNavigation();await clickNavigation(`[data-destination="${section}"]`);await wait(30);assert.deepEqual(await evaluate('window.navigationScroll.at(-1)'),{id:section,behavior:'smooth'});}
   await evaluate('startGame()');
   for(const section of ['features','how-to']){await openNavigation();await clickNavigation(`[data-destination="${section}"]`);await wait(30);await settleDrawers();assert(await evaluate("document.body.classList.contains('is-playing')&&!!document.querySelector('#information-dialog[open]')"));await evaluate("new Promise(resolve=>{const d=document.querySelector('#information-dialog');d.addEventListener('close',()=>resolve(),{once:true});d.querySelector('button').click();})");}
   await openNavigation();await clickNavigation('#navigation-settings');await wait(30);await settleDrawers();assert(await evaluate("document.querySelector('#settings-dialog').open&&document.body.classList.contains('is-playing')"));await evaluate('closeSettings()');
   await openNavigation();await clickNavigation('[data-destination="home"]');await wait(30);assert(await evaluate("!document.body.matches('.is-playing,.is-choosing')"));
   assert.equal(consoleErrors.length,0,JSON.stringify(consoleErrors));console.log(cases+' navigation drawer layouts passed across all languages, themes and screen states; header/footer stay fixed while the menu scrolls. Home, section scrolling, gameplay information drawers, Settings and close behavior passed.');
   await send('Browser.close');socket.close();return;
  }
  if(process.argv.includes('--preview-only')) {
   const settle=()=>evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
   const isRunning=()=>evaluate("document.querySelector('.landing-preview').classList.contains('preview-animating')");
   for(const [width,height]of [[320,568],[375,667],[390,844],[667,375],[1366,768]]) {
    await load(width,height,{saved:true,dark:width===390,language:width===375?'fr':'en'});await settle();assert(await isRunning());
    const geometry=await evaluate(`(()=>{const p=document.querySelector('.landing-preview'),animation=p.getAnimations()[0],staticNodes=[...document.querySelectorAll('#hero-title,.hero .intro,.hero-highlights,.landing-actions')],positions=()=>staticNodes.map(e=>({top:e.getBoundingClientRect().top,bottom:e.getBoundingClientRect().bottom}));animation.currentTime=0;const before=p.getBoundingClientRect(),fixed=positions();animation.currentTime=4000;const after=p.getBoundingClientRect();return{movement:before.top-after.top,static:JSON.stringify(fixed)===JSON.stringify(positions()),top:after.top,bottom:after.bottom,header:document.querySelector('.header').getBoundingClientRect().bottom,heroBottom:document.querySelector('.hero').getBoundingClientRect().bottom,buttons:[...document.querySelectorAll('.landing-actions button')].filter(b=>!b.hidden).every(b=>b.getBoundingClientRect().bottom<=innerHeight),transform:getComputedStyle(p).transform};})()`);
    assert(Math.abs(geometry.movement-3)<.1&&geometry.static&&geometry.buttons);assert(geometry.top>=geometry.header&&geometry.bottom<=height&&Math.abs(geometry.heroBottom-height)<1);
    const layoutShot=await send('Page.captureScreenshot',{format:'png'},sid);fs.writeFileSync('.artifacts/preview-layout-'+width+'.png',Buffer.from(layoutShot.data,'base64'));
    await evaluate("settings.reducedMotion=true;applySettings()");await settle();assert(!(await isRunning()));assert.equal(await evaluate("getComputedStyle(document.querySelector('.landing-preview')).animationName"),'none');
   }
   await load(390,844,{saved:true});await settle();
   const original=await evaluate("JSON.stringify({values,puzzle,solution,history,elapsedSeconds,mistakes,hintsUsed,saved:localStorage.getItem('sudoku-progress-v1')})");
   for(let i=0;i<75;i++){if(await evaluate("!!document.querySelector('.preview-entry')"))break;await wait(100);}
   const entry=await evaluate(`(()=>{const cell=document.querySelector('.preview-entry');if(!cell)return null;cell.getAnimations()[0].currentTime=2000;return{value:cell.textContent,expected:cell.dataset.previewValue,given:cell.classList.contains('preview-given'),valid:SudokuEngine.valid([...landingPreview.children].map(c=>Number(c.textContent)||0),{size:9,boxRows:3,boxCols:3}),background:getComputedStyle(cell).backgroundColor,color:getComputedStyle(cell).color};})()`);
   assert(entry&&entry.value===entry.expected&&!entry.given&&entry.valid);assert.equal(entry.background,'rgb(247, 234, 238)');assert.equal(entry.color,'rgb(116, 27, 61)');
   assert.equal(await evaluate("JSON.stringify({values,puzzle,solution,history,elapsedSeconds,mistakes,hintsUsed,saved:localStorage.getItem('sudoku-progress-v1')})"),original,'Decoration must not change progress');
   await evaluate('settings.darkMode=true;applySettings()');await settle();assert.equal(await evaluate("getComputedStyle(document.querySelector('.preview-entry')).backgroundColor"),'rgb(56, 37, 47)');
   const shot=await send('Page.captureScreenshot',{format:'png'},sid);fs.writeFileSync('.artifacts/preview-animation-dark.png',Buffer.from(shot.data,'base64'));
   await evaluate("Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'))");await settle();assert(!(await isRunning()));assert(!(await evaluate("!!document.querySelector('.preview-entry')")));
   await evaluate("delete document.hidden;document.dispatchEvent(new Event('visibilitychange'))");await settle();assert(await isRunning());
   await evaluate("document.querySelector('#features').scrollIntoView({behavior:'instant'})");await settle();assert(!(await isRunning()));
   await evaluate("scrollTo({top:0,behavior:'instant'})");await settle();assert(await isRunning());
   await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]},sid);await settle();assert(!(await isRunning()));
   await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]},sid);await settle();assert(await isRunning());
   await evaluate("playing=false;selectDifficulty('medium')");await settle();assert(!(await isRunning()));
   await evaluate('returnHome()');await settle();assert(await isRunning());
   assert.equal(consoleErrors.length,0,JSON.stringify(consoleErrors));console.log('PASS: 3px float preserves tilt and first-screen content; only valid empty-cell entries animate; Dark Mode highlight; hidden/offscreen/gameplay pause; app and system Reduce Motion respected; saved game untouched.');
   await send('Browser.close');socket.close();return;
  }
  if(process.argv.includes('--difficulty-only')) {
   let cases=0;
   const inspect=()=>evaluate(`(()=>{const rect=e=>{const r=e.getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};};return{width:innerWidth,height:innerHeight,header:rect(document.querySelector('.header')),title:rect(document.getElementById('difficulty-title')),scrollWidth:document.documentElement.scrollWidth,pageHeight:document.documentElement.scrollHeight,cards:[...document.querySelectorAll('.difficulty-option')].map(e=>({...rect(e),children:[...e.children].map(child=>({name:child.className||child.tagName,...rect(child)}))}))};})()`);
   const check=(layout,{fit=true,label=''}={})=>{
    const context=label+' '+JSON.stringify(layout);assert.equal(layout.cards.length,3);assert(layout.scrollWidth<=layout.width,'Horizontal overflow '+context);
    assert(layout.title.top>=layout.header.bottom,'Title behind header '+context);
    const first=layout.cards[0];assert(layout.cards.every(c=>Math.abs(c.width-first.width)<1&&Math.abs(c.height-first.height)<1),'Unequal cards '+context);
    for(const card of layout.cards)for(const child of card.children){assert(child.width>0&&child.height>0&&child.top>=card.top&&child.bottom<=card.bottom+.1&&child.left>=card.left&&child.right<=card.right+.1,'Clipped content '+context);assert(Math.abs((child.left+child.right)/2-(card.left+card.right)/2)<1,'Off-center card content '+context);if(child.name==='level-button')assert(child.height>=44,'Select button must stay tappable '+context);}
    if(fit)assert(layout.cards.every(c=>c.bottom<=layout.height+.1),'Hard card below first screen '+context);
   };
   for(const [width,height]of [[320,568],[360,600],[360,640],[375,667],[390,844],[414,736],[430,932],[600,800],[768,1024],[568,320],[667,375],[844,390],[769,600],[1024,600],[1366,768],[1440,900]])for(const dark of [false,true]){
    await load(width,height,{saved:true,dark});await evaluate('showDifficulty()');
    for(const language of await evaluate('Object.keys(languageNames)')){await evaluate(`applyLanguage(${JSON.stringify(language)})`);check(await inspect(),{label:language+' '+(dark?'dark':'light')});cases++;}
    if((dark&&width===390)||(!dark&&[320,375,667,1366].includes(width))){await evaluate("applyLanguage('en')");const shot=await send('Page.captureScreenshot',{format:'png'},sid);fs.writeFileSync('.artifacts/difficulty-'+width+'.png',Buffer.from(shot.data,'base64'));}
   }
   for(const [width,height]of [[240,320],[320,400],[568,280],[320,568],[390,844]]){
    await load(width,height,{saved:true,dark:true,large:true,language:'de'});await evaluate('showDifficulty()');check(await inspect(),{fit:false,label:'Tiny screen / larger accessibility controls'});
    assert(await evaluate("(()=>{const hard=document.querySelector('.level-button[data-level=hard]');hard.scrollIntoView({behavior:'instant',block:'center'});const r=hard.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;})()"),'Hard button must be reachable by scrolling');
   }
   assert.equal(consoleErrors.length,0,JSON.stringify(consoleErrors));console.log(cases+' difficulty layouts passed: three equal cards, centered content, all Select buttons within the first screen, all languages and both themes; tiny screens scroll without clipping.');
   await send('Browser.close');socket.close();return;
  }
  const progressSnapshot=()=>evaluate(`JSON.stringify({selectedDifficulty,gridConfig,puzzle,values,solution,history,elapsedSeconds,mistakes,hintsUsed,paused,completed,playing,selectedIndex,mistakeLimitEnded,saved:localStorage.getItem('sudoku-progress-v1')})`);
  const closeReplacement=selector=>evaluate(`new Promise(resolve=>{const dialog=document.querySelector('#replace-game-dialog');dialog.addEventListener('close',()=>resolve(),{once:true});dialog.querySelector('${selector}').click();})`);
  if(!process.argv.includes('--home-only')) {
  let replacementCases=0;
  for(const [width,height]of [[320,568],[390,844],[667,375],[844,390],[1366,768],[240,320]])for(const dark of [false,true]) {
   await load(width,height,{saved:true,dark});
   await evaluate("window.confirm=()=>{throw Error('Native confirmation must not be used')}");
   const languages=await evaluate('Object.keys(languageNames)');
   for(const [index,language]of languages.entries()) {
    const level=['easy','medium','hard'][index%3];
    await evaluate(`showDifficulty();applyLanguage(${JSON.stringify(language)});document.querySelector('.level-button[data-level="${level}"]').focus()`);
    const before=await progressSnapshot();
    await evaluate(`document.querySelector('.level-button[data-level="${level}"]').click()`);
    assert.equal(await progressSnapshot(),before,'Opening confirmation changed progress');
    const modal=await evaluate(`(()=>{const d=document.querySelector('#replace-game-dialog'),r=d.getBoundingClientRect();return{open:d.open,title:d.querySelector('h2').textContent,message:d.querySelector('p').textContent,buttons:[...d.querySelectorAll('button')].map(b=>b.textContent),expected:[translate('startNewGame'),translate('replaceGame'),translate('continueGame')],left:r.left,right:r.right,top:r.top,bottom:r.bottom,background:getComputedStyle(d).backgroundColor,focus:document.activeElement.id,scrollLocked:getComputedStyle(document.body).overflow==='hidden'};})()`);
    assert(modal.open&&modal.scrollLocked);assert.equal(modal.title,modal.expected[0]);assert.equal(modal.message,modal.expected[1]);assert.deepEqual(modal.buttons,[modal.expected[2],modal.expected[0]]);assert.equal(modal.focus,'replace-game-continue');
    assert(modal.left>=0&&modal.right<=width&&modal.top>=0&&modal.bottom<=height,'Confirmation outside viewport: '+JSON.stringify(modal));
    assert(Math.abs((modal.left+modal.right)/2-width/2)<1&&Math.abs((modal.top+modal.bottom)/2-height/2)<1,'Confirmation must be centered');
    assert.equal(modal.background,dark?'rgb(40, 33, 40)':'rgb(253, 249, 248)');
    const reachable=await evaluate(`(()=>{const d=document.querySelector('#replace-game-dialog');d.scrollTop=d.scrollHeight;const r=d.getBoundingClientRect(),b=d.querySelector('#replace-game-start').getBoundingClientRect();return b.top>=r.top&&b.bottom<=r.bottom;})()`);assert(reachable,'Primary button must be reachable on short screens');
    await closeReplacement('#replace-game-continue');assert.equal(await progressSnapshot(),before,'Continue Game changed saved progress');
    assert(await evaluate("document.body.classList.contains('is-playing')&&!document.body.classList.contains('is-choosing')&&!document.querySelector('#replace-game-dialog')"),'Continue Game must open the unfinished puzzle');
    assert(await evaluate("document.activeElement.classList.contains('cell')"),'Focus the resumed puzzle');
    await evaluate(`selectDifficulty('${level}');selectDifficulty('hard')`);
    assert.equal(await evaluate("document.querySelectorAll('#replace-game-dialog').length"),1,'Only one confirmation may open');
    await closeReplacement('#replace-game-start');
    const fresh=await evaluate(`(()=>{const saved=JSON.parse(localStorage.getItem('sudoku-progress-v1'));return{level:selectedDifficulty,savedLevel:saved.selectedDifficulty,playing:document.body.classList.contains('is-playing'),clean:elapsedSeconds===0&&mistakes===0&&hintsUsed===0&&history.length===0&&!paused&&!completed&&values.every((v,i)=>v===puzzle[i]),valid:SudokuEngine.valid(saved.answer,saved.config,true),savedValues:JSON.stringify(saved.values)===JSON.stringify(values),dialog:!!document.querySelector('#replace-game-dialog')};})()`);
    assert.equal(fresh.level,level,'Retain the originally selected difficulty');assert.equal(fresh.savedLevel,level);assert(fresh.playing&&fresh.clean&&fresh.valid&&fresh.savedValues&&!fresh.dialog);replacementCases++;
   }
  }
  await load(390,844,{saved:true});await evaluate('showDifficulty()');const beforeEscape=await progressSnapshot();await evaluate("selectDifficulty('hard')");
  await evaluate("void(window.replacementClosed=new Promise(resolve=>document.querySelector('#replace-game-dialog').addEventListener('close',()=>resolve(),{once:true})))");
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27},sid);await evaluate('window.replacementClosed');assert.equal(await progressSnapshot(),beforeEscape,'Escape must keep the unfinished game');
  for(const state of ['playing=false','playing=true;completed=true','playing=true;completed=false;mistakeLimitEnded=true']) {
   await load(390,844);await evaluate(state+";selectDifficulty('medium')");
   assert(await evaluate("document.body.classList.contains('is-playing')&&!document.querySelector('#replace-game-dialog')&&selectedDifficulty==='medium'"),'No confirmation without an unfinished game');
  }
  await load(390,844);
  await evaluate("selectDifficulty('hard');const move=puzzle.findIndex(v=>!v);setCellValue(move,solution[move]);hintsUsed=2;togglePause();returnHome();showDifficulty();document.querySelector('.level-button[data-level=medium]').focus()");
  const pausedProgress=await progressSnapshot();await evaluate("selectDifficulty('medium')");await closeReplacement('#replace-game-continue');
  assert.equal(await progressSnapshot(),pausedProgress,'Continue preserves entered moves, undo history, hints and paused state');
  assert(await evaluate("document.body.classList.contains('is-playing')&&!document.body.classList.contains('is-choosing')&&paused"),'Open the existing puzzle while preserving its paused state');
  await evaluate("selectDifficulty('medium')");await closeReplacement('#replace-game-start');
  const newSave=await evaluate("JSON.parse(localStorage.getItem('sudoku-progress-v1'))");
  await send('Page.removeScriptToEvaluateOnNewDocument',{identifier:setupId},sid);setupId=undefined;
  await send('Page.reload',{},sid);await wait(100);
  for(let n=0;n<100;n++){if(await evaluate('document.readyState === "complete" && !!document.querySelector(".preview-cell")'))break;await wait(50);}
  const restored=await evaluate("({level:selectedDifficulty,size:gridConfig.size,paused,playing,saved:JSON.parse(localStorage.getItem('sudoku-progress-v1'))})");
  assert.equal(restored.level,'medium');assert.equal(restored.size,6);assert(restored.playing&&!restored.paused);
  // Existing startup focus may select an empty square; puzzle progress must persist.
  delete newSave.selectedIndex;delete restored.saved.selectedIndex;assert.deepEqual(restored.saved,newSave);
  await evaluate('startGame()');await wait(1100);await evaluate("selectDifficulty('hard')");const pausedTime=await evaluate('elapsedSeconds');
  await wait(1100);assert.equal(await evaluate('elapsedSeconds'),pausedTime,'Pause the active timer during confirmation');
  await closeReplacement('#replace-game-continue');await wait(1100);assert((await evaluate('elapsedSeconds'))>pausedTime,'Resume the active timer after cancellation');
  console.log(replacementCases+' new-game confirmations: all 20 languages, both themes, desktop/mobile/tiny screens, Continue Game opens the existing puzzle without changing progress, Start New Game saves the chosen difficulty, repeated requests do not duplicate the modal. Escape and no-unfinished-game paths passed.');
  console.log('Entered moves, undo history, hints and paused state survive cancellation; replacement persists after reload; active timer pauses and resumes.');
  if(process.argv.includes('--replacement-only')) {
   assert.equal(consoleErrors.length,0,JSON.stringify(consoleErrors));await send('Browser.close');socket.close();return;
  }
  }
  const measure=()=>evaluate(`(()=>{
   const d=document.documentElement;
   const rect=e=>{const r=e.getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};};
   const buttons=[...document.querySelectorAll('.landing-actions button')].filter(e=>!e.hidden);
   const content=[...document.querySelectorAll('#hero-title,.hero .intro,.hero-highlight,.landing-preview'),...buttons];
   return{width:innerWidth,height:innerHeight,scrollWidth:d.scrollWidth,clientWidth:d.clientWidth,pageHeight:d.scrollHeight,
    header:rect(document.querySelector('.header')),hero:rect(document.querySelector('.hero')),
    sections:[...document.querySelectorAll('main > .features,main > .how-to')].map(rect),
    content:content.map(e=>({name:e.id||e.className,...rect(e)})),
    heading:rect(document.querySelector('#hero-title')),headingGroup:rect(document.querySelector('.hero-heading')),intro:rect(document.querySelector('.hero .intro')),
    buttons:buttons.map(e=>{const s=getComputedStyle(e);return{id:e.id,text:e.textContent.trim(),background:s.backgroundColor,color:s.color,border:s.borderTopColor,radius:parseFloat(s.borderRadius),...rect(e)};}),
    dark:d.dataset.theme,cardCount:document.querySelectorAll('.difficulty-option').length};
  })()`);
  function assertHome(home,{saved=true,fit=true,label=''}={}) {
   const context=label+' '+home.width+'x'+home.height+' '+JSON.stringify(home);
   assert(home.scrollWidth<=home.clientWidth+1,'Homepage horizontal overflow: '+context);
   assert.equal(home.buttons.length,saved?2:1,'Saved-game actions: '+context);
   assert(Math.abs(home.hero.top-home.header.bottom)<1,'Gap below header: '+context);
   assert(home.sections.every(r=>r.top>=home.height-.1&&r.top>=home.hero.bottom-.1),'Lower section visible in first screen or overlapping hero: '+context);
   assert(home.pageHeight>home.height,'Lower sections must remain scrollable: '+context);
   assert(home.content.every(r=>r.width>0&&r.height>0&&r.left>=-.1&&r.right<=home.width+.1&&r.top>=home.hero.top&&r.bottom<=home.hero.bottom+.1),'Missing, clipped or overflowing hero content: '+context);
   for(let i=0;i<home.content.length;i++)for(let j=i+1;j<home.content.length;j++) {
    const a=home.content[i],b=home.content[j];
    assert(!(Math.min(a.right,b.right)-Math.max(a.left,b.left)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1),'Hero content overlaps: '+context);
   }
   assert(home.buttons.every(r=>r.height>=44),'Buttons must remain tappable: '+context);
   assert(home.buttons.every(r=>Math.abs(r.width-home.buttons[0].width)<1&&r.radius>=r.height/2),'Matching pill button widths: '+context);
   const start=home.buttons.find(b=>b.id==='start-button');assert.equal(start.background,'rgba(0, 0, 0, 0)','Outlined Play Now in every save state: '+context);assert.equal(start.color,start.border);
   if(saved){const resume=home.buttons.find(b=>b.id==='continue-button');assert.equal(resume.background,'rgb(116, 27, 61)');assert.equal(resume.color,'rgb(255, 255, 255)');}
   const illustration=home.content.find(r=>r.name==='landing-preview');assert(Math.abs(illustration.width-illustration.height)<1,'Keep the illustration square: '+context);
   assert(home.intro.top-home.heading.bottom>=0&&home.intro.top-home.heading.bottom<=13,'Description directly below heading: '+context);
   assert(Math.abs((home.heading.left+home.heading.right)/2-(home.headingGroup.left+home.headingGroup.right)/2)<1,'Center the heading: '+context);
   if(fit) {
    assert(Math.abs(home.hero.bottom-home.height)<1,'Header and hero must fill exactly one viewport: '+context);
    assert(home.content.every(r=>r.bottom<=home.height+.1),'Hero content below fold: '+context);
   }
  }
  const results=[];
  for(const [width,height]of [[320,568],[375,667],[390,844],[430,932],[768,1024],[667,375],[844,390],[1024,768],[1366,768],[1440,900]]){
   console.log('Checking '+width+'x'+height);
   await load(width,height,{saved:true,dark:true});const home=await measure();assert(home.scrollWidth<=home.clientWidth+1,JSON.stringify(home));
   assertHome(home);const buttonsFit=home.buttons.every(b=>b.bottom<=height+1);
   await evaluate('showDifficulty()');const chooser=await measure();assert(chooser.scrollWidth<=chooser.clientWidth+1,'Difficulty overflow '+width);
   await evaluate("playing=false;selectDifficulty('hard')");
   const game=await evaluate(`(()=>{const b=document.querySelector('#board').getBoundingClientRect();return{width:innerWidth,scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth,boardWidth:b.width,boardHeight:b.height,keyButtons:[...document.querySelectorAll('#number-pad button')].filter(x=>!x.hidden).map(x=>{const r=x.getBoundingClientRect();return{top:r.top,width:r.width,height:r.height}})}})()`);assert(game.scrollWidth<=game.clientWidth+1,'Game overflow '+JSON.stringify(game));assert(Math.abs(game.boardWidth-game.boardHeight)<1,'Non-square board');
   if(width<=768||(width<=1024&&height<=500))assert.equal(new Set(game.keyButtons.map(b=>Math.round(b.top))).size,2);
   results.push({viewport:width+'x'+height,homeButtonsFit:buttonsFit,noOverflow:true,squareBoard:true});
  }
  console.log(JSON.stringify(results,null,2));
  let homeCases=0;
  for(const [width,height]of [[320,568],[360,640],[375,667],[390,844],[430,932],[600,800],[768,1024],[769,600],[667,375],[844,390],[1024,600],[1280,720],[1366,768],[1440,900],[1920,1080]]) {
   for(const saved of [false,true])for(const dark of [false,true]) {
    await load(width,height,{saved,dark});
    for(const language of await evaluate('Object.keys(languageNames)')) {
     await evaluate(`applyLanguage(${JSON.stringify(language)})`);
     const home=await measure();assertHome(home,{saved,label:language+' '+(dark?'dark':'light')});
     assert.equal(home.dark,dark?'dark':'light');homeCases++;
    }
   }
   console.log('Homepage: all languages, themes and save states at '+width+'x'+height);
  }
  console.log(homeCases+' homepage cases: exact viewport hero, all content visible, lower sections below fold, no overlaps or horizontal overflow.');
  for(const [width,height]of [[320,568],[1366,768]]) {
   await load(width,height,{saved:true,dark:true,language:'de'});
   for(const id of ['features','how-to']) {
    const reached=await evaluate(`(()=>{document.getElementById('${id}').scrollIntoView({behavior:'instant'});const r=document.getElementById('${id}').getBoundingClientRect();return scrollY>0&&r.top<innerHeight&&r.bottom>0;})()`);
    assert(reached,id+' reachable by normal scrolling');
   }
  }
  for(const [width,height]of [[240,320],[320,400],[568,280],[1024,320],[320,568],[390,844],[667,375],[1366,768]]) {
   await load(width,height,{saved:true,dark:true,large:true,language:'de'});
   assertHome(await measure(),{fit:false,label:'Small screen / larger accessibility controls'});
  }
  console.log('Lower sections scroll into view; unusually small screens and larger accessibility controls grow without clipping or overlap.');
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
