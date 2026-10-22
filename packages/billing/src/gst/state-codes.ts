// GST state and union-territory codes (#253, #29). The first two digits of a GSTIN and the
// `place_of_supply_state_code` of a SaaS invoice. Same state on both sides is an intra-state
// supply (CGST + SGST); different states is inter-state (IGST). GSTIN validation itself lives in
// `../gstin` and is reused here, never duplicated.
import { InvalidGstinError, isValidGstin } from '../gstin';

/** Code to name, as notified by GSTN. `25` (Daman and Diu) was merged into `26` in 2020. */
export const GST_STATE_CODES: Readonly<Record<string, string>> = Object.freeze({
  '01': 'Jammu and Kashmir',
  '02': 'Himachal Pradesh',
  '03': 'Punjab',
  '04': 'Chandigarh',
  '05': 'Uttarakhand',
  '06': 'Haryana',
  '07': 'Delhi',
  '08': 'Rajasthan',
  '09': 'Uttar Pradesh',
  '10': 'Bihar',
  '11': 'Sikkim',
  '12': 'Arunachal Pradesh',
  '13': 'Nagaland',
  '14': 'Manipur',
  '15': 'Mizoram',
  '16': 'Tripura',
  '17': 'Meghalaya',
  '18': 'Assam',
  '19': 'West Bengal',
  '20': 'Jharkhand',
  '21': 'Odisha',
  '22': 'Chhattisgarh',
  '23': 'Madhya Pradesh',
  '24': 'Gujarat',
  '25': 'Daman and Diu',
  '26': 'Dadra and Nagar Haveli and Daman and Diu',
  '27': 'Maharashtra',
  '28': 'Andhra Pradesh (before reorganisation)',
  '29': 'Karnataka',
  '30': 'Goa',
  '31': 'Lakshadweep',
  '32': 'Kerala',
  '33': 'Tamil Nadu',
  '34': 'Puducherry',
  '35': 'Andaman and Nicobar Islands',
  '36': 'Telangana',
  '37': 'Andhra Pradesh',
  '38': 'Ladakh',
  '97': 'Other Territory',
});

export function isGstStateCode(code: string): boolean {
  return Object.hasOwn(GST_STATE_CODES, code);
}

/** The state code of a valid GSTIN (its first two digits). Throws `InvalidGstinError` otherwise. */
export function stateCodeFromGstin(gstin: string): string {
  if (!isValidGstin(gstin)) throw new InvalidGstinError();
  const code = gstin.trim().slice(0, 2);
  if (!isGstStateCode(code)) throw new InvalidGstinError('This GSTIN has an unknown state code.');
  return code;
}
