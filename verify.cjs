const {chromium}=require('C:/Users/equin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const {pathToFileURL}=require('url'),path=require('path'),assert=require('assert');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'C:/Users/equin/AppData/Local/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-win64/chrome-headless-shell.exe'});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(pathToFileURL(path.join(__dirname,'index.html')).href);
  assert.equal(await page.locator('#advancedSettings').getAttribute('open'),null);
  assert.equal(await page.locator('#captureCsv,#qualityImages,#reconstructionCsv,#coverageLayer').count(),0);
  assert.equal(await page.locator('#exportFlight').isDisabled(),true);
  const action=await page.locator('#optimizeMission').boundingBox();assert(action.y>=0&&action.y+action.height<1000);
  await page.screenshot({path:path.join(__dirname,'preview-simple-initial.png')});
  await page.evaluate(()=>{window.exportedCsv=null;URL.createObjectURL=blob=>{blob.text().then(t=>window.exportedCsv=t);return 'blob:test';};HTMLAnchorElement.prototype.click=function(){};});
  for(const id of ['spring-run','williams-island','z-dam']){
   await page.selectOption('#surveySelect',id);await page.fill('#maxGsd',id==='z-dam'?'1':'0.5');
   await page.click('#optimizeMission');await page.waitForFunction(()=>!document.querySelector('#optimizeMission').disabled,{},{timeout:120000});
   assert.equal(await page.locator('#planBadge').innerText(),'Plan ready',await page.locator('#optimizationStatus').innerText());
   assert.equal(await page.locator('#resultGcps').innerText(),'5');assert.equal(await page.locator('#statsGrid .stat-card').count(),4);
   assert(!/NaN|Infinity/.test(await page.locator('#statsGrid').innerText()));
   assert.equal(await page.locator('#advancedSettings').getAttribute('open'),null);
   await page.click('#exportGcps');await page.waitForFunction(()=>window.exportedCsv?.startsWith('id,easting_m'));
   const rows=(await page.evaluate(()=>window.exportedCsv)).split('\n').slice(1).map(r=>r.split(','));
   assert.equal(rows.length,5);for(let i=0;i<rows.length;i++)for(let j=i+1;j<rows.length;j++)assert(Math.hypot(+rows[i][1]-rows[j][1],+rows[i][2]-rows[j][2])>=15.998);
   assert(rows.every(r=>r.includes('EPSG:32618')&&r.includes('EGM96')));
   await page.click('#exportFlight');await page.waitForFunction(()=>window.exportedCsv?.startsWith('waypoint_id'));
   const flight=(await page.evaluate(()=>window.exportedCsv)).split('\n').slice(1).map(r=>r.split(','));
   assert(flight.length>=3&&flight.length<=3000);assert(flight.every(r=>+r.at(-2)>0&&+r.at(-1)===5));
   for(let i=1;i<flight.length;i++)assert(+flight[i][7]-flight[i-1][7]>=4.998);
   await page.check('#showCoverage');assert.equal(await page.locator('#exportFlight').isDisabled(),false);await page.uncheck('#showCoverage');
   console.log(id,await page.locator('#planSummary').innerText());
  }
  await page.screenshot({path:path.join(__dirname,'preview-simple.png')});
  await page.locator('#planDetails summary').click();assert.equal(await page.locator('#gcpRows tr').count(),5);
  await page.fill('#numGcps','6');assert.equal(await page.locator('#exportFlight').isDisabled(),true);assert.equal(await page.locator('#exportGcps').isDisabled(),true);assert.equal(await page.locator('#resultGcps').innerText(),'—');
  assert.deepEqual(errors,[]);
  await page.setViewportSize({width:390,height:844});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
  await page.screenshot({path:path.join(__dirname,'preview-simple-mobile.png'),fullPage:true});
  console.log('Focused planner: all three sites, exports, timing, spacing, display state and mobile layout passed.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
