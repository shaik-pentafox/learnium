import type { Permission } from '../decorators/permissions.decorator';

export const ROLE_PERMISSIONS: Record<string, Permission[]> = {
  SUPER_ADMIN: [
    'users:read', 'users:write', 'users:delete',
    'personas:read', 'personas:write', 'personas:delete',
    'sessions:read', 'sessions:write',
    'analytics:read',
    'llmops:read', 'llmops:write',
    'files:delete',
    'leaderboard:read',
    'badges:read', 'badges:write',
  ],
  TRAINER: [
    'users:read',
    'personas:read', 'personas:write',
    'sessions:read', 'sessions:write',
    'analytics:read',
    'leaderboard:read',
    'badges:read',
  ],
  USER: [
    'personas:read',
    'sessions:read', 'sessions:write',
    'leaderboard:read',
    'badges:read',
  ],
};
