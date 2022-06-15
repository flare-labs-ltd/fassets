import { constants, expectRevert } from "@openzeppelin/test-helpers";
import { RedemptionQueueMockInstance } from "../../../../typechain-truffle";
import { BNish, randomAddress, toBN, toStringExp } from "../../../../lib/utils/helpers";
import { getTestFile } from "../../../utils/test-helpers";
import { assertWeb3Equal } from "../../../utils/web3assertions";

const RedemptionQueue = artifacts.require("RedemptionQueueMock");

contract(`RedemptionQueue.sol; ${getTestFile(__filename)};  RedemptionQueue unit tests`, async accounts => {
    const agentVault1 = randomAddress();
    const agentVault2 = randomAddress();
    let redemptionQueue: RedemptionQueueMockInstance;

    async function createRedemptionTicket(agentVault: string, valueAMG: BNish) {
        let ticketId = await redemptionQueue.createRedemptionTicket.call(agentVault, valueAMG);
        await redemptionQueue.createRedemptionTicket(agentVault, valueAMG);
        return ticketId;
    }

    async function checkTicket(ticketId: BNish, agentVault: string, valueAMG: BNish, prev: number, next: number, prevForAgent: number, nextForAgent: number) {
        const ticket = await redemptionQueue.getTicket(ticketId);
        assertWeb3Equal(ticket.agentVault, agentVault);
        assertWeb3Equal(ticket.valueAMG, valueAMG);
        assertWeb3Equal(ticket.prev, prev);
        assertWeb3Equal(ticket.next, next);
        assertWeb3Equal(ticket.prevForAgent, prevForAgent);
        assertWeb3Equal(ticket.nextForAgent, nextForAgent);
    }

    beforeEach(async() => {
        redemptionQueue = await RedemptionQueue.new();
    });

    it("should create redemption ticket", async () => {
        const amgValue1 = toStringExp(1, 9);
        const ticketId1 = await createRedemptionTicket(agentVault1, amgValue1);
        assertWeb3Equal(ticketId1, 1);
        await checkTicket(ticketId1, agentVault1, amgValue1, 0, 0, 0, 0);
    });

    it("should create two redemption tickets - one agent", async () => {
        const amgValue1 = toStringExp(1, 9);
        const amgValue2 = toStringExp(2, 9);
        const ticketId1 = await createRedemptionTicket(agentVault1, amgValue1);
        const ticketId2 = await createRedemptionTicket(agentVault1, amgValue2);
        assertWeb3Equal(ticketId1, 1);
        assertWeb3Equal(ticketId2, 2);
        await checkTicket(ticketId1, agentVault1, amgValue1, 0, 2, 0, 2);
        await checkTicket(ticketId2, agentVault1, amgValue2, 1, 0, 1, 0);
    });

    it("should create three redemption tickets - one agent", async () => {
        const amgValue1 = toStringExp(1, 9);
        const amgValue2 = toStringExp(2, 9);
        const amgValue3 = toStringExp(3, 9);
        const ticketId1 = await createRedemptionTicket(agentVault1, amgValue1);
        const ticketId2 = await createRedemptionTicket(agentVault1, amgValue2);
        const ticketId3 = await createRedemptionTicket(agentVault1, amgValue3);
        assertWeb3Equal(ticketId1, 1);
        assertWeb3Equal(ticketId2, 2);
        assertWeb3Equal(ticketId3, 3);
        await checkTicket(ticketId1, agentVault1, amgValue1, 0, 2, 0, 2);
        await checkTicket(ticketId2, agentVault1, amgValue2, 1, 3, 1, 3);
        await checkTicket(ticketId3, agentVault1, amgValue3, 2, 0, 2, 0);
    });

    it("should create redemption ticket - two agents", async () => {
        const amgValue1 = toStringExp(1, 9);
        const amgValue2 = toStringExp(2, 9);
        const ticketId1 = await createRedemptionTicket(agentVault1, amgValue1);
        const ticketId2 = await createRedemptionTicket(agentVault2, amgValue2);
        assertWeb3Equal(ticketId1, 1);
        assertWeb3Equal(ticketId2, 2);
        await checkTicket(ticketId1, agentVault1, amgValue1, 0, 2, 0, 0);
        await checkTicket(ticketId2, agentVault2, amgValue2, 1, 0, 0, 0);
    });

    it("should create multiple redemption tickets - two agents", async () => {
        const amgValue1 = toStringExp(1, 9);
        const amgValue2 = toStringExp(2, 9);
        const amgValue3 = toStringExp(3, 9);
        const amgValue4 = toStringExp(4, 9);
        const amgValue5 = toStringExp(5, 9);
        const amgValue6 = toStringExp(6, 9);
        const ticketId1 = await createRedemptionTicket(agentVault1, amgValue1);
        const ticketId2 = await createRedemptionTicket(agentVault2, amgValue2);
        const ticketId3 = await createRedemptionTicket(agentVault1, amgValue3);
        const ticketId4 = await createRedemptionTicket(agentVault2, amgValue4);
        const ticketId5 = await createRedemptionTicket(agentVault2, amgValue5);
        const ticketId6 = await createRedemptionTicket(agentVault1, amgValue6);
        assertWeb3Equal(ticketId1, 1);
        assertWeb3Equal(ticketId2, 2);
        assertWeb3Equal(ticketId3, 3);
        assertWeb3Equal(ticketId4, 4);
        assertWeb3Equal(ticketId5, 5);
        assertWeb3Equal(ticketId6, 6);
        await checkTicket(ticketId1, agentVault1, amgValue1, 0, 2, 0, 3);
        await checkTicket(ticketId2, agentVault2, amgValue2, 1, 3, 0, 4);
        await checkTicket(ticketId3, agentVault1, amgValue3, 2, 4, 1, 6);
        await checkTicket(ticketId4, agentVault2, amgValue4, 3, 5, 2, 5);
        await checkTicket(ticketId5, agentVault2, amgValue5, 4, 6, 4, 0);
        await checkTicket(ticketId6, agentVault1, amgValue6, 5, 0, 3, 0);
    });

    it("should create and delete multiple redemption tickets - two agents", async () => {
        const amgValue1 = toStringExp(1, 9);
        const amgValue2 = toStringExp(2, 9);
        const amgValue3 = toStringExp(3, 9);
        const amgValue4 = toStringExp(4, 9);
        const amgValue5 = toStringExp(5, 9);
        const amgValue6 = toStringExp(6, 9);
        const amgValue7 = toStringExp(7, 9);
        const amgValue8 = toStringExp(8, 9);
        const ticketId1 = await createRedemptionTicket(agentVault1, amgValue1);
        const ticketId2 = await createRedemptionTicket(agentVault2, amgValue2);
        const ticketId3 = await createRedemptionTicket(agentVault1, amgValue3);
        const ticketId4 = await createRedemptionTicket(agentVault2, amgValue4);
        const ticketId5 = await createRedemptionTicket(agentVault2, amgValue5);
        const ticketId6 = await createRedemptionTicket(agentVault1, amgValue6);
        const ticketId7 = await createRedemptionTicket(agentVault1, amgValue7);
        await redemptionQueue.deleteRedemptionTicket(1);
        await redemptionQueue.deleteRedemptionTicket(5);
        await redemptionQueue.deleteRedemptionTicket(6);
        const ticketId8 = await createRedemptionTicket(agentVault2, amgValue8);
        assertWeb3Equal(ticketId1, 1);
        assertWeb3Equal(ticketId2, 2);
        assertWeb3Equal(ticketId3, 3);
        assertWeb3Equal(ticketId4, 4);
        assertWeb3Equal(ticketId5, 5);
        assertWeb3Equal(ticketId6, 6);
        assertWeb3Equal(ticketId7, 7);
        assertWeb3Equal(ticketId8, 8);
        await checkTicket(ticketId1, constants.ZERO_ADDRESS, 0, 0, 0, 0, 0);
        await checkTicket(ticketId2, agentVault2, amgValue2, 0, 3, 0, 4);
        await checkTicket(ticketId3, agentVault1, amgValue3, 2, 4, 0, 7);
        await checkTicket(ticketId4, agentVault2, amgValue4, 3, 7, 2, 8);
        await checkTicket(ticketId5, constants.ZERO_ADDRESS, 0, 0, 0, 0, 0);
        await checkTicket(ticketId6, constants.ZERO_ADDRESS, 0, 0, 0, 0, 0);
        await checkTicket(ticketId7, agentVault1, amgValue7, 4, 8, 3, 0);
        await checkTicket(ticketId8, agentVault2, amgValue8, 7, 0, 4, 0);
    });

    it("should not delete unexisting redemption ticket", async () => {
        await expectRevert.unspecified(redemptionQueue.deleteRedemptionTicket(0));
        await expectRevert.unspecified(redemptionQueue.deleteRedemptionTicket(1));
        await expectRevert.unspecified(redemptionQueue.deleteRedemptionTicket(10));
        const amgValue1 = toStringExp(1, 9);
        const amgValue2 = toStringExp(2, 9);
        const amgValue3 = toStringExp(3, 9);
        const ticketId1 = await createRedemptionTicket(agentVault1, amgValue1);
        const ticketId2 = await createRedemptionTicket(agentVault1, amgValue2);
        const ticketId3 = await createRedemptionTicket(agentVault1, amgValue3);
        await redemptionQueue.deleteRedemptionTicket(1);
        assertWeb3Equal(ticketId1, 1);
        assertWeb3Equal(ticketId2, 2);
        assertWeb3Equal(ticketId3, 3);
        await checkTicket(ticketId1, constants.ZERO_ADDRESS, 0, 0, 0, 0, 0);
        await checkTicket(ticketId2, agentVault1, amgValue2, 0, 3, 0, 3);
        await checkTicket(ticketId3, agentVault1, amgValue3, 2, 0, 2, 0);
        await expectRevert.unspecified(redemptionQueue.deleteRedemptionTicket(0));
        await expectRevert.unspecified(redemptionQueue.deleteRedemptionTicket(1));
        await expectRevert.unspecified(redemptionQueue.deleteRedemptionTicket(10));
        await redemptionQueue.deleteRedemptionTicket(2);
        await redemptionQueue.deleteRedemptionTicket(3);
        await expectRevert.unspecified(redemptionQueue.deleteRedemptionTicket(0));
        await expectRevert.unspecified(redemptionQueue.deleteRedemptionTicket(1));
        await expectRevert.unspecified(redemptionQueue.deleteRedemptionTicket(10));
    });
});
