'use strict';
// Windows CI only. Real native FUXA rendering; no production device is enabled.
const {chromium}=require('playwright'),fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {spawn}=require('child_process');
let serverProcess,browser,diagnosticPage,outputDirectory;
const syntheticSscc='000000000000000123';
async function seedBindingFixture(root){
    // Changes only the isolated CI data directory, removed before packaging.
    const db=new(require('sqlite3').Database)(path.join(root,'data/_appdata/project.fuxap.db'));
    const get=name=>new Promise((resolve,reject)=>db.get('SELECT value FROM devices WHERE name=?',[name],(e,row)=>e?reject(e):resolve(JSON.parse(row.value))));
    const run=(sql,args)=>new Promise((resolve,reject)=>db.run(sql,args,e=>e?reject(e):resolve()));
    const view=id=>new Promise((resolve,reject)=>db.get('SELECT value FROM views WHERE name=?',[id],(e,row)=>e?reject(e):resolve(JSON.parse(row.value))));
    try{
        const server=await get('server');
        server.enabled=true;
        server.tags={...server.tags,__ci_sscc:{id:'__ci_sscc',name:'SYNTHETIC CI SSCC',type:'string',init:syntheticSscc},__ci_request:{id:'__ci_request',name:'SYNTHETIC CI REQUEST',type:'boolean',init:true}};
        // Native FUXA clients browse devices['0']; the legacy server field is
        // deliberately excluded from the runtime client project response.
        await run('INSERT OR REPLACE INTO devices(name,value) VALUES(?,?)',['0',JSON.stringify(server)]);
        for(const name of ['overview','overview_180']){
            const v=await view('melissa_'+name);
            v.items['MEL_'+name+'_request_r1-1-out'].property.variableId='__ci_request';
            for(const action of v.items['MEL_'+name+'_occupied_r1-1-out'].property.actions)action.variableId='__ci_request';
            await run('UPDATE views SET value=? WHERE name=?',[JSON.stringify(v),v.id]);
        }
        const robot=await view('melissa_r1');robot.items.MEL_r1_handshake.property.options.rows[0].cells[7].variableId='__ci_sscc';
        await run('UPDATE views SET value=? WHERE name=?',[JSON.stringify(robot),robot.id]);
        const station=await view('melissa_station_r1-1-out');station.items['MEL_station_r1-1-out_field_SSCC'].property.variableId='__ci_sscc';
        await run('UPDATE views SET value=? WHERE name=?',[JSON.stringify(station),station.id]);
    }finally{await new Promise(resolve=>db.close(resolve));}
}
async function watermark(page){await page.evaluate(()=>{const n=document.createElement('div');n.textContent='SYNTHETIC CI DATA · NOT PLC';n.style='position:fixed;top:0;right:0;z-index:9999999;padding:6px 10px;background:#ffe6a3;color:#594215;font:13px Segoe UI';document.body.appendChild(n);});}
async function main(){
    const out=path.resolve('artifacts/melissa-qa');outputDirectory=out;fs.mkdirSync(out,{recursive:true});
    const root=process.env.MELISSA_PACKAGE;if(!root)throw new Error('MELISSA_PACKAGE is required');
    const project=JSON.parse(fs.readFileSync(path.join(root,'examples/melissa/Melissa_CPLC.fuxap')));
    assert.equal(project.devices['melissa-cplc'].type,'OPCUA');assert.deepEqual(project.devices['melissa-cplc'].tags,{});
    assert.ok(Object.values(project.devices).every(d=>!d.enabled));
    await seedBindingFixture(root);
    const log=fs.openSync(path.join(out,'fuxa-runtime.log'),'w');
    serverProcess=spawn(path.join(root,'node.exe'),['server/main.js','--userDir',path.join(root,'data'),'--port','1881'],{cwd:root,windowsHide:true,stdio:['ignore',log,log]});fs.closeSync(log);
    let ready=false;
    for(let i=0;i<90;i++){
        if(serverProcess.exitCode!==null)throw new Error('Isolated FUXA exited');
        try{if((await fetch('http://127.0.0.1:1881/api/melissa/snapshot')).ok){ready=true;break;}}catch(_){}
        await new Promise(r=>setTimeout(r,500));
    }
    assert.ok(ready,'FUXA did not become ready');
    const loaded=await(await fetch('http://127.0.0.1:1881/api/project')).json();
    assert.ok(loaded.devices?.['0']?.tags?.__ci_request,'native internal fixture tags must be present in the runtime project');
    fs.writeFileSync(path.join(out,'fixture-summary.json'),JSON.stringify({internalTagIds:Object.keys(loaded.devices['0'].tags),productionDevices:Object.values(loaded.devices).filter(d=>d.id!=='0').map(d=>({id:d.id,enabled:d.enabled}))},null,2));
    browser=await chromium.launch({headless:true});
    const page=await browser.newPage({viewport:{width:1920,height:1080}}),errors=[];
    diagnosticPage=page;
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto('http://127.0.0.1:1881/home');
    const overview=project.hmi.views.find(v=>v.id==='melissa_overview');
    await page.waitForSelector('#MEL_overview_rotation',{timeout:45000});await page.waitForTimeout(400);
    await watermark(page);
    await page.waitForFunction(()=>getComputedStyle(document.querySelector('#MEL_overview_request_r1-1-out path')).fill==='rgb(255, 211, 91)');
    assert.equal(await page.locator('#MEL_overview_occupied_r1-1-out').isVisible(),true,'native Occupied action must show the synthetic pallet');
    assert.equal(await page.locator('iframe').count(),0,'HMI must contain no iframes');
    assert.ok(await page.locator('[type="svg-ext-shapes"]').count()>100);
    const bounds=await page.locator('#MEL_overview_layout_panel').boundingBox();
    assert.ok(bounds.x>=0&&bounds.x+bounds.width<=1921&&bounds.y+bounds.height<=1081,'native layout must fit 1080p');
    await page.screenshot({path:path.join(out,'native-overview.png')});
    const geometry=async(p,prefix)=>p.evaluate(prefix=>{
        const panel=document.getElementById(prefix+'layout_panel'),svg=panel.ownerSVGElement,origin=svg.getBoundingClientRect(),scale=svg.getScreenCTM().a;
        return Object.fromEntries([...document.querySelectorAll('[id^="'+prefix+'"]')].filter(e=>e.hasAttribute('type')&&e.getBoundingClientRect().width).map(e=>{
            const b=e.getBoundingClientRect();return [e.id,{x:(b.x-origin.x)/scale,y:(b.y-origin.y)/scale,w:b.width/scale,h:b.height/scale}];
        }));
    },prefix);
    const beforeEditor=await geometry(page,'MEL_overview_');
    const checkAgvImage=async(p,prefix)=>{
        const count=await p.locator('[id^="'+prefix+'open_buffer_"] image').evaluateAll(async images=>{
            const sources=images.map(image=>image.href.baseVal);
            await Promise.all(sources.map(async source=>{
                if(!source.startsWith('data:image/'))throw new Error('AGV graphic lost its embedded source');
                const img=new Image();img.src=source;await img.decode();
            }));
            return sources.length;
        });
        assert.equal(count,1,'AGV graphic must remain on the layout');
    };
    await checkAgvImage(page,'MEL_overview_');
    const clickTarget=async target=>{
        const items=Object.values(overview.items).filter(i=>i.property.events?.some(e=>e.actparam==='melissa_'+target));
        const item=items.find(i=>i.id.includes('_request_'))||items[0];
        assert.ok(item,'Missing native navigation '+target);await page.locator('#'+item.id).click();
    };
    for(const target of ['palomat_5','palomat_1','eidos_popup','station_r1-1-out']){
        await clickTarget(target);await page.waitForSelector('app-fuxa-view-dialog');
        const view=project.hmi.views.find(v=>v.id==='melissa_'+target);
        await page.waitForSelector('#'+Object.keys(view.items)[0]);
        if(target==='station_r1-1-out')await page.waitForFunction(value=>document.getElementById('MEL_station_r1-1-out_field_SSCC')?.textContent===value,syntheticSscc);
        assert.equal(await page.locator('app-fuxa-view-dialog iframe').count(),0);
        await page.screenshot({path:path.join(out,'native-'+target+'.png')});
        await page.locator('.dialog-modal-close i').last().click();await page.waitForSelector('app-fuxa-view-dialog',{state:'detached'});
    }
    await page.locator('#MEL_overview_rotation').click();await page.waitForSelector('#MEL_overview_180_rotation');
    const upright=await page.locator('#home svg text').evaluateAll(elements=>elements.filter(e=>e.textContent.trim()&&e.getBBox().width).every(e=>{const m=e.getScreenCTM();return m.a>0&&m.d>0;}));
    assert.equal(upright,true,'Rotated labels must remain upright');await page.screenshot({path:path.join(out,'native-overview-180.png')});
    const beforeEditor180=await geometry(page,'MEL_overview_180_');
    await page.locator('#MEL_overview_180_rotation').click();await page.waitForSelector('#MEL_overview_rotation');
    for(const item of project.hmi.layout.navigation.items){
        await page.locator('app-sidenav button').filter({hasText:item.text}).first().click();
        const view=project.hmi.views.find(v=>v.id===item.view);
        await page.waitForSelector('#'+Object.keys(view.items)[0]);await page.waitForTimeout(150);
        if(item.view==='melissa_r1')await page.waitForFunction(value=>document.getElementById('MEL_r1_handshake')?.textContent.includes(value),syntheticSscc);
        assert.equal(await page.locator('iframe').count(),0);
        await page.screenshot({path:path.join(out,item.view+'.png')});
    }
    const history=await(await fetch('http://127.0.0.1:1881/api/melissa/deliveries')).json();
    assert.equal(history.completionTarget,'wrapper');assert.equal(history.sourceConfigured,false);
    const touch=await browser.newContext({viewport:{width:1920,height:1080},hasTouch:true});
    const touchPage=await touch.newPage();touchPage.on('pageerror',e=>errors.push(e.message));
    await touchPage.goto('http://127.0.0.1:1881/home');await touchPage.waitForSelector('#MEL_overview_rotation');
    await watermark(touchPage);
    const palomat=Object.values(overview.items).find(i=>i.property.events?.some(e=>e.actparam==='melissa_palomat_1'));
    await touchPage.locator('#'+palomat.id).tap();await touchPage.waitForSelector('app-fuxa-view-dialog');
    assert.equal(await touchPage.locator('app-fuxa-view-dialog').count(),1,'one tap must open one native dialog');
    await touchPage.locator('.dialog-modal-close i').tap();await touchPage.waitForSelector('app-fuxa-view-dialog',{state:'detached'});
    await touchPage.locator('#MEL_overview_rotation').tap();await touchPage.waitForSelector('#MEL_overview_180_rotation');
    await touchPage.screenshot({path:path.join(out,'native-touch-180.png')});await touch.close();
    // Exercise the real editor, including the auto-save on switching views.
    const editor=await browser.newPage({viewport:{width:2560,height:1440}});diagnosticPage=editor;
    editor.on('pageerror',e=>errors.push(e.message));
    await editor.goto('http://127.0.0.1:1881/editor');
    await editor.waitForSelector('app-editor-views-list .view-item-text',{timeout:45000});
    await editor.waitForTimeout(600);
    const onboarding=editor.locator('app-onboarding-wizard .dialog-close-btn, dialog-onboarding-wizard .dialog-close-btn');
    if(await onboarding.count())await onboarding.click();
    const savedViews=new Map();
    editor.on('response',response=>{
        if(response.ok()&&new URL(response.url()).pathname==='/api/projectData'){
            const payload=response.request().postDataJSON();
            if(payload?.cmd==='set-view')savedViews.set(payload.data.id,payload.data);
        }
    });
    for(const pageId of ['overview','overview_180']){
        const view=project.hmi.views.find(v=>v.id==='melissa_'+pageId),prefix='MEL_'+pageId+'_';
        await editor.locator('app-editor-views-list .view-item-text').getByText(view.name,{exact:true}).click();
        await editor.waitForSelector('#svgcontent #'+prefix+'rotation');await editor.waitForTimeout(800);
        assert.equal(await editor.locator('app-editor-views-list .leftbar-item-active').count(),1,'only the selected view must be active');
        for(const key of ['request_r1-1-out','status_semolina']){
            const id=prefix+key;await editor.locator('#svgcontent #'+id).click();
            await editor.waitForFunction(name=>document.getElementById('gaugename')?.value===name,view.items[id].name);
        }
        await editor.locator('gauge-base button').click();await editor.waitForSelector('gauge-property');
        assert.ok(await editor.locator('gauge-property flex-head').count(),'native element properties must be accessible');
        await editor.locator('gauge-property .dialog-close-btn').click();await editor.waitForSelector('gauge-property',{state:'detached'});
        await editor.screenshot({path:path.join(out,'native-editor-'+pageId+'.png')});
    }
    await editor.locator('app-editor-views-list .view-item-text').getByText(overview.name,{exact:true}).click();
    for(const id of ['melissa_overview','melissa_overview_180']){
        const saved=savedViews.get(id)??await editor.waitForResponse(response=>response.ok()&&
            new URL(response.url()).pathname==='/api/projectData'&&response.request().postDataJSON()?.data?.id===id)
            .then(response=>response.request().postDataJSON().data);
        assert.ok(saved.svgcontent.includes('xlink:href="data:image/'),'Editor save must retain the AGV artwork for '+id);
    }
    await page.goto('http://127.0.0.1:1881/home');await page.waitForSelector('#MEL_overview_rotation');
    await page.waitForTimeout(600);await watermark(page);
    const afterEditor=await geometry(page,'MEL_overview_');
    for(const [id,before]of Object.entries(beforeEditor)){
        const after=afterEditor[id];assert.ok(after,'Element lost after editor save: '+id);
        for(const key of ['x','y','w','h'])assert.ok(Math.abs(before[key]-after[key])<1,'Editor changed geometry: '+id+' '+key+' '+before[key]+' -> '+after[key]);
    }
    await page.waitForFunction(()=>getComputedStyle(document.querySelector('#MEL_overview_request_r1-1-out path')).fill==='rgb(255, 211, 91)');
    assert.ok(await page.locator('#MEL_overview_occupied_r1-1-out').isVisible(),'Occupied binding must survive editor save');
    await checkAgvImage(page,'MEL_overview_');
    await page.screenshot({path:path.join(out,'native-overview-after-editor.png')});
    await page.locator('#MEL_overview_rotation').click();await page.waitForSelector('#MEL_overview_180_rotation');
    const afterEditor180=await geometry(page,'MEL_overview_180_');
    await checkAgvImage(page,'MEL_overview_180_');
    for(const [id,before]of Object.entries(beforeEditor180))for(const key of ['x','y','w','h'])assert.ok(Math.abs(before[key]-afterEditor180[id]?.[key])<1,'Editor changed rotated geometry: '+id+' '+key);
    await page.screenshot({path:path.join(out,'native-overview-180-after-editor.png')});
    assert.deepEqual(errors,[]);
    fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({status:'passed',native:true,iframes:0,screenViews:16,totalViews:project.hmi.views.length,protocol:'OPCUA',preselectedCplcTags:0,productionDevicesEnabled:false,syntheticNativeBindingTest:true,ssccLeadingZeroesPreserved:true,touchEmulation:true,editorSelectionTest:true,editorRoundTripGeometryPreserved:true,physicalTouchScreenValidation:false,plcValidation:false,editorBindingValidation:'Requires real server browse and user-selected tags'},null,2));
}
main().catch(async error=>{
    console.error(error);process.exitCode=1;
    if(diagnosticPage){
        try{await diagnosticPage.screenshot({path:path.join(outputDirectory,'failure.png')});
            const state=await diagnosticPage.evaluate(()=>({url:location.href,dialogs:document.querySelectorAll('app-fuxa-view-dialog').length,requestColor:document.querySelector('#MEL_overview_request_r1-1-out path')?.getAttribute('fill'),nativeElementCount:document.querySelectorAll('[type^="svg-ext-"]').length}));
            fs.writeFileSync(path.join(outputDirectory,'failure.json'),JSON.stringify(state,null,2));
        }catch(_){}
    }
}).finally(async()=>{
    if(browser)await browser.close();if(serverProcess){serverProcess.kill();await new Promise(r=>{if(serverProcess.exitCode!==null)r();else serverProcess.once('exit',r);});}
});
