'use strict';
const assert=require('assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),sqlite3=require('sqlite3');
const {prepare}=require('../../tools/melissa/prepare-artwork');
async function database(data,action){
    const db=new sqlite3.Database(path.join(data,'_appdata/project.fuxap.db'));
    const run=(sql,args=[])=>new Promise((resolve,reject)=>db.run(sql,args,e=>e?reject(e):resolve()));
    const all=(sql,args=[])=>new Promise((resolve,reject)=>db.all(sql,args,(e,rows)=>e?reject(e):resolve(rows)));
    try{return await action(run,all);}finally{await new Promise(resolve=>db.close(resolve));}
}
describe('Melissa portable artwork upgrade',function(){
    let data;
    beforeEach(function(){data=fs.mkdtempSync(path.join(os.tmpdir(),'melissa-upgrade-'));});
    afterEach(function(){fs.rmSync(data,{recursive:true,force:true});});
    it('preserves edited native views, browsed OPC UA tags, credentials, custom views, settings and history; is idempotent',async function(){
        await prepare({dataDir:data});
        let savedDevice,savedCustom,savedLayout;
        await database(data,async(run,all)=>{
            const row=(await all('SELECT * FROM devices WHERE name=?',['melissa-cplc']))[0],d=JSON.parse(row.value);
            d.enabled=true;d.property.address='opc.tcp://test-host:4840';d.tags={'user-node':{id:'user-node',address:'ns=3;s=RealBrowseResult'}};savedDevice=JSON.stringify(d);
            await run('UPDATE devices SET value=?,cntid=?,cntpwd=? WHERE name=?',[savedDevice,'keep-user','keep-secret','melissa-cplc']);
            const view=JSON.parse((await all('SELECT value FROM views WHERE name=?',['melissa_overview']))[0].value);
            view.profile={width:1440,height:1050,bkcolor:'#0b1321ff'};
            Object.values(view.items).find(i=>i.type==='svg-ext-value').property.variableId='user-node';
            await run('UPDATE views SET value=? WHERE name=?',[JSON.stringify(view),view.id]);
            savedCustom=JSON.stringify({id:'custom',name:'Do not replace',items:{}});
            await run('INSERT INTO views VALUES(?,?)',['custom',savedCustom]);
            // A custom replacement using a managed ID must also survive.
            await run('UPDATE views SET value=? WHERE name=?',[JSON.stringify({id:'melissa_r6',items:{custom:{type:'custom'}}}),'melissa_r6']);
            await run('DELETE FROM views WHERE name=?',['melissa_semolina']);
            const layout=JSON.parse((await all('SELECT value FROM general WHERE name=?',['layout']))[0].value);
            layout.start='custom';layout.navigation.items=layout.navigation.items.filter(i=>i.view!=='melissa_semolina');
            layout.navigation.items.push({view:'custom',text:'Keep me',icon:'home'});layout.header.title='Keep title';savedLayout=layout;
            await run('UPDATE general SET value=? WHERE name=?',[JSON.stringify(layout),'layout']);
        });
        const settings=path.join(data,'_appdata/settings.js');fs.writeFileSync(settings,'// user settings');
        fs.mkdirSync(path.join(data,'_db'));fs.writeFileSync(path.join(data,'_db/history-sentinel'),'historical data');
        const result=await prepare({dataDir:data});assert.equal(result.changed,true);assert.ok(fs.existsSync(result.backup));
        const backup=JSON.parse(fs.readFileSync(result.backup));assert.deepEqual(backup.layout,savedLayout);
        await database(data,async(run,all)=>{
            const d=(await all('SELECT * FROM devices WHERE name=?',['melissa-cplc']))[0];
            assert.equal(d.value,savedDevice);assert.equal(d.cntid,'keep-user');assert.equal(d.cntpwd,'keep-secret');
            const views=Object.fromEntries((await all('SELECT * FROM views')).map(r=>[r.name,JSON.parse(r.value)]));
            assert.equal(views.melissa_overview.profile.width,1440);assert.ok(views.melissa_semolina);
            assert.equal(Object.values(views.melissa_overview.items).find(i=>i.type==='svg-ext-value').property.variableId,'user-node');
            assert.equal(JSON.stringify(views.custom),savedCustom);assert.equal(views.melissa_r6.items.custom.type,'custom');
            const layout=JSON.parse((await all('SELECT value FROM general WHERE name=?',['layout']))[0].value);
            assert.equal(layout.start,'custom');assert.equal(layout.header.title,'Keep title');assert.ok(layout.navigation.items.some(i=>i.text==='Keep me'));
        });
        assert.equal(fs.readFileSync(settings,'utf8'),'// user settings');
        assert.equal(fs.readFileSync(path.join(data,'_db/history-sentinel'),'utf8'),'historical data');
        assert.equal((await prepare({dataDir:data})).changed,false);
    });
    it('archives the legacy S7 configuration and replaces it with disabled OPC UA and empty browse tags',async function(){
        await prepare({dataDir:data});
        const old={id:'melissa-cplc',type:'SiemensS7',enabled:true,property:{address:'192.168.214.105',rack:0,slot:1},tags:{legacy:{id:'legacy',address:'DB100.DBX0.1'}}};
        const iframe={id:'melissa_overview',items:{MELISSA_IFRAME_overview:{id:'MELISSA_IFRAME_overview',type:'svg-ext-own_ctrl-iframe',property:{address:'/melissa/?page=overview&embed=1'}}}};
        await database(data,async(run)=>{
            await run('UPDATE devices SET value=?,cntid=?,cntpwd=? WHERE name=?',[JSON.stringify(old),'old-user','old-secret','melissa-cplc']);
            await run('UPDATE views SET value=? WHERE name=?',[JSON.stringify(iframe),'melissa_overview']);
        });
        const result=await prepare({dataDir:data});const backup=JSON.parse(fs.readFileSync(result.backup));
        assert.deepEqual(JSON.parse(backup.legacyCplc.value),old);assert.deepEqual(backup.views.melissa_overview,iframe);
        await database(data,async(run,all)=>{
            const row=(await all('SELECT * FROM devices WHERE name=?',['melissa-cplc']))[0],d=JSON.parse(row.value);
            assert.equal(d.type,'OPCUA');assert.equal(d.enabled,false);assert.deepEqual(d.tags,{});assert.equal(row.cntpwd,null);
            assert.equal(JSON.parse((await all('SELECT * FROM views WHERE name=?',['melissa_overview']))[0].value).property.melissaNativeVersion,2);
        });
    });
    it('backs up and repairs a build 11 overview while retaining bound OPC UA nodes and credentials',async function(){
        await prepare({dataDir:data});let old;
        await database(data,async(run,all)=>{
            old=JSON.parse((await all('SELECT value FROM views WHERE name=?',['melissa_overview']))[0].value);
            old.property.melissaNativeVersion=1;
            old.items['MEL_overview_request_r1-1-out'].property.variableId='real-user-tag';
            old.svgcontent='<svg><g id="MEL_overview_rotation" transform="translate(9999 9999)"/></svg>';
            await run('UPDATE views SET value=? WHERE name=?',[JSON.stringify(old),old.id]);
            const device=JSON.parse((await all('SELECT value FROM devices WHERE name=?',['melissa-cplc']))[0].value);
            device.tags={'real-user-tag':{id:'real-user-tag',address:'ns=3;s=SelectedByUser'}};
            await run('UPDATE devices SET value=?,cntpwd=? WHERE name=?',[JSON.stringify(device),'preserved-password',device.id]);
        });
        const result=await prepare({dataDir:data});assert.ok(result.changed);
        assert.deepEqual(JSON.parse(fs.readFileSync(result.backup)).views.melissa_overview,old);
        await database(data,async(run,all)=>{
            const view=JSON.parse((await all('SELECT value FROM views WHERE name=?',['melissa_overview']))[0].value);
            assert.equal(view.property.melissaNativeVersion,2);assert.ok(view.svgcontent.includes('Layer 1'));assert.ok(!view.svgcontent.includes('translate(9999 9999)'));
            assert.equal(view.items['MEL_overview_request_r1-1-out'].property.variableId,'real-user-tag');
            const device=(await all('SELECT * FROM devices WHERE name=?',['melissa-cplc']))[0];
            assert.ok(JSON.parse(device.value).tags['real-user-tag']);assert.equal(device.cntpwd,'preserved-password');
        });
        assert.equal((await prepare({dataDir:data})).changed,false);
    });
    it('leaves a different project unchanged',async function(){
        await prepare({dataDir:data});
        await database(data,run=>run('UPDATE general SET value=? WHERE name=?',[JSON.stringify('Another project'),'name']));
        const file=path.join(data,'_appdata/project.fuxap.db'),before=fs.readFileSync(file);
        assert.equal((await prepare({dataDir:data})).recognized,false);assert.ok(fs.readFileSync(file).equals(before));
    });
});
