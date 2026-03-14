export const toCompetition = (dto) => ({
  id: dto.idx,
  name: dto.compName,
  dateStart: dto.compDateStart,
  dateEnd: dto.compDateEnd,
  location: dto.location,
});

export const toRound = (dto) => ({
  id: dto.idx,
  competitionId: dto.compIdx,
  competitionName: dto.compName,
  eventName: dto.cubeEventName,
  roundName: dto.roundName,
  eventStart: dto.eventStart,
  eventEnd: dto.eventEnd,
  advance: dto.advance ?? null,
});

export const toConfirmedRegistration = (dto) => ({
  id: dto.id,
  competitionId: dto.competitionId,
  competitionName: dto.competitionName,
  name: dto.name,
  enName: dto.enName,
  cckId: dto.cckId,
  selectedEvents: Array.isArray(dto.selectedEvents) ? dto.selectedEvents : [],
  totalFee: dto.totalFee ?? 0,
  paymentStatus: dto.paymentStatus ?? '',
  registrationStatus: dto.registrationStatus ?? '',
  needRfCard: Boolean(dto.needRfCard),
});

export const toPlayerRoundInfo = (roundInfo) => {
  if (!roundInfo) return null;
  const roundGroupListRaw = Array.isArray(roundInfo.roundGroupList)
    ? roundInfo.roundGroupList
    : Array.isArray(roundInfo.roundGroup)
      ? roundInfo.roundGroup
      : [];

  return {
    idx: roundInfo.idx,
    compIdx: roundInfo.compIdx,
    compName: roundInfo.compName,
    cubeEventName: roundInfo.cubeEventName,
    roundName: roundInfo.roundName,
    eventStart: roundInfo.eventStart,
    eventEnd: roundInfo.eventEnd,
    roundGroupList: roundGroupListRaw.map((group) => String(group)).filter(Boolean),
  };
};

export const toPlayerGroupRow = (row, roundInfo) => ({
  idx: row.idx,
  roundIdx: row.round_idx,
  cckId: row.cck_id,
  group: row.group_name ?? row.group,
  round: toPlayerRoundInfo(roundInfo),
});
