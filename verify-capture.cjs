/* Advanced planner workflows. Pure capture-library checks remain in capture-planning.test.cjs. */
const {chromium}=require('C:/Users/equin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const {pathToFileURL}=require('url'),path=require('path'),assert=require('assert');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'C:/Users/equin/AppData/Local/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-win64/chrome-headless-shell.exe'});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(pathToFileURL(path.join(__dirname,'index.html')).href);await page.selectOption('#surveySelect','');
  await page.locator('#advancedSettings summary').click();
  for(const [id,value] of Object.entries({minAltitude:30,maxAltitude:30,maxGsd:1,minForward:80,minSide:80}))await page.fill('#'+id,String(value));
  async function clickMap(x,y){
   await page.locator('#mapCanvas').scrollIntoViewIfNeeded();const b=await page.locator('#mapCanvas').boundingBox();
   const scale=Math.min((b.width-60)/100,(b.height-60)/100),ox=(b.width-100*scale)/2,oy=(b.height-100*scale)/2;
   await page.mouse.click(b.x+ox+x*scale,b.y+oy+(100-y)*scale);
  }
  await page.selectOption('#mapTool','boundary');for(const p of [[5,5],[95,5],[95,95],[5,95]])await clickMap(...p);
  assert((await page.locator('#mapToolStatus').innerText()).includes('4 boundary corners'));
  await page.click('#finishBoundary');assert((await page.locator('#mapToolStatus').innerText()).includes('applied'));
  await page.check('#terrainSight');await page.click('#optimizeMission');await page.waitForFunction(()=>!document.querySelector('#optimizeMission').disabled,{},{timeout:120000});
  assert.equal(await page.locator('#planBadge').innerText(),'Plan ready',await page.locator('#optimizationStatus').innerText());
  await page.evaluate(()=>{window.exportedCsv=null;URL.createObjectURL=blob=>{blob.text().then(t=>window.exportedCsv=t);return 'blob:test';};HTMLAnchorElement.prototype.click=function(){};});
  await page.selectOption('#mapTool','exclude');await clickMap(50,50);assert.equal(await page.locator('#exportFlight').isDisabled(),true);
  await page.click('#optimizeMission');await page.waitForFunction(()=>!document.querySelector('#optimizeMission').disabled,{},{timeout:120000});
  assert.equal(await page.locator('#planBadge').innerText(),'Plan ready');
  await page.click('#exportGcps');await page.waitForFunction(()=>window.exportedCsv?.startsWith('id,easting_m'));
  const gcps=(await page.evaluate(()=>window.exportedCsv)).split('\n').slice(1).map(r=>r.split(',').map(Number));
  assert.equal(gcps.length,5);assert(gcps.every(r=>Math.hypot(r[1]-50,r[2]-50)>=14.999));
  await page.click('#clearExclusions');await page.click('#clearBoundary');
  await page.selectOption('#mapTool','boundary');for(const p of [[5,5],[95,95],[95,5],[5,95]])await clickMap(...p);await page.click('#finishBoundary');
  assert(/cross|zero area/.test(await page.locator('#mapToolStatus').innerText()));await page.click('#cancelBoundary');
  // A failed search never enables exports for unchecked settings.
  await page.fill('#minClearance','100');await page.click('#optimizeMission');await page.waitForFunction(()=>!document.querySelector('#optimizeMission').disabled);
  assert.equal(await page.locator('#planBadge').innerText(),'No plan found');assert.equal(await page.locator('#exportFlight').isDisabled(),true);
  assert((await page.locator('#optimizationStatus').innerText()).includes('Try a larger pixel size'));
  await page.fill('#minClearance','15');await page.fill('#minAltitude','60');await page.fill('#maxAltitude','20');
  await page.click('#optimizeMission');await page.waitForFunction(()=>!document.querySelector('#optimizeMission').disabled);
  assert.equal(await page.locator('#planBadge').innerText(),'Check settings');assert((await page.locator('#optimizationStatus').innerText()).includes('Check limit ranges'));
  await page.selectOption('#surveySelect','spring-run');assert.equal(await page.locator('#customDimensions').isVisible(),false);assert.equal(await page.locator('#mapTool').inputValue(),'view');
  assert.deepEqual(errors,[]);console.log('Advanced UI: drawn boundary, terrain visibility, GCP exclusions, invalid geometry, failed search and settings validation passed.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
