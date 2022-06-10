/**
 * @description Calc gas cost of a eth transaction.
 * @param {*} result Eth transaction result 
 */
export async function calcGasCost(result: Truffle.TransactionResponse<any>) {
  // Get the transaction
  let tr = await web3.eth.getTransaction(result.tx);
  // Compute the gas cost of the depositResult
  let txCost = web3.utils.toBN(result.receipt.gasUsed).mul(web3.utils.toBN(tr.gasPrice));
  return txCost;
};

export function sumGas(tx: Truffle.TransactionResponse<any>, sum: { gas: number }) {
  sum.gas += tx.receipt.gasUsed;
}
