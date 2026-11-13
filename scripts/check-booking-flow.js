'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {bookingDate,bookingTime,validateSchedule}=require('../services/bookingSchedule');
assert.equal(bookingDate('February 29, 2026'),'');
assert.equal(bookingDate('February 29, 2028'),'2028-02-29');
assert.equal(bookingTime('9:00 am'),'09:00 AM');
assert(!validateSchedule('2026-11-14','09:10 AM',new Date('2026-11-13T00:00:00Z')));
assert(validateSchedule('2026-11-14','09:00 AM',new Date('2026-11-13T00:00:00Z')));
if(!process.argv.includes('--live')){console.log('Booking schedule checks passed. Use --live for isolated hosted integration.');process.exit(0);}
require('dotenv').config({quiet:true});
require('dotenv').config({path:'.secrets/supabase-publish.env',quiet:true});
process.env.SUPABASE_SERVICE_ROLE_KEY=process.env.SUPABASE_SEED_KEY;
process.env.PAULINA_ENV='production';
const {createClient}=require('@supabase/supabase-js');
const sb=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SEED_KEY,{auth:{persistSession:false}});
const delivered=[];
const email=require('../services/emailService');
for(const key of ['sendBookingConfirmation','sendCustomRequestDecision','sendStudioNotification']) email[key]=async x=>{delivered.push(key);return {sent:true,id:'stub',provider:'test'};};
email.getEmailConfig=()=>({configured:true,provider:'gmail',fromEmail:'test@example.com'});
const app=require('../server');
const server=app.listen(0,'127.0.0.1');
const marker='flow-check-'+crypto.randomBytes(8).toString('hex');
let userId,token;const refs=[];
async function call(route,method='GET',body,admin=false){const r=await fetch(`http://127.0.0.1:${server.address().port}${route}`,{method,headers:{'Content-Type':'application/json',...(admin?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};}
(async()=>{await new Promise(resolve=>server.once('listening',resolve));try{
assert.equal((await call('/api/health')).status,200);
assert.equal((await call('/api/bookings')).status,401);
const password=crypto.randomBytes(24).toString('hex');const emailAddress=marker+'@example.com';
let result=await sb.auth.admin.createUser({email:emailAddress,password,email_confirm:true,user_metadata:{role:'admin'}});if(result.error)throw result.error;userId=result.data.user.id;
result=await sb.auth.signInWithPassword({email:emailAddress,password});if(result.error)throw result.error;token=result.data.session.access_token;
assert.equal((await call('/api/bookings','GET',null,true)).status,403);
result=await sb.auth.admin.updateUserById(userId,{app_metadata:{role:'admin'}});if(result.error)throw result.error;
result=await sb.auth.signInWithPassword({email:emailAddress,password});token=result.data.session.access_token;
const date=new Date(Date.now()+86400000+28800000).toISOString().slice(0,10);
const payload={fullName:marker,email:emailAddress,age:25,serviceType:'Piercing',service:'Lobe',artist:marker,date,time:'9:00 AM',clientRequestId:crypto.randomBytes(24).toString('hex'),receiptFileName:'check.png',receiptImage:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='};
let r=await call('/api/send-booking-email','POST',payload);assert.equal(r.status,201,JSON.stringify(r));const ref=r.data.reference;refs.push(ref);
assert.equal((await call('/api/send-booking-email','POST',payload)).data.reference,ref);
assert.equal((await call('/api/send-booking-email','POST',{...payload,clientRequestId:crypto.randomBytes(24).toString('hex')})).status,409);
r=await call('/api/custom-requests','GET',null,true);assert.equal(r.status,200,JSON.stringify(r));let request=r.data.requests.find(x=>x.reference===ref);assert(request,'Atomic queue insert missing');
const receipt=request.receiptUrls?.[0];assert(receipt,'Receipt URL missing');assert.equal((await fetch(receipt)).status,200);
r=await call(`/api/custom-requests/${ref}/decision`,'POST',{decision:'accept'},true);assert.equal(r.status,200,JSON.stringify(r));
assert.equal((await call(`/api/custom-requests/${ref}/decision`,'POST',{decision:'accept'},true)).status,409);
r=await call('/api/bookings/status/'+payload.clientRequestId);assert.equal(r.data.booking.status,'confirmed');
assert.equal((await call('/api/bookings/'+ref,'PATCH',{time:'10:00 AM',notes:marker},true)).status,200);
r=await call('/api/custom-requests','GET',null,true);assert.equal(r.data.requests.find(x=>x.reference===ref).time,'10:00 AM');
assert.equal((await call('/api/bookings/'+ref,'PATCH',{status:'cancelled'},true)).status,200);
r=await call('/api/custom-requests','GET',null,true);assert.equal(r.data.requests.find(x=>x.reference===ref).status,'declined');
assert.equal((await call('/api/bookings/'+ref,'DELETE',null,true)).status,200);
assert.equal((await call('/api/bookings/'+ref,'DELETE',null,true)).status,404);
assert.equal(delivered.filter(x=>x==='sendBookingConfirmation').length,1);
console.log('Hosted integration passed: auth boundaries, submit, private receipt, atomic queue, retry, slot conflict, accept, duplicate decision, calendar edits, cancellation and deletion. Email mocked.');
}finally{
const {data}=await sb.from('bookings').select('reference').eq('full_name',marker);for(const row of data||[])if(!refs.includes(row.reference))refs.push(row.reference);
for(const ref of refs){await sb.from('bookings').delete().eq('reference',ref).eq('full_name',marker);await sb.from('notifications').delete().eq('reference',ref);for(const dir of ['receipts','references']){const {data:files}=await sb.storage.from('custom-requests').list(dir,{search:ref});if(files?.length)await sb.storage.from('custom-requests').remove(files.map(f=>dir+'/'+f.name));}}
if(userId)await sb.auth.admin.deleteUser(userId);server.close();
}})().catch(e=>{console.error(e);process.exitCode=1;});


