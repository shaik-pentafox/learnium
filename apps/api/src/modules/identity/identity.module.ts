import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { UsersController } from './users/users.controller';
import { UsersService } from './users/users.service';
import { RolesController } from './roles/roles.controller';
import { ImportService, USER_IMPORT_QUEUE } from './import/import.service';
import { ImportProcessor } from './import/import.processor';

@Module({
  imports: [
    BullModule.registerQueue({ name: USER_IMPORT_QUEUE }),
  ],
  controllers: [UsersController, RolesController],
  providers: [UsersService, ImportService, ImportProcessor],
})
export class IdentityModule {}
