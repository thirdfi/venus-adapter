const { ethers, network } = require("hardhat");

const ERC20_ABI = require("@openzeppelin/contracts-upgradeable/build/contracts/ERC20Upgradeable").abi;

module.exports = async () => {
  const [deployer] = await ethers.getSigners();

  const usdtHolder = await ethers.getSigner('0xF977814e90dA44bFA03b6295A0616a897441aceC');
  await network.provider.request({method: "hardhat_impersonateAccount", params: [usdtHolder.address]});
  const usdt = new ethers.Contract('0x55d398326f99059fF775485246999027B3197955', ERC20_ABI, usdtHolder);
  await usdt.transfer(deployer.address, await usdt.balanceOf(usdtHolder.address));

  const usdcHolder = await ethers.getSigner('0x8894E0a0c962CB723c1976a4421c95949bE2D4E3');
  await network.provider.request({method: "hardhat_impersonateAccount", params: [usdcHolder.address]});
  const usdc = new ethers.Contract('0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', ERC20_ABI, usdcHolder);
  await usdc.transfer(deployer.address, await usdc.balanceOf(usdcHolder.address));
};

module.exports.tags = ["hardhat_bsc_adapter"];
module.exports.dependencies = [
  "hardhat_bsc_reset",
  "bscMainnet_VenusAdapter",
];
