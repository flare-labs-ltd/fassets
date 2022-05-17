import { expectRevert } from "@openzeppelin/test-helpers";
import { artifacts, contract } from "hardhat";
import { SafeMath64MockContract, SafeMath64MockInstance } from "../../../../typechain-truffle";
import { getTestFile, toBN } from "../../../utils/helpers";

const SafeMath64 = artifacts.require("SafeMath64Mock") as SafeMath64MockContract;

contract(`SafeMath64.sol; ${getTestFile(__filename)};  SafeMath64 unit tests`, async accounts => {
    let safeMath64: SafeMath64MockInstance;
    const MAX_UINT64 = toBN(2).pow(toBN(64));
    const MAX_INT64 = toBN(2).pow(toBN(63));
    before(async() => {
        safeMath64 = await SafeMath64.new();
    });

    it("should revert if negative number ot overflow", async () => {
        let resN = safeMath64.toUint64(-1);
        await expectRevert(resN, "SafeMath64: negative value");
        let resO = safeMath64.toUint64(MAX_UINT64);
        await expectRevert(resO, "SafeMath64: conversion overflow");
    });

    it("should revert if overflow", async () => {
        let res = safeMath64.toInt64(MAX_INT64);
        await expectRevert(res, "SafeMath64: conversion overflow");
    });

    it("should successfully return", async () => {
        await safeMath64.toUint64(MAX_UINT64.subn(1));
        await safeMath64.toInt64(MAX_INT64.subn(1));
    });

});