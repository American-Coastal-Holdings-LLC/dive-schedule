// HTTP regression checks against a dev-stub API started on a disposable test DB.
const assert=require('node:assert/strict');
const {ALL_PERMISSIONS}=require('../../api/dist/auth/permissions');
const origin=process.env.TEST_API_URL||'http://127.0.0.1:4310';
const token=(user,installationId='inst_demo',permissions=ALL_PERMISSIONS)=>'devtoken.'+Buffer.from(JSON.stringify({sub:user,name:user,tenantId:'tenant_demo',installationId,permissions})).toString('base64url');
async function req(path,user,method='GET',body){return fetch(origin+path,{method,headers:{...(user?{Authorization:`Bearer ${token(user)}`} : {}),'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});}
(async()=>{
 assert.equal((await req('/healthz')).status,200);
 assert.equal((await req('/api/admin/payments')).status,401);
 for(const [path,method,body] of [['/api/admin/payments','GET'],['/api/admin/payments/stripe/connect','POST'],['/api/admin/payments/policies','POST',{}],['/api/admin/payments/venmo','POST',{}]]){
 const r=await req(path,'usr_employee',method,body);assert.equal(r.status,403,`${method} ${path} denies employee`);
 }
 const owner=await req('/api/admin/payments','usr_dana');assert.equal(owner.status,200);const j=await owner.json();assert.equal(j.paypalSealed,undefined);
 const me=await (await req('/api/me','usr_employee')).json();assert.equal(me.paymentAdmin,false);
 const meOwner=await (await req('/api/me','usr_dana')).json();assert.equal(meOwner.paymentAdmin,true);
 assert.equal((await req('/api/admin/payments/stripe/callback?state=invalid&code=invalid')).status,403);
 assert.equal((await req('/webhooks/stripe',null,'POST',{})).status,400);
 console.log('11 HTTP payment access and health checks passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
