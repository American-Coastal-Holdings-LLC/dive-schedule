import { Body, Controller, Get, Post, Param, Req, Headers, BadRequestException, type RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../auth/public.decorator';
import { CurrentIdentity } from '../auth/current-identity.decorator';
import { Identity } from '../auth/identity';
import { RequirePermissions } from '../auth/require-permissions.decorator';
import { P } from '../auth/permissions';
import { PaymentsService } from './payments.service';
@Controller('payments')
export class PaymentsController {
 constructor(private readonly payments:PaymentsService){}
 @Get(':recordId') @RequirePermissions(P.FINANCE_VIEW)
 status(@CurrentIdentity() i:Identity,@Param('recordId') id:string){return this.payments.status(i,id);}
 @Post(':recordId/link') @RequirePermissions(P.FINANCE_MANAGE)
 link(@CurrentIdentity() i:Identity,@Param('recordId') id:string){return this.payments.createLink(i,id);}
 @Post(':recordId/checkout') @RequirePermissions(P.FINANCE_MANAGE)
 checkout(@CurrentIdentity() i:Identity,@Param('recordId') id:string){return this.payments.checkout(i,id);}
}
@Public() @Controller('legal')
export class LegalController {
 constructor(private readonly payments:PaymentsService){}
 @Get(':installationId') get(@Param('installationId') id:string){return this.payments.legal(id);}
}
@Public() @Controller('webhooks')
export class StripeWebhookController {
 constructor(private readonly payments:PaymentsService){}
 @Post('stripe')
 async receive(@Req() req:RawBodyRequest<Request>,@Headers('stripe-signature') signature:string){
  if(!req.rawBody||!signature)throw new BadRequestException('Missing webhook signature');
  try{return await this.payments.webhook(req.rawBody,signature);}catch(e){
   if(e instanceof Error && e.name==='StripeSignatureVerificationError')throw new BadRequestException('Invalid signature');
   throw e;
  }
 }
}

@Public() @Controller('client-pay')
export class ClientPaymentController {
 constructor(private readonly payments:PaymentsService){}
 @Get(':token') info(@Param('token') token:string){return this.payments.publicInfo(token);}
 @Post(':token/stripe') stripe(@Param('token') token:string,@Body() body:{acceptedPolicyVersion?:string}){return this.payments.publicCheckout(token,body?.acceptedPolicyVersion??'');}
 @Post(':token/venmo/order') order(@Param('token') token:string,@Body() body:{acceptedPolicyVersion?:string}){return this.payments.venmoOrder(token,body?.acceptedPolicyVersion??'');}
 @Post(':token/venmo/capture') capture(@Param('token') token:string){return this.payments.venmoCapture(token);}
}
