import { ASSIGNMENT_API_ROLES } from './groupTables.js';

const normalizeGroupName = (groupName) => {
  const normalized = String(groupName ?? '').trim();
  return normalized || '-';
};

export const toGroupAssignments = (roleData) => {
  const groups = new Map();

  for (const role of ASSIGNMENT_API_ROLES) {
    const rows = Array.isArray(roleData[role]) ? roleData[role] : [];
    for (const row of rows) {
      const groupName = normalizeGroupName(row.group);
      let groupItem = groups.get(groupName);

      if (!groupItem) {
        groupItem = {
          group: groupName,
          competitor: [],
          judge: [],
          runner: [],
          scrambler: [],
        };
        groups.set(groupName, groupItem);
      }

      groupItem[role].push(row);
    }
  }

  return [...groups.values()].sort((a, b) => a.group.localeCompare(b.group, 'ko-KR'));
};
