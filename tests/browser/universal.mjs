import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as XLSX from 'xlsx';
const root = path.resolve(import.meta.dirname,'../..');
const {chromium} = await import(pathToFileURL('C:/Users/yagnesh/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs').href);
const browsers = [
  ['Chrome','C:/Program Files/Google/Chrome/Application/chrome.exe'],
  ['Edge','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'],
].filter(([,exe])=>existsSync(exe));
assert.ok(browsers.length,'No browser installed');
mkdirSync(path.join(root,'artifacts'),{recursive:true});
const results=[];
for (const [name, executablePath] of browsers) {
  let browser;
  try {
    browser = await chromium.launch({executablePath,headless:true,args:['--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
  } catch (error) {
    if (!/disallowed by the system admin/.test(error.message)) throw error;
    results.push({browser:name,status:'blocked',reason:'System policy disallows headless automation and remote debugging.'});
    console.log(`${name} verification blocked by system browser policy`);
    continue;
  }
  const page = await browser.newPage({viewport:{width:1440,height:960}});
  page.setDefaultTimeout(30_000);
  const errors=[], requests=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{if (/^https?:/i.test(r.url())) requests.push(r.url());});
  const timings={};
  const ready = () => page.locator('#chart-status .status-ready').waitFor();
  async function upload(filename,content) {
    await page.setInputFiles('#file-input',{name:filename,mimeType:'application/octet-stream',buffer:Buffer.isBuffer(content) ? content : Buffer.from(content)});
    await page.waitForFunction(filename=>document.querySelector('#source-file-name').textContent===filename,filename);
    await ready();
  }
  try {
    await page.goto(pathToFileURL(path.join(root,'dist/3d-viz-studio.html')).href,{waitUntil:'load'});
    await page.getByRole('heading',{name:/give your data/i}).waitFor();
    await page.locator('#sample-domain').selectOption('sensors');
    await page.locator('#sample-data-button').click(); await ready();
    assert.match(await page.locator('#chart-toolbar-subtitle').innerText(),/Bubble/);
    await page.screenshot({path:path.join(root,`artifacts/universal-${name}-sensors.png`),fullPage:true});
    await upload('counts.json','[{"Department":"Lab","Status":"Open"},{"Department":"Lab","Status":"Closed"},{"Department":"Office","Status":"Open"}]');
    assert.match(await page.locator('#chart-toolbar-title').innerText(),/Record count/);
    assert.equal(await page.locator('#aggregation-select').inputValue(),'count');
    await upload('metrics.tsv','Batch\tX\tY\tZ\n001\t1\t2\t3\n002\t2\t3\t4\n003\t3\t4\t5');
    await page.locator('#preview-data-button').click();
    assert.match(await page.locator('#preview-table tbody tr').first().innerText(),/001/);
    await page.getByRole('button',{name:/close preview/i}).click();
    await upload('events.ndjson','{"A":1,"B":2,"C":3}\n{"A":2,"B":3,"C":4}\n{"A":3,"B":4,"C":5}');
    const wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['Team','Units'],['Lab',4],['Office',7],['Lab',9]]),'Inventory');
    for (const bookType of ['xlsx','xlsm','xls','ods']) await upload('inventory.'+bookType,XLSX.write(wb,{bookType,type:'buffer'}));
    await upload('tables.json','{"first":[{"Kind":"A","Value":1},{"Kind":"B","Value":2}],"second":[{"Kind":"C","Value":3},{"Kind":"D","Value":4}]}');
    await page.locator('#sheet-select').selectOption('second'); await page.locator('#source-meta').filter({hasText:'2 rows'}).waitFor();
    await page.waitForFunction(()=>document.querySelector('#sheet-select').value==='second'); await ready();
    const before = await page.locator('#source-file-name').innerText();
    await page.setInputFiles('#file-input',{name:'bad.ndjson',mimeType:'text/plain',buffer:Buffer.from('{"x":1}\n{bad}')});
    await page.locator('#import-live-text').filter({hasText:/line 2/i}).waitFor();
    assert.equal(await page.locator('#source-file-name').innerText(),before);
    await page.locator('#recommendations button').first().click(); await ready();
    // A delayed File read gives a deterministic cancellation window.
    await page.evaluate(()=>{window.__readOriginal=File.prototype.arrayBuffer;File.prototype.arrayBuffer=function(){return new Promise((resolve,reject)=>setTimeout(()=>window.__readOriginal.call(this).then(resolve,reject),800));};});
    await page.setInputFiles('#file-input',{name:'cancel.csv',mimeType:'text/csv',buffer:Buffer.from('Category,Value\nA,1\nB,2')});
    await page.evaluate(()=>{
      const status=document.querySelector('#import-live-text');
      let start;
      document.querySelector('#cancel-import-button').addEventListener('click',()=>{start=performance.now();},{once:true,capture:true});
      const observer=new MutationObserver(()=>{
        if (start!==undefined && /cancelled/i.test(status.textContent)) {
          window.__cancelResponseMs=performance.now()-start; observer.disconnect();
        }
      });
      observer.observe(status,{childList:true,subtree:true,characterData:true});
    });
    await page.locator('#cancel-import-button').click();
    assert.equal(await page.locator('#source-file-name').innerText(),before);
    await page.locator('#import-live-text').filter({hasText:/cancelled/i}).waitFor();
    timings.cancelResponseMs=Math.round(await page.evaluate(()=>window.__cancelResponseMs));
    assert.ok(timings.cancelResponseMs<=250,`Cancel response took ${timings.cancelResponseMs} ms`);
    await page.evaluate(()=>{File.prototype.arrayBuffer=window.__readOriginal;});
    const many = [Array.from({length:20},(_,j)=>`Metric ${j+1}`).join(','),...Array.from({length:50_000},(_,i)=>Array.from({length:20},(_,j)=>(i*(j*4+1))%(997+j*13)).join(','))].join('\n');
    const start=performance.now(); await upload('50000.csv',many); timings.initial50000Ms=Math.round(performance.now()-start);
    assert.match(await page.locator('#source-meta').innerText(),/50,000 rows/);
    assert.match(await page.locator('#chart-status').innerText(),/sampled out/);
    await page.setInputFiles('#file-input',{name:'50001.csv',mimeType:'text/csv',buffer:Buffer.from(many+'\n50000,2,3')});
    await page.locator('#import-live-text').filter({hasText:/50,000/}).waitFor();
    assert.equal(await page.locator('#source-file-name').innerText(),'50000.csv');
    await page.locator('#source-import-settings').click();
    await page.locator('#import-numeric-locale').selectOption('decimal-comma');
    await page.getByRole('button',{name:'Apply import settings'}).click(); await page.locator('#import-live').waitFor({state:'hidden'}); await ready();
    await upload('locale.csv','Group;X;Y;Z\nA;1,5;2,5;3,5\nB;2,5;3,5;4,5\nA;3,5;4,5;5,5');
    await page.getByRole('tab',{name:'Appearance'}).click();
    await page.locator('#recommendations button').filter({hasText:/three varying/i}).click(); await ready();
    await page.waitForFunction(()=>document.querySelector('#plot').data[0].x.includes(1.5));
    await page.setViewportSize({width:390,height:844});
    await page.waitForFunction(()=>{const plot=document.querySelector('#plot');return plot._fullLayout.width<=plot.clientWidth+1;});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth),true);
    assert.equal(await page.locator('#export-html-button').evaluate(button=>button.scrollWidth<=button.clientWidth+1),true);
    await page.screenshot({path:path.join(root,`artifacts/universal-${name}-mobile.png`),fullPage:true});
    await page.setViewportSize({width:1440,height:960});
    await page.locator('#source-import-settings').focus(); await page.keyboard.press('Enter');
    assert.equal(await page.locator('#import-settings-dialog').isVisible(),true); await page.keyboard.press('Escape');
    await page.evaluate(()=>document.querySelector('#plot').emit('plotly_webglcontextlost'));
    assert.match(await page.locator('#chart-status').innerText(),/graphics unavailable/);
    assert.equal(await page.locator('#source-file-name').innerText(),'locale.csv');
    assert.deepEqual(errors,[]); assert.deepEqual(requests,[]);
    results.push({browser:name,status:'passed',version:browser.version(),performanceFixture:{rows:50000,columns:20,renderer:'software WebGL'},checks:'formats, recommendation, identifier preview, sheet switching, failure preservation, cancel, 50000/50001 rows, locale, keyboard, mobile, graphics-loss',timings,errors,remoteRequests:requests.length});
    console.log(`${name} universal browser checks passed; 50,000-row initial chart ${timings.initial50000Ms} ms`);
  } catch (error) {
    await page.screenshot({path:path.join(root,`artifacts/universal-${name}-failure.png`),fullPage:true});
    console.error(JSON.stringify({browser:name,errors,status:await page.locator('#chart-status').innerText(),importStatus:await page.locator('#import-live-text').innerText(),overflow:await page.evaluate(()=>[...document.querySelectorAll('body *')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0 && r.right>innerWidth+1 && getComputedStyle(e).display!=='none';}).slice(0,12).map(e=>({id:e.id,class:e.className,width:e.getBoundingClientRect().width,right:e.getBoundingClientRect().right})))}));
    throw error;
  } finally { await browser.close(); }
}
assert.ok(results.some(result=>result.status==='passed'),'No browser verification completed');
writeFileSync(path.join(root,'artifacts/universal-browser-verification.json'),JSON.stringify({date:'2026-10-05',results},null,2));
