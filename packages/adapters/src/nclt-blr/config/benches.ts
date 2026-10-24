// NCLT benches outside Bengaluru (#662, part 2 of #498): the forum codes the NCLT adapter also
// serves. The catalogue seed (packages/db/src/seed/forum-catalogue/tribunals.ts) lists the same
// codes; drt.test.ts keeps the two in step.
export const NCLT_BENCH_FORUM_CODES = [
  'in.nclt.new-delhi',
  'in.nclt.mumbai',
  'in.nclt.chennai',
  'in.nclt.kolkata',
  'in.nclt.ahmedabad',
  'in.nclt.hyderabad',
  'in.nclt.allahabad',
  'in.nclt.chandigarh',
  'in.nclt.guwahati',
  'in.nclt.cuttack',
  'in.nclt.jaipur',
  'in.nclt.kochi',
  'in.nclt.indore',
  'in.nclt.amaravati',
] as const;
