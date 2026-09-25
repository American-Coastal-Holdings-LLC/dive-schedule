import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';
@Injectable()
export class TenancyService {
 constructor(private readonly prisma:PrismaService){}
 async deleteInstallation(installationId:string,deliveryId:string):Promise<void>{
  await this.prisma.$transaction(async tx=>{
   await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${installationId}, 0))`;
   const key=`eos:${deliveryId}`;
   if(await tx.webhookDelivery.findUnique({where:{id:key}}))return;
   await tx.merchantSettings.deleteMany({where:{installationId}});
   await tx.paymentSetupState.deleteMany({where:{installationId}});
   await tx.clientPayment.deleteMany({where:{installationId}});
   await tx.operationReceipt.deleteMany({where:{installationId}});
   await tx.auditEvent.deleteMany({where:{installationId}});
   await tx.serviceRecord.deleteMany({where:{installationId}});
   await tx.job.deleteMany({where:{installationId}});
   await tx.checklistQuestion.deleteMany({where:{installationId}});
   await tx.inventoryItem.deleteMany({where:{installationId}});
   await tx.ledgerEntry.deleteMany({where:{installationId}});
   await tx.crewProfile.deleteMany({where:{installationId}});
   await tx.installationSettings.deleteMany({where:{installationId}});
   await tx.installation.upsert({where:{id:installationId},create:{id:installationId,tenantId:'',status:'uninstalled'},update:{status:'uninstalled',tenantId:''}});
   await tx.webhookDelivery.create({data:{id:key}});
  });
 }
}
