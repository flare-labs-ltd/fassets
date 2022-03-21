// Configuration of source IDs
export enum SourceId {
   // Chain Sources should match the enum ChainType in flare-mcc library
   BTC = 0,
   LTC = 1,
   DOGE = 2,
   XRP = 3,
   ALGO = 4,
}

export function getSourceName(sourceId: number) {
   if(sourceId == null || SourceId[sourceId] === null) {
      return null;
   }
   return SourceId[sourceId];
}
