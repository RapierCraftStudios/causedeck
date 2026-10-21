// Table rows from assigned lines (#38, ADR 0018). A line whose case-number cell starts a matter
// opens a row; every other body line continues the row before it: a wrapped cell's next line, or a
// nested application (an IA/CA number with an empty CP cell). Rows may continue onto the next page.
// A continuation line with no row before it is an orphan and is reported, not attached. Pure.
import type { AssignedLine, Line } from './cluster.ts';

export interface RowLine {
  line: Line;
  assigned: AssignedLine;
}

export interface RawRow {
  /** The page the row starts on; its anchor is there. */
  page: number;
  /** The bench section (coram) the row sits under, from 0. */
  benchIndex: number;
  /** In reading order; the first opened the row. */
  lines: RowLine[];
}

export interface RowGrouping {
  rows: RawRow[];
  /** Continuation lines with no row to attach to. */
  orphans: RowLine[];
}

export class RowAssembler {
  private readonly rows: RawRow[] = [];
  private readonly orphans: RowLine[] = [];

  private readonly perBench = new Map<number, number>();

  /**
   * Adds a body line; `startsRow` says whether it opens a new row. Returns false when the line is
   * an orphan (a continuation with no row before it in its bench section).
   */
  add(rowLine: RowLine, startsRow: boolean, benchIndex: number): boolean {
    const current = this.rows.at(-1);
    if (startsRow) {
      this.rows.push({ page: rowLine.line.page, benchIndex, lines: [rowLine] });
      this.perBench.set(benchIndex, this.countIn(benchIndex) + 1);
      return true;
    }
    if (current !== undefined && current.benchIndex === benchIndex) {
      current.lines.push(rowLine);
      return true;
    }
    this.orphans.push(rowLine);
    return false;
  }

  /** Rows in a bench section so far. */
  countIn(benchIndex: number): number {
    return this.perBench.get(benchIndex) ?? 0;
  }

  result(): RowGrouping {
    return { rows: [...this.rows], orphans: [...this.orphans] };
  }
}

/** A cell's text across a row's lines, joined by spaces; '' when empty. */
export function joinCell(lines: readonly RowLine[], key: string): string {
  return lines
    .map((rowLine) => rowLine.assigned.cells[key] ?? '')
    .filter((text) => text !== '')
    .join(' ');
}
