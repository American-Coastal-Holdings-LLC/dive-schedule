import { Injectable } from '@nestjs/common';
import { ChecklistQuestion } from '@prisma/client';
import { notFound } from '../common/api-error';
import { Identity } from '../auth/identity';
import { PrismaService } from '../db/prisma.service';
import { CreateChecklistDto } from './checklist.dto';

function serialize(q: ChecklistQuestion) {
  return { id: q.id, text: q.text, ord: q.ord };
}

@Injectable()
export class ChecklistService {
  constructor(private readonly prisma: PrismaService) {}

  async list(identity: Identity) {
    const questions = await this.prisma.checklistQuestion.findMany({
      where: { installationId: identity.installationId },
      orderBy: [{ ord: 'asc' }],
    });
    return { questions: questions.map(serialize) };
  }

  async create(identity: Identity, dto: CreateChecklistDto) {
    const last = await this.prisma.checklistQuestion.findFirst({
      where: { installationId: identity.installationId },
      orderBy: { ord: 'desc' },
    });
    const question = await this.prisma.checklistQuestion.create({
      data: {
        installationId: identity.installationId,
        text: dto.text,
        ord: (last?.ord ?? -1) + 1,
      },
    });
    return { question: serialize(question) };
  }

  async remove(identity: Identity, id: string) {
    const existing = await this.prisma.checklistQuestion.findFirst({
      where: { id, installationId: identity.installationId },
    });
    if (!existing) throw notFound('Checklist question not found');
    await this.prisma.checklistQuestion.delete({ where: { id: existing.id } });
    return { ok: true };
  }
}
