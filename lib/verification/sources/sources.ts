// Configuration of source IDs
export enum SourceId {
  // Chain Sources should match the enum ChainType in flare-mcc library
  invalid = -1,
  BTC = 0,
  LTC = 1,
  DOGE = 2,
  XRP = 3,
  ALGO = 4,
}

/**
 * Returns source name for `sourceId`
 * @param sourceId
 * @returns
 */
export function getSourceName(sourceId: number) {
  if (sourceId == null || SourceId[sourceId] === undefined) {
    return null;
  }
  return SourceId[sourceId];
}

/**
 * Returns sourceId enum given either name or enum number.
 * Note: that function does not do any additional validity checks so it must be
 * called by user with correct (sensible) id number.
 * @param id
 * @returns
 */
export function toSourceId(id: any): SourceId {
  if (typeof id === "number") return id as SourceId;

  const sourceId = SourceId[id];

  if (sourceId === undefined) return SourceId.invalid;

  return sourceId as any as SourceId;
}
