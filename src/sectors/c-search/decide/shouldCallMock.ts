export const LOCAL_HITS_THRESHOLD = 12;
export const CONFIDENCE_THRESHOLD = 0.5;

export function shouldCallMock(localCount: number, confidence: number): boolean {
  return localCount < LOCAL_HITS_THRESHOLD && confidence > CONFIDENCE_THRESHOLD;
}
