'use strict';
// Upgrade owned artwork only. Device configuration, settings and history remain untouched.
const fs=require('fs'),path=require('path'),sqlite3=require('sqlite3');
async function prepare(options={}){
    const root=options.root||path.resolve(__dirname,'../../..'),data=options.dataDir||path.join(root,'data'),app=path.join(data,'_appdata');
    fs.mkdirSync(app,{recursive:true});
    const settings=path.join(app,'settings.js');
    if(!fs.existsSync(settings))fs.copyFileSync(path.join(root,'examples/melissa/settings.js'),settings);
    const file=path.join(app,'project.fuxap.db'),existing=fs.existsSync(file);
    const project=JSON.parse(fs.readFileSync(path.join(root,'examples/melissa/Melissa_CPLC.fuxap')));
    const db=new sqlite3.Database(file);
    const run=(sql,args=[])=>new Promise((resolve,reject)=>db.run(sql,args,e=>e?reject(e):resolve()));
    const all=(sql,args=[])=>new Promise((resolve,reject)=>db.all(sql,args,(e,rows)=>e?reject(e):resolve(rows)));
    const tables=['general','views','devices','devicesSecurity','texts','alarms','notifications','scripts','reports','locations'];
    let transaction=false,backup=null,changed=false;
    const owned=(view,id)=>{
        const items=Object.values(view?.items||{}),page=id.replace(/^melissa_/,'');
        return view?.id===id&&items.length===1&&items[0].id==='MELISSA_IFRAME_'+page&&
            items[0].type==='svg-ext-own_ctrl-iframe'&&items[0].property?.address==='/melissa/?page='+page+'&embed=1';
    };
    try{
        if(existing){
            const rows=await all('SELECT name,value FROM general WHERE name IN (?,?)',['name','layout']);
            const general=Object.fromEntries(rows.map(r=>[r.name,JSON.parse(r.value)]));
            const oldRows=await all('SELECT name,value FROM views'),oldViews=Object.fromEntries(oldRows.map(r=>[r.name,JSON.parse(r.value)]));
            if(general.name!==project.name||!owned(oldViews.melissa_overview,'melissa_overview')){
                console.log('Existing project is not an owned Melissa project; project and widgets preserved.');return {changed:false,recognized:false};
            }
            const layout=structuredClone(general.layout||{}),oldLayout=structuredClone(layout),updates=[];
            for(const view of project.hmi.views){
                const old=oldViews[view.id];
                if(old&&!owned(old,view.id))continue;
                if(JSON.stringify(old)!==JSON.stringify(view))updates.push(view);
            }
            layout.zoom='autoresize';layout.autoresize=true;
            const target=project.hmi.layout.navigation;
            layout.navigation={...layout.navigation,bkcolor:target.bkcolor,fgcolor:target.fgcolor,logo:target.logo};
            layout.navigation.items=(layout.navigation.items||[]).map(item=>{
                const template=target.items.find(d=>d.view===item.view);return template?{...item,text:template.text,icon:template.icon}:item;
            });
            for(const item of target.items)if(!layout.navigation.items.some(i=>i.view===item.view)&&(!oldViews[item.view]||owned(oldViews[item.view],item.view))){
                const before=item.view==='melissa_semolina'?layout.navigation.items.findIndex(i=>i.view==='melissa_buffer'):-1;
                layout.navigation.items.splice(before<0?layout.navigation.items.length:before,0,item);
            }
            layout.header={...layout.header,bkcolor:project.hmi.layout.header.bkcolor,fgcolor:project.hmi.layout.header.fgcolor};
            changed=updates.length>0||JSON.stringify(layout)!==JSON.stringify(oldLayout);
            if(changed){
                const dir=path.join(app,'backups');fs.mkdirSync(dir,{recursive:true});backup=path.join(dir,'melissa-artwork-'+Date.now()+'.json');
                fs.writeFileSync(backup,JSON.stringify({targetVersion:'0.3.0',views:Object.fromEntries(updates.map(v=>[v.id,oldViews[v.id]||null])),layout:oldLayout},null,2));
                await run('BEGIN IMMEDIATE');transaction=true;
                for(const view of updates)await run('INSERT OR REPLACE INTO views(name,value) VALUES(?,?)',[view.id,JSON.stringify(view)]);
                await run('INSERT OR REPLACE INTO general(name,value) VALUES(?,?)',['layout',JSON.stringify(layout)]);
            }
        }else{
            changed=true;await run('BEGIN');transaction=true;
            for(const table of tables)await run(`CREATE TABLE ${table} (name TEXT PRIMARY KEY,value TEXT${table==='devices'?',connection TEXT,cntid TEXT,cntpwd TEXT':''})`);
            for(const [name,value]of Object.entries(project)){
                if(name==='hmi'){
                    await run('INSERT INTO general VALUES(?,?)',['layout',JSON.stringify(value.layout)]);
                    for(const view of value.views)await run('INSERT INTO views VALUES(?,?)',[view.id,JSON.stringify(view)]);
                }else if(name==='devices'){
                    for(const d of Object.values(value))await run('INSERT INTO devices(name,value) VALUES(?,?)',[d.id,JSON.stringify(d)]);
                }else if(name==='server')await run('INSERT INTO devices(name,value) VALUES(?,?)',['server',JSON.stringify(value)]);
                else if(!tables.includes(name))await run('INSERT INTO general VALUES(?,?)',[name,JSON.stringify(value)]);
            }
        }
        if(transaction){await run('COMMIT');transaction=false;}
        const widgetDir=path.join(data,'_widgets');fs.mkdirSync(widgetDir,{recursive:true});
        for(const name of fs.readdirSync(path.join(root,'examples/melissa/widgets'))){
            const source=fs.readFileSync(path.join(root,'examples/melissa/widgets',name)),target=path.join(widgetDir,name);
            if(fs.existsSync(target)){
                const old=fs.readFileSync(target);if(old.equals(source))continue;
                const dir=path.join(app,'backups','widgets');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,Date.now()+'-'+name),old);
            }
            fs.writeFileSync(target,source);
        }
        console.log(existing?'Melissa artwork updated; devices, settings and history preserved.':'Melissa project prepared; all external devices disabled.');
        return {changed,recognized:true,backup};
    }catch(error){if(transaction)await run('ROLLBACK');throw error;}
    finally{await new Promise(resolve=>db.close(resolve));}
}
module.exports={prepare};
