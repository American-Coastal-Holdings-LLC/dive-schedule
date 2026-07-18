import { Inject, Injectable } from '@nestjs/common';
import { CrewProfile } from '@prisma/client';
import { notFound, unprocessable } from '../common/api-error';
import { Identity } from '../auth/identity';
import { PrismaService } from '../db/prisma.service';
import { PLATFORM_DIRECTORY, PlatformDirectory } from '../platform/directory';
import { isSafePhoto } from '../domain/serialize';
import { UpdateCrewDto } from './crew.dto';

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
    return { crew };
  }

  async update(identity: Identity, userId: string, dto: UpdateCrewDto) {
    const member = await this.directory.getUser(identity.installationId, userId);
    if (!member) throw notFound('Crew member not found');
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
        id: member.id,
        name: member.name,
        active: member.active,
        certifications: profile.certifications,
        bio: profile.bio,
        photo: profile.photo,
        joined: profile.joined,
      },
    };
  }
}
