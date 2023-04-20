import BN from "bn.js";
import { BNish, toBN } from "../../lib/utils/helpers";

export abstract class Approximation {
    constructor(
        public value: BN,
    ) { }

    abstract matches(value: BNish): boolean;

    abstract assertMatches(value: BNish, message?: string): void;

    absoluteError(value: BNish) {
        return toBN(value).sub(this.value).abs();
    }

    relativeError(value: BNish) {
        const error = this.absoluteError(value);
        return error.isZero() ? 0 : Number(error) / Number(BN.max(toBN(value), this.value));
    }

    static absolute(value: BNish, error: BNish) {
        return new AbsoluteApproximation(toBN(value), toBN(error));
    }

    static relative(value: BNish, relativeError: number) {
        return new RelativeApproximation(toBN(value), relativeError);
    }
}

class AbsoluteApproximation extends Approximation {
    constructor(
        value: BN,
        public maxError: BN | number,
    ) {
        super(value);
    }

    override matches(value: BNish) {
        return this.absoluteError(value).lte(toBN(this.maxError));
    }

    override assertMatches(value: BNish, message?: string) {
        const error = this.absoluteError(value);
        if (error.gt(toBN(this.maxError))) {
            assert.fail(value, this.value, `${message ? message + ' - ' : ''}error is ${error}, expected below ${this.maxError}`);
        }
    }
}

class RelativeApproximation extends Approximation {
    constructor(
        value: BN,
        public maxError: BN | number,
    ) {
        super(value);
    }

    override matches(value: BNish) {
        return this.relativeError(value) <= Number(this.maxError)
    }

    override assertMatches(value: BNish, message?: string) {
        const error = this.relativeError(value);
        if (error > Number(this.maxError)) {
            assert.fail(value, this.value, `${message ? message + ' - ' : ''}relative error is ${error.toExponential(3)}, expected below ${this.maxError}`);
        }
    }
}

export function assertApproximateMatch(value: BNish, expected: Approximation) {
    return expected.assertMatches(value);
}
