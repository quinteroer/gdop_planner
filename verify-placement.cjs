const assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const server=spawn('python',['-m','http.server','8790','--bind','127.0.0.1'],{cwd:__dirname,windowsHide:true,stdio:'ignore'});let browser;
 try{
  for(let i=0;i<60;i++){try{if((await fetch('http://127.0.0.1:8790')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
  browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'],...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
  const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:8790');assert.equal(await page.locator('#avoidTrees').isChecked(),true);
  await page.selectOption('#gcpMode','fixed');await page.fill('#numGcps','5');
  await page.locator('#advancedSettings summary').click();
  for(const [id,value] of Object.entries({minAltitude:40,maxAltitude:40,maxGsd:1,searchBudget:20}))await page.fill('#'+id,String(value));
  await page.click('#optimizeMission');await page.waitForFunction(()=>!document.querySelector('#optimizeMission').disabled,{},{timeout:240000});
  assert.equal(await page.locator('#planBadge').innerText(),'Plan ready',await page.locator('#optimizationStatus').innerText());
  await page.evaluate(()=>{window.exportedCsv=null;URL.createObjectURL=blob=>{blob.text().then(t=>window.exportedCsv=t);return 'blob:test';};HTMLAnchorElement.prototype.click=function(){};});
  await page.click('#exportGcps');await page.waitForFunction(()=>window.exportedCsv?.startsWith('id,easting_m'));
  const rows=(await page.evaluate(()=>window.exportedCsv)).split('\n').slice(1).map(r=>r.split(','));
  const site=await page.evaluate(()=>SURVEY_SITES[0]);
  assert.equal(rows.length,5);
  for(const row of rows){
   const col=Math.round((Number(row[1])-site.west)/site.width*(site.gridSize-1));
   const r=Math.round((Number(row[2])-site.south)/site.height*(site.gridSize-1));
   assert.equal(site.gcpPlacement.allowed[r*site.gridSize+col],true);
   assert(Number(row[4])>0&&Number(row[4])<=10);
  }
  const canvas=page.locator('#mapCanvas'),before=await canvas.evaluate(el=>el.toDataURL());
  await page.check('#showGdop');assert.equal(await page.locator('#gdopLegend').isVisible(),true);
  assert.match(await page.locator('#gdopLegend').innerText(),/Gray = blocked/);
  assert.notEqual(await canvas.evaluate(el=>el.toDataURL()),before);
  assert.equal(await page.locator('#exportGcps').isDisabled(),false);
  await page.locator('#planDetails summary').click();assert.match(await page.locator('#planMetrics').innerText(),/DSM checked/);
  if(process.env.PLACEMENT_SCREENSHOT)await page.screenshot({path:process.env.PLACEMENT_SCREENSHOT,fullPage:true});
  await page.click('#view2d');await page.uncheck('#showGdop');
  const plain=await canvas.evaluate(el=>el.toDataURL());await page.check('#showGdop');assert.notEqual(await canvas.evaluate(el=>el.toDataURL()),plain);
  await page.uncheck('#showGdop');await page.check('#showPlacement');assert.notEqual(await canvas.evaluate(el=>el.toDataURL()),plain);
  assert.equal(await page.locator('#exportFlight').isDisabled(),false);
  await page.uncheck('#avoidTrees');assert.equal(await page.locator('#exportFlight').isDisabled(),true);
  await page.selectOption('#surveySelect','');assert.equal(await page.locator('#avoidTrees').isDisabled(),true);
  assert.match(await page.locator('#placementHint').innerText(),/needs DSM and DTM/);
  assert.deepEqual(errors,[]);
  console.log('Placement checks passed: actual Spring Run targets outside screened cover, surface-aware scores, GDOP heatmaps in 2D/3D, mask overlay, invalidation and missing-model hint.');
 }finally{await browser?.close();server.kill();}
})().catch(e=>{console.error(e);process.exitCode=1});
