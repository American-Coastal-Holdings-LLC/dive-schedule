import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { CurrentIdentity } from '../auth/current-identity.decorator';
import { Identity } from '../auth/identity';
import { P } from '../auth/permissions';
import { RequirePermissions } from '../auth/require-permissions.decorator';
import { UpdateCrewDto, CreateCrewDto } from './crew.dto';
import { CrewService } from './crew.service';

@Controller('crew')
export class CrewController {
  constructor(private readonly crew: CrewService) {}

  @Get()
  @RequirePermissions(P.CREW_VIEW)
  list(@CurrentIdentity() identity: Identity) {
    return this.crew.list(identity);
  }

  @Post()
  @RequirePermissions(P.CREW_MANAGE)
  create(@CurrentIdentity() identity: Identity, @Body() dto: CreateCrewDto) {
    return this.crew.create(identity, dto);
  }

  @Patch(':userId')
  @RequirePermissions(P.CREW_MANAGE)
  update(
    @CurrentIdentity() identity: Identity,
    @Param('userId') userId: string,
    @Body() dto: UpdateCrewDto,
  ) {
    return this.crew.update(identity, userId, dto);
  }
}
