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

      const reservesTokens = await adapter.getAllReservesTokens();
      expect(reservesTokens.length).to.gt(0);
    });
  });

  describe('Features', () => {
    let comptroller, vUSDT, vUSDC, vBNB;

    beforeEach(async () => {
      const vbep20Artifact = await deployments.getArtifact("VBep20Interface");
      vUSDT = new ethers.Contract("0xfD5840Cd36d94D7229439859C0112a4185BC0255", vbep20Artifact.abi, a1);
      vUSDC = new ethers.Contract("0xecA88125a5ADbe82614ffC12D0DB554E2e2867C8", vbep20Artifact.abi, a1);
      const vbnbArtifact = await deployments.getArtifact("VBNBInterface");
      vBNB = new ethers.Contract(network_.Venus.vBNB, vbnbArtifact.abi, a1);

      const comptrollerArtifact = await deployments.getArtifact("ComptrollerInterface");
      comptroller = new ethers.Contract(network_.Venus.Comptroller, comptrollerArtifact.abi, a1);
    });

    it("Should be correctly worked", async () => {
      await usdt.connect(deployer).transfer(a1.address, getUsdtAmount('10000'));
      await usdc.connect(deployer).transfer(a1.address, getUsdcAmount('100'));
      await usdt.approve(adapter.address, MaxUint256);
      await usdc.approve(adapter.address, MaxUint256);
      await vUSDT.approve(adapter.address, MaxUint256);
      await comptroller.enterMarkets([vUSDT.address]);

      // deposit
      await adapter.supply(vUSDT.address, getUsdtAmount('10000'));
      expect(await usdt.balanceOf(a1.address)).equal(0);
      expect(await vUSDT.balanceOf(a1.address)).gt(0);

      // borrow
      await vUSDC.borrow(getUsdcAmount('1000'));
      expect(await usdc.balanceOf(a1.address)).equal(getUsdcAmount('1100'));

      // repay
      await adapter.repay(vUSDC.address, MaxUint256);
      expect(await usdc.balanceOf(a1.address)).lte(getUsdcAmount('100'));
      expect(await vUSDC.borrowBalanceStored(a1.address)).equal(0);

      // withdraw
      await adapter.withdraw(vUSDT.address, await vUSDT.balanceOf(a1.address));
      expect(await vUSDT.balanceOf(a1.address)).equal(0);
      expect(await usdt.balanceOf(a1.address)).gte(getUsdtAmount('10000'));
    });

    it("Should BNB be correctly borrowed", async () => {
      await usdt.connect(deployer).transfer(a1.address, getUsdtAmount('10000'));
      await usdt.approve(adapter.address, MaxUint256);
      await vUSDT.approve(adapter.address, MaxUint256);

      // deposit
      await adapter.supply(vUSDT.address, getUsdtAmount('10000'));
      expect(await usdt.balanceOf(a1.address)).equal(0);
      expect(await vUSDT.balanceOf(a1.address)).gt(0);

      // borrow
      const prevBalance = await etherBalance(a1.address)
      await comptroller.enterMarkets([vUSDT.address]);
      await vBNB.borrow(parseEther('10'));
      expect(await etherBalance(a1.address)).closeTo(prevBalance.add(parseEther('10')), parseEther('0.01'));

      // await increaseTime(10 * DAY);

      // repay
      await adapter.repayETH(MaxUint256, {value: parseEther('10.1')});
      expect(await etherBalance(a1.address)).closeTo(prevBalance, parseEther('0.01'));
      expect(await vBNB.borrowBalanceStored(a1.address)).equal(0);

      // withdraw
      await adapter.withdraw(vUSDT.address, await vUSDT.balanceOf(a1.address));
      expect(await vUSDT.balanceOf(a1.address)).equal(0);
      expect(await usdt.balanceOf(a1.address)).gte(getUsdtAmount('10000'));
    });

    it("Should BNB be correctly deposited", async () => {
      await usdc.connect(deployer).transfer(a1.address, getUsdcAmount('100'));
      await usdc.approve(adapter.address, MaxUint256);
      await vBNB.approve(adapter.address, MaxUint256);

      // deposit
      const prevBalance = await etherBalance(a1.address)
      await adapter.supplyETH({value: parseEther('100')});
      expect(await etherBalance(a1.address)).closeTo(prevBalance.sub(parseEther('100')), parseEther('0.01'));
      expect(await vBNB.balanceOf(a1.address)).gt(0);

      // borrow
      await comptroller.enterMarkets([vBNB.address]);
      await vUSDC.borrow(getUsdcAmount('1000'));
      expect(await usdc.balanceOf(a1.address)).equal(getUsdcAmount('1100'));

      // await increaseTime(10 * DAY);

      // repay
      await adapter.repay(vUSDC.address, MaxUint256);
      expect(await usdc.balanceOf(a1.address)).lte(getUsdcAmount('100'));
      expect(await vUSDC.borrowBalanceStored(a1.address)).equal(0);

      // withdraw
      await adapter.withdraw(vBNB.address, await vBNB.balanceOf(a1.address));
      expect(await vBNB.balanceOf(a1.address)).equal(0);
      expect(await etherBalance(a1.address)).closeTo(prevBalance, parseEther('0.01'));
    });

    it("Should be correctly worked with the merged methods", async () => {
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

      // await increaseTime(10 * DAY);

      // repay & withdraw
      await adapter.repayAndWithdraw(
        vUSDC.address, MaxUint256,
        vUSDT.address, await vUSDT.balanceOf(a1.address)
      );
      expect(await vUSDC.borrowBalanceStored(a1.address)).equal(0);
      expect(await usdc.balanceOf(a1.address)).lte(getUsdcAmount('100'));
      expect(await vUSDT.balanceOf(a1.address)).equal(0);
      expect(await usdt.balanceOf(a1.address)).gte(getUsdtAmount('10000'));
    });
  });
});