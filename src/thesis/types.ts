export interface RankItem {
  id: string;
  popularity: number;
  vector: number[];
  cohort?: string | null;
}
export interface UserContext {
  userVector: number[];
  cohort: string | null;
}
/** Contract every baseline and every future model implements; the eval harness drives this. */
export interface Ranker {
  name: string;
  rank(ctx: UserContext, candidates: RankItem[]): string[];
}
