'use strict';
// CI only: real FUXA with all production devices disabled, plus intercepted synthetic frames.
const {chromium}=require('playwright'),fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {spawn}=require('child_process');
let serverProcess,browser;
async function main(){
    const out=path.resolve('artifacts/melissa-qa');fs.mkdirSync(out,{recursive:true});
    const packageRoot=process.env.MELISSA_PACKAGE;
    if(!packageRoot)throw new Error('MELISSA_PACKAGE is required for the isolated Windows test');
    const log=fs.openSync(path.join(out,'fuxa-runtime.log'),'w');
    serverProcess=spawn(path.join(packageRoot,'node.exe'),['server/main.js','--userDir',path.join(packageRoot,'data'),'--port','1881'],{cwd:packageRoot,windowsHide:true,stdio:['ignore',log,log]});
    fs.closeSync(log);
    let ready=false;
    for(let attempt=0;attempt<90;attempt++){
        if(serverProcess.exitCode!==null)throw new Error('Isolated FUXA exited: '+serverProcess.exitCode);
        try{const r=await fetch('http://127.0.0.1:1881/api/melissa/snapshot');if(r.ok){ready=true;break;}}catch(_){}
        await new Promise(resolve=>setTimeout(resolve,500));
    }
    if(!ready)throw new Error('Isolated FUXA did not become ready');
    browser=await chromium.launch({headless:true});
    const page=await browser.newPage({viewport:{width:1600,height:1100}}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    const snapshot=await (await fetch('http://127.0.0.1:1881/api/melissa/snapshot')).json();
    assert.equal(snapshot.manifest.stations.length,35);assert.ok(snapshot.devices.every(d=>!d.enabled));
    for(const route of ['overview','r1','r2','r3','r4','r5','r6','buffer','deliveries','sap','eidos','wrapper','palomats','diagnostics','events']){
        await page.goto(`http://127.0.0.1:1881/melissa/?page=${route}`);
        await page.waitForSelector('#transport.good');await page.waitForTimeout(200);
        assert.ok((await page.locator('#content').innerText()).length>30);
        await page.screenshot({path:path.join(out,route+'.png'),fullPage:true});
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'unexpected page overflow: '+route);
    }
    const fake=structuredClone(snapshot);fake.source='SYNTHETIC CI FIXTURE';
    for(const v of Object.values(fake.cplc)){v.quality='good';v.timestamp=Date.now();v.value=false;}
    fake.cplc['R1-1OUT.SSCC'].value='000000000000000123';fake.cplc['R1-1OUT.Occupied'].value=true;fake.cplc['R1-1OUT.PalletType'].value=20;
    await page.route('**/api/melissa/snapshot',route=>route.fulfill({json:fake}));
    await page.goto('http://127.0.0.1:1881/melissa/?page=r1');
    await page.waitForFunction(()=>document.body.textContent.includes('000000000000000123'));
    await page.evaluate(()=>{const n=document.createElement('div');n.textContent='SYNTHETIC CI FIXTURE — NOT PLC DATA';n.style='position:fixed;top:0;right:0;background:#f5bc59;color:black;padding:8px;z-index:99999';document.body.appendChild(n);});
    await page.screenshot({path:path.join(out,'r1-synthetic.png'),fullPage:true});
    await page.unroute('**/api/melissa/snapshot');await page.route('**/api/melissa/snapshot',route=>route.abort());
    await page.waitForSelector('#transport.bad');assert.ok((await page.locator('#content').innerText()).includes('ΠΑΛΙΑ ΔΕΔΟΜΕΝΑ'));
    await page.screenshot({path:path.join(out,'r1-connection-lost.png'),fullPage:true});
    await page.unroute('**/api/melissa/snapshot');
    await page.goto('http://127.0.0.1:1881/home');
    await page.waitForFunction(()=>Array.from(document.querySelectorAll('iframe')).some(f=>f.src.includes('/melissa/')),undefined,{timeout:45000});
    await page.screenshot({path:path.join(out,'fuxa-native-home.png'),fullPage:true});
    assert.deepEqual(errors,[]);
    fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({status:'passed',pages:15,productionDevicesEnabled:false,plcValidation:false,syntheticFrameTest:true},null,2));
}
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{
    if(browser)await browser.close();
    if(serverProcess){serverProcess.kill();await new Promise(resolve=>{if(serverProcess.exitCode!==null)resolve();else serverProcess.once('exit',resolve);});}
});
