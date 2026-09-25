import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { createHash, randomBytes } from 'node:crypto';
import Stripe from 'stripe';
import { PrismaService } from '../db/prisma.service';
import { CurrentIdentity } from '../auth/current-identity.decorator';
import { Public } from '../auth/public.decorator';
import { Identity } from '../auth/identity';
import { RequirePermissions } from '../auth/require-permissions.decorator';
import { P } from '../auth/permissions';
import { requirePaymentOwner, seal, PaymentOwnerGuard } from './payment-settings';
import { POLICY_VERSION } from './payments.service';
import { unprocessable, forbidden } from '../common/api-error';
class PolicyDto {
 @IsString() @MinLength(2) @MaxLength(200) businessName!:string;
 @IsEmail() contactEmail!:string;
 @IsString() @MinLength(10) @MaxLength(10000) cancellationPolicy!:string;
 @IsString() @MinLength(10) @MaxLength(10000) refundPolicy!:string;
 @IsString() @MinLength(10) @MaxLength(10000) privacyRetention!:string;
 @IsIn([POLICY_VERSION]) approvedPolicyVersion!:string;
}
class PaypalDto {
 @IsString() @MinLength(10) @MaxLength(300) clientId!:string;
 @IsString() @MinLength(10) @MaxLength(300) clientSecret!:string;
 @IsString() @MinLength(5) @MaxLength(100) merchantId!:string;
}
@UseGuards(PaymentOwnerGuard)
@Controller('admin/payments')
export class PaymentAdminController {
 constructor(private readonly db:PrismaService){}
 @Get() @RequirePermissions(P.SETTINGS_MANAGE)
 async get(@CurrentIdentity() i:Identity){requirePaymentOwner(i);const s=await this.db.merchantSettings.findUnique({where:{installationId:i.installationId}});return {config:s?.config??{},paypalConnected:!!s?.paypalSealed,policyVersion:POLICY_VERSION,stripeSetupAvailable:!!(process.env.STRIPE_SECRET_KEY&&process.env.STRIPE_CONNECT_CLIENT_ID),paypalSetupAvailable:!!process.env.PAYMENT_ENCRYPTION_KEY};}
 @Post('policies') @RequirePermissions(P.SETTINGS_MANAGE)
 async policies(@CurrentIdentity() i:Identity,@Body() dto:PolicyDto){requirePaymentOwner(i);return this.db.$transaction(async tx=>{
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${i.installationId},0))`;
  const s=await tx.merchantSettings.findUnique({where:{installationId:i.installationId}});
  const old=s?.config as Record<string,string>??{};
  await tx.merchantSettings.upsert({where:{installationId:i.installationId},create:{installationId:i.installationId,config:{...dto}},update:{config:{...old,...dto}}});
  await tx.auditEvent.create({data:{installationId:i.installationId,actorId:i.userId,action:'payments.policies_approved',targetId:i.installationId,detail:{version:POLICY_VERSION}}});return {ok:true};
 });}
 @Post('stripe/connect') @RequirePermissions(P.SETTINGS_MANAGE)
 async connect(@CurrentIdentity() i:Identity){requirePaymentOwner(i);
  if(!process.env.STRIPE_CONNECT_CLIENT_ID||!process.env.PUBLIC_APP_URL)throw unprocessable('The hosting administrator must enable Stripe Connect first');
  const state=randomBytes(32).toString('base64url');
  await this.db.paymentSetupState.create({data:{hash:createHash('sha256').update(state).digest('hex'),installationId:i.installationId,ownerId:i.userId,expiresAt:new Date(Date.now()+10*60*1000)}});
  const url=new URL('https://connect.stripe.com/oauth/authorize');url.search=new URLSearchParams({response_type:'code',client_id:process.env.STRIPE_CONNECT_CLIENT_ID,scope:'read_write',state,redirect_uri:`${new URL(process.env.PUBLIC_APP_URL).origin}/api/admin/payments/stripe/callback`}).toString();return {url:url.toString()};
 }
 @Public() @Get('stripe/callback')
 async callback(@Query('state') state:string,@Query('code') code:string){
  if(!state||!code||!process.env.STRIPE_SECRET_KEY)throw forbidden('Invalid connection callback');
  const hash=createHash('sha256').update(state).digest('hex');
  const saved=await this.db.paymentSetupState.findUnique({where:{hash}});if(!saved||saved.expiresAt<new Date())throw forbidden('Connection request expired');
  // Consume state once before exchanging. A failed exchange requires starting again.
  const consumed=await this.db.paymentSetupState.deleteMany({where:{hash,expiresAt:{gt:new Date()}}});if(!consumed.count)throw forbidden('Connection request already used');
  let owners:Record<string,string[]>={};try{owners=JSON.parse(process.env.PAYMENT_OWNER_IDS_JSON||'{}');}catch{}
  if(!owners[saved.installationId]?.includes(saved.ownerId))throw forbidden('Owner access was revoked');
  const stripe=new Stripe(process.env.STRIPE_SECRET_KEY),token=await stripe.oauth.token({grant_type:'authorization_code',code});
  if(!token.stripe_user_id)throw unprocessable('Stripe account was not connected');
  const account=await stripe.accounts.retrieve(token.stripe_user_id);
  if(!account.charges_enabled)throw unprocessable('Finish Stripe account verification before connecting payments');
  await this.db.$transaction(async tx=>{
   await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${saved.installationId},0))`;
   const old=await tx.merchantSettings.findUnique({where:{installationId:saved.installationId}}),config={...(old?.config as Record<string,string>??{}),accountId:account.id};
   await tx.merchantSettings.upsert({where:{installationId:saved.installationId},create:{installationId:saved.installationId,config},update:{config}});
   await tx.auditEvent.create({data:{installationId:saved.installationId,actorId:saved.ownerId,action:'payments.stripe_connected',targetId:account.id}});
  });return {connected:true,message:'Stripe connected. Return to Dive Schedule owner setup to review your policies.'};
 }
 @Post('venmo') @RequirePermissions(P.SETTINGS_MANAGE)
 async paypal(@CurrentIdentity() i:Identity,@Body() dto:PaypalDto){requirePaymentOwner(i);
  const sealed=seal(dto);const base=process.env.PAYPAL_ENV==='live'?'https://api-m.paypal.com':'https://api-m.sandbox.paypal.com';
  const res=await fetch(`${base}/v1/oauth2/token`,{method:'POST',headers:{authorization:`Basic ${Buffer.from(`${dto.clientId}:${dto.clientSecret}`).toString('base64')}`,'content-type':'application/x-www-form-urlencoded'},body:'grant_type=client_credentials',signal:AbortSignal.timeout(10000)});
  if(!res.ok)throw unprocessable('PayPal could not verify those business API credentials');
  await this.db.merchantSettings.upsert({where:{installationId:i.installationId},create:{installationId:i.installationId,paypalSealed:sealed},update:{paypalSealed:sealed}});
  await this.db.auditEvent.create({data:{installationId:i.installationId,actorId:i.userId,action:'payments.venmo_configured',targetId:i.installationId}});
  return {ok:true};
 }
}
