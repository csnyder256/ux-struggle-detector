
const {chromium}=require('playwright');
const fs=require('fs'),path=require('path'),http=require('http'),assert=require('assert/strict');
(async()=>{
 const root=path.resolve(__dirname,'../public');
 const version=fs.readFileSync(path.resolve(__dirname,'../VERSION'),'utf8').trim();
 const outputRoot=process.env.SDK_QA_DIR || fs.mkdtempSync(path.join(require('os').tmpdir(),'ux-demo-'));
 fs.mkdirSync(outputRoot,{recursive:true});
 const server=http.createServer((req,res)=>{try{
  let file=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
  if(!file.startsWith(root+path.sep))throw new Error('Invalid path');
  if(fs.statSync(file).isDirectory())file=path.join(file,'index.html');
  res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(file));
 }catch{res.statusCode=404;res.end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({...(process.env.BROWSER_PATH?{executablePath:process.env.BROWSER_PATH}:{}),headless:true,args:['--no-sandbox']});
 const checks=[];
 try{
  for(const [name,viewport] of [['desktop',{width:1440,height:1000}],['mobile',{width:390,height:844}]]){
   const page=await browser.newPage({viewport,acceptDownloads:true});
   const errors=[],posts=[];
   page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()==='POST')posts.push(r.url());});
   await page.goto('http://127.0.0.1:'+server.address().port+'/demo/');
   await page.locator('#place-order').click();await page.locator('#place-order').click();await page.locator('#place-order').click();
   await page.locator('#verdict').filter({hasText:'Rage click detected'}).waitFor();
   assert.equal(await page.locator('#click-count').textContent(),'3');
   assert.match(await page.locator('#local-rule').textContent(),/agreed/);
   await page.getByText('Your order has not been placed.',{exact:false}).waitFor();
   assert.ok(await page.locator('#place-order').getAttribute('data-sh-id'));
   await page.locator('#repair').click();await page.locator('#place-order').click();
   await page.locator('#order-status').filter({hasText:'Demo order confirmed'}).waitFor();
   await page.waitForFunction(()=>Number(document.querySelector('#outcome-count').textContent)>0);
   await page.locator('#email').fill('invalid-example');
   await page.locator('#validate').click();
   await page.getByText('Use an email-shaped example such as demo@example.test.',{exact:true}).waitFor();
   await page.locator('#tour').click();
   const dialog=page.getByRole('dialog');
   assert.match(await dialog.textContent(),/STEP 1 OF 5/);
   await dialog.getByRole('button',{name:'Next',exact:true}).click();
   await dialog.getByRole('button',{name:'Back',exact:true}).click();
   assert.match(await dialog.textContent(),/STEP 1 OF 5/);
   await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').count(),0);
   assert.equal(await page.evaluate(()=>document.activeElement.id),'tour');
   await page.locator('#tour').click();
   for(let i=0;i<4;i++)await dialog.getByRole('button',{name:'Next',exact:true}).click();
   await dialog.getByRole('button',{name:'Finish tour',exact:true}).click();
   assert.match(await page.locator('#tour-result').textContent(),/Tour complete/);
   const downloadPromise=page.waitForEvent('download');await page.locator('#export').click();
   const download=await downloadPromise;const output=path.join(outputRoot,'ux-'+name+'-evidence.json');await download.saveAs(output);
   const record=JSON.parse(fs.readFileSync(output));
   assert.equal(record.product_version,version);assert.equal(record.mode,'controlled_local_demo');
   assert.ok(record.detections.some(x=>x.type==='RAGE_CLICK'));assert.ok(record.detections.some(x=>x.type==='FORMAT_ERROR'));
   assert.equal(record.events.filter(e=>e.eventType==='CLICK'&&e.element?.label==='Place demo order').length,4);
   assert.ok(record.events.some(e=>e.meta?.kind==='intervention_success'));
   assert.ok(!JSON.stringify(record).includes('invalid-example'));
   await page.locator('#pause').click();const count=await page.locator('#click-count').textContent();
   await page.locator('#place-order').click();assert.equal(await page.locator('#click-count').textContent(),count);
   assert.equal(await page.locator('#__sh_root__').count(),0);
   await page.locator('#pause').click();await page.locator('#place-order').click();
   await page.waitForFunction(c=>Number(document.querySelector('#click-count').textContent)===Number(c)+1,count);
   await page.locator('#reset').click();assert.equal(await page.locator('#click-count').textContent(),'0');
   assert.equal(await page.locator('#email').inputValue(),'');
   assert.match(await page.locator('#tour-result').textContent(),/Five steps/);
   await page.screenshot({path:path.join(outputRoot,'ux-'+name+'.png'),fullPage:true});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   assert.deepEqual(errors,[]);assert.deepEqual(posts,[]);
   checks.push({viewport:name,events:record.events.length,signals:record.detections.length,checks:['actual SDK events','actual production detector','runtime target binding','real rendered tooltip and inline help','persisted outcome event','5-step finish/back/Escape/replay/focus','portable JSON without input values','stop/resume/reset','no horizontal overflow','no network POST or page errors']});
   await page.close();
  }
  fs.writeFileSync(path.join(outputRoot,'ux-browser.json'),JSON.stringify({checks},null,2));console.log('UX desktop/mobile real demo passed',JSON.stringify(checks));
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
