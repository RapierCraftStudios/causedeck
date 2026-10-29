// The data table alternative of a chart (#85): every chart has one, so no number lives only in a
// picture. A caption names it; headers are real column headers.
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@causedeck/ui/table';

export interface DataTableAltProps {
  caption: string;
  columns: readonly string[];
  rows: readonly (readonly string[])[];
  /** Shown instead of the body when there are no rows. */
  none: string;
}

export function DataTableAlt({ caption, columns, rows, none }: DataTableAltProps) {
  return (
    <Table data-slot="insights-data-table">
      <TableCaption className="sr-only">{caption}</TableCaption>
      <TableHeader>
        <TableRow>
          {columns.map((column) => (
            <TableHead key={column} scope="col">
              {column}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.length === 0 ? (
          <TableRow>
            <TableCell colSpan={columns.length}>{none}</TableCell>
          </TableRow>
        ) : (
          rows.map((row) => (
            <TableRow key={row[0]}>
              {row.map((cell, i) => (
                <TableCell key={`${row[0] ?? ''}-${String(i)}`}>{cell}</TableCell>
              ))}
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}
