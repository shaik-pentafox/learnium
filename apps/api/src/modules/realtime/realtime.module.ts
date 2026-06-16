import { Module } from '@nestjs/common';
import { ChatGateway } from './chat.gateway';
import { SessionRegistry } from './session-registry';

@Module({
  providers: [ChatGateway, SessionRegistry],
})
export class RealtimeModule {}
