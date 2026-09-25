import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { CrewProfile } from '@prisma/client';
import { notFound, unprocessable, conflict } from '../common/api-error';
import { Identity } from '../auth/identity';
import { PrismaService } from '../db/prisma.service';
import { PLATFORM_DIRECTORY, PlatformDirectory } from '../platform/directory';
import { isSafePhoto } from '../domain/serialize';
import { UpdateCrewDto, CreateCrewDto } from './crew.dto';

// Crew roster = platform user identity (id/name/active) merged with this app's
// occupational crew-profile extension (certs/bio/photo/joined).
@Injectable()
export class CrewService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(PLATFORM_DIRECTORY) private readonly directory: PlatformDirectory,
  ) {}

  async list(identity: Identity) {
    const [users, profiles] = await Promise.all([
      this.directory.listUsers(identity.installationId),
      this.prisma.crewProfile.findMany({ where: { installationId: identity.installationId } }),
    ]);
    const byId = new Map<string, CrewProfile>(profiles.map((p) => [p.userId, p]));
    const crew = users.map((u) => {
      const p = byId.get(u.id);
      return {
        id: u.id,
        name: u.name,
        active: u.active,
        certifications: p?.certifications ?? '',
        bio: p?.bio ?? '',
        photo: p?.photo ?? '',
        joined: p?.joined ?? '',
      };
    });
    for (const p of profiles.filter(p => p.local)) crew.push({id:p.userId,name:p.name,active:p.active,certifications:p.certifications,bio:p.bio,photo:p.photo,joined:p.joined});
    return { crew: crew.map(c => ({...c, email: byId.get(c.id)?.email ?? '', loginEnabled: !byId.get(c.id)?.local})) };
  }

  async create(identity: Identity, dto: CreateCrewDto) {
    const name = dto.name.trim(), email = dto.email.trim().toLowerCase();
    if (!name) throw unprocessable('Diver name is required');
    return this.prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${identity.installationId}, 0))`;
      const existing = await tx.crewProfile.findFirst({where:{installationId:identity.installationId,email}});
      if (existing) throw conflict('A diver with this email is already on your team');
      const diver = await tx.crewProfile.create({data:{installationId:identity.installationId,userId:`crew_${randomUUID()}`,name,email,local:true,certifications:dto.certifications ?? '',joined:new Date().toISOString().slice(0,10)}});
      await tx.auditEvent.create({data:{installationId:identity.installationId,actorId:identity.userId,action:'crew.created',targetId:diver.userId}});
      return {crewMember:{id:diver.userId,name,email,active:true,loginEnabled:false,certifications:diver.certifications,bio:'',photo:'',joined:diver.joined}};
    });
  }

  async update(identity: Identity, userId: string, dto: UpdateCrewDto) {
    const member = await this.directory.getUser(identity.installationId, userId);
    const local = await this.prisma.crewProfile.findUnique({where:{installationId_userId:{installationId:identity.installationId,userId}}});
    if (!member && !local?.local) throw notFound('Crew member not found');
    if (dto.photo && !isSafePhoto(dto.photo)) {
      throw unprocessable('photo must be an image data URL');
    }
    const data = {
      certifications: dto.certifications,
      bio: dto.bio,
      photo: dto.photo,
      joined: dto.joined,
    };
    const profile = await this.prisma.crewProfile.upsert({
      where: { installationId_userId: { installationId: identity.installationId, userId } },
      create: {
        installationId: identity.installationId,
        userId,
        certifications: dto.certifications ?? '',
        bio: dto.bio ?? '',
        photo: dto.photo ?? '',
        joined: dto.joined ?? '',
      },
      update: Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)),
    });
    return {
      crewMember: {
        id: member?.id ?? userId,
        name: member?.name ?? local?.name,
        active: member?.active ?? local?.active,
        certifications: profile.certifications,
        bio: profile.bio,
        photo: profile.photo,
        joined: profile.joined,
      },
    };
  }
}
