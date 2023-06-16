// import { expectEvent, expectRevert, time } from "@openzeppelin/test-helpers";
// import { GovernedWithTimelockMockInstance } from "../../../../typechain-truffle";
// import { getTestFile } from "../../../utils/constants";
// import { testDeployGovernanceSettings } from "../../../utils/contract-test-helpers";
// import { assertNumberEqual, findRequiredEvent } from "../../../utils/test-helpers";

// const GovernedWithTimelockMock = artifacts.require("GovernedWithTimelockMock");

// contract(`GovernedWithTimelock.sol; ${getTestFile(__filename)}; GovernedWithTimelock unit tests`, async accounts => {
//     const initialGovernance = accounts[10];
//     const governance = accounts[11];
//     const executor = accounts[12];
    
//     let mock: GovernedWithTimelockMockInstance;
    
//     before(async() => {
//         await testDeployGovernanceSettings(governance, 3600, [governance, executor]);
//     });
    
//     beforeEach(async () => {
//         mock = await GovernedWithTimelockMock.new(initialGovernance);
//         await mock.switchToProductionMode({ from: initialGovernance });
//     });

//     it("allow direct changes in deployment phase", async () => {
//         const mockDeployment = await GovernedWithTimelockMock.new(initialGovernance);
//         await mockDeployment.changeA(15, { from: initialGovernance });
//         assertNumberEqual(await mockDeployment.a(), 15);
//     });
    
//     it("no effect immediately", async () => {
//         await mock.changeA(15, { from: governance });
//         assertNumberEqual(await mock.a(), 0);
//     });

//     it("can execute after time", async () => {
//         const res = await mock.changeA(15, { from: governance });
//         const { selector } = findRequiredEvent(res, 'GovernanceCallTimelocked').args;
//         await time.increase(3600);
//         const execRes = await mock.executeGovernanceCall(selector, { from: executor });
//         expectEvent(execRes, "TimelockedGovernanceCallExecuted", { selector: selector });
//         assertNumberEqual(await mock.a(), 15);
//     });

//     it("cannot execute before time", async () => {
//         const res = await mock.changeA(15, { from: governance });
//         const { selector } = findRequiredEvent(res, 'GovernanceCallTimelocked').args;
//         await time.increase(3000);  // should be 3600
//         await expectRevert(mock.executeGovernanceCall(selector, { from: executor }),
//             "timelock: not allowed yet");
//         assertNumberEqual(await mock.a(), 0);
//     });

//     it("must use valid selector to execute", async () => {
//         const res = await mock.changeA(15, { from: governance });
//         findRequiredEvent(res, 'GovernanceCallTimelocked').args;
//         await time.increase(3600);  // should be 3600
//         const useSelector = "0xffffffff";
//         await expectRevert(mock.executeGovernanceCall(useSelector, { from: executor }),
//             "timelock: invalid selector");
//         assertNumberEqual(await mock.a(), 0);
//     });

//     it("cannot execute same timelocked method twice", async () => {
//         const res = await mock.increaseA(10, { from: governance });
//         const { selector } = findRequiredEvent(res, 'GovernanceCallTimelocked').args;
//         await time.increase(3600);
//         const execRes = await mock.executeGovernanceCall(selector, { from: executor });
//         expectEvent(execRes, "TimelockedGovernanceCallExecuted", { selector: selector });
//         assertNumberEqual(await mock.a(), 10);
//         // shouldn't execute again
//         await expectRevert(mock.executeGovernanceCall(selector, { from: executor }),
//             "timelock: invalid selector");
//         assertNumberEqual(await mock.a(), 10);
//     });

//     it("passes reverts correctly", async () => {
//         const res = await mock.changeWithRevert(15, { from: governance });
//         const { selector } = findRequiredEvent(res, 'GovernanceCallTimelocked').args;
//         await time.increase(3600);
//         await expectRevert(mock.executeGovernanceCall(selector, { from: executor }),
//             "this is revert");
//         assertNumberEqual(await mock.a(), 0);
//     });

//     it("can cancel timelocked call", async () => {
//         const res = await mock.increaseA(10, { from: governance });
//         const { selector } = findRequiredEvent(res, 'GovernanceCallTimelocked').args;
//         await time.increase(3600);
//         const cancelRes = await mock.cancelGovernanceCall(selector, { from: governance });
//         expectEvent(cancelRes, "TimelockedGovernanceCallCanceled", { selector: selector });
//         // shouldn't execute after cancel
//         await expectRevert(mock.executeGovernanceCall(selector, { from: executor }),
//             "timelock: invalid selector");
//         assertNumberEqual(await mock.a(), 0);
//     });

//     it("cannot cancel an already executed timelocked call", async () => {
//         const res = await mock.increaseA(10, { from: governance });
//         const { selector } = findRequiredEvent(res, 'GovernanceCallTimelocked').args;
//         await time.increase(3600);
//         const execRes = await mock.executeGovernanceCall(selector, { from: executor });
//         expectEvent(execRes, "TimelockedGovernanceCallExecuted", { selector: selector });
//         // shouldn't execute after cancel
//         await expectRevert(mock.cancelGovernanceCall(selector, { from: governance }),
//             "timelock: invalid selector");
//         assertNumberEqual(await mock.a(), 10);
//     });

//     it("require governance - deployment phase", async () => {
//         const mockDeployment = await GovernedWithTimelockMock.new(initialGovernance);
//         await expectRevert(mockDeployment.changeA(20), "only governance");
//     });

//     it("only governance can call a governance call with timelock", async () => {
//         await expectRevert(mock.changeA(20), "only governance");
//     });

//     it("only governance can call a governance call an immediate governance call", async () => {
//         await expectRevert(mock.changeB(20), "only governance");
//     });

//     it("only an executor can execute a timelocked call", async () => {
//         const res = await mock.changeA(15, { from: governance });
//         const { selector } = findRequiredEvent(res, 'GovernanceCallTimelocked').args;
//         await time.increase(3600);
//         await expectRevert(mock.executeGovernanceCall(selector, { from: accounts[5] }), "only executor");
//     });

//     it("only governance can cancel a timelocked call", async () => {
//         const res = await mock.increaseA(10, { from: governance });
//         const { selector } = findRequiredEvent(res, 'GovernanceCallTimelocked').args;
//         await time.increase(3600);
//         await expectRevert(mock.cancelGovernanceCall(selector, { from: executor }),
//             "only governance");
//     });
// });
