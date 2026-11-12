/* Reproduce the Williams Island uneven-strip regression with real survey data. */
const assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const server=spawn('python',['-m','http.server','8791','--bind','127.0.0.1'],{cwd:__dirname,windowsHide:true,stdio:'ignore'});let browser;
 try{
  for(let i=0;i<60;i++){try{if((await fetch('http://127.0.0.1:8791')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
  browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'],...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
  const page=await browser.newPage({viewport:{width:1767,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:8791');await page.selectOption('#surveySelect','williams-island');await page.check('#showGdop');
  await page.click('#optimizeMission');await page.waitForFunction(()=>!document.querySelector('#optimizeMission').disabled,{},{timeout:240000});
  assert.equal(await page.locator('#planBadge').innerText(),'Plan ready',await page.locator('#optimizationStatus').innerText());
  const summary=await page.locator('#planSummary').innerText();
  assert(Number(summary.match(/^[\d.]+/)[0])<1800,summary);
  await page.evaluate(()=>{window.exportedCsv=null;URL.createObjectURL=blob=>{blob.text().then(t=>window.exportedCsv=t);return 'blob:test';};HTMLAnchorElement.prototype.click=function(){};});
  await page.click('#exportFlight');await page.waitForFunction(()=>window.exportedCsv?.startsWith('waypoint_id'));
  const rows=(await page.evaluate(()=>window.exportedCsv)).split('\n').slice(1).map(row=>row.split(','));
  const site=await page.evaluate(()=>SURVEY_SITES.find(s=>s.id==='williams-island'));
  const known=site.elevations.map((z,i)=>z===null?null:[i%site.gridSize/(site.gridSize-1)*site.width,Math.floor(i/site.gridSize)/(site.gridSize-1)*site.height]).filter(Boolean);
  const bounds=[Math.min(...known.map(p=>p[0])),Math.min(...known.map(p=>p[1])),Math.max(...known.map(p=>p[0])),Math.max(...known.map(p=>p[1]))];
  for(const row of rows){const x=Number(row[2])-site.west,y=Number(row[3])-site.south;assert(x>=bounds[0]-.002&&x<=bounds[2]+.002&&y>=bounds[1]-.002&&y<=bounds[3]+.002);}
  const captures=rows.filter(row=>row[1]==='true');for(let i=1;i<captures.length;i++)assert(Number(captures[i][7])-Number(captures[i-1][7])>=4.998);
  await page.click('#exportGcps');await page.waitForFunction(()=>window.exportedCsv?.startsWith('id,easting_m'));
  for(const row of (await page.evaluate(()=>window.exportedCsv)).split('\n').slice(1).map(r=>r.split(','))){
   const col=Math.round((Number(row[1])-site.west)/site.width*(site.gridSize-1)),r=Math.round((Number(row[2])-site.south)/site.height*(site.gridSize-1));
   assert(site.gcpPlacement.allowed[r*site.gridSize+col]);assert(Number(row[4])>0&&Number(row[4])<=10);
  }
  await page.locator('#planDetails summary').click();assert.match(await page.locator('#planMetrics').innerText(),/113 × 68 m/);
  assert.equal(await page.locator('#gdopLegend').isVisible(),true);
  if(process.env.ROUTE_SCREENSHOT)await page.locator('.map-panel').screenshot({path:process.env.ROUTE_SCREENSHOT});
  assert.deepEqual(errors,[]);console.log('Williams Island checks passed:',summary,'Flight stays within known sample extent; capture timing, screened GCPs, GDOP overlay and diagnostics passed.');
 }finally{await browser?.close();server.kill();}
})().catch(e=>{console.error(e);process.exitCode=1});
