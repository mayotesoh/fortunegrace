import fs from 'node:fs';
const token=(fs.readFileSync('.env','utf-8').match(/NOTION_TOKEN=(.+)/)||[])[1]?.trim();
const h={Authorization:'Bearer '+token,'Notion-Version':'2022-06-28','Content-Type':'application/json'};
const api=async(p,m,b)=>(await (await fetch('https://api.notion.com/v1/'+p,{method:(m||'GET').toUpperCase(),headers:h,body:b?JSON.stringify(b):undefined})).json());
const txt=v=>((v&&(v.title||v.rich_text))||[]).map(t=>t.plain_text).join('');
const DBS={
 '会員DB':'ca1b82cb-70c3-4995-b15b-362181c387cd',
 'FL占い師DB':'507fd75b-0aa9-4c48-a259-d05b6b211ea4',
 '講師DB':'30e98929-7ce1-4ea9-9cbe-a84a2e5e2180',
 '会員の声DB':'3a776a17-0aae-81e8-8abb-d889d401e589',
 'スコアDB':'3a776a17-0aae-80f5-9243-cab17a49a0d2',
 '参加記録DB':'3a776a17-0aae-8123-89ea-dbd65a7295e7',
 'Bブログ':'04e8f328-55ae-4e80-865a-b3f2b92798cb',
 'FLブログ':'de8681bc-1b4f-45ee-af77-dba5fcfefa52',
 '講座申込DB':'3a776a17-0aae-81d6-bd1e-db010c515032',
};
const KEY=/渋沢|春名|渼月/;
for(const [name,id] of Object.entries(DBS)){
  let cur,rows=[];
  do{ const r=await api(`databases/${id}/query`,'POST',{page_size:100,start_cursor:cur});
      if(r.object==='error'){console.log(`${name}: (アクセス不可)`);break;}
      rows.push(...r.results); cur=r.has_more?r.next_cursor:undefined; }while(cur);
  for(const p of rows){
    const vals=Object.entries(p.properties).map(([k,v])=>txt(v)).join(' ');
    if(KEY.test(vals)){
      const title=Object.values(p.properties).find(v=>v.type==='title');
      console.log(`【${name}】 ${txt(title)}  id=${p.id}`);
    }
  }
}
