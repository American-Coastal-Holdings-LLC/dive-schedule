import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { IS_PUBLIC_KEY } from '../auth/public.decorator';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Identity, hasPerm } from '../auth/identity';
import { P } from '../auth/permissions';
import { forbidden, unprocessable } from '../common/api-error';
export function isPaymentOwner(i:Identity):boolean{
 let owners:Record<string,string[]>={};try{owners=JSON.parse(process.env.PAYMENT_OWNER_IDS_JSON||'{}');}catch{}
 return hasPerm(i,P.SETTINGS_MANAGE)&&Array.isArray(owners[i.installationId])&&owners[i.installationId].includes(i.userId);
}
export function requirePaymentOwner(i:Identity){if(!i||!isPaymentOwner(i))throw forbidden('Only the verified operation owner can configure payments');}
function key(){const k=Buffer.from(process.env.PAYMENT_ENCRYPTION_KEY||'','base64');if(k.length!==32)throw unprocessable('Secure payment credential storage must be configured by the hosting administrator');return k;}
export function seal(value:unknown){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key(),iv);const data=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);return [iv,cipher.getAuthTag(),data].map(x=>x.toString('base64')).join('.');}
export function unseal(value:string){const [iv,tag,data]=value.split('.').map(x=>Buffer.from(x,'base64'));const cipher=createDecipheriv('aes-256-gcm',key(),iv);cipher.setAuthTag(tag);return JSON.parse(Buffer.concat([cipher.update(data),cipher.final()]).toString('utf8'));}

@Injectable()
export class PaymentOwnerGuard implements CanActivate {
 canActivate(context:ExecutionContext){
  if((Reflect.getMetadata(IS_PUBLIC_KEY,context.getHandler()) ?? Reflect.getMetadata(IS_PUBLIC_KEY,context.getClass())))return true;
  requirePaymentOwner(context.switchToHttp().getRequest().identity);return true;
 }
}
