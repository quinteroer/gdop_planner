/* End-to-end checks against the real Python module running in Pyodide. */
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const server=spawn(process.env.PYTHON||'python',['-m','http.server','8786','--bind','127.0.0.1'],{cwd:__dirname,windowsHide:true,stdio:'ignore'});
 let browser;
 try{
  for(let i=0;i<60;i++){
   try{if((await fetch('http://127.0.0.1:8786')).ok)break;}catch{}
   await new Promise(r=>setTimeout(r,100));
  }
  browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
  const page=await browser.newPage({viewport:{width:1440,height:1050}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:8786');
  await page.selectOption('#surveySelect','');await page.selectOption('#gcpMode','fixed');
  await page.locator('#advancedSettings summary').click();
  for(const [id,v] of Object.entries({siteWidth:60,siteHeight:40,minAltitude:35,maxAltitude:35,maxGsd:1,numGcps:4,searchBudget:40}))await page.fill('#'+id,String(v));
  await page.click('#optimizeMission');
  await page.waitForFunction(()=>!document.querySelector('#optimizeMission').disabled,{},{timeout:180000});
  console.log(await page.locator('#optimizationStatus').innerText());
  assert.equal(await page.locator('#planBadge').innerText(),'Plan ready');
  assert.match(await page.locator('#planSummary').innerText(),/geometric route/);
  assert.equal(await page.locator('#resultGcps').innerText(),'4');
  assert(!/NaN|undefined/.test(await page.locator('.results').innerText()));
  await page.evaluate(()=>{window.exportedCsv=null;URL.createObjectURL=blob=>{blob.text().then(t=>window.exportedCsv=t);return 'blob:test';};HTMLAnchorElement.prototype.click=function(){};});
  await page.click('#exportFlight');await page.waitForFunction(()=>window.exportedCsv?.startsWith('waypoint_id'));
  const flight=(await page.evaluate(()=>window.exportedCsv)).split('\n').slice(1).map(row=>row.split(','));
  const captures=flight.filter(row=>row[1]==='true');
  assert.equal(captures.length,Number(await page.locator('#resultPhotos').innerText()));
  assert(flight.some(row=>row[1]==='false'));
  for(let i=1;i<captures.length;i++)assert(Number(captures[i][7])-Number(captures[i-1][7])>=4.998);
  await page.click('#exportGcps');await page.waitForFunction(()=>window.exportedCsv?.startsWith('id,easting_m'));
  assert.equal((await page.evaluate(()=>window.exportedCsv)).split('\n').length,5);
  await page.uncheck('#showMidpoints');assert.equal(await page.locator('#exportFlight').isDisabled(),false);
  await page.check('#showCoverage');assert.equal(await page.locator('#exportFlight').isDisabled(),false);
  if(process.env.SCREENSHOT_PATH)await page.screenshot({path:process.env.SCREENSHOT_PATH,fullPage:true});
  await page.selectOption('#gcpMode','optimize');await page.fill('#numGcps','8');await page.fill('#maxGcpDistance','60');
  assert.equal(await page.locator('#exportFlight').isDisabled(),true);
  await page.click('#optimizeMission');await page.waitForFunction(()=>!document.querySelector('#optimizeMission').disabled,{},{timeout:180000});
  assert.equal(await page.locator('#planBadge').innerText(),'Plan ready');
  assert(Number(await page.locator('#resultGcps').innerText())>=3);
  await page.fill('#minClearance','100');await page.click('#optimizeMission');
  await page.waitForFunction(()=>!document.querySelector('#optimizeMission').disabled,{},{timeout:30000});
  assert.equal(await page.locator('#planBadge').innerText(),'No plan found');
  assert.equal(await page.locator('#exportFlight').isDisabled(),true);
  await page.fill('#minClearance','15');await page.click('#optimizeMission');
  await page.click('#cancelSearch');await page.waitForFunction(()=>!document.querySelector('#optimizeMission').disabled);
  assert.match(await page.locator('#optimizationStatus').innerText(),/canceled/i);
  assert.equal(await page.locator('#cancelSearch').isVisible(),false);
  // Recovery after cancellation must create a fresh worker successfully.
  await page.click('#optimizeMission');
  await page.waitForFunction(()=>!document.querySelector('#optimizeMission').disabled,{},{timeout:180000});
  assert.equal(await page.locator('#planBadge').innerText(),'Plan ready');
  assert.deepEqual(errors,[]);
  await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  console.log('Python visualizer checks passed: actual worker, count search, route display, capture CSV timing, failure, cancellation and mobile layout.');
 }finally{await browser?.close();server.kill();}
})().catch(e=>{console.error(e);process.exitCode=1});
