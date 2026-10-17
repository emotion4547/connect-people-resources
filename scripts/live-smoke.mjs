/**
 * Проверка живой системы только на чтение: вход под каждой тестовой ролью и вызов основных функций этапа 3 через API.
 * Показывает, что схема выложена, PostgREST видит функции, а права отказывают там, где должны.
 *   LIVE_ACCOUNTS=/путь/accounts.json node scripts/live-smoke.mjs
 */
import { readFileSync } from 'node:fs';
const env = Object.fromEntries(readFileSync('.env','utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i),l.slice(i+1).replace(/^"|"$/g,'')]}));
const URL=env.VITE_SUPABASE_URL, KEY=env.VITE_SUPABASE_PUBLISHABLE_KEY;
// Учётные записи: JSON {"director":["почта","пароль"], ...} в файле, путь в LIVE_ACCOUNTS. В репозитории паролей нет.
const acc=JSON.parse(readFileSync(process.env.LIVE_ACCOUNTS ?? '.live-accounts.json','utf8'));
const login=async(e,p)=>(await (await fetch(URL+'/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:KEY,'content-type':'application/json'},body:JSON.stringify({email:e,password:p})})).json()).access_token;
const call=async(tok,fn,args)=>{const r=await fetch(URL+'/rest/v1/rpc/'+fn,{method:'POST',headers:{apikey:KEY,authorization:'Bearer '+tok,'content-type':'application/json'},body:JSON.stringify(args)});const t=await r.text();return {status:r.status,body:t.slice(0,160)};};
const get=async(tok,path)=>{const r=await fetch(URL+'/rest/v1/'+path,{headers:{apikey:KEY,authorization:'Bearer '+tok}});return {status:r.status,body:(await r.text()).slice(0,120)};};
const org=(await (await fetch(URL+'/rest/v1/organizations?select=id&limit=1',{headers:{apikey:KEY,authorization:'Bearer '+await login(...acc.director)}})).json())[0].id;
const today=new Date().toISOString().slice(0,10), from=new Date(Date.now()-30*864e5).toISOString().slice(0,10);
const plan={
 director:[['analytics_compare',{_org_ids:[org],_from:from,_to:today}],['analytics_series',{_org_ids:[org],_from:from,_to:today,_bucket:'month'}],['bdr_report',{_org_ids:[org],_from:from,_to:today}],['payment_calendar',{_org_id:org,_from:today,_days:28}],['deal_funnel',{_org_id:org}],['document_registry',{_org_id:org}],['rotation_calendar',{_org_id:org,_from:today,_days:28}],['analytics_counters',{_org_ids:[org],_from:from,_to:today}],['analytics_by_client',{_org_ids:[org],_from:from,_to:today}],['my_permissions',{_org_id:org}]],
 sales:[['my_sales_day',{_org_id:org}],['deal_funnel',{_org_id:org}],['analytics_compare',{_org_ids:[org],_from:from,_to:today}]],
 site_manager:[['analytics_by_site',{_org_ids:[org],_from:from,_to:today}],['document_conflicts',{_org_id:org,_from:today,_to:today}],['rotation_calendar',{_org_id:org,_from:today,_days:7}]],
 recruiter:[['analytics_candidates',{_org_ids:[org],_from:from,_to:today}],['document_registry',{_org_id:org}]],
 accountant:[['bdr_report',{_org_ids:[org],_from:from,_to:today}],['payment_calendar',{_org_id:org,_from:today,_days:28}],['cash_balances',{_org_id:org,_date:today}],['analytics_counters',{_org_ids:[org],_from:from,_to:today}]],
};
for(const [role,calls] of Object.entries(plan)){const tok=await login(...acc[role]);for(const [fn,args] of calls){const r=await call(tok,fn,args);console.log(role.padEnd(13),fn.padEnd(22),r.status,r.status===200?'':r.body);}}
// отказы
const w=await login(...acc.worker);
for(const [fn,args] of [['bdr_report',{_org_ids:[org],_from:from,_to:today}],['analytics_compare',{_org_ids:[org],_from:from,_to:today}],['document_registry',{_org_id:org}]]){const r=await call(w,fn,args);console.log('worker(deny)'.padEnd(13),fn.padEnd(22),r.status, r.status===200?'!!! ДОСТУП':'');}
console.log('anon deals', (await get(KEY,'deals?select=id')).status, (await get(KEY,'deals?select=id')).body);
const cl=await login(...acc.client);
console.log('client dashboard', (await call(cl,'client_dashboard',{_client_id:(await (await fetch(URL+'/rest/v1/clients?select=id&name=eq.ТЕСТ Заказчик',{headers:{apikey:KEY,authorization:'Bearer '+cl}})).json())[0]?.id,_from:from,_to:today})).status);
