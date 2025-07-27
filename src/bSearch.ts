export const insertPayment = (score: number, scores: number[]) => {
  if (scores.length === 0 || scores[scores.length - 1] <= score) {
    scores.push(score);
  } else {
    const i = binaryInsert(scores, score);
    scores.splice(i, 0, score);
  }
}

const binaryInsert = (arr: number[], val: number) => {
  let low = 0, high = arr.length;
  while (low < high) {
    let mid = (low + high) >> 1;
    if (arr[mid] < val) low = mid + 1;
    else high = mid;
  }
  return low;
}

export const countInRange = (min: number, max: number, scores: number[]) => {
  const lo = lowerBound(scores, min);
  const hi = upperBound(scores, max);
  return hi - lo;
}

export const lowerBound = (arr: number[], val: number) => {
  let low = 0, high = arr.length;
  while (low < high) {
    let mid = (low + high) >> 1;
    if (arr[mid] < val) low = mid + 1;
    else high = mid;
  }
  return low;
}

export const upperBound = (arr: number[], val: number) => {
  let low = 0, high = arr.length;
  while (low < high) {
    let mid = (low + high) >> 1;
    if (arr[mid] <= val) low = mid + 1;
    else high = mid;
  }
  return low;
}

export const getLength = (
  summary: number[],
  fromScore?: number,
  toScore?: number
) => {
  if (!fromScore || !toScore) {
    return summary?.length || 0;
  }

  return countInRange(fromScore, toScore, summary);
}
