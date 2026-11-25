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
    it('updates old managed views while preserving enabled devices, credentials, custom views, settings and history; is idempotent',async function(){
        await prepare({dataDir:data});
        let savedDevice,savedCustom,savedLayout;
        await database(data,async(run,all)=>{
            const row=(await all('SELECT * FROM devices WHERE name=?',['melissa-cplc']))[0],d=JSON.parse(row.value);
            d.enabled=true;d.property.address='test-host';savedDevice=JSON.stringify(d);
            await run('UPDATE devices SET value=?,cntid=?,cntpwd=? WHERE name=?',[savedDevice,'keep-user','keep-secret','melissa-cplc']);
            const view=JSON.parse((await all('SELECT value FROM views WHERE name=?',['melissa_overview']))[0].value);
            view.profile={width:1440,height:1050,bkcolor:'#0b1321ff'};
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
            assert.equal(views.melissa_overview.profile.width,1740);assert.ok(views.melissa_semolina);
            assert.equal(JSON.stringify(views.custom),savedCustom);assert.equal(views.melissa_r6.items.custom.type,'custom');
            const layout=JSON.parse((await all('SELECT value FROM general WHERE name=?',['layout']))[0].value);
            assert.equal(layout.start,'custom');assert.equal(layout.header.title,'Keep title');assert.ok(layout.navigation.items.some(i=>i.text==='Keep me'));
        });
        assert.equal(fs.readFileSync(settings,'utf8'),'// user settings');
        assert.equal(fs.readFileSync(path.join(data,'_db/history-sentinel'),'utf8'),'historical data');
        assert.equal((await prepare({dataDir:data})).changed,false);
    });
    it('leaves a different project unchanged',async function(){
        await prepare({dataDir:data});
        await database(data,run=>run('UPDATE general SET value=? WHERE name=?',[JSON.stringify('Another project'),'name']));
        const file=path.join(data,'_appdata/project.fuxap.db'),before=fs.readFileSync(file);
        assert.equal((await prepare({dataDir:data})).recognized,false);assert.ok(fs.readFileSync(file).equals(before));
    });
});
