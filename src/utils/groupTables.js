export const PLAYER_GROUP_TABLES = [
  { role: 'competition', tableName: 'group_competition' },
  { role: 'judge', tableName: 'group_judge' },
  { role: 'runner', tableName: 'group_runner' },
  { role: 'scrambler', tableName: 'group_scrambler' },
];

export const resolvePlayerTableName = (role) => {
  const item = PLAYER_GROUP_TABLES.find((table) => table.role === role);
  return item?.tableName || null;
};
