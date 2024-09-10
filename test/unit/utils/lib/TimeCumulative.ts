import { expectRevert } from "@openzeppelin/test-helpers";
import { TimeCumulativeMockInstance } from "../../../../typechain-truffle";
import { getTestFile } from "../../../utils/test-helpers";
import { assertWeb3Equal } from "../../../utils/web3assertions";

const TimeCumulative = artifacts.require("TimeCumulativeMock");

contract(`TimeCumulative.sol; ${getTestFile(__filename)};  TimeCumulative unit tests`, async accounts => {
    let timeCumulative: TimeCumulativeMockInstance;

    beforeEach(async () => {
        timeCumulative = await TimeCumulative.new();
    });

    it("should add 3 data points and calculate cumulatives at points correctly", async () => {
        await timeCumulative.addDataPoint(10, 5);
        await timeCumulative.addDataPoint(20, 6);
        await timeCumulative.addDataPoint(20, 8);   // new value at same timeshould overwrite
        await expectRevert(timeCumulative.addDataPoint(15, 10), "TimeCumulative: timestamp not increasing");
        await timeCumulative.addDataPoint(40, 3);
        const { 0: points, 1: start, 2: end } = await timeCumulative.getData();
        assert.equal(points.length, 3);
        assertWeb3Equal(start, 0);
        assertWeb3Equal(end, 3);
        assertWeb3Equal(points[0].cumulative, 0);
        assertWeb3Equal(points[1].cumulative, 50);
        assertWeb3Equal(points[2].cumulative, 210);
        assertWeb3Equal(points[1].value, 8);
        assertWeb3Equal(points[2].timestamp, 40);
        assertWeb3Equal(points[2].value, 3);
    });

    it("should correctly calculate cumulatives between points", async () => {
        await timeCumulative.addDataPoint(10, 5);
        await timeCumulative.addDataPoint(20, 8);
        await timeCumulative.addDataPoint(40, 3);
        await timeCumulative.addDataPoint(90, 10);
        // check cumulativeTo
        assertWeb3Equal(await timeCumulative.cumulativeTo(5), 0);
        assertWeb3Equal(await timeCumulative.cumulativeTo(16), 30);
        assertWeb3Equal(await timeCumulative.cumulativeTo(20), 50);
        assertWeb3Equal(await timeCumulative.cumulativeTo(30), 130);
        assertWeb3Equal(await timeCumulative.cumulativeTo(40), 210);
        assertWeb3Equal(await timeCumulative.cumulativeTo(50), 240);
        assertWeb3Equal(await timeCumulative.cumulativeTo(90), 360);
        assertWeb3Equal(await timeCumulative.cumulativeTo(120), 660);
        // check intervalCumulative
        assertWeb3Equal(await timeCumulative.intervalCumulative(5, 50), 240);
        assertWeb3Equal(await timeCumulative.intervalCumulative(16, 50), 210);
        assertWeb3Equal(await timeCumulative.intervalCumulative(30, 90), 230);
        assertWeb3Equal(await timeCumulative.intervalCumulative(5, 120), 660);
    });

    it("cumulatives should work after cleanup", async () => {
        await timeCumulative.addDataPoint(10, 5);
        await timeCumulative.addDataPoint(20, 8);
        await timeCumulative.addDataPoint(40, 3);
        await timeCumulative.addDataPoint(90, 10);
        await timeCumulative.cleanup(50, 5);
        // 2 points should be left (the first one before or at the cleanup point)
        const { 0: points, 1: start, 2: end } = await timeCumulative.getData();
        assertWeb3Equal(start, 2);
        assertWeb3Equal(end, 4);
        assertWeb3Equal(points[2].timestamp, 40);
        assertWeb3Equal(points[2].cumulative, 210);
        assertWeb3Equal(points[3].timestamp, 90);
        assertWeb3Equal(points[3].cumulative, 360);
        // anything before point at 40 should be lost
        await expectRevert(timeCumulative.cumulativeTo(20), "TimeCumulative: already cleaned up");
        await expectRevert(timeCumulative.cumulativeTo(39), "TimeCumulative: already cleaned up");
        // from 40 on it should work normally
        assertWeb3Equal(await timeCumulative.cumulativeTo(40), 210);
        assertWeb3Equal(await timeCumulative.cumulativeTo(50), 240);
        assertWeb3Equal(await timeCumulative.cumulativeTo(90), 360);
        assertWeb3Equal(await timeCumulative.cumulativeTo(120), 660);
    });
});
