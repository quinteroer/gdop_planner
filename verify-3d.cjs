/* Perspective rendering and interaction checks using the real site elevations. */
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const server=spawn(process.env.PYTHON||'python',['-m','http.server','8788','--bind','127.0.0.1'],{cwd:__dirname,windowsHide:true,stdio:'ignore'});
 let browser;
 try{
  for(let i=0;i<60;i++){
   try{if((await fetch('http://127.0.0.1:8788')).ok)break;}catch{}
   await new Promise(r=>setTimeout(r,100));
  }
  browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
  const page=await browser.newPage({viewport:{width:1440,height:1100},hasTouch:true}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:8788');
  const canvas=page.locator('#mapCanvas');
  assert.equal(await page.locator('#view3d').getAttribute('aria-pressed'),'true');
  assert.match(await page.locator('#terrainInfo').innerText(),/DTM ground elevations -4.6 to 0.7 m/);
  const snapshot=()=>canvas.evaluate(el=>el.toDataURL());
  const initial=await snapshot();
  let box=await canvas.boundingBox();
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
  await page.mouse.down();await page.mouse.move(box.x+box.width/2+90,box.y+box.height/2+25,{steps:8});await page.mouse.up();
  await page.waitForFunction(before=>document.querySelector('#mapCanvas').toDataURL()!==before,initial);
  await page.click('#resetView');assert.equal(await snapshot(),initial);
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.wheel(0,-250);
  await page.waitForFunction(before=>document.querySelector('#mapCanvas').toDataURL()!==before,initial);
  await page.click('#resetView');assert.equal(await snapshot(),initial);
  await canvas.focus();await page.keyboard.press('ArrowLeft');
  await page.waitForFunction(before=>document.querySelector('#mapCanvas').toDataURL()!==before,initial);
  await page.keyboard.press('0');
  await page.waitForFunction(before=>document.querySelector('#mapCanvas').toDataURL()===before,initial);
  await page.keyboard.down('Shift');await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+45,box.y+box.height/2,{steps:5});await page.mouse.up();await page.keyboard.up('Shift');
  assert.notEqual(await snapshot(),initial);await page.click('#resetView');
  // Two-finger pinch on touch-enabled Chromium must update the camera too.
  const cdp=await page.context().newCDPSession(page),x=box.x+box.width/2,y=box.y+box.height/2;
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:x-30,y,id:1},{x:x+30,y,id:2}]});
  for(const spread of [40,60,80])await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x-spread,y,id:1},{x:x+spread,y,id:2}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await page.waitForFunction(before=>document.querySelector('#mapCanvas').toDataURL()!==before,initial);
  await page.click('#resetView');
  for(const [id,range] of [['williams-island',/-6.2 to 3.8 m/],['z-dam',/-13.3 to 3.7 m/]]){
   await page.selectOption('#surveySelect',id);assert.match(await page.locator('#terrainInfo').innerText(),range);
  }
  await page.selectOption('#verticalScale','5');
  if(process.env.TERRAIN_SCREENSHOT)await page.screenshot({path:process.env.TERRAIN_SCREENSHOT,fullPage:true});
  await page.click('#view2d');assert.equal(await page.locator('#view2d').getAttribute('aria-pressed'),'true');
  await page.click('#view3d');
  await page.locator('#advancedSettings summary').click();await page.selectOption('#mapTool','boundary');
  assert.equal(await page.locator('#view2d').getAttribute('aria-pressed'),'true');
  await page.selectOption('#surveySelect','');await page.selectOption('#gcpMode','fixed');
  for(const [id,value] of Object.entries({siteWidth:60,siteHeight:40,numGcps:4,minAltitude:35,maxAltitude:35,maxGsd:1,searchBudget:40}))await page.fill('#'+id,String(value));
  await page.click('#view3d');await page.selectOption('#verticalScale','1');
  await page.fill('#siteWidth','');
  assert.equal(await canvas.evaluate(el=>el.getContext('2d').getImageData(el.width/2,el.height/2,1,1).data[3]),0);
  await page.fill('#siteWidth','60');
  await page.click('#optimizeMission');await page.waitForFunction(()=>!document.querySelector('#optimizeMission').disabled,{},{timeout:180000});
  assert.equal(await page.locator('#planBadge').innerText(),'Plan ready');
  const summary=await page.locator('#planSummary').innerText();
  await page.selectOption('#verticalScale','2');await page.click('#resetView');
  assert.equal(await page.locator('#exportFlight').isDisabled(),false);assert.equal(await page.locator('#planSummary').innerText(),summary);
  await page.selectOption('#verticalScale','1');
  if(process.env.FLIGHT_SCREENSHOT)await page.screenshot({path:process.env.FLIGHT_SCREENSHOT,fullPage:true});
  await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.deepEqual(errors,[]);
  console.log('3D terrain checks passed: real elevations at all sites, mouse orbit, zoom, pan, keyboard, pinch, reset, 2D editing, Python route overlay and mobile layout.');
 }finally{await browser?.close();server.kill();}
})().catch(e=>{console.error(e);process.exitCode=1});
