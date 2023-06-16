import { BN_ZERO } from "../../lib/utils/helpers";

export class SparseArray {
    constructor(
        private readonly data: Map<string, BN> = new Map(),
    ) { }

    get(key: string) {
        return this.data.get(key) ?? BN_ZERO;
    }

    set(key: string, value: BN) {
        if (value.isZero()) {
            this.data.delete(key);
        } else {
            this.data.set(key, value);
        }
    }

    keys() {
        return this.data.keys();
    }

    countNonZero() {
        return this.data.size;
    }
    
    total() {
        let result = BN_ZERO;
        for (const value of this.data.values()) {
            result = result.add(value);
        }
        return result;
    }
    
    addTo(key: string, value: BN) {
        this.set(key, this.get(key).add(value));
    }

    clear() {
        this.data.clear();
    }

    toObject() {
        const result: { [key: string]: BN } = {};
        for (const [key, val] of this.data) {
            result[key] = val;
        }
        return result;
    }

    clone() {
        return new SparseArray(new Map(this.data));
    }
}

export class SparseMatrix {
    private readonly rows: Map<string, Map<string, BN>> = new Map();
    private readonly cols: Map<string, Map<string, BN>> = new Map();

    get(from: string, to: string): BN {
        return this.rows.get(from)?.get(to) ?? BN_ZERO;
    }

    set(from: string, to: string, value: BN) {
        this._set(this.rows, from, to, value);
        this._set(this.cols, to, from, value);
    }

    private _set(map: Map<string, Map<string, BN>>, from: string, to: string, value: BN) {
        let row = map.get(from);
        if (!value.isZero()) {
            if (row == null) {
                row = new Map();
                map.set(from, row);
            }
            row.set(to, value);
        } else {
            if (row == null) return;
            row.delete(to);
            if (row.size === 0) {
                map.delete(from);
            }
        }
    }

    allRows() {
        return this.rows.keys();
    }

    hasRow(from: string) {
        return this.rows.has(from);
    }

    rowMap(from: string) {
        return this.rows.get(from) ?? new Map<string, BN>();
    }

    row(from: string): SparseArray {
        return new SparseArray(this.rows.get(from) ?? new Map());
    }

    allCols() {
        return this.cols.keys();
    }

    hasCol(to: string) {
        return this.cols.has(to);
    }

    colMap(to: string) {
        return this.cols.get(to) ?? new Map<string, BN>();
    }

    col(to: string): SparseArray {
        return new SparseArray(this.cols.get(to) ?? new Map());
    }

    clear() {
        this.rows.clear();
        this.cols.clear();
    }

    toObject() {
        const result: { [row: string]: { [col: string]: BN } } = {};
        for (const [row, map] of this.rows) {
            result[row] = {};
            for (const [col, val] of map) {
                result[row][col] = val;
            }
        }
        return result;
    }

    clone(): SparseMatrix {
        const result = new SparseMatrix();
        for (const [from, map] of this.rows) {
            result.rows.set(from, new Map(map));
        }
        for (const [to, map] of this.cols) {
            result.cols.set(to, new Map(map));
        }
        return result;
    }
}
