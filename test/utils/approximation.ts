import { BNish, toBN } from "../../lib/utils/helpers";

export abstract class Approximation {
    constructor(
        public expected: BN,
    ) { }

    abstract matches(value: BNish): boolean;

    abstract assertMatches(value: BNish, message?: string): void;

    absoluteError(value: BNish) {
        return toBN(value).sub(this.expected).abs();
    }

    relativeError(value: BNish) {
        const error = this.absoluteError(value);
        return error.isZero() ? 0 : Number(error) / Math.max(Math.abs(Number(value)), Math.abs(Number(this.expected)));
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
        expected: BN,
        public maxError: BN,
    ) {
        super(expected);
    }

    override matches(value: BNish) {
        return this.absoluteError(value).lte(this.maxError);
    }

    override assertMatches(value: BNish, message?: string) {
        const error = this.absoluteError(value);
        if (error.gt(this.maxError)) {
            // should use assert.fail, but it doesn't display expected and actual value
            assert.equal(String(value), String(this.expected), `${message ?? 'Values too different'} - absolute error is ${error}, should be below ${this.maxError}`);
        }
    }
}

class RelativeApproximation extends Approximation {
    constructor(
        expected: BN,
        public maxError: number,
    ) {
        super(expected);
    }

    override matches(value: BNish) {
        return this.relativeError(value) <= this.maxError;
    }

    override assertMatches(value: BNish, message?: string) {
        const error = this.relativeError(value);
        if (error > this.maxError) {
            assert.equal(String(value), String(this.expected), `${message ?? 'Values too different'} - relative error is ${error.toExponential(3)}, should be below ${this.maxError}`);
        }
    }
}

export function assertApproximateMatch(value: BNish, expected: Approximation) {
    return expected.assertMatches(value);
}

export function assertApproximatelyEqual(value: BNish, expected: BNish, approximationType: 'absolute' | 'relative', maxError: BNish, message?: string) {
    const approximation = approximationType === 'absolute' ? Approximation.absolute(expected, maxError) : Approximation.relative(expected, Number(maxError));
    // console.log(`value: ${value},  expected: ${expected},  error: ${toBN(value).sub(toBN(expected))},  relativeErr: ${approximation.relativeError(value)}`);
    approximation.assertMatches(value, message);
}
