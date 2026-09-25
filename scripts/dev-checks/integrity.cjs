// Run after API build and migrations against a disposable database only.
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {PrismaClient}=require('../../api/node_modules/@prisma/client');
const {JobsService}=require('../../api/dist/jobs/jobs.service');
const {FinanceService}=require('../../api/dist/finance/finance.service');
const {CrewService}=require('../../api/dist/crew/crew.service');
const {PaymentAdminController}=require('../../api/dist/payments/admin.controller');
const {PaymentsService,POLICY_VERSION}=require('../../api/dist/payments/payments.service');
const {P}=require('../../api/dist/auth/permissions');
const {isPaymentOwner,seal,unseal}=require('../../api/dist/payments/payment-settings');
const {parseCivil}=require('../../api/dist/domain/dates');
const {validate}=require('../../api/node_modules/class-validator');
const {plainToInstance}=require('../../api/node_modules/class-transformer');
const {CreateJobDto}=require('../../api/dist/jobs/jobs.dto');
const db=new PrismaClient();
const id=`test_${randomUUID()}`;
const owner={installationId:id,tenantId:'test',userId:'owner',name:'Owner',permissions:new Set(Object.values(P))};
const employee={...owner,userId:'employee'}; // Even an employee accidentally granted every app permission cannot change payment destinations.
const diver={...owner,userId:'diver',permissions:new Set([P.JOBS_VIEW_ASSIGNED,P.JOBS_COMPLETE])};
const directory={listUsers:async()=>[{id:'owner',name:'Owner',active:true},{id:'diver',name:'Diver',active:true}],getUser:async()=>null};
const tenant={getProfile:async()=>({timezone:'America/Los_Angeles'})};
const logger={setContext(){}};
const jobs=new JobsService(db,directory,tenant,logger),finance=new FinanceService(db,directory,tenant),crew=new CrewService(db,directory),admin=new PaymentAdminController(db),payments=new PaymentsService(db);
let count=0;
async function check(name,fn){await fn();count++;console.log(`PASS ${name}`);}
async function rejected(fn,status){await assert.rejects(fn,e=>e.getStatus?.()===status);}
async function main(){
 process.env.PAYMENT_OWNER_IDS_JSON=JSON.stringify({[id]:['owner']});process.env.PAYMENT_ENCRYPTION_KEY=Buffer.alloc(32,42).toString('base64');
 await db.installation.create({data:{id,tenantId:'test'}});
 await check('owner needs both explicit owner identity and settings permission',async()=>{assert.equal(isPaymentOwner(owner),true);assert.equal(isPaymentOwner(employee),false);assert.equal(isPaymentOwner({...owner,permissions:new Set()}),false);assert.equal(isPaymentOwner({...owner,installationId:'other'}),false);});
 await check('employee cannot read settings or connect either provider even with all app permissions',async()=>{await rejected(()=>admin.get(employee),403);await rejected(()=>admin.connect(employee),403);await rejected(()=>admin.paypal(employee,{}),403);await rejected(()=>admin.policies(employee,{}),403);});
 await check('credentials encrypted and tampering rejected',async()=>{const value={clientSecret:'test-secret'};const encrypted=seal(value);assert(!encrypted.includes('test-secret'));assert.deepEqual(unseal(encrypted),value);assert.throws(()=>unseal(encrypted.slice(0,-4)+'AAAA'));});
 await check('policy writes cannot replace stored Stripe account',async()=>{await db.merchantSettings.create({data:{installationId:id,config:{accountId:'acct_owner'}}});await admin.policies(owner,{businessName:'Test Business',contactEmail:'owner@example.com',cancellationPolicy:'Cancel before service starts.',refundPolicy:'Contact us about refunds.',privacyRetention:'Retain records as legally required.',approvedPolicyVersion:POLICY_VERSION});assert.equal((await admin.get(owner)).config.accountId,'acct_owner');});
 await check('invalid calendar dates rejected by DTO and domain',async()=>{assert.equal(parseCivil('2026-02-30'),null);assert((await validate(plainToInstance(CreateJobDto,{dueDate:'2026-02-30'}))).length>0);});
 let local;
 await check('add diver and reject duplicate email',async()=>{local=(await crew.create(owner,{name:'Local Diver',email:'diver@example.com'})).crewMember;assert.equal(local.loginEnabled,false);await rejected(()=>crew.create(owner,{name:'Again',email:'DIVER@example.com'}),409);});
 let job;
 await check('local divers can be assigned; foreign IDs rejected',async()=>{job=(await jobs.create(owner,{boat:'Test boat',price:100,dueDate:'2026-09-25',rotation:'monthly',assignedUserIds:[local.id,'diver']})).job;await rejected(()=>jobs.create(owner,{boat:'No',assignedUserIds:['foreign']}),422);});
 await check('stale job edit rejected',async()=>{await rejected(()=>jobs.update(owner,job.id,{notes:'stale',expectedUpdatedAt:'2000-01-01T00:00:00.000Z'}),409);});
 let record;const request={requestId:randomUUID(),occurrence:0,answers:[{q:'Hull condition',a:'Good'}]};
 await check('completion retry creates exactly one record',async()=>{const a=await jobs.complete(owner,job.id,request);record=a.record;const b=await jobs.complete(owner,job.id,request);assert.equal(a.record.id,b.record.id);assert.equal(await db.serviceRecord.count({where:{installationId:id}}),1);await rejected(()=>jobs.complete(owner,job.id,{...request,requestId:randomUUID()}),409);});
 await check('completion snapshots answers and pay; later rates do not alter earnings',async()=>{await finance.settingsPut(owner,{payRate:0.8});const r=await db.serviceRecord.findUnique({where:{id:record.id}});assert.equal(Number(r.payAmount),50);assert.equal(r.answers[0].a,'Good');});
 await check('completed checklist immutable',async()=>{await rejected(()=>jobs.setAnswers(owner,job.id,{answers:[]}),409);});
 await check('reopen retry advances only once; stale completion cannot complete next rotation',async()=>{const req={requestId:randomUUID(),occurrence:0};const a=await jobs.reopen(owner,job.id,req),b=await jobs.reopen(owner,job.id,req);assert.equal(a.job.occurrence,1);assert.equal(a.job.dueDate,b.job.dueDate);await rejected(()=>jobs.complete(owner,job.id,{...request,requestId:randomUUID()}),409);});
 await check('diver cannot backdate or attribute another employee',async()=>{await rejected(()=>jobs.complete(diver,job.id,{requestId:randomUUID(),occurrence:1,completedAt:'2026-01-01T00:00:00Z'}),403);await rejected(()=>jobs.complete(diver,job.id,{requestId:randomUUID(),occurrence:1,onBehalfOfUserId:local.id}),403);});
 const item=await db.inventoryItem.create({data:{installationId:id,name:'Anode',quantity:2,salePrice:20}});
 await check('POS rejects oversell and short cash, rolls stock back',async()=>{await rejected(()=>finance.posSale(owner,{requestId:randomUUID(),lines:[{itemId:item.id,amount:1,qty:3}],received:100}),422);await rejected(()=>finance.posSale(owner,{requestId:randomUUID(),lines:[{itemId:item.id,amount:1,qty:1}],received:1}),422);assert.equal((await db.inventoryItem.findUnique({where:{id:item.id}})).quantity,2);});
 await check('POS uses catalog price; retry writes once',async()=>{const dto={requestId:randomUUID(),lines:[{itemId:item.id,amount:1,qty:1}],received:30};const a=await finance.posSale(owner,dto),b=await finance.posSale(owner,dto);assert.equal(a.total,20);assert.equal(a.entry.id,b.entry.id);assert.equal((await db.inventoryItem.findUnique({where:{id:item.id}})).quantity,1);await rejected(()=>finance.posSale(owner,{...dto,received:40}),409);});
 await check('payment links require price access and cannot cross installations',async()=>{await rejected(()=>payments.createLink(diver,record.id),403);await rejected(()=>payments.status({...owner,installationId:'other'},record.id),404);});
 await check('unsigned Stripe webhook rejected before database mutation',async()=>{process.env.STRIPE_SECRET_KEY='sk_test_invalid';process.env.STRIPE_WEBHOOK_SECRET='whsec_test';await assert.rejects(()=>payments.webhook(Buffer.from('{}'),'invalid'));});
 await check('signed payment replay credits ledger once and refunds only the delta',async()=>{
  const Stripe=require('../../api/node_modules/stripe');const stripe=new Stripe('sk_test_invalid');
  const p=await db.clientPayment.create({data:{installationId:id,recordId:record.id,amountCents:10000,stripeAccount:'acct_owner',sessionId:'cs_'+id,policyVersion:POLICY_VERSION}});
  const send=async(type,object,eventId)=>{const body=JSON.stringify({id:eventId,type,account:'acct_owner',data:{object}});const sig=stripe.webhooks.generateTestHeaderString({payload:body,secret:'whsec_test'});return payments.webhook(Buffer.from(body),sig);};
  const session={id:p.sessionId,payment_status:'paid',amount_total:10000,currency:'usd',metadata:{paymentId:p.id},payment_intent:'pi_'+id,consent:{terms_of_service:'accepted'}};
  await send('checkout.session.completed',session,'evt_'+id);await send('checkout.session.completed',session,'evt_'+id);await send('checkout.session.completed',session,'evt_second_'+id);
  assert.equal(await db.ledgerEntry.count({where:{installationId:id,category:'Stripe payment'}}),1);
  await send('charge.refunded',{payment_intent:'pi_'+id,amount_refunded:2500},'evt_refund_'+id);
  await send('charge.refunded',{payment_intent:'pi_'+id,amount_refunded:10000},'evt_refund_full_'+id);
  await send('charge.refunded',{payment_intent:'pi_'+id,amount_refunded:2500},'evt_old_refund_'+id);
  const refunds=await db.ledgerEntry.findMany({where:{installationId:id,category:'Stripe refund'}});assert.equal(refunds.reduce((n,r)=>n+Number(r.amount),0),100);
  assert.equal((await db.clientPayment.findUnique({where:{id:p.id}})).status,'refunded');
  await db.webhookDelivery.deleteMany({where:{id:{contains:id}}});
 });
 console.log(`${count} integrity checks passed`);
}
main().finally(async()=>{for(const table of ['paymentSetupState','merchantSettings','clientPayment','operationReceipt','auditEvent','serviceRecord','job','crewProfile','inventoryItem','ledgerEntry','installationSettings'])await db[table].deleteMany({where:{installationId:id}});await db.installation.deleteMany({where:{id}});await db.$disconnect();}).catch(e=>{console.error(e);process.exitCode=1;});
