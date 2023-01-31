const { expect } = require("chai");
const { assert, ethers, deployments } = require("hardhat");
const { expectRevert } = require('@openzeppelin/test-helpers');
const { BigNumber } = ethers;
const parseEther = ethers.utils.parseEther;
const MaxUint256 = ethers.constants.MaxUint256;

const ERC20_ABI = require("@openzeppelin/contracts-upgradeable/build/contracts/ERC20Upgradeable.json").abi;

const { bscMainnet: network_ } = require("../parameters");
const { etherBalance, increaseTime } = require("../scripts/utils/ethereum");

function getUsdtAmount(amount) {
  return ethers.utils.parseUnits(amount, 18);
}
function getUsdcAmount(amount) {
  return ethers.utils.parseUnits(amount, 18);
}

describe("Adapter on BSC", async () => {
  const DAY = 24 * 3600;

  let adapter, usdc, usdt;
  let adapterArtifact;

  before(async () => {
    [deployer, a1, a2, ...accounts] = await ethers.getSigners();

    adapterArtifact = await deployments.getArtifact("VenusAdapter");
  });

  beforeEach(async () => {
    await deployments.fixture(["hardhat_bsc_adapter"])

    const adapterProxy = await ethers.getContract("VenusAdapter_Proxy");
    adapter = new ethers.Contract(adapterProxy.address, adapterArtifact.abi, a1);

    usdt = new ethers.Contract('0x55d398326f99059fF775485246999027B3197955', ERC20_ABI, a1);
    usdc = new ethers.Contract('0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', ERC20_ABI, a1);
  });

  describe('Basic', () => {
    it("Should be set with correct initial vaule", async () => {
      expect(await adapter.COMPTROLLER()).equal(network_.Venus.Comptroller);
      expect(await adapter.vBNB()).equal(network_.Venus.vBNB);
    });
  });

  describe('Features', () => {
    let comptroller, vUSDT, vUSDC;

    beforeEach(async () => {
      const bep20Artifact = await deployments.getArtifact("VBep20Interface");
      vUSDT = new ethers.Contract("0xfD5840Cd36d94D7229439859C0112a4185BC0255", bep20Artifact.abi, a1);
      vUSDC = new ethers.Contract("0xecA88125a5ADbe82614ffC12D0DB554E2e2867C8", bep20Artifact.abi, a1);

      const comptrollerArtifact = await deployments.getArtifact("ComptrollerInterface");
      comptroller = new ethers.Contract(network_.Venus.Comptroller, comptrollerArtifact.abi, a1);
    });

    it("Should be correctly worked", async () => {
      await usdt.connect(deployer).transfer(a1.address, getUsdtAmount('10000'));
      await usdc.connect(deployer).transfer(a1.address, getUsdcAmount('100'));
      await usdt.approve(adapter.address, MaxUint256);
      await usdc.approve(adapter.address, MaxUint256);
      await vUSDT.approve(adapter.address, MaxUint256);

      // deposit
      await adapter.supply(vUSDT.address, getUsdtAmount('10000'));
      expect(await usdt.balanceOf(a1.address)).equal(0);
      expect(await vUSDT.balanceOf(a1.address)).gt(0);

      // borrow
      await comptroller.enterMarkets([vUSDT.address]);
      await vUSDC.borrow(getUsdcAmount('1000'));
      expect(await usdc.balanceOf(a1.address)).equal(getUsdcAmount('1100'));

      await increaseTime(10 * DAY);

      // repay
      await adapter.repay(vUSDC.address, MaxUint256);
      expect(await usdc.balanceOf(a1.address)).lte(getUsdcAmount('100'));
      expect(await vUSDC.borrowBalanceStored(a1.address)).equal(0);

      // withdraw
      await adapter.withdraw(vUSDT.address, await vUSDT.balanceOf(a1.address));
      expect(await vUSDT.balanceOf(a1.address)).equal(0);
      expect(await usdt.balanceOf(a1.address)).gte(getUsdtAmount('10000'));
    });
  });
});