export const GROUP_ASSIGNMENT_TABLE_NAME = 'group_assignment';

export const ASSIGNMENT_ROLE_CONFIGS = [
  { apiRole: 'competitor', dbRole: 'competitor', aliases: ['competitor'] },
  { apiRole: 'judge', dbRole: 'judge', aliases: ['judge'] },
  { apiRole: 'runner', dbRole: 'runner', aliases: ['runner'] },
  { apiRole: 'scrambler', dbRole: 'scrambler', aliases: ['scrambler'] },
];

export const ASSIGNMENT_API_ROLES = ASSIGNMENT_ROLE_CONFIGS.map((item) => item.apiRole);

export const normalizeAssignmentApiRole = (role) => {
  const normalized = String(role || '').trim().toLowerCase();
  const item = ASSIGNMENT_ROLE_CONFIGS.find((config) => config.aliases.includes(normalized));
  return item?.apiRole || null;
};

export const resolveDbRole = (role) => {
  const apiRole = normalizeAssignmentApiRole(role);
  const item = ASSIGNMENT_ROLE_CONFIGS.find((config) => config.apiRole === apiRole);
  return item?.dbRole || null;
};

export const resolveApiRoleFromDbRole = (dbRole) => {
  const normalized = String(dbRole || '').trim().toLowerCase();
  const item = ASSIGNMENT_ROLE_CONFIGS.find((config) => config.dbRole === normalized);
  return item?.apiRole || null;
};
