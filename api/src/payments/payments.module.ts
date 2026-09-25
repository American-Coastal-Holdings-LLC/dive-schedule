import { PaymentAdminController } from './admin.controller';
import { Module } from '@nestjs/common';
import { PaymentsController, StripeWebhookController, LegalController, ClientPaymentController } from './payments.controller';
import { PaymentsService } from './payments.service';
@Module({controllers:[PaymentsController,StripeWebhookController,LegalController,ClientPaymentController,PaymentAdminController],providers:[PaymentsService]})
export class PaymentsModule {}
