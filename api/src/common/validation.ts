import { registerDecorator, ValidationOptions } from 'class-validator';
import { parseCivil, fmtCivil } from '../domain/dates';
export function CivilDate(options?: ValidationOptions) {
  return (object: object, propertyName: string) => registerDecorator({ name: 'civilDate', target: object.constructor,
    propertyName, options, validator: {
      validate: (v: unknown) => v === '' || (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !!parseCivil(v) && fmtCivil(parseCivil(v)!) === v),
      defaultMessage: () => `${propertyName} must be a real YYYY-MM-DD date`,
    } });
}
