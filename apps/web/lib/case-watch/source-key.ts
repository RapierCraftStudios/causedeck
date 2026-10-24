/** Message key for a status source id: next-intl keys cannot contain "." (nesting) or ":". */
export type SourceKey =
  | 'in_tn_chennai-district_case_status'
  | 'in_tn_madras-hc_chennai_case_status'
  | 'in_ka_karnataka-hc_bengaluru_case_status';

export const sourceKey = (id: string): SourceKey => id.replace(/[.:]/g, '_') as SourceKey;
