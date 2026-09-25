import { unseal } from './payment-settings';
import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import Stripe from 'stripe';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../db/prisma.service';
import { Identity, hasPerm } from '../auth/identity';
import { P } from '../auth/permissions';
import { conflict, forbidden, notFound, unprocessable } from '../common/api-error';
import { instantToCivil } from '../domain/dates';

export const POLICY_VERSION = '2026-09-25';
export interface MerchantConfig {
  accountId: string; businessName: string; contactEmail: string;
  cancellationPolicy: string; refundPolicy: string; privacyRetention: string;
  approvedPolicyVersion: string;
}
@Injectable()
export class PaymentsService {
 constructor(private readonly db:PrismaService){}
 private stripe(){
  if(!process.env.STRIPE_SECRET_KEY) throw unprocessable('Client payments are not connected yet');
  return new Stripe(process.env.STRIPE_SECRET_KEY,{maxNetworkRetries:2,timeout:10000});
 }
 async config(installationId:string):Promise<MerchantConfig> {
  let all:Record<string,MerchantConfig>={};
  try{all=JSON.parse(process.env.STRIPE_MERCHANTS_JSON || '{}');}catch{throw unprocessable('Payment configuration is unavailable');}
  const saved=await this.db.merchantSettings.findUnique({where:{installationId}});
  const c=(saved?.config ?? all[installationId]) as MerchantConfig;
  if(!c || !/^acct_[a-zA-Z0-9]+$/.test(c.accountId) || !c.businessName?.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.contactEmail || '') || !c.cancellationPolicy?.trim() || !c.refundPolicy?.trim() || !c.privacyRetention?.trim() || c.approvedPolicyVersion!==POLICY_VERSION) throw unprocessable('The account owner must connect Stripe and approve the customer policies before payments can start');
  return c;
 }
 async legal(id:string){const c=await this.config(id);return {businessName:c.businessName,contactEmail:c.contactEmail,cancellationPolicy:c.cancellationPolicy,refundPolicy:c.refundPolicy,privacyRetention:c.privacyRetention,version:POLICY_VERSION};}
 async status(identity:Identity,recordId:string){
  const rec=await this.db.serviceRecord.findFirst({where:{id:recordId,installationId:identity.installationId}});
  if(!rec)throw notFound();
  let enabled=false;try{await this.config(identity.installationId);enabled=!!process.env.STRIPE_SECRET_KEY;}catch{}
  const payment=await this.db.clientPayment.findUnique({where:{installationId_recordId:{installationId:identity.installationId,recordId}}});
  return {enabled,status:payment?.status ?? 'unpaid',amountCents:payment?.amountCents,checkoutUrl:payment?.status==='pending'?payment.checkoutUrl:null};
 }
 async checkout(identity:Identity,recordId:string){
  if(!hasPerm(identity,P.JOBS_VIEW_PRICING))throw forbidden('Pricing access is required to create payment links');
  const config=await this.config(identity.installationId),stripe=this.stripe();
  const origin=new URL(process.env.PUBLIC_APP_URL || '');
  if(origin.protocol!=='https:')throw unprocessable('Secure customer payment URL is not configured');
  return this.db.$transaction(async tx=>{
   await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${identity.installationId}, 0))`;
   const rec=await tx.serviceRecord.findFirst({where:{id:recordId,installationId:identity.installationId}});
   if(!rec)throw notFound();
   const cents=new Prisma.Decimal(rec.price).mul(100).toDecimalPlaces(0).toNumber();
   if(!Number.isSafeInteger(cents)||cents<50)throw unprocessable('A payable service price of at least $0.50 is required');
   const where={installationId_recordId:{installationId:identity.installationId,recordId}};
   let payment=await tx.clientPayment.findUnique({where});
   if(payment && ['paid','refunded','partially_refunded'].includes(payment.status))throw conflict('This service has already been paid');
   if(payment?.paypalOrderId)throw conflict('A Venmo checkout is already open for this service. Complete that checkout before starting another.');
   if(payment?.sessionId){
    const session=await stripe.checkout.sessions.retrieve(payment.sessionId,{}, {stripeAccount:payment.stripeAccount});
    if(session.status==='open'&&session.url)return {url:session.url};
    if(session.status==='complete')throw conflict('Payment is processing; refresh payment status shortly');
    payment=await tx.clientPayment.update({where,data:{attempt:{increment:1},sessionId:null,checkoutUrl:null}});
   }
   if(!payment)payment=await tx.clientPayment.create({data:{installationId:identity.installationId,recordId,amountCents:cents,stripeAccount:config.accountId,policyVersion:POLICY_VERSION}});
   if(payment.amountCents!==cents||payment.stripeAccount!==config.accountId)throw conflict('Payment setup changed; ask the account owner to reconcile this invoice');
   const policyUrl=`${origin.origin}/legal?operation=${encodeURIComponent(identity.installationId)}`;
   const session=await stripe.checkout.sessions.create({mode:'payment',payment_method_types:['card'],
    line_items:[{price_data:{currency:'usd',unit_amount:cents,product_data:{name:`Hull cleaning — ${rec.boat || rec.site || 'Service'}`}},quantity:1}],
    ...(rec.customerEmail ? {customer_email:rec.customerEmail}:{}),
    metadata:{paymentId:payment.id,policyVersion:POLICY_VERSION},
    payment_intent_data:{metadata:{paymentId:payment.id}},
    consent_collection:{terms_of_service:'required'},
    custom_text:{terms_of_service_acceptance:{message:`I agree to the [service terms, privacy notice and refund policy](${policyUrl}).`}},
    success_url:`${origin.origin}/payment-result?result=received`,cancel_url:`${origin.origin}/payment-result?result=cancelled`,
   },{stripeAccount:config.accountId,idempotencyKey:`dive-${payment.id}-${payment.attempt}`});
   if(!session.url)throw unprocessable('Stripe did not return a checkout URL');
   await tx.clientPayment.update({where,data:{sessionId:session.id,checkoutUrl:session.url,status:'pending',provider:'stripe'}});
   await tx.auditEvent.create({data:{installationId:identity.installationId,actorId:identity.userId,action:'payment.link_created',targetId:payment.id,detail:{policyVersion:POLICY_VERSION}}});
   return {url:session.url};
  },{timeout:30000});
 }
 async createLink(identity:Identity,recordId:string){
  if(!hasPerm(identity,P.JOBS_VIEW_PRICING))throw forbidden('Pricing access is required to create payment links');
  const c=await this.config(identity.installationId);
  const rec=await this.db.serviceRecord.findFirst({where:{id:recordId,installationId:identity.installationId}});
  if(!rec)throw notFound();
  const amountCents=new Prisma.Decimal(rec.price).mul(100).toDecimalPlaces(0).toNumber();
  if(amountCents<50)throw unprocessable('Service price must be at least $0.50');
  const p=await this.db.clientPayment.upsert({where:{installationId_recordId:{installationId:identity.installationId,recordId}},
   create:{installationId:identity.installationId,recordId,amountCents,stripeAccount:c.accountId,policyVersion:POLICY_VERSION,publicToken:randomBytes(32).toString('base64url')},update:{}});
  const saved=p.publicToken?p:await this.db.clientPayment.update({where:{id:p.id},data:{publicToken:randomBytes(32).toString('base64url')}});
  const origin=new URL(process.env.PUBLIC_APP_URL||'');
  if(origin.protocol!=='https:')throw unprocessable('Secure payment URL is not configured');
  return {url:`${origin.origin}/pay/${saved.publicToken}`};
 }
 async publicPayment(token:string){
  if(!/^[A-Za-z0-9_-]{43}$/.test(token))throw notFound();
  const p=await this.db.clientPayment.findUnique({where:{publicToken:token}});if(!p)throw notFound();return p;
 }
 private customerIdentity(installationId:string):Identity{return {installationId,tenantId:'',userId:'customer-payment-link',name:'Customer',permissions:new Set([P.JOBS_VIEW_PRICING])};}
 async publicInfo(token:string){
  const p=await this.publicPayment(token),merchant=await this.legal(p.installationId);
  let paypalClientId:string|null=null;try{paypalClientId=(await this.paypalConfig(p.installationId)).clientId;}catch{}
  return {amountCents:p.amountCents,currency:p.currency,status:p.status,businessName:merchant.businessName,
   policyUrl:`/legal?operation=${encodeURIComponent(p.installationId)}`,policyVersion:p.policyVersion,paypalClientId,
   paypalSandbox:process.env.PAYPAL_ENV!=='live',stripeEnabled:!!process.env.STRIPE_SECRET_KEY};
 }
 async publicCheckout(token:string,accepted:string){const p=await this.publicPayment(token);if(accepted!==POLICY_VERSION)throw unprocessable('Accept the current policies first');return this.checkout(this.customerIdentity(p.installationId),p.recordId);}
 private async paypalConfig(id:string):Promise<{clientId:string;clientSecret:string;merchantId:string}>{
  let all:Record<string,{clientId:string;clientSecret:string;merchantId:string}>={};try{all=JSON.parse(process.env.PAYPAL_MERCHANTS_JSON||'{}');}catch{}
  const saved=await this.db.merchantSettings.findUnique({where:{installationId:id}});
  const c=saved?.paypalSealed?unseal(saved.paypalSealed):all[id];if(!c?.clientId||!c.clientSecret||!c.merchantId)throw unprocessable('Venmo is not connected for this operation');return c;
 }
 private async paypal(id:string,path:string,method='GET',body?:unknown,key?:string){
  const c=await this.paypalConfig(id),base=process.env.PAYPAL_ENV==='live'?'https://api-m.paypal.com':'https://api-m.sandbox.paypal.com';
  const auth=await fetch(`${base}/v1/oauth2/token`,{method:'POST',headers:{authorization:`Basic ${Buffer.from(`${c.clientId}:${c.clientSecret}`).toString('base64')}`,'content-type':'application/x-www-form-urlencoded'},body:'grant_type=client_credentials',signal:AbortSignal.timeout(10000)});
  if(!auth.ok)throw unprocessable('Venmo connection could not be verified');
  const token=await auth.json() as {access_token:string};
  const response=await fetch(`${base}${path}`,{method,headers:{authorization:`Bearer ${token.access_token}`,'content-type':'application/json',...(key?{'PayPal-Request-Id':key}:{}),Prefer:'return=representation'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw unprocessable('Venmo payment could not be completed. Please retry or contact the shop.');
  return response.json() as Promise<Record<string,any>>;
 }
 async venmoOrder(token:string,accepted:string){
  const p=await this.publicPayment(token);await this.config(p.installationId);if(accepted!==POLICY_VERSION)throw unprocessable('Accept the current policies first');
  return this.db.$transaction(async tx=>{
   await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${p.installationId}, 0))`;
   const current=await tx.clientPayment.findUniqueOrThrow({where:{id:p.id}});
   if(current.status!=='pending')throw conflict('Service has already been paid');
   if(current.paypalOrderId)return {id:current.paypalOrderId};
   if(current.sessionId){
    const stripe=this.stripe();const session=await stripe.checkout.sessions.retrieve(current.sessionId,{}, {stripeAccount:p.stripeAccount});
    if(session.status==='complete')throw conflict('Payment is already processing');
    if(session.status==='open')await stripe.checkout.sessions.expire(session.id,{}, {stripeAccount:p.stripeAccount});
   }
   const order=await this.paypal(p.installationId,'/v2/checkout/orders','POST',{intent:'CAPTURE',purchase_units:[{reference_id:p.id,custom_id:p.id,payee:{merchant_id:(await this.paypalConfig(p.installationId)).merchantId},amount:{currency_code:'USD',value:(p.amountCents/100).toFixed(2)}}]},`venmo-order-${p.id}`);
   if(typeof order.id!=='string')throw unprocessable('Venmo order was not created');
   await tx.clientPayment.update({where:{id:p.id},data:{provider:'venmo',paypalOrderId:order.id,sessionId:null,checkoutUrl:null}});
   await tx.auditEvent.create({data:{installationId:p.installationId,actorId:'customer-payment-link',action:'payment.terms_accepted',targetId:p.id,detail:{policyVersion:accepted,provider:'venmo'}}});
   return {id:order.id};
  },{timeout:45000});
 }
 async venmoCapture(token:string){
  const p=await this.publicPayment(token);
  if(p.status!=='pending')return {status:p.status};
  if(!p.paypalOrderId)throw conflict('No Venmo order is open');
  // Read first: supports retry after capture succeeds remotely but the local response is lost.
  let order=await this.paypal(p.installationId,`/v2/checkout/orders/${encodeURIComponent(p.paypalOrderId)}`);
  if(order.status!=='COMPLETED')order=await this.paypal(p.installationId,`/v2/checkout/orders/${encodeURIComponent(p.paypalOrderId)}/capture`,'POST',{},`venmo-capture-${p.id}`);
  const unit=order.purchase_units?.[0],capture=unit?.payments?.captures?.[0];
  if(order.status!=='COMPLETED'||capture?.status!=='COMPLETED')return {status:'pending'};
  if(unit?.custom_id!==p.id||unit?.payee?.merchant_id!==(await this.paypalConfig(p.installationId)).merchantId||capture.amount?.currency_code!=='USD'||!new Prisma.Decimal(capture.amount.value).mul(100).eq(p.amountCents))throw conflict('Venmo payment details do not match this service');
  await this.db.$transaction(async tx=>{
   const changed=await tx.clientPayment.updateMany({where:{id:p.id,status:'pending'},data:{status:'paid',paidAt:new Date(),paypalCaptureId:capture.id}});
   if(changed.count){await tx.ledgerEntry.create({data:{installationId:p.installationId,kind:'in',amount:new Prisma.Decimal(p.amountCents).div(100),date:instantToCivil(new Date(),'UTC')!,description:`Service payment ${p.recordId}`,category:'Venmo'}});await tx.auditEvent.create({data:{installationId:p.installationId,actorId:'paypal',action:'payment.received',targetId:p.id,detail:{captureId:capture.id}}});}
  });
  return {status:'paid'};
 }
 async webhook(body:Buffer,signature:string){
  if(!process.env.STRIPE_WEBHOOK_SECRET)throw unprocessable('Stripe webhook is not configured');
  const event=this.stripe().webhooks.constructEvent(body,signature,process.env.STRIPE_WEBHOOK_SECRET);
  return this.db.$transaction(async tx=>{
   await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`stripe:${event.id}`}, 0))`;
   if(await tx.webhookDelivery.findUnique({where:{id:`stripe:${event.id}`}}))return {received:true};
   if(event.type==='checkout.session.completed'||event.type==='checkout.session.async_payment_succeeded'){
    const session=event.data.object as Stripe.Checkout.Session;
    const p=await tx.clientPayment.findFirst({where:{sessionId:session.id,stripeAccount:event.account ?? ''}});
    if(!p && session.metadata?.paymentId)throw conflict('Payment record is not ready; retry webhook delivery');
    if(p && session.payment_status==='paid'){
     if(session.amount_total!==p.amountCents||session.currency!==p.currency||session.metadata?.paymentId!==p.id)throw conflict('Payment amount or reference does not match');
     // One payment state transition wins even if separate webhook events arrive together.
     const changed=await tx.clientPayment.updateMany({where:{id:p.id,status:'pending'},data:{status:'paid',paidAt:new Date(),paymentIntentId:typeof session.payment_intent==='string'?session.payment_intent:session.payment_intent?.id}});
     if(changed.count){
      await tx.ledgerEntry.create({data:{installationId:p.installationId,kind:'in',amount:new Prisma.Decimal(p.amountCents).div(100),date:instantToCivil(new Date(),'UTC')!,description:`Service payment ${p.recordId}`,category:'Stripe payment'}});
      await tx.auditEvent.create({data:{installationId:p.installationId,actorId:'stripe',action:'payment.received',targetId:p.id,detail:{eventId:event.id,consent:session.consent?.terms_of_service ?? 'unknown'}}});
     }
    }
   }
   if(event.type==='charge.refunded'){
    const charge=event.data.object as Stripe.Charge;
    const intent=typeof charge.payment_intent==='string'?charge.payment_intent:charge.payment_intent?.id;
    if(intent){
     await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`refund:${intent}`}, 0))`;
     const p=await tx.clientPayment.findFirst({where:{paymentIntentId:intent,stripeAccount:event.account ?? ''}});
     if(!p && charge.metadata?.paymentId)throw conflict('Original payment is not reconciled; retry refund delivery');
     if(p&&charge.amount_refunded>p.refundedCents){
      const delta=charge.amount_refunded-p.refundedCents;
      await tx.clientPayment.update({where:{id:p.id},data:{refundedCents:charge.amount_refunded,status:charge.amount_refunded>=p.amountCents?'refunded':'partially_refunded'}});
      await tx.ledgerEntry.create({data:{installationId:p.installationId,kind:'out',amount:new Prisma.Decimal(delta).div(100),date:instantToCivil(new Date(),'UTC')!,description:`Service refund ${p.recordId}`,category:'Stripe refund'}});
     }
    }
   }
   await tx.webhookDelivery.create({data:{id:`stripe:${event.id}`}});
   return {received:true};
  });
 }
}
