'use strict';
// Windows CI only. Real native FUXA rendering; no production device is enabled.
const {chromium}=require('playwright'),fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {spawn}=require('child_process');
let serverProcess,browser;
async function main(){
    const out=path.resolve('artifacts/melissa-qa');fs.mkdirSync(out,{recursive:true});
    const root=process.env.MELISSA_PACKAGE;if(!root)throw new Error('MELISSA_PACKAGE is required');
    const project=JSON.parse(fs.readFileSync(path.join(root,'examples/melissa/Melissa_CPLC.fuxap')));
    assert.equal(project.devices['melissa-cplc'].type,'OPCUA');assert.deepEqual(project.devices['melissa-cplc'].tags,{});
    assert.ok(Object.values(project.devices).every(d=>!d.enabled));
    const log=fs.openSync(path.join(out,'fuxa-runtime.log'),'w');
    serverProcess=spawn(path.join(root,'node.exe'),['server/main.js','--userDir',path.join(root,'data'),'--port','1881'],{cwd:root,windowsHide:true,stdio:['ignore',log,log]});fs.closeSync(log);
    let ready=false;
    for(let i=0;i<90;i++){
        if(serverProcess.exitCode!==null)throw new Error('Isolated FUXA exited');
        try{if((await fetch('http://127.0.0.1:1881/api/melissa/snapshot')).ok){ready=true;break;}}catch(_){}
        await new Promise(r=>setTimeout(r,500));
    }
    assert.ok(ready,'FUXA did not become ready');
    browser=await chromium.launch({headless:true});
    const page=await browser.newPage({viewport:{width:1920,height:1080}}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto('http://127.0.0.1:1881/home');
    const overview=project.hmi.views.find(v=>v.id==='melissa_overview');
    await page.waitForSelector('#MEL_overview_rotation',{timeout:45000});await page.waitForTimeout(400);
    assert.equal(await page.locator('iframe').count(),0,'HMI must contain no iframes');
    assert.ok(await page.locator('[type="svg-ext-shapes"]').count()>100);
    const bounds=await page.locator('#MEL_overview_layout_panel').boundingBox();
    assert.ok(bounds.x>=0&&bounds.x+bounds.width<=1921&&bounds.y+bounds.height<=1081,'native layout must fit 1080p');
    await page.screenshot({path:path.join(out,'native-overview.png')});
    const clickTarget=async target=>{
        const item=Object.values(overview.items).find(i=>i.property.events?.some(e=>e.actparam==='melissa_'+target));
        assert.ok(item,'Missing native navigation '+target);await page.locator('#'+item.id).click();
    };
    for(const target of ['palomat_5','palomat_1','eidos_popup','station_r1-1-out']){
        await clickTarget(target);await page.waitForSelector('app-fuxa-view-dialog');
        const view=project.hmi.views.find(v=>v.id==='melissa_'+target);
        await page.waitForSelector('#'+Object.keys(view.items)[0]);
        assert.equal(await page.locator('app-fuxa-view-dialog iframe').count(),0);
        await page.screenshot({path:path.join(out,'native-'+target+'.png')});
        await page.locator('.dialog-modal-close i').last().click();await page.waitForSelector('app-fuxa-view-dialog',{state:'detached'});
    }
    await page.locator('#MEL_overview_rotation').click();await page.waitForSelector('#MEL_overview_180_rotation');
    const upright=await page.locator('#home svg text').evaluateAll(elements=>elements.filter(e=>e.textContent.trim()&&e.getBBox().width).every(e=>{const m=e.getScreenCTM();return m.a>0&&m.d>0;}));
    assert.equal(upright,true,'Rotated labels must remain upright');await page.screenshot({path:path.join(out,'native-overview-180.png')});
    await page.locator('#MEL_overview_180_rotation').click();await page.waitForSelector('#MEL_overview_rotation');
    for(const item of project.hmi.layout.navigation.items){
        await page.locator('app-sidenav button').filter({hasText:item.text}).first().click();
        const view=project.hmi.views.find(v=>v.id===item.view);
        await page.waitForSelector('#'+Object.keys(view.items)[0]);await page.waitForTimeout(150);
        assert.equal(await page.locator('iframe').count(),0);
        await page.screenshot({path:path.join(out,item.view+'.png')});
    }
    const history=await(await fetch('http://127.0.0.1:1881/api/melissa/deliveries')).json();
    assert.equal(history.completionTarget,'wrapper');assert.equal(history.sourceConfigured,false);
    assert.deepEqual(errors,[]);
    fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({status:'passed',native:true,iframes:0,screenViews:16,totalViews:project.hmi.views.length,protocol:'OPCUA',preselectedCplcTags:0,productionDevicesEnabled:false,plcValidation:false,editorBindingValidation:'Requires real server browse and user-selected tags'},null,2));
}
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{
    if(browser)await browser.close();if(serverProcess){serverProcess.kill();await new Promise(r=>{if(serverProcess.exitCode!==null)r();else serverProcess.once('exit',r);});}
});
