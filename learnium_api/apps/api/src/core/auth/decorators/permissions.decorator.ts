import { SetMetadata } from '@nestjs/common';

export type Permission =
  | 'users:read' | 'users:write' | 'users:delete'
  | 'personas:read' | 'personas:write' | 'personas:delete'
  | 'sessions:read' | 'sessions:write'
  | 'analytics:read'
  | 'llmops:read' | 'llmops:write'
  | 'files:delete'
  | 'leaderboard:read'
  | 'badges:read' | 'badges:write';

export const PERMISSIONS_KEY = 'permissions';
export const Permissions = (...perms: Permission[]) => SetMetadata(PERMISSIONS_KEY, perms);
