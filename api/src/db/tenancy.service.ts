import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from './prisma.service';

// Per-installation cascade delete, exercised by the installation.uninstalled
// webhook. Every table carries installationId, so deletion is one transaction.
@Injectable()
export class TenancyService {
  private readonly logger = new Logger('TenancyService');

  constructor(private readonly prisma: PrismaService) {}

  async deleteInstallation(installationId: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.serviceRecord.deleteMany({ where: { installationId } }),
      this.prisma.job.deleteMany({ where: { installationId } }),
      this.prisma.checklistQuestion.deleteMany({ where: { installationId } }),
      this.prisma.inventoryItem.deleteMany({ where: { installationId } }),
      this.prisma.ledgerEntry.deleteMany({ where: { installationId } }),
      this.prisma.crewProfile.deleteMany({ where: { installationId } }),
      this.prisma.installationSettings.deleteMany({ where: { installationId } }),
      this.prisma.installation.deleteMany({ where: { id: installationId } }),
    ]);
    this.logger.warn(`Installation ${installationId} data fully deleted (uninstall cascade).`);
  }
}
