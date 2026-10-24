// eCourts orders page (#634): the "Orders" table (order number, order date, order details with a
// link to the order PDF), read with the same reader as the status page's orders.
import { readHtmlTables, readOrders } from '../status/html.ts';
import type { CaseStatusOrder } from '../status/types.ts';

export const ECOURTS_ORDER_COLUMNS = {
  date: /^order date$/,
  number: /^order number$/,
  summary: /^order details$/,
};

/** Orders listed on a saved eCourts orders (or status) page; `[]` for anything else. */
export function parseEcourtsOrders(html: string): CaseStatusOrder[] {
  return readOrders(readHtmlTables(html).tables, ECOURTS_ORDER_COLUMNS);
}
